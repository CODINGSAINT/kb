// KB front end — vanilla JS, hash routing, no build step.
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const api = {
    async get(url) {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    },
    async post(url, body) {
      const r = await fetch(url, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || r.statusText), { code: j.code }); }
      return r.json();
    },
  };

  const TRACKS = [
    { key: "LLD", name: "LLD — Low-Level Design", color: "var(--lld)" },
    { key: "HLD", name: "HLD — High-Level Design", color: "var(--hld)" },
    { key: "AI", name: "AI / Spring AI", color: "var(--ai)" },
  ];
  const CHEV = '<svg class="chev" viewBox="0 0 10 10"><path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let state = { tracks: null, dsa: null, dirty: false, editors: [], revealed: new Set() };

  // ---------- theme / sidebar / practice ----------
  const isDark = () => document.documentElement.dataset.theme === "dark";
  $("#themeToggle").addEventListener("click", () => {
    const t = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("kb-theme", t); } catch (e) {}
    document.querySelectorAll(".toastui-editor-defaultUI").forEach((el) => el.classList.toggle("toastui-editor-dark", t === "dark"));
    document.querySelectorAll("[data-diagram]").forEach((el) => KBDiagram.render(el, el._spec, el.dataset.diagram));
  });
  if (store.get("kb-sidebar-collapsed", false)) document.body.classList.add("sidebar-collapsed");
  const toggleSidebar = () => {
    document.body.classList.toggle("sidebar-collapsed");
    store.set("kb-sidebar-collapsed", document.body.classList.contains("sidebar-collapsed"));
  };
  $("#sidebarToggle").addEventListener("click", toggleSidebar);

  document.addEventListener("keydown", (e) => {
    const typing = /input|textarea/i.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "\\" && !typing) { e.preventDefault(); toggleSidebar(); }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      // Capture phase + stopPropagation: the editor binds Ctrl+S to strikethrough, which would insert "~~~~".
      e.preventDefault(); e.stopPropagation();
      document.querySelectorAll("[data-save]").forEach((b) => !b.disabled && b.click());
    }
  }, true);
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- AI settings ----------
  // The server keeps keys in kb.config.json; the browser only ever sees "…last4".
  let aiCfg = null, dlgProvider = null;
  const shortName = (id) => ({ anthropic: "Claude", openai: "OpenAI", ollama: "Ollama", mock: "Mock" }[id] || id);
  async function loadAi() {
    try { aiCfg = await api.get("/api/ai/config"); } catch (e) { aiCfg = null; }
    const chip = $("#aiButton");
    chip.dataset.state = aiCfg && aiCfg.ready ? "on" : "off";
    $("#aiLabel").textContent = aiCfg && aiCfg.ready ? `${shortName(aiCfg.provider)} · ${aiCfg.model}` : "Set up AI";
    chip.title = aiCfg && aiCfg.ready ? "AI settings: provider, model, API key" : "Connect Claude, OpenAI or a local Ollama model";
    state.onAiChange && state.onAiChange();
    return aiCfg;
  }
  function ensureAi() {
    if (aiCfg && aiCfg.ready) return true;
    openAiSettings("Connect an AI provider first. It takes a minute.");
    return false;
  }
  async function openAiSettings(msg) {
    if (!aiCfg) await loadAi();
    const dlg = $("#aiDialog");
    if (!aiCfg) {
      // Usually: the page is new but the server process was started before the AI update.
      dlg.classList.add("no-server");
      setSave($("#aiMsg"), "err", "");
      if (!dlg.open) dlg.showModal();
      return;
    }
    dlg.classList.remove("no-server");
    dlgProvider = aiCfg.providers[aiCfg.provider] ? aiCfg.provider : "anthropic";
    renderDlg();
    setSave($("#aiMsg"), msg ? "dirty" : "", msg || "");
    if (!$("#aiDialog").open) $("#aiDialog").showModal();
  }
  function renderDlg() {
    const p = aiCfg.providers[dlgProvider];
    $("#aiProviders").innerHTML = Object.entries(aiCfg.providers).map(([id, x]) =>
      `<button type="button" role="radio" aria-checked="${id === dlgProvider}" class="seg-btn${id === dlgProvider ? " on" : ""}" data-prov="${id}">${esc(x.name)}${!x.needsKey || x.keySet ? '<span class="ok-dot" title="Ready"></span>' : ""}</button>`).join("");
    $("#aiModel").value = p.model;
    $("#aiModels").innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join("");
    $("#aiModelHint").textContent = "Pick a suggestion or type any model your account can use.";
    $("#aiKeyRow").hidden = !p.needsKey;
    $("#aiKey").value = "";
    $("#aiKey").placeholder = p.keyFromEnv ? `Using the environment variable (${p.keyHint})` : p.keySet ? `Saved (${p.keyHint}). Leave blank to keep it` : "Paste your API key";
    $("#aiKeyLink").href = p.keyUrl;
    $("#aiUrlRow").hidden = !p.baseUrl;
    $("#aiUrl").value = p.baseUrl || "";
    $("#aiOllamaHelp").hidden = dlgProvider !== "ollama";
    if (dlgProvider === "ollama") loadOllamaModels();
  }
  // Suggest the models actually installed in Ollama (exact names, with their ":tag").
  async function loadOllamaModels() {
    const hint = $("#aiModelHint");
    hint.textContent = "Checking which models Ollama has installed…";
    try {
      const { models } = await api.get("/api/ai/ollama-models?baseUrl=" + encodeURIComponent($("#aiUrl").value || ""));
      if (dlgProvider !== "ollama") return;
      if (models.length) {
        $("#aiModels").innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join("");
        hint.innerHTML = "Installed: " + models.map((m) => `<button type="button" class="chip" data-model="${esc(m)}">${esc(m)}</button>`).join(" ");
        if (!models.includes($("#aiModel").value) && models.length === 1) $("#aiModel").value = models[0];
      } else {
        hint.innerHTML = "Couldn't find any installed models. Is Ollama running? Download one with <code>ollama pull gemma4:12b</code>.";
      }
    } catch (e) { hint.textContent = "Couldn't reach the server to list Ollama models."; }
  }
  $("#aiModelHint").addEventListener("click", (e) => { const b = e.target.closest("[data-model]"); if (b) $("#aiModel").value = b.dataset.model; });
  $("#aiProviders").addEventListener("click", (e) => {
    const b = e.target.closest("[data-prov]");
    if (b) { dlgProvider = b.dataset.prov; renderDlg(); setSave($("#aiMsg"), "", ""); }
  });
  async function saveDlg() {
    const patch = { provider: dlgProvider, [dlgProvider]: { model: $("#aiModel").value } };
    if ($("#aiKey").value.trim()) patch[dlgProvider].apiKey = $("#aiKey").value.trim();
    if (!$("#aiUrlRow").hidden) patch[dlgProvider].baseUrl = $("#aiUrl").value;
    await api.post("/api/ai/config", patch);
    await loadAi();
    renderDlg();
  }
  $("#aiSave").addEventListener("click", async () => {
    const msg = $("#aiMsg");
    setSave(msg, "", "Saving and testing…");
    try {
      await saveDlg();
      const r = await api.post("/api/ai/test", {});
      setSave(msg, "ok", `Connected. ${shortName(aiCfg.provider)} replied “${r.reply}”.`);
      setTimeout(() => $("#aiDialog").open && $("#aiDialog").close(), 900);
    } catch (e) { setSave(msg, "err", e.message); }
  });
  $("#aiClose").addEventListener("click", () => $("#aiDialog").close());
  $("#aiButton").addEventListener("click", () => openAiSettings());

  // ---------- progress ----------
  async function loadProgress() {
    try {
      const p = await api.get("/api/progress");
      $("#progAnswered").style.width = p.answeredPct + "%";
      $("#progEvaluated").style.width = p.evaluatedPct + "%";
      $("#progText").textContent = `${p.answeredPct}% attempted · ${p.evaluatedPct}% evaluated`;
      $("#progress").title = `${p.answered} of ${p.totalTopics} attempted, ${p.evaluated} evaluated (LLD + HLD + AI + DSA)`;
      return p;
    } catch (e) { $("#progText").textContent = "progress unavailable"; }
  }

  // ---------- sidebar ----------
  async function loadNav() {
    const [tracks, dsa, fund] = await Promise.all([api.get("/api/tracks"), api.get("/api/dsa"), api.get("/api/fundamentals").catch(() => null)]);
    state.tracks = tracks; state.dsa = dsa; state.fund = fund;
    renderNav();
  }
  const statusDot = (it) => `<span class="status ${it.evaluated ? "evaluated" : it.answered ? "answered" : ""}" title="${it.evaluated ? "Evaluated" : it.answered ? "Attempted" : "Not attempted"}"></span>`;
  const isAnswered = (p) => !!(p.userAnswer && p.userAnswer.trim());
  // The page header already shows the pattern's name and summary: drop them from the guide body.
  const guideBody = (md) => String(md || "").replace(/^#\s.*\n+(?:[^#\n][^\n]*\n)+\n*/, "");
  const diffChip = (d, long) => d ? `<span class="diff ${esc(d[0])}" title="${esc(d)}">${long ? esc(d) : esc(d[0])}</span>` : "";

  function renderNav() {
    const open = store.get("kb-open", { LLD: true, HLD: true, AI: true, DSA: true });
    const q = $("#filter").value.trim().toLowerCase();
    const match = (s) => !q || String(s).toLowerCase().includes(q);
    let html = "";
    const fgroups = state.fund?.groups || [];
    if (fgroups.length) {
      const fall = fgroups.flatMap((g) => g.items);
      html += `<details class="track" data-key="FUND" ${open.FUND !== false || q ? "open" : ""}>
        <summary>${CHEV}<span class="track-dot" style="background:var(--sub)"></span>Read first: fundamentals<span class="count">${fall.filter((x) => x.readAt).length}/${fall.length}</span></summary>`;
      for (const g of fgroups) {
        const items = g.items.filter((x) => match(x.title) || match(g.name));
        if (!items.length) continue;
        const k = "FUND:" + g.track;
        html += `<details class="subtrack" data-key="${esc(k)}" ${open[k] || q ? "open" : ""}>
          <summary>${CHEV}${esc(g.name)}<span class="count">${g.items.filter((x) => x.readAt).length}/${g.items.length}</span></summary>
          <ul class="items">${items.map((x) => `<li><a href="#/read/${esc(x.id)}" data-href="#/read/${esc(x.id)}"><span class="num">${x.number}</span><span class="t">${esc(x.title)}</span>${statusDot({ evaluated: !!x.readAt })}</a></li>`).join("")}</ul>
        </details>`;
      }
      html += `</details>`;
    }
    for (const tr of TRACKS) {
      const items = (state.tracks[tr.key] || []).filter((it) => match(it.title) || match(it.concepts));
      const done = (state.tracks[tr.key] || []).filter((it) => it.answered).length;
      html += `<details class="track" data-key="${tr.key}" ${open[tr.key] || q ? "open" : ""}>
        <summary>${CHEV}<span class="track-dot" style="background:${tr.color}"></span>${esc(tr.name)}<span class="count">${done}/${(state.tracks[tr.key] || []).length}</span></summary>
        ${items.length ? `<ul class="items">${items.map((it) => `<li><a href="#/t/${it.day}/${it.topicIndex}" data-href="#/t/${it.day}/${it.topicIndex}"><span class="num">${it.number}</span><span class="t">${esc(it.title)}</span>${statusDot(it)}</a></li>`).join("")}</ul>`
          : `<div class="empty-note">${q ? "No matches." : "Nothing generated yet."}</div>`}
      </details>`;
    }
    const dsaTopics = state.dsa.topics || [];
    const dsaTotal = dsaTopics.reduce((s, t) => s + t.problems.length, 0);
    const dsaDone = dsaTopics.reduce((s, t) => s + t.problems.filter(isAnswered).length, 0);
    html += `<details class="track" data-key="DSA" ${open.DSA || q ? "open" : ""}>
      <summary>${CHEV}<span class="track-dot" style="background:var(--dsa)"></span>DSA — Coding Patterns<span class="count">${dsaDone}/${dsaTotal}</span></summary>`;
    dsaTopics.forEach((tp, ti) => {
      const probs = tp.problems.map((p, pi) => ({ p, pi })).filter(({ p }) => match(p.title) || match(tp.name));
      if (!probs.length) return;
      const key = "DSA:" + tp.name;
      const d = tp.problems.filter(isAnswered).length;
      html += `<details class="subtrack" data-key="${esc(key)}" ${open[key] || q ? "open" : ""}>
        <summary>${CHEV}<span class="pnum">${ti + 1}</span>${esc(tp.name)}<span class="count">${d}/${tp.problems.length}</span></summary>
        <ul class="items">${tp.guide ? `<li><a class="guide-link" href="#/pattern/${ti}" data-href="#/pattern/${ti}"><span class="num">◆</span><span class="t">Pattern guide</span></a></li>` : ""}${probs.map(({ p, pi }) => `<li><a href="#/dsa/${ti}/${pi}" data-href="#/dsa/${ti}/${pi}"><span class="num">${p.number}</span><span class="t">${esc(p.title)}</span>${diffChip(p.difficulty)}${statusDot({ answered: isAnswered(p), evaluated: !!p.answerEvaluation })}</a></li>`).join("")}</ul>
      </details>`;
    });
    html += `</details>`;
    $("#nav").innerHTML = html;
    $("#nav").querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
      if (q) return;
      const o = store.get("kb-open", {}); o[d.dataset.key] = d.open; store.set("kb-open", o);
    }));
    markActive();
  }
  $("#filter").addEventListener("input", () => state.tracks && renderNav());
  function markActive() {
    const h = location.hash || "#/";
    document.querySelectorAll("#nav a").forEach((a) => {
      const on = a.dataset.href === h;
      a.classList.toggle("active", on);
      if (on) a.scrollIntoView({ block: "nearest" });
    });
  }

  // ---------- shared widgets ----------
  function destroyEditors() { state.editors.forEach((e) => { try { e.destroy(); } catch (x) {} }); state.editors = []; }
  function viewer(el, md) {
    const v = toastui.Editor.factory({ el, viewer: true, usageStatistics: false, initialValue: md || "", theme: isDark() ? "dark" : "light" });
    state.editors.push(v);
    return v;
  }
  function setSave(el, cls, msg) { el.className = "save-state " + (cls || ""); el.textContent = msg; }
  function stamp(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }

  // Parse "#doubt ..." / "#doubt-answer ..." line pairs. Continuation lines after an answer belong to it.
  function parseDoubts(notes) {
    const out = [];
    let cur = null, inAnswer = false;
    for (const line of String(notes || "").split(/\r?\n/)) {
      const ans = /^\s*#doubt-answer\b:?\s*(.*)$/i.exec(line);
      const dq = !ans && /^\s*#doubt\b:?\s*(.*)$/i.exec(line);
      if (dq) { cur = { q: dq[1], a: null }; out.push(cur); inAnswer = false; }
      else if (ans && cur) { cur.a = (cur.a ? cur.a + "\n" : "") + ans[1]; inAnswer = true; }
      else if (inAnswer && cur && line.trim()) cur.a += "\n" + line;
      else if (!line.trim()) inAnswer = false; // blank line ends an answer
    }
    return out;
  }

  function copyButton(text) {
    return `<button class="btn small" data-copy="${esc(text)}">Copy</button>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
  });

  // The "Discuss with the AI tutor" card, inserted after `anchor`. Used by topic, DSA and fundamentals pages.
  function tutorCard(anchor, item, ctx) {
    const clarifyCmd = `kb clarify ${ctx.cli} "your question"`;
    anchor.insertAdjacentHTML("afterend", `
      <section class="card tutor" id="tutorCard">
        <h2>${esc(ctx.tutorTitle || "Discuss with the AI tutor")} <span class="spacer"></span>
          <span class="muted small" id="tutorModel"></span>
          <span class="voice-tools">
            <button type="button" class="vbtn" id="vRead" aria-pressed="false" title="Read the tutor's replies aloud">${KBVoice.ICON.speaker}<span>Read aloud</span></button>
            <button type="button" class="vbtn" id="vTalk" aria-pressed="false" title="Hands-free: talk, hear the reply, then it listens again">${KBVoice.ICON.mic}<span>Talk mode</span></button>
            <button type="button" class="vbtn icon" id="vGear" title="Voice settings">${KBVoice.ICON.gear}</button>
          </span>
          <button class="btn small" id="chatClear" title="Start a fresh conversation">Clear</button></h2>
        <div class="chat" id="chatLog" aria-live="polite"></div>
        <div class="chips" id="chatChips"></div>
        <form class="chat-input" id="chatForm">
          <textarea id="chatText" rows="2" placeholder="${esc(ctx.chatPlaceholder || "Ask about this topic or your answer…  (Enter sends · Shift+Enter for a new line)")}"></textarea>
          <button type="button" class="mic" id="chatMic" title="Speak your question (click again to stop)" aria-label="Speak your question">${KBVoice.ICON.mic}</button>
          <button class="btn primary" id="chatSend" type="submit">Send</button>
        </form>
        <div class="voice-status" id="voiceStatus" hidden></div>
        <div class="cli-hint muted small">Same conversation from a terminal: <code>${esc(clarifyCmd)}</code> ${copyButton(clarifyCmd)}</div>
      </section>`);
    const chatLog = $("#chatLog"), chatText = $("#chatText"), chatSend = $("#chatSend");
    const showModel = () => { $("#tutorModel").textContent = aiCfg && aiCfg.ready ? `${shortName(aiCfg.provider)} · ${aiCfg.model}` : "AI not set up"; };
    state.onAiChange = showModel; showModel();
    function appendMsg(role, content, raw) {
      const el = document.createElement("div");
      el.className = "msg " + role;
      el.innerHTML = `<div class="who">${role === "user" ? "You" : "Tutor"}${role === "assistant" ? ` <button type="button" class="listen" title="Read this reply aloud">${KBVoice.ICON.speaker}</button>` : ""}</div><div class="body"></div>`;
      chatLog.appendChild(el);
      const body = el.querySelector(".body");
      el._md = content;
      if (role === "assistant" && !raw) viewer(body, content); else body.textContent = content;
      return body;
    }
    const scrollChat = () => { chatLog.scrollTop = chatLog.scrollHeight; };
    function renderChat() {
      const msgs = item.chat || [];
      chatLog.innerHTML = msgs.length ? "" : `<div class="chat-empty">Ask about trade-offs, edge cases, or why the write-up does something a certain way. Ask for a quiz to practise interview questions. The tutor already has this topic's write-up, your saved answer and its verdict.</div>`;
      msgs.forEach((m) => appendMsg(m.role, m.content));
      $("#chatClear").hidden = !msgs.length;
      scrollChat();
    }
    const CHIPS = ctx.chips || (isAnswered(item) || item.answerEvaluation
      ? ["What's weakest in my answer?", "Quiz me like an interviewer", "Explain the key trade-offs simply", "What follow-ups would an interviewer ask?"]
      : ["Explain this topic in 5 bullet points", "Quiz me like an interviewer", "What do interviewers look for here?", "Common mistakes on this one?"]);
    $("#chatChips").innerHTML = CHIPS.map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join("");
    $("#chatChips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) sendChat(b.textContent); });

    let sending = false;
    // ----- voice -----
    const V = KBVoice, vStatus = $("#voiceStatus"), micBtn = $("#chatMic");
    let talkMode = false, speaker = null;
    const readAloud = () => talkMode || V.get().readAloud;
    const status = (msg, cls) => { vStatus.hidden = !msg; vStatus.className = "voice-status " + (cls || ""); vStatus.innerHTML = msg || ""; };
    function syncVoiceButtons() {
      $("#vRead").setAttribute("aria-pressed", String(V.get().readAloud));
      $("#vTalk").setAttribute("aria-pressed", String(talkMode));
      $("#vRead").disabled = talkMode;
    }
    const offVoice = V.onChange(syncVoiceButtons);
    state.voiceCleanup = () => { offVoice(); talkMode = false; V.cancelListening(); if (speaker) speaker.stop(); V.stopSpeaking(); };
    syncVoiceButtons();
    const listeningMsg = () => `<span class="dot"></span> Listening… take your time. Pause for ${(V.get().pauseMs / 1000).toFixed(V.get().pauseMs % 1000 ? 1 : 0)}s or click the mic when you're done`;
    async function startListening() {
      if (V.isListening()) { V.stopListening(); return; }
      if (speaker) { speaker.stop(); speaker = null; }
      V.stopSpeaking();
      const before = chatText.value;
      try {
        const text = await V.listen({
          onInterim: (t) => { chatText.value = (before ? before + " " : "") + t; },
          onCountdown: (sec) => {
            if (sec) status(`<span class="dot"></span> Sending in ${sec}s… keep talking to add more, or click the mic to send now`, "live");
            else if (V.isListening()) status(listeningMsg(), "live");
          },
          onState: (st, detail) => {
            micBtn.classList.toggle("on", st === "listening");
            micBtn.classList.toggle("busy", st === "transcribing" || st === "loading");
            if (st === "listening") status(listeningMsg(), "live");
            else if (st === "transcribing") status("Turning your speech into text…");
            else if (st === "loading") status(esc(detail || "Loading Whisper…"));
            else status("");
          },
        });
        const full = ((before ? before + " " : "") + (text || "")).trim();
        chatText.value = full;
        if (!text) { if (talkMode) status("Didn't catch that. Click the mic or say something.", "warn"); return; }
        if (talkMode || V.get().autoSend) sendChat(full, { voice: true });
        else chatText.focus();
      } catch (e) {
        status(esc(e.message), "err");
        if (e.code === "NO_KEY") openAiSettings(e.message);
        if (talkMode) { talkMode = false; syncVoiceButtons(); }
      }
    }
    micBtn.addEventListener("click", startListening);
    $("#vRead").addEventListener("click", () => { const on = !V.get().readAloud; V.set({ readAloud: on }); if (!on) { if (speaker) speaker.stop(); V.stopSpeaking(); } });
    $("#vTalk").addEventListener("click", () => {
      talkMode = !talkMode; syncVoiceButtons();
      if (talkMode) { if (V.get().output === "off") V.set({ output: "browser" }); if (!sending) startListening(); }
      else { V.cancelListening(); if (speaker) speaker.stop(); V.stopSpeaking(); status(""); }
    });
    $("#vGear").addEventListener("click", () => V.openSettings());
    chatLog.addEventListener("click", (e) => {
      const b = e.target.closest(".listen"); if (!b) return;
      const msg = b.closest(".msg");
      if (b.classList.contains("on")) { V.stopSpeaking(); return; }
      chatLog.querySelectorAll(".listen.on").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      V.speakNow(msg._md || msg.querySelector(".body").innerText, { onIdle: () => b.classList.remove("on"), onError: (er) => { b.classList.remove("on"); status(esc(er.message), "err"); } });
    });

    async function sendChat(text, opts = {}) {
      text = String(text || "").trim();
      if (!text || sending) return;
      if (!ensureAi()) { if (talkMode) { talkMode = false; syncVoiceButtons(); } return; }
      if (speaker) { speaker.stop(); speaker = null; }
      V.stopSpeaking();
      // Spoken question -> spoken answer by default; typed questions are spoken only with Read aloud / Talk mode.
      const speak = (readAloud() || (opts.voice && V.get().replyByVoice)) && V.get().output !== "off";
      const spk = speak ? (speaker = V.createSpeaker({
        onIdle: () => { if (speaker === spk) speaker = null; setTimeout(() => { if (talkMode && !sending && !V.isListening()) startListening(); }, 60); },
        onError: (er) => status(esc(er.message), "err"),
      })) : null;
      sending = true; chatSend.disabled = true;
      chatLog.querySelector(".chat-empty")?.remove();
      appendMsg("user", text);
      chatText.value = "";
      const body = appendMsg("assistant", "", true);
      body.innerHTML = `<div class="thinking"><i></i><i></i><i></i></div>`;
      scrollChat();
      let acc = "", started = false;
      const ctrl = new AbortController(); state.chatAbort = ctrl;
      try {
        const r = await fetch("/api/ai/chat", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ctx.addr, message: text, voice: !!(opts.voice || speak) }), signal: ctrl.signal });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || r.statusText), { code: j.code }); }
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.error) throw Object.assign(new Error(ev.error), { code: ev.code });
            if (ev.t) {
              if (!started) { body.textContent = ""; body.classList.add("streaming"); started = true; }
              acc += ev.t; body.textContent = acc; scrollChat();
              if (spk) spk.feed(ev.t);
            }
          }
        }
        if (!acc.trim()) throw new Error("The model returned an empty reply.");
        body.classList.remove("streaming"); body.textContent = "";
        viewer(body, acc);
        body.closest(".msg")._md = acc;
        if (spk) spk.end();
        item.chat = [...(item.chat || []), { role: "user", content: text }, { role: "assistant", content: acc.trim() }];
        $("#chatClear").hidden = false;
        scrollChat();
      } catch (e) {
        if (spk) spk.stop();
        if (e.name === "AbortError") return;
        if (talkMode) { talkMode = false; syncVoiceButtons(); }
        body.classList.remove("streaming");
        body.innerHTML = `<p class="err">${esc(e.message)}</p><p class="muted small">Your message wasn't saved. It's back in the box so you can retry.</p>`;
        chatText.value = text;
        if (e.code === "NO_KEY") openAiSettings(e.message);
      } finally {
        sending = false; chatSend.disabled = false;
        if (talkMode && !spk) startListening();
        if (state.chatAbort === ctrl) state.chatAbort = null;
      }
    }
    $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); sendChat(chatText.value); });
    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(chatText.value); }
    });
    $("#chatClear").addEventListener("click", async () => {
      if (!confirm("Clear this topic's conversation? This can't be undone.")) return;
      try { await api.post("/api/ai/chat/clear", ctx.addr); item.chat = []; renderChat(); } catch (e) { alert(e.message); }
    });
    renderChat();

  }

  // Builds the "My answer" + "Verdict" + "AI tutor" + "Notes & doubts" cards. `ctx` supplies save URLs/addresses.
  function practiceSections(root, item, ctx) {
    const evalCmd = `kb evaluate ${ctx.cli}`;
    root.insertAdjacentHTML("beforeend", `
      <section class="card" id="answerCard">
        <h2>My answer <span class="spacer"></span><span class="save-state" id="ansState"></span>
          <button type="button" class="vbtn dictate" id="ansMic" title="Dictate into your answer (click again to stop)">${KBVoice.ICON.mic}<span>Dictate</span></button>
          <button class="btn primary" id="ansSave" data-save disabled>Save answer</button></h2>
        <div id="ansEditor"></div>
        <p class="muted small" style="margin:10px 0 0">Saved as Markdown. For code, put <code>\`\`\`java</code> on its own line before it and <code>\`\`\`</code> after it. <kbd>Tab</kbd> indents and <kbd>Shift</kbd>+<kbd>Tab</kbd> outdents. Paste or drag in a diagram image (a screenshot, an Excalidraw export or a whiteboard photo). The AI looks at it when evaluating. Use <b>Preview</b> to check the result. Saving a changed answer clears any earlier verdict. <kbd>Ctrl/⌘ S</kbd> saves.</p>
      </section>
      <section class="card" id="verdictCard"></section>
      <section class="card">
        <h2>Notes &amp; doubts <span class="spacer"></span><span class="save-state" id="notesState"></span>
          <button type="button" class="vbtn dictate" id="notesMic" title="Dictate into your notes (click again to stop)">${KBVoice.ICON.mic}<span>Dictate</span></button>
          <button class="btn" id="notesSave" data-save disabled>Save notes</button></h2>
        <textarea class="notes" id="notes" placeholder="Free-form notes. Ask a question on its own line:\n#doubt why is the Board a separate class from Game?"></textarea>
        <div class="doubts" id="doubts"></div>
      </section>`);

    // ----- answer -----
    const ansState = $("#ansState"), ansSave = $("#ansSave");
    const editor = new toastui.Editor({
      el: $("#ansEditor"),
      // Markdown mode by default: ```java fences, Tab indents, Enter keeps indentation.
      // The switch at the bottom flips to WYSIWYG; the choice is remembered.
      height: "auto",
      minHeight: "380px",
      initialEditType: store.get("kb-editor-mode", "markdown"),
      hideModeSwitch: false,
      previewStyle: "tab",
      usageStatistics: false,
      autofocus: false,
      theme: isDark() ? "dark" : "light",
      initialValue: item.userAnswer || "",
      placeholder: ctx.placeholder,
      toolbarItems: [["heading", "bold", "italic", "strike"], ["hr", "quote"], ["ul", "ol", "task"], ["table", "image", "link"], ["code", "codeblock"]],
      // Pasted/dropped/inserted images are uploaded to content/images and referenced by URL,
      // instead of being inlined as base64 text (which the AI can't see and which bloats prompts).
      hooks: {
        addImageBlobHook: async (blob, done) => {
          setSave(ansState, "", "Uploading image…");
          try {
            const r = await fetch("/api/images", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || r.statusText);
            const alt = (blob.name && !/^image\.(png|jpe?g)$/i.test(blob.name) ? blob.name.replace(/\.\w+$/, "") : "diagram");
            done(j.url, alt);
            setSave(ansState, "dirty", "Image added. Save to keep it");
          } catch (e) { setSave(ansState, "err", "Image upload failed: " + e.message); }
        },
      },
    });
    state.editors.push(editor);
    editor.on("changeMode", (mode) => store.set("kb-editor-mode", mode));
    let savedAns = editor.getMarkdown();
    let ansDirty = false, notesDirty = false;
    const syncDirty = () => { state.dirty = ansDirty || notesDirty; };
    editor.on("change", () => {
      ansDirty = editor.getMarkdown() !== savedAns;
      ansSave.disabled = !ansDirty; syncDirty();
      setSave(ansState, ansDirty ? "dirty" : "", ansDirty ? "Unsaved changes" : "");
    });
    async function saveAnswer() {
      const md = editor.getMarkdown();
      ansSave.disabled = true; setSave(ansState, "", "Saving…");
      try {
        const r = await api.post(ctx.answerUrl, { ...ctx.address, userAnswer: md });
        savedAns = md; ansDirty = false; syncDirty();
        Object.assign(item, r.topic || r.problem);
        setSave(ansState, "ok", "Saved " + new Date().toLocaleTimeString());
        renderVerdict(); refreshMeta();
        return true;
      } catch (e) { ansSave.disabled = false; setSave(ansState, "err", "Save failed: " + e.message); return false; }
    }
    ansSave.addEventListener("click", saveAnswer);
    dictation($("#ansMic"), ansState, (t) => { editor.focus(); editor.insertText(t); });

    // ----- verdict -----
    let evaluating = false;
    function renderVerdict(errMsg) {
      const card = $("#verdictCard");
      const label = evaluating ? "Evaluating…" : item.answerEvaluation ? "Re-evaluate" : "Evaluate with AI";
      const btn = `<button class="btn ${item.answerEvaluation ? "" : "primary"}" id="evalBtn" ${evaluating ? "disabled" : ""}>${label}</button>`;
      const err = errMsg ? `<p class="err">${esc(errMsg)}</p>` : "";
      if (item.answerEvaluation && !evaluating) {
        card.innerHTML = `<h2>Verdict <span class="spacer"></span><span class="muted small">evaluated ${esc(stamp(item.answerEvaluatedAt))}</span>${btn}</h2>${err}<div class="verdict" id="verdictBody"></div>`;
        viewer($("#verdictBody"), item.answerEvaluation);
      } else {
        card.innerHTML = `<h2>Verdict <span class="spacer"></span>${btn}</h2>${err}
          ${evaluating
            ? `<div class="thinking"><i></i><i></i><i></i><span>Reading your answer and grading it. This usually takes 10–40 seconds.</span></div>`
            : `<p class="muted" style="margin-top:0">${isAnswered(item) ? "Not evaluated yet." : "Write an attempt, then evaluate it. Unsaved changes are saved first."}</p>`}
          <div class="ask"><span>From a terminal:</span><code>${esc(evalCmd)}</code>${copyButton(evalCmd)}</div>`;
      }
      $("#evalBtn").addEventListener("click", runEval);
    }
    async function runEval() {
      if (!ensureAi()) return;
      if (ansDirty && !(await saveAnswer())) return;
      if (!isAnswered(item)) return renderVerdict("Write an answer first. The editor is empty.");
      evaluating = true; renderVerdict();
      try {
        const r = await api.post("/api/ai/evaluate", ctx.addr);
        Object.assign(item, r.item);
        evaluating = false; renderVerdict(); refreshMeta();
      } catch (e) {
        evaluating = false; renderVerdict(e.message);
        if (e.code === "NO_KEY") openAiSettings(e.message);
      }
    }
    renderVerdict();

    tutorCard($("#verdictCard"), item, ctx);

    // ----- notes & doubts -----
    const notes = $("#notes"), notesSave = $("#notesSave"), notesState = $("#notesState");
    notes.value = item.notes || "";
    let savedNotes = notes.value;
    const doubtCmd = `kb doubts ${ctx.cli}`;
    const renderDoubts = (busy, errMsg) => {
      const ds = parseDoubts(notes.value);
      const box = $("#doubts");
      const openN = ds.filter((d) => !d.a).length;
      box.innerHTML = ds.map((d, i) => `<div class="doubt"><div class="q">Q. ${esc(d.q)}</div>${d.a ? `<div class="a" id="da${i}"></div>` : `<div class="a open">${busy ? "Answering…" : "Unanswered"}</div>`}</div>`).join("")
        + (openN ? `<div class="row"><button class="btn" id="doubtAi" ${busy ? "disabled" : ""}>${busy ? "Answering…" : `Answer ${openN > 1 ? `${openN} doubts` : "doubt"} with AI`}</button>
            <span class="muted small">or <code>${esc(doubtCmd)}</code></span>${errMsg ? `<span class="err small">${esc(errMsg)}</span>` : ""}</div>` : "");
      ds.forEach((d, i) => d.a && viewer($("#da" + i), d.a));
      $("#doubtAi")?.addEventListener("click", answerDoubts);
    };
    async function saveNotes() {
      notesSave.disabled = true; setSave(notesState, "", "Saving…");
      try {
        await api.post(ctx.notesUrl, { ...ctx.address, notes: notes.value });
        savedNotes = notes.value; notesDirty = false; syncDirty();
        item.notes = notes.value;
        setSave(notesState, "ok", "Saved " + new Date().toLocaleTimeString());
        renderDoubts();
        return true;
      } catch (e) { notesSave.disabled = false; setSave(notesState, "err", "Save failed: " + e.message); return false; }
    }
    async function answerDoubts() {
      if (!ensureAi()) return;
      if (notesDirty && !(await saveNotes())) return;
      renderDoubts(true);
      notes.readOnly = true; // the server is about to rewrite these notes
      try {
        const r = await api.post("/api/ai/doubts", ctx.addr);
        item.notes = notes.value = savedNotes = r.item.notes;
        renderDoubts(); refreshMeta();
      } catch (e) {
        renderDoubts(false, e.message);
        if (e.code === "NO_KEY") openAiSettings(e.message);
      } finally { notes.readOnly = false; }
    }
    renderDoubts();
    notes.addEventListener("input", () => {
      notesDirty = notes.value !== savedNotes;
      notesSave.disabled = !notesDirty; syncDirty();
      setSave(notesState, notesDirty ? "dirty" : "", notesDirty ? "Unsaved changes" : "");
      // Show new #doubt lines (and the AI button) as you type; answering saves first.
      clearTimeout(doubtTimer); doubtTimer = setTimeout(() => renderDoubts(), 500);
    });
    let doubtTimer = null;
    notesSave.addEventListener("click", saveNotes);
    dictation($("#notesMic"), notesState, (t) => {
      const a = notes.selectionStart ?? notes.value.length, b = notes.selectionEnd ?? a;
      notes.value = notes.value.slice(0, a) + t + notes.value.slice(b);
      notes.selectionStart = notes.selectionEnd = a + t.length;
      notes.dispatchEvent(new Event("input"));
    });
  }

  // Mic button that keeps listening until clicked again (or a long pause), then inserts the text.
  function dictation(btn, stateEl, insert) {
    btn.addEventListener("click", async () => {
      if (KBVoice.isListening()) { KBVoice.stopListening(); return; }
      try {
        const text = await KBVoice.listen({
          continuous: true,
          onState: (st, detail) => {
            btn.classList.toggle("on", st === "listening");
            btn.classList.toggle("busy", st === "transcribing" || st === "loading");
            btn.querySelector("span").textContent = st === "listening" ? "Stop" : st === "idle" ? "Dictate" : "…";
            if (st === "listening") setSave(stateEl, "dirty", "Listening… click Stop when done");
            else if (st === "transcribing") setSave(stateEl, "", "Turning speech into text…");
            else if (st === "loading") setSave(stateEl, "", detail || "Loading Whisper…");
          },
        });
        if (text) insert(text.replace(/\s+$/, "") + " ");
        else setSave(stateEl, "", "Didn't catch anything.");
      } catch (e) { setSave(stateEl, "err", e.message); }
    });
  }

  async function refreshMeta() {
    await Promise.all([loadNav(), loadProgress()]);
  }

  // ---------- views ----------
  // Topic write-ups are split by "## " heading. Problem + Requirements are the brief you design from;
  // everything else (abstractions/architecture, decisions & trade-offs, follow-ups, diagram) is the
  // reference design, hidden until you confirm, because it gives the answer away.
  const BRIEF_RE = /^(problem|requirements)/i;
  function splitSections(md) {
    return String(md || "").split(/^(?=## )/m).filter((x) => x.trim()).map((x) => ({ title: (/^##\s+(.+)/.exec(x) || [, ""])[1].trim(), md: x.trim() }));
  }
  const revealed = {
    has: (k) => store.get("kb-revealed", []).includes(k),
    set(k, on) { const l = store.get("kb-revealed", []).filter((x) => x !== k); if (on) l.push(k); store.set("kb-revealed", l); },
  };
  function topicHref(key) {
    const [cat, num] = key.split("-");
    const it = (state.tracks?.[cat] || []).find((x) => Number(x.number) === Number(num));
    return it ? `#/t/${it.day}/${it.topicIndex}` : null;
  }
  function fundItems() { return (state.fund?.groups || []).flatMap((g) => g.items.map((it) => ({ ...it, track: g.track }))); }

  function readFirstCard(key) {
    const ids = state.fund?.prereqs?.[key] || [];
    if (!ids.length) return "";
    const all = fundItems();
    const items = ids.map((id) => all.find((x) => x.id === id)).filter(Boolean);
    const done = items.filter((x) => x.readAt).length;
    return `<section class="card readfirst"><h2>Read first <span class="spacer"></span><span class="muted small">${done} of ${items.length} read</span></h2>
      <ul class="rf-list">${items.map((x) => `<li><a href="#/read/${esc(x.id)}">${statusDot({ evaluated: !!x.readAt })}<span class="rf-t">${esc(x.title)}</span></a><span class="rf-s">${esc(x.summary)}</span></li>`).join("")}</ul></section>`;
  }

  async function viewTopic(day, idx) {
    const root = $("#content");
    const d = await api.get(`/api/days/${day}`);
    const t = d.topics[idx];
    if (!t) throw new Error("Topic not found");
    const key = `${t.category}-${Number(t.number)}`;
    const dkey = `t${day}-${idx}`;
    const secs = splitSections(t.markdown);
    const brief = secs.filter((x) => BRIEF_RE.test(x.title));
    const ref = secs.filter((x) => !BRIEF_RE.test(x.title));
    const pills = String(t.concepts || "").split(/,\s*/).filter(Boolean).map((c) => `<span class="pill">${esc(c)}</span>`).join("");
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge ${esc(t.category)}">${esc(t.category)}</span><span>#${t.number}</span><span>·</span><span>Day ${d.day}</span></div>
        <h1 class="title">${esc(t.title)}</h1>
        <div class="pill-row">${pills}</div>
      </div>
      ${readFirstCard(key)}
      <section class="card" id="briefCard"><div id="brief"></div></section>`;
    if (brief.length) viewer($("#brief"), brief.map((x) => x.md).join("\n\n"));
    else $("#brief").innerHTML = '<p class="muted">No problem statement yet.</p>';

    practiceSections(root, t, {
      answerUrl: `/api/days/${day}/answer`, notesUrl: `/api/days/${day}/notes`,
      address: { topicIndex: idx },
      addr: { track: t.category, number: Number(t.number) },
      cli: `${t.category.toLowerCase()} ${Number(t.number)}`,
      placeholder: t.category === "LLD"
        ? "Your design: entities and classes, relationships, key interfaces, patterns, concurrency, extensibility…\n\nCode: type ```java on its own line, then your code, then ``` to close it."
        : t.category === "HLD"
          ? "Your design: estimates, APIs, data model, high-level architecture, deep dives, trade-offs…\n\nPaste or drag in a diagram image if you drew one."
          : "Your answer: explain each requirement in your own words, with Spring AI code where it helps…",
    });

    // Reference design: below everything, hidden until confirmed.
    root.insertAdjacentHTML("beforeend", '<div id="refZone"></div><div id="dayExtra"></div>');
    const refNames = [...(t.diagram?.nodes?.length ? ["diagram"] : []), ...ref.map((x) => x.title.toLowerCase())];
    const renderRef = (asking) => {
      const zone = $("#refZone");
      if (!ref.length && !t.diagram?.nodes?.length) { zone.innerHTML = ""; return; }
      if (revealed.has(key)) {
        zone.innerHTML = `<section class="card"><h2>Reference design <span class="spacer"></span><button class="btn small" id="refHide">Hide again</button></h2>
            ${t.diagram?.nodes?.length ? `<div class="diagram" id="diagram" data-diagram="${dkey}"></div>` : ""}<div id="writeup"></div></section>`;
        if (t.diagram?.nodes?.length) { const dg = $("#diagram"); dg._spec = t.diagram; KBDiagram.render(dg, t.diagram, dkey); }
        viewer($("#writeup"), ref.map((x) => x.md).join("\n\n"));
        $("#refHide").addEventListener("click", () => { revealed.set(key, false); renderRef(); });
        return;
      }
      const answered = isAnswered(t), evaluated = !!t.answerEvaluation;
      const warn = evaluated
        ? "You've written an answer and it's been evaluated, so this is a good time to compare."
        : answered
          ? "You've saved an answer but haven't had it evaluated yet. Evaluating first gives you an honest score before you see the reference."
          : "You haven't saved an answer yet. Seeing the reference first turns the exercise into reading. Try writing your own design first, even a rough one.";
      zone.innerHTML = `<section class="card gate">
        <h2>Reference design <span class="spacer"></span><span class="muted small">hidden</span></h2>
        <p class="muted" style="margin-top:0">Contains the ${esc(refNames.join(", "))}. These are hints towards the design, so attempt it yourself first.</p>
        ${asking
          ? `<div class="confirm"><p><b>Are you sure you want to see it?</b> ${esc(warn)}</p>
               <div class="row"><button class="btn ${answered ? "primary" : ""}" id="refYes">${answered ? "Yes, show the reference" : "Show it anyway"}</button>
               <button class="btn ${answered ? "" : "primary"}" id="refNo">${answered ? "Not now" : "I'll attempt it first"}</button></div></div>`
          : `<button class="btn" id="refAsk">Show reference design…</button>`}
      </section>`;
      if (asking) {
        $("#refYes").addEventListener("click", () => { revealed.set(key, true); renderRef(); });
        $("#refNo").addEventListener("click", () => renderRef(false));
      } else $("#refAsk").addEventListener("click", () => renderRef(true));
    };
    renderRef();
    if (d.sketch || d.evaluation) {
      $("#dayExtra").insertAdjacentHTML("beforeend", `<section class="card"><h2>Day ${d.day} sketch review</h2>
        ${d.sketch ? `<img src="${esc(d.sketch)}" alt="Your design sketch for day ${d.day}" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">` : ""}
        <div id="dayEval"></div></section>`);
      if (d.evaluation) viewer($("#dayEval"), d.evaluation);
    }
    document.title = `${t.title} — KB`;
  }

  async function viewRead(id) {
    const root = $("#content");
    const fund = await api.get("/api/fundamentals");
    state.fund = fund;
    const all = fund.groups.flatMap((g) => g.items.map((it) => ({ it, g })));
    const i = all.findIndex((x) => x.it.id === id);
    if (i < 0) throw new Error("Article not found");
    const { it, g } = all[i];
    const prev = all[i - 1], next = all[i + 1];
    const used = (it.usedBy || []).map((u) => { const h = topicHref(u.key); return h ? `<a class="pill link" href="${h}">${esc(u.key.replace("-", " "))} · ${esc(u.title)}</a>` : ""; }).join("");
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge ${esc(g.track)}">${esc(g.track)}</span><span>Fundamentals</span><span>·</span><span>#${it.number}</span></div>
        <h1 class="title">${esc(it.title)}</h1>
        <p class="lede">${esc(it.summary)}</p>
        ${used ? `<div class="pill-row"><span class="muted small" style="align-self:center">Read before:</span>${used}</div>` : ""}
      </div>
      <nav class="card toc" id="toc" hidden><div class="toc-title">On this page</div><ol id="tocList"></ol></nav>
      <section class="card" id="articleCard"><div id="article"></div>
        <div class="row" style="margin-top:18px"><button class="btn ${it.readAt ? "" : "primary"}" id="markRead">${it.readAt ? "✓ Read · mark as unread" : "Mark as read"}</button>
          <span class="muted small">${it.readAt ? "read " + esc(stamp(it.readAt)) : ""}</span></div>
      </section>
      <div class="pager">${prev ? `<a class="btn" href="#/read/${esc(prev.it.id)}">← ${esc(prev.it.title)}</a>` : "<span></span>"}${next ? `<a class="btn" href="#/read/${esc(next.it.id)}">${esc(next.it.title)} →</a>` : ""}</div>`;
    viewer($("#article"), it.markdown.replace(/^[^\n]*(\n[^\n#][^\n]*)*\n*/, ""));   // first paragraph is the lede above
    // Contents list: one entry per "##" heading; clicks scroll (hash routing owns the URL).
    const heads = [...$("#article").querySelectorAll("h2")];
    if (heads.length > 2) {
      $("#tocList").innerHTML = heads.map((h, k) => `<li><button type="button" data-k="${k}">${esc(h.textContent)}</button></li>`).join("");
      $("#tocList").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) heads[+b.dataset.k].scrollIntoView({ behavior: "smooth", block: "start" }); });
      $("#toc").hidden = false;
    }
    $("#markRead").addEventListener("click", async () => {
      try { await api.post("/api/fundamentals/read", { id: it.id, read: !it.readAt }); await loadNav(); viewRead(id); } catch (e) { alert(e.message); }
    });
    tutorCard($("#articleCard"), it, {
      addr: { track: "READ", number: it.number }, cli: `read ${it.number}`,
      tutorTitle: "Ask the tutor about this",
      chatPlaceholder: "Ask anything about this concept…  (Enter sends · Shift+Enter for a new line)",
      chips: ["Explain it with a real-world example", "Quiz me on this", "What do interviewers ask about this?", "Common misconceptions?"],
    });
    document.title = `${it.title} — KB`;
  }

  async function viewDsa(ti, pi) {
    const root = $("#content");
    const dsa = await api.get("/api/dsa");
    const tp = dsa.topics[ti];
    const p = tp?.problems[pi];
    if (!p) throw new Error("Problem not found");
    const link = p.leetcodeUrl
      ? `<a href="${esc(p.leetcodeUrl)}" target="_blank" rel="noopener">Open on LeetCode ↗</a>${p.premium ? ' <span class="muted small">(LeetCode Premium)</span>' : ""}`
      : `<span class="muted">Classic problem with no exact LeetCode match. Search the title on GeeksforGeeks or your preferred judge.</span>`;
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge DSA">DSA</span><a href="#/pattern/${ti}">${esc(tp.name)}</a><span>·</span><span>#${p.number}</span>${diffChip(p.difficulty, true)}</div>
        <h1 class="title">${esc(p.title)}</h1>
        <div class="dsa-link">${link}</div>
      </div>
      ${tp.guide ? `<details class="card guide-card" id="guideCard"><summary><h2>Pattern guide: ${esc(tp.name)}</h2><span class="muted small">${esc(tp.summary || "")}</span></summary><div id="guideBody"></div></details>` : ""}`;
    const gc = $("#guideCard");
    if (gc) gc.addEventListener("toggle", () => { if (gc.open && !gc._done) { gc._done = true; viewer($("#guideBody"), guideBody(tp.guide)); } });
    practiceSections(root, p, {
      answerUrl: "/api/dsa/answer", notesUrl: "/api/dsa/notes",
      address: { topicIndex: ti, problemIndex: pi },
      addr: { track: "DSA", number: Number(p.number) },
      cli: `dsa ${Number(p.number)}`,
      placeholder: "Which pattern applies and why, then approach, complexity, edge cases…\n\nCode: type ```java on its own line, then your code, then ``` to close it.",
    });
    document.title = `${p.title} — KB`;
  }

  async function viewPattern(ti) {
    const root = $("#content");
    const dsa = await api.get("/api/dsa");
    const tp = dsa.topics[ti];
    if (!tp) throw new Error("Pattern not found");
    const done = tp.problems.filter(isAnswered).length, evald = tp.problems.filter((p) => p.answerEvaluation).length;
    const prev = dsa.topics[ti - 1], next = dsa.topics[ti + 1];
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge DSA">DSA</span><span>Pattern ${ti + 1} of ${dsa.topics.length}</span><span>·</span><span>${tp.problems.length} problems</span><span>·</span><span>${done} attempted, ${evald} evaluated</span></div>
        <h1 class="title">${esc(tp.name)}</h1>
        ${tp.summary ? `<p class="lede">${esc(tp.summary)}</p>` : ""}
      </div>
      <section class="card"><h2>Practice problems <span class="spacer"></span><span class="muted small">easy → hard</span></h2>
        <table class="ptable"><tbody>${tp.problems.map((p, pi) => `
          <tr data-go="#/dsa/${ti}/${pi}">
            <td class="n">${p.number}</td>
            <td class="t"><a href="#/dsa/${ti}/${pi}">${esc(p.title)}</a>${p.premium ? ' <span class="muted small">Premium</span>' : ""}</td>
            <td>${diffChip(p.difficulty, true)}</td>
            <td class="st">${statusDot({ answered: isAnswered(p), evaluated: !!p.answerEvaluation })}</td>
          </tr>`).join("")}</tbody></table>
      </section>
      ${tp.guide ? `<section class="card"><h2>Guide</h2><div id="guideBody"></div></section>` : ""}
      <div class="pager">${prev ? `<a class="btn" href="#/pattern/${ti - 1}">← ${esc(prev.name)}</a>` : "<span></span>"}${next ? `<a class="btn" href="#/pattern/${ti + 1}">${esc(next.name)} →</a>` : ""}</div>`;
    if (tp.guide) viewer($("#guideBody"), guideBody(tp.guide));
    root.querySelectorAll("tr[data-go]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.go; }));
    document.title = `${tp.name} — KB`;
  }

  async function viewHome() {
    const p = (await loadProgress()) || { totalTopics: 0, answered: 0, evaluated: 0, answeredPct: 0, evaluatedPct: 0 };
    const t = state.tracks || {};
    const gen = TRACKS.reduce((s, tr) => s + (t[tr.key] || []).length, 0);
    const dsaN = (state.dsa?.topics || []).reduce((s, x) => s + x.problems.length, 0);
    const days = new Set(TRACKS.flatMap((tr) => (t[tr.key] || []).map((i) => i.day)));
    $("#content").innerHTML = `
      <div class="home">
        <h1>KB</h1>
        <p class="muted" style="margin-top:0">Pick a topic from the sidebar. Press <kbd>\\</kbd> to toggle it.</p>
        <div class="grid">
          <div class="stat"><div class="k">Attempted</div><div class="v">${p.answeredPct}%</div><div class="bar"><span class="fill answered" style="width:${p.answeredPct}%"></span></div><div class="muted small">${p.answered} of ${p.totalTopics}</div></div>
          <div class="stat"><div class="k">Evaluated</div><div class="v">${p.evaluatedPct}%</div><div class="bar"><span class="fill evaluated" style="width:${p.evaluatedPct}%"></span></div><div class="muted small">${p.evaluated} of ${p.totalTopics}</div></div>
          <div class="stat"><div class="k">Days generated</div><div class="v">${days.size}</div><div class="muted small">${gen} design topics</div></div>
          <div class="stat"><div class="k">DSA problems</div><div class="v">${dsaN}</div><div class="muted small">${(state.dsa?.topics || []).length} patterns</div></div>
          ${state.fund ? (() => { const f = state.fund.groups.flatMap((g) => g.items); const r = f.filter((x) => x.readAt).length; return `<div class="stat"><div class="k">Fundamentals read</div><div class="v">${r}/${f.length}</div><div class="bar"><span class="fill evaluated" style="width:${f.length ? (r * 100 / f.length) : 0}%"></span></div><div class="muted small"><a href="#/read/${esc(f[0].id)}">Start reading</a></div></div>`; })() : ""}
        </div>
        ${aiCfg && !aiCfg.ready ? `<section class="card"><h2>Connect an AI tutor</h2><p style="margin-top:0">Evaluate answers and chat about any topic with Claude, OpenAI, or a free local model through Ollama. Your key stays on this machine.</p><button class="btn primary" id="homeAi">Set up AI</button></section>` : ""}
        ${gen ? "" : `<section class="card"><h2>No day content yet</h2><p style="margin:0">Put your <code>study.md</code> in the project root, then generate day 1 — ask in chat (“generate day 1”) or run <code>node scripts/new-day.js 1</code> to scaffold it.</p></section>`}
      </div>`;
    $("#homeAi")?.addEventListener("click", () => openAiSettings());
    document.title = "KB — Study Practice";
  }

  // ---------- router ----------
  let lastHash = location.hash;
  async function route(force) {
    if (!force && state.dirty && !confirm("You have unsaved changes. Leave anyway?")) {
      history.replaceState(null, "", lastHash); return;
    }
    state.dirty = false; lastHash = location.hash;
    if (state.chatAbort) { state.chatAbort.abort(); state.chatAbort = null; }
    if (state.voiceCleanup) { state.voiceCleanup(); state.voiceCleanup = null; }
    state.onAiChange = null;
    destroyEditors();
    const h = location.hash.replace(/^#\/?/, "").split("/");
    $("#content").scrollTop = 0;
    try {
      if (h[0] === "t") await viewTopic(Number(h[1]), Number(h[2]));
      else if (h[0] === "dsa") await viewDsa(Number(h[1]), Number(h[2]));
      else if (h[0] === "pattern") await viewPattern(Number(h[1]));
      else if (h[0] === "read") await viewRead(decodeURIComponent(h[1] || ""));
      else await viewHome();
    } catch (e) {
      $("#content").innerHTML = `<section class="card"><h2>Couldn't load this</h2><p class="muted">${esc(e.message)}</p><a href="#/">Home</a></section>`;
    }
    markActive();
    if (window.innerWidth <= 780 && h[0]) document.body.classList.add("sidebar-collapsed");
  }
  window.addEventListener("hashchange", () => route(false));

  (async function init() {
    await loadAi();
    try { await loadNav(); } catch (e) { $("#nav").innerHTML = `<div class="empty-note">Couldn't reach the server.</div>`; }
    await route(true);
    loadProgress();
  })();
})();
