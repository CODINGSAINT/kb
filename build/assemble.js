#!/usr/bin/env node
// Builds content/day-NN.json for every study.md row from authored source files in
// build/topics/*.txt. Each topic block looks like:
//
//   === LLD 2 ===
//   N|id|Label|x|y|w|shape          (w, shape optional; h is 50, or 62 for cylinders)
//   E|from|to|label|dashed          (label, dashed optional)
//   ---
//   ## Problem
//   ...markdown...
//
// Existing user data (notes, userAnswer, answerEvaluation, chat, sketch, evaluation) is preserved.
// A topic with no authored block keeps whatever markdown/diagram is already on disk.
const fs = require("fs");
const path = require("path");
const { parseStudy } = require("../scripts/study-parser");

const root = path.join(__dirname, "..");
const { tracks } = parseStudy(fs.readFileSync(path.join(root, "study.md"), "utf8"));
const srcDir = path.join(__dirname, "topics");

const authored = {};
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".txt")).sort()) {
  const text = fs.readFileSync(path.join(srcDir, f), "utf8");
  const parts = text.split(/^=== (LLD|HLD|AI) (\d+) ===\s*$/m);
  for (let i = 1; i < parts.length; i += 3) {
    const key = `${parts[i]}-${Number(parts[i + 1])}`;
    const body = parts[i + 2];
    const sep = body.indexOf("\n---\n");
    if (sep < 0) throw new Error(`${f} ${key}: missing --- separator`);
    const head = body.slice(0, sep).trim().split("\n").filter(Boolean);
    const nodes = [], edges = [];
    for (const ln of head) {
      const c = ln.split("|").map((s) => s.trim());
      if (c[0] === "N") {
        const shape = c[6] || "rect";
        nodes.push({ id: c[1], label: c[2], x: +c[3], y: +c[4], w: +(c[5] || 140), h: shape === "cylinder" ? 62 : 50, shape });
      } else if (c[0] === "E") {
        const e = { from: c[1], to: c[2] };
        if (c[3]) e.label = c[3];
        if (c[4]) e.dashed = true;
        edges.push(e);
      } else throw new Error(`${f} ${key}: bad diagram line: ${ln}`);
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`${f} ${key}: edge to unknown node ${e.from}->${e.to}`);
    if (nodes.length < 4 || nodes.length > 7) throw new Error(`${f} ${key}: ${nodes.length} nodes (want 4-7)`);
    if (authored[key]) throw new Error(`duplicate ${key}`);
    authored[key] = { diagram: { nodes, edges }, markdown: body.slice(sep + 5).trim() + "\n" };
  }
}

const count = Math.max(...Object.values(tracks).map((r) => r.length));
let written = 0, missing = [];
for (let n = 1; n <= count; n++) {
  const file = path.join(root, "content", `day-${String(n).padStart(2, "0")}.json`);
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const topics = ["LLD", "HLD", "AI"].map((cat) => {
    const row = tracks[cat].find((r) => r.number === n);
    const prev = old?.topics?.find((t) => t.category === cat) || {};
    const a = authored[`${cat}-${n}`];
    if (!a && !prev.markdown) missing.push(`${cat} ${n}`);
    return {
      category: cat, number: n, title: row.title, concepts: row.concepts,
      notes: prev.notes || "",
      diagram: a ? a.diagram : prev.diagram || { nodes: [], edges: [] },
      markdown: a ? a.markdown : prev.markdown || "",
      userAnswer: prev.userAnswer || "",
      answerEvaluation: prev.answerEvaluation ?? null,
      answerEvaluatedAt: prev.answerEvaluatedAt ?? null,
      ...(prev.chat?.length ? { chat: prev.chat } : {}),
    };
  });
  const day = { day: n, generatedAt: old?.generatedAt || new Date().toISOString(), sketch: old?.sketch ?? null, evaluation: old?.evaluation ?? null, topics };
  fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n");
  written++;
}
console.log(`wrote ${written} day files; authored blocks: ${Object.keys(authored).length}`);
if (missing.length) console.log("MISSING content:", missing.join(", "));
