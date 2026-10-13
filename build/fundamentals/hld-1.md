=== hld-approach | HLD | How to approach a system design interview ===
A system design interview is deliberately open-ended: "Design a URL shortener" could fill a week. The interviewer wants to see how you turn that vagueness into a clear plan, back your choices with numbers, and go deep where it matters. This chapter gives you an eight-step method, shown on one running example (a URL shortener like bit.ly), plus what interviewers score and a time plan.

## 1. Requirements

**Definition:** Agree on what the system must do (functional) and how well it must do it (non-functional) before drawing anything.

Functional requirements are the 3-5 core use cases. Non-functional requirements (NFRs) are the qualities that drive the architecture: scale, latency, availability, consistency and durability. Think of an architect asking "how many people will live here?" before choosing between a cottage and a tower.

### The problem

```text
Interviewer: Design a URL shortener.
Candidate:   OK, we'll have Kafka, Cassandra, Kubernetes, and microservices for
             users, links, analytics, billing...
```

Twenty minutes later the interviewer asks "how many links per day?" and the candidate does not know. Nothing on the board can be justified, because nothing was asked.

### Better design

```text
Functional:   create short link (optional custom alias, optional expiry)
              redirect short -> long
              basic click count per link
Out of scope: user accounts, dashboards, billing   (say this out loud)
NFRs:         100M new links/month, reads ~100x writes
              redirect p99 < 50 ms, highly available (redirects matter more than creates)
              a created link must never be lost; slightly stale analytics are fine
```

Every later decision can now point back to a line on this list. Parking features explicitly keeps the scope small and shows judgement.

**Key takeaway:** Spend about 5 minutes on requirements, and write down what is out of scope.

---

## 2. Estimation

**Definition:** Quick arithmetic that turns requirements into numbers: requests per second (QPS), storage, bandwidth and cache size.

The goal is the right order of magnitude, not precision. An estimate is only useful if it changes a decision, so stop once it has.

### The problem

A candidate spends eight minutes computing storage to three decimal places, then draws the same system they would have drawn anyway. The numbers never influence anything.

### Better design

```text
Writes: 100M / month / 2.5M s ~ 40/s        (peak ~100/s)  -> one DB primary is fine
Reads:  40 x 100 ~ 4,000/s                  (peak ~10-20k) -> add a cache
Data:   100M x 12 x 5 yrs = 6B links x 500 B = 3 TB         -> plan to shard by code later
Codes:  62^7 ~ 3.5 trillion >> 6 billion                    -> 7 base62 chars suffice
```

Each line ends with a decision. That arrow is what the interviewer is listening for. The next article covers estimation in depth.

**Key takeaway:** Every number should end with "so we will...".

---

## 3. API design

**Definition:** Define the contract between clients and the system before designing the internals.

The API fixes the inputs, outputs and error cases. It also surfaces hidden requirements such as idempotency (sending the same request twice has the same effect as sending it once) and rate limits.

### The problem

The candidate says "there's a create endpoint and a get endpoint" and moves on. Later nobody knows whether redirects return 301 or 302, or what happens when a custom alias is already taken.

### Better design

```http
POST /v1/urls
  Idempotency-Key: 7f3c...
  { "longUrl": "...", "customAlias": "sale24", "expiresAt": "2026-12-31T00:00:00Z" }
  -> 201 { "code": "sale24", "shortUrl": "https://sho.rt/sale24" }
  -> 409 Conflict if the alias is taken

GET /{code}
  -> 302 Location: <longUrl>     (302 so every click reaches us and is counted)
  -> 404 if unknown, 410 Gone if expired
```

The 301 vs 302 choice is a real trade-off: browsers cache a 301 (permanent redirect), which saves load on you but hides later clicks from your analytics.

**Key takeaway:** Write 2-4 endpoints with status codes, plus one sentence on auth, idempotency and rate limits.

---

## 4. Data model

**Definition:** List the entities and their access patterns, then choose storage that fits those patterns.

An access pattern answers "how will we read and write this data?", for example "fetch by code, 10k times a second". Access patterns choose the database, not brand names.

### The problem

"We'll use Cassandra because it scales." When asked how a custom alias is checked for uniqueness, the candidate has no answer, because the choice came before the questions.

