=== hld-rate-limiting | HLD | Rate limiting and load shedding ===
Rate limiting caps how much work one caller can send you, and load shedding decides what to drop when the whole system is over capacity. This chapter walks through the five classic limiting algorithms, how to share a limit across many servers with Redis, where the limit belongs, what a throttled client should see, and how to shed load gracefully. Each idea comes with a small "what goes wrong" scenario and a better version.

## 1. Why limit at all

**Definition:** A rate limit is a rule like "at most 100 requests per minute per API key"; requests above it are rejected.

Think of a nightclub bouncer: he does not care if the club is full right now, he only checks that each group is not pushing in too fast. Limits protect you from abuse (password guessing, scraping), stop one noisy tenant from starving others, protect fragile dependencies (a partner API that only accepts 200 calls per second), and control cost (every SMS or LLM call costs money).

### The problem

```text
Tenant A script bug: 20,000 req/s  --\
Tenant B normal:        300 req/s  ----> Order service (capacity 5,000 req/s)
Tenant C normal:        200 req/s  --/
```

The service saturates. Tenants B and C time out even though they did nothing wrong.

### Better design

```text
Tenant A: 20,000 req/s -> limiter (1,000/s per tenant) -> 1,000 pass, 19,000 get 429
Tenant B:    300 req/s -> limiter                      ->   300 pass
Tenant C:    200 req/s -> limiter                      ->   200 pass
```

Each tenant gets a fair slice, and the bug hurts only the tenant that caused it.

**Trade-offs:**
- Every request pays a small check cost (often a network hop to a shared store).
- Limits set too low reject real customers.

**Key takeaway:** Rate limiting answers "is this caller sending too much?" It does not answer "is my server overloaded?" (that is load shedding, section 10).

---

## 2. Token bucket

**Definition:** A bucket holds up to `b` tokens and refills at `r` tokens per second; each request spends one token, and an empty bucket means reject.

It is like a prepaid travel card that is topped up automatically every second but can never hold more than a fixed amount. A caller who was idle can spend the stored tokens in a burst; over the long run they can never exceed `r`. You do not need a timer: store `tokens` and `lastRefill`, and top up lazily when a request arrives.

### The problem

A mobile app opens a screen that fires 20 API calls at once, then goes quiet for a minute. A strict "1 request every 100 ms" rule rejects most of them, and the screen breaks even though the average rate is tiny.

### Better design

```java
synchronized boolean tryAcquire() {
    long now = System.nanoTime();                       // monotonic clock
    double elapsedSec = (now - lastRefillNanos) / 1e9;
    tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec);
    lastRefillNanos = now;
    if (tokens < 1) return false;                       // reject
    tokens -= 1;
    return true;
}
```

With `capacity = 50` and `refillPerSec = 10`, the 20-call burst passes, and sustained traffic is held to 10 per second. Most API gateways (AWS API Gateway, Stripe's API, Spring Cloud Gateway's Redis limiter) use this model.

**Trade-offs:**
- Bursts of up to `b` reach the backend all at once, so the backend must tolerate them.

**Key takeaway:** Token bucket is the default answer: two numbers per key, bursts allowed, average rate enforced.

---

## 3. Leaky bucket

**Definition:** Requests enter a fixed-size queue that drains at a constant rate; when the queue is full, new requests are dropped.

Picture a bucket with a small hole: water pours in unevenly but drips out steadily. The output is perfectly smooth, which suits a dependency that cannot handle bursts, such as an SMTP relay or a legacy mainframe.

### The problem

A notification service receives 5,000 password-reset emails in one second after a marketing campaign. The email provider allows 100 sends per second and blocks the account for an hour.

### Better design

```text
5,000 emails -> [ queue, max 10,000 ] -> drain at 100/s -> email provider
                 (full? drop or spill to Kafka)
```

The provider sees a steady 100 per second; the last email goes out after about 50 seconds.

**Trade-offs:**
- Bursts turn into waiting time (latency), not instant success.
- A full queue still has to drop or spill somewhere.

