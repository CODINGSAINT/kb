=== hld-approach | HLD | How to approach a system design interview ===
System design interviews are deliberately open-ended: "Design WhatsApp" could fill a week. The interviewer wants to see how you **structure ambiguity, make trade-offs with numbers, and go deep where it matters**. This chapter gives you a time-boxed framework, what to say at each step, how deep dives are chosen, and a worked skeleton.

## What's being evaluated
| Signal | Strong candidates… |
|---|---|
| Problem navigation | Clarify scope, state assumptions, and keep the design aligned with requirements |
| Technical breadth | Know the standard building blocks and when each applies |
| Depth | Go deep on 2–3 hard parts with real mechanisms (not buzzwords) |
| Trade-offs | Name alternatives and why they chose one, ideally with numbers |
| Operational maturity | Consider failures, monitoring, deployment, data growth |
| Communication | Drive the conversation, check in with the interviewer, adapt to hints |

At senior levels, **driving the discussion** and **justifying trade-offs** matter more than drawing the "right" boxes.

## The 45–60 minute framework
### Step 1: Requirements (5–8 minutes)
**Functional requirements:** the 3–5 core use cases. For a URL shortener: create a short link, redirect, optional custom alias, optional expiry, click analytics. Explicitly **park** the rest ("user accounts and dashboards are out of scope").
**Non-functional requirements:** the qualities that drive architecture.
- **Scale:** DAU, requests/sec, data size, growth.
- **Latency:** e.g. p99 redirect < 50 ms.
- **Availability vs consistency:** can users see stale data? For how long?
- **Durability:** can we ever lose a write?
- **Other:** security and privacy, regional/global, cost sensitivity, compliance.
**Good questions to ask:**
- What's the read/write ratio? Peak vs average traffic?
- Global users or one region? Mobile clients?
- What's the acceptable staleness? What happens if we show an old value?
- Any hard consistency requirements (money, inventory)?

### Step 2: Back-of-the-envelope estimates (3–5 minutes)
Turn requirements into numbers that **change decisions**: QPS (average and peak), storage per year, bandwidth, cache size. Stop when a decision is made ("4k QPS: one primary with replicas is fine, no sharding on day one"). See the estimation chapter.

### Step 3: API design (3–5 minutes)
Define the contract before the internals:
```
POST /v1/urls            { longUrl, customAlias?, expiresAt? } → 201 { code, shortUrl }
GET  /{code}             → 301/302 Location: longUrl
GET  /v1/urls/{code}/stats?from=&to=  → { clicks, byCountry[] }
```
Mention auth, idempotency keys for creates, pagination for lists, and rate limits.

### Step 4: Data model (5 minutes)
List entities and **access patterns** first, then pick storage:
- `url(code PK, long_url, owner_id, created_at, expires_at)`, accessed by code at 10k+ QPS: a key-value lookup.
- `click_event(code, ts, country, referrer)`: append-heavy, aggregated later, so a log or columnar store.
Access patterns choose the database, not the other way round.

### Step 5: High-level design (10 minutes)
Draw the main path end to end:
```
Client → DNS → CDN/edge → Load balancer → API servers (stateless)
                                     ├─→ Cache (Redis) ─→ DB (primary + replicas)
                                     ├─→ Queue (Kafka) ─→ Workers ─→ Analytics store
                                     └─→ Object storage (for blobs)
```
Walk one write and one read through the diagram. Make every component earn its place.

### Step 6: Deep dives (15–20 minutes)
Pick the **hardest or most interesting** parts, or let the interviewer choose. Typical deep dives:
- Generating unique short codes without collisions (counter + base62, Snowflake, hashing).
- Hot keys and caching strategy.
- Fan-out for feeds (push vs pull vs hybrid).
- Message ordering and delivery guarantees for chat.
- Consistency for inventory and payments (locks, idempotency, sagas).
- Sharding strategy and rebalancing.
For each, present **options → trade-offs → choice → failure handling**.

### Step 7: Bottlenecks, failures and wrap-up (3–5 minutes)
- Single points of failure and how you remove them.
- What happens when the cache, a shard, or the queue fails.
- Monitoring: key metrics and alerts (p99 latency, error rate, consumer lag).
- Future evolution: multi-region, analytics, cost optimisation.

## Principles that consistently score
1. **Start simple, then evolve.** A single database with a cache is a valid v1. Scale it when numbers demand (replicas, then sharding, then multi-region). Interviewers love a design that grows in visible steps.
2. **Every choice has a trade-off; say it.** "Fan-out on write makes reads O(1) but celebrity posts cost millions of writes, so hybrid: push for normal users, pull for celebrities."
3. **Separate read and write paths** when their scale or requirements differ (CQRS-style read models, caches, search indexes).
4. **Prefer stateless services**; push state into purpose-built stores.
5. **Design for failure:** timeouts, retries with idempotency, back-pressure, graceful degradation.
6. **Quantify:** "Redis does about 100k ops/s per node; at 300k peak reads we need ~4 primaries with headroom."
7. **Asynchrony for slow or unreliable work:** queue it, acknowledge quickly, process in the background.