### Better design

```sql
-- point lookup by code at ~10k QPS, insert at ~40/s
CREATE TABLE url (
  code        VARCHAR(10) PRIMARY KEY,   -- also enforces alias uniqueness
  long_url    TEXT        NOT NULL,
  created_at  TIMESTAMP   NOT NULL,
  expires_at  TIMESTAMP   NULL
);
-- clicks: append-only, aggregated later -> queue + analytics store, not this table
```

The `url` data is a pure key-value lookup, so a relational database or a key-value store both work. Click events have a completely different pattern (huge volume of appends, read only in aggregate), so they get different storage.

**Key takeaway:** Say the access pattern first, then the store.

---

## 5. High-level design

**Definition:** Draw the main components and walk one write and one read through them.

Start with the simplest design that meets the numbers. Every box must earn its place.

### The problem

A diagram with 15 boxes and no arrows explained. The interviewer cannot tell what happens when a user clicks a link.

### Better design

```text
Client -> DNS -> Load balancer -> App servers (stateless)
                                    |-- read  -> Redis cache -> (miss) DB replica
                                    |-- write -> DB primary
                                    |-- click event -> Queue -> Workers -> Analytics DB

Read:  GET /abc123 -> cache hit (most requests) -> 302; miss -> replica -> fill cache
Write: POST -> generate code -> insert into primary -> 201
```

Walking a read and a write proves the diagram works and gives the interviewer natural places to ask "what if?".

**Key takeaway:** Simple first, then narrate one request end to end.

---

## 6. Deep dives

**Definition:** Spend the biggest block of time on the 2-3 hardest parts of this particular problem.

For each part use the same shape: options, trade-offs, choice, failure handling. Offer the interviewer a choice of topic if they seem to have one in mind.

### The problem

"We'll generate a random code." How are collisions handled? What if two servers produce the same code? The hard part is waved away.

### Better design

```text
Unique code generation:
  a) hash(longUrl), take 7 chars  -> collisions; must check and retry
  b) random 7 chars               -> collisions rare but possible; check on insert
  c) counter + base62 encoding    -> no collisions; the counter is a hotspot / SPOF
Choice: (c) with ID ranges - each app server leases 1,000 IDs at a time from a
        central counter. A crashed server wastes at most 1,000 IDs, which is fine.
Note:   sequential codes are guessable; shuffle the bits if that matters.
```

Other typical deep dives here: hot links and the caching strategy, and the analytics pipeline.

**Key takeaway:** Options, trade-offs, choice, failure handling, every time.

---

## 7. Bottlenecks and failures

**Definition:** Ask "what breaks first, and what happens when each box dies?"

A single point of failure (SPOF) is a component whose failure takes the whole system down. Every box you drew is a candidate.

### The problem

The design has one Redis node and one DB primary. The interviewer says "Redis just died", and the candidate realises all 20k reads/s now hit the database at once.

### Better design

```text
Cache down      -> Redis replica + failover; DB replicas sized to survive a cold cache
DB primary down -> automatic failover to a replica; creates fail briefly, redirects continue
Queue down      -> click events buffered or dropped; redirects unaffected
Hot link        -> served from cache (and from a CDN if 301 is acceptable)
Monitor         -> p99 redirect latency, error rate, cache hit ratio, queue lag
```

Separating the critical path (redirects) from non-critical work (analytics) lets parts fail without a full outage.

**Key takeaway:** Name each SPOF and say what degrades, not just what breaks.

---

## 8. Trade-offs and wrap-up

**Definition:** Summarise the key decisions, what each one cost, and how the design would evolve.

This is where senior candidates stand out. A choice without a stated cost sounds like a guess.

### The problem

"So that's the design." The interviewer has to drag the reasoning out with questions.

### Better design

```text
302 not 301      : + accurate analytics       - more load on our servers
Counter + base62 : + no collisions            - guessable codes, needs a counter service
Cache-aside      : + fast reads               - an edited link may be stale for the TTL
Next steps       : multi-region read replicas, CDN at the edge, abuse/spam detection
```

**Key takeaway:** For every major choice, say what you gained and what you paid.

---

## 9. What interviewers score

**Definition:** Interviewers grade signals, not a "correct" diagram; there usually is none.