**Key takeaway:** Use a leaky bucket to *shape* traffic into a fragile dependency.

### Token bucket vs. leaky bucket

- **Token bucket** lets a burst through immediately, up to `b`; it limits the average.
- **Leaky bucket (queue)** smooths a burst into a constant output rate; callers wait.
- Pick token bucket for public APIs, leaky bucket in front of outbound dependencies.

---

## 4. Fixed window counter

**Definition:** Count requests per caller in fixed clock windows (for example each calendar minute) and reject once the count passes the limit.

It is the simplest possible limiter: one counter per key per window, which disappears when the window ends.

### The problem

```text
Limit 100 per minute.
12:00:59  -> 100 requests (window 12:00, count 100, allowed)
12:01:00  -> 100 requests (window 12:01, count 100, allowed)
= 200 requests inside 2 seconds
```

At the window boundary a caller can get **twice the limit** in a short burst.

### Better design

Keep fixed windows only where that edge burst is harmless, such as daily or monthly quotas ("5 million calls per month"). In Redis this is just `INCR rl:42:202610131405` followed by an `EXPIRE` of 60 seconds. For strict per-minute limits, move to a sliding window (sections 5 and 6).

**Trade-offs:**
- Cheapest option, but inaccurate at the edges.

**Key takeaway:** Fixed windows are fine for coarse quotas; say "2x at the boundary" when you reject them for strict limits.

---

## 5. Sliding window log

**Definition:** Store the timestamp of every accepted request and, on each new request, count only timestamps from the last window.

It is exact: the rule "100 in any 60 seconds" is never broken. In Redis you use a sorted set with the timestamp as score: remove old entries with `ZREMRANGEBYSCORE`, count with `ZCARD`, then add.

### The problem

A login endpoint allows 5 attempts per 15 minutes. With a fixed window, an attacker can make 5 attempts at 12:14:59 and 5 more at 12:15:00, doubling their guesses.

### Better design

```text
key: login:alice    sorted set of attempt timestamps
new attempt at t:   drop entries < t - 15min, count remaining
count < 5  -> allow and add t
count >= 5 -> reject
```

No boundary trick works, because the window moves with every request.

**Trade-offs:**
- Memory is one entry per request. A limit of 10,000 per hour across a million users is up to ten billion entries.

**Key takeaway:** Use the log only for small, security-sensitive limits such as logins and OTPs.

---

## 6. Sliding window counter

**Definition:** Keep counts for the current and previous fixed windows and estimate the rolling count by weighting the previous window by how much of it still overlaps.

It gives near-sliding accuracy at the cost of just two counters per key.

### The problem

You need "100 per minute" for millions of users. Fixed windows allow 2x bursts; a sliding log needs too much memory.

### Better design

```text
Limit 100/min. Now is 15 s into the current minute.
previous minute count = 80, current minute count = 30
overlap of previous window = (60 - 15) / 60 = 0.75
estimate = 80 * 0.75 + 30 = 90  -> 90 < 100, allow
```

It assumes the previous minute's requests were spread evenly, so it is an approximation. Cloudflare, which uses this approach at its edge, has reported that the error is very small on real traffic.

| Algorithm | Memory per key | Bursts | Best use |
|---|---|---|---|
| Token bucket | 2 numbers | Up to `b` allowed | Public APIs (default) |
| Leaky bucket | A queue | Smoothed | Outbound to fragile services |
| Fixed window | 1 counter | Up to 2x at edges | Daily or monthly quotas |
| Sliding log | 1 entry per request | None | Logins, OTPs |
| Sliding counter | 2 counters | Very small | High-volume per-user limits |

**Key takeaway:** Sliding window counter is the best "N per window" choice when you have many keys.

---

## 7. Distributed limiting with Redis and Lua

**Definition:** All gateway instances share one counter per caller in a central store, and the read-update-write runs as a single atomic step.

Redis runs a Lua script without interleaving other commands, so the whole "refill, check, spend" sequence is one atomic operation.

### The problem

