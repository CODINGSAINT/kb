// KB on the web: sign in with Google and keep your work in your own Google Drive.
//
// What is stored, all inside KB's private app folder in the learner's Drive (scope drive.appdata:
// KB can't see any other file in their Drive, and other apps can't see these):
//   progress.json   every answer, verdict, note, tutor chat and read mark, keyed by progress id
//   settings.json   AI provider, model and API keys, and the KB Pro licence, so they follow you to every device
//   images/<hash>   images pasted into answers
//
// Everything is mirrored in this browser (IndexedDB), so the app opens instantly and keeps working offline.
// Changes are written to the mirror first and uploaded to Drive a moment later. Google access tokens last
// an hour and a page can't renew one without a tap, so when the token has run out the chip at the top says
// "Tap to sync" and nothing is lost in the meantime.
//
// To web.js this looks like a folder: readFile / writeFile / removeFile / entries, with progress/<id>.json
// mapped onto progress.json.
(function () {
  "use strict";
  const CFG = (window.KB_SITE && window.KB_SITE.googleClientId) || "";
  const SCOPE = "openid email profile https://www.googleapis.com/auth/drive.appdata";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const LS_USER = "kb-drive-user", LS_TOKEN = "kb-drive-token";
  const PROGRESS = "progress.json", SETTINGS = "settings.json";

  const local = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---------------------------------------------------------------- IndexedDB mirror
  function db() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("kb-drive", 1);
      open.onupgradeneeded = () => { open.result.createObjectStore("kv"); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => { d.close(); resolve(req && req.result); };
      tx.onerror = () => { d.close(); reject(tx.error); };
    });
  }
  const mirror = {
    get: (k) => idb("readonly", (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => idb("readwrite", (s) => s.put(v, k)),
    del: (k) => idb("readwrite", (s) => s.delete(k)),
    clear: () => idb("readwrite", (s) => s.clear()),
  };

  // ---------------------------------------------------------------- state
  // Each synced JSON file (progress.json, settings.json) is held as
  //   { data: {...}, id, modified, dirty: Set of top-level keys changed here and not yet uploaded }
  const files = {};
  let user = local.get(LS_USER, null); // { email, name, picture }
  let token = local.get(LS_TOKEN, null); // { value, exp }
  let tokenClient = null, gisReady = null;
  let sync = "idle";                   // idle | syncing | paused | offline | error
  let lastError = "";
  const listeners = new Set();
  const imageIds = new Map();          // "images/x.png" -> Drive file id
  const pendingImages = new Set();     // image names written here, not uploaded yet
  const emit = () => listeners.forEach((f) => { try { f(api.state()); } catch (e) {} });
  const setSync = (s, err) => { sync = s; lastError = err || ""; emit(); };

  const tokenValid = () => !!(token && token.value && token.exp > Date.now() + 60000);

  // ---------------------------------------------------------------- Google sign-in (Google Identity Services)
  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisReady = null; reject(new Error("Couldn't load Google sign-in. Check your connection.")); };
      document.head.appendChild(s);
    });
    return gisReady;
  }
  // Must be called straight from a click: the browser only allows the Google window then.
  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      const go = () => {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CFG, scope: SCOPE,
          callback: (r) => {
            if (r.error) return reject(new Error(r.error_description || r.error));
            if (!google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/drive.appdata"))
              return reject(Object.assign(new Error("KB needs permission to keep your progress in Google Drive. Sign in again and leave the Drive box ticked."), { code: "SCOPE" }));
            token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
            local.set(LS_TOKEN, token);
            resolve(token.value);
          },
          error_callback: (e) => reject(new Error(e && e.type === "popup_closed" ? "Sign-in window was closed." : (e && e.message) || "Google sign-in failed.")),
        });
        tokenClient.requestAccessToken({ prompt, hint: user ? user.email : undefined });
      };
      if (window.google && google.accounts && google.accounts.oauth2) go();
      else loadGis().then(go, reject);
    });
  }

  // ---------------------------------------------------------------- Drive REST
  async function gfetch(url, init = {}) {
    if (!tokenValid()) throw Object.assign(new Error("Google sign-in expired. Tap the sync chip to continue."), { code: "AUTH" });
    const headers = Object.assign({}, init.headers || {}, { Authorization: `Bearer ${token.value}` });
    let res;
    try { res = await fetch(url, Object.assign({}, init, { headers })); }
    catch (e) { throw Object.assign(new Error("You're offline. Changes are kept on this device and synced later."), { code: "OFFLINE" }); }
    if (res.status === 401) { token = null; local.set(LS_TOKEN, null); throw Object.assign(new Error("Google sign-in expired."), { code: "AUTH" }); }
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
      throw Object.assign(new Error(`Google Drive error ${res.status}: ${msg}`), { status: res.status });
    }
    return res;
  }
  async function listAll() {
    const out = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({ spaces: "appDataFolder", pageSize: "1000", fields: "nextPageToken,files(id,name,modifiedTime)" });
      if (pageToken) q.set("pageToken", pageToken);
      const j = await (await gfetch(`${API}/files?${q}`)).json();
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || "";
    } while (pageToken);
    return out;
  }
  const download = (id) => gfetch(`${API}/files/${id}?alt=media`);
  async function meta(id) { return (await gfetch(`${API}/files/${id}?fields=id,modifiedTime`)).json(); }
  async function create(name, body, type) {
    const boundary = "kb" + Math.random().toString(36).slice(2);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`;
    const blob = new Blob([head, body, `\r\n--${boundary}--`]);
    return (await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: blob })).json();
  }
  async function update(id, body, type) {
    return (await gfetch(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, { method: "PATCH", headers: { "Content-Type": type }, body })).json();
  }

  // ---------------------------------------------------------------- the two JSON files
  async function loadMirror() {
    for (const name of [PROGRESS, SETTINGS]) {
      const m = await mirror.get(name);
      files[name] = m ? { data: m.data || {}, id: m.id || null, modified: m.modified || null, dirty: new Set(m.dirty || []) } : { data: {}, id: null, modified: null, dirty: new Set() };
    }
    for (const n of (await mirror.get("pendingImages")) || []) pendingImages.add(n);
    for (const [n, id] of Object.entries((await mirror.get("imageIds")) || {})) imageIds.set(n, id);
  }
  const saveMirror = (name) => { const f = files[name]; return mirror.set(name, { data: f.data, id: f.id, modified: f.modified, dirty: [...f.dirty] }); };

  // Remote copy wins, except for the keys changed on this device since the last upload.
  function merge(f, remote) {
    const out = Object.assign({}, remote || {});
    for (const k of f.dirty) { if (k in f.data) out[k] = f.data[k]; else delete out[k]; }
    f.data = out;
  }
  async function pullFile(name, remoteMeta) {
    const f = files[name];
    if (!remoteMeta) return;
    f.id = remoteMeta.id;
    if (f.modified === remoteMeta.modifiedTime) return;
    let remote = {};
    try { remote = await (await download(remoteMeta.id)).json(); } catch (e) { if (e.code) throw e; remote = {}; }
    merge(f, remote);
    f.modified = remoteMeta.modifiedTime;
    await saveMirror(name);
  }
  async function pushFile(name) {
    const f = files[name];
    if (!f.dirty.size && f.id) return;
    if (f.id) { // someone else (another device) may have saved since we last looked
      const m = await meta(f.id).catch((e) => { if (e.status === 404) return null; throw e; });
      if (!m) f.id = null;
      else if (m.modifiedTime !== f.modified) await pullFile(name, m);
    }
    const sent = new Set(f.dirty);
    const body = JSON.stringify(f.data);
    const r = f.id ? await update(f.id, body, "application/json") : await create(name, body, "application/json");
    f.id = r.id; f.modified = r.modifiedTime;
    for (const k of sent) f.dirty.delete(k);
    await saveMirror(name);
  }

  // ---------------------------------------------------------------- sync loop
  let timer = null, running = null, again = false;
  function schedule(ms = 1200) {
    clearTimeout(timer);
    timer = setTimeout(() => { flush().catch(() => {}); }, ms);
  }
  async function flush(full) {
    if (!user) return;
    if (running) { again = true; return running; }
    if (!tokenValid()) { setSync("paused"); return; }
    if (!navigator.onLine) { setSync("offline"); return; }
    running = (async () => {
      setSync("syncing");
      try {
        if (full) {
          const list = await listAll();
          const byName = new Map(list.map((x) => [x.name, x]));
          for (const x of list) if (x.name.startsWith("images/")) imageIds.set(x.name, x.id);
          await mirror.set("imageIds", Object.fromEntries(imageIds));
          await pullFile(PROGRESS, byName.get(PROGRESS));
          await pullFile(SETTINGS, byName.get(SETTINGS));
        }
        for (const n of [...pendingImages]) {
          const blob = await mirror.get("img:" + n);
          if (blob && !imageIds.has(n)) { const r = await create(n, blob, blob.type || "application/octet-stream"); imageIds.set(n, r.id); await mirror.set("imageIds", Object.fromEntries(imageIds)); }
          pendingImages.delete(n);
          await mirror.set("pendingImages", [...pendingImages]);
        }
        await pushFile(SETTINGS);
        await pushFile(PROGRESS);
        lastSynced = Date.now();
        setSync("idle");
      } catch (e) {
        setSync(e.code === "AUTH" ? "paused" : e.code === "OFFLINE" ? "offline" : "error", e.message);
        throw e;
      } finally {
        running = null;
        if (again) { again = false; schedule(300); }
      }
    })();
    return running;
  }
  let lastSynced = 0;
  const pending = () => (files[PROGRESS] ? files[PROGRESS].dirty.size : 0) + (files[SETTINGS] ? files[SETTINGS].dirty.size : 0) + pendingImages.size;

  // ---------------------------------------------------------------- the folder-like view for web.js
  const progressId = (parts) => (parts.length === 2 && parts[0] === "progress" && parts[1].endsWith(".json") ? parts[1].slice(0, -5) : null);
  function setKey(name, key, value) {
    const f = files[name];
    if (value === undefined) delete f.data[key]; else f.data[key] = value;
    f.dirty.add(key);
    saveMirror(name);
    schedule();
  }
  const fsView = {
    name: "Google Drive",
    async readFile(parts) {
      const id = progressId(parts);
      if (id) return id in files[PROGRESS].data ? new Blob([JSON.stringify(files[PROGRESS].data[id], null, 2)], { type: "application/json" }) : null;
      if (parts[0] === "images" && parts.length === 2) {
        const n = "images/" + parts[1];
        const cached = await mirror.get("img:" + n);
        if (cached) return cached;
        const fid = imageIds.get(n);
        if (!fid || !tokenValid()) return null;
        try {
          const blob = await (await download(fid)).blob();
          await mirror.set("img:" + n, blob);
          return blob;
        } catch (e) { return null; }
      }
      return null; // README.md, library/: not used on Drive
    },
    async readText(parts) { const f = await this.readFile(parts); return f ? f.text() : null; },
    async writeFile(parts, data) {
      const id = progressId(parts);
      if (id) { setKey(PROGRESS, id, JSON.parse(typeof data === "string" ? data : await new Response(data).text())); return; }
      if (parts[0] === "images" && parts.length === 2) {
        const n = "images/" + parts[1];
        const blob = data instanceof Blob ? data : new Blob([data]);
        await mirror.set("img:" + n, blob);
        if (!imageIds.has(n)) { pendingImages.add(n); await mirror.set("pendingImages", [...pendingImages]); schedule(); }
      }
      // anything else (README.md) is folder-only
    },
    async removeFile(parts) {
      const id = progressId(parts);
      if (id && id in files[PROGRESS].data) setKey(PROGRESS, id, undefined);
    },
    async entries(parts) {
      if (parts.length === 1 && parts[0] === "progress") {
        return Object.keys(files[PROGRESS].data).map((id) => [`${id}.json`, { kind: "file", getFile: async () => new Blob([JSON.stringify(files[PROGRESS].data[id])]) }]);
      }
      return [];
    },
  };

  // ---------------------------------------------------------------- public API
  const api = {
    available: !!CFG,
    get user() { return user; },
    fs: fsView,
    state() { return { signedIn: !!user, user, sync, error: lastError, pending: pending(), tokenValid: tokenValid(), lastSynced }; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Synced settings (AI provider/keys, licence). Small, so read whole and write by top-level key.
    settings: {
      get(key, d) { const v = files[SETTINGS] && files[SETTINGS].data[key]; return v === undefined ? d : JSON.parse(JSON.stringify(v)); },
      set(key, value) { setKey(SETTINGS, key, value); },
    },

    // On page load: true if this browser has signed in before (the mirror is ready to use).
    async boot() {
      if (CFG) loadGis().catch(() => {}); // ready before the first tap: the Google window must open inside the click
      if (!CFG || !user) return false;
      await loadMirror();
      if (tokenValid()) flush(true).catch(() => {}); else setSync("paused");
      window.addEventListener("online", () => schedule(200));
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && tokenValid()) flush(true).catch(() => {}); });
      return true;
    },

    // First sign-in (from a click). Fetches who you are, then everything already in your Drive.
    async signIn() {
      if (!CFG) throw new Error("Google sign-in isn't set up on this site.");
      await requestToken("select_account");
      const me = await (await gfetch("https://www.googleapis.com/oauth2/v3/userinfo")).json();
      const changed = user && user.email !== me.email;
      if (changed) await mirror.clear();
      user = { email: me.email, name: me.name || me.email, picture: me.picture || "" };
      local.set(LS_USER, user);
      await loadMirror();
      await flush(true);
      return user;
    },

    // "Tap to sync": renew the hour-long token (a quick Google window, no questions if already allowed).
    async resume() {
      await requestToken("");
      return flush(true);
    },
    syncNow() { return tokenValid() ? flush(true) : api.resume(); },

    // For the KB Pro payment server, which checks with Google who you are. Call from a click:
    // an expired token is renewed with the quick Google window.
    async freshToken() {
      if (!user) throw Object.assign(new Error("Sign in with Google first: KB Pro is tied to your Google account."), { code: "AUTH" });
      if (!tokenValid()) await requestToken("");
      return token.value;
    },
    accessToken() { return tokenValid() ? token.value : ""; },

    async signOut() {
      try { if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token.value, () => {}); } catch (e) {}
      token = null; user = null;
      local.set(LS_TOKEN, null); local.set(LS_USER, null);
      await mirror.clear().catch(() => {});
    },

    // Everything KB keeps for you, as one JSON file (for backup or moving to the local app).
    exportData() {
      const progress = files[PROGRESS] ? files[PROGRESS].data : {};
      const settings = Object.assign({}, files[SETTINGS] ? files[SETTINGS].data : {});
      if (settings.ai && settings.ai.keys) settings.ai = Object.assign({}, settings.ai, { keys: Object.fromEntries(Object.keys(settings.ai.keys).map((k) => [k, "(removed from export)"])) });
      return { exportedAt: new Date().toISOString(), account: user && user.email, progress, settings };
    },
  };
  window.KBDrive = api;
})();
