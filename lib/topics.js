// All topics grouped by week, as JSON: the read-first fundamentals (LLD, HLD and AI fundamentals) and
// the design topics (LLD, HLD, AI). Each fundamentals chapter is placed in the week where a design topic
// first needs it; chapters no topic points to are placed in week 1.
//   Local app:  GET /topics  (also /topics.json)
//   Website:    https://codingsaint.com/kb/topics  and  /kb/topics.json  (written by build/make-site.js)
// Only shared content goes in: titles, summaries, concepts, the problem statement and links. Never anyone's answers.
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
  const readUrl = (id) => `${base}#/read/${encodeURIComponent(id)}`;
  // Fundamentals chapters (your own `kb add` libraries are never included).
  const groups = ((fund && fund.groups) || []).filter((g) => !g.library);
  const chapters = new Map();
  for (const g of groups) for (const it of g.items || []) chapters.set(it.id, { g, it, neededBy: [], week: null });
  const prereqs = (fund && fund.prereqs) || {};

  const weeks = new Map();
  const weekEntry = (week) => {
    if (!weeks.has(week)) weeks.set(week, { week, days: [(week - 1) * DAYS_PER_WEEK + 1, week * DAYS_PER_WEEK], fundamentals: [], topics: [] });
    return weeks.get(week);
  };
  let total = 0;
  for (const doc of [...dayDocs].sort((a, b) => a.day - b.day)) {
    const week = Math.ceil(doc.day / DAYS_PER_WEEK);
    (doc.topics || []).forEach((t, i) => {
      total++;
      const id = `${t.category.toLowerCase()}-${String(t.number).padStart(2, "0")}`;
      const reads = (prereqs[`${t.category}-${t.number}`] || []).filter((c) => chapters.has(c));
      for (const c of reads) {
        const ch = chapters.get(c);
        ch.neededBy.push(id);
        if (ch.week === null || week < ch.week) ch.week = week;
      }
      weekEntry(week).topics.push({
        id,
        track: t.category,
        trackName: TRACKS[t.category] || t.category,
        number: t.number,
        title: t.title,
        concepts: String(t.concepts || "").split(",").map((c) => c.trim()).filter(Boolean),
        problem: problemOf(t.markdown),
        day: doc.day,
        url: `${base}#/t/${doc.day}/${i}`,
        readFirst: reads.map((c) => ({ id: c, title: chapters.get(c).it.title, url: readUrl(c) })),
      });
    });
  }

  // Every chapter, in its group and in the week it's first needed.
  const chapterOut = ({ g, it, neededBy, week }) => ({
    id: it.id, track: g.track, group: g.name, number: it.number, title: it.title,
    summary: plain(it.summary), url: readUrl(it.id), week: week || 1, neededBy,
  });
  const fundamentals = groups.map((g) => ({
    track: g.track, name: g.name,
    chapters: (g.items || []).map((it) => chapterOut(chapters.get(it.id))),
  }));
  for (const grp of fundamentals) for (const c of grp.chapters) weekEntry(c.week).fundamentals.push(c);

  const list = [...weeks.values()].sort((a, b) => a.week - b.week);
  for (const w of list) if (w.topics.length) w.days[1] = Math.min(w.days[1], Math.max(...w.topics.map((t) => t.day)));
  return {
    title: "KB topics by week", site: base || null, daysPerWeek: DAYS_PER_WEEK, weeks: list.length,
    totalTopics: total, totalFundamentals: chapters.size,
    fundamentals,
    schedule: list,
  };
}

module.exports = { buildTopics, DAYS_PER_WEEK };
