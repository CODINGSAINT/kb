// All design topics (LLD, HLD, AI) grouped by week, as JSON.
//   Local app:  GET /topics  (also /topics.json)
//   Website:    https://codingsaint.com/kb/topics  and  /kb/topics.json  (written by build/make-site.js)
// Only shared content goes in: titles, concepts, the problem statement and links. Never anyone's answers.
const DAYS_PER_WEEK = 7;
const TRACKS = { LLD: "Low-level design", HLD: "High-level design", AI: "AI / Spring AI" };

const plain = (s) => String(s || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();

// First paragraph under "## Problem" in a topic's write-up.
function problemOf(md) {
  const m = /^##\s*Problem\s*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/m.exec(String(md || ""));
  if (!m) return "";
  const para = m[1].split(/\n\s*\n/).find((p) => p.trim()) || "";
  return plain(para);
}

// dayDocs: content/day-NN.json objects; fund: content/fundamentals.json (for read-first chapters).
// base: the site address used for links ("https://codingsaint.com/kb/"), or "" for relative links.
function buildTopics(dayDocs, fund, { base = "" } = {}) {
  const chapters = new Map();
  for (const g of (fund && fund.groups) || []) if (!g.library) for (const it of g.items || []) chapters.set(it.id, it.title);
  const prereqs = (fund && fund.prereqs) || {};
  const weeks = new Map();
  let total = 0;
  for (const doc of [...dayDocs].sort((a, b) => a.day - b.day)) {
    const week = Math.ceil(doc.day / DAYS_PER_WEEK);
    if (!weeks.has(week)) weeks.set(week, { week, days: [(week - 1) * DAYS_PER_WEEK + 1, week * DAYS_PER_WEEK], topics: [] });
    (doc.topics || []).forEach((t, i) => {
      total++;
      weeks.get(week).topics.push({
        id: `${t.category.toLowerCase()}-${String(t.number).padStart(2, "0")}`,
        track: t.category,
        trackName: TRACKS[t.category] || t.category,
        number: t.number,
        title: t.title,
        concepts: String(t.concepts || "").split(",").map((c) => c.trim()).filter(Boolean),
        problem: problemOf(t.markdown),
        day: doc.day,
        url: `${base}#/t/${doc.day}/${i}`,
        readFirst: (prereqs[`${t.category}-${t.number}`] || []).filter((id) => chapters.has(id))
          .map((id) => ({ id, title: chapters.get(id), url: `${base}#/read/${encodeURIComponent(id)}` })),
      });
    });
  }
  const list = [...weeks.values()];
  for (const w of list) w.days[1] = Math.min(w.days[1], Math.max(...w.topics.map((t) => t.day)));
  return { title: "KB topics by week", site: base || null, daysPerWeek: DAYS_PER_WEEK, weeks: list.length, totalTopics: total, schedule: list };
}

module.exports = { buildTopics, DAYS_PER_WEEK };
