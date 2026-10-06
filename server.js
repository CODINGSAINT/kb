// KB — local self-study practice site.
// Flat JSON files in ./content are the source of truth. Every request reads
// fresh from disk; nothing is cached (static files included — see spec §6).
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4321;
const CONTENT = path.join(__dirname, "content");
const DSA_FILE = path.join(CONTENT, "dsa.json");

const app = express();
app.use(express.json({ limit: "5mb" }));

// Global no-store: API *and* static assets.
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    cacheControl: false,
  })
);
// User-provided sketches live under content/sketches.
app.use("/sketches", express.static(path.join(CONTENT, "sketches"), { etag: false, lastModified: false, cacheControl: false }));

// ---------- file helpers ----------
const dayFile = (n) => path.join(CONTENT, `day-${String(n).padStart(2, "0")}.json`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function writeJson(f, data) {
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, f); // atomic replace
}
function listDays() {
  if (!fs.existsSync(CONTENT)) return [];
  return fs
    .readdirSync(CONTENT)
    .map((f) => /^day-(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}
function readDsa() {
  return fs.existsSync(DSA_FILE) ? readJson(DSA_FILE) : { topics: [] };
}
function parseDay(req, res) {
  const n = Number(req.params.day);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: "bad day" }), null;
  const f = dayFile(n);
  if (!fs.existsSync(f)) return res.status(404).json({ error: `day ${n} not generated yet` }), null;
  return { n, f };
}

// ---------- routes ----------
app.get("/api/tracks", (req, res) => {
  const tracks = { LLD: [], HLD: [], AI: [] };
  for (const d of listDays()) {
    let day;
    try { day = readJson(dayFile(d)); } catch (e) { continue; }
    (day.topics || []).forEach((t, i) => {
      if (!tracks[t.category]) tracks[t.category] = [];
      tracks[t.category].push({
        day: day.day ?? d,
        topicIndex: i,
        number: t.number,
        title: t.title,
        concepts: t.concepts,
        answered: !!(t.userAnswer && t.userAnswer.trim()),
        evaluated: !!t.answerEvaluation,
      });
    });
  }
  for (const k of Object.keys(tracks)) tracks[k].sort((a, b) => a.number - b.number);
  res.json(tracks);
});

app.get("/api/dsa", (req, res) => res.json(readDsa()));

app.get("/api/days/:day", (req, res) => {
  const p = parseDay(req, res);
  if (p) res.json(readJson(p.f));
});

function updateDayTopic(field, transform) {
  return (req, res) => {
    const p = parseDay(req, res);
    if (!p) return;
    const day = readJson(p.f);
    const t = day.topics?.[req.body.topicIndex];
    if (!t) return res.status(400).json({ error: "bad topicIndex" });
    const val = req.body[field];
    if (typeof val !== "string") return res.status(400).json({ error: `${field} must be a string` });
    t[field] = val;
    if (transform) transform(t);
    writeJson(p.f, day);
    res.json({ ok: true, topic: t });
  };
}
const clearEval = (t) => { t.answerEvaluation = null; t.answerEvaluatedAt = null; };

app.post("/api/days/:day/notes", updateDayTopic("notes"));
app.post("/api/days/:day/answer", updateDayTopic("userAnswer", clearEval));

function updateDsaProblem(field, transform) {
  return (req, res) => {
    const dsa = readDsa();
    const { topicIndex, problemIndex } = req.body;
    const prob = dsa.topics?.[topicIndex]?.problems?.[problemIndex];
    if (!prob) return res.status(400).json({ error: "bad topicIndex/problemIndex" });
    const val = req.body[field];
    if (typeof val !== "string") return res.status(400).json({ error: `${field} must be a string` });
    prob[field] = val;
    if (transform) transform(prob);
    writeJson(DSA_FILE, dsa);
    res.json({ ok: true, problem: prob });
  };
}
app.post("/api/dsa/notes", updateDsaProblem("notes"));
app.post("/api/dsa/answer", updateDsaProblem("userAnswer", clearEval));

