import crypto from "crypto";

// ---------------------------------------------
// CONFIG (via Environment Variables in Vercel)
// ---------------------------------------------
// Client final URLs (required)
const CLIENT_COMPLETE_URL  = process.env.CLIENT_COMPLETE_URL;   // e.g. https://client.com/complete
const CLIENT_TERMINATE_URL = process.env.CLIENT_TERMINATE_URL;  // e.g. https://client.com/terminate
const CLIENT_QUOTA_URL     = process.env.CLIENT_QUOTA_URL;      // e.g. https://client.com/quota

// (Optional) Sign client redirects so they can verify authenticity
const SIGNING_SECRET = process.env.SIGNING_SECRET || "";

// (Optional) GA4 logging (free analytics)
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || "";
const GA4_API_SECRET     = process.env.GA4_API_SECRET || "";

// -------- Vendor S2S Postback (Global Opinion MR) --------
// Give each vendor a short key via ?src=vendorKey (e.g., src=gomr)
// For GOMR, add these env vars in Vercel:
const GOMR_PID         = process.env.GOMR_PID || ""; // REQUIRED: vendor's project id (pid=...)
const GOMR_BASE        = process.env.GOMR_BASE || "https://globalopinionmr.com/admintool";
const ENABLE_VENDOR_S2S = (process.env.ENABLE_VENDOR_S2S || "true").toLowerCase() === "true";
// ---------------------------------------------------------

if (process.env.SHEETS_WEBHOOK) {
  fetch(process.env.SHEETS_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status,
      rid,
      src,
      user_agent: req.headers["user-agent"] || ""
    })
  }).catch(() => {});
}

// Map the three statuses to your client final URLs
const CLIENT_URLS = {
  complete:  CLIENT_COMPLETE_URL,
  terminate: CLIENT_TERMINATE_URL,
  quota:     CLIENT_QUOTA_URL,
};

// Map vendor keys to their postback templates (server-to-server, never exposed)
const VENDOR_TEMPLATES = {
  // Global Opinion MR (GOMR)
  // Uses GET and expects: pid, uid
  gomr: {
    complete:  `${GOMR_BASE}/complete?pid={pid}&uid={uid}`,
    terminate: `${GOMR_BASE}/terminate?pid={pid}&uid={uid}`,
    quota:     `${GOMR_BASE}/quotafull?pid={pid}&uid={uid}`,
    pid:       () => GOMR_PID,     // function in case you later swap to per-project lookup
  },

  // You can add more vendors here in future, e.g.:
  // acme: {
  //   complete: "https://acme.com/postback?token=XYZ&status=complete&uid={uid}",
  //   terminate:"https://acme.com/postback?token=XYZ&status=terminate&uid={uid}",
  //   quota:    "https://acme.com/postback?token=XYZ&status=quota&uid={uid}",
  //   pid:      () => "", // not used for this vendor
  // },
};

export default async function handler(req, res) {
  const statusRaw = String(req.query.status || "").toLowerCase();
  const status = normalizeStatus(statusRaw); // c/t/q -> complete/terminate/quota

  const rid = String(req.query.rid || "");  // respondent id
  const src = String(req.query.src || "");  // vendor key, e.g. 'gomr'

  const clientBase = CLIENT_URLS[status];

  if (!clientBase) {
    return res.status(404).send("Unknown status");
  }
  if (!rid) {
    // We strongly prefer RID present to reconcile; still redirect if needed, but warn in logs
    console.warn(`[redirect] missing rid for status=${status} src=${src}`);
  }

  // --------- 1) Log to Vercel (internal only) ----------
  console.log(`[redirect] status=${status} rid=${rid} src=${src} ua=${req.headers["user-agent"] || ""}`);

  // --------- 2) Optional GA4 event (fire-and-forget) ----
  if (GA4_MEASUREMENT_ID && GA4_API_SECRET) {
    fireGA4({ status, rid, src }).catch(() => {});
  }

  // --------- 3) Vendor S2S Postback (never exposed) -----
  // We do this server-side so the vendor URL is not visible to the browser.
  if (ENABLE_VENDOR_S2S && src) {
    notifyVendor({ src, status, rid }).catch(() => {});
  }

  // --------- 4) Build client redirect (whitelist params) -
  const forward = new URL(clientBase);
  if (rid) forward.searchParams.set("rid", rid);

  // Optional: add signature for client verification
  if (SIGNING_SECRET && rid) {
    forward.searchParams.set("sig", sign(SIGNING_SECRET, rid));
  }

  // --------- 5) Redirect respondent to client -----------
  res.setHeader("Location", forward.toString());
  res.status(302).end();
}

// ----------------- Helpers -----------------

function normalizeStatus(s) {
  if (s === "c" || s === "complete") return "complete";
  if (s === "t" || s === "terminate") return "terminate";
  if (s === "q" || s === "quota" || s === "quotafull") return "quota";
  return "unknown";
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function fireGA4({ status, rid, src }) {
  const body = {
    client_id: rid || randomId(),
    events: [{
      name: "survey_redirect",
      params: { status, rid, src }
    }]
  };
  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

function randomId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

// Fire-and-forget vendor S2S postback with short timeout
async function notifyVendor({ src, status, rid }) {
  const v = VENDOR_TEMPLATES[src];
  if (!v || !rid) return;

  const template = v[status];
  if (!template) return;

  // Some vendors need pid; for GOMR it's required
  const pid = typeof v.pid === "function" ? v.pid() : v.pid;
  const url = template
    .replace("{pid}", encodeURIComponent(String(pid || "")))
    .replace("{uid}", encodeURIComponent(rid));

  if (!url) return;

  // Short timeout so we never block the user redirect
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900); // 900ms cap

  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    console.log(`[vendor-s2s] ok src=${src} status=${status} rid=${rid}`);
  } catch (e) {
    console.warn(`[vendor-s2s] failed src=${src} status=${status} rid=${rid} err=${e?.name || e}`);
  } finally {
    clearTimeout(timeout);
  }
}
