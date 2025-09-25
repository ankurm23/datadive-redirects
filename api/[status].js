import crypto from "crypto";

// ---------------------------------------------
// CONFIG (via Environment Variables in Vercel)
// ---------------------------------------------
const CLIENT_COMPLETE_URL  = process.env.CLIENT_COMPLETE_URL;
const CLIENT_TERMINATE_URL = process.env.CLIENT_TERMINATE_URL;
const CLIENT_QUOTA_URL     = process.env.CLIENT_QUOTA_URL;

const SIGNING_SECRET       = process.env.SIGNING_SECRET || "";
const GA4_MEASUREMENT_ID   = process.env.GA4_MEASUREMENT_ID || "";
const GA4_API_SECRET       = process.env.GA4_API_SECRET || "";
const SHEETS_WEBHOOK       = process.env.SHEETS_WEBHOOK || "";

const GOMR_PID             = process.env.GOMR_PID || "";
const GOMR_BASE            = process.env.GOMR_BASE || "https://globalopinionmr.com/admintool";
const ENABLE_VENDOR_S2S    = (process.env.ENABLE_VENDOR_S2S || "true").toLowerCase() === "true";

// ---------------------------------------------------------

// Map the three statuses to your client final URLs
const CLIENT_URLS = {
  complete:  CLIENT_COMPLETE_URL,
  terminate: CLIENT_TERMINATE_URL,
  quota:     CLIENT_QUOTA_URL,
};

// Vendor templates
const VENDOR_TEMPLATES = {
  gomr: {
    complete:  `${GOMR_BASE}/complete?pid={pid}&uid={uid}`,
    terminate: `${GOMR_BASE}/terminate?pid={pid}&uid={uid}`,
    quota:     `${GOMR_BASE}/quotafull?pid={pid}&uid={uid}`,
    pid:       () => GOMR_PID,
  },
};

export default async function handler(req, res) {
  const statusRaw = String(req.query.status || "").toLowerCase();
  const status = normalizeStatus(statusRaw);

  const rid = String(
    req.query.rid ||
    req.query.pid ||
    req.query.uid ||
    req.query.respondentid ||
    req.query.user_id ||
    req.query.ddid ||
    ""
  );

  const src = String(req.query.src || "");  

  const clientBase = CLIENT_URLS[status];
  if (!clientBase) return res.status(404).send("Unknown status");

  if (!rid) {
    console.warn(`[redirect] missing rid for status=${status} src=${src}`);
  }

  const ua = req.headers["user-agent"] || "";
  console.log(`[redirect] status=${status} rid=${rid} src=${src} ua=${ua}`);

  // GA4
  if (GA4_MEASUREMENT_ID && GA4_API_SECRET) {
    fireGA4({ status, rid, src }).catch(() => {});
  }

  // Google Sheets logging
  if (SHEETS_WEBHOOK) {
    fetch(SHEETS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, rid, src, user_agent: ua }),
    }).catch(() => {});
  }

  // Vendor S2S
  if (ENABLE_VENDOR_S2S && src) {
    notifyVendor({ src, status, rid }).catch(() => {});
  }

  // Build client redirect
  const forward = new URL(clientBase);
  const idParam = process.env.FORWARD_ID_PARAM || "rid";
  if (rid) forward.searchParams.set(idParam, rid);

  if (SIGNING_SECRET && rid) {
    forward.searchParams.set("sig", sign(SIGNING_SECRET, rid));
  }

  res.setHeader("Location", forward.toString());
  res.status(302).end();
}

// ----------------- Helpers -----------------
function normalizeStatus(s = "") {
  s = s.toLowerCase();
  if (s === "c" || s.includes("complete")) return "complete";
  if (s === "t" || s.includes("terminate") || s.includes("term")) return "terminate";
  if (s === "q" || s.includes("quota") || s.includes("qf") || s.includes("overquota")) return "quota";
  return "unknown";
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function fireGA4({ status, rid, src }) {
  const body = {
    client_id: rid || randomId(),
    events: [{ name: "survey_redirect", params: { status, rid, src } }]
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
  const timeout = setTimeout(() => controller.abort(), 900);

  try {
    await fetch(url, { method: "GET", signal: controller.signal });
    console.log(`[vendor-s2s] ok src=${src} status=${status} rid=${rid}`);
  } catch (e) {
    console.warn(`[vendor-s2s] failed src=${src} status=${status} rid=${rid} err=${e?.name || e}`);
  } finally {
    clearTimeout(timeout);
  }
}
