import crypto from "crypto";

// =========================
// ENV CONFIG (Vercel)
// =========================
const CLIENT_COMPLETE_URL  = process.env.CLIENT_COMPLETE_URL || "";
const CLIENT_TERMINATE_URL = process.env.CLIENT_TERMINATE_URL || "";
const CLIENT_QUOTA_URL     = process.env.CLIENT_QUOTA_URL || "";

const FORWARD_ID_PARAM     = process.env.FORWARD_ID_PARAM || "rid"; // e.g. "uid" for GOMR

const SIGNING_SECRET       = process.env.SIGNING_SECRET || "";

const GA4_MEASUREMENT_ID   = process.env.GA4_MEASUREMENT_ID || "";
const GA4_API_SECRET       = process.env.GA4_API_SECRET || "";

const SHEETS_WEBHOOK       = process.env.SHEETS_WEBHOOK || "";

// ---- Vendor S2S (optional) ----
const ENABLE_VENDOR_S2S    = (process.env.ENABLE_VENDOR_S2S || "false").toLowerCase() === "true";
const GOMR_PID             = process.env.GOMR_PID || "GOMR(PO)";
const GOMR_BASE            = process.env.GOMR_BASE || "https://globalopinionmr.com/admintool";

// Map final URLs by status (these may be vendor pages in Option B)
const CLIENT_URLS = {
  complete:  CLIENT_COMPLETE_URL,
  terminate: CLIENT_TERMINATE_URL,
  quota:     CLIENT_QUOTA_URL,
};

// Vendor postback templates (used only if ENABLE_VENDOR_S2S=true)
const VENDOR_TEMPLATES = {
  gomr: {
    complete:  `${GOMR_BASE}/complete?pid={pid}&uid={uid}`,
    terminate: `${GOMR_BASE}/terminate?pid={pid}&uid={uid}`,
    quota:     `${GOMR_BASE}/quotafull?pid={pid}&uid={uid}`,
    pid:       () => GOMR_PID,
  },
};

export default async function handler(req, res) {
  const status = normalizeStatus(String(req.query.status || ""));
  const rid    = String(req.query.rid || "");        // respondent id we got back from client
  const src    = String(req.query.src || "");        // vendor key (e.g., "gomr")
  const ua     = req.headers["user-agent"] || "";

  if (!status) {
    return res.status(400).send("Bad request: unknown status");
  }
  const clientBase = CLIENT_URLS[status];
  if (!clientBase) {
    console.error(`[redirect] missing CLIENT_URL for status=${status}`);
    return res.status(500).send("Server misconfiguration for status");
  }

  // 1) Log basics
  console.log(`[redirect] status=${status} rid=${rid || "(none)"} src=${src} ua=${ua}`);

  // 2) GA4 (fire-and-forget)
  if (GA4_MEASUREMENT_ID && GA4_API_SECRET) {
    fireGA4({ status, rid, src }).catch(() => {});
  }

  // 3) Google Sheets logging (fire-and-forget)
  if (SHEETS_WEBHOOK) {
    fetch(SHEETS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, rid, src, user_agent: ua }),
    }).catch(() => {});
  }

  // 4) Optional vendor S2S (keep OFF for Option B)
  if (ENABLE_VENDOR_S2S && src && rid) {
    notifyVendor({ src, status, rid }).catch(() => {});
  }

  // 5) Build the final redirect
  let forward;
  try {
    forward = new URL(clientBase);
  } catch {
    console.error(`[redirect] invalid CLIENT_URL for ${status}: ${clientBase}`);
    return res.status(500).send("Invalid redirect URL");
  }

  if (rid) forward.searchParams.set(FORWARD_ID_PARAM, rid); // e.g., &uid=<rid> for GOMR
  if (SIGNING_SECRET && rid) forward.searchParams.set("sig", sign(SIGNING_SECRET, rid));

  // 6) Go!
  res.setHeader("Location", forward.toString());
  res.status(302).end();
}

// ----------------- Helpers -----------------

function normalizeStatus(s) {
  const v = s.toLowerCase();
  if (v === "c" || v === "complete")   return "complete";
  if (v === "t" || v === "terminate")  return "terminate";
  if (v === "q" || v === "quota" || v === "quotafull") return "quota";
  return "";
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function fireGA4({ status, rid, src }) {
  const body = {
    client_id: rid || randomId(),
    events: [{ name: "survey_redirect", params: { status, rid, src } }],
  };
  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

function randomId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

async function notifyVendor({ src, status, rid }) {
  const v = VENDOR_TEMPLATES[src];
  if (!v || !rid) return;

  const template = v[status];
  if (!template) return;

  const pid = typeof v.pid === "function" ? v.pid() : v.pid;
  const url = template
    .replace("{pid}", encodeURIComponent(String(pid || "")))
    .replace("{uid}", encodeURIComponent(rid));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900); // don’t block user

  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    console.log(`[vendor-s2s] ok src=${src} status=${status} rid=${rid}`);
  } catch (e) {
    console.warn(`[vendor-s2s] failed src=${src} status=${status} rid=${rid} err=${e?.name || e}`);
  } finally {
    clearTimeout(timeout);
  }
}