### The signals

- **Problem navigation:** clarifying scope, stating assumptions, staying aligned with requirements.
- **Breadth:** knowing the standard building blocks (cache, queue, replicas, CDN) and when each fits.
- **Depth:** explaining real mechanisms on 2-3 hard parts instead of buzzwords.
- **Trade-offs:** naming alternatives and why one wins, ideally with numbers.
- **Operational maturity:** failures, monitoring, deployments, data growth.
- **Communication:** driving the discussion, thinking aloud, checking in, following hints.

A question like "what if a celebrity shares a link?" is a hint about hot keys, not an attack on your design. Follow it.

**Key takeaway:** At senior level, driving the conversation and justifying trade-offs matter more than the boxes.

---

## 10. A time plan

**Definition:** A rough minute budget so you never run out of time before the deep dive.

| Step | 45 min | 60 min |
|---|---|---|
| Requirements | 5 | 6 |
| Estimation | 3 | 4 |
| API + data model | 6 | 8 |
| High-level design | 8 | 10 |
| Deep dives | 15 | 22 |
| Bottlenecks + trade-offs | 5 | 7 |
| Buffer for questions | 3 | 3 |

Check in at each transition: "I'll move to the data model unless you'd like more on the API?"

**Key takeaway:** Protect the deep-dive time; it carries the most weight.

---

## In an HLD interview

- **URL Shortener:** the full method above; the deep dive is code generation and the 301 vs 302 choice.
- **News Feed / Chat:** requirements decide everything (fan-out on write vs read, delivery and ordering guarantees), so spend the full 5 minutes there.
- **Payment System / Seat Reservation:** the NFRs are about correctness, so the deep dive is idempotency and preventing double charging or double booking.
- **YouTube / Netflix:** estimation shows bandwidth dominates, which justifies a CDN before anything else.
- **What to SAY:** "Let me confirm the requirements and rough scale first, then I'll sketch a simple design and we can go deep on the hardest parts."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Requirements | Scope and NFRs first | What is in, what is out, how big, how strict? |
| Estimation | Numbers that decide | Which decision does this number change? |
| API | Contract before internals | What are the inputs, outputs and errors? |
| Data model | Access patterns pick storage | How is this data read and written? |
| High-level design | Simple, then walk a request | Can I narrate one read and one write? |
| Deep dives | 2-3 hardest parts | Options, trade-offs, choice, failure? |
| Bottlenecks | SPOFs and degradation | What happens when this box dies? |
| Trade-offs | Every choice has a cost | What did I gain and what did I pay? |

## Final memory aid

- **Ask** before you draw
- **Count** only what changes a decision
- **Contract** before internals
- **Access patterns** pick the database
- **Simple first**, then walk a request through it
- **Go deep** on the hard part: options, trade-offs, choice, failure
- **Break it:** every box can die
- **Say the cost** of every choice

=== hld-estimation | HLD | Back-of-the-envelope estimation ===
Back-of-the-envelope estimation turns vague scale ("millions of users") into numbers that justify the architecture: how many servers, whether data fits in memory, whether one database survives the write rate. Interviewers want the right order of magnitude, reached quickly and out loud, not precision. This chapter covers the numbers to memorise, the formulas, worked examples and the common mistakes.

## 1. Powers of two and ten

**Definition:** Each size unit is about 1,000 times the previous one, so you can work in powers of ten and stop counting zeros.

Strictly, 1 KB is 2^10 = 1,024 bytes, but in estimation 1,000 is close enough. Scientific notation (4 x 10^9 instead of 4,000,000,000) is the best defence against arithmetic slips.

### The problem

```text
6,000,000,000 links x 500 bytes = 3,000,000,000,000 bytes = ... 300 GB? 3 TB? 30 TB?
```

Counting zeros on a whiteboard under pressure goes wrong easily, and a 10x error changes the design.

### Better design

```text
Power  Approx  Unit  Name
2^10   10^3    KB    thousand
2^20   10^6    MB    million
2^30   10^9    GB    billion
2^40   10^12   TB    trillion
2^50   10^15   PB    quadrillion

6 x 10^9 x 5 x 10^2 B = 30 x 10^11 B = 3 x 10^12 B = 3 TB
```