```text
50 gateway instances, each with a local limit of 100/min
-> one caller spread across them can do 50 x 100 = 5,000/min

Shared Redis, but non-atomic:
gw-1: GET count -> 99        gw-2: GET count -> 99
gw-1: SET count 100, allow   gw-2: SET count 100, allow   (101 allowed)
```

Local limits multiply by the number of instances, and a plain `GET` then `SET` races.

### Better design

```lua
-- KEYS[1] = bucket key; ARGV = capacity, refill_per_sec, now_ms
local cap, rate, now = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1]) or cap
local ts = tonumber(d[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - ts) / 1000 * rate)
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 1000)
return allowed
```

One round trip (about a millisecond in the same region), no race, and idle keys expire on their own. Use one key per caller so Redis Cluster spreads keys across shards. Spring Cloud Gateway's `RequestRateLimiter` filter runs a script very much like this one.

**Trade-offs:**
- Redis becomes a dependency on the hot path. Decide the failure policy: **fail open** (allow) for normal APIs, **fail closed** (reject) for money or security limits such as OTP sends.
- At very high rates, add a local pre-check or lease tokens in batches (take 50 at a time), accepting slight overshoot.

**Key takeaway:** Shared store, one key per caller, atomic script, TTL for cleanup, and an explicit fail-open or fail-closed decision.

---

## 8. Where to enforce

**Definition:** The enforcement point is the layer that checks the limit: client, edge (CDN or WAF), API gateway, service, or outbound client.

Cheap, coarse limits belong early; precise, business-aware limits belong late. The *key* matters as much as the layer: IP for anonymous traffic, user ID after login, API key for developer platforms, tenant for B2B.

### The problem

A team limits only by IP address at the gateway. A whole office behind one NAT gateway gets throttled together, while a botnet with 10,000 IPs sails through.

### Better design

```text
Client      -> backoff, debounce (advisory only, never trusted)
CDN / WAF   -> per IP, bot score: cheap rejection far from origin
API gateway -> per API key / user / route / plan tier
Service     -> business rules: "3 password resets per hour per account"
Outbound    -> partner quota: "SMS provider max 100 TPS"
```

Each layer uses the key it actually understands.

**Trade-offs:**
- More layers mean more configuration to keep consistent.

**Key takeaway:** Layer limits, and choose the key (IP, user, API key, tenant) that matches who you want to be fair to.

---

## 9. 429 and rate-limit headers

**Definition:** HTTP `429 Too Many Requests` tells a caller it exceeded its allowance; headers tell it when to try again.

A good response turns throttling into a conversation. The client learns its limit, what is left, and how long to wait.

### The problem

The server returns a bare `500` when limited. Clients treat it as a crash and retry immediately, all at the same moment, creating a retry storm that keeps them throttled.

### Better design

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1760012345
Content-Type: application/problem+json

{"title":"Rate limit exceeded","detail":"100 requests per minute on the Free plan"}
```

The client waits 12 seconds, then retries with exponential backoff plus random jitter so clients do not retry in lockstep. Send the remaining-quota headers on successful responses too, so good clients can pace themselves. (An IETF draft standardises these as `RateLimit` headers.)

**Key takeaway:** Always return 429 with `Retry-After`; clients must back off with jitter.

### 429 vs. 503

- **429:** *you* (this caller) sent too much. Other callers are fine.
- **503 Service Unavailable:** the *server* is overloaded or down, for everyone. Used by load shedding.
- Both can carry `Retry-After`.

---

## 10. Load shedding

**Definition:** Load shedding means deliberately rejecting some work when the server itself is over capacity, so the rest can still succeed.

Rate limits are fixed numbers, but capacity changes: a slow database or a bad deploy can halve it. A hospital emergency room does triage: when overwhelmed, it treats the critical cases first and asks others to wait.

### The problem

```text
Normal:   1,000 req/s x  50 ms latency =  50 requests in flight
DB slows: 1,000 req/s x 500 ms latency = 500 requests in flight
Thread pool size = 200  -> queue grows, every request times out
```

This is Little's Law: in-flight work equals throughput times latency. When latency rises, the server collapses even though the request rate never changed.

### Better design

```java
private final Semaphore inFlight = new Semaphore(150);

