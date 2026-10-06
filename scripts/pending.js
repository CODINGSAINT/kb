#!/usr/bin/env node
// Lists what's waiting on the assistant: saved answers with no verdict, and
// "#doubt" lines with no "#doubt-answer" after them. Paste the output into chat
// ("handle these") or feed it to generate-day.sh's evaluate mode.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "content");

function openDoubts(notes) {
  const out = []; const lines = String(notes || "").split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^\s*#doubt\b(?!-answer)/i.test(l)) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (!next || !/^\s*#doubt-answer\b/i.test(next)) out.push(l.replace(/^\s*#doubt\b:?\s*/i, ""));
    }
  });
  return out;
}
const rows = [];
for (const f of fs.readdirSync(dir).filter((f) => /^day-\d+\.json$/.test(f)).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  d.topics.forEach((t, i) => {
    const where = `${f} topics[${i}] ${t.category} #${t.number} "${t.title}"`;
    if (!t.markdown) rows.push(`WRITE-UP MISSING  ${where}`);
    if (t.userAnswer?.trim() && !t.answerEvaluation) rows.push(`NEEDS EVALUATION  ${where}`);
    openDoubts(t.notes).forEach((q) => rows.push(`OPEN DOUBT        ${where}: ${q}`));
  });
}
const dsa = JSON.parse(fs.readFileSync(path.join(dir, "dsa.json"), "utf8"));
dsa.topics.forEach((tp, ti) => tp.problems.forEach((p, pi) => {
  const where = `dsa.json topics[${ti}].problems[${pi}] ${tp.name} #${p.number} "${p.title}"`;
  if (p.userAnswer?.trim() && !p.answerEvaluation) rows.push(`NEEDS EVALUATION  ${where}`);
  openDoubts(p.notes).forEach((q) => rows.push(`OPEN DOUBT        ${where}: ${q}`));
}));
console.log(rows.length ? rows.join("\n") : "Nothing pending.");
