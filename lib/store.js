// Data layer shared by the server and the `kb` CLI.
// Flat JSON in ./content is the source of truth. Every read goes to disk, and every
// write re-reads the file first, so the CLI and the site can edit side by side.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const DSA_FILE = path.join(CONTENT, "dsa.json");
const TRACKS = ["LLD", "HLD", "AI", "DSA"];

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function writeJson(f, data) {
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, f); // atomic replace
}
function dayFiles() {
  if (!fs.existsSync(CONTENT)) return [];
  return fs.readdirSync(CONTENT).filter((f) => /^day-\d+\.json$/.test(f)).sort().map((f) => path.join(CONTENT, f));
}

// "lld 1", "lld1", "LLD-1", "lld#1", ["lld","1"] -> { track: "LLD", number: 1 }
function parseAddress(input) {
  const s = (Array.isArray(input) ? input.join(" ") : String(input || "")).trim();
  const m = /^(lld|hld|ai|dsa)\s*[-#: ]?\s*(\d+)$/i.exec(s);
  if (!m) throw new Error(`Can't read "${s}". Use a track and a number, like "lld 1", "hld 12", "ai 3" or "dsa 40".`);
  return { track: m[1].toUpperCase(), number: Number(m[2]) };
}
const addrLabel = (a) => `${a.track} ${a.number}`;

// Locate an item. Returns { file, item, doc, meta } where `doc` is the whole parsed file.
function locate(addr) {
  if (addr.track === "DSA") {
    const doc = readJson(DSA_FILE);
    for (const tp of doc.topics || []) {
      const item = (tp.problems || []).find((p) => Number(p.number) === addr.number);
      if (item) return { file: DSA_FILE, doc, item, meta: { topicName: tp.name } };
    }
  } else {
    for (const file of dayFiles()) {
      const doc = readJson(file);
      const item = (doc.topics || []).find((t) => t.category === addr.track && Number(t.number) === addr.number);
      if (item) return { file, doc, item, meta: { day: doc.day } };
    }
  }
  throw new Error(`${addrLabel(addr)} not found. Try "kb list ${addr.track.toLowerCase()}".`);
}

// Read-only snapshot with everything a prompt needs.
function getItem(addr) {
  const { item, meta } = locate(addr);
  return {
    address: addr,
    label: `${addrLabel(addr)} · ${item.title}`,
    track: addr.track,
    number: addr.number,
    title: item.title,
    concepts: item.concepts || "",
    topicName: meta.topicName || null,
    day: meta.day || null,
    leetcodeUrl: item.leetcodeUrl || null,
    markdown: item.markdown || "",
    userAnswer: item.userAnswer || "",
    answerEvaluation: item.answerEvaluation || null,
    answerEvaluatedAt: item.answerEvaluatedAt || null,
    notes: item.notes || "",
    chat: Array.isArray(item.chat) ? item.chat : [],
  };
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

// "#doubt ..." lines with no "#doubt-answer" as the next non-blank line.
function openDoubts(notes) {
  const out = [];
  const lines = String(notes || "").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^\s*#doubt\b(?!-answer)/i.test(l)) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (!next || !/^\s*#doubt-answer\b/i.test(next)) out.push({ line: l, question: l.replace(/^\s*#doubt\b:?\s*/i, "").trim() });
    }
  });
  return out;
}

// Insert "#doubt-answer ..." directly under each answered question line.
// answers: [{ line, answer }] — matched by exact line text, so edits elsewhere in notes are safe.
function insertDoubtAnswers(notes, answers) {
  const lines = String(notes || "").split(/\r?\n/);
  for (const { line, answer } of answers) {
    const i = lines.findIndex((l, idx) => l === line && !/^\s*#doubt-answer\b/i.test(lines.slice(idx + 1).find((x) => x.trim()) || ""));
    if (i < 0) continue;
    // A blank line ends an answer in the notes format, so squeeze blank lines out.
    const body = String(answer).trim().replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").replace(/^#doubt/gim, "doubt");
    const after = lines[i + 1];
    // Keep following text out of the answer: a blank line ends it.
    const ins = ["#doubt-answer " + body];
    if (after !== undefined && after.trim() && !/^\s*#doubt\b/i.test(after)) ins.push("");
    lines.splice(i + 1, 0, ...ins);
  }
  return lines.join("\n");
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
  ROOT, CONTENT, DSA_FILE, TRACKS, readJson, writeJson, dayFiles,
  parseAddress, addrLabel, getItem, updateItem, listItems, openDoubts, insertDoubtAnswers, pending,
};