app.get("/api/progress", (req, res) => {
  let total = 0, answered = 0, evaluated = 0;
  const tally = (t) => {
    total++;
    if (t.userAnswer && t.userAnswer.trim()) answered++;
    if (t.answerEvaluation) evaluated++;
  };
  // Denominator: all 60 study.md topics if the source exists, else what's generated.
  let plannedDayTopics = null;
  const studyPath = path.join(__dirname, "study.md");
  if (fs.existsSync(studyPath)) {
    try { plannedDayTopics = require("./scripts/study-parser").parseStudy(fs.readFileSync(studyPath, "utf8")).count; } catch (e) {}
  }
  let generated = 0;
  for (const d of listDays()) {
    try { for (const t of readJson(dayFile(d)).topics || []) { tally(t); generated++; } } catch (e) {}
  }
  if (plannedDayTopics && plannedDayTopics > generated) total += plannedDayTopics - generated;
  for (const tp of readDsa().topics) for (const p of tp.problems) tally(p);
  const pct = (x) => (total ? Math.round((x / total) * 1000) / 10 : 0);
  res.json({ totalTopics: total, answered, evaluated, answeredPct: pct(answered), evaluatedPct: pct(evaluated) });
});

// ---------- AI: evaluate, chat, doubts, settings ----------
// Provider keys stay on this machine (kb.config.json or env vars) and never reach the browser.
const store = require("./lib/store");
const ai = require("./lib/ai");
const tutor = require("./lib/tutor");

const addrFrom = (body) => store.parseAddress(`${body.track} ${body.number}`);
const aiFail = (res, e) => res.status(e.code === "NO_KEY" ? 412 : e.code === "NO_ANSWER" ? 400 : 502).json({ error: e.message, code: e.code || null });

app.get("/api/ai/config", (req, res) => {
  try { res.json(ai.publicConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/ai/config", (req, res) => {
  try { ai.saveConfig(req.body || {}); res.json(ai.publicConfig()); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/ai/test", async (req, res) => {
  try {
    const r = await ai.complete({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "ping" }], maxTokens: 20 });
    res.json({ ok: true, reply: r.trim().slice(0, 60) });
  } catch (e) { aiFail(res, e); }
});

app.post("/api/ai/evaluate", async (req, res) => {
  try { const { item } = await tutor.evaluate(addrFrom(req.body)); res.json({ ok: true, item }); }
  catch (e) { aiFail(res, e); }
});

app.post("/api/ai/doubts", async (req, res) => {
  try { const r = await tutor.answerDoubts(addrFrom(req.body)); res.json({ ok: true, ...r, item: store.getItem(addrFrom(req.body)) }); }
  catch (e) { aiFail(res, e); }
});

app.post("/api/ai/chat/clear", (req, res) => {
  try { tutor.clearChat(addrFrom(req.body)); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// Streams NDJSON: {"t":"…"} per text chunk, then {"done":true} or {"error":"…"}.
app.post("/api/ai/chat", async (req, res) => {
  let addr;
  try { addr = addrFrom(req.body); store.getItem(addr); } catch (e) { return res.status(400).json({ error: e.message }); }
  const ctrl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctrl.abort(); });
  res.set("Content-Type", "application/x-ndjson; charset=utf-8");
  res.set("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  try {
    await tutor.clarify(addr, req.body.message, { signal: ctrl.signal, onToken: (t) => send({ t }) });
    send({ done: true });
  } catch (e) {
    if (!ctrl.signal.aborted) send({ error: e.message, code: e.code || null });
  }
  res.end();
});

// Localhost only by default: the AI routes spend your API credit. HOST=0.0.0.0 to expose on your LAN.
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  let ai = "";
  try { const c = require("./lib/ai").publicConfig(); ai = c.ready ? ` · AI: ${c.provider} (${c.model})` : " · AI: not set up (gear icon on the site, or `kb setup`)"; } catch (e) {}
  console.log(`KB running at http://localhost:${PORT}${ai}`);
});
