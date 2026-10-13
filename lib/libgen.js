// `kb add "<subject>"`: the AI plans a short course, then writes each chapter in the
// house style (definition -> plain explanation -> problem -> better way -> key takeaway).
// Chapters are saved one by one, so an interrupted run simply resumes.
const fs = require("fs");
const path = require("path");
const ai = require("./ai");
const userdata = require("./userdata");
const library = require("./library");

const LEVELS = ["beginner", "intermediate", "advanced"];

// ---------- outline ----------
const OUTLINE_SYSTEM = `You design short, high-quality study courses. You reply with JSON only, no prose and no code fences.`;

function outlinePrompt(subject, { chapters, level, existing }) {
  const more = existing && existing.length;
  return `Subject: "${subject}"
Learner: a working professional (software engineer) who wants a solid, ${level}-level understanding.
${more ? `The course already has these chapters (do not repeat or overlap them):\n${existing.map((c, i) => `${i + 1}. ${c.title}: ${c.scope}`).join("\n")}\n\nAdd exactly ${chapters} NEW chapters that continue it.` : `Plan exactly ${chapters} chapters, ordered from foundations to advanced, each self-contained and not overlapping the others.`}

Reply with JSON in exactly this shape:
{
  "title": "Clean course title, e.g. Core Java",
  "kind": "programming" | "technical" | "academic" | "other",
  "language": "main programming language for examples, or empty if none",
  "chapters": [
    { "id": "kebab-case-id", "title": "Short chapter title", "scope": "One sentence: what this chapter covers" }
  ]
}
"kind": programming = learning a language/framework/coding skill; technical = computing concepts (operating systems, networking, databases); academic = maths, science, economics and similar; other = anything else.`;
}

function parseJson(text) {
  const t = String(text).replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The model didn't return a JSON outline. Try again, or use a stronger model (--model).");
  return JSON.parse(t.slice(a, b + 1));
}

function cleanOutline(o, n) {
  const seen = new Set();
  const chapters = (Array.isArray(o.chapters) ? o.chapters : [])
    .filter((c) => c && c.title)
    .map((c) => {
      let id = library.slugify(c.id || c.title).slice(0, 48);
      while (seen.has(id)) id += "-2";
      seen.add(id);
      return { id, title: String(c.title).trim(), scope: String(c.scope || "").trim() };
    })
    .slice(0, Math.max(n, 1) + 2);
  if (!chapters.length) throw new Error("The outline came back empty. Try again, or use a stronger model (--model).");
  const kind = ["programming", "technical", "academic", "other"].includes(o.kind) ? o.kind : "other";
  return { title: String(o.title || "").trim(), kind, language: String(o.language || "").trim(), chapters };
}

async function planOutline(subject, opts) {
  const text = await ai.complete({ provider: opts.provider, model: opts.model, maxTokens: 3000, system: OUTLINE_SYSTEM,
    messages: [{ role: "user", content: outlinePrompt(subject, opts) }] });
  return cleanOutline(parseJson(text), opts.chapters);
}

// ---------- chapters ----------
const SHAPE = {
  programming: (lang) => `For each concept: a bold **Definition:** line; 2-4 sentences of plain explanation; "### Example: the problem" with a short ${lang || "code"} snippet showing the naive or wrong way and one or two sentences on what goes wrong; "### Better way" with the corrected snippet and why it works; a bold **Key takeaway:** line.`,
  technical: () => `For each concept: a bold **Definition:** line; 2-4 sentences of plain explanation with an everyday analogy where it genuinely helps; "### The problem" (a concrete scenario, small numbers or a tiny ASCII diagram in a \`\`\`text block) and what goes wrong; "### How it works" or "### Better design" (the same scenario done right); optional **Trade-offs:** bullets; a bold **Key takeaway:** line.`,
  academic: () => `For each concept: a bold **Definition:** line; "### Intuition" in plain words (an analogy or picture); "### Worked example" solved step by step; "### Common mistake" showing a typical wrong step and the correction; a bold **Key takeaway:** line. Write all maths in plain text (e.g. d/dx (x^2) = 2x, integral of f(x) dx from a to b), never LaTeX or $ signs; put multi-line derivations in \`\`\`text blocks.`,
  other: () => `For each concept: a bold **Definition:** line; 2-4 sentences of plain explanation; "### Example" with a concrete, realistic example; "### Common mistake" and the better approach; a bold **Key takeaway:** line.`,
};