public Response handle(Request req) {
    if (!inFlight.tryAcquire()) {
        return Response.status(503).header("Retry-After", "2").build();
    }
    try { return process(req); }
    finally { inFlight.release(); }
}
```

A concurrency limit adapts automatically: when latency rises, fewer requests fit, and the extra ones fail fast instead of piling up. Go further by shedding by priority (drop analytics and recommendations before checkout and login), dropping requests whose deadline has already passed, and using adaptive limits (Netflix's concurrency-limits library, Envoy's adaptive concurrency filter) that raise or lower the cap based on observed latency.

**Trade-offs:**
- Some users get an error by design; you must decide which ones.
- Priority classes need to be tagged on requests up front.

**Key takeaway:** Limit concurrency, not just rate, and shed the least valuable work first with a fast 503.

---

## In an HLD interview

- **Rate Limiter:** token bucket or sliding window counter in Redis via a Lua script, rules cached from a config service, 429 with headers, fail-open policy, local pre-check for very high scale.
- **API Gateway:** per-API-key limits by plan tier, monthly quotas counted from usage events, concurrency limits per backend.
- **Notification System:** leaky-bucket queues per provider (APNs, email, SMS) and per-user caps ("max 3 marketing pushes a day").
- **BookMyShow / flash sales / Payment System:** a virtual waiting room is load shedding for humans; card attempts are limited fail-closed to stop card testing.
- **What to say:** "I'll use a token bucket per API key in Redis with an atomic Lua script, return 429 with Retry-After, and add a concurrency limit so the service sheds load with 503 if a dependency slows down."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Why limit | Fairness, abuse, cost, fragile dependencies | Who could overwhelm this system? |
| Token bucket | Refill rate `r`, burst `b` | Are short bursts acceptable? |
| Leaky bucket | Constant output rate | Does the downstream need smooth traffic? |
| Fixed window | One counter per window | Is a 2x edge burst harmless here? |
| Sliding log | Exact, one entry per request | Is the limit small and security-critical? |
| Sliding counter | Weighted previous + current | Do I need "N per minute" for millions of keys? |
| Redis + Lua | Atomic shared counter | What happens when Redis is down? |
| Where to enforce | Coarse early, precise late | Which key matches the fairness I want? |
| 429 + headers | Tell clients when to retry | Will clients back off with jitter? |
| Load shedding | Drop work when overloaded | What do I drop first? |

## Final memory aid

- **Token bucket:** default for APIs, bursts allowed
- **Leaky bucket:** smooth traffic into fragile dependencies
- **Fixed window:** cheap, 2x at the boundary
- **Sliding log:** exact, memory heavy
- **Sliding counter:** `prev x overlap + curr`
- **Distributed:** Redis + Lua, TTL, fail open or closed
- **Contract:** 429 + Retry-After; 503 for overload
- **Shedding:** concurrency limits and priorities

=== hld-probabilistic-ids | HLD | Unique IDs and probabilistic data structures ===
Almost every design needs unique IDs, and many need to answer "have I seen this?", "how many distinct?" or "how often?" over huge streams. The first problem is solved by ID schemes that avoid a central bottleneck, such as Snowflake and UUIDv7; the second by probabilistic structures that accept a small, known error in exchange for tiny memory. This chapter explains each option, what breaks without it, and when to use it.

## 1. Database auto-increment

**Definition:** The database assigns the next integer (1, 2, 3...) to each new row.

It is simple, compact (a 64-bit `BIGINT`) and naturally ordered. For a single-database system it is the right answer, so say so and move on.

### The problem

```text
Shard A: orders 1, 2, 3 ...
Shard B: orders 1, 2, 3 ...   <- duplicates once you shard
Public URL: /invoices/1001 -> try /invoices/1002 (enumeration)
```

Once you shard, each database counts on its own and IDs collide. Sequential IDs also leak business volume and invite people to guess other records.

### Better design

Keep auto-increment for internal tables in one database. For sharded or public-facing data, generate IDs outside the database with a scheme from the next sections. Never rely on "the ID is unguessable" as your only security; always check ownership too.

**Trade-offs:**
- Every insert depends on one database; it does not shard.

**Key takeaway:** Auto-increment is fine until you have more than one writer or the IDs are visible to users.

---

## 2. UUID v4 vs. v7

**Definition:** A UUID is a 128-bit ID that any server can generate without coordination; v4 is fully random, v7 starts with a timestamp.

UUIDv4 has 122 random bits, so collisions are practically impossible (you would need around 2^61 IDs for a 50% chance). UUIDv7 (RFC 9562, 2024) puts a 48-bit millisecond Unix timestamp first and fills the rest with random bits, so new IDs sort after old ones.

### The problem

```text
Primary key = UUIDv4 (random) in a B-tree index
insert 3f9a... -> lands in the middle of the tree
insert a07c... -> lands somewhere else
-> page splits, poor cache use, bigger index, slower writes
```

Random keys scatter inserts across the whole index. In MySQL InnoDB, where rows are physically stored in primary-key order, this hurts badly.

### Better design

```text
UUIDv7 = [ 48-bit ms timestamp ][ version ][ random ... ]
019a1c2e-7b10-7xxx-...   <- each new ID is larger than the last (roughly)
-> inserts append at the right edge of the index, like auto-increment
```

You keep coordination-free generation and gain ordering. PostgreSQL 18 has a built-in `uuidv7()`, and Java libraries such as `java-uuid-generator` support it. Store UUIDs as `uuid` or `BINARY(16)`, never `VARCHAR(36)`.

**Trade-offs:**
- 128 bits is twice the size of a `BIGINT`.
- UUIDv7 reveals the creation time to the millisecond.

**Key takeaway:** UUIDv7 is the modern default when 128 bits is acceptable; avoid UUIDv4 as a clustered primary key.

---

## 3. Ticket server (range allocation)

**Definition:** A central allocator hands out *blocks* of numbers (say 1,000 at a time), and each app server spends its block from memory.

It is like a bank giving each cashier a roll of numbered tickets rather than asking head office for every ticket. One network call per thousand IDs, and the IDs stay dense and short.

### The problem

A URL shortener calls a central counter on every create. At 10,000 creates per second the counter database is the bottleneck and a single point of failure.

### Better design

```sql
-- each app server grabs a range when its current block runs out
UPDATE id_ranges SET next_start = next_start + 1000
WHERE name = 'short_url'
RETURNING next_start - 1000 AS block_start;   -- serve block_start .. +999 locally
```

10,000 creates per second become 10 allocator calls per second. If a server restarts, its unused numbers are wasted, which is harmless. Flickr ran a ticket server for years on the same idea.

**Trade-offs:**
- IDs are only roughly time-ordered across servers.
- The allocator still needs high availability (for example two allocators handing out disjoint ranges).

**Key takeaway:** Range allocation gives dense, short numbers at scale; ideal for short codes.

---

## 4. Snowflake

**Definition:** Snowflake is Twitter's 64-bit ID that packs a timestamp, a worker ID and a per-millisecond sequence into one `long`.

Every worker generates IDs locally, so there is no network call, and IDs sort roughly by time.

### The problem

A chat service needs 64-bit, time-ordered message IDs from hundreds of servers. UUIDs are too big for its `BIGINT` columns, and a central counter is too slow.

### Better design

```text
| 1 bit | 41 bits                      | 10 bits    | 12 bits     |
| sign  | ms since custom epoch        | worker ID  | sequence    |
          2^41 ms ~ 69.7 years           1,024        4,096 per ms per worker
