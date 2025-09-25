// api/start.js
function genNumericRid() {
  // 12-digit numeric ID (timestamp + random)
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(Math.random() * 1e4).toString().padStart(4, "0");
  return ts + rnd; // e.g. 84736251 0421 => "847362510421"
}

const CELL_STARTS = {
  "uae-main-ar":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MTMtNTQ4NTI=&pid=",
  "uae-boost-ar":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjAtNTQ4NDU=&pid=",
  "uae-boost-en":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjctNTQ4Mzg=&pid=",
  "uae-main-en":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MzQtNTQ4MzE=&pid=",
};

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || "";
const PROJECT_NAME = process.env.PROJECT_NAME || "UAE_10N_Pilot";

export default async function handler(req, res) {
  const src  = String(req.query.src || "unknown");
  const cell = String(req.query.cell || "").toLowerCase();

  const base = CELL_STARTS[cell];
  if (!base) {
    res.status(400).send("Unknown cell. Use one of: " + Object.keys(CELL_STARTS).join(", "));
    return;
  }

  // 1) Generate a SIMPLE NUMERIC pid
  const rid = genNumericRid();

  // 2) Log entry (optional)
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

  // 3) Forward to client with ONLY pid=<rid>
  const forwardUrl = base + encodeURIComponent(rid);
  res.setHeader("Location", forwardUrl);
  res.status(302).end();
}