Multiply the leading digits, add the exponents, then map the exponent back to a unit.

**Key takeaway:** Write exponents, not zeros.

---

## 2. Latency numbers

**Definition:** Rough costs of common operations, which differ from each other by orders of magnitude.

These numbers explain why we cache, why we keep data close to users and why we batch. Exact values depend on hardware; the ratios are what matter.

```text
L1 cache reference                   ~1 ns
Main memory reference                ~100 ns
Read 1 MB sequentially from memory   ~10 us    (us = microsecond)
SSD random read                      ~20-100 us
Read 1 MB sequentially from SSD      ~50 us - 1 ms
Round trip in the same datacenter    ~0.5 ms
HDD disk seek                        ~5-10 ms
Round trip India <-> US              ~150-250 ms
```

### The problem

A page makes 10 sequential calls from Mumbai to a database in Virginia. At ~200 ms per round trip, the page spends 2 seconds just waiting on the network.

### Better design

Put a cache or read replica in the user's region (~0.5-1 ms per call), or batch the 10 calls into one. The same work now costs a few milliseconds of network time.

**Key takeaway:** Memory is fast, disk is slower, crossing an ocean is very slow; design to avoid the slow trips.

---

## 3. QPS from daily active users

**Definition:** Average QPS = (daily active users x actions per user per day) / seconds in a day.

A day has 86,400 seconds; round it to 10^5 and say so. Handy shortcuts: 1 million requests/day is about 12 per second, and 1 billion/day is about 12,000 per second.

### The problem

"We have 10 million users, so 10 million QPS." Not every user is active today, and an active user does not make a request every second.

### Better design

```text
DAU = 10M, each user makes 20 requests/day
Daily requests = 10^7 x 20 = 2 x 10^8
Average QPS    = 2 x 10^8 / 10^5 = 2,000 QPS
```

Then split reads from writes, because they often differ by 10-1000x and scale differently.

**Key takeaway:** Daily events divided by 10^5 gives average QPS.

---

## 4. Peak factor

**Definition:** Peak traffic is the average multiplied by a factor: typically 2-3x for normal daily cycles, 10x or more for flash events.

Traffic follows the day: quiet at 4 a.m., busy at 9 p.m. Events such as a cricket final, a flash sale or a concert ticket release spike far beyond that.

### The problem

The system is sized for the 2,000 QPS average. Every evening it sees 6,000 QPS and starts timing out.

### Better design

```text
Average 2,000 QPS x peak factor 3 = 6,000 QPS   (daily peak)
Flash sale x10                    = 20,000 QPS  (absorb with a queue or autoscaling)
Size for the peak, then add 1.5-2x headroom for failures and deploys.
```

**Trade-offs:**
- Permanently sizing for rare spikes wastes money; queues and autoscaling absorb them more cheaply.

**Key takeaway:** Design for peak, not average.

---

## 5. Storage and bandwidth

**Definition:** Storage = new objects per day x size x retention x replication. Bandwidth = requests per second x payload size.

Replication (usually 3 copies) and index or row overhead (often up to 2x) are easy to forget and together can multiply the total by about 6.

### The problem

```text
"Egress is 1 GB/s, so a 1 Gbps link is enough."
```

GB is gigabytes, Gbps is gigabits. 1 GB/s is 8 Gbps. Mixing bits and bytes is an 8x error.

### Better design

```text
Photo app: 10M uploads/day x 500 KB = 5 x 10^12 B = 5 TB/day raw
Per year:  5 TB x 365 ~ 1.8 PB; x3 replicas ~ 5.5 PB     -> object storage, tiering
Ingress:   10^7 / 10^5 s = 100 uploads/s x 500 KB = 50 MB/s = 400 Mbps
Egress:    each photo viewed 20x -> 2,000 views/s x 500 KB = 1 GB/s = 8 Gbps -> CDN
```

**Key takeaway:** Count replicas and overhead, and multiply bytes by 8 to get bits.

---

## 6. Cache sizing

**Definition:** Cache size is roughly the hot fraction of daily reads (often 20%) times the object size.

The 80/20 rule says a small share of items gets most of the traffic. Caching that share gives most of the benefit at a fraction of the cost.

### The problem

