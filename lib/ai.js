// Provider-agnostic chat completion with streaming. No SDKs: plain fetch (Node 18+).
// Providers: anthropic (Claude), openai (or any OpenAI-compatible endpoint), ollama (local).
//
// Settings live in kb.config.json at the repo root (git-ignored). Environment
// variables win over the file: KB_PROVIDER, KB_MODEL, ANTHROPIC_API_KEY, OPENAI_API_KEY,
// OPENAI_BASE_URL, OLLAMA_BASE_URL.
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./store");

const CONFIG_FILE = path.join(ROOT, "kb.config.json");

const PROVIDERS = {
  anthropic: { name: "Claude (Anthropic)", needsKey: true, defaults: { model: "claude-sonnet-5-5" },
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"], keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { name: "OpenAI", needsKey: true, defaults: { model: "gpt-5", baseUrl: "https://api.openai.com/v1" },
    models: ["gpt-5", "gpt-5-mini"], keyUrl: "https://platform.openai.com/api-keys" },
  ollama: { name: "Ollama (local, free)", needsKey: false, defaults: { model: "llama3.1", baseUrl: "http://localhost:11434/v1" },
    models: ["llama3.1", "qwen2.5", "mistral"], keyUrl: "https://ollama.com" },
};

function readConfig() {
  let file = {};
  try { if (fs.existsSync(CONFIG_FILE)) file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch (e) {
    throw new Error(`kb.config.json is not valid JSON: ${e.message}`);
  }
  const cfg = { provider: file.provider || "anthropic" };
  for (const [id, p] of Object.entries(PROVIDERS)) cfg[id] = { ...p.defaults, apiKey: "", ...(file[id] || {}) };
  return cfg;
}

// Effective settings after env overrides; `over` = { provider, model } from a CLI flag.
function resolve(over = {}) {
  const cfg = readConfig();
  const provider = over.provider || process.env.KB_PROVIDER || cfg.provider;
  if (provider === "mock") return { provider, model: "mock", apiKey: "", baseUrl: "" };
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  const p = { ...cfg[provider] };
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) p.apiKey = process.env.ANTHROPIC_API_KEY;
  if (provider === "openai" && process.env.OPENAI_API_KEY) p.apiKey = process.env.OPENAI_API_KEY;
  if (provider === "openai" && process.env.OPENAI_BASE_URL) p.baseUrl = process.env.OPENAI_BASE_URL;
  if (provider === "ollama" && process.env.OLLAMA_BASE_URL) p.baseUrl = process.env.OLLAMA_BASE_URL;
  if (process.env.KB_MODEL) p.model = process.env.KB_MODEL;
  if (over.model) p.model = over.model;
  return { provider, ...p };
}

function saveConfig(patch) {
  const file = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
  if (patch.provider) {
    if (!PROVIDERS[patch.provider]) throw new Error(`Unknown provider "${patch.provider}"`);
    file.provider = patch.provider;
  }
  for (const id of Object.keys(PROVIDERS)) {
    const p = patch[id];
    if (!p) continue;
    file[id] = file[id] || {};
    if (typeof p.model === "string" && p.model.trim()) file[id].model = p.model.trim();
    if (typeof p.baseUrl === "string" && p.baseUrl.trim()) file[id].baseUrl = p.baseUrl.trim().replace(/\/+$/, "");
    if (typeof p.apiKey === "string" && p.apiKey.trim()) file[id].apiKey = p.apiKey.trim();
    if (p.clearKey) delete file[id].apiKey;
  }
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  fs.renameSync(tmp, CONFIG_FILE);
}

const hint = (k) => (k ? "…" + k.slice(-4) : "");
// Safe to send to the browser: never includes a key, only its last 4 characters.
function publicConfig() {
  const cfg = readConfig();
  const eff = (() => { try { return resolve(); } catch (e) { return null; } })();
  const out = { provider: eff ? eff.provider : cfg.provider, ready: false, providers: {} };
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const r = resolve({ provider: id });
    out.providers[id] = {
      name: p.name, needsKey: p.needsKey, models: p.models, keyUrl: p.keyUrl,
      model: r.model, baseUrl: r.baseUrl || null, keySet: !!r.apiKey, keyHint: hint(r.apiKey),
      keyFromEnv: (id === "anthropic" && !!process.env.ANTHROPIC_API_KEY) || (id === "openai" && !!process.env.OPENAI_API_KEY),
    };
  }
  if (eff) out.ready = eff.provider === "mock" || !PROVIDERS[eff.provider].needsKey || !!eff.apiKey;
  out.model = eff ? eff.model : null;
  return out;
}

