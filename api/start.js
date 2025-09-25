// api/start.js

function genRid() {
  return (
    "RID-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Client start links by cell.
 * Keep the exact URLs clients gave you, leaving pid=XXX or pid=XXXXX as placeholder.
 */
const CELL_STARTS = {
  // ---- NEW PROJECT: Riva Research ----
  "riva-main":
    "https://rivaresearch.surveybackoffice.com/capture.php?gid=MTI5OTktMjYyMTU%3D&cada=MTE1MTUtY21sMllYSmxjMlZoY21Obw%3D%3D&pid=XXXXX",

  // ---- EXISTING PROJECT: Worldwide Research (STILL LIVE) ----
  // (use the real links you used earlier)
  "uae-main-ar":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MTMtNTQ4NTI=&pid=XXX",
  "uae-boost-ar":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjAtNTQ4NDU=&pid=XXX",
  "uae-boost-en":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MjctNTQ4Mzg=&pid=XXX",
  "uae-main-en":
    "https://app.worldwide-research.ai/surveyInitiate.php?gid=MTA5MzQtNTQ4MzE=&pid=XXX",
};

/**
 * Optional: project labels per cell for cleaner logging.
 * If a cell isn’t listed here, we’ll fall back to PROJECT_NAME env or "Default_Project".
 */
const CELL_PROJECT = {
  "riva-main": "Riva_Study",
  "uae-main-ar": "UAE_WWR",
  "uae-boost-ar": "UAE_WWR",
  "uae-boost-en": "UAE_WWR",
  "uae-main-en": "UAE_WWR",
};

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || ""; // Google Apps Script (optional)
const DEFAULT_PROJECT_NAME = process.env.PROJECT_NAME || "Default_Project"; // fallback label

export default async function handler(req, res) {
  const src  = String(req.query.src || "unknown").toLowerCase(); // e.g. 'qlab', 'gomr'
  const cell = String(req.query.cell || "").toLowerCase();

  const base = CELL_STARTS[cell];
  if (!base) {
    res.status(400).send(
      "Unknown cell. Use one of: " + Object.keys(CELL_STARTS).join(", ")
    );
    return;
  }

  // 1) Generate your tracking respondent ID
  const rid = genRid();

  // 2) Optional: log "entry" to Google Sheets
  if (SHEETS_WEBHOOK) {
    const project = CELL_PROJECT[cell] || DEFAULT_PROJECT_NAME;
    fetch(SHEETS_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project,
        status: "entry",
        rid,
        src,
        cell,
        user_agent: req.headers["user-agent"] || "",
      }),
    }).catch(() => {});
  }

  // 3) Build client start URL safely
  //    - Replace pid=XXXXX or pid=XXX with our RID
  //    - Also set uid=<RID> (some clients return uid)
  //    - Keep src so your exits know which vendor to credit
  const replaced = base
    .replace("pid=XXXXX", "pid=" + encodeURIComponent(rid))
    .replace("pid=XXX",   "pid=" + encodeURIComponent(rid));

  let u;
  try {
    u = new URL(replaced);
  } catch {
    res.status(500).send("Invalid client start URL for this cell");
    return;
  }

  u.searchParams.set("uid", rid);
  u.searchParams.set("src", src);

  // 4) Send respondent into the client survey
  res.setHeader("Location", u.toString());
  res.status(302).end();
}
