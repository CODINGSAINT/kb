// KB voice: talk to the tutor and hear its replies.
//
// Speech-to-text (pick one in Voice settings):
//   browser  - the browser's built-in recognition (Chrome, Edge, Safari). Free, nothing to install,
//              but Chrome sends the audio to Google to transcribe it.
//   whisper  - OpenAI's open-source Whisper model running inside this page (transformers.js).
//              Downloads once (~40-250 MB, cached by the browser), then works fully offline.
//   openai   - OpenAI's transcription API through the KB server, using the OpenAI key in AI settings.
// Text-to-speech:
//   browser  - your operating system's voices. Free and offline.
//   openai   - OpenAI voices through the KB server (natural, billed to your OpenAI key).
//
// Settings live in this browser's localStorage ("kb-voice"). Nothing here changes how chats are saved.
(function () {
  "use strict";
  const KEY = "kb-voice";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const caps = {
    secure: window.isSecureContext,
    webSpeech: !!SR,
    recorder: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
    synth: "speechSynthesis" in window,
  };
  const DEFAULTS = {
    input: caps.webSpeech ? "browser" : "whisper",
    output: "browser",
    lang: (navigator.language || "en-US").startsWith("en") ? navigator.language : "en-US",
    whisperModel: "Xenova/whisper-base.en",
    browserVoice: "",
    rate: 1.05,
    openaiVoice: "alloy",
    readAloud: false,
    autoSend: true,
    pauseMs: 4000,          // how long a pause ends a spoken question (thinking pauses are normal)
    replyByVoice: true,     // spoken question -> spoken answer, even when "Read aloud" is off
  };
  function get() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch (e) { return { ...DEFAULTS }; }
  }
  function set(patch) {
    const v = { ...get(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    emit();
    return v;
  }
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(get()); } catch (e) {} });
  const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

  const insecureMsg = () => `The microphone only works on secure pages. Open KB at http://localhost:${location.port || 80} on this computer. ` +
    `From a phone or another device, the browser blocks the mic over plain http://<IP>, so that needs HTTPS.`;

  // ------------------------------------------------------------------ listening
  let active = null; // { stop(), cancel() }

  function isListening() { return !!active; }
  function stopListening() { if (active) active.stop(); }
  function cancelListening() { if (active) active.cancel(); }

  // Resolves with the final transcript ("" if nothing was heard). opts:
  //   continuous: keep listening until stop() (dictation) instead of stopping at a pause
  //   onInterim(text), onState("listening" | "transcribing" | "loading" | "idle", detail)
  async function listen(opts = {}) {
    if (!caps.secure) throw new Error(insecureMsg());
    if (active) active.cancel();
    const s = get();
    const engine = s.input === "browser" && !caps.webSpeech ? "whisper" : s.input;
    if (engine === "browser") return listenWebSpeech(s, opts);
    return listenRecorder(s, engine, opts);
  }

  // Silence rules. Chat questions end after the chosen pause (default 4 s), so you can stop and think mid-sentence.
  // Dictation keeps going until you click Stop (or 30 s of silence).
  const pauseFor = (s, opts) => (opts.continuous ? 30000 : Math.max(1500, Number(s.pauseMs) || 4000));

  function listenWebSpeech(s, opts) {
    return new Promise((resolve, reject) => {
      const pauseMs = pauseFor(s, opts);
      let base = "", sessionFinal = "", sessionInterim = "", stopping = false, cancelled = false, settled = false, heard = false;
      let rec = null, restarts = 0, timer = null, lastCount = null;
      const t0 = performance.now(); let last = t0;
      const text = () => (base + " " + sessionFinal + " " + sessionInterim).replace(/\s+/g, " ").trim();
      const done = (fn) => { if (settled) return; settled = true; clearInterval(timer); active = null; opts.onCountdown && opts.onCountdown(null); opts.onState && opts.onState("idle"); fn(); };
      const finish = () => { if (stopping) return; stopping = true; try { rec && rec.stop(); } catch (e) { done(() => resolve(cancelled ? "" : text())); } };
      function session() {
        sessionFinal = ""; sessionInterim = "";
        rec = new SR();
        rec.lang = s.lang || "en-US";
        rec.interimResults = true;
        rec.continuous = true; // we decide when you've finished, not the browser
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let fin = "", inter = "";
          for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + " "; else inter += r[0].transcript; }
          sessionFinal = fin; sessionInterim = inter;
          heard = true; last = performance.now();
          opts.onInterim && opts.onInterim(text());
        };
        rec.onerror = (e) => {
          if (e.error === "no-speech" || e.error === "aborted") return; // onend decides
          const m = e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Microphone permission was blocked. Allow the mic for this site (the icon in the address bar) and try again."
            : e.error === "network" ? "The browser's speech service couldn't be reached (it needs internet). Switch Voice input to Whisper for offline use."
            : `Speech recognition error: ${e.error}`;
          stopping = true; done(() => reject(new Error(m)));
        };
        rec.onend = () => {
          base = (base + " " + sessionFinal + " " + sessionInterim).trim(); sessionFinal = sessionInterim = "";
          if (stopping || cancelled || settled) return done(() => resolve(cancelled ? "" : text()));
          // The browser ended its session on its own (it does after a while): carry on listening.
          if (++restarts > 30) return done(() => resolve(text()));
          try { session(); } catch (e) { done(() => resolve(text())); }
        };
        rec.start();
      }
      timer = setInterval(() => {
        const now = performance.now(), quiet = now - last;
        if (!heard && now - t0 > Math.max(15000, pauseMs)) return finish();
        if (heard && quiet >= pauseMs) return finish();
        const left = heard && quiet > 1000 && !opts.continuous ? Math.ceil((pauseMs - quiet) / 1000) : null;
        if (left !== lastCount) { lastCount = left; opts.onCountdown && opts.onCountdown(left); }
      }, 150);
      active = { stop: finish, cancel: () => { cancelled = true; finish(); } };
      opts.onState && opts.onState("listening");
      try { session(); } catch (e) { done(() => reject(e)); }
    });
  }

  async function listenRecorder(s, engine, opts) {
    if (!caps.recorder) throw new Error("This browser can't record audio. Try Chrome, Edge or Firefox.");
    if (engine === "whisper") loadWhisper(s.whisperModel, opts.onState).catch(() => {}); // warm up while you talk
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { throw new Error(e.name === "NotAllowedError" ? "Microphone permission was blocked. Allow the mic for this site and try again." : `Can't open the microphone: ${e.message}`); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);

    // Simple voice-activity detection: stop after a pause once speech has started.
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let heard = false, lastLoud = performance.now(), cancelled = false, timer;
    const started = performance.now();
    const silenceMs = pauseFor(s, opts), maxMs = opts.continuous ? 600000 : 180000;
    let lastCount = null;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length), now = performance.now();
      if (rms > 0.02) { heard = true; lastLoud = now; }
      if ((heard && now - lastLoud > silenceMs) || now - started > maxMs || (!heard && now - started > Math.max(15000, silenceMs))) { stop(); return; }
      const quiet = now - lastLoud, left = heard && quiet > 1000 && !opts.continuous ? Math.ceil((silenceMs - quiet) / 1000) : null;
      if (left !== lastCount) { lastCount = left; opts.onCountdown && opts.onCountdown(left); }
      timer = setTimeout(tick, 80);
    };
    const cleanup = () => { clearTimeout(timer); opts.onCountdown && opts.onCountdown(null); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); active = null; };
    const stop = () => { if (rec.state === "recording") rec.stop(); };
    const stopped = new Promise((r) => (rec.onstop = r));
    active = { stop, cancel: () => { cancelled = true; stop(); } };
    rec.start(250);
    opts.onState && opts.onState("listening");
    tick();
    await stopped;
    cleanup();
    if (cancelled || !heard || !chunks.length) { opts.onState && opts.onState("idle"); return ""; }
    const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
    opts.onState && opts.onState("transcribing");
    try {
      const text = engine === "openai" ? await transcribeOpenAI(blob, s.lang) : await transcribeWhisper(blob, s.whisperModel, opts.onState);
      return text;
    } finally { opts.onState && opts.onState("idle"); }
  }

  async function transcribeOpenAI(blob, lang) {
    const r = await fetch(`/api/voice/transcribe?lang=${encodeURIComponent(lang || "")}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code });
    return String(j.text || "").trim();
  }

  // Whisper in the page: transformers.js + an ONNX Whisper model, both cached by the browser after the first load.
  const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6";
  let whisperP = null, whisperId = "";
  function loadWhisper(model, onState) {
    if (whisperP && whisperId === model) return whisperP;
    whisperId = model;
    whisperP = (async () => {
      const { pipeline, env } = await import(TJS);
      env.allowLocalModels = false;
      let lastPct = -1;
      return pipeline("automatic-speech-recognition", model, {
        progress_callback: (p) => {
          if (p.status === "progress" && onState && p.total > 1e6) {
            const pct = Math.floor(p.progress || 0);
            if (pct !== lastPct) { lastPct = pct; onState("loading", `Downloading Whisper (one time): ${pct}%`); }
          }
        },
      });
    })();
    whisperP.catch(() => { whisperP = null; });
    return whisperP;
  }
  async function transcribeWhisper(blob, model, onState) {
    let asr;
    try { asr = await loadWhisper(model, onState); }
    catch (e) { throw new Error(`Couldn't load Whisper (it downloads once from the internet, then works offline): ${e.message}`); }
    onState && onState("transcribing");
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 16000, 16000);
    const audio = await ac.decodeAudioData(await blob.arrayBuffer());
    // Resample to 16 kHz mono, which Whisper expects.
    const len = Math.ceil(audio.duration * 16000);
    const off = new OfflineAudioContext(1, Math.max(1, len), 16000);
    const node = off.createBufferSource(); node.buffer = audio; node.connect(off.destination); node.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = await asr(pcm, { chunk_length_s: 30, stride_length_s: 5 });
    return String((out && out.text) || "").replace(/\[(BLANK_AUDIO|MUSIC|NOISE)\]/gi, "").trim();
  }

  // ------------------------------------------------------------------ speaking
  // Markdown -> speakable text. Code blocks are shown on screen, not read out.
  function speakable(md) {
    return String(md || "")
      .replace(/```[\s\S]*?```/g, " (The code is on screen.) ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\|/g, ", ")
      .replace(/[*_~>]+/g, "")
      .replace(/([.!?:;,])\s*\n+\s*/g, "$1 ")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/(\.\s*){2,}/g, ". ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[.\s]+|[\s.]+(?=[.!?:]$)/g, "")
      .trim();
  }

  let voicesCache = [];
  function browserVoices() {
    if (!caps.synth) return [];
    const v = speechSynthesis.getVoices();
    if (v.length) voicesCache = v;
    return voicesCache;
  }
  if (caps.synth) speechSynthesis.onvoiceschanged = () => { browserVoices(); emit(); };

  // A speaker reads a reply while it streams in: feed() deltas, end() when done.
  // Sentences are spoken as soon as they're complete, so there's little delay.
  function createSpeaker(hooks = {}) {
    const s = get();
    const mode = s.output;
    let pending = "", inFence = false, queue = [], playing = false, ended = false, stopped = false, audioEl = null, prefetch = null;
    const say = (text) => { const t = speakable(text); if (t && /[a-z0-9]/i.test(t)) { queue.push(t); pump(); } };

    function feed(delta) {
      if (stopped || mode === "off") return;
      pending += delta;
      for (;;) {
        if (inFence) {
          const close = pending.indexOf("```");
          if (close < 0) return;
          pending = pending.slice(close + 3).replace(/^[^\n]*\n?/, "");
          inFence = false; say("The code is on screen.");
          continue;
        }
        const open = pending.indexOf("```");
        const scan = open >= 0 ? pending.slice(0, open) : pending;
        const m = /^[\s\S]*?[.!?](?=\s)|^[\s\S]*?\n/.exec(scan);
        if (m && m[0].trim().length > 1) { say(m[0]); pending = pending.slice(m[0].length); continue; }
        if (open >= 0) { say(scan); pending = pending.slice(open + 3); inFence = true; continue; }
        return;
      }
    }
    function end() { if (stopped || mode === "off") return finish(); if (!inFence) say(pending); pending = ""; ended = true; if (!playing && !queue.length) finish(); }
    let finished = false;
    function finish() { if (finished) return; finished = true; hooks.onIdle && hooks.onIdle(); }
    function stop() {
      stopped = true; queue = [];
      if (caps.synth) speechSynthesis.cancel();
      if (audioEl) { audioEl.pause(); audioEl = null; }
      playing = false; hooks.onState && hooks.onState(false);
    }

    function pump() {
      if (playing || stopped || !queue.length) return;
      playing = true; hooks.onState && hooks.onState(true);
      const text = queue.shift();
      const next = () => {
        playing = false;
        if (stopped) return;
        if (queue.length) pump();
        else { hooks.onState && hooks.onState(false); if (ended) finish(); }
      };
      if (mode === "openai") playOpenAI(text, next);
      else playBrowser(text, next);
    }
    function playBrowser(text, next) {
      if (!caps.synth) return next();
      const u = new SpeechSynthesisUtterance(text);
      const v = browserVoices().find((x) => x.voiceURI === s.browserVoice) || browserVoices().find((x) => x.lang === s.lang) || null;
      if (v) { try { u.voice = v; } catch (e) {} }
      u.lang = (v && v.lang) || s.lang || "en-US";
      u.rate = Number(s.rate) || 1;
      u.onend = next; u.onerror = next;
      speechSynthesis.speak(u);
    }
    function fetchOpenAI(text) {
      return fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: s.openaiVoice }) })
        .then(async (r) => { if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); } return URL.createObjectURL(await r.blob()); });
    }
    function playOpenAI(text, next) {
      const p = prefetch && prefetch.text === text ? prefetch.p : fetchOpenAI(text);
      prefetch = null;
      p.then((url) => {
        if (stopped) return;
        if (queue.length) prefetch = { text: queue[0], p: fetchOpenAI(queue[0]) }; // fetch the next sentence while this one plays
        audioEl = new Audio(url);
        audioEl.playbackRate = Number(s.rate) || 1;
        audioEl.onended = () => { URL.revokeObjectURL(url); next(); };
        audioEl.onerror = next;
        audioEl.play().catch(next);
      }).catch((e) => { hooks.onError && hooks.onError(e); stop(); finish(); });
    }
    return { feed, end, stop, get speaking() { return playing || queue.length > 0; } };
  }

  // Read a whole finished reply (the speaker button on a message).
  let current = null;
  function speakNow(md, hooks = {}) {
    if (current) current.stop();
    current = createSpeaker({ ...hooks, onIdle: () => { current = null; hooks.onIdle && hooks.onIdle(); } });
    current.feed(md + "\n"); current.end();
    return current;
  }
  function stopSpeaking() { if (current) current.stop(); current = null; if (caps.synth) speechSynthesis.cancel(); }

  // ------------------------------------------------------------------ settings dialog
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  };

  function openSettings() {
    let dlg = document.getElementById("voiceDialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "voiceDialog"; dlg.className = "ai-dialog voice-dialog";
      document.body.appendChild(dlg);
    }
    const s = get();
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const voiceOptions = () => {
      const lang = s.lang || "en-US", base = lang.slice(0, 2);
      const rank = (v) => (v.lang === lang ? 0 : v.lang.startsWith(base) ? 1 : 2);
      const natural = (v) => /natural|neural|online|premium|enhanced/i.test(v.name);
      const list = browserVoices().slice().sort((a, b) => rank(a) - rank(b) || Number(natural(b)) - Number(natural(a)) || a.name.localeCompare(b.name));
      const cur = (dlg.querySelector("#vVoice") && dlg.querySelector("#vVoice").value) || s.browserVoice;
      return opt("", "Default voice for the language", cur) + list.map((v) => opt(v.voiceURI, `${natural(v) ? "★ " : ""}${v.name} (${v.lang})`, cur)).join("");
    };
    const opt = (v, label, cur, dis) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""} ${dis ? "disabled" : ""}>${esc(label)}</option>`;
    dlg.innerHTML = `
      <h2>Voice settings</h2>
      <p class="muted small" style="margin-top:0">Talk to the tutor and hear its replies. Works with every AI provider: the voice part turns speech into text and back, and the chat model only sees text.
        Saved in this browser.</p>
      ${caps.secure ? "" : `<p class="err small">${esc(insecureMsg())}</p>`}
      <label class="field"><span class="lbl">Voice input (speech to text)</span>
        <select id="vIn">
          ${opt("browser", "Browser built-in (free, instant)", s.input, !caps.webSpeech)}
          ${opt("whisper", "Whisper in this page (free, offline)", s.input)}
          ${opt("openai", "OpenAI (most accurate, uses your key)", s.input)}
        </select>
        <span class="hint" id="vInHint"></span>
        ${caps.webSpeech ? "" : `<span class="hint">This browser has no built-in speech recognition, so Whisper or OpenAI is used.</span>`}</label>
      <label class="field" id="vWhisperRow"><span class="lbl">Whisper model</span>
        <select id="vWhisper">
          ${opt("Xenova/whisper-tiny.en", "tiny.en: about 40 MB, fastest", s.whisperModel)}
          ${opt("Xenova/whisper-base.en", "base.en: about 80 MB, good balance (recommended)", s.whisperModel)}
          ${opt("Xenova/whisper-small.en", "small.en: about 250 MB, most accurate, slower", s.whisperModel)}
        </select><span class="hint">Downloaded once into the browser cache, then runs on your computer with no internet.</span></label>
      <label class="field"><span class="lbl">Language / accent</span>
        <select id="vLang">
          ${["en-US|English (US)", "en-IN|English (India)", "en-GB|English (UK)", "en-AU|English (Australia)", "hi-IN|Hindi"].map((x) => { const [v, l] = x.split("|"); return opt(v, l, s.lang); }).join("")}
        </select></label>
      <label class="field"><span class="lbl">Voice output (reading replies aloud)</span>
        <select id="vOut">
          ${opt("browser", "Computer voice (free, offline)", s.output, !caps.synth)}
          ${opt("openai", "OpenAI voice (most natural, uses your key)", s.output)}
          ${opt("off", "Off", s.output)}
        </select></label>
      <label class="field" id="vBrowserRow"><span class="lbl">Computer voice</span>
        <div class="vrow"><select id="vVoice">${voiceOptions()}</select><button type="button" class="btn small" id="vPrevB" title="Hear this voice">▶ Preview</button></div>
        <span class="hint" id="vVoiceHint"></span></label>
      <label class="field" id="vOpenaiRow"><span class="lbl">OpenAI voice</span>
        <div class="vrow"><select id="vOpenai">${[["alloy", "neutral, balanced"], ["ash", "male, clear"], ["ballad", "male, warm"], ["coral", "female, friendly"], ["echo", "male, calm"], ["fable", "male, British"], ["nova", "female, bright"], ["onyx", "male, deep"], ["sage", "female, calm"], ["shimmer", "female, soft"]].map(([v, d]) => opt(v, `${v[0].toUpperCase() + v.slice(1)}: ${d}`, s.openaiVoice)).join("")}</select>
        <button type="button" class="btn small" id="vPrevO" title="Hear this voice">▶ Preview</button></div></label>
      <label class="field"><span class="lbl">Speaking speed <span id="vRateVal" class="muted">${Number(s.rate).toFixed(2)}×</span></span>
        <input id="vRate" type="range" min="0.7" max="1.6" step="0.05" value="${s.rate}"></label>
      <label class="field"><span class="lbl">Wait after I stop talking <span id="vPauseVal" class="muted">${(s.pauseMs / 1000).toFixed(1)} s</span></span>
        <input id="vPause" type="range" min="1500" max="8000" step="500" value="${s.pauseMs}">
        <span class="hint">How long a pause means you've finished. Longer lets you stop and think mid-answer. You can always click the mic to send straight away.</span></label>
      <label class="check"><input type="checkbox" id="vReply" ${s.replyByVoice ? "checked" : ""}> Answer spoken questions out loud (even when Read aloud is off)</label>
      <label class="check"><input type="checkbox" id="vAuto" ${s.autoSend ? "checked" : ""}> Send my question automatically after the pause</label>
      <div class="dlg-actions"><span class="save-state" id="vMsg"></span><span class="spacer"></span>
        <button type="button" class="btn" id="vTest">Test voice</button>
        <button type="button" class="btn primary" id="vClose">Done</button></div>`;
    const $ = (id) => dlg.querySelector("#" + id);
    const IN_HINT = {
      browser: "Uses the browser's speech service. In Chrome the audio is sent to Google to be transcribed. Needs internet.",
      whisper: "Runs Whisper on your computer. Downloads once (needs internet that one time), then works fully offline and nothing leaves your machine.",
      openai: "Sends the recording to OpenAI through KB, using the OpenAI key from AI settings. Costs a fraction of a cent per question.",
    };
    const rows = () => {
      $("vInHint").textContent = IN_HINT[$("vIn").value] || "";
      $("vWhisperRow").hidden = $("vIn").value !== "whisper";
      $("vBrowserRow").hidden = $("vOut").value !== "browser";
      $("vOpenaiRow").hidden = $("vOut").value !== "openai";
    };
    rows();
    const save = () => { set({ input: $("vIn").value, whisperModel: $("vWhisper").value, lang: $("vLang").value, output: $("vOut").value,
      browserVoice: $("vVoice").value, openaiVoice: $("vOpenai").value, rate: Number($("vRate").value), autoSend: $("vAuto").checked,
      pauseMs: Number($("vPause").value), replyByVoice: $("vReply").checked }); rows(); };
    const SAMPLE = "Good question. Let's think about where the bottleneck is first, then pick the data store.";
    const preview = () => { save(); $("vMsg").className = "save-state"; $("vMsg").textContent = "";
      speakNow(SAMPLE, { onError: (e) => { $("vMsg").className = "save-state err"; $("vMsg").textContent = e.message; } }); };
    $("vPrevB").addEventListener("click", preview);
    $("vPrevO").addEventListener("click", preview);
    $("vVoice").addEventListener("change", preview);
    $("vOpenai").addEventListener("change", preview);
    $("vPause").addEventListener("input", () => { $("vPauseVal").textContent = (Number($("vPause").value) / 1000).toFixed(1) + " s"; });
    const voiceHint = () => {
      const n = browserVoices().length;
      $("vVoiceHint").textContent = n
        ? `${n} voices on this computer. ★ marks natural-sounding ones. Microsoft Edge adds many natural voices; on Windows you can add more under Settings → Time & language → Speech.`
        : "Loading your computer's voices…";
    };
    voiceHint();
    // Browsers load voices lazily: refresh the list when they arrive.
    const offVoices = onChange(() => { if (!dlg.open) return; const sel = $("vVoice"); const v = sel.value; sel.innerHTML = voiceOptions(); sel.value = v; voiceHint(); });
    dlg.addEventListener("close", offVoices, { once: true });
    dlg.querySelectorAll("select, input").forEach((el) => el.addEventListener("change", save));
    $("vRate").addEventListener("input", () => { $("vRateVal").textContent = Number($("vRate").value).toFixed(2) + "×"; });
    $("vTest").addEventListener("click", () => {
      save();
      $("vMsg").className = "save-state"; $("vMsg").textContent = "";
      speakNow("Hi! I'm your interview tutor. Ask me anything about this topic.", { onError: (e) => { $("vMsg").className = "save-state err"; $("vMsg").textContent = e.message; } });
    });
    $("vClose").addEventListener("click", () => { stopSpeaking(); dlg.close(); });
    dlg.showModal();
  }

  window.KBVoice = { caps, get, set, onChange, listen, stopListening, cancelListening, isListening, createSpeaker, speakNow, stopSpeaking, speakable, openSettings, ICON, insecureMsg };
})();
