import crypto from "crypto";

// =========================
// ENV CONFIG (set in Vercel)
// =========================
const CLIENT_COMPLETE_URL  = process.env.CLIENT_COMPLETE_URL || "";
const CLIENT_TERMINATE_URL = process.env.CLIENT_TERMINATE_URL || "";
const CLIENT_QUOTA_URL     = process.env.CLIENT_QUOTA_URL || "";

const SIGNING_SECRET       = process.env.SIGNING_SECRET || "";

const GA4_MEASUREMENT_ID   = process.env.GA4_MEASUREMENT_ID || "";
const GA4_API_SECRET       = process.env.GA4_API_SECRET || "";

const SHEETS_WEBHOOK       = process.env.SHEETS_WEBHOOK || "";

// --- Vendor specific config ---
const GOMR_PID             = process.env.GOMR_PID || "GOMRDD001";
const GOMR_BASE            = process.env.GOMR_BASE || "https://globalopinionmr.com/admintool";

const QLAB_CREFERENCE      = process.env.QLAB_CREFERENCE || ""; // e.g. TWpZMUl5TkVSRWs9

// =========================
// Vendor Templates
// =========================
const VENDOR_TEMPLATES = {
  // Global Opinion MR
  gomr: {
    complete:  `${GOMR_BASE}/complete?pid={pid}&uid={uid}`,
    terminate: `${GOMR_BASE}/terminate?pid={pid}&uid={uid}`,
    quota:     `${GOMR_BASE}/quotafull?pid={pid}&uid={uid}`,
    pid:       () => GOMR_PID,
  },

  // QuestionLab
  qlab: {
    _base: "https://vault.questionlab.com/audience/passback",
    _cref: QLAB_CREFERENCE,
    build(status, uid) {
      const map = { complete: 1, terminate: 2, quota: 3, quality: 4 };
      const s = map[status];
      if (!s) return "";
      const u = new URL(this._base);
      u.searchParams.set("creference", this._cref);
      u.searchParams.set("status", String(s));
      u.searchParams.set("arid", uid || "");
      return u.toString();
    }
  }
};

// =========================
// Main Handler
// =========================
export default async function handler(req, res) {
  const status = normalizeStatus(String(req.query.status || ""));
  const rid    = String(req.query.rid || "");  // respondent id
  const src    = String(req.query.src || "");  // vendor key (gomr, qlab, etc.)
  const ua     = req.headers["user-agent"] || "";

  if (!status) {
    return res.status(400).send("Bad request: unknown status");
  }

  // 1) Log basics
  console.log(`[redirect] status=${status} rid=${rid || "(none)"} src=${src} ua=${ua}`);

  // 2) GA4 logging
  if (GA4_MEASUREMENT_ID && GA4_API_SECRET) {
    fireGA4({ status, rid, src }).catch(() => {});
  }

  // 3) Google Sheets logging
  if (SHEETS_WEBHOOK) {
    fetch(SHEETS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, rid, src, user_agent: ua })
    }).catch(() => {});
  }

  // 4) Build final forward URL
  let forwardStr = "";

  if (src === "gomr") {
    // --- GOMR vendor
    const pid = typeof VENDOR_TEMPLATES.gomr.pid === "function"
      ? VENDOR_TEMPLATES.gomr.pid() : VENDOR_TEMPLATES.gomr.pid;
    const tmpl = VENDOR_TEMPLATES.gomr[status];
    if (tmpl) {
      forwardStr = tmpl
        .replace("{pid}", encodeURIComponent(String(pid || "")))
        .replace("{uid}", encodeURIComponent(rid || ""));
    }
  } else if (src === "qlab") {
    // --- QuestionLab vendor
    forwardStr = VENDOR_TEMPLATES.qlab.build(status, rid);
  } else {
    // --- Default: client URLs
    forwardStr = CLIENT_URLS[status];
  }

  if (!forwardStr) {
    console.error(`[redirect] no forward url built for status=${status}, src=${src}`);
    return res.status(500).send("No redirect configured");
  }

  let forward;
  try {
    forward = new URL(forwardStr);
  } catch {
    console.error(`[redirect] invalid forward url: ${forwardStr}`);
    return res.status(500).send("Invalid redirect URL");
  }

  // Optional: signature (only for client URLs)
  if (!src && SIGNING_SECRET && rid) {
    forward.searchParams.set("sig", sign(SIGNING_SECRET, rid));
  }

  // 5) Redirect
  res.setHeader("Location", forward.toString());
  res.status(302).end();
}

// =========================
// Helpers
// =========================
function normalizeStatus(s) {
  const v = s.toLowerCase();
  if (v === "c" || v === "complete") return "complete";
  if (v === "t" || v === "terminate") return "terminate";
  if (v === "q" || v === "quota" || v === "quotafull") return "quota";
  if (v === "bad" || v === "quality" || v === "dq" || v === "fraud") return "quality";
  return "";
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
