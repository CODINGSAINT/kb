// KB on the web (GitHub Pages): the app with no server.
//
//   - Signed out it's a read-only demo.
//   - Sign in with Google (drive.js) and it becomes the full app on any browser and the Android app: your work and
//     your AI settings, keys included, are kept in your own Google Drive and follow you to every device.
//   - KB Pro (pro.js) gates practice beyond the free topics when pro.enabled is set in site.config.json.
//   - Or choose your kb-data folder (Chrome or Edge on a computer) and it becomes the full app: answers,
//     notes, read status, tutor chats and images are saved straight into that folder, in exactly the
//     same files the local app uses. Keep the folder in a private git repo to sync between devices.
//   - AI runs from this browser to the provider you pick, with your own key. The key stays in this
//     browser (for the session, or remembered if you tick the box) and is sent only to that provider.
//
// How: app.js talks to "/api/..." like it does with the local server. This file answers those requests
// in the page. The prompts and data rules are the same code the server uses (core/shared.js, core/llm.js).
(function () {
  "use strict";
  const C = window.KBCore, L = window.KBLlm;
  const REPO = "https://github.com/CODINGSAINT/kb";
  const CAN_PICK = typeof window.showDirectoryPicker === "function";
  const realFetch = window.fetch.bind(window);

  // ---------------------------------------------------------------- small helpers
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const fail = (e, status) => json({ error: e.message || String(e), code: e.code || null }, status || e.status || 500);
  const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const readOnly = () => json({ error: "This is the read-only demo. Choose your kb-data folder (button at the top) to save your work.", code: "DEMO" }, 403);

  // Tiny IndexedDB key-value store: the folder handle can't go in localStorage.
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("kb-web", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => { open.result.close(); resolve(req && req.result); };
        tx.onerror = () => { open.result.close(); reject(tx.error); };
      };
    });
  }
  const kv = {
    get: (k) => idb("readonly", (s) => s.get(k)).catch(() => null),
    set: (k, v) => idb("readwrite", (s) => s.put(v, k)),
    del: (k) => idb("readwrite", (s) => s.delete(k)),
  };
  const local = {
    get(store, k, d) { try { const v = store.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(store, k, v) { try { if (v == null) store.removeItem(k); else store.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---------------------------------------------------------------- where your work is saved
  // Two places, same files:
  //   "drive":  signed in with Google; saved in KB's private app folder in your Google Drive (drive.js),
  //             works on phones and every browser, and follows you to every device you sign in on.
  //   "folder": a kb-data folder on this computer (Chrome or Edge on a computer), shared with the local app.
  const D = window.KBDrive || { available: false };
  let dir = null;            // FileSystemDirectoryHandle in folder mode
  let mode = null;           // "drive" | "folder" | null
  let status = "none";       // none | needs-permission | connected
  let savedHandle = null;
  const progress = new Map(); // progress id -> saved record
  let libs = [];              // your `kb add` libraries, read from library/ (folder mode)

  async function subdir(parts, create) {
    let d = dir;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  const folderFs = {
    async readFile(parts) {
      try {
        const d = await subdir(parts.slice(0, -1), false);
        return await (await d.getFileHandle(parts[parts.length - 1])).getFile();
      } catch (e) { if (e.name === "NotFoundError" || e.name === "TypeMismatchError") return null; throw e; }
    },
    async writeFile(parts, data) {
      const d = await subdir(parts.slice(0, -1), true);
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(data);
      await w.close(); // the browser writes to a temporary file and swaps it in on close
    },
    async removeFile(parts) {
      try { await (await subdir(parts.slice(0, -1), false)).removeEntry(parts[parts.length - 1]); }
      catch (e) { if (e.name !== "NotFoundError") throw e; }
    },
    async entries(parts) {
      let d;
      try { d = await subdir(parts, false); } catch (e) { return []; }
      const out = [];
      for await (const [name, h] of d.entries()) out.push([name, h]);
      return out;
    },
  };
  const fsb = () => (mode === "drive" ? D.fs : folderFs);
  const readFile = (parts) => fsb().readFile(parts);
  const readText = async (parts) => { const f = await readFile(parts); return f ? f.text() : null; };
  const writeFile = (parts, data) => fsb().writeFile(parts, data);
  const removeFile = (parts) => fsb().removeFile(parts);
  const entries = (parts) => fsb().entries(parts);
  async function ensureReadme() {
    if (mode !== "folder") return;
    if ((await readFile(["README.md"])) === null) await writeFile(["README.md"], C.DATA_README);
  }

  async function loadFolder() {
    progress.clear();
    for (const [name, h] of await entries(["progress"])) {
      if (h.kind !== "file" || !name.endsWith(".json")) continue;
      try { progress.set(name.slice(0, -5), JSON.parse(await (await h.getFile()).text())); }
      catch (e) { console.warn(`KB: skipped progress/${name}: ${e.message}`); }
    }
    libs = [];
    for (const [slug, h] of await entries(["library"])) {
      if (h.kind !== "directory") continue;
      let meta;
      try { meta = JSON.parse(await readText(["library", slug, "library.json"])); } catch (e) { continue; }
      if (!meta || !Array.isArray(meta.chapters)) continue;
      const chapters = [];
      for (let i = 0; i < meta.chapters.length; i++) {
        const ch = meta.chapters[i];
        const md = await readText(["library", slug, `${String(i + 1).padStart(2, "0")}-${ch.id}.md`]);
        if (md !== null) chapters.push({ ch, markdown: md });
      }
      libs.push({ slug, meta, chapters });
    }
    libs.sort(C.libOrder);
  }

  async function connect(handle) {
    dir = handle; mode = "folder";
    await loadFolder();
    status = "connected";
  }
  async function connectDrive() {
    mode = "drive";
    await loadFolder();
    status = "connected";
  }
  // Another device saved while this one was open: reload what's on screen if nothing is being typed.
  let lastPending = 0;
  if (D.onChange) D.onChange(async (s) => {
    if (mode !== "drive") return;
    const wasBusy = lastPending;
    lastPending = s.pending;
    if (s.sync === "idle" && !wasBusy) {
      const before = JSON.stringify([...progress.entries()]);
      await loadFolder();
      if (JSON.stringify([...progress.entries()]) !== before) window.dispatchEvent(new CustomEvent("kb:remote-change"));
    }
  });

  // Pick a folder (needs a click). Checks it isn't the app's own folder by mistake.
  async function chooseFolder() {
    let h;
    try { h = await window.showDirectoryPicker({ id: "kb-data", mode: "readwrite", startIn: "documents" }); }
    catch (e) { if (e.name === "AbortError") return false; throw e; }
    const names = [];
    for await (const [name] of h.entries()) names.push(name);
    if (names.includes("package.json") && names.includes("content")) {
      alert("That's the KB app folder. Choose your kb-data folder instead (it holds progress/ and images/), or an empty folder to start one.");
      return false;
    }
    const looksLikeData = names.includes("progress") || names.includes("library") || names.includes("images");
    const visible = names.filter((n) => !n.startsWith("."));
    if (!looksLikeData && visible.length && !confirm(`"${h.name}" isn't empty and doesn't look like a kb-data folder yet.\n\nUse it anyway? KB will add progress/ and images/ folders and a README to it.`)) return false;
    if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") return false;
    await kv.set("dir", h);
    return true;
  }
  async function reconnect() {
    if (!savedHandle) return false;
    return (await savedHandle.requestPermission({ mode: "readwrite" })) === "granted";
  }
  async function disconnect() { await kv.del("dir"); }

  // ---------------------------------------------------------------- shared content (static files)
  const cache = new Map();
  function getStatic(path) {
    if (!cache.has(path)) {
      cache.set(path, realFetch(path, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw Object.assign(new Error(`${path}: ${r.status}`), { status: r.status });
        return r.json();
      }).catch((e) => { cache.delete(path); throw e; }));
    }
    return cache.get(path).then(clone);
  }
  const meta = () => getStatic("data/meta.json").catch(() => ({ days: [], plannedTopics: 0 }));
  const dayPath = (n) => `data/days/day-${String(n).padStart(2, "0")}.json`;
  async function dayNumbers() {
    const m = await meta();
    if (m.days && m.days.length) return m.days;
    const t = await getStatic("data/tracks.json");
    return [...new Set(Object.values(t).flat().map((x) => x.day))].sort((a, b) => a - b);
  }

  // Content + your saved work. Each call returns fresh copies.
  const withProgress = (kind, doc) => C.applyProgress(kind, doc, (id) => progress.get(id) || null);
  async function loadDay(n) { return withProgress("day", await getStatic(dayPath(n))); }
  async function loadDsa() { return withProgress("dsa", await getStatic("data/dsa.json")); }
  async function loadFund() {
    const doc = await getStatic("data/fundamentals.json").catch(() => ({ groups: [], prereqs: {} }));
    doc.groups = doc.groups || [];
    if (status === "connected") doc.groups.push(...C.libraryGroups(libs, C.lastNumber(doc.groups)));
    return withProgress("fund", doc);
  }
  async function loadDays() { return Promise.all((await dayNumbers()).map(loadDay)); }

  // Save a doc's personal fields to the folder (the content part is never written).
  async function saveDoc(kind, doc) {
    const { records } = C.splitProgress(kind, doc);
    let wroteAny = false;
    for (const [id, rec] of records) {
      const old = progress.get(id);
      if (!rec) {
        if (old) { await removeFile(["progress", `${id}.json`]); progress.delete(id); }
        continue;
      }
      const text = C.progressText(rec);
      if (old && C.progressText(old) === text) continue;
      if (!wroteAny) { await ensureReadme(); wroteAny = true; }
      await writeFile(["progress", `${id}.json`], text);
      progress.set(id, JSON.parse(text));
    }
  }

  // ---------------------------------------------------------------- images in answers
  // Answers reference "/images/<hash>.png" (as in the local app). In the page those are shown
  // through blob: URLs read from your folder, and turned back into "/images/..." when saving.
  const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const EXT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  const MAX_UPLOAD = 10 * 1024 * 1024;
  const shown = new Map(); // "/images/x.png" -> blob: URL
  const back = new Map();  // blob: URL -> "/images/x.png"
  const imgName = (src) => { const m = /^\/?images\/([\w.-]+)$/.exec(src); return m ? m[1] : null; };

  async function blobUrlFor(path) {
    if (shown.has(path)) return shown.get(path);
    const f = await readFile(["images", imgName(path)]);
    if (!f) return null;
    const url = URL.createObjectURL(f);
    shown.set(path, url); back.set(url, path);
    return url;
  }
  async function toDisplay(md) {
    if (!md || !/\/?images\//.test(md)) return md;
    const urls = new Map();
    for (const src of new Set(C.imageSources(md))) if (imgName(src)) { const u = await blobUrlFor(src); if (u) urls.set(src, u); }
    return md.replace(C.IMG_RE, (all, alt, src) => (urls.has(src) ? all.replace(src, urls.get(src)) : all));
  }
  async function displayItem(it) { if (it && it.userAnswer) it.userAnswer = await toDisplay(it.userAnswer); return it; }

  async function saveImageBlob(blob, type) {
    const ext = TYPES[type];
    if (!ext) throw Object.assign(new Error(`Unsupported image type ${type || "(unknown)"}. Use PNG, JPEG, GIF or WebP.`), { status: 415 });
    if (!blob.size) throw Object.assign(new Error("Empty image."), { status: 400 });
    if (blob.size > MAX_UPLOAD) throw Object.assign(new Error(`Image is ${(blob.size / 1048576).toFixed(1)} MB; the limit is 10.0 MB.`), { status: 413 });
    const hash = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
    const name = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16) + "." + ext;
    if (!(await readFile(["images", name]))) await writeFile(["images", name], blob);
    return "/images/" + name;
  }
  // Editor Markdown -> what's saved: blob: URLs back to /images/..., pasted base64 images into files.
  async function toStored(md) {
    let out = String(md || "");
    for (const [url, path] of back) out = out.split(url).join(path);
    for (const src of new Set(C.imageSources(out))) {
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
      if (!m) continue;
      try {
        const type = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
        const bin = atob(m[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out = out.split(src).join(await saveImageBlob(new Blob([bytes], { type }), type));
      } catch (e) { /* keep it inline */ }
    }
    return out;
  }

  // Load the images an answer references, for the model to see.
  function base64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function promptImages(md) {
    const loaded = new Map();
    for (const src of new Set(C.imageSources(md))) {
      const data = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
      if (data) { loaded.set(src, { mediaType: data[1].toLowerCase().replace("image/jpg", "image/jpeg"), data: data[2], size: Math.floor(data[2].length * 3 / 4) }); continue; }
      if (/^https?:\/\//i.test(src)) { loaded.set(src, { error: "web link, not attached" }); continue; }
      const name = imgName(src);
      const f = name ? await readFile(["images", name]) : null;
      if (!f) { loaded.set(src, { error: name ? "file missing" : "not found" }); continue; }
      const mediaType = EXT_TYPES[name.split(".").pop().toLowerCase()];
      if (!mediaType) { loaded.set(src, { error: "unsupported type" }); continue; }
      loaded.set(src, { mediaType, data: base64(await f.arrayBuffer()), size: f.size });
    }
    return C.extractImages(md, (src) => loaded.get(src) || { error: "not found" });
  }

  // ---------------------------------------------------------------- AI settings (this browser only)
  // Model and base URL are remembered in localStorage. Keys are kept for this session
  // (sessionStorage) unless you tick "Remember", which keeps them in localStorage on this device.
  // Signed in with Google: provider, models and keys live in settings.json in your Drive's KB app folder,
  // so you connect a provider once and it works on every device you sign in on.
  const SETTINGS = "kb-web-ai", KEYS = "kb-web-keys";
  const PROVIDERS = L.PROVIDERS;
  const onDrive = () => mode === "drive";
  const remembered = () => onDrive() || !!local.get(localStorage, KEYS, null);
  const keys = () => (onDrive() ? (D.settings.get("ai", {}).keys || {}) : local.get(localStorage, KEYS, null) || local.get(sessionStorage, KEYS, {}) || {});
  function setKeys(k, remember) {
    if (onDrive()) { D.settings.set("ai", Object.assign(D.settings.get("ai", {}), { keys: k })); return; }
    local.set(localStorage, KEYS, remember ? k : null);
    local.set(sessionStorage, KEYS, remember ? null : k);
  }
  const savedPrefs = () => (onDrive() ? (D.settings.get("ai", {}).prefs || {}) : local.get(localStorage, SETTINGS, {}));
  const setPrefs = (p) => (onDrive() ? D.settings.set("ai", Object.assign(D.settings.get("ai", {}), { prefs: p })) : local.set(localStorage, SETTINGS, p));
  function settings() {
    const saved = savedPrefs();
    const k = keys();
    const cfg = { provider: saved.provider || "anthropic" };
    for (const [id, p] of Object.entries(PROVIDERS)) cfg[id] = Object.assign({}, p.defaults, saved[id] || {}, { apiKey: k[id] || "" });
    return cfg;
  }
  function resolve(over = {}) {
    const cfg = settings();
    const provider = over.provider || cfg.provider;
    if (provider === "mock") return { provider, model: "mock", apiKey: "", baseUrl: "" };
    if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}".`);
    const s = Object.assign({ provider }, cfg[provider], { keySource: cfg[provider].apiKey ? (onDrive() ? "your Google Drive" : remembered() ? "this browser (remembered)" : "this browser session") : "" });
    if (over.model) s.model = over.model;
    return s;
  }
  function publicConfig() {
    const cfg = settings();
    const out = { provider: cfg.provider, ready: false, providers: {}, web: true, drive: onDrive(), remember: remembered() };
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const r = resolve({ provider: id });
      out.providers[id] = { name: p.name, needsKey: p.needsKey, models: p.models, keyUrl: p.keyUrl,
        model: r.model, baseUrl: r.baseUrl || null, keySet: !!r.apiKey, keyHint: r.apiKey ? "…" + r.apiKey.slice(-4) : "", keyFromEnv: false };
    }
    const eff = (() => { try { return resolve(); } catch (e) { return null; } })();
    if (eff) out.ready = eff.provider === "mock" || !PROVIDERS[eff.provider].needsKey || !!eff.apiKey;
    out.model = eff ? eff.model : null;
    return out;
  }
  function saveConfig(patch) {
    const saved = savedPrefs();
    const k = keys();
    if (patch.provider) {
      if (!PROVIDERS[patch.provider] && patch.provider !== "mock") throw new Error(`Unknown provider "${patch.provider}"`);
      saved.provider = patch.provider;
    }
    for (const id of Object.keys(PROVIDERS)) {
      const p = patch[id];
      if (!p) continue;
      saved[id] = saved[id] || {};
      if (typeof p.model === "string" && p.model.trim()) saved[id].model = p.model.trim();
      if (typeof p.baseUrl === "string" && p.baseUrl.trim()) saved[id].baseUrl = p.baseUrl.trim().replace(/\/+$/, "");
      if (typeof p.apiKey === "string" && p.apiKey.trim()) k[id] = p.apiKey.trim();
      if (p.clearKey) delete k[id];
    }
    setPrefs(saved);
    setKeys(k, patch.remember === undefined ? remembered() : !!patch.remember);
  }
  async function complete(opts) {
    const s = resolve({ provider: opts.provider, model: opts.model });
    L.assertReady(s, "Open AI settings (the AI button at the top) and paste your key.");
    return L.complete(s, opts, { onOllamaModel: (m) => saveConfig({ ollama: { model: m } }) });
  }

  // ---------------------------------------------------------------- the tutor (same prompts as the server)
  async function locate(addr) {
    const world = addr.track === "READ" ? { fund: await loadFund() } : addr.track === "DSA" ? { dsa: await loadDsa() } : { days: await loadDays() };
    const f = C.findItem(addr, world);
    if (!f) throw new Error(`${C.addrLabel(addr)} not found.`);
    return f;
  }
  const getItem = async (addr) => { const f = await locate(addr); return C.itemView(addr, f.item, f.meta); };
  async function updateItem(addr, fn) {
    const f = await locate(addr);
    fn(f.item);
    await saveDoc(f.kind, f.doc);
    return f.item;
  }
  async function loadForPrompt(addr) {
    const it = await getItem(addr);
    const { text, images } = await promptImages(it.userAnswer);
    return { it: Object.assign({}, it, { rawAnswer: it.userAnswer, userAnswer: text }), imgs: images };
  }

  async function evaluate(addr) {
    if (addr.track === "READ") throw Object.assign(new Error("Chapters are for reading; there's no answer to evaluate. Ask the tutor instead."), { code: "NO_ANSWER" });
    const { it, imgs } = await loadForPrompt(addr);
    if (!it.rawAnswer.trim()) throw Object.assign(new Error(`${it.label}: no answer saved yet.`), { code: "NO_ANSWER" });
    const meta = {};
    const text = await complete({
      meta, system: C.evaluateSystem(it),
      messages: [{ role: "user", content: C.withImages(C.contextBlock(it, { includeVerdict: false }) + C.evaluateRequest, imgs, C.IMG_NOTE(imgs.length)) }],
    });
    let verdict = text.trim();
    if (!verdict) throw new Error("The model returned an empty evaluation.");
    if (meta.imagesDropped) verdict += C.imagesDroppedNote(imgs.length, resolve().model);
    const answerAtStart = it.rawAnswer;
    const item = await updateItem(addr, (t) => {
      if (t.userAnswer !== answerAtStart) throw new Error("Your answer changed while it was being evaluated. Run evaluate again.");
      t.answerEvaluation = verdict;
      t.answerEvaluatedAt = new Date().toISOString();
    });
    return displayItem(item);
  }

  async function clarify(addr, question, { voice, signal, onToken }) {
    const q = String(question || "").trim();
    if (!q) throw new Error("Ask a question first.");
    const { it, imgs } = await loadForPrompt(addr);
    const history = it.chat.slice(-C.HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
    const asked = new Date().toISOString();
    const reply = await complete({ signal, onToken, system: C.chatSystemFor(it, voice), messages: [...history, { role: "user", content: C.withImages(q, imgs, C.imageRefNote(imgs)) }] });
    const turns = [{ role: "user", content: q, at: asked }, { role: "assistant", content: reply.trim(), at: new Date().toISOString() }];
    await updateItem(addr, (t) => { t.chat = [...(Array.isArray(t.chat) ? t.chat : []), ...turns]; });
    return reply.trim();
  }

  async function answerDoubts(addr) {
    const { it, imgs } = await loadForPrompt(addr);
    const open = C.openDoubts(it.notes);
    if (!open.length) return 0;
    const system = C.doubtSystem(it);
    const answers = [];
    for (const d of open) {
      const a = await complete({ system, messages: [{ role: "user", content: C.withImages(d.question, imgs, C.imageRefNote(imgs)) }] });
      answers.push({ line: d.line, answer: a });
    }
    await updateItem(addr, (t) => { t.notes = C.insertDoubtAnswers(t.notes, answers); });
    return answers.length;
  }

  function openaiVoice() {
    const s = resolve({ provider: "openai" });
    if (!s.apiKey) throw Object.assign(new Error(L.NO_VOICE_KEY), { code: "NO_KEY", status: 400 });
    return { key: s.apiKey, base: String(s.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") };
  }

  // ---------------------------------------------------------------- routes
  const aiFail = (e) => fail(e, e.code === "NO_KEY" ? 412 : e.code === "NO_ANSWER" ? 400 : 502);
  const addrFrom = (b) => C.parseAddress(`${b.track} ${b.number}`);
  async function bodyOf(init) {
    const b = init && init.body;
    if (b == null) return {};
    if (typeof b === "string") { try { return JSON.parse(b); } catch (e) { return {}; } }
    return b;
  }

  async function tracks() {
    const out = { LLD: [], HLD: [], AI: [] };
    for (const day of await loadDays()) {
      (day.topics || []).forEach((t, i) => {
        (out[t.category] = out[t.category] || []).push({ day: day.day, topicIndex: i, number: t.number, title: t.title, concepts: t.concepts,
          answered: !!(t.userAnswer && t.userAnswer.trim()), evaluated: !!t.answerEvaluation });
      });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.number - b.number);
    return out;
  }
  async function progressSummary() {
    let total = 0, answered = 0, evaluated = 0, generated = 0;
    const tally = (t) => { total++; if (t.userAnswer && t.userAnswer.trim()) answered++; if (t.answerEvaluation) evaluated++; };
    for (const d of await loadDays()) for (const t of d.topics || []) { tally(t); generated++; }
    const planned = (await meta()).plannedTopics || 0;
    if (planned > generated) total += planned - generated;
    for (const tp of (await loadDsa()).topics || []) for (const p of tp.problems || []) tally(p);
    const pct = (x) => (total ? Math.round((x / total) * 1000) / 10 : 0);
    return { totalTopics: total, answered, evaluated, answeredPct: pct(answered), evaluatedPct: pct(evaluated) };
  }

  async function saveField(kind, doc, item, field, val) {
    if (typeof val !== "string") throw Object.assign(new Error(`${field} must be a string`), { status: 400 });
    if (field === "userAnswer") {
      item.userAnswer = await toStored(val);
      item.answerEvaluation = null; item.answerEvaluatedAt = null;
    } else item[field] = val;
    await saveDoc(kind, doc);
    return displayItem(clone(item));
  }

  // NDJSON stream like the server's /api/ai/chat.
  function chatStream(addr, b, signal) {
    let ctl;
    const enc = new TextEncoder();
    const send = (o) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
    const stream = new ReadableStream({
      start(c) {
        ctl = c;
        clarify(addr, b.message, { voice: !!b.voice, signal, onToken: (t) => send({ t }) })
          .then(() => { send({ done: true }); ctl.close(); })
          .catch((e) => {
            if (signal && signal.aborted) { try { ctl.error(new DOMException("Aborted", "AbortError")); } catch (x) {} return; }
            send({ error: e.message, code: e.code || null }); ctl.close();
          });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  }

  // ---------------------------------------------------------------- KB Pro gate (pro.js)
  // Writing answers, AI grading, the tutor and #doubt answers need Pro beyond the free topics.
  // Reading, notes and read marks are always free.
  const Pro = window.KBPro || { allowed: () => true, isPro: () => true, enabled: () => false };
  async function dsaPatternOf(number) {
    let n = 0;
    const topics = (await getStatic("data/dsa.json")).topics || [];
    for (let i = 0; i < topics.length; i++) { n += (topics[i].problems || []).length; if (number <= n) return i; }
    return topics.length;
  }
  async function gate(addr) {
    if (!addr || !Pro.enabled() || Pro.isPro()) return null;
    const pat = addr.track === "DSA" ? await dsaPatternOf(addr.number) : 0;
    if (Pro.allowed(addr, () => pat)) return null;
    const e = Pro.lockedError();
    setTimeout(() => Pro.open(e.message), 0);
    return json({ error: e.message, code: e.code }, 402);
  }

  async function handle(method, path, query, init) {
    const live = status === "connected";
    // ---- reading ----
    if (method === "GET") {
      if (path === "/api/tracks") return json(await tracks());
      if (path === "/api/dsa") {
        const d = await loadDsa();
        if (live) for (const tp of d.topics || []) for (const p of tp.problems || []) await displayItem(p);
        return json(d);
      }
      if (path === "/api/fundamentals") return json(await loadFund());
      const m = /^\/api\/days\/(\d+)$/.exec(path);
      if (m) {
        let d;
        try { d = await loadDay(Number(m[1])); } catch (e) { return json({ error: `day ${m[1]} not generated yet` }, 404); }
        if (live) for (const t of d.topics || []) await displayItem(t);
        return json(d);
      }
      if (path === "/api/progress") return json(live ? await progressSummary() : { totalTopics: 0, answered: 0, evaluated: 0, answeredPct: 0, evaluatedPct: 0 });
      if (path === "/api/ai/config") return json(live ? publicConfig() : { ready: false, demo: true, provider: null, model: null, providers: {} });
      if (path === "/api/ai/ollama-models") return json({ models: await L.listOllamaModels(query.get("baseUrl") || resolve({ provider: "ollama" }).baseUrl) });
      return json({ error: "Not available on the website." }, 404);
    }
    if (!live) return readOnly();

    // ---- writing ----
    if (path === "/api/images") {
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body || ""]);
      const type = String(new Headers(init.headers || {}).get("content-type") || blob.type || "").split(";")[0].trim().toLowerCase();
      const p = await saveImageBlob(blob, type);
      return json({ url: await blobUrlFor(p) });
    }
    if (path === "/api/voice/transcribe") {
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body || ""]);
      if (!blob.size) return json({ error: "No audio received." }, 400);
      return json({ text: await L.transcribe(openaiVoice(), blob, blob.type || "audio/webm", query.get("lang")) });
    }
    const b = await bodyOf(init);
    if (path === "/api/voice/speak") return L.speak(openaiVoice(), b.text, b.voice);

    if (path === "/api/fundamentals/read") {
      const doc = await loadFund();
      const it = (doc.groups || []).flatMap((g) => g.items || []).find((x) => x.id === b.id);
      if (!it) return json({ error: "unknown article" }, 400);
      it.readAt = b.read ? new Date().toISOString() : null;
      await saveDoc("fund", doc);
      return json({ ok: true, readAt: it.readAt });
    }
    let m = /^\/api\/days\/(\d+)\/(notes|answer)$/.exec(path);
    if (m) {
      let day;
      try { day = await loadDay(Number(m[1])); } catch (e) { return json({ error: `day ${m[1]} not generated yet` }, 404); }
      const t = day.topics && day.topics[b.topicIndex];
      if (!t) return json({ error: "bad topicIndex" }, 400);
      const field = m[2] === "notes" ? "notes" : "userAnswer";
      if (field === "userAnswer") { const locked = await gate({ track: t.category, number: t.number }); if (locked) return locked; }
      return json({ ok: true, topic: await saveField("day", day, t, field, b[field]) });
    }
    m = /^\/api\/dsa\/(notes|answer)$/.exec(path);
    if (m) {
      const dsa = await loadDsa();
      const p = dsa.topics && dsa.topics[b.topicIndex] && dsa.topics[b.topicIndex].problems && dsa.topics[b.topicIndex].problems[b.problemIndex];
      if (!p) return json({ error: "bad topicIndex/problemIndex" }, 400);
      const field = m[1] === "notes" ? "notes" : "userAnswer";
      if (field === "userAnswer" && Pro.enabled() && !Pro.isPro() && !Pro.allowed({ track: "DSA" }, () => b.topicIndex)) { const locked = await gate({ track: "DSA", number: Infinity }); if (locked) return locked; }
      return json({ ok: true, problem: await saveField("dsa", dsa, p, field, b[field]) });
    }

    if (path === "/api/ai/config") { saveConfig(b); return json(publicConfig()); }
    if (path === "/api/ai/test") {
      try { const r = await complete({ system: "Reply with exactly: OK", messages: [{ role: "user", content: "ping" }], maxTokens: 20 }); return json({ ok: true, reply: r.trim().slice(0, 60) }); }
      catch (e) { return aiFail(e); }
    }
    if (/^\/api\/ai\/(evaluate|doubts|chat)$/.test(path)) {
      let addr = null;
      try { addr = addrFrom(b); } catch (e) {}
      const locked = await gate(addr);
      if (locked) return locked;
    }
    if (path === "/api/ai/evaluate") {
      try { return json({ ok: true, item: await evaluate(addrFrom(b)) }); } catch (e) { return aiFail(e); }
    }
    if (path === "/api/ai/doubts") {
      try {
        const addr = addrFrom(b);
        const answered = await answerDoubts(addr);
        return json({ ok: true, answered, item: await displayItem(await getItem(addr)) });
      } catch (e) { return aiFail(e); }
    }
    if (path === "/api/ai/chat/clear") { await updateItem(addrFrom(b), (t) => { t.chat = []; }); return json({ ok: true }); }
    if (path === "/api/ai/chat") {
      let addr;
      try { addr = addrFrom(b); await getItem(addr); } catch (e) { return json({ error: e.message }, 400); }
      return chatStream(addr, b, init.signal);
    }
    return json({ error: "Not available on the website." }, 404);
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith("/api/")) return realFetch(input, init);
    const u = new URL(url, location.origin);
    const method = String((init && init.method) || "GET").toUpperCase();
    return boot.then(() => handle(method, u.pathname, u.searchParams, init || {}))
      .catch((e) => (e.name === "AbortError" ? Promise.reject(e) : fail(e)));
  };


  // ---------------------------------------------------------------- top bar: account / folder status
  const FOLDER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const G_ICON = '<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
  const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function modal(id) {
    let dlg = document.getElementById(id);
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = id; dlg.className = "ai-dialog folder-dialog"; document.body.appendChild(dlg); }
    return dlg;
  }

  function folderDialog() {
    const dlg = modal("folderDialog");
    const n = progress.size;
    dlg.innerHTML = `<h2>Your data folder</h2>
      <p style="margin-top:0">Saving to <b>${escH(dir.name)}</b> on this computer: ${n} topic${n === 1 ? "" : "s"} with saved work${libs.length ? `, ${libs.length} librar${libs.length === 1 ? "y" : "ies"}` : ""}.
        Nothing you write is uploaded anywhere; only AI requests go to the provider you chose.</p>
      <h3>Sync between devices</h3>
      <p class="small">Make the folder a <b>private</b> git repository and commit when you like:</p>
      <pre><code>cd ${escH(dir.name)}
git add -A && git commit -m "KB progress" && git push</code></pre>
      <p class="small">On another computer, clone it (or <code>git pull</code>), open this site and choose the same folder. The local app (<code>npm start</code>) reads the same folder too.${D.available ? " Or sign in with Google instead to sync automatically, phones included." : ""}</p>
      <div class="dlg-actions"><button type="button" class="btn" data-act="disconnect">Stop using this folder</button><span class="spacer"></span>
        <button type="button" class="btn" data-act="switch">Choose another folder</button>
        <button type="button" class="btn primary" data-act="close">Done</button></div>`;
    dlg.onclick = async (e) => {
      const act = e.target.closest("[data-act]") && e.target.closest("[data-act]").dataset.act;
      if (act === "close") dlg.close();
      if (act === "disconnect" && confirm("Stop using this folder on this site? Your files stay where they are.")) { await disconnect(); location.reload(); }
      if (act === "switch") { try { if (await chooseFolder()) location.reload(); } catch (er) { alert(er.message); } }
    };
    dlg.showModal();
  }

  const ago = (t) => { if (!t) return "not yet"; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  function syncText(s) {
    if (s.sync === "syncing") return "Syncing…";
    if (s.sync === "paused") return s.pending ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting · tap to sync` : "Tap to sync";
    if (s.sync === "offline") return "Offline · saved on this device";
    if (s.sync === "error") return "Sync problem · tap to retry";
    return "Synced";
  }

  function accountDialog() {
    const dlg = modal("accountDialog");
    const render = () => {
      const s = D.state(), u = s.user || {};
      const n = progress.size;
      dlg.innerHTML = `<h2>Your account</h2>
        <div class="acct-row">${u.picture ? `<img class="acct-pic" src="${escH(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="acct-pic acct-initial">${escH((u.name || u.email || "?")[0].toUpperCase())}</span>`}
          <div><b>${escH(u.name || "")}</b><div class="muted small">${escH(u.email || "")}</div></div></div>
        <p class="small">Your answers, notes, tutor chats and AI settings (including your API key) are saved in KB's private folder in <b>your</b> Google Drive.
          KB can't see anything else in your Drive, and there is no KB server: only you, and the AI provider you pick, see your work.</p>
        <p class="small"><b>${escH(syncText(s))}</b> · ${n} topic${n === 1 ? "" : "s"} with saved work · last synced ${escH(ago(s.lastSynced))}${s.error && s.sync === "error" ? `<br><span class="err-txt">${escH(s.error)}</span>` : ""}</p>
        ${Pro.enabled() ? `<p class="small">${Pro.isPro() ? "<b>KB Pro</b>: every topic unlocked." : `Free plan: the first ${Pro.free.designPerTrack} topics of each design track and the first ${Pro.free.dsaPatterns} DSA patterns. <a href="#" data-act="pro">Unlock everything</a>`}</p>` : ""}
        <div class="dlg-actions"><button type="button" class="btn" data-act="signout">Sign out</button>
          <button type="button" class="btn" data-act="export">Export</button><span class="spacer"></span>
          <button type="button" class="btn" data-act="sync">Sync now</button>
          <button type="button" class="btn primary" data-act="close">Done</button></div>`;
    };
    render();
    const off = D.onChange(() => dlg.open && render());
    dlg.addEventListener("close", off, { once: true });
    dlg.onclick = async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      e.preventDefault();
      const act = el.dataset.act;
      if (act === "close") dlg.close();
      if (act === "pro") { dlg.close(); Pro.open(); }
      if (act === "sync") D.syncNow().catch((er) => alert(er.message));
      if (act === "export") {
        const blob = new Blob([JSON.stringify(D.exportData(), null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `kb-data-${new Date().toISOString().slice(0, 10)}.json` });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      if (act === "signout") {
        const s = D.state();
        if (s.pending && !confirm(`${s.pending} change(s) haven't reached Google Drive yet and will be lost on this device. Sign out anyway?`)) return;
        if (!s.pending && !confirm("Sign out of KB on this device? Your work stays in your Google Drive.")) return;
        await D.signOut(); location.reload();
      }
    };
    dlg.showModal();
  }

  async function googleSignIn(btn) {
    if (btn) { btn.disabled = true; btn.querySelector("span").textContent = "Signing in…"; }
    try { await D.signIn(); location.reload(); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "Continue with Google"; }
      if (!/closed/i.test(e.message)) alert(e.message);
    }
  }

  function banner() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const b = document.createElement("div");
    b.className = "demo-banner";
    const gh = `<a href="${REPO}" target="_blank" rel="noopener" class="gh-link">GitHub &#8599;</a>`;
    const gBtn = `<button type="button" class="btn primary small-btn g-btn" id="googleBtn" title="Save your work to your Google Drive and use KB on any device">${G_ICON}<span>Continue with Google</span></button>`;
    const folderLink = CAN_PICK ? `<button type="button" class="link-btn" id="folderBtn" title="Save into a kb-data folder on this computer instead">${FOLDER_ICON}<span>Use a folder</span></button>` : "";
    if (status === "connected" && mode === "drive") {
      const u = D.user || {};
      b.innerHTML = `<button type="button" class="folder-chip acct-chip" id="acctChip" data-sync="idle" title="Your account and sync">
        ${u.picture ? `<img class="acct-pic sm" src="${escH(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="acct-pic sm acct-initial">${escH((u.name || u.email || "?")[0].toUpperCase())}</span>`}<span class="sync-txt">Synced</span></button>`;
    } else if (status === "connected") {
      b.innerHTML = `<button type="button" class="folder-chip" id="folderChip" title="Your answers and notes are saved in this folder">${FOLDER_ICON}<span>${escH(dir.name)}</span></button>`;
    } else if (status === "needs-permission") {
      b.innerHTML = `<button type="button" class="btn primary small-btn" id="reopenBtn">${FOLDER_ICON}<span>Reopen ${escH(savedHandle.name)}</span></button>${D.available ? gBtn : ""}`;
    } else if (D.available) {
      b.innerHTML = `${gBtn}${folderLink}${gh}`;
    } else if (CAN_PICK) {
      b.innerHTML = `<span class="muted-txt">Read-only demo</span><button type="button" class="btn primary small-btn" id="folderBtn" title="Save your answers, notes and tutor chats into a folder on this computer">${FOLDER_ICON}<span>Use my kb-data folder</span></button>${gh}`;
    } else {
      b.innerHTML = `<span class="muted-txt" title="Saving to a folder needs Chrome or Edge on a computer">Read-only · open in Chrome or Edge on a computer to save your work</span>${gh}`;
    }
    bar.insertBefore(b, document.getElementById("aiButton") || document.getElementById("themeToggle") || null);

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("googleBtn", (e) => googleSignIn(e.currentTarget));
    on("folderBtn", async () => { try { if (await chooseFolder()) location.reload(); } catch (e) { alert(`Couldn't open the folder: ${e.message}`); } });
    on("reopenBtn", async () => { try { if (await reconnect()) location.reload(); } catch (e) { alert(`Couldn't open the folder: ${e.message}`); } });
    on("folderChip", folderDialog);
    const chip = document.getElementById("acctChip");
    if (chip) {
      const paint = (s) => { chip.dataset.sync = s.sync; chip.querySelector(".sync-txt").textContent = syncText(s); };
      paint(D.state());
      D.onChange(paint);
      chip.addEventListener("click", () => {
        const s = D.state();
        // An expired Google token can only be renewed from a tap, so the tap renews it first.
        if (s.sync === "paused" || s.sync === "error") D.resume().catch((er) => { if (!/closed/i.test(er.message)) accountDialog(); });
        else accountDialog();
      });
    }
  }

  // ---------------------------------------------------------------- installable app (PWA)
  if ("serviceWorker" in navigator && location.protocol === "https:" && !window.__kbTestDir) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("KB: offline cache unavailable:", e.message)));
  }

  // ---------------------------------------------------------------- start
  const boot = (async () => {
    try {
      // Tests can hand in a folder (e.g. the browser's private file system) instead of using the picker.
      const test = window.__kbTestDir ? await window.__kbTestDir : null;
      if (test) await connect(test);
      else if (D.available && (await D.boot())) await connectDrive();
      else if (CAN_PICK) {
        savedHandle = await kv.get("dir");
        if (savedHandle) {
          const p = await savedHandle.queryPermission({ mode: "readwrite" });
          if (p === "granted") await connect(savedHandle);
          else status = "needs-permission";
        }
      }
    } catch (e) {
      console.warn("KB: couldn't open your saved work:", e);
      status = savedHandle ? "needs-permission" : "none";
    }
    // Where the KB Pro licence is kept: your Drive settings when signed in, else this browser.
    if (mode === "drive") Pro.useStore && Pro.useStore((k) => D.settings.get(k, null), (k, v) => D.settings.set(k, v), () => (D.user && D.user.email) || "");
    if (Pro.recheck) Pro.recheck();
    window.KB_DEMO = status === "connected" ? null : { repo: REPO, google: !!D.available };
    window.KB_WEB = { status: status === "none" && !CAN_PICK && !D.available ? "unsupported" : status, mode, folder: dir ? dir.name : null, repo: REPO, google: !!D.available };
  })();
  window.KB_BOOT = boot;
  window.KB_SIGN_IN = () => googleSignIn(document.getElementById("googleBtn"));
  const onReady = () => boot.then(banner);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else onReady();
})();
