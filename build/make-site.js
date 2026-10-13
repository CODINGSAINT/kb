#!/usr/bin/env node
// Builds the website into ./site (git-ignored), for GitHub Pages.
//
//   npm run build:site        then serve site/ with any static server
//
// The site is read-only until a visitor chooses their own kb-data folder; then build/site/web.js saves
// their work into that folder and calls their AI provider from the browser (see the README).
// This build reads ONLY the shared content in content/ (never your data folder) and strips any personal
// fields that an old copy might still carry, so the published site can't contain your answers,
// verdicts, notes, chats or read status. The GitHub Action in .github/workflows/pages.yml runs this
// on every push to main.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTENT = path.join(ROOT, "content");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "site");
const PERSONAL = ["userAnswer", "answerEvaluation", "answerEvaluatedAt", "notes", "chat", "readAt"];

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data));
};
const strip = (o) => { for (const k of PERSONAL) delete o[k]; return o; };

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!/\.(bak|tmp)$/.test(e.name)) fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(PUBLIC, OUT);

// ---- content -> static JSON ----
const dayFiles = fs.readdirSync(CONTENT).filter((f) => /^day-\d+\.json$/.test(f)).sort();
const tracks = { LLD: [], HLD: [], AI: [] };
for (const f of dayFiles) {
  const d = readJson(path.join(CONTENT, f));
  delete d.sketch; delete d.evaluation;
  (d.topics || []).forEach((t, i) => {
    strip(t);
    (tracks[t.category] = tracks[t.category] || []).push({ day: d.day, topicIndex: i, number: t.number, title: t.title, concepts: t.concepts, answered: false, evaluated: false });
  });
  write(`data/days/${f}`, d);
}
for (const k of Object.keys(tracks)) tracks[k].sort((a, b) => a.number - b.number);
write("data/tracks.json", tracks);

// Day list, and the planned topic count from study.md (the progress bar's denominator, as in the local app).
let plannedTopics = 0;
try { plannedTopics = require("../scripts/study-parser").parseStudy(fs.readFileSync(path.join(ROOT, "study.md"), "utf8")).count || 0; } catch (e) {}
write("data/meta.json", { days: dayFiles.map((f) => Number(/\d+/.exec(f)[0])), plannedTopics });

const dsa = readJson(path.join(CONTENT, "dsa.json"));
for (const tp of dsa.topics || []) for (const p of tp.problems || []) strip(p);
write("data/dsa.json", dsa);

const fundFile = path.join(CONTENT, "fundamentals.json");
const fund = fs.existsSync(fundFile) ? readJson(fundFile) : { groups: [], prereqs: {} };
fund.groups = (fund.groups || []).filter((g) => !g.library);
for (const g of fund.groups) for (const it of g.items || []) strip(it);
write("data/fundamentals.json", fund);

// ---- page: load the web layer first, and describe the site for search and link previews ----
const idx = path.join(OUT, "index.html");
let html = fs.readFileSync(idx, "utf8");
html = html.replace(/<title>[^<]*<\/title>/, `<title>KB · AI interview coach</title>
  <meta name="description" content="Practise LLD, HLD, AI system design and DSA: 60 design problems, 37 read-first chapters and 304 DSA problems by pattern. Choose your own data folder to save answers and get AI grading and a tutor with your own key." />`);
html = html.replace('<script src="app.js"></script>', '<script src="core/shared.js"></script>\n  <script src="core/llm.js"></script>\n  <script src="web.js"></script>\n  <script src="app.js"></script>');
if (!html.includes("web.js")) throw new Error("Couldn't find app.js in index.html to add web.js before it.");
fs.writeFileSync(idx, html);
fs.copyFileSync(path.join(__dirname, "site", "web.js"), path.join(OUT, "web.js"));
copyDir(path.join(ROOT, "lib", "core"), path.join(OUT, "core")); // the same prompts and data rules as the local app
fs.writeFileSync(path.join(OUT, ".nojekyll"), ""); // serve files as-is

// ---- safety check: nothing personal made it in ----
const leaks = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) scan(f);
    else if (f.endsWith(".json")) {
      // Walk the data and look for personal keys (not text that merely mentions the words).
      (function walk(v, where) {
        if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
        if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
          if (PERSONAL.includes(k)) leaks.push(`${path.relative(OUT, f)} ${where}.${k}`);
          walk(x, `${where}.${k}`);
        }
      })(readJson(f), "");
    }
  }
})(path.join(OUT, "data"));
if (leaks.length) { console.error("Personal fields found in the site build, aborting:\n  " + leaks.join("\n  ")); process.exit(1); }

const n = Object.values(tracks).reduce((s, l) => s + l.length, 0);
const p = (dsa.topics || []).reduce((s, t) => s + t.problems.length, 0);
const c = fund.groups.reduce((s, g) => s + g.items.length, 0);
console.log(`built site/: ${n} design topics, ${c} chapters, ${p} DSA problems (website)`);
