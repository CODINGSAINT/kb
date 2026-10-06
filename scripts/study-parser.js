// Parses study.md: three markdown tables (LLD, HLD, AI), rows `# | Title | Concepts`.
// Track for each table is taken from the nearest preceding heading/line mentioning
// LLD / HLD / AI; falls back to document order (LLD, HLD, AI).
function parseStudy(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let current = null;
  let lastLabel = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (!current) { current = { label: lastLabel, rows: [] }; tables.push(current); }
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // separator
      const num = Number(cells[0].replace(/[^\d]/g, ""));
      if (!cells[0] || !Number.isFinite(num) || num < 1 || !/\d/.test(cells[0])) continue; // header row
      current.rows.push({ number: num, title: strip(cells[1] || ""), concepts: strip(cells.slice(2).join(" | ")) });
    } else {
      if (current) current = null;
      const m = /\b(LLD|HLD|AI)\b|low[- ]level|high[- ]level|spring[- ]ai/i.exec(line);
      if (m && line) lastLabel = normalise(m[0]);
    }
  }
  const order = ["LLD", "HLD", "AI"];
  const used = new Set();
  const tracks = {};
  tables.filter((t) => t.rows.length).forEach((t, i) => {
    let label = t.label && !used.has(t.label) ? t.label : order.find((o) => !used.has(o));
    if (!label) return;
    used.add(label);
    tracks[label] = t.rows.sort((a, b) => a.number - b.number);
  });
  const count = Object.values(tracks).reduce((s, r) => s + r.length, 0);
  return { tracks, count };
}
function strip(s) { return s.replace(/\*\*|__|`/g, "").trim(); }
function normalise(s) {
  s = s.toLowerCase();
  if (s.startsWith("low")) return "LLD";
  if (s.startsWith("high")) return "HLD";
  if (s.startsWith("spring") || s === "ai") return "AI";
  return s.toUpperCase();
}
module.exports = { parseStudy };
