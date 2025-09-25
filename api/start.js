// api/start.js
function genRid() {
  return (
    "RID-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

// Client’s start links exactly as provided (keep pid=XXX)
const CELL_STARTS = {
  "uae-main-ar":  "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MTMtNTQ4NTI=&pid=XXX",
  "uae-boost-ar": "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjAtNTQ4NDU=&pid=XXX",
  "uae-boost-en": "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjctNTQ4Mzg=&pid=XXX",
  "uae-main-en":  "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MzQtNTQ4MzE=&pid=XXX",
};

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || "";
const PROJECT_NAME   = process.env.PROJECT_NAME || "UAE_10N_Pilot";

export default async function handler(req, res) {
  const src  = String(req.query.src || "unknown");
  const cell = String(req.query.cell || "").toLowerCase();

  const base = CELL_STARTS[cell];
  if (!base) {
    res.status(400).send("Unknown cell. Use one of: " + Object.keys(CELL_STARTS).join(", "));
    return;
  }

  // Generate your tracking RID
  const rid = genRid();

  // Log entry (optional)
  if (SHEETS_WEBHOOK) {
    fetch(SHEETS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: PROJECT_NAME,
        status: "entry",
        rid,
        src,
        cell,
        user_agent: req.headers["user-agent"] || "",
      }),
    }).catch(() => {});
  }

  // Forward with pid replaced by RID
  const forwardUrl = base.replace("pid=XXX", "pid=" + encodeURIComponent(rid));

  res.setHeader("Location", forwardUrl);
  res.status(302).end();
}