function chapterSystem(course) {
  return `You write chapters for a personal study library, in a clean, simple and thorough style that a busy professional can read once and remember.

Style rules:
- Start with a 2-3 sentence plain-prose summary of the chapter. No title heading before it (the site shows the title).
- Then 4-8 numbered sections: "## 1. <short concept name>", "## 2. ...". Separate sections with a line containing only ---.
- ${SHAPE[course.kind](course.language)}
- Where people often confuse two ideas, add a short "### X vs. Y" subsection (2-4 bullets).
- Short sentences. Define every term the first time you use it. No filler, no motivational talk, no emojis.
- Keep every code or diagram block under 25 lines. Use fenced blocks with a language tag.
- Be technically accurate. If something is commonly misunderstood, say so plainly.
- End with three unnumbered sections, in this order:
  "## In practice" (3-5 bullets: where this shows up in real work${course.kind === "programming" || course.kind === "technical" ? " and in technical interviews" : " or exams"}),
  "## At a glance" (a Markdown table: Concept | Core idea | Ask yourself),
  "## Final memory aid" (4-8 one-line bullets).
- Length: about 1500-2500 words.
- Never write a line that starts with ===. Output only the chapter Markdown, nothing before or after it.`;
}

function chapterPrompt(subject, course, i) {
  const ch = course.chapters[i];
  return `Course: "${course.title || subject}" (subject requested: "${subject}", level: ${course.level}).
Full outline, for context (do not repeat what other chapters cover):
${course.chapters.map((c, k) => `${k + 1}. ${c.title}: ${c.scope}${k === i ? "   <-- write this one" : ""}`).join("\n")}

Write chapter ${i + 1}: "${ch.title}".
It covers: ${ch.scope}`;
}

function tidy(md, title) {
  let t = String(md).replace(/\r/g, "").trim();
  t = t.replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/, "");
  t = t.replace(/^#\s+.*\n+/, "");                                 // a leading "# Title" duplicates the page title
  if (title) t = t.replace(new RegExp(`^##?\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\n+`, "i"), "");
  t = t.replace(/^={3,}.*$/gm, (m) => m.replace(/^=+/, "")).trim();   // never a parser header line
  return t + "\n";
}

async function writeChapter(subject, lib, i, opts, onProgress) {
  const course = lib.meta;
  const ch = course.chapters[i];
  let chars = 0;
  const text = await ai.complete({
    provider: opts.provider, model: opts.model, maxTokens: 8000, system: chapterSystem(course),
    messages: [{ role: "user", content: chapterPrompt(subject, course, i) }],
    onToken: (t) => { chars += t.length; onProgress && onProgress(chars); },
  });
  const md = tidy(text, ch.title);
  if (md.split(/\s+/).length < 150) throw new Error(`The model returned a very short chapter for "${ch.title}". Try again, or use a stronger model (--model).`);
  const file = library.chapterFile(lib.dir, i, ch.id);
  fs.writeFileSync(file + ".tmp", md);
  fs.renameSync(file + ".tmp", file);
  return { file, words: md.split(/\s+/).filter(Boolean).length };
}

// ---------- library folders ----------
function find(subject) {
  const slug = library.slugify(subject);
  const libs = library.all(userdata.LIBRARY);
  return libs.find((l) => l.slug === slug) || libs.find((l) => (l.meta.title || "").toLowerCase() === String(subject).toLowerCase().trim()) || null;
}

function create(subject, outline, level, model) {
  userdata.ensureDir();
  const slug = library.slugify(outline.title || subject);
  const dir = path.join(userdata.LIBRARY, slug);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { slug, title: outline.title || subject, subject, kind: outline.kind, language: outline.language, level,
    createdAt: new Date().toISOString(), model, chapters: outline.chapters };
  saveMeta({ dir }, meta);
  return { slug, dir, meta };
}
function saveMeta(lib, meta) {
  const f = path.join(lib.dir, "library.json");
  fs.writeFileSync(f + ".tmp", JSON.stringify(meta, null, 2) + "\n");
  fs.renameSync(f + ".tmp", f);
  lib.meta = meta;
}

function remove(lib) {
  fs.rmSync(lib.dir, { recursive: true, force: true });
  // Progress ids are "read-" + the item id squeezed to [a-z0-9-] (same rule as userdata.itemsOf).
  const pid = (id) => "read-" + String(id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let n = 0;
  for (const ch of lib.meta.chapters) {
    const f = path.join(userdata.PROGRESS, pid(`${lib.slug}--${ch.id}`) + ".json");
    if (fs.existsSync(f)) { fs.unlinkSync(f); n++; }
  }
  return n;
}

module.exports = { LEVELS, planOutline, writeChapter, find, create, saveMeta, remove, parseJson, tidy, chapterSystem };