```

```java
long id = ((nowMs - EPOCH) << 22) | (workerId << 12) | sequence;
```

Each worker can produce 4,096 IDs per millisecond (about 4 million per second). `ORDER BY id DESC` replaces a timestamp index for "latest messages", and IDs double as pagination cursors. Instagram and Discord use similar layouts.

**Trade-offs:**
- **Clock going backwards** (NTP step, VM migration) can create duplicates. Wait out small drifts, refuse and alert on large ones.
- **Worker IDs must be unique** among live generators (assign via ZooKeeper/etcd, a Kubernetes StatefulSet ordinal, or a leased row). Two pods with the same worker ID silently create duplicates; this is the most common real failure.

**Key takeaway:** Snowflake gives compact, sortable, coordination-free IDs; guard the clock and the worker ID.

### Snowflake vs. UUIDv7

- **Snowflake:** 64 bits, fits `BIGINT`, needs worker ID assignment.
- **UUIDv7:** 128 bits, needs no setup at all.
- Both are time-ordered and index-friendly.

---

## 5. Base62 short codes

**Definition:** Base62 writes a number using the 62 characters `0-9a-zA-Z`, which keeps codes short and URL-safe.

Seven base62 characters give 62^7, about 3.5 trillion codes; six give about 56.8 billion. That covers any realistic URL shortener.

### The problem

```text
Snowflake ID 1849203381722013696 in base62 -> 11 characters (too long)
Sequential counter 1000, 1001, 1002 -> codes "g8", "g9", "ga" (guessable)
```

Big IDs make long codes, and plain counters let anyone walk through every short link.

### Better design

```java
static final char[] ALPHABET =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".toCharArray();

