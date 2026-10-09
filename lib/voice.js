// Optional cloud voice through OpenAI: speech-to-text and text-to-speech.
// Only used when the learner picks "OpenAI" for voice input or output in Voice settings.
// The browser-only options (built-in speech, Whisper running in the page) never touch the server.
// Uses the OpenAI key from kb.config.json / OPENAI_API_KEY, whichever provider is used for chat.
const ai = require("./ai");

const STT_MODEL = process.env.KB_STT_MODEL || "gpt-4o-mini-transcribe";
const TTS_MODEL = process.env.KB_TTS_MODEL || "gpt-4o-mini-tts";
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

function openaiSettings() {
  const s = ai.resolve({ provider: "openai" });
  if (!s.apiKey) {
    throw Object.assign(new Error("OpenAI voice needs an OpenAI API key. Add one in AI settings (choose OpenAI, paste the key, click Save and test, then switch back to your usual provider if you like), or pick a free browser option in Voice settings."), { code: "NO_KEY", status: 400 });
  }
  return { key: s.apiKey, base: (s.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") };
}

async function failure(res) {
  let msg = res.statusText;
  try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j); } catch (e) {}
  return Object.assign(new Error(`OpenAI voice request failed (${res.status}): ${msg}`), { status: res.status === 401 || res.status === 403 ? 400 : 502 });
}

// audio: Buffer of a short recording (webm/ogg/mp4/wav). Returns the transcript text.
async function transcribe(audio, mime, lang) {
  const { key, base } = openaiSettings();
  const ext = /ogg/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : /wav/.test(mime) ? "wav" : /mpeg|mp3/.test(mime) ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime || "audio/webm" }), `speech.${ext}`);
  form.append("model", STT_MODEL);
  if (lang) form.append("language", String(lang).slice(0, 2).toLowerCase());
  // Technical vocabulary hint: improves "Kafka", "idempotency", "LRU" and friends.
  form.append("prompt", "Software system design interview: LLD, HLD, Java, Spring Boot, Kafka, Redis, sharding, idempotency, LRU cache, REST, gRPC.");
  let res;
  try { res = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form }); }
  catch (e) { throw Object.assign(new Error(`Can't reach OpenAI for transcription: ${e.message}`), { status: 502 }); }
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return String(j.text || "").trim();
}

// Returns the fetch Response (audio/mpeg body) so the caller can stream it to the browser.
async function speak(text, voice) {
  const { key, base } = openaiSettings();
  const input = String(text || "").slice(0, 4000);
  if (!input.trim()) throw Object.assign(new Error("Nothing to say."), { status: 400 });
  let res;
  try {
    res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TTS_MODEL, voice: VOICES.includes(voice) ? voice : "alloy", input, response_format: "mp3",
        instructions: "Speak like a friendly, clear senior engineer mentoring someone for an interview." }),
    });
  } catch (e) { throw Object.assign(new Error(`Can't reach OpenAI for speech: ${e.message}`), { status: 502 }); }
  if (!res.ok) throw await failure(res);
  return res;
}

module.exports = { transcribe, speak, VOICES };
