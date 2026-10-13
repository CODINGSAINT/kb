// Data layer shared by the server and the `kb` CLI.
// Shared material is flat JSON in ./content. Your own work (answers, verdicts, notes, chats,
// read status) lives in the data folder (see lib/userdata.js): readJson() merges it in and
// writeJson() splits it back out, so content/ stays free of personal data.
// Every read goes to disk, and every write re-reads the file first, so the CLI and the site
// can edit side by side.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const DSA_FILE = path.join(CONTENT, "dsa.json");
const FUND_FILE = path.join(CONTENT, "fundamentals.json");
const TRACKS = ["LLD", "HLD", "AI", "DSA", "READ"];

const userdata = require("./userdata");

const readRaw = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const readJson = (f) => userdata.overlay(f, readRaw(f));
function writeRaw(f, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  if (fs.existsSync(f) && fs.readFileSync(f, "utf8") === text) return; // unchanged: keep git quiet
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f); // atomic replace
}
// Personal fields go to the data folder; the content file gets the rest.
const writeJson = (f, data) => writeRaw(f, userdata.split(f, data));

// One-time move: content files from before the data folder existed still hold answers, verdicts,
// notes and chats. Copy them into the data folder and strip them from content/. A backup of each
// changed content file goes to content/backups/ (git-ignored) first. Returns the files moved.
function migrateLegacy() {
  const files = [...dayFiles(), DSA_FILE, FUND_FILE].filter((f) => fs.existsSync(f));
  const moved = [];
  for (const f of files) {
    const raw = readRaw(f);
    if (!userdata.hasPersonalKeys(f, raw)) continue;
    const real = userdata.hasLegacy(f, raw);
    if (real) {
      const bdir = path.join(CONTENT, "backups");
      if (!fs.existsSync(bdir)) fs.mkdirSync(bdir, { recursive: true });
      fs.copyFileSync(f, path.join(bdir, `${path.basename(f, ".json")}-before-data-folder.json`));
    }
    writeJson(f, userdata.overlay(f, raw)); // anything already in the data folder wins; empty placeholders are dropped
    if (real) moved.push(path.basename(f));
  }
  return moved;
}
function dayFiles() {
  if (!fs.existsSync(CONTENT)) return [];
  return fs.readdirSync(CONTENT).filter((f) => /^day-\d+\.json$/.test(f)).sort().map((f) => path.join(CONTENT, f));
}

const core = require("./core/shared");
const { parseAddress, addrLabel, openDoubts, insertDoubtAnswers } = core;

// Locate an item. Returns { file, item, doc, meta } where `doc` is the whole parsed file.
function locate(addr) {
  let found = null, file = null;
  if (addr.track === "READ") {
    if (fs.existsSync(FUND_FILE)) { found = core.findItem(addr, { fund: readJson(FUND_FILE) }); file = FUND_FILE; }
  } else if (addr.track === "DSA") {
    found = core.findItem(addr, { dsa: readJson(DSA_FILE) }); file = DSA_FILE;
  } else {
    for (const f of dayFiles()) { found = core.findItem(addr, { days: [readJson(f)] }); if (found) { file = f; break; } }
  }
  if (!found) throw new Error(`${addrLabel(addr)} not found. Try "kb list ${addr.track.toLowerCase()}".`);
  return { file, doc: found.doc, item: found.item, meta: found.meta };
}

// Read-only snapshot with everything a prompt needs.
function getItem(addr) {
  const { item, meta } = locate(addr);
  return core.itemView(addr, item, meta);
}

// Re-read the file, apply `fn(item)` and write it back. Returns the updated item.
function updateItem(addr, fn) {
  const { file, doc, item } = locate(addr);
  fn(item);
  writeJson(file, doc);
  return item;
}

function listItems(track) {
  const out = [];
  const want = track ? [track.toUpperCase()] : TRACKS;
  for (const file of dayFiles()) {
    const doc = readJson(file);
    for (const t of doc.topics || []) if (want.includes(t.category)) out.push(summary(t.category, t));
  }
  if (want.includes("READ") && fs.existsSync(FUND_FILE)) {
    for (const g of readJson(FUND_FILE).groups || []) for (const it of g.items || []) out.push({ ...summary("READ", it), group: g.name, read: !!it.readAt });
  }
  if (want.includes("DSA") && fs.existsSync(DSA_FILE)) {
    for (const tp of readJson(DSA_FILE).topics || []) for (const p of tp.problems || []) out.push({ ...summary("DSA", p), group: tp.name });
  }
  const order = (t) => TRACKS.indexOf(t);
  return out.sort((a, b) => order(a.track) - order(b.track) || a.number - b.number);
}
function summary(track, t) {
  return {
    track, number: Number(t.number), title: t.title,
    answered: !!(t.userAnswer && t.userAnswer.trim()),
    evaluated: !!t.answerEvaluation,
    chatCount: Array.isArray(t.chat) ? t.chat.length : 0,
    openDoubts: openDoubts(t.notes).length,
  };
}

function pending() {
  const rows = [];
  for (const it of listItems()) {
    if (it.answered && !it.evaluated) rows.push({ kind: "evaluate", track: it.track, number: it.number, title: it.title });
    if (it.openDoubts) rows.push({ kind: "doubts", track: it.track, number: it.number, title: it.title, count: it.openDoubts });
  }
  return rows;
}

module.exports = {
  ROOT, CONTENT, DSA_FILE, FUND_FILE, TRACKS, readJson, writeJson, readRaw, dayFiles, migrateLegacy, userdata,
  parseAddress, addrLabel, getItem, updateItem, listItems, openDoubts, insertDoubtAnswers, pending,
};
