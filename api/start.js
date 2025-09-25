// api/start.js
function genRid() {
  return (
    "RID-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

// Map your 4 cells to the client start links (ending with &pid=)
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
  const src = String(req.query.src || "unknown"); // vendor key (e.g., gomr)
  const cell = String(req.query.cell || "").toLowerCase();

  const base = CELL_STARTS[cell];
  if (!base) {
    res
      .status(400)
      .send("Unknown cell. Use one of: " + Object.keys(CELL_STARTS).join(", "));
    return;
  }

  // 1) Generate your respondent id
  const rid = genRid();

  // 2) Log entry to Google Sheets (optional)
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

  // 3) Forward into client's start link with pid=<RID>
  // If you also want to pass the RID as uid (not required), you can append &uid=<RID>.
  const u = new URL(base + encodeURIComponent(rid));
  u.searchParams.set("uid", rid);
  const forwardUrl = u.toString();

  res.setHeader("Location", forwardUrl);
  res.status(302).end();
}
