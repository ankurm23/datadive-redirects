// api/start.js

function genRid() {
  return (
    "RID-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

// ---- Client survey start links ----
// Keep pid=XXXXX placeholder exactly as given by client
const CELL_STARTS = {
  "riva-main":
    "https://rivaresearch.surveybackoffice.com/capture.php?gid=MTI5OTktMjYyMTU%3D&cada=MTE1MTUtY21sMllYSmxjMlZoY21Obw%3D%3D&pid=XXXXX",
};

const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || "";
const PROJECT_NAME = process.env.PROJECT_NAME || "Default_Project";

export default async function handler(req, res) {
  try {
    const src = String(req.query.src || "unknown").toLowerCase();
    const cell = String(req.query.cell || "").toLowerCase();

    const base = CELL_STARTS[cell];
    if (!base) {
      res
        .status(400)
        .send("Unknown cell. Use one of: " + Object.keys(CELL_STARTS).join(", "));
      return;
    }

    // Generate tracking RID
    const rid = genRid();

    // Optional logging to Google Sheets
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

    // Build client start URL
    let replaced = base;
    if (replaced.includes("pid=XXXXX")) {
      replaced = replaced.replace("pid=XXXXX", "pid=" + encodeURIComponent(rid));
    } else if (replaced.includes("pid=XXX")) {
      replaced = replaced.replace("pid=XXX", "pid=" + encodeURIComponent(rid));
    }

    const u = new URL(replaced);
    u.searchParams.set("uid", rid);
    u.searchParams.set("src", src);

    res.setHeader("Location", u.toString());
    res.status(302).end();
  } catch (err) {
    console.error("Error in start.js", err);
    res.status(500).send("Server error: " + (err.message || err));
  }
}
