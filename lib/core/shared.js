// Logic shared by the Node server/CLI and the website (which runs without a server).
// Pure functions only: no file system, no network. Loaded with require() in Node and with a
// <script> tag in the browser, where it becomes window.KBCore.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBCore = Object.assign(root.KBCore || {}, api);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- your data: which fields are personal, and where each item's file goes ----------
  const FIELDS = ["userAnswer", "answerEvaluation", "answerEvaluatedAt", "notes", "chat", "readAt"];
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

  // "day-03.json" -> "day", "dsa.json" -> "dsa", "fundamentals.json" -> "fund"
  function kindOf(fileName) {
    if (/^day-\d+\.json$/.test(fileName)) return "day";
    if (fileName === "dsa.json") return "dsa";
    if (fileName === "fundamentals.json") return "fund";
    return null;
  }

  // The items of a content document, each with the id of its progress file:
  //   lld-02, hld-07, ai-20, dsa-two-sum, read-hld-caching
  function itemsOf(kind, doc) {
    const out = [];
    if (kind === "day") {
      for (const t of doc.topics || []) if (t.category && t.number != null) out.push([`${slug(t.category)}-${String(t.number).padStart(2, "0")}`, t]);
    } else if (kind === "dsa") {
      for (const tp of doc.topics || []) for (const p of tp.problems || []) if (p.key) out.push([`dsa-${slug(p.key)}`, p]);
    } else if (kind === "fund") {
      for (const g of doc.groups || []) for (const it of g.items || []) if (it.id) out.push([`read-${slug(it.id)}`, it]);
    }
    return out;
  }

  // Apply saved progress to a content doc. `get(id)` returns the saved object or null. Mutates doc.
  function applyProgress(kind, doc, get) {
    for (const [id, item] of itemsOf(kind, doc)) {
      const p = get(id);
      if (!p) continue;
      for (const k of FIELDS) if (k in p) item[k] = p[k];
    }
    return doc;
  }

  // Split a doc into a content-only copy plus the progress records to save.
  // Returns { pub, records: [[id, objectOrNull]] }; null means "nothing saved: remove the file".
  function splitProgress(kind, doc) {
    const items = itemsOf(kind, doc);
    if (!items.length) return { pub: doc, records: [] };
    const pub = JSON.parse(JSON.stringify(doc));
    if (Array.isArray(pub.groups)) pub.groups = pub.groups.filter((g) => !g.library); // libraries stay in the data folder
    const pubItems = new Map(itemsOf(kind, pub));
    const records = [];
    for (const [id, item] of items) {
      const mine = {};
      for (const k of FIELDS) if (!isEmpty(item[k])) mine[k] = item[k];
      const target = pubItems.get(id); // undefined for library chapters: they aren't written to content/
      if (target) for (const k of FIELDS) delete target[k];
      records.push([id, Object.keys(mine).length ? { id, title: item.title || "", ...mine } : null]);
    }
    return { pub, records };
  }
  const progressText = (rec) => JSON.stringify(rec, null, 2) + "\n";

  // Written into a new data folder.
  const DATA_README = `# KB data

Your personal study data for KB: answers, AI verdicts, notes, tutor conversations,
read status and the images in your answers. The KB app (and the KB website, when you
choose this folder there) reads and writes this folder.

- One file per topic/problem/article you've worked on, in \`progress/\`.
- Images pasted into answers, in \`images/\`.

Keep it private. To back it up or sync it between computers, make this folder its own
private git repository:

    git init
    git add .
    git commit -m "KB progress"
    git remote add origin https://github.com/<you>/kb-data.git   # a PRIVATE repo
    git push -u origin main

On the KB website, choose this folder with "Use my kb-data folder". In the local app, it is
found next to the repo by default; to use a different location, set "dataDir" in kb.config.json
or the KB_DATA environment variable.
`;

  // ---------- addresses ----------
  // "lld 1", "lld1", "LLD-1", "lld#1", ["lld","1"] -> { track: "LLD", number: 1 }
  function parseAddress(input) {
    const s = (Array.isArray(input) ? input.join(" ") : String(input || "")).trim();
    const m = /^(lld|hld|ai|dsa|read)\s*[-#: ]?\s*(\d+)$/i.exec(s);
    if (!m) throw new Error(`Can't read "${s}". Use a track and a number, like "lld 1", "hld 12", "ai 3", "dsa 40" or "read 5".`);
    return { track: m[1].toUpperCase(), number: Number(m[2]) };
  }
  const addrLabel = (a) => `${a.track} ${a.number}`;

  // Find an item in already-loaded docs. `days` is an array of day docs.
  // Returns { kind, doc, item, meta } or null.
  function findItem(addr, { days = [], dsa = null, fund = null }) {
    if (addr.track === "READ") {
      for (const g of (fund && fund.groups) || []) {
        const item = (g.items || []).find((x) => Number(x.number) === addr.number);
        if (item) return { kind: "fund", doc: fund, item, meta: { topicName: g.name, fundTrack: g.library ? g.name : g.track, library: !!g.library } };
      }
    } else if (addr.track === "DSA") {
      for (const tp of (dsa && dsa.topics) || []) {
        const item = (tp.problems || []).find((p) => Number(p.number) === addr.number);
        if (item) return { kind: "dsa", doc: dsa, item, meta: { topicName: tp.name, patternGuide: tp.guide || "", difficulty: item.difficulty || null } };
      }
    } else {
      for (const doc of days) {
        const item = (doc.topics || []).find((t) => t.category === addr.track && Number(t.number) === addr.number);
        if (item) return { kind: "day", doc, item, meta: { day: doc.day } };
      }
    }
    return null;
  }

  // Read-only snapshot of an item with everything a prompt needs.
  function itemView(addr, item, meta) {
    return {
      address: addr,
      label: `${addrLabel(addr)} · ${item.title}`,
      track: addr.track,
      number: addr.number,
      title: item.title,
      concepts: item.concepts || "",
      topicName: meta.topicName || null,
      fundTrack: meta.fundTrack || null,
      library: meta.library ? meta.topicName : null,
      usedBy: item.usedBy || [],
      patternGuide: meta.patternGuide || "",
      difficulty: meta.difficulty || null,
      day: meta.day || null,
      leetcodeUrl: item.leetcodeUrl || null,
      markdown: item.markdown || "",
      userAnswer: item.userAnswer || "",
      answerEvaluation: item.answerEvaluation || null,
      answerEvaluatedAt: item.answerEvaluatedAt || null,
      notes: item.notes || "",
      chat: Array.isArray(item.chat) ? item.chat : [],
    };
  }

  // ---------- #doubt lines in notes ----------
  // "#doubt ..." lines with no "#doubt-answer" as the next non-blank line.
  function openDoubts(notes) {
    const out = [];
    const lines = String(notes || "").split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/^\s*#doubt\b(?!-answer)/i.test(l)) {
        const next = lines.slice(i + 1).find((x) => x.trim());
        if (!next || !/^\s*#doubt-answer\b/i.test(next)) out.push({ line: l, question: l.replace(/^\s*#doubt\b:?\s*/i, "").trim() });
      }
    });
    return out;
  }

  // Insert "#doubt-answer ..." directly under each answered question line.
  // answers: [{ line, answer }] — matched by exact line text, so edits elsewhere in notes are safe.
  function insertDoubtAnswers(notes, answers) {
    const lines = String(notes || "").split(/\r?\n/);
    for (const { line, answer } of answers) {
      const i = lines.findIndex((l, idx) => l === line && !/^\s*#doubt-answer\b/i.test(lines.slice(idx + 1).find((x) => x.trim()) || ""));
      if (i < 0) continue;
      // A blank line ends an answer in the notes format, so squeeze blank lines out.
      const body = String(answer).trim().replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").replace(/^#doubt/gim, "doubt");
      const after = lines[i + 1];
      // Keep following text out of the answer: a blank line ends it.
      const ins = ["#doubt-answer " + body];
      if (after !== undefined && after.trim() && !/^\s*#doubt\b/i.test(after)) ins.push("");
      lines.splice(i + 1, 0, ...ins);
    }
    return lines.join("\n");
  }

  // ---------- images in answers ----------
  const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const MAX_SEND = 5 * 1024 * 1024; // per image; Claude's limit, and plenty for a diagram
  const MAX_IMAGES = 6;
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";
  const imageSources = (markdown) => [...String(markdown || "").matchAll(IMG_RE)].map((m) => m[2]);

  /**
   * Split Markdown into prompt text plus image parts.
   * load(src) returns { mediaType, data (base64), size } or { error }.
   * Each image becomes "[Image N: alt]" in the text; image parts come back in the same order.
   */
  function extractImages(markdown, load) {
    const images = [];
    const text = String(markdown || "").replace(IMG_RE, (all, alt, src) => {
      const label = alt && !/^image$|\.(png|jpe?g|gif|webp)$/i.test(alt) ? `: ${alt}` : "";
      const n = images.length + 1;
      if (n > MAX_IMAGES) return `[Image${label} — not attached, more than ${MAX_IMAGES} images]`;
      const r = load(src);
      if (r.error) return `[Image${label} — ${r.error}]`;
      if (r.size > MAX_SEND) return `[Image${label} — too large to send (${mb(r.size)}; keep diagrams under ${mb(MAX_SEND)})]`;
      images.push({ type: "image", mediaType: r.mediaType, data: r.data });
      return `[Image ${n}${label} — attached]`;
    });
    return { text, images };
  }

  // ---------- prompts ----------
  const HISTORY_SENT = 24; // most recent chat turns sent back to the model

  // A user message: plain text, or text followed by the answer's images.
  function withImages(text, imgs, intro) {
    if (!imgs.length) return text;
    return [{ type: "text", text: intro ? `${text}\n\n${intro}` : text }, ...imgs];
  }
  const IMG_NOTE = (n) => `The ${n} image(s) attached are the diagrams from the learner's answer, in order ([Image 1], [Image 2], …). Treat them as part of the answer.`;

  function contextBlock(it, { includeAnswer = true, includeVerdict = true } = {}) {
    const parts = [];
    if (it.track === "READ") {
      parts.push(it.library ? `# Chapter from the learner's "${it.library}" library: ${it.title}` : `# Fundamentals article: ${it.title} (${it.fundTrack})`, "", it.markdown.trim());
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
  const evaluateRequest = "\n\nEvaluate the learner's saved answer.";
  const imagesDroppedNote = (n, model) => `\n\n> **Note:** your answer has ${n} diagram image(s), but the model used (${model}) can't read images, so they weren't part of this evaluation. Claude, GPT-5, or a vision model in Ollama such as gemma4 can read them.`;

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
    const intro = it.library
      ? `You are a friendly, rigorous tutor helping a learner study "${it.library}".
Explain clearly, with examples suited to the subject (code only where the subject is about programming; worked examples for maths and science). Quiz them when they ask.`
      : `You are a friendly, rigorous tutor and mock interviewer helping a backend engineer prepare for senior-level interviews.
${TRACK_STYLE[it.track]}`;
    return `${intro}

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

  // Added when the learner is talking by voice: the reply is read aloud.
  const VOICE_STYLE = `The learner is talking to you by voice, and your reply will be read aloud to them. Speak like a senior engineer in a live conversation:
short, natural sentences; usually under 120 words unless they ask you to go deeper; no tables, headings or long bullet lists.
If code really helps, put it in a fenced code block. It is shown on screen but not read aloud, so mention it briefly ("the snippet on screen shows...").
If you are running a mock interview, ask one question at a time and wait for their answer.`;

  const chatSystemFor = (it, voice) => (voice ? `${chatSystem(it)}\n\n---\n${VOICE_STYLE}` : chatSystem(it));
  const doubtSystem = (it) => `${chatSystem(it)}

---
You are answering a question the learner left in their notes. Reply in plain text or light Markdown, at most ~150 words, with NO blank lines (they would break the notes format). No preamble.`;
  const imageRefNote = (imgs) => `(For reference: ${IMG_NOTE(imgs.length)})`;

  // ---------- libraries (kb add) ----------
  const summaryOf = (md) => (String(md).split(/\n\s*\n/).find((b) => b.trim() && !/^\s*(#|```|\|)/.test(b)) || "")
    .replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  // libs: [{ slug, meta, chapters: [{ ch, markdown }] }] in display order. Numbers continue after `start`.
  function libraryGroups(libs, start) {
    let n = start;
    const out = [];
    for (const lib of libs) {
      const items = lib.chapters.map(({ ch, markdown }) => ({
        number: ++n, id: `${lib.slug}--${ch.id}`, title: ch.title, summary: summaryOf(markdown), markdown, usedBy: [],
      }));
      if (items.length) out.push({ track: "LIB", key: lib.slug, name: lib.meta.title || lib.slug, library: true, items });
    }
    return out;
  }
  const lastNumber = (groups) => Math.max(0, ...groups.flatMap((g) => (g.items || []).map((i) => Number(i.number) || 0)));
  const libOrder = (a, b) => String(a.meta.createdAt || "").localeCompare(String(b.meta.createdAt || "")) || a.slug.localeCompare(b.slug);

  return {
    FIELDS, DATA_README, slug, isEmpty, kindOf, itemsOf, applyProgress, splitProgress, progressText,
    parseAddress, addrLabel, findItem, itemView,
    openDoubts, insertDoubtAnswers,
    IMG_RE, MAX_SEND, MAX_IMAGES, imageSources, extractImages,
    HISTORY_SENT, withImages, IMG_NOTE, contextBlock, TRACK_STYLE, evaluateSystem, evaluateRequest, imagesDroppedNote,
    spoilerRule, chatSystem, VOICE_STYLE, chatSystemFor, doubtSystem, imageRefNote,
    summaryOf, libraryGroups, lastNumber, libOrder,
  };
});
