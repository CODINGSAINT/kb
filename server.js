// KB — local self-study practice site.
// Flat JSON files in ./content are the source of truth. Every request reads
// fresh from disk; nothing is cached (static files included — see spec §6).
const express = require("express");
const fs = require("fs");
const path = require("path");

// Modes (all of them refuse anything outside your local network):
//   npm start             this computer + your Wi-Fi/LAN   http://localhost:4321, http://<lan-ip>:4321
//   npm run start:lan     same, on port 80                 http://kb (Windows), http://kb.local (phones, Macs)
//   npm run start:local   this computer only               http://localhost:4321
const LOCAL_ONLY = process.argv.includes("--local") || process.env.KB_LOCAL === "1";
const LAN = !LOCAL_ONLY;
const PORT80 = process.argv.includes("--lan") || process.env.KB_LAN === "1";
const PORT = Number(process.env.PORT) || (PORT80 ? 80 : 4321);
const CONTENT = path.join(__dirname, "content");
const DSA_FILE = path.join(CONTENT, "dsa.json");

const app = express();

// LAN mode: answer only devices on the local network (private and link-local ranges).
// Anything else, for example a request forwarded from the internet by a router, gets 403.
function isLocalAddress(ip) {
  const a = String(ip || "").replace(/^::ffff:/, "");
  if (a === "::1" || a.startsWith("127.")) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^(fe8|fe9|fea|feb|fc|fd)/i.test(a); // IPv6 link-local and unique-local
}
if (LAN) {
  app.use((req, res, next) => {
    if (isLocalAddress(req.socket.remoteAddress)) return next();
    res.status(403).type("text").send("KB is only available on the local network.");
  });
}
app.use(express.json({ limit: "25mb" })); // older answers may still carry inline base64 images

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
// Images pasted or dropped into answers. Files are content-addressed, so they can be cached.
const images = require("./lib/images");
app.use("/images", (req, res, next) => { res.set("Cache-Control", "public, max-age=31536000, immutable"); next(); },
  express.static(images.IMG_DIR, { etag: false, lastModified: false, cacheControl: false }),
  express.static(images.LEGACY_DIR, { etag: false, lastModified: false, cacheControl: false }));
app.post("/api/images", express.raw({ type: Object.keys(images.TYPES), limit: images.MAX_UPLOAD }), (req, res) => {
  try { res.json({ url: images.saveImage(req.body, String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ---------- file helpers ----------
const dayFile = (n) => path.join(CONTENT, `day-${String(n).padStart(2, "0")}.json`);
// Shared with the CLI: reads merge in your data folder, writes split your work back out to it.
const { readJson, writeJson } = require("./lib/store");
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

// Read-first fundamentals (content/fundamentals.json, built by build/make-fundamentals.js).
const FUND_FILE = path.join(CONTENT, "fundamentals.json");
app.get("/api/fundamentals", (req, res) => {
  if (!fs.existsSync(FUND_FILE)) return res.json({ groups: [], prereqs: {} });
  res.json(readJson(FUND_FILE));
});
app.post("/api/fundamentals/read", (req, res) => {
  const { id, read } = req.body || {};
  if (!fs.existsSync(FUND_FILE)) return res.status(404).json({ error: "no fundamentals" });
  const doc = readJson(FUND_FILE);
  const it = (doc.groups || []).flatMap((g) => g.items || []).find((x) => x.id === id);
  if (!it) return res.status(400).json({ error: "unknown article" });
  it.readAt = read ? new Date().toISOString() : null;
  writeJson(FUND_FILE, doc);
  res.json({ ok: true, readAt: it.readAt });
});

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
    t[field] = field === "userAnswer" ? images.externalize(val) : val;
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
    prob[field] = field === "userAnswer" ? images.externalize(val) : val;
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
// Your work lives in the data folder (lib/userdata.js). Older installs kept it inside content/: move it once.
try {
  const moved = store.migrateLegacy();
  if (moved.length) console.log(`Moved your answers, verdicts, notes and chats from content/ into your data folder (${moved.join(", ")}). Backups are in content/backups/.`);
} catch (e) { console.error(`Couldn't move your saved work into the data folder: ${e.message}`); }
console.log(`Your data folder: ${store.userdata.DATA_DIR}`);
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
app.get("/api/ai/ollama-models", async (req, res) => {
  const base = typeof req.query.baseUrl === "string" && /^https?:\/\//.test(req.query.baseUrl) ? req.query.baseUrl : undefined;
  res.json({ models: await ai.listOllamaModels(base) });
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
    await tutor.clarify(addr, req.body.message, { signal: ctrl.signal, onToken: (t) => send({ t }), voice: !!req.body.voice });
    send({ done: true });
  } catch (e) {
    if (!ctrl.signal.aborted) send({ error: e.message, code: e.code || null });
  }
  res.end();
});

// ---------- optional OpenAI voice (speech-to-text, text-to-speech) ----------
const voice = require("./lib/voice");
app.post("/api/voice/transcribe", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: "No audio received." });
    const text = await voice.transcribe(req.body, req.get("Content-Type") || "audio/webm", req.query.lang);
    res.json({ text });
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || null }); }
});
app.post("/api/voice/speak", async (req, res) => {
  try {
    const r = await voice.speak(req.body && req.body.text, req.body && req.body.voice);
    res.set("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || null }); }
});

// Default: every network interface, but only local-network addresses are answered (see
// isLocalAddress above), so the AI routes that spend your credit never face the internet.
// --local restricts it to this computer.
const HOST = process.env.HOST || (LAN ? "0.0.0.0" : "127.0.0.1");
const server = app.listen(PORT, HOST, () => {
  let ai = "";
  try { const c = require("./lib/ai").publicConfig(); ai = c.ready ? `AI: ${c.provider} (${c.model})` : "AI: not set up (gear icon on the site, or `kb setup`)"; } catch (e) {}
  const port = PORT === 80 ? "" : `:${PORT}`;
  if (!LAN) return console.log(`KB running at http://localhost${port} · ${ai}`);
  const os = require("os");
  const name = os.hostname().toLowerCase();
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`KB running on your local network · ${ai}`);
  console.log(`  This computer:        http://localhost${port}`);
  console.log(`  Windows PCs:          http://${name}${port}`);
  console.log(`  Phones, iPads, Macs:  http://${name}.local${port}`);
  if (ips.length) console.log(`  By IP (changes):      ${ips.map((ip) => `http://${ip}${port}`).join("  ")}`);
  console.log(`  Only devices on your local network can connect. Press Ctrl+C to stop.`);
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop the other program, or use another port: run  $env:PORT=8080; npm start  (PowerShell).`);
  else if (e.code === "EACCES") console.error(`Not allowed to use port ${PORT}. Use another port: run  $env:PORT=8080; npm start  (PowerShell).`);
  else console.error(e.message);
  process.exit(1);
});