static String toBase62(long n) {
    if (n == 0) return "0";
    StringBuilder sb = new StringBuilder();
    while (n > 0) { sb.append(ALPHABET[(int) (n % 62)]); n /= 62; }
    return sb.reverse().toString();
}
```

Take a dense number from a range allocator, scramble it with a reversible shuffle (for example a small Feistel cipher) so codes are not sequential, then encode in base62. The alternative is to hash the long URL, take 7 base62 characters, and retry with a salt if the unique constraint reports a collision.

**Trade-offs:**
- Counter approach: no collisions, but the same URL gets different codes unless you add a lookup.
- Hash approach: the same URL gives the same code, but collisions grow as the table fills.

**Key takeaway:** Range allocator + scramble + base62 gives 7-character, collision-free, non-guessable codes.

---

## 6. Bloom filter

**Definition:** A Bloom filter is a bit array plus `k` hash functions that answers "is X in the set?" with either "definitely not" or "probably yes".

To add X, set the `k` bits its hashes point to. To check X, look at those bits: any 0 means definitely absent; all 1s means probably present. There are no false negatives, only false positives, and you cannot delete.

### The problem

A cache sits in front of a database. Attackers request millions of product IDs that do not exist. Every request misses the cache and hits the database (this is called **cache penetration**).

### Better design

```text
request id -> Bloom filter of all real product IDs
  "definitely not" -> return 404 immediately (no DB call)
  "probably yes"   -> cache -> DB as normal (about 1% of fakes slip through)
```

Sizing: about 9.6 bits per item and 7 hash functions give a 1% false-positive rate. One billion items need about 1.2 GB, far less than storing the keys themselves. Cassandra and RocksDB keep a Bloom filter per data file so reads skip files that cannot contain a key; web crawlers use one for "already seen this URL".

**Trade-offs:**
- False positives grow sharply once you insert more items than you sized for.
- No deletes (a counting Bloom filter or a cuckoo filter supports them, at more memory).

**Key takeaway:** Bloom filter = cheap "definitely not here" check in front of something expensive.

---

## 7. HyperLogLog

**Definition:** HyperLogLog (HLL) estimates how many *distinct* items a stream contains, in a fixed few kilobytes of memory.

The intuition: hash every item; a hash that starts with many zero bits is rare, so the longest run of leading zeros hints at how many distinct items you have seen. HLL keeps many such registers and averages them to reduce noise.

### The problem

"Unique viewers per video per day" for hundreds of millions of videos. An exact set of 8-byte user IDs for one popular video can be hundreds of megabytes, per video, per day.

### Better design

```text
PFADD viewers:vid42:2026-10-13 user_8812     # Redis HyperLogLog
PFCOUNT viewers:vid42:2026-10-13             # ~0.81% standard error
PFMERGE viewers:vid42:week d1 d2 d3 ...      # weekly uniques, no re-scan
```

Redis uses 16,384 registers in about 12 KB per key, with a standard error of about 0.81%, whether you count a thousand items or a billion. HLLs merge by taking the maximum of each register, so per-shard or per-day counts combine cheaply.

**Trade-offs:**
- It is an estimate; never use it where you need an exact count, such as "one free trial per user".

**Key takeaway:** HyperLogLog = distinct counts in 12 KB with under 1% error, and it merges.

---

## 8. Count-Min Sketch

**Definition:** A Count-Min Sketch estimates how often each item appears, using a small grid of counters with one hash function per row.

To add X, increment one counter per row. To read X, take the *minimum* across rows. Collisions only ever add, so the minimum is the least-polluted guess: it may overestimate, never underestimate.

### The problem

"Top 10 trending hashtags in the last hour" over billions of events. A counter per hashtag means millions of keys in memory, most of them seen once.

### Better design

```text
width w = ceil(e / eps), depth d = ceil(ln(1 / delta))
eps = 0.001, delta = 0.01  ->  w = 2,719, d = 5  (~13,600 counters, ~54 KB)
estimate <= true count + eps * N   with probability 1 - delta

