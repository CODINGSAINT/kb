// The three AI actions — evaluate, clarify (chat), answer doubts — used by both the
// CLI and the web server, so the result is identical wherever it's triggered from.
// The prompts themselves live in lib/core/shared.js, which the website uses too.
const store = require("./store");
const ai = require("./ai");
const images = require("./images");
const core = require("./core/shared");
const { contextBlock, withImages, IMG_NOTE } = core;

// Load an item for prompting: images in the answer become "[Image N]" markers in the
// text and are returned separately as image parts the model can actually look at.
function loadForPrompt(addr) {
  const it = store.getItem(addr);
  const { text, images: imgs } = images.extract(it.userAnswer);
  return { it: { ...it, rawAnswer: it.userAnswer, userAnswer: text }, imgs };
}

// ---------- evaluate ----------
async function evaluate(addr, opts = {}) {
  if (addr.track === "READ") throw Object.assign(new Error("Fundamentals articles are for reading; there's no answer to evaluate. Ask the tutor instead: kb clarify read " + addr.number + " \"…\""), { code: "NO_ANSWER" });
  const { it, imgs } = loadForPrompt(addr);
  if (!it.rawAnswer.trim()) throw Object.assign(new Error(`${it.label}: no answer saved yet. Write one on the site (or "kb answer ${addr.track.toLowerCase()} ${addr.number} <file>") first.`), { code: "NO_ANSWER" });
  const answerAtStart = it.rawAnswer;
  const meta = {};
  const text = await ai.complete({
    ...opts, meta,
    system: core.evaluateSystem(it),
    messages: [{ role: "user", content: withImages(contextBlock(it, { includeVerdict: false }) + core.evaluateRequest, imgs, IMG_NOTE(imgs.length)) }],
  });
  let verdict = text.trim();
  if (!verdict) throw new Error("The model returned an empty evaluation.");
  if (meta.imagesDropped) verdict += core.imagesDroppedNote(imgs.length, ai.resolve(opts).model);
  const item = store.updateItem(addr, (t) => {
    // The answer changed while we were waiting: don't attach a stale verdict to it.
    if (t.userAnswer !== answerAtStart) throw new Error("Your answer changed while it was being evaluated. Run evaluate again.");
    t.answerEvaluation = verdict;
    t.answerEvaluatedAt = new Date().toISOString();
  });
  return { item, verdict };
}

// ---------- clarify / chat ----------
/** Ask a question in the topic's running conversation; saves both turns. */
async function clarify(addr, question, opts = {}) {
  const q = String(question || "").trim();
  if (!q) throw new Error("Ask a question, e.g. kb clarify lld 1 \"why is Board separate from Game?\"");
  const { it, imgs } = loadForPrompt(addr);
  const history = it.chat.slice(-core.HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
  const asked = new Date().toISOString();
  // The answer's diagrams ride along with the newest question (only the text is saved to the chat).
  const { voice, ...aiOpts } = opts;
  const reply = await ai.complete({ ...aiOpts, system: core.chatSystemFor(it, voice), messages: [...history, { role: "user", content: withImages(q, imgs, core.imageRefNote(imgs)) }] });
  const answered = new Date().toISOString();
  const turns = [{ role: "user", content: q, at: asked }, { role: "assistant", content: reply.trim(), at: answered }];
  store.updateItem(addr, (t) => { t.chat = [...(Array.isArray(t.chat) ? t.chat : []), ...turns]; });
  return { reply: reply.trim(), turns };
}

function clearChat(addr) {
  store.updateItem(addr, (t) => { t.chat = []; });
}

// ---------- #doubt lines in notes ----------
async function answerDoubts(addr, opts = {}) {
  const { it, imgs } = loadForPrompt(addr);
  const open = store.openDoubts(it.notes);
  if (!open.length) return { answered: 0 };
  const system = core.doubtSystem(it);
  const answers = [];
  for (const d of open) {
    const a = await ai.complete({ ...opts, system, messages: [{ role: "user", content: withImages(d.question, imgs, core.imageRefNote(imgs)) }], onToken: opts.onToken });
    answers.push({ line: d.line, answer: a });
    opts.onDoubt && opts.onDoubt(d.question, a);
  }
  store.updateItem(addr, (t) => { t.notes = store.insertDoubtAnswers(t.notes, answers); });
  return { answered: answers.length };
}

module.exports = { evaluate, clarify, clearChat, answerDoubts, contextBlock };