## Common building blocks and when to use them
| Building block | Use it for |
|---|---|
| Load balancer | Distributing traffic, health checks, TLS termination |
| CDN | Static assets, media, cacheable API responses near users |
| Cache (Redis/Memcached) | Hot reads, sessions, counters, rate limiting |
| Relational DB | Transactions, relationships, strong consistency |
| NoSQL (KV / wide-column / document) | Massive scale with simple access patterns |
| Object storage | Files, images, video, backups |
| Message queue / log | Async work, decoupling, fan-out, buffering spikes |
| Search index | Full-text search, faceting |
| Stream processor | Real-time aggregation, analytics |
| Coordination service | Leader election, locks, configuration |

## How to handle the interviewer
- **Check in at transitions:** "I'll move to the data model unless you'd like more on the API?"
- **Follow hints:** a question like "what if a celebrity posts?" is a hint about hot keys, not a challenge to defend your design.
- **Don't over-index on one area** unless asked. Keep the whole system coherent.
- **Think aloud.** Silent thinking scores nothing.
- **It's fine to say "I'd measure this"** for genuinely unknowable values, but propose a reasonable default.

## Red flags
- Jumping to microservices, Kafka and Kubernetes before stating requirements.
- Choosing technologies by brand ("Cassandra because it scales") without access-pattern reasoning.
- Estimates that never influence decisions.
- Ignoring failure modes of components you drew (single DB primary, single cache node).
- Hand-waving the hard part ("we'll make it consistent").

## A reusable answer skeleton
```
1 Requirements   F: … | NF: scale, latency, availability, consistency, durability | Out of scope: …
2 Estimates      QPS avg/peak, storage/yr, bandwidth, cache size → decisions
3 API            3–5 endpoints/events with key params; idempotency, pagination
4 Data           entities + access patterns → storage choices + keys
5 HLD            client → edge → LB → services → cache/DB/queue/blob; walk a read and a write
6 Deep dives     2–3 hardest parts: options → trade-offs → choice → failure handling
7 Wrap-up        SPOFs, failure modes, monitoring, evolution
```

## Interview questions about process
1. **"Where would you start?"** Clarify requirements and scale; propose the scope you'll design.
2. **"This won't scale. What now?"** Identify which resource saturates first (CPU, DB writes, network) using your numbers, then apply the matching technique (cache, replicas, sharding, async).
3. **"What would you monitor?"** Golden signals per component: latency, traffic, errors, saturation, plus business metrics (redirects/sec, messages delivered).

=== hld-estimation | HLD | Back-of-the-envelope estimation ===
Capacity estimation turns vague scale ("millions of users") into numbers that justify architecture: how many servers, whether data fits in memory, whether one database survives the write rate, and whether you need a CDN. Interviewers want **the right order of magnitude, reached quickly and transparently**, not precision.

## Numbers every engineer should know
### Time and throughput
| Quantity | Approximate value |
|---|---|
| Seconds in a day | 86,400 ≈ **10⁵** (round it, and say so) |
| Seconds in a month | ≈ 2.5 × 10⁶ |
| Seconds in a year | ≈ 3 × 10⁷ |
| 1 million requests/day | ≈ 12 requests/second |
| 1 billion requests/day | ≈ 12,000 requests/second |
| Peak factor over average | 2–3× for typical diurnal traffic, 10×+ for flash events |

### Latency (orders of magnitude)
| Operation | Latency |
|---|---|
| L1 cache reference | ~1 ns |
| Main memory reference | ~100 ns |
| Compress 1 KB (fast codec) | ~2–3 µs |
| Read 1 MB sequentially from memory | ~10 µs |
| SSD random read | ~16–100 µs |
| Read 1 MB sequentially from SSD | ~50 µs–1 ms |
| Round trip within a datacenter | ~0.5 ms |
| HDD seek | ~5–10 ms |
| Round trip India ↔ US | ~150–250 ms |

Takeaways: memory is ~1,000× faster than SSD random access, which is far faster than network round trips across continents. That's why we cache, colocate and use CDNs.

### Rough single-node capacities (ballpark, state them as assumptions)
| Component | Rough capacity |
|---|---|
| Stateless API server | 1k–10k simple requests/s (depends heavily on work per request) |
| PostgreSQL/MySQL on good hardware | ~5k–20k simple writes/s; 10k–100k cached reads/s |
| Redis | ~100k+ ops/s per node (single-threaded command execution) |
| Kafka broker | hundreds of MB/s of throughput |
| Single WebSocket server | 100k–1M mostly idle connections (memory-bound) |
| 1 Gbps network link | ~125 MB/s |

### Storage sizes
| Item | Size |
|---|---|
| char (ASCII) / UTF-8 typical | 1 byte (Indic scripts: 3 bytes per char in UTF-8) |
| int / long / UUID | 4 / 8 / 16 bytes |
| Timestamp | 8 bytes |
| Typical DB row with indexes and overhead | 2–3× raw size |
| Tweet-like text record | ~300 bytes–1 KB |
| Compressed photo | 200 KB–2 MB |
| 1 minute of 1080p video | ~50–100 MB (raw upload); less once encoded |