function assertReady(s) {
  if (s.provider !== "mock" && PROVIDERS[s.provider].needsKey && !s.apiKey) {
    throw Object.assign(new Error(`No API key for ${PROVIDERS[s.provider].name}. Run "kb setup", or open AI settings (gear icon) on the site.`), { code: "NO_KEY" });
  }
}

// Read a server-sent-events body and yield each `data:` payload.
async function* sse(body) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

async function httpError(res, s) {
  let msg = "";
  try { const j = await res.json(); msg = j.error?.message || j.message || JSON.stringify(j); } catch (e) { msg = res.statusText; }
  if (res.status === 401 || res.status === 403) msg = `${PROVIDERS[s.provider]?.name || s.provider} rejected the API key (${res.status}). ${msg}`;
  else if (res.status === 404) msg = `Model "${s.model}" not found (404). Pick another model in settings. ${msg}`;
  else if (res.status === 429) msg = `Rate limited or out of credit (429). ${msg}`;
  else msg = `${s.provider} error ${res.status}: ${msg}`;
  return new Error(msg);
}

// Turn Node's bare "fetch failed" into something actionable.
function netError(e, s, url) {
  if (e.name === "AbortError") return e;
  const why = e.cause?.code || e.cause?.message || e.message;
  const host = (() => { try { return new URL(url).host; } catch (x) { return url; } })();
  if (s.provider === "ollama") return new Error(`Can't reach Ollama at ${s.baseUrl}. Is "ollama serve" running? (${why})`);
  return new Error(`Can't reach ${host} (${why}). Check your internet connection, VPN or corporate proxy.`);
}

/**
 * Run one completion.
 *   system:   string
 *   messages: [{ role: "user" | "assistant", content: string }]
 *   onToken:  optional (text) => void, called as text streams in
 *   signal:   optional AbortSignal
 * Returns the full reply text.
 */
async function complete({ system, messages, onToken, signal, maxTokens = 4096, provider, model }) {
  const s = resolve({ provider, model });
  assertReady(s);
  let text = "";
  const emit = (t) => { if (!t) return; text += t; onToken && onToken(t); };

  if (s.provider === "mock") {
    const last = messages[messages.length - 1]?.content || "";
    const reply = /grading a candidate/i.test(system)
      ? "**Verdict: Solid**\n\n### What you got right\n- (mock) You covered the core entities.\n\n### Gaps\n- (mock) Concurrency is not discussed.\n\n### To study next\n- (mock) Locking strategies."
      : `(mock reply) You asked: "${last.slice(0, 80)}". The key idea is to separate responsibilities.`;
    for (const w of reply.split(/(?<= )/)) { if (signal?.aborted) break; emit(w); await new Promise((r) => setTimeout(r, 5)); }
    return text;
  }

  if (s.provider === "anthropic") {
    const url = "https://api.anthropic.com/v1/messages";
    const res = await fetch(url, {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: s.model, max_tokens: maxTokens, system, messages, stream: true }),
    }).catch((e) => { throw netError(e, s, url); });
    if (!res.ok) throw await httpError(res, s);
    for await (const data of sse(res.body)) {
      let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") emit(ev.delta.text);
      else if (ev.type === "error") throw new Error(`Claude error: ${ev.error?.message || data}`);
    }
    return text;
  }

  // openai + ollama share the Chat Completions wire format.
  const headers = { "content-type": "application/json" };
  if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
  const res = await fetch(`${s.baseUrl}/chat/completions`, {
    method: "POST", signal, headers,
    body: JSON.stringify({ model: s.model, stream: true, messages: [{ role: "system", content: system }, ...messages] }),
  }).catch((e) => { throw netError(e, s, s.baseUrl); });
  if (!res.ok) throw await httpError(res, s);
  for await (const data of sse(res.body)) {
    if (data === "[DONE]") break;
    let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
    if (ev.error) throw new Error(`${s.provider} error: ${ev.error.message || data}`);
    emit(ev.choices?.[0]?.delta?.content);
  }
  return text;
}

module.exports = { PROVIDERS, CONFIG_FILE, readConfig, resolve, saveConfig, publicConfig, complete };