per event: update sketch; if estimate beats the smallest in a top-K min-heap, push it
```

Keep one sketch per minute and sum the last 60 for "this hour". It is accurate for heavy hitters and meaningless for rare items.

| Structure | Question | Memory | Error |
|---|---|---|---|
| Bloom filter | Is X in the set? | ~10 bits per item for 1% | False positives only |
| HyperLogLog | How many distinct? | ~12 KB fixed | ~0.8% |
| Count-Min Sketch | How often did X occur? | `w x d` counters | Overestimates only |

**Trade-offs:**
- Approximate counts are not acceptable for billing; reconcile with an exact batch job.

**Key takeaway:** Count-Min Sketch + heap = top-K in fixed memory. Always state the exact solution first, then the approximation and its error.

---

## In an HLD interview

- **URL Shortener:** range allocator + scramble + base62 (7 characters), or hash with collision retry; a Bloom filter for "custom alias taken?".
- **Chat/WhatsApp, News Feed:** Snowflake IDs give time order, so `ORDER BY id` and ID cursors replace timestamp indexes.
- **Distributed Cache:** a Bloom filter in front of the database to stop cache penetration.
- **YouTube, Metrics, Logging/Monitoring:** HyperLogLog for unique viewers or users; Count-Min Sketch + heap for trending items, reconciled by a batch job.
- **What to say:** "I'll use UUIDv7 or Snowflake so IDs are generated without coordination and stay index-friendly; for unique counts I'd use HyperLogLog and accept under 1% error, since exact sets would cost hundreds of megabytes."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Auto-increment | DB hands out the next integer | Is there only one writer and are IDs private? |
| UUID v4 vs v7 | Random vs time-first 128-bit | Will random keys hurt my index? |
| Ticket server | Hand out blocks of numbers | Do I need dense, short numbers? |
| Snowflake | Time + worker + sequence in 64 bits | Who assigns worker IDs, and what if the clock jumps? |
| Base62 | 62 characters per digit | How many characters, and are codes guessable? |
| Bloom filter | "Definitely not" or "maybe" | What expensive lookup can I skip? |
| HyperLogLog | Distinct count in 12 KB | Is ~1% error acceptable? |
| Count-Min Sketch | Frequency, overestimates only | Am I tracking heavy hitters, not rare items? |

## Final memory aid

- **Single DB:** auto-increment is fine
- **No coordination, 128 bits:** UUIDv7, never v4 as a clustered key
- **64 bits, sortable:** Snowflake (41 time, 10 worker, 12 sequence)
- **Short codes:** range blocks + base62, 7 chars ~ 3.5 trillion
- **Membership:** Bloom filter, ~10 bits per item for 1%
- **Distinct count:** HyperLogLog, 12 KB, ~0.8%
- **Frequency / top-K:** Count-Min Sketch + heap