"Let's cache everything." For the URL shortener that means 3 TB of RAM, mostly holding links nobody clicks.

### Better design

```text
Reads/day = 4,000 QPS x 10^5 s = 4 x 10^8
Hot 20%   = 8 x 10^7 links x 500 B = 4 x 10^10 B = 40 GB
-> fits on one or two cache nodes (64 GB RAM each), plus replicas
```

This is an upper bound that assumes every read is a different link; repeated clicks make the real hot set smaller still.

**Key takeaway:** Cache the hot set, not the whole dataset.

---

## 7. Worked examples

**Definition:** Server count = peak QPS / capacity per server x headroom.

Capacity per node depends heavily on the work per request, so always state it as an assumption.

### Server count

```text
Peak 20,000 QPS; assume one app server handles ~2,000 QPS
20,000 / 2,000 = 10 servers; x2 headroom = ~20 servers, autoscaled
```

### Chat app (WhatsApp-like)

```text
500M DAU x 40 messages/day = 2 x 10^10 messages/day
QPS:     2 x 10^10 / 10^5 = 200,000/s average, ~500k at peak -> heavy sharding
Storage: 2 x 10^10 x 200 B = 4 TB/day ~ 1.5 PB/year before replication
Online:  30% of DAU at peak = 150M sockets; ~500k per gateway -> ~300 gateway servers
```

### Single-node ballparks (state them as assumptions)

| Component | Rough capacity |
|---|---|
| Stateless API server | 1k-10k simple requests/s |
| MySQL / PostgreSQL | ~5k-20k simple writes/s; many more cached reads |
| Redis | ~100k+ ops/s per node |
| One server's RAM | 64-256 GB typical |
| 1 Gbps network link | ~125 MB/s |

**Key takeaway:** Peak divided by per-node capacity, times headroom, gives the node count.

---

## 8. Rounding rules and common mistakes

**Definition:** Round aggressively and openly, keep one significant digit, and stop when a decision is made.

### Rounding rules

- 86,400 s/day -> 10^5; 2.6M s/month -> 2.5 x 10^6; 31.5M s/year -> 3 x 10^7.
- Round sizes to friendly numbers (480 bytes -> 500 B).
- Round in the safe direction for the decision (overestimate load when sizing).
- Say each rounding out loud so the interviewer can follow and correct you.

### Common mistakes

- Designing for the average instead of the peak.
- Forgetting replication and index overhead.
- Mixing bits and bytes.
- Not separating reads from writes.
- Spending minutes on arithmetic that changes no decision.

**Key takeaway:** One significant digit, assumptions on the board, then move on.

---

## In an HLD interview

- **URL Shortener:** 40 writes/s and 4k reads/s show one DB plus a cache is enough; 6B records justify 7-character codes.
- **YouTube / Netflix:** egress measured in terabits per second proves a CDN is mandatory, not optional.
- **Chat / WhatsApp:** 150M concurrent connections justify a separate connection-gateway tier.
- **Rate Limiter / Distributed Cache:** estimate keys x bytes per key to show the counters fit in memory.
- **What to SAY:** "About 10^5 seconds a day, so 2 x 10^8 requests is roughly 2k QPS average and 6k at peak; one DB primary handles that, so I won't shard on day one."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Powers of ten | 10^3 per unit step | Am I adding exponents, not counting zeros? |
| Latency numbers | Memory << disk << network | Which slow trip can I avoid? |
| QPS | Daily events / 10^5 | Have I split reads from writes? |
| Peak factor | 2-3x daily, 10x+ events | Am I sizing for the peak? |
| Storage | Count x size x retention x replicas | Did I include replication and overhead? |
| Bandwidth | QPS x payload | Bits or bytes? |
| Cache sizing | Hot 20% of reads | Does the hot set fit in RAM? |
| Server count | Peak / capacity x headroom | What per-node capacity am I assuming? |

## Final memory aid

- **Day:** 10^5 seconds
- **1M/day:** about 12 per second
- **Peak:** 2-3x, flash events 10x
- **Storage:** count x size x retention x 3
- **Bandwidth:** bytes x 8 = bits
- **Cache:** the hot 20%
- **Servers:** peak / capacity x 2
- **Stop** when the number has made a decision
