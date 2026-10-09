// The three AI actions — evaluate, clarify (chat), answer doubts — used by both the
// CLI and the web server, so the result is identical wherever it's triggered from.
const store = require("./store");
const ai = require("./ai");
const images = require("./images");

const HISTORY_SENT = 24; // most recent chat turns sent back to the model

// Load an item for prompting: images in the answer become "[Image N]" markers in the
// text and are returned separately as image parts the model can actually look at.
function loadForPrompt(addr) {
  const it = store.getItem(addr);
  const { text, images: imgs } = images.extract(it.userAnswer);
  return { it: { ...it, rawAnswer: it.userAnswer, userAnswer: text }, imgs };
}
// A user message: plain text, or text followed by the answer's images.
function withImages(text, imgs, intro) {
  if (!imgs.length) return text;
  return [{ type: "text", text: intro ? `${text}\n\n${intro}` : text }, ...imgs];
}
const IMG_NOTE = (n) => `The ${n} image(s) attached are the diagrams from the learner's answer, in order ([Image 1], [Image 2], …). Treat them as part of the answer.`;

function contextBlock(it, { includeAnswer = true, includeVerdict = true } = {}) {
  const parts = [];
  if (it.track === "READ") {
    parts.push(`# Fundamentals article: ${it.title} (${it.fundTrack})`, "", it.markdown.trim());
    if (it.usedBy.length) parts.push("", `Design topics that build on this: ${it.usedBy.map((u) => `${u.key} ${u.title}`).join("; ")}`);
    return parts.join("\n");
  }
  if (it.track === "DSA") {
    parts.push(`# DSA problem #${it.number}: ${it.title}`, `Pattern: ${it.topicName}`);
    if (it.difficulty) parts.push(`Difficulty: ${it.difficulty}`);
    if (it.leetcodeUrl) parts.push(`LeetCode: ${it.leetcodeUrl}`);
    if (it.patternGuide) parts.push("", `## Study-site guide for the "${it.topicName}" pattern`, it.patternGuide.trim());
  } else {
    parts.push(`# ${it.track} topic #${it.number}: ${it.title}`, `Concepts: ${it.concepts}`);
    if (it.markdown) parts.push("", "## Reference write-up (the study site's model answer)", it.markdown.trim());
  }
  if (includeAnswer) parts.push("", "## The learner's saved answer", it.userAnswer.trim() ? it.userAnswer.trim() : "_(no answer saved yet)_");
  if (includeVerdict && it.answerEvaluation) parts.push("", "## Latest evaluation of that answer", it.answerEvaluation.trim());
  return parts.join("\n");
}

const TRACK_STYLE = {
  LLD: "Low-level design (object modelling). Use Java for code; talk in classes, interfaces, patterns, SOLID, concurrency.",
  HLD: "High-level/system design. Talk in components, data flow, storage, scaling, consistency, back-of-envelope numbers.",
  AI: "AI/LLM application design. Connect ideas to Spring AI (ChatClient, Advisors, VectorStore, tool calling) where relevant; Java for code.",
  READ: "Interview fundamentals (concepts that design questions build on). Explain clearly, with concrete examples, Java where code helps, and how the idea shows up in interviews.",
  DSA: "Data structures & algorithms. Talk in approach, invariants, time/space complexity, edge cases; Java for code.",
};

// ---------- evaluate ----------
function evaluateSystem(it) {
  const rubric = it.track === "DSA"
    ? `Judge the answer on the problem itself: correctness (trace an example; point out any bug with the exact line), time and space complexity (are their claims right? is a better bound expected in interviews?), and edge cases. This problem is filed under the "${it.topicName}" pattern: say whether they recognised and applied it (or a legitimately better approach), and if they used brute force, name the pattern step that would improve it.`
    : "Compare the answer with the reference write-up, but credit any valid alternative design — the reference is one good answer, not the only one. Weigh: requirements clarified, core abstractions/components, key decisions with trade-offs, and depth an interviewer would probe.";
  return `You are a senior engineer conducting a mock interview and grading a candidate's written answer.
${TRACK_STYLE[it.track]}

${rubric}

Reply with ONLY the evaluation in Markdown, in exactly this shape:
**Verdict: <one of Strong / Solid / Partial / Needs work>**

### What you got right
- specific points, quoting their answer where useful

### Gaps
- specific missing or wrong points, each with why it matters in an interview

### To study next
- 2–4 concrete things to practise

If the answer includes diagram images, read them closely and judge them as part of the answer: comment on the components, relationships and data flow they show, and point out anything that contradicts the text.

Be direct and specific, address the candidate as "you", no preamble or sign-off. Keep it under 450 words.`;
}