Powers of two: 2¹⁰ ≈ 10³ (KB), 2²⁰ ≈ 10⁶ (MB), 2³⁰ ≈ 10⁹ (GB), 2⁴⁰ ≈ 10¹² (TB), 2⁵⁰ ≈ 10¹⁵ (PB).

## The method
1. **State assumptions:** DAU, actions per user per day, object sizes, read:write ratio, retention.
2. **Traffic:** `daily actions ÷ 10⁵ = average QPS`; multiply by a peak factor.
3. **Storage:** `new objects/day × size × retention`, then × replication factor (often 3), plus index overhead.
4. **Bandwidth:** `QPS × payload size`, for both ingress and egress.
5. **Memory for cache:** the hot fraction of data or requests (often 20% of daily reads).
6. **Server counts:** `peak QPS ÷ per-server capacity`, plus headroom (×1.5–2) for failures and deploys.
7. **Decide:** state what the numbers imply.

## Worked example 1: URL shortener
Assumptions: 100M new short URLs/month; reads 100× writes; keep 5 years; ~500 bytes per record.
- Writes: 100M ÷ 2.5 × 10⁶ s ≈ **40 writes/s** (peak ~100/s). Trivial for one DB.
- Reads: 40 × 100 = **4,000 reads/s** average, ~10–20k at peak. Use a cache; replicas optional.
- Records: 100M × 12 × 5 = **6 billion** URLs. Storage: 6 × 10⁹ × 500 B = **3 TB** (≈ 9 TB with 3× replication). Too big for one cheap box long-term, so plan partitioning by code.
- Code length: base62 with 7 chars gives 62⁷ ≈ 3.5 × 10¹² ≫ 6 × 10⁹. **7 characters suffice.**
- Cache: if 20% of URLs get 80% of traffic and we cache the hot set of recent links, ~a few hundred GB at most. Start with tens of GB holding the hottest links.

## Worked example 2: chat (WhatsApp-like)
Assumptions: 500M DAU; 40 messages sent per user per day; average message 100 bytes; metadata 100 bytes; keep 1 year on the server (or until delivered, depending on product).
- Messages/day: 500M × 40 = 2 × 10¹⁰ ⇒ **~200k messages/s** average, ~500k peak.
- Storage/day: 2 × 10¹⁰ × 200 B = **4 TB/day**, ~1.5 PB/year before replication. So: wide-column store sharded by conversation, plus TTLs or archiving.
- Connections: if 30% of DAU are online at peak, that's 150M concurrent sockets. At ~500k per gateway server that's **~300 gateway servers**, so a dedicated connection tier.

## Worked example 3: video platform uploads
Assumptions: 500 hours of video uploaded per minute; 1 hour of source video ≈ 3 GB; transcoded into five renditions totalling ~1.5× source size.
- Ingest: 500 h × 3 GB = 1.5 TB/minute = **25 GB/s** ingest. Needs parallel uploads straight to object storage.
- Storage/day: 1.5 TB × 1,440 × 2.5 (source + renditions) ≈ **5.4 PB/day**, which requires tiered storage and lifecycle policies.
- Egress dominates cost, which justifies CDN and ISP caches.

## Tips for the interview
- **Round aggressively** and say so ("86,400 is roughly 10⁵").
- **Write assumptions on the board.** If the interviewer changes one, recompute.
- **Use scientific notation** to avoid zero-counting errors.
- **Sanity check:** 4 TB/day for chat sounds big, but it's consistent with public numbers for large messaging apps.
- **Stop early.** Once the number has made a decision, move on.
- **Separate reads and writes;** they often differ by 10–1000×.

## Common mistakes
- Forgetting peak vs average (designing for average guarantees an outage at peak).
- Ignoring replication and index overhead in storage.
- Mixing bits and bytes in bandwidth (Gbps vs GB/s: divide by 8).
- Spending ten minutes on arithmetic that doesn't change any decision.

## Interview questions
1. **How many servers do we need for 50k QPS?** At ~2k QPS per server, 25 servers; add 50–100% headroom for peaks, deploys and failures, so ~40–50, autoscaled.
2. **Will the active dataset fit in memory?** Compare hot data size with per-node RAM (64–256 GB) across a cluster.
3. **Do we need a CDN?** If egress is in GB/s, or users are global, yes.

## Cheat sheet
```
QPS        = daily events / 10^5     (peak = ×2–10)
Storage/yr = events/day × size × 365 × replication(3) × overhead(~2)
Bandwidth  = QPS × payload (bytes → ×8 for bits)
Cache      ≈ 20% of hot data/requests
Servers    = peak QPS / per-node capacity × 1.5–2 headroom
Base62     62^6≈5.7e10, 62^7≈3.5e12, 62^8≈2.2e14
```
