// Provider-agnostic chat completion with streaming, shared by the Node server and the website.
// No SDKs: plain fetch, which Node 18+ and every browser have.
// Providers: anthropic (Claude), openai (or any OpenAI-compatible endpoint, e.g. Groq, Gemini,
// OpenRouter), ollama (local), and mock (for tests).
//
// The caller resolves settings ({ provider, model, apiKey, baseUrl, keySource }); this file only talks HTTP.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBLlm = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const IN_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

  const PROVIDERS = {
    anthropic: { name: "Claude (Anthropic)", needsKey: true, defaults: { model: "claude-sonnet-5-5" },
      models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"], keyUrl: "https://console.anthropic.com/settings/keys" },
    openai: { name: "OpenAI", needsKey: true, defaults: { model: "gpt-5", baseUrl: "https://api.openai.com/v1" },
      models: ["gpt-5", "gpt-5-mini"], keyUrl: "https://platform.openai.com/api-keys" },
    ollama: { name: "Ollama (local, free)", needsKey: false, defaults: { model: "gemma4:12b", baseUrl: "http://localhost:11434/v1" },
      models: ["gemma4:12b", "qwen3.5:9b", "qwen3.6:27b"], keyUrl: "https://ollama.com" },
  };

  function assertReady(s, setupHint) {
    if (s.provider !== "mock" && PROVIDERS[s.provider].needsKey && !s.apiKey) {
      throw Object.assign(new Error(`No API key for ${PROVIDERS[s.provider].name}. ${setupHint || "Open AI settings (the AI button at the top)."}`), { code: "NO_KEY" });
    }
  }

  // Read a server-sent-events body and yield each `data:` payload.
  async function* sse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
      }
    } finally { try { reader.releaseLock(); } catch (e) {} }
  }

  async function httpError(res, s) {
    let msg = "";
    try { const j = await res.json(); msg = (j.error && j.error.message) || j.message || JSON.stringify(j); } catch (e) { msg = res.statusText; }
    if (res.status === 401 || res.status === 403) {
      let host = (PROVIDERS[s.provider] && PROVIDERS[s.provider].name) || s.provider;
      try { if (s.baseUrl) host = new URL(s.baseUrl).host; } catch (e) {}
      const which = s.apiKey ? ` The key sent came from ${s.keySource || "settings"} and ends in ...${s.apiKey.slice(-4)}.` : " No key was sent.";
      msg = `${host} rejected the API key (${res.status}).${which} ${msg}`;
    }
    else if (res.status === 404) msg = `Model "${s.model}" not found (404). Pick another model in settings. ${msg}`;
    else if (res.status === 429) msg = `Rate limited or out of credit (429). ${msg}`;
    else msg = `${s.provider} error ${res.status}: ${msg}`;
    return Object.assign(new Error(msg), { status: res.status });
  }

  // Turn a bare "fetch failed" / "Failed to fetch" into something actionable.
  function netError(e, s, url) {
    if (e.name === "AbortError") return e;
    const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
    const host = (() => { try { return new URL(url).host; } catch (x) { return url; } })();
    if (IN_BROWSER) {
      if (s.provider === "ollama") return new Error(`Can't reach Ollama at ${s.baseUrl} from this page. Make sure Ollama is running and allows this site: start it with OLLAMA_ORIGINS=${location.origin} (see the README).`);
      return new Error(`Can't reach ${host} from the browser (${why}). Check your connection, or that this provider allows calls from web pages; the local app (npm start) works with every provider.`);
    }
    if (s.provider === "ollama") return new Error(`Can't reach Ollama at ${s.baseUrl}. Is "ollama serve" running? (${why})`);
    return new Error(`Can't reach ${host} (${why}). Check your internet connection, VPN or corporate proxy.`);
  }

  // Message content is a string, or an array of parts:
  //   { type: "text", text } | { type: "image", mediaType: "image/png", data: "<base64>" }
  const parts = (c) => (Array.isArray(c) ? c : [{ type: "text", text: String(c == null ? "" : c) }]);
  const hasImages = (msgs) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"));
  const textOf = (c) => parts(c).filter((p) => p.type === "text").map((p) => p.text).join("\n");
  function toAnthropic(c) {
    if (!Array.isArray(c)) return c;
    return c.map((p) => p.type === "image"
      ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }
      : { type: "text", text: p.text });
  }
  function toOpenAI(c) {
    if (!Array.isArray(c)) return c;
    return c.map((p) => p.type === "image"
      ? { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } }
      : { type: "text", text: p.text });
  }
  function stripImages(msgs) {
    return msgs.map((m) => {
      if (!Array.isArray(m.content)) return m;
      const n = m.content.filter((p) => p.type === "image").length;
      const t = textOf(m.content);
      return Object.assign({}, m, { content: n ? `${t}\n\n(${n} image(s) were attached, but this model can't read images, so they were left out.)` : t });
    });
  }

  // Models installed in Ollama, e.g. ["gemma4:12b", "qwen3.5:9b"]. [] if Ollama is unreachable.
  async function listOllamaModels(baseUrl) {
    const url = String(baseUrl || PROVIDERS.ollama.defaults.baseUrl).replace(/\/+$/, "");
    try {
      const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.data || []).map((m) => m.id).filter(Boolean).sort();
    } catch (e) { return []; }
  }

  /**
   * Run one completion with resolved settings `s`.
   *   opts.system:   string
   *   opts.messages: [{ role: "user" | "assistant", content: string | parts[] }]
   *   opts.onToken:  optional (text) => void, called as text streams in
   *   opts.signal:   optional AbortSignal
   *   opts.meta:     optional object; gets imagesDropped = true if the model couldn't take images
   *   opts.maxTokens
   *   hooks.onOllamaModel(name): called when a bare Ollama name was matched to an installed tag
   * Returns the full reply text.
   */
  async function complete(s, opts, hooks) {
    try {
      return await completeOnce(s, opts, opts.messages, hooks || {});
    } catch (e) {
      // A text-only model rejects image input (usually 400; Ollama can say 500). Retry without them.
      if (!hasImages(opts.messages) || e.name === "AbortError" || ![400, 415, 422, 500].includes(e.status)) throw e;
      if (opts.meta) opts.meta.imagesDropped = true;
      return completeOnce(s, opts, stripImages(opts.messages), hooks || {});
    }
  }

  async function completeOnce(s, { system, onToken, signal, maxTokens = 4096 }, messages, hooks) {
    let text = "";
    const emit = (t) => { if (!t) return; text += t; onToken && onToken(t); };

    if (s.provider === "mock") {
      const lastC = messages[messages.length - 1] && messages[messages.length - 1].content;
      const nImg = parts(lastC).filter((p) => p.type === "image").length;
      const last = textOf(lastC) + (nImg ? ` [saw ${nImg} image(s)]` : "");
      const reply = /grading a candidate/i.test(system)
        ? `**Verdict: Solid**\n\n### What you got right\n- (mock) You covered the core entities.${nImg ? ` (mock) Received ${nImg} diagram image(s).` : ""}\n\n` + "### Gaps\n- (mock) Concurrency is not discussed.\n\n### To study next\n- (mock) Locking strategies."
        : `(mock reply) You asked: "${last.slice(0, 120)}". The key idea is to separate responsibilities.`;
      for (const w of reply.split(/(?<= )/)) { if (signal && signal.aborted) break; emit(w); await new Promise((r) => setTimeout(r, 5)); }
      return text;
    }

    if (s.provider === "anthropic") {
      const url = "https://api.anthropic.com/v1/messages";
      const headers = { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" };
      if (IN_BROWSER) headers["anthropic-dangerous-direct-browser-access"] = "true"; // the key is the learner's own, typed into their own browser
      const res = await fetch(url, {
        method: "POST", signal, headers,
        body: JSON.stringify({ model: s.model, max_tokens: maxTokens, system, stream: true,
          messages: messages.map((m) => ({ role: m.role, content: toAnthropic(m.content) })) }),
      }).catch((e) => { throw netError(e, s, url); });
      if (!res.ok) throw await httpError(res, s);
      for await (const data of sse(res.body)) {
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") emit(ev.delta.text);
        else if (ev.type === "error") throw new Error(`Claude error: ${(ev.error && ev.error.message) || data}`);
      }
      return text;
    }

    // openai + ollama share the Chat Completions wire format.
    const headers = { "content-type": "application/json" };
    if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
    const post = (model) => fetch(`${s.baseUrl}/chat/completions`, {
      method: "POST", signal, headers,
      body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: toOpenAI(m.content) }))] }),
    }).catch((e) => { throw netError(e, s, s.baseUrl); });
    let res = await post(s.model);
    if (!res.ok && res.status === 404 && s.provider === "ollama") {
      // Ollama needs the exact tag ("gemma4:12b", not "gemma4"). If exactly one installed
      // model matches the name, use it and remember it; otherwise list what is installed.
      const installed = await listOllamaModels(s.baseUrl);
      const base = s.model.split(":")[0];
      const matches = installed.filter((m) => m === s.model || m.split(":")[0] === base);
      if (matches.length === 1 && matches[0] !== s.model) {
        res = await post(matches[0]);
        if (res.ok && hooks.onOllamaModel) { try { hooks.onOllamaModel(matches[0]); } catch (e) {} }
      } else {
        throw new Error(installed.length
          ? `Ollama has no model called "${s.model}". Installed: ${installed.join(", ")}. Use one of these exact names (including the part after ":") in AI settings, or download it with: ollama pull ${s.model}`
          : `Ollama has no models installed yet. Download one, e.g.: ollama pull gemma4:12b`);
      }
    }
    if (!res.ok) throw await httpError(res, s);
    for await (const data of sse(res.body)) {
      if (data === "[DONE]") break;
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.error) throw new Error(`${s.provider} error: ${ev.error.message || data}`);
      emit(ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content);
    }
    return text;
  }

  // ---------- optional OpenAI voice (speech-to-text, text-to-speech) ----------
  const STT_MODEL = "gpt-4o-mini-transcribe";
  const TTS_MODEL = "gpt-4o-mini-tts";
  const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
  const NO_VOICE_KEY = "OpenAI voice needs an OpenAI API key. Add one in AI settings (choose OpenAI, paste the key, click Save and test, then switch back to your usual provider if you like), or pick a free browser option in Voice settings.";

  async function voiceFailure(res) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j.error && j.error.message) || JSON.stringify(j); } catch (e) {}
    return Object.assign(new Error(`OpenAI voice request failed (${res.status}): ${msg}`), { status: res.status === 401 || res.status === 403 ? 400 : 502 });
  }
  // o: { key, base, sttModel }. audio: Blob (or Buffer in Node). Returns the transcript text.
  async function transcribe(o, audio, mime, lang) {
    const ext = /ogg/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : /wav/.test(mime) ? "wav" : /mpeg|mp3/.test(mime) ? "mp3" : "webm";
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mime || "audio/webm" }), `speech.${ext}`);
    form.append("model", o.sttModel || STT_MODEL);
    if (lang) form.append("language", String(lang).slice(0, 2).toLowerCase());
    // Technical vocabulary hint: improves "Kafka", "idempotency", "LRU" and friends.
    form.append("prompt", "Software system design interview: LLD, HLD, Java, Spring Boot, Kafka, Redis, sharding, idempotency, LRU cache, REST, gRPC.");
    let res;
    try { res = await fetch(`${o.base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${o.key}` }, body: form }); }
    catch (e) { throw Object.assign(new Error(`Can't reach OpenAI for transcription: ${e.message}`), { status: 502 }); }
    if (!res.ok) throw await voiceFailure(res);
    const j = await res.json();
    return String(j.text || "").trim();
  }
  // Returns the fetch Response (audio/mpeg body).
  async function speak(o, text, voice) {
    const input = String(text || "").slice(0, 4000);
    if (!input.trim()) throw Object.assign(new Error("Nothing to say."), { status: 400 });
    let res;
    try {
      res = await fetch(`${o.base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: o.ttsModel || TTS_MODEL, voice: VOICES.includes(voice) ? voice : "alloy", input, response_format: "mp3",
          instructions: "Speak like a friendly, clear senior engineer mentoring someone for an interview." }),
      });
    } catch (e) { throw Object.assign(new Error(`Can't reach OpenAI for speech: ${e.message}`), { status: 502 }); }
    if (!res.ok) throw await voiceFailure(res);
    return res;
  }

  return { PROVIDERS, assertReady, complete, listOllamaModels, transcribe, speak, VOICES, STT_MODEL, TTS_MODEL, NO_VOICE_KEY };
});
