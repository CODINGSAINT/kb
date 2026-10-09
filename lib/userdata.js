// Your own work lives outside the repo, in a data folder you can keep private.
//
//   content/   shared material: topics, write-ups, DSA lists, fundamentals (committed to the public repo)
//   kb-data/   your answers, verdicts, notes, tutor chats, read status and answer images (yours only)
//
// Location, first match wins:
//   1. KB_DATA environment variable
//   2. "dataDir" in kb.config.json
//   3. ../kb-data  (a folder next to this repo)
// Relative paths are resolved from the repo folder. The folder can be its own private git repo.
//
// Layout:
//   kb-data/progress/lld-02.json            one small file per item you've touched
//   kb-data/progress/dsa-two-sum.json
//   kb-data/progress/read-hld-caching.json
//   kb-data/images/<hash>.png              images pasted into answers
//
// How it plugs in: store.readJson() overlays these files on the content JSON, and store.writeJson()
// splits them back out, so content/ never receives personal data.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIELDS = ["userAnswer", "answerEvaluation", "answerEvaluatedAt", "notes", "chat", "readAt"];

function configuredDir() {
  if (process.env.KB_DATA) return { dir: process.env.KB_DATA, from: "KB_DATA environment variable" };
  try {
    const f = path.join(ROOT, "kb.config.json");
    if (fs.existsSync(f)) {
      const c = JSON.parse(fs.readFileSync(f, "utf8"));
      if (c.dataDir) return { dir: c.dataDir, from: "kb.config.json (dataDir)" };
    }
  } catch (e) { /* ai.js reports a broken config */ }
  return { dir: path.join("..", "kb-data"), from: "default (next to the repo)" };
}
const where = configuredDir();
const DATA_DIR = path.resolve(ROOT, where.dir);
const PROGRESS = path.join(DATA_DIR, "progress");
const IMAGES = path.join(DATA_DIR, "images");

const README = `# KB data

Your personal study data for KB: answers, AI verdicts, notes, tutor conversations,
read status and the images in your answers. The KB app reads and writes this folder.

- One file per topic/problem/article you've worked on, in \`progress/\`.
- Images pasted into answers, in \`images/\`.

Keep it private. To back it up or sync it between computers, make this folder its own
private git repository:

    git init
    git add .
    git commit -m "KB progress"
    git remote add origin https://github.com/<you>/kb-data.git   # a PRIVATE repo
    git push -u origin main

To use a different location, set "dataDir" in kb.config.json or the KB_DATA environment variable.
`;

function ensureDir() {
  if (!fs.existsSync(PROGRESS)) fs.mkdirSync(PROGRESS, { recursive: true });
  const rd = path.join(DATA_DIR, "README.md");
  if (!fs.existsSync(rd)) fs.writeFileSync(rd, README);
}
function ensureImages() { ensureDir(); if (!fs.existsSync(IMAGES)) fs.mkdirSync(IMAGES, { recursive: true }); }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The items of a content file, each with the id of its progress file.
function itemsOf(file, doc) {
  const base = path.basename(file);
  const out = [];
  if (/^day-\d+\.json$/.test(base)) {
    for (const t of doc.topics || []) if (t.category && t.number != null) out.push([`${slug(t.category)}-${String(t.number).padStart(2, "0")}`, t]);
  } else if (base === "dsa.json") {
    for (const tp of doc.topics || []) for (const p of tp.problems || []) if (p.key) out.push([`dsa-${slug(p.key)}`, p]);
  } else if (base === "fundamentals.json") {
    for (const g of doc.groups || []) for (const it of g.items || []) if (it.id) out.push([`read-${slug(it.id)}`, it]);
  }
  return out;
}
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const progressFile = (id) => path.join(PROGRESS, id + ".json");

function readProgress(id) {
  const f = progressFile(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {
    throw new Error(`${f} is not valid JSON (${e.message}). Fix or delete that file.`);
  }
}

// content doc -> doc with your saved work filled in (mutates and returns doc)
function overlay(file, doc) {
  for (const [id, item] of itemsOf(file, doc)) {
    const p = readProgress(id);
    if (!p) continue; // nothing saved: keep whatever the content file has (normally empty)
    for (const k of FIELDS) if (k in p) item[k] = p[k];
  }
  return doc;
}

// doc with your work -> content-only copy; your work goes to the data folder.
// Returns the copy to write to content/. Progress files are only rewritten when they change.
function split(file, doc) {
  const items = itemsOf(file, doc);
  if (!items.length) return doc;
  const pub = JSON.parse(JSON.stringify(doc));
  const pubItems = new Map(itemsOf(file, pub));
  for (const [id, item] of items) {
    const mine = {};
    for (const k of FIELDS) if (!isEmpty(item[k])) mine[k] = item[k];
    const target = pubItems.get(id);
    for (const k of FIELDS) delete target[k];
    const f = progressFile(id);
    if (!Object.keys(mine).length) { if (fs.existsSync(f)) fs.unlinkSync(f); continue; }
    const text = JSON.stringify({ id, title: item.title || "", ...mine }, null, 2) + "\n";
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8") === text) continue;
    ensureDir();
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, f);
  }
  return pub;
}

// Does a content file still hold personal data (from before the data folder existed)?
function hasLegacy(file, doc) {
  return itemsOf(file, doc).some(([, it]) => FIELDS.some((k) => !isEmpty(it[k])));
}
// Does it still carry personal fields at all, even empty placeholders ("userAnswer": "")?
function hasPersonalKeys(file, doc) {
  return itemsOf(file, doc).some(([, it]) => FIELDS.some((k) => k in it));
}

function stats() {
  const files = fs.existsSync(PROGRESS) ? fs.readdirSync(PROGRESS).filter((f) => f.endsWith(".json")) : [];
  const images = fs.existsSync(IMAGES) ? fs.readdirSync(IMAGES).length : 0;
  return { dir: DATA_DIR, from: where.from, exists: fs.existsSync(DATA_DIR), items: files.length, images,
    git: fs.existsSync(path.join(DATA_DIR, ".git")) };
}

// kb reset: remove every progress file (images are kept unless asked).
function clearAll({ images = false } = {}) {
  let n = 0;
  if (fs.existsSync(PROGRESS)) for (const f of fs.readdirSync(PROGRESS)) if (f.endsWith(".json")) { fs.unlinkSync(path.join(PROGRESS, f)); n++; }
  if (images && fs.existsSync(IMAGES)) for (const f of fs.readdirSync(IMAGES)) fs.unlinkSync(path.join(IMAGES, f));
  return n;
}

module.exports = { DATA_DIR, PROGRESS, IMAGES, FIELDS, where, overlay, split, hasLegacy, hasPersonalKeys, stats, clearAll, ensureDir, ensureImages, itemsOf };
