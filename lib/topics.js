// All topics grouped by week, as JSON: the read-first fundamentals (LLD, HLD and AI fundamentals), the
// design topics (LLD, HLD, AI) and the DSA problems.
//   - Design topics keep their day (3 a day, from content/day-NN.json).
//   - DSA problems follow pattern order, DSA_PER_DAY a day from day 1, in the same topic format.
//   - Each fundamentals chapter goes in the week where a design topic first needs it (week 1 if none does),
//     and each DSA pattern guide in the week its first problem is.
//   Local app:  GET /topics  (also /topics.json)
//   Website:    https://codingsaint.com/kb/topics  and  /kb/topics.json  (written by build/make-site.js)
// Only shared content goes in: titles, summaries, concepts, the problem statement and links. Never anyone's answers.
const DAYS_PER_WEEK = 7;
const DSA_PER_DAY = 5;
const TRACKS = { LLD: "Low-level design", HLD: "High-level design", AI: "AI / Spring AI", DSA: "Data structures & algorithms" };

const plain = (s) => String(s || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();

// First paragraph under "## Problem" in a topic's write-up.
function problemOf(md) {
  const m = /^##\s*Problem\s*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/m.exec(String(md || ""));
  if (!m) return "";
  const para = m[1].split(/\n\s*\n/).find((p) => p.trim()) || "";
  return plain(para);
}

// dayDocs: content/day-NN.json objects; fund: content/fundamentals.json; dsa: content/dsa.json.
// base: the site address used for links ("https://codingsaint.com/kb/"), or "" for relative links.
function buildTopics(dayDocs, fund, { base = "", dsa = null } = {}) {
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

  // DSA: pattern by pattern, DSA_PER_DAY problems a day. The pattern guide is the read-first for its problems.
  const patterns = [];
  let n = 0;
  ((dsa && dsa.topics) || []).forEach((tp, ti) => {
    const guide = tp.guide ? { id: `pattern-${tp.id}`, title: `${tp.name}: pattern guide`, url: `${base}#/pattern/${ti}` } : null;
    let firstWeek = null;
    (tp.problems || []).forEach((p, pi) => {
      const day = Math.floor(n++ / DSA_PER_DAY) + 1;
      const week = Math.ceil(day / DAYS_PER_WEEK);
      if (firstWeek === null) firstWeek = week;
      total++;
      weekEntry(week).topics.push({
        id: `dsa-${p.key}`,
        track: "DSA",
        trackName: TRACKS.DSA,
        number: p.number,
        title: p.title,
        concepts: [tp.name],
        problem: `Solve "${p.title}"${p.difficulty ? ` (${p.difficulty})` : ""} with the ${tp.name} pattern.`,
        difficulty: p.difficulty || null,
        leetcodeUrl: p.leetcodeUrl || null,
        day,
        url: `${base}#/dsa/${ti}/${pi}`,
        readFirst: guide ? [guide] : [],
      });
    });
    if (guide) {
      const entry = { ...guide, track: "DSA", group: "DSA patterns", number: ti + 1, summary: plain(tp.summary), week: firstWeek || 1,
        neededBy: (tp.problems || []).map((p) => `dsa-${p.key}`) };
      patterns.push(entry);
      weekEntry(entry.week).fundamentals.push(entry);
    }
  });

  // Every chapter, in its group and in the week it's first needed.
  const chapterOut = ({ g, it, neededBy, week }) => ({
    id: it.id, track: g.track, group: g.name, number: it.number, title: it.title,
    summary: plain(it.summary), url: readUrl(it.id), week: week || 1, neededBy,
  });
  const fundamentals = groups.map((g) => ({
    track: g.track, name: g.name,
    chapters: (g.items || []).map((it) => chapterOut(chapters.get(it.id))),
  }));
  for (const grp of [...fundamentals].reverse()) for (const c of [...grp.chapters].reverse()) weekEntry(c.week).fundamentals.unshift(c);
  if (patterns.length) fundamentals.push({ track: "DSA", name: "DSA patterns", chapters: patterns });

  // Within a week: by day, then LLD, HLD, AI, DSA.
  const order = ["LLD", "HLD", "AI", "DSA"];
  for (const w of weeks.values()) w.topics.sort((a, b) => a.day - b.day || order.indexOf(a.track) - order.indexOf(b.track) || a.number - b.number);

  const list = [...weeks.values()].sort((a, b) => a.week - b.week);
  for (const w of list) {
    if (w.topics.length) w.days[1] = Math.min(w.days[1], Math.max(...w.topics.map((t) => t.day)));
    w.counts = Object.fromEntries(order.map((t) => [t, w.topics.filter((x) => x.track === t).length]));
  }
  const all = list.flatMap((w) => w.topics);
  return {
    title: "KB topics by week", site: base || null, daysPerWeek: DAYS_PER_WEEK, dsaPerDay: DSA_PER_DAY, weeks: list.length,
    totalTopics: total, counts: Object.fromEntries(order.map((t) => [t, all.filter((x) => x.track === t).length])),
    totalFundamentals: chapters.size, totalPatterns: patterns.length,
    fundamentals,
    schedule: list,
  };
}

module.exports = { buildTopics, DAYS_PER_WEEK, DSA_PER_DAY };
