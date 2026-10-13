// Optional cloud voice through OpenAI: speech-to-text and text-to-speech.
// Only used when the learner picks "OpenAI" for voice input or output in Voice settings.
// The browser-only options (built-in speech, Whisper running in the page) never touch the server.
// Uses the OpenAI key from kb.config.json / OPENAI_API_KEY, whichever provider is used for chat.
const ai = require("./ai");
const llm = require("./core/llm");

function openaiSettings() {
  const s = ai.resolve({ provider: "openai" });
  if (!s.apiKey) throw Object.assign(new Error(llm.NO_VOICE_KEY), { code: "NO_KEY", status: 400 });
  return { key: s.apiKey, base: (s.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
    sttModel: process.env.KB_STT_MODEL || llm.STT_MODEL, ttsModel: process.env.KB_TTS_MODEL || llm.TTS_MODEL };
}

// audio: Buffer of a short recording (webm/ogg/mp4/wav). Returns the transcript text.
const transcribe = (audio, mime, lang) => llm.transcribe(openaiSettings(), audio, mime, lang);
// Returns the fetch Response (audio/mpeg body) so the caller can stream it to the browser.
const speak = (text, voice) => llm.speak(openaiSettings(), text, voice);

module.exports = { transcribe, speak, VOICES: llm.VOICES };
