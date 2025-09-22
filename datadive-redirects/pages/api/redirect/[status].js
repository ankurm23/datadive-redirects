import crypto from "crypto";

// Next.js API Route on Vercel (Node.js runtime)
// Vendors will use links like:
//   https://r.datadive.in/c?rid={RID}&src={VENDOR}
//   https://r.datadive.in/t?rid={RID}&src={VENDOR}
//   https://r.datadive.in/q?rid={RID}&src={VENDOR}
// Only whitelisted params (e.g., rid) are forwarded to the client.

export default async function handler(req, res) {
  const statusRaw = String(req.query.status || "").toLowerCase();
  const { rid = "", src = "" } = req.query;

  // Normalize shorthand (c/t/q) into full names
  const status = normalizeStatus(statusRaw);

  // Map statuses to your client redirect URLs (set via Vercel env vars)
  const map = {
    complete: process.env.CLIENT_COMPLETE_URL,
    terminate: process.env.CLIENT_TERMINATE_URL,
    quota: process.env.CLIENT_QUOTA_URL,
  };

  const base = map[status];
  if (!base) {
    res.status(404).send("Unknown status");
    return;
  }

  // ---- Log to Vercel console (for debugging / audits) ----
  console.log(
    `[redirect] status=${status} rid=${rid} src=${src} ua=${req.headers["user-agent"] || ""}`
  );

  // ---- Optional: send GA4 event (if env vars set) ----
  if (process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET) {
    const gaBody = {
      client_id: rid || randomId(),
      events: [
        {
          name: "survey_redirect",
          params: { status, rid, src },
        },
      ],
    };

    fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gaBody),
      }
    ).catch(() => {});
  }

  // ---- Build the forward URL for client ----
  const forward = new URL(base);

  // Forward only whitelisted params (never send src/vendor info!)
  if (rid) forward.searchParams.set("rid", String(rid));

  // Optional: add UID mapping (if client uses different ID system)
  // forward.searchParams.set("uid", mapRidToUid(rid));

  // Optional: add HMAC signature for client verification
  if (process.env.SIGNING_SECRET && rid) {
    const sig = sign(process.env.SIGNING_SECRET, String(rid));
    forward.searchParams.set("sig", sig);
  }

  // ---- Redirect ----
  res.setHeader("Location", forward.toString());
  res.status(302).end();
}

// ----------------- Helpers -----------------

function normalizeStatus(s) {
  if (s === "c" || s === "complete") return "complete";
  if (s === "t" || s === "terminate") return "terminate";
  if (s === "q" || s === "quota") return "quota";
  return "unknown";
}

function randomId() {
  return (
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  );
}

function sign(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

// Example placeholder if you want to map vendor RID → client UID
// function mapRidToUid(rid) {
//   return rid; // replace with your own lookup/mapping logic
// }
