#!/usr/bin/env node
// Builds content/fundamentals.json: "read first" articles for LLD, HLD and AI, plus the
// mapping from each design topic to the fundamentals it builds on.
//   Source: build/fundamentals/*.md, articles separated by "=== id | TRACK | Title ===" lines.
//   node build/make-fundamentals.js
// Re-running keeps what you've saved: read status, notes and tutor chats.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "fundamentals");
const OUT = path.join(ROOT, "content", "fundamentals.json");
const TRACKS = [["LLD", "LLD fundamentals"], ["HLD", "HLD fundamentals"], ["AI", "AI fundamentals"]];

// Topic -> fundamentals to read before attempting it (most important first).
const PREREQS = {
  "LLD-1": ["lld-approach", "lld-oop", "lld-uml", "lld-behavioral-1"],
  "LLD-2": ["lld-approach", "lld-solid", "lld-creational", "lld-behavioral-1"],
  "LLD-3": ["lld-behavioral-1", "lld-concurrency", "lld-solid"],
  "LLD-4": ["lld-concurrency", "lld-behavioral-1", "lld-modelling"],
  "LLD-5": ["lld-behavioral-1", "lld-behavioral-2", "lld-modelling"],
  "LLD-6": ["lld-creational", "lld-behavioral-1", "lld-modelling"],
  "LLD-7": ["lld-behavioral-1", "lld-concurrency", "lld-solid"],
  "LLD-8": ["lld-behavioral-1", "lld-modelling", "lld-solid"],
  "LLD-9": ["lld-oop", "lld-uml", "lld-behavioral-1"],
  "LLD-10": ["lld-modelling", "lld-creational", "lld-behavioral-1"],
  "LLD-11": ["lld-behavioral-1", "lld-creational", "lld-structural"],
  "LLD-12": ["lld-behavioral-1", "lld-behavioral-2", "lld-modelling", "lld-solid"],
  "LLD-13": ["lld-creational", "lld-behavioral-1", "lld-structural", "lld-solid"],
  "LLD-14": ["lld-concurrency", "lld-behavioral-1", "lld-solid"],
  "LLD-15": ["lld-concurrency", "lld-modelling", "lld-behavioral-1", "hld-idempotency"],
  "LLD-16": ["lld-approach", "lld-oop", "lld-uml"],
  "LLD-17": ["lld-oop", "lld-solid", "lld-modelling"],
  "LLD-18": ["lld-concurrency", "lld-modelling", "lld-behavioral-1"],
  "LLD-19": ["lld-behavioral-1", "lld-modelling", "lld-concurrency", "hld-idempotency"],
  "LLD-20": ["lld-modelling", "lld-concurrency", "lld-uml"],
  "HLD-1": ["hld-approach", "hld-estimation", "hld-probabilistic-ids", "hld-caching", "hld-databases", "hld-networking"],
  "HLD-2": ["hld-rate-limiting", "hld-caching", "hld-cap"],
  "HLD-3": ["hld-caching", "hld-consistent-hashing", "hld-replication", "hld-sharding"],
  "HLD-4": ["hld-messaging", "hld-idempotency", "hld-api-design"],
  "HLD-5": ["hld-caching", "hld-sharding", "hld-messaging", "hld-estimation", "hld-stream-processing"],
  "HLD-6": ["hld-realtime", "hld-messaging", "hld-databases", "hld-sharding", "hld-security"],
  "HLD-7": ["hld-cdn-storage", "hld-messaging", "hld-estimation", "hld-databases"],
  "HLD-8": ["hld-cdn-storage", "hld-caching", "hld-scalability", "hld-observability"],
  "HLD-9": ["hld-geo", "hld-realtime", "hld-sharding", "hld-caching"],
  "HLD-10": ["hld-cdn-storage", "hld-databases", "hld-messaging", "hld-cap"],
  "HLD-11": ["hld-indexes", "hld-sharding", "hld-replication", "hld-probabilistic-ids"],
  "HLD-12": ["hld-transactions", "hld-messaging", "hld-databases", "hld-caching"],
  "HLD-13": ["hld-transactions", "hld-cap", "hld-consensus", "hld-caching"],
  "HLD-14": ["hld-idempotency", "hld-transactions", "hld-messaging", "hld-cap", "hld-security"],
  "HLD-15": ["hld-consensus", "hld-messaging", "hld-idempotency", "hld-databases"],
  "HLD-16": ["hld-messaging", "hld-indexes", "hld-sharding", "hld-cdn-storage", "hld-stream-processing"],
  "HLD-17": ["hld-databases", "hld-indexes", "hld-sharding", "hld-probabilistic-ids", "hld-stream-processing"],
  "HLD-18": ["hld-geo", "hld-realtime", "hld-messaging"],
  "HLD-19": ["hld-cap", "hld-transactions", "hld-consensus", "hld-caching"],
  "HLD-20": ["hld-load-balancing", "hld-rate-limiting", "hld-observability", "hld-api-design", "hld-networking", "hld-security"],
  "AI-1": ["ai-approach"],
  "AI-2": ["ai-approach"],
  "AI-3": ["hld-api-design", "hld-idempotency"],
  "AI-4": ["hld-indexes"],
  "AI-5": ["ai-approach", "hld-indexes"],
  "AI-6": ["ai-spring-boot"],
  "AI-7": ["ai-spring-boot", "hld-realtime"],
  "AI-8": ["ai-spring-boot"],
  "AI-9": ["ai-spring-boot", "hld-databases"],
  "AI-10": ["hld-indexes", "hld-databases"],
  "AI-11": ["ai-approach", "hld-indexes"],
  "AI-12": ["ai-spring-boot"],
  "AI-13": ["ai-spring-boot", "hld-api-design"],
  "AI-14": ["ai-approach", "hld-idempotency"],
  "AI-15": ["hld-api-design", "ai-spring-boot"],
  "AI-16": ["ai-approach", "hld-messaging"],
  "AI-17": ["hld-observability", "ai-approach"],
  "AI-18": ["ai-approach", "hld-api-design"],
  "AI-19": ["hld-caching", "hld-rate-limiting", "hld-observability", "ai-approach"],
  "AI-20": ["ai-approach", "ai-spring-boot", "hld-observability"],
};