async function evaluate(addr, opts = {}) {
  if (addr.track === "READ") throw Object.assign(new Error("Fundamentals articles are for reading; there's no answer to evaluate. Ask the tutor instead: kb clarify read " + addr.number + " \"…\""), { code: "NO_ANSWER" });
  const { it, imgs } = loadForPrompt(addr);
  if (!it.rawAnswer.trim()) throw Object.assign(new Error(`${it.label}: no answer saved yet. Write one on the site (or "kb answer ${addr.track.toLowerCase()} ${addr.number} <file>") first.`), { code: "NO_ANSWER" });
  const answerAtStart = it.rawAnswer;
  const meta = {};
  const text = await ai.complete({
    ...opts, meta,
    system: evaluateSystem(it),
    messages: [{ role: "user", content: withImages(contextBlock(it, { includeVerdict: false }) + "\n\nEvaluate the learner's saved answer.", imgs, IMG_NOTE(imgs.length)) }],
  });
  let verdict = text.trim();
  if (!verdict) throw new Error("The model returned an empty evaluation.");
  if (meta.imagesDropped) {
    verdict += `\n\n> **Note:** your answer has ${imgs.length} diagram image(s), but the model used (${ai.resolve(opts).model}) can't read images, so they weren't part of this evaluation. Claude, GPT-5, or a vision model in Ollama such as gemma4 can read them.`;
  }
  const item = store.updateItem(addr, (t) => {
    // The answer changed while we were waiting: don't attach a stale verdict to it.
    if (t.userAnswer !== answerAtStart) throw new Error("Your answer changed while it was being evaluated. Run evaluate again.");
    t.answerEvaluation = verdict;
    t.answerEvaluatedAt = new Date().toISOString();
  });
  return { item, verdict };
}

// ---------- clarify / chat ----------
// The learner attempts each problem cold; the reference design is hidden in the UI until they
// confirm. The tutor must not leak it either until they've had their attempt evaluated.
function spoilerRule(it) {
  if (it.track === "READ" || it.answerEvaluation) return "";
  const what = it.track === "DSA" ? "the full solution or code" : it.track === "LLD"
    ? "the reference design's key abstractions, class structure, patterns, or design decisions and trade-offs"
    : it.track === "HLD" ? "the reference architecture, component choices, or key design decisions and trade-offs"
    : "the reference write-up's key concepts and design decisions";
  return `- SPOILER RULE: the learner hasn't had an attempt evaluated yet. Don't reveal ${what}. Coach instead: ask guiding questions, point to which requirement or fundamental concept to think about, and react to their ideas. Clarifying the problem statement and requirements is fine. Only if they explicitly ask for the answer or solution, give it.`;
}

function chatSystem(it) {
  return `You are a friendly, rigorous tutor and mock interviewer helping a backend engineer prepare for senior-level interviews.
${TRACK_STYLE[it.track]}

You're discussing one topic from their study site. Everything you know about it is below: the topic, the reference write-up, their own saved answer and its latest evaluation (if any).

How to behave:
- Answer the question actually asked, conversationally. Lead with the direct answer, then the reasoning. Short code or ASCII sketches are welcome when they help.
- Ground answers in the reference write-up, but go beyond it when useful, and say so plainly if you think the reference is wrong or incomplete.
- When they ask about their own answer, quote it and be honest about weak spots.
- If they ask to be quizzed or for interview practice, ask ONE question at a time, wait for their reply, then give feedback before the next question.
- Keep replies focused (usually under 300 words) unless they ask for depth.
${spoilerRule(it)}

---
${contextBlock(it)}`;
}

/** Ask a question in the topic's running conversation; saves both turns. */
async function clarify(addr, question, opts = {}) {
  const q = String(question || "").trim();
  if (!q) throw new Error("Ask a question, e.g. kb clarify lld 1 \"why is Board separate from Game?\"");
  const { it, imgs } = loadForPrompt(addr);
  const history = it.chat.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
  const asked = new Date().toISOString();
  // The answer's diagrams ride along with the newest question (only the text is saved to the chat).
  const reply = await ai.complete({ ...opts, system: chatSystem(it), messages: [...history, { role: "user", content: withImages(q, imgs, `(For reference: ${IMG_NOTE(imgs.length)})`) }] });
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
  const system = `${chatSystem(it)}

---
You are answering a question the learner left in their notes. Reply in plain text or light Markdown, at most ~150 words, with NO blank lines (they would break the notes format). No preamble.`;
  const answers = [];
  for (const d of open) {
    const a = await ai.complete({ ...opts, system, messages: [{ role: "user", content: withImages(d.question, imgs, `(For reference: ${IMG_NOTE(imgs.length)})`) }], onToken: opts.onToken });
    answers.push({ line: d.line, answer: a });
    opts.onDoubt && opts.onDoubt(d.question, a);
  }
  store.updateItem(addr, (t) => { t.notes = store.insertDoubtAnswers(t.notes, answers); });
  return { answered: answers.length };
}

module.exports = { evaluate, clarify, clearChat, answerDoubts, contextBlock };
