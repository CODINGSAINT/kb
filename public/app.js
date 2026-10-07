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
  const practice = $("#practiceMode");
  practice.checked = store.get("kb-practice", false);
  practice.addEventListener("change", () => { store.set("kb-practice", practice.checked); state.renderCanon && state.renderCanon(); });

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
    const [tracks, dsa] = await Promise.all([api.get("/api/tracks"), api.get("/api/dsa")]);
    state.tracks = tracks; state.dsa = dsa;
    renderNav();
  }
  const statusDot = (it) => `<span class="status ${it.evaluated ? "evaluated" : it.answered ? "answered" : ""}" title="${it.evaluated ? "Evaluated" : it.answered ? "Attempted" : "Not attempted"}"></span>`;
  const isAnswered = (p) => !!(p.userAnswer && p.userAnswer.trim());

  function renderNav() {
    const open = store.get("kb-open", { LLD: true, HLD: true, AI: true, DSA: true });
    const q = $("#filter").value.trim().toLowerCase();
    const match = (s) => !q || String(s).toLowerCase().includes(q);
    let html = "";
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
      <summary>${CHEV}<span class="track-dot" style="background:var(--dsa)"></span>DSA — Striver SDE Sheet<span class="count">${dsaDone}/${dsaTotal}</span></summary>`;
    dsaTopics.forEach((tp, ti) => {
      const probs = tp.problems.map((p, pi) => ({ p, pi })).filter(({ p }) => match(p.title) || match(tp.name));
      if (!probs.length) return;
      const key = "DSA:" + tp.name;
      const d = tp.problems.filter(isAnswered).length;
      html += `<details class="subtrack" data-key="${esc(key)}" ${open[key] || q ? "open" : ""}>
        <summary>${CHEV}${esc(tp.name)}<span class="count">${d}/${tp.problems.length}</span></summary>
        <ul class="items">${probs.map(({ p, pi }) => `<li><a href="#/dsa/${ti}/${pi}" data-href="#/dsa/${ti}/${pi}"><span class="num">${p.number}</span><span class="t">${esc(p.title)}</span>${statusDot({ answered: isAnswered(p), evaluated: !!p.answerEvaluation })}</a></li>`).join("")}</ul>
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

  // Builds the "My answer" + "Verdict" + "AI tutor" + "Notes & doubts" cards. `ctx` supplies save URLs/addresses.
  function practiceSections(root, item, ctx) {
    const evalCmd = `kb evaluate ${ctx.cli}`;
    const clarifyCmd = `kb clarify ${ctx.cli} "your question"`;
    root.insertAdjacentHTML("beforeend", `
      <section class="card" id="answerCard">
        <h2>My answer <span class="spacer"></span><span class="save-state" id="ansState"></span>
          <button class="btn primary" id="ansSave" data-save disabled>Save answer</button></h2>
        <div id="ansEditor"></div>
        <p class="muted small" style="margin:10px 0 0">Saved as Markdown. For code, put <code>\`\`\`java</code> on its own line before it and <code>\`\`\`</code> after it. <kbd>Tab</kbd> indents and <kbd>Shift</kbd>+<kbd>Tab</kbd> outdents. Paste or drag in a diagram image (a screenshot, an Excalidraw export or a whiteboard photo). The AI looks at it when evaluating. Use <b>Preview</b> to check the result. Saving a changed answer clears any earlier verdict. <kbd>Ctrl/⌘ S</kbd> saves.</p>
      </section>
      <section class="card" id="verdictCard"></section>
      <section class="card tutor" id="tutorCard">
        <h2>Discuss with the AI tutor <span class="spacer"></span>
          <span class="muted small" id="tutorModel"></span>
          <button class="btn small" id="chatClear" title="Start a fresh conversation">Clear</button></h2>
        <div class="chat" id="chatLog" aria-live="polite"></div>
        <div class="chips" id="chatChips"></div>
        <form class="chat-input" id="chatForm">
          <textarea id="chatText" rows="2" placeholder="Ask about this topic or your answer…  (Enter sends · Shift+Enter for a new line)"></textarea>
          <button class="btn primary" id="chatSend" type="submit">Send</button>
        </form>
        <div class="cli-hint muted small">Same conversation from a terminal: <code>${esc(clarifyCmd)}</code> ${copyButton(clarifyCmd)}</div>
      </section>
      <section class="card">
        <h2>Notes &amp; doubts <span class="spacer"></span><span class="save-state" id="notesState"></span>
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

    // ----- AI tutor chat -----
    const chatLog = $("#chatLog"), chatText = $("#chatText"), chatSend = $("#chatSend");
    const showModel = () => { $("#tutorModel").textContent = aiCfg && aiCfg.ready ? `${shortName(aiCfg.provider)} · ${aiCfg.model}` : "AI not set up"; };
    state.onAiChange = showModel; showModel();
    function appendMsg(role, content, raw) {
      const el = document.createElement("div");
      el.className = "msg " + role;
      el.innerHTML = `<div class="who">${role === "user" ? "You" : "Tutor"}</div><div class="body"></div>`;
      chatLog.appendChild(el);
      const body = el.querySelector(".body");
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
    const CHIPS = isAnswered(item) || item.answerEvaluation
      ? ["What's weakest in my answer?", "Quiz me like an interviewer", "Explain the key trade-offs simply", "What follow-ups would an interviewer ask?"]
      : ["Explain this topic in 5 bullet points", "Quiz me like an interviewer", "What do interviewers look for here?", "Common mistakes on this one?"];
    $("#chatChips").innerHTML = CHIPS.map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join("");
    $("#chatChips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) sendChat(b.textContent); });

    let sending = false;
    async function sendChat(text) {
      text = String(text || "").trim();
      if (!text || sending) return;
      if (!ensureAi()) return;
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
        const r = await fetch("/api/ai/chat", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ctx.addr, message: text }), signal: ctrl.signal });
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
            }
          }
        }
        if (!acc.trim()) throw new Error("The model returned an empty reply.");
        body.classList.remove("streaming"); body.textContent = "";
        viewer(body, acc);
        item.chat = [...(item.chat || []), { role: "user", content: text }, { role: "assistant", content: acc.trim() }];
        $("#chatClear").hidden = false;
        scrollChat();
      } catch (e) {
        if (e.name === "AbortError") return;
        body.classList.remove("streaming");
        body.innerHTML = `<p class="err">${esc(e.message)}</p><p class="muted small">Your message wasn't saved. It's back in the box so you can retry.</p>`;
        chatText.value = text;
        if (e.code === "NO_KEY") openAiSettings(e.message);
      } finally {
        sending = false; chatSend.disabled = false;
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
  }

  async function refreshMeta() {
    await Promise.all([loadNav(), loadProgress()]);
  }

  // ---------- views ----------
  async function viewTopic(day, idx) {
    const root = $("#content");
    const d = await api.get(`/api/days/${day}`);
    const t = d.topics[idx];
    if (!t) throw new Error("Topic not found");
    const key = `t${day}-${idx}`;
    const pills = String(t.concepts || "").split(/,\s*/).filter(Boolean).map((c) => `<span class="pill">${esc(c)}</span>`).join("");
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge ${esc(t.category)}">${esc(t.category)}</span><span>#${t.number}</span><span>·</span><span>Day ${d.day}</span>
          ${d.generatedAt ? `<span>·</span><span>generated ${esc(stamp(d.generatedAt))}</span>` : ""}</div>
        <h1 class="title">${esc(t.title)}</h1>
        <div class="pill-row">${pills}</div>
      </div>
      <div id="canon"></div>`;
    const canon = $("#canon");
    state.renderCanon = () => {
      // Re-renders only the canonical section, so an in-progress answer is never lost.
      const hidden = practice.checked && !state.revealed.has(key);
      canon.innerHTML = hidden
        ? `<section class="card"><div class="reveal"><div>Practice mode: diagram and write-up are hidden so you can attempt it cold.</div><button class="btn" id="revealBtn">Reveal write-up</button></div></section>`
        : `<section class="card"><h2>Diagram</h2><div class="diagram" id="diagram" data-diagram="${key}"></div></section>
           <section class="card"><h2>Write-up</h2><div id="writeup"></div></section>`;
      if (hidden) { $("#revealBtn").addEventListener("click", () => { state.revealed.add(key); state.renderCanon(); }); return; }
      const dg = $("#diagram"); dg._spec = t.diagram; KBDiagram.render(dg, t.diagram, key);
      if (t.markdown) viewer($("#writeup"), t.markdown);
      else $("#writeup").innerHTML = '<p class="muted">Write-up not generated yet.</p>';
    };
    state.renderCanon();
    canon.insertAdjacentHTML("afterend", '<div id="dayExtra"></div>');
    if (d.sketch || d.evaluation) {
      $("#dayExtra").insertAdjacentHTML("beforeend", `<section class="card"><h2>Day ${d.day} sketch review</h2>
        ${d.sketch ? `<img src="${esc(d.sketch)}" alt="Your design sketch for day ${d.day}" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">` : ""}
        <div id="dayEval"></div></section>`);
      if (d.evaluation) viewer($("#dayEval"), d.evaluation);
    }
    practiceSections(root, t, {
      answerUrl: `/api/days/${day}/answer`, notesUrl: `/api/days/${day}/notes`,
      address: { topicIndex: idx },
      addr: { track: t.category, number: Number(t.number) },
      cli: `${t.category.toLowerCase()} ${Number(t.number)}`,
      placeholder: "Your design: requirements, key classes/components, trade-offs…\n\nCode: type ```java on its own line, then your code, then ``` to close it.",
    });
    document.title = `${t.title} — KB`;
  }

  async function viewDsa(ti, pi) {
    const root = $("#content");
    const dsa = await api.get("/api/dsa");
    const tp = dsa.topics[ti];
    const p = tp?.problems[pi];
    if (!p) throw new Error("Problem not found");
    root.innerHTML = `
      <div class="topic-head">
        <div class="crumbs"><span class="badge DSA">DSA</span><span>${esc(tp.name)}</span><span>·</span><span>#${p.number}</span></div>
        <h1 class="title">${esc(p.title)}</h1>
        <div class="dsa-link">${p.leetcodeUrl ? `<a href="${esc(p.leetcodeUrl)}" target="_blank" rel="noopener">Open on LeetCode ↗</a>` : `<span class="muted">No confident LeetCode match — search the title on your preferred judge.</span>`}</div>
      </div>`;
    practiceSections(root, p, {
      answerUrl: "/api/dsa/answer", notesUrl: "/api/dsa/notes",
      address: { topicIndex: ti, problemIndex: pi },
      addr: { track: "DSA", number: Number(p.number) },
      cli: `dsa ${Number(p.number)}`,
      placeholder: "Approach, complexity, edge cases…\n\nCode: type ```java on its own line, then your code, then ``` to close it.",
    });
    document.title = `${p.title} — KB`;
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
          <div class="stat"><div class="k">DSA problems</div><div class="v">${dsaN}</div><div class="muted small">${(state.dsa?.topics || []).length} topics</div></div>
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
    state.onAiChange = null;
    destroyEditors();
    state.renderCanon = null;
    const h = location.hash.replace(/^#\/?/, "").split("/");
    $("#content").scrollTop = 0;
    try {
      if (h[0] === "t") await viewTopic(Number(h[1]), Number(h[2]));
      else if (h[0] === "dsa") await viewDsa(Number(h[1]), Number(h[2]));
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
