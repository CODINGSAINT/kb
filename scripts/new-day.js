#!/usr/bin/env node
// Scaffold content/day-NN.json from row N of all three study.md tables.
// Titles/concepts are filled in; markdown + diagram are left empty for the
// assistant (chat or generate-day.sh) to write. Never overwrites an existing day.
//   node scripts/new-day.js 2          -> scaffold day 2
//   node scripts/new-day.js next       -> scaffold the first day not yet on disk
const fs = require("fs");
const path = require("path");
const { parseStudy } = require("./study-parser");

const root = path.join(__dirname, "..");
const { tracks } = parseStudy(fs.readFileSync(path.join(root, "study.md"), "utf8"));
const file = (n) => path.join(root, "content", `day-${String(n).padStart(2, "0")}.json`);

let arg = process.argv[2];
if (!arg) { console.error("usage: new-day.js <N|next>"); process.exit(1); }
let n = arg === "next" ? 1 : Number(arg);
if (arg === "next") while (fs.existsSync(file(n))) n++;
if (!Number.isInteger(n) || n < 1) { console.error("bad day number"); process.exit(1); }
if (fs.existsSync(file(n))) { console.error(`day ${n} already exists: ${file(n)}`); process.exit(2); }

const topics = ["LLD", "HLD", "AI"].map((cat) => {
  const row = (tracks[cat] || []).find((r) => r.number === n);
  if (!row) { console.error(`study.md has no row ${n} in the ${cat} table`); process.exit(3); }
  return { category: cat, number: n, title: row.title, concepts: row.concepts, notes: "",
           diagram: { nodes: [], edges: [] }, markdown: "", userAnswer: "", answerEvaluation: null, answerEvaluatedAt: null };
});
fs.writeFileSync(file(n), JSON.stringify({ day: n, generatedAt: new Date().toISOString(), sketch: null, evaluation: null, topics }, null, 2) + "\n");
console.log(`scaffolded ${path.relative(root, file(n))}: ${topics.map((t) => `${t.category} "${t.title}"`).join(", ")}`);