// ---------- parse ----------
const articles = [];
for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith(".md")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
  const parts = fs.readFileSync(path.join(SRC, f), "utf8").split(/^=== (.+?) ===\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const [id, track, title] = parts[i].split("|").map((s) => s.trim());
    if (!id || !track || !title) throw new Error(`${f}: bad header "${parts[i]}"`);
    const body = parts[i + 1].trim();
    const summary = (body.split(/\n\s*\n/)[0] || "").replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
    articles.push({ id, track, title, summary, markdown: body + "\n" });
  }
}
const byId = new Map(articles.map((a) => [a.id, a]));
if (byId.size !== articles.length) throw new Error("duplicate article id");
for (const [topic, ids] of Object.entries(PREREQS)) for (const id of ids) if (!byId.has(id)) throw new Error(`${topic}: unknown fundamental "${id}"`);

// ---------- keep saved state ----------
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { groups: [] };
const saved = new Map();
for (const g of old.groups || []) for (const it of g.items || []) saved.set(it.id, it);

// Topic titles for "read before" links.
const topicTitles = {};
for (const f of fs.readdirSync(path.join(ROOT, "content")).filter((f) => /^day-\d+\.json$/.test(f))) {
  for (const t of JSON.parse(fs.readFileSync(path.join(ROOT, "content", f), "utf8")).topics || []) topicTitles[`${t.category}-${Number(t.number)}`] = t.title;
}

// ---------- assemble ----------
const ORDER = { LLD: 0, HLD: 1, AI: 2 };
let n = 0;
const groups = TRACKS.map(([track, name]) => ({
  track, name,
  items: articles.filter((a) => a.track === track).map((a) => {
    const s = saved.get(a.id) || {};
    const usedBy = Object.entries(PREREQS).filter(([, ids]) => ids.includes(a.id)).map(([k]) => k)
      .sort((x, y) => ORDER[x.split("-")[0]] - ORDER[y.split("-")[0]] || Number(x.split("-")[1]) - Number(y.split("-")[1]))
      .map((k) => ({ key: k, title: topicTitles[k] || k }));
    const item = { number: ++n, id: a.id, title: a.title, summary: a.summary, markdown: a.markdown, usedBy,
      readAt: s.readAt ?? null, notes: s.notes || "" };
    if (Array.isArray(s.chat) && s.chat.length) item.chat = s.chat;
    return item;
  }),
}));

const out = { source: "Read-first fundamentals written for this site.", groups, prereqs: PREREQS };
const tmp = OUT + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
fs.renameSync(tmp, OUT);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${n} articles (${groups.map((g) => `${g.track} ${g.items.length}`).join(", ")}); prerequisites for ${Object.keys(PREREQS).length} topics`);
