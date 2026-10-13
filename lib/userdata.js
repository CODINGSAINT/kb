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
const LIBRARY = path.join(DATA_DIR, "library");   // topics you generate with `kb add`
const library = require("./library");
const IMAGES = path.join(DATA_DIR, "images");

const README = require("./core/shared").DATA_README;

function ensureDir() {
  if (!fs.existsSync(PROGRESS)) fs.mkdirSync(PROGRESS, { recursive: true });
  const rd = path.join(DATA_DIR, "README.md");
  if (!fs.existsSync(rd)) fs.writeFileSync(rd, README);
}
function ensureImages() { ensureDir(); if (!fs.existsSync(IMAGES)) fs.mkdirSync(IMAGES, { recursive: true }); }

const core = require("./core/shared");
const { FIELDS } = core;

// The items of a content file, each with the id of its progress file (see lib/core/shared.js).
const itemsOf = (file, doc) => core.itemsOf(core.kindOf(path.basename(file)), doc);
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
  // Your own libraries (kb add) join the fundamentals as extra groups.
  if (path.basename(file) === "fundamentals.json" && Array.isArray(doc.groups) && !doc.groups.some((g) => g.library)) {
    doc.groups.push(...library.groups(LIBRARY, core.lastNumber(doc.groups)));
  }
  // Nothing saved for an item: keep whatever the content file has (normally empty).
  return core.applyProgress(core.kindOf(path.basename(file)), doc, readProgress);
}

// doc with your work -> content-only copy; your work goes to the data folder.
// Returns the copy to write to content/. Progress files are only rewritten when they change.
function split(file, doc) {
  const { pub, records } = core.splitProgress(core.kindOf(path.basename(file)), doc);
  for (const [id, rec] of records) {
    const f = progressFile(id);
    if (!rec) { if (fs.existsSync(f)) fs.unlinkSync(f); continue; }
    const text = core.progressText(rec);
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
  return itemsOf(file, doc).some(([, it]) => FIELDS.some((k) => !core.isEmpty(it[k])));
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

module.exports = { DATA_DIR, PROGRESS, IMAGES, LIBRARY, FIELDS, where, overlay, split, hasLegacy, hasPersonalKeys, stats, clearAll, ensureDir, ensureImages, itemsOf };
