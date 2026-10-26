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

// Topics by week for anyone who wants the plan as data: /kb/topics.json and /kb/topics (see lib/topics.js).
// KB_SITE_URL sets the address used in the links (default: the published site).
{
  const { buildTopics } = require("../lib/topics");
  const raw = dayFiles.map((f) => readJson(path.join(CONTENT, f)));
  const fundRaw = fs.existsSync(path.join(CONTENT, "fundamentals.json")) ? readJson(path.join(CONTENT, "fundamentals.json")) : null;
  const base = (process.env.KB_SITE_URL || "https://codingsaint.com/kb/").replace(/\/?$/, "/");
  const dsaRaw = readJson(path.join(CONTENT, "dsa.json"));
  const topicsJson = JSON.stringify(buildTopics(raw, fundRaw, { base, dsa: dsaRaw }), null, 2) + "\n";
  write("topics.json", topicsJson);
  // /kb/topics: GitHub Pages can't serve an extensionless file as JSON (browsers download it), so
  // topics/index.html shows the same JSON as text. Scripts should read topics.json.
  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  write("topics/index.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>KB topics by week (JSON)</title>
<link rel="alternate" type="application/json" href="../topics.json">
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #0b0d12; --muted: #5a5f6b; --link: #1f1a4d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0d12; --fg: #ffffff; --muted: #a0a6b0; --link: #ffffff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { padding: 10px 16px; border-bottom: 1px solid rgba(127,127,127,.25); color: var(--muted); font-family: system-ui, sans-serif; }
  a { color: var(--link); }
  pre { margin: 0; padding: 16px; white-space: pre-wrap; word-break: break-word; }
</style></head>
<body><header>KB topics by week · raw JSON for scripts: <a href="../topics.json">topics.json</a></header>
<pre>${escHtml(topicsJson)}</pre></body></html>
`);
}

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
html = html.replace(/<title>[^<]*<\/title>/, "<title>KB · Learn by doing · Coding Saint</title>");
html = html.replace('<script src="app.js"></script>', '<script src="config.js"></script>\n  <script src="core/shared.js"></script>\n  <script src="core/llm.js"></script>\n  <script src="drive.js"></script>\n  <script src="pro.js"></script>\n  <script src="web.js"></script>\n  <script src="app.js"></script>');
// Installable app: manifest, theme colour and home-screen icon.
html = html.replace("</head>", `  <link rel="manifest" href="manifest.webmanifest" />
  <meta name="theme-color" content="#1F1A4D" />
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
  <meta name="mobile-web-app-capable" content="yes" />
</head>`);
if (!html.includes("web.js")) throw new Error("Couldn't find app.js in index.html to add web.js before it.");
fs.writeFileSync(idx, html);
for (const f of ["web.js", "drive.js", "pro.js"]) fs.copyFileSync(path.join(__dirname, "site", f), path.join(OUT, f));

// ---- site settings (public): Google sign-in client id and KB Pro, from site.config.json ----
// KB_GOOGLE_CLIENT_ID overrides the file, e.g. to try a fork with your own OAuth client.
const siteCfg = (() => { try { return readJson(path.join(ROOT, "site.config.json")); } catch (e) { return {}; } })();
delete siteCfg._readme;
if (process.env.KB_GOOGLE_CLIENT_ID) siteCfg.googleClientId = process.env.KB_GOOGLE_CLIENT_ID;
if (siteCfg.googleClientId && !/\.apps\.googleusercontent\.com$/.test(siteCfg.googleClientId)) throw new Error("site.config.json: googleClientId should end in .apps.googleusercontent.com");
const rzpCfg = (siteCfg.pro && siteCfg.pro.razorpay) || {};
if (rzpCfg.enabled && !/^https:\/\/[^/]+/.test(rzpCfg.apiUrl || "")) throw new Error("site.config.json: pro.razorpay.apiUrl should be the payments Worker's https:// address (see payments/README.md)");
write("config.js", `window.KB_SITE = ${JSON.stringify(siteCfg, null, 2)};\n`);

// ---- installable app (PWA; also what the Android app opens) ----
write("manifest.webmanifest", JSON.stringify({
  name: "KB · Learning by Coding Saint", short_name: "KB", id: "./", start_url: "./?source=pwa", scope: "./",
  display: "standalone", orientation: "any", background_color: "#ffffff", theme_color: "#1F1A4D",
  description: "Explore system design, AI and DSA through practical learning, clear references and an AI tutor.",
  categories: ["education", "productivity"],
  icons: [
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2));
copyDir(path.join(ROOT, "lib", "core"), path.join(OUT, "core")); // the same prompts and data rules as the local app
fs.writeFileSync(path.join(OUT, ".nojekyll"), ""); // serve files as-is

// Offline cache: every file of the app and its content, versioned by their hash.
{
  const crypto = require("crypto");
  const list = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      const rel = path.relative(OUT, f).split(path.sep).join("/");
      if (e.isDirectory()) { if (!["topics"].includes(rel)) walk(f); }
      else if (!/(^|\/)\.|LICENSE|\.map$|^topics\.json$|^sw\.js$/.test(rel)) list.push(rel);
    }
  })(OUT);
  list.sort();
  const h = crypto.createHash("sha1");
  for (const f of list) h.update(f).update(fs.readFileSync(path.join(OUT, f)));
  const sw = fs.readFileSync(path.join(__dirname, "site", "sw.js"), "utf8")
    .replace("__VERSION__", h.digest("hex").slice(0, 12))
    .replace("__FILES__", JSON.stringify(["./", ...list]));
  fs.writeFileSync(path.join(OUT, "sw.js"), sw);
}

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
