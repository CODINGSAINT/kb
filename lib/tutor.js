// The three AI actions — evaluate, clarify (chat), answer doubts — used by both the
// CLI and the web server, so the result is identical wherever it's triggered from.
const store = require("./store");
const ai = require("./ai");

const HISTORY_SENT = 24; // most recent chat turns sent back to the model

function contextBlock(it, { includeAnswer = true, includeVerdict = true } = {}) {
  const parts = [];
  if (it.track === "DSA") {
    parts.push(`# DSA problem #${it.number}: ${it.title}`, `Topic: ${it.topicName}`);
    if (it.leetcodeUrl) parts.push(`LeetCode: ${it.leetcodeUrl}`);
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
  DSA: "Data structures & algorithms. Talk in approach, invariants, time/space complexity, edge cases; Java for code.",
};

// ---------- evaluate ----------
function evaluateSystem(it) {
  const rubric = it.track === "DSA"
    ? "Judge the answer on the problem itself: correctness (trace an example; point out any bug with the exact line), time and space complexity (are their claims right? is a better bound expected in interviews?), and edge cases."
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

Be direct and specific, address the candidate as "you", no preamble or sign-off. Keep it under 450 words.`;
}

async function evaluate(addr, opts = {}) {
  const it = store.getItem(addr);
  if (!it.userAnswer.trim()) throw Object.assign(new Error(`${it.label}: no answer saved yet. Write one on the site (or "kb answer ${addr.track.toLowerCase()} ${addr.number} <file>") first.`), { code: "NO_ANSWER" });
  const answerAtStart = it.userAnswer;
  const text = await ai.complete({
    ...opts,
    system: evaluateSystem(it),
    messages: [{ role: "user", content: contextBlock(it, { includeVerdict: false }) + "\n\nEvaluate the learner's saved answer." }],
  });
  const verdict = text.trim();
  if (!verdict) throw new Error("The model returned an empty evaluation.");
  const item = store.updateItem(addr, (t) => {
    // The answer changed while we were waiting: don't attach a stale verdict to it.
    if (t.userAnswer !== answerAtStart) throw new Error("Your answer changed while it was being evaluated. Run evaluate again.");
    t.answerEvaluation = verdict;
    t.answerEvaluatedAt = new Date().toISOString();
  });
  return { item, verdict };
}

// ---------- clarify / chat ----------
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

---
${contextBlock(it)}`;
}

/** Ask a question in the topic's running conversation; saves both turns. */
async function clarify(addr, question, opts = {}) {
  const q = String(question || "").trim();
  if (!q) throw new Error("Ask a question, e.g. kb clarify lld 1 \"why is Board separate from Game?\"");
  const it = store.getItem(addr);
  const history = it.chat.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
  const asked = new Date().toISOString();
  const reply = await ai.complete({ ...opts, system: chatSystem(it), messages: [...history, { role: "user", content: q }] });
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
  const it = store.getItem(addr);
  const open = store.openDoubts(it.notes);
  if (!open.length) return { answered: 0 };
  const system = `${chatSystem(it)}

---
You are answering a question the learner left in their notes. Reply in plain text or light Markdown, at most ~150 words, with NO blank lines (they would break the notes format). No preamble.`;
  const answers = [];
  for (const d of open) {
    const a = await ai.complete({ ...opts, system, messages: [{ role: "user", content: d.question }], onToken: opts.onToken });
    answers.push({ line: d.line, answer: a });
    opts.onDoubt && opts.onDoubt(d.question, a);
  }
  store.updateItem(addr, (t) => { t.notes = store.insertDoubtAnswers(t.notes, answers); });
  return { answered: answers.length };
}

module.exports = { evaluate, clarify, clearChat, answerDoubts, contextBlock };
