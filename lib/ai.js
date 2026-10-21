// AI settings for the local app, and completion with them. The HTTP side lives in lib/core/llm.js,
// which the website uses too.
//
// Settings live in kb.config.json at the repo root (git-ignored). Environment
// KB_PROVIDER and KB_MODEL override the file. Keys and base URLs (ANTHROPIC_API_KEY, OPENAI_API_KEY,
// OPENAI_BASE_URL, OLLAMA_BASE_URL) are used only when the file has none, so a key saved for e.g. Groq
// is never replaced by an unrelated OPENAI_API_KEY from the environment.
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./store");

const CONFIG_FILE = path.join(ROOT, "kb.config.json");

const llm = require("./core/llm");
const { PROVIDERS } = llm;

// Raw kb.config.json (no defaults), to tell saved values from built-in defaults.
function readSaved() {
  try { return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {}; } catch (e) { return {}; }
}

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
  const p = { ...cfg[provider], keySource: cfg[provider].apiKey ? "kb.config.json" : "" };
  const saved = readSaved()[provider] || {};
  const envKey = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", xai: "XAI_API_KEY", gemini: "GEMINI_API_KEY" }[provider];
  if (envKey && !p.apiKey && process.env[envKey]) { p.apiKey = process.env[envKey]; p.keySource = `${envKey} environment variable`; }
  if (provider === "openai" && !saved.baseUrl && process.env.OPENAI_BASE_URL) p.baseUrl = process.env.OPENAI_BASE_URL;
  if (provider === "ollama" && !saved.baseUrl && process.env.OLLAMA_BASE_URL) p.baseUrl = process.env.OLLAMA_BASE_URL;
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
      keyFromEnv: /environment/.test(r.keySource || ""),
    };
  }
  if (eff) out.ready = eff.provider === "mock" || !PROVIDERS[eff.provider].needsKey || !!eff.apiKey;
  out.model = eff ? eff.model : null;
  return out;
}

/**
 * Run one completion with the saved settings (see lib/core/llm.js for the options).
 * opts.provider / opts.model override the saved choice for this call.
 */
async function complete(opts) {
  const s = resolve({ provider: opts.provider, model: opts.model });
  llm.assertReady(s, 'Run "kb setup", or open AI settings (gear icon) on the site.');
  // A bare Ollama name that matched one installed tag is remembered, unless the model came from a flag.
  return llm.complete(s, opts, { onOllamaModel: (m) => { if (!opts.model) saveConfig({ ollama: { model: m } }); } });
}

const listOllamaModels = (baseUrl) => llm.listOllamaModels(baseUrl || resolve({ provider: "ollama" }).baseUrl);

module.exports = { PROVIDERS, CONFIG_FILE, readConfig, resolve, saveConfig, publicConfig, complete, listOllamaModels };
