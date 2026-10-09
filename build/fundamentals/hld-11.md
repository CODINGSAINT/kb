=== hld-rate-limiting | HLD | Rate limiting and load shedding ===
Rate limiting caps how much work a single caller can push into your system, while load shedding decides what to drop when the system as a whole is over capacity. Together they protect availability, enforce fair use between tenants and keep costs predictable. This chapter covers the five classic algorithms with their math, distributed enforcement with Redis and Lua, where limits belong, the client contract, and adaptive concurrency limits.

## Why limit at all
- **Abuse and attacks:** credential stuffing, scraping, brute-forcing OTPs, application-layer DDoS.
- **Fairness:** one noisy tenant must not starve the others in a multi-tenant SaaS.
- **Protecting dependencies:** a downstream payment provider or legacy mainframe may only accept 200 TPS no matter how many callers you have.
- **Cost control:** every request to an LLM API, SMS gateway or third-party geocoder costs money.
- **Commercial tiers:** free plans get 100 requests/minute, enterprise gets 10,000.

Two different questions hide here. *"Is this caller exceeding its allowance?"* is rate limiting (per key). *"Is the server itself overloaded right now?"* is load shedding (per resource). A healthy system needs both, because a thousand well-behaved callers can still overload you together.

## The five algorithms
### Token bucket
A bucket holds up to `b` tokens (burst capacity) and refills at `r` tokens per second. Each request removes one token (or `cost` tokens for expensive calls); if the bucket is empty, the request is rejected. You never run a timer: store `tokens` and `lastRefill`, and refill lazily on each request.

```
elapsed = now - lastRefill
tokens  = min(b, tokens + elapsed * r)
if tokens >= cost: tokens -= cost; allow
else: reject, retryAfter = (cost - tokens) / r
```
Long-run throughput is bounded by `r`, while a caller that was idle can burst up to `b` instantly. That matches how real clients behave (a page load fires 20 calls, then nothing), which is why AWS API Gateway, Stripe and most gateways default to it.

### Leaky bucket
Requests enter a FIFO queue of size `b` that drains at a constant rate `r`. Output is perfectly smooth, which is ideal in front of a dependency that cannot tolerate bursts (a printer, a legacy system, an SMTP relay). The cost is latency: bursts wait in the queue, and when it is full they are dropped. "Leaky bucket as a meter" (without the queue) is mathematically equivalent to a token bucket; "leaky bucket as a queue" is the shaping variant. NGINX `limit_req` is a leaky bucket with an optional `burst` queue.

### Fixed window counter
Key `user:42:202610091405` (the current minute), `INCR`, set `EXPIRE 60`, reject if count > limit. One counter, one round trip, trivially cheap. The flaw is the **boundary burst**: with a limit of 100/min, a client can send 100 at 12:00:59 and 100 at 12:01:00, which is 200 requests in two seconds. In the worst case a fixed window admits **2x the limit** in any rolling window.

### Sliding window log
Store the timestamp of every accepted request (a Redis sorted set with score = timestamp). On each request, remove entries older than `now - window`, count what remains, and admit if count < limit. It is exact, but memory is O(limit) per key: a limit of 10,000/hour across a million keys is ten billion entries. Use it only for low limits where precision matters, such as "5 login attempts per 15 minutes".

### Sliding window counter
Keep the fixed-window counts for the current and previous windows and weight the previous one by how much of it still overlaps the rolling window:

```
window = 60s, limit = 100
now is 15s into the current minute -> overlap of previous window = (60 - 15) / 60 = 0.75
estimate = prev_count * 0.75 + curr_count
           = 80 * 0.75 + 30 = 90  -> allow (90 < 100)
```
It assumes requests in the previous window were evenly spread, so it is an approximation, but Cloudflare measured it at well under 1% error against real traffic while using only two counters per key. It is the best general-purpose trade-off when you want "100 per minute" semantics without boundary bursts.

### Comparison
| Algorithm | Memory per key | Burst behaviour | Accuracy | Typical use |
|---|---|---|---|---|
| Token bucket | 2 numbers | Allows bursts up to `b` | Exact for its model | Public APIs, gateways (default choice) |
| Leaky bucket (queue) | Queue of size `b` | Smooths bursts into constant rate | Exact | Shaping traffic to a fragile dependency |
| Fixed window | 1 counter | Up to 2x at window edges | Poor at edges | Quotas, cheap coarse limits |
| Sliding log | O(limit) timestamps | None | Exact | Low limits: logins, OTPs |
| Sliding window counter | 2 counters | Very little | ~99% | High-volume per-user limits |

## A Java token bucket
A lock-free, thread-safe single-node implementation. Note the use of `System.nanoTime()` (monotonic) rather than wall-clock time, so an NTP adjustment never mints or destroys tokens.

```java
public final class TokenBucket {
    private final long capacity;          // b
    private final double refillPerNano;   // r per nanosecond
    private final AtomicReference<State> state;

    private record State(double tokens, long lastRefillNanos) {}

    public TokenBucket(long capacity, double tokensPerSecond) {
        this.capacity = capacity;
        this.refillPerNano = tokensPerSecond / 1_000_000_000d;
        this.state = new AtomicReference<>(new State(capacity, System.nanoTime()));
    }

    /** Returns 0 if allowed, otherwise the nanos to wait before retrying. */
    public long tryAcquire(int cost) {
        while (true) {
            State cur = state.get();
            long now = System.nanoTime();
            double refilled = Math.min(capacity,
                    cur.tokens() + (now - cur.lastRefillNanos()) * refillPerNano);
            if (refilled < cost) {
                return (long) Math.ceil((cost - refilled) / refillPerNano);
            }
            State next = new State(refilled - cost, now);
            if (state.compareAndSet(cur, next)) return 0;
            // lost the CAS race to another thread, retry with fresh state
        }
    }
}
```
For many keys, keep buckets in a Caffeine cache with `expireAfterAccess` so idle callers are evicted. In production you would usually use Bucket4j (supports local, Redis, Hazelcast and JCache backends) or Resilience4j `RateLimiter`, but interviewers like seeing that you know the lazy refill trick.

## Distributed rate limiting
With 50 gateway instances behind a load balancer, a per-instance bucket of 100/min actually allows 5,000/min. Counters must be shared, and the read-modify-write must be **atomic**, otherwise two instances read "99", both allow, and both write "100".

### Redis + Lua (atomic token bucket)
Redis executes a Lua script as a single atomic operation, so the refill-check-decrement sequence cannot interleave.

```lua
-- KEYS[1] = bucket key, ARGV: capacity, refill_per_sec, now_ms, cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local data   = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or capacity
local ts     = tonumber(data[2]) or now

tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000.0) * rate)
local allowed = 0
local retry_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_ms = math.ceil((cost - tokens) / rate * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
return { allowed, math.floor(tokens), retry_ms }
```
Design notes:
- **Time source:** pass `now` from the caller, or better call `redis.call('TIME')` inside the script so all gateways share one clock (requires script effects replication, the default since Redis 5).
- **Expiry:** the TTL equals the time to refill fully, so idle keys disappear on their own.
- **Sharding:** Redis Cluster shards by key hash; one key per caller spreads load naturally. Use hash tags (`{tenant42}:user7`) only if you need several keys in one script.
- **Latency:** one round trip (~0.3–1 ms in-region). Use `EVALSHA` to avoid re-sending the script.
- **Sliding window counter in Redis:** two `INCR`ed keys (`rl:42:{minute}` and the previous minute) read in the same script.

### Local + global hybrid
A Redis call on every request can be too expensive at 1M RPS, and Redis becomes a single point of failure. Options:
1. **Local pre-check:** each instance keeps a local bucket sized `limit / N` and only consults Redis when the local bucket is near empty. Accurate enough when traffic is evenly balanced.
2. **Token leasing:** an instance takes a batch of tokens (say 50) from the global bucket in one call and spends them locally. Fewer round trips, slight over-admission if the instance dies with unused tokens.
3. **Async sync:** count locally, push deltas to Redis every 100 ms, and read back the global total. Allows brief overshoot (bounded by sync interval × traffic), which is fine for fairness limits but not for hard billing limits.
4. **Sticky routing:** consistent-hash callers to gateway instances so each key lives on one node; no shared state needed until a node fails.

### Failure policy
Decide explicitly what happens when the limiter store is down:
- **Fail open** (allow traffic) for user-facing APIs where availability matters more than precision. Fall back to a conservative local bucket so you are not completely unprotected.
- **Fail closed** (reject) for limits that guard money or security: OTP sends, password attempts, paid third-party calls.

## Where to enforce
```
Client SDK ──> CDN / WAF ──> API Gateway ──> Service ──> Dependency client
 (backoff,     (per IP,       (per API key,    (per tenant,   (per downstream
  local         geo, bot       user, route,     per endpoint,  quota, e.g.
  throttle)     score)         plan tier)       concurrency)   Twilio 100 TPS)
```
| Layer | Good for | Limitations |
|---|---|---|
| Client | Good citizenship, smoothing retries | Untrusted; advisory only |
| Edge / CDN / WAF | Volumetric attacks, per-IP limits, cheap rejection far from origin | Knows little about users or tenants |
| API gateway | Per API key, user, route and plan; central config | Doesn't know the cost of each operation |
| Service | Business-aware limits ("3 password resets per hour"), per-endpoint costs | Request already consumed some resources |
| Outbound client | Respecting partners' quotas | Must queue or fail gracefully |

Layer them: cheap coarse limits early, precise business limits late.

### Choosing the key
- **IP address:** for anonymous traffic and login endpoints; beware NAT (a whole office or mobile carrier behind one IP) and IPv6 (limit per /64 prefix, not per address).
- **User ID:** after authentication; the fairest unit for consumer apps.
- **API key / client ID:** for developer platforms; tied to a billing plan.
- **Tenant / org:** for B2B SaaS, often combined with a per-user sub-limit so one script in a tenant can't consume the whole tenant allowance.
- **Composite:** `(tenant, endpoint)` with different limits for `GET /search` (cheap) and `POST /reports` (expensive). Some systems use **cost-based** limits where each request deducts its weight (GitHub GraphQL "points").

## The client contract
```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1760012345
Content-Type: application/problem+json

{"type":"https://api.example.com/errors/rate-limited","title":"Rate limit exceeded",
 "detail":"100 requests per minute allowed on the Free plan"}
```
- `429` is for "you, the caller, sent too much". `503 Service Unavailable` (with `Retry-After`) is for "the server is overloaded" (load shedding).
- The IETF `RateLimit-Policy` / `RateLimit` headers standardise the `X-RateLimit-*` family; mention either.
- Return remaining quota on *successful* responses too, so well-behaved clients can pace themselves.
- Clients must retry with **exponential backoff plus jitter**, honouring `Retry-After`; otherwise every throttled client retries in lockstep and you get a thundering herd.

## Quotas vs rate limits
| | Rate limit | Quota |
|---|---|---|
| Window | Seconds to minutes | Day, month, billing cycle |
| Purpose | Protect capacity, smooth bursts | Commercial entitlement, cost control |
| Storage | Fast, ephemeral (Redis, in-memory) | Durable (DB), auditable, often reconciled for billing |
| Exceeding | 429, retry shortly | 429/403 until reset or upgrade; notify the customer |
| Accuracy | Approximate is fine | Should be exact or reconciled |

A typical plan: "1,000 requests/minute burst limit and 5 million requests/month quota." Track the quota with counters aggregated from usage events (Kafka → aggregator → DB), not by hammering a DB row per request.

## Load shedding and adaptive concurrency
Rate limits are static numbers; overload is dynamic. A deploy, a slow database or a GC storm can drop capacity by half, and a fixed "1,000 RPS" limit no longer protects you.

### Concurrency limits beat rate limits for protection
Little's Law: `in-flight = throughput × latency`. If latency doubles at constant throughput, in-flight work doubles, threads and connections run out and the service collapses. Limiting **concurrent in-flight requests** (a semaphore) adapts automatically: when latency rises, fewer requests fit.

### Adaptive limits
Netflix's `concurrency-limits` library applies TCP congestion-control ideas to services: start with a limit, increase it additively while latency stays near the observed minimum, and cut it multiplicatively (AIMD) or by gradient when latency grows. Envoy's adaptive concurrency filter and gRPC's similar mechanisms do the same. The service finds its own capacity without hand-tuned numbers.

### Prioritised shedding
When you must drop, drop the least valuable traffic first:
1. Classify requests by **criticality**: `CRITICAL` (checkout, login), `DEFAULT`, `SHEDDABLE` (prefetch, analytics beacons, recommendations).
2. Under pressure, reject sheddable traffic at the edge with 503; keep critical traffic flowing.
3. Prefer rejecting **new** work over abandoning work already in progress (which wastes the resources already spent).
4. Drop requests whose **deadline has already passed** (propagated via a `grpc-timeout` or custom deadline header); the caller has given up, so serving them is pure waste.
5. Use **LIFO queueing** or a short bounded queue under overload: with FIFO, every request waits behind stale ones and all of them time out.

Google's SRE practice combines these with client-side **adaptive throttling**: clients track their own accept ratio and probabilistically drop requests locally before sending, so an overloaded backend doesn't even have to spend CPU rejecting them.

### Back-pressure
In asynchronous pipelines, the equivalent of shedding is back-pressure: bounded queues, Kafka consumer lag as a signal, reactive streams `request(n)`, and producers that slow down or spill to durable storage instead of growing memory without bound.

## Spring example: gateway limiting
Spring Cloud Gateway ships a Redis token bucket filter that runs a Lua script like the one above:

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: orders
          uri: lb://order-service
          predicates: [ Path=/api/orders/** ]
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 50     # r tokens/sec
                redis-rate-limiter.burstCapacity: 100    # b
                redis-rate-limiter.requestedTokens: 1
                key-resolver: "#{@apiKeyResolver}"
```
```java
@Bean
KeyResolver apiKeyResolver() {
    return exchange -> Mono.justOrEmpty(
            exchange.getRequest().getHeaders().getFirst("X-API-Key"))
        .switchIfEmpty(Mono.just(
            exchange.getRequest().getRemoteAddress().getAddress().getHostAddress()));
}
```
Inside a service, Resilience4j provides `@RateLimiter(name = "partnerApi")` for outbound calls and `@Bulkhead` for concurrency caps.

## Real-world systems
- **Stripe:** token bucket per account, plus concurrent-request limiters and a load shedder that reserves capacity for critical requests (charges over list calls).
- **GitHub:** 5,000 REST requests/hour per token; GraphQL uses a point-cost model; secondary limits on concurrency and content creation.
- **Cloudflare:** sliding window counter at the edge across hundreds of PoPs, with counts kept per data centre.
- **AWS API Gateway:** token bucket with account-level and per-method throttles plus usage-plan quotas.
- **Envoy:** local rate limit filter per proxy and a global rate limit service (gRPC, Redis-backed) for shared limits.

## How it shows up in interview problems
- **Design a rate limiter:** the whole chapter. Requirements (per user/IP/key, rules config, low latency, distributed), token bucket or sliding window counter in Redis via Lua, rules service with cached config, 429 headers, fail-open policy, hybrid local+global for scale.
- **API gateway:** per-key limits by plan, quotas from usage events, concurrency limits per backend.
- **URL shortener:** per-IP limits on creation to stop spam; reads are CDN-cached and barely limited.
- **Notification system:** outbound limits per provider (APNs, Twilio, SES) and per user ("max 3 marketing pushes per day"), with a leaky-bucket queue shaping sends.
- **Payments:** idempotency plus strict fail-closed limits on card attempts to block card testing.
- **BookMyShow / flash sales / seat reservation:** a virtual waiting room (queue with admission rate) is load shedding applied to humans.
- **Chat:** per-user message rate to fight spam; per-connection limits on the WebSocket gateway.
- **Search / autocomplete:** debounce on the client, per-user limits at the gateway, and shedding of low-priority suggestions under load.
- **LLM/AI platforms:** token-based (not request-based) limits per tenant, using cost-weighted buckets.

## Common pitfalls
- Non-atomic `GET` then `SET` in Redis, which allows races between instances.
- Using wall-clock time from every gateway, so skew changes the refill rate; use Redis `TIME` or monotonic local clocks.
- Fixed windows for strict limits (2x boundary burst).
- Limiting only per IP, which punishes NATed users and is trivially bypassed by botnets.
- Forgetting the failure mode when Redis is unreachable.
- Clients retrying immediately without jitter, turning a 429 into a storm.
- Static rate limits as the only overload protection; capacity changes, so add concurrency limits and shedding.
- Hot keys: one huge tenant's bucket on a single Redis shard; split with local leasing.

## Interview questions
1. **Token bucket vs sliding window counter: which and why?** Token bucket when bursts are acceptable and you want smooth average rate (most APIs); sliding window counter when you want "N per window" semantics with no boundary bursts. Both cost two numbers per key.
2. **Why does a fixed window allow 2x the limit?** A client can use the full limit at the end of one window and again at the start of the next, all within a short interval spanning the boundary.
3. **How do you make a distributed limiter atomic?** Run the read-refill-decrement in a single Redis Lua script (or use `INCR` semantics for counters), keyed per caller, with TTLs for cleanup.
4. **Redis adds 1 ms per request and is a SPOF. What now?** Local buckets with token leasing or periodic sync to a global store, accepting bounded overshoot; fail open with a conservative local fallback.
5. **What's the difference between 429 and 503?** 429: this caller exceeded its allowance. 503: the service is overloaded or unavailable regardless of caller. Both can carry `Retry-After`.
6. **How do you protect a service whose capacity varies?** Concurrency limits (Little's Law), adaptive limits that react to latency, deadline-aware dropping and priority-based shedding.
7. **Rate limit vs quota?** Rate limits are short-window capacity protection stored ephemerally; quotas are long-window entitlements stored durably and reconciled for billing.
8. **How would you rate-limit login attempts?** Per username and per IP (and per device fingerprint), sliding log with small limits, fail closed, exponential lockout, CAPTCHA after a threshold.

## Cheat sheet
- Token bucket (r, b): lazy refill, bursts allowed; default for APIs.
- Leaky bucket: constant output rate; shape traffic into fragile dependencies.
- Fixed window: cheap, 2x edge burst. Sliding log: exact, O(limit) memory. Sliding counter: `prev × overlap + curr`, ~99% accurate.
- Distributed: Redis + Lua, one key per caller, TTL = time to refill, Redis `TIME`.
- Scale: local + global (leases, async sync, sticky routing); decide fail open vs closed.
- Enforce in layers: edge (IP), gateway (key/plan), service (business), outbound (partner quotas).
- Contract: 429 + Retry-After + RateLimit headers; clients back off with jitter.
- Overload: concurrency limits, adaptive AIMD, shed by priority, drop expired deadlines, 503.

=== hld-probabilistic-ids | HLD | Unique IDs and probabilistic data structures ===
Almost every design needs globally unique identifiers, and many need to answer "have I seen this?", "how many distinct?" or "what is most frequent?" over enormous streams. The first problem is solved by ID schemes that avoid a central bottleneck, such as Snowflake and UUIDv7; the second by probabilistic structures that trade a small, quantifiable error for orders of magnitude less memory. This chapter covers both with the math you need to size them in an interview.

## What we want from an ID
- **Uniqueness** across all nodes, regions and time, without coordination on every ID.
- **Sortability:** roughly time-ordered IDs keep B-tree inserts at the right edge (no page splits), make "latest N" queries cheap and allow cursor pagination by ID.
- **Compactness:** 64-bit integers fit in a `BIGINT`, index well and are cheap to compare; 128-bit is acceptable; 36-character strings are wasteful.
- **Opacity:** sequential IDs leak business volume ("order 10,452 today, 10,980 tomorrow") and invite enumeration attacks (`/invoices/1001`, `/invoices/1002`).
- **Availability:** generating an ID should never require a network hop to a single server.

## The options
### Database auto-increment
Simple and dense, but the database becomes a bottleneck and single point of failure for writes, IDs are guessable, and sharding breaks it. Multi-master workarounds (`auto_increment_increment = 2`, offset 1 and 2) let two servers interleave odd and even IDs but make adding a third server painful. Fine for a single-database system; say so and move on.

### Ticket servers and range allocation
A central service (Flickr's ticket server used a MySQL `REPLACE INTO` trick) or a DB row hands out **blocks** of IDs: a node asks for 1,000 at a time (`UPDATE seq SET next = next + 1000 RETURNING next`) and serves them from memory. One network call per thousand IDs, dense integers, and the allocator can be made HA with two servers handing out disjoint ranges. Restarted nodes waste their unused block, which is harmless. This is the natural choice for URL shorteners that want short, dense codes.

### UUID v4 vs v7
| | UUIDv4 | UUIDv7 |
|---|---|---|
| Layout | 122 random bits | 48-bit Unix ms timestamp + 74 random bits (+ version/variant) |
| Ordering | Random | Time-ordered (k-sortable) |
| Index impact | Random inserts across the B-tree: page splits, poor cache locality, write amplification | Appends at the right edge, like auto-increment |
| Coordination | None | None |
| Leaks | Nothing | Creation time (millisecond) |
| Collision odds | Need ~2^61 IDs for a 50% chance | Per millisecond, 74 random bits; effectively never |

UUIDv7 (RFC 9562, 2024) is the modern default when 128 bits are acceptable: no coordination, sortable, and supported natively in PostgreSQL 18 (`uuidv7()`) and in libraries such as `java-uuid-generator`. ULID is the earlier equivalent with a Crockford base32 text form. Store UUIDs as `uuid`/`BINARY(16)`, never as `VARCHAR(36)`.

### Snowflake (64-bit, time-ordered)
Twitter's Snowflake packs an ID into a signed 64-bit long:

```
 0 | 41 bits: ms since custom epoch | 10 bits: worker ID | 12 bits: sequence
 ^sign  (~69.7 years of range)        (1024 workers)       (4096 IDs/ms/worker)
```
- 41 bits of milliseconds = 2^41 ms ≈ 69.7 years from your custom epoch (pick a recent epoch like 2024-01-01 to maximise range).
- 10 bits of worker ID = 1,024 generators; often split into 5 bits datacenter + 5 bits machine.
- 12 bits of sequence = 4,096 IDs per millisecond per worker, so about 4 million IDs/sec per worker.
- IDs are **k-sorted**: ordered by time across workers to within clock skew, and strictly increasing per worker.

Variants: Instagram uses 41 bits time + 13 bits logical shard ID + 10 bits per-shard sequence generated inside PostgreSQL; Discord and Mastodon use Snowflake-like IDs; Sonyflake uses 10 ms units and a 16-bit machine ID for longer life and more machines.

```java
public final class SnowflakeIdGenerator {
    private static final long EPOCH = 1704067200000L; // 2024-01-01T00:00:00Z
    private static final int WORKER_BITS = 10, SEQ_BITS = 12;
    private static final long MAX_WORKER = (1L << WORKER_BITS) - 1;
    private static final long SEQ_MASK = (1L << SEQ_BITS) - 1;
    private static final long MAX_BACKWARD_MS = 5;

    private final long workerId;
    private long lastMs = -1L;
    private long sequence = 0L;

    public SnowflakeIdGenerator(long workerId) {
        if (workerId < 0 || workerId > MAX_WORKER) throw new IllegalArgumentException("workerId");
        this.workerId = workerId;
    }

    public synchronized long nextId() {
        long now = System.currentTimeMillis();
        if (now < lastMs) {                         // clock moved backwards
            long drift = lastMs - now;
            if (drift > MAX_BACKWARD_MS) {
                throw new IllegalStateException("Clock moved back " + drift + " ms; refusing");
            }
            now = waitUntil(lastMs);                // small skew: wait it out
        }
        if (now == lastMs) {
            sequence = (sequence + 1) & SEQ_MASK;
            if (sequence == 0) now = waitUntil(lastMs + 1); // 4096 used this ms
        } else {
            sequence = 0;
        }
        lastMs = now;
        return ((now - EPOCH) << (WORKER_BITS + SEQ_BITS))
             | (workerId << SEQ_BITS)
             | sequence;
    }

    private long waitUntil(long targetMs) {
        long t = System.currentTimeMillis();
        while (t < targetMs) { Thread.onSpinWait(); t = System.currentTimeMillis(); }
        return t;
    }
}
```

### Clock skew and worker IDs
- **Clock going backwards** (NTP step, VM migration, leap-second smearing done badly) can produce duplicates. Strategies: wait if the drift is small; refuse and alert if large; or keep the "last timestamp" logical and keep incrementing from it (a hybrid logical clock style), accepting IDs that run slightly ahead of real time. Configure NTP/chrony to **slew** rather than step.
- **Persist the last timestamp** periodically so a restart after a clock reset can detect it.
- **Worker ID assignment** must be unique among live generators: static config, a ZooKeeper/etcd ephemeral sequential node, a Kubernetes StatefulSet ordinal, or a lease in Redis/DB with TTL. Two processes with the same worker ID will generate duplicates silently, which is the most common real failure.

### Comparison
| Scheme | Size | Sortable | Coordination | Notes |
|---|---|---|---|---|
| Auto-increment | 64 bit | Yes, dense | Every insert | Single DB only; guessable |
| Range allocation | 64 bit | Mostly | Once per block | Dense; great for short codes |
| UUIDv4 | 128 bit | No | None | Index fragmentation |
| UUIDv7 / ULID | 128 bit | Yes (ms) | None | Modern default when 128 bits is fine |
| Snowflake | 64 bit | Yes (k-sorted) | Worker ID assignment | Clock-skew sensitive; fits BIGINT |

## Short codes: base62 and URL shorteners
Base62 (`0-9a-zA-Z`) packs about 5.95 bits per character: 62^6 ≈ 56.8 billion codes, 62^7 ≈ 3.5 trillion. Seven characters cover any realistic shortener.

```java
private static final char[] ALPHABET =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".toCharArray();

static String toBase62(long n) {
    if (n == 0) return "0";
    StringBuilder sb = new StringBuilder();
    while (n > 0) { sb.append(ALPHABET[(int) (n % 62)]); n /= 62; }
    return sb.reverse().toString();
}
```
Two strategies:
| | Counter / range + base62 | Hash + handle collisions |
|---|---|---|
| How | Unique number (range allocator or Snowflake) encoded in base62 | `base62(first 43 bits of SHA-256(longUrl + salt))`, insert with unique constraint, retry with new salt on collision |
| Collisions | Impossible | Probability grows with fill (birthday bound) |
| Same URL → same code | No (unless you add a lookup) | Yes, naturally deduplicates |
| Predictability | Sequential codes are enumerable; scramble with a bijective shuffle (e.g. multiply by an odd constant mod 2^n, or Feistel cipher) | Unpredictable |
| Length | Grows slowly with count | Fixed |
A Snowflake ID in base62 is 11 characters, too long for a "short" URL, so shorteners usually use range allocation for dense counters.

## Probabilistic data structures
These answer questions about huge sets or streams in fixed, small memory, with bounded error. Always state the exact solution first, then the probabilistic one and its error.

### Bloom filter (membership)
A bit array of `m` bits and `k` independent hash functions. Insert: set the `k` bits at `h_i(x) mod m`. Query: if any of those bits is 0, the element is **definitely not** present; if all are 1, it is **probably** present. No false negatives, tunable false positives, no deletes.

**Math** (n elements inserted):
```
False positive rate      p ≈ (1 - e^(-k·n/m))^k
Optimal hash count       k = (m/n) · ln 2  ≈ 0.693 · m/n
Bits needed for target p m = -n · ln(p) / (ln 2)^2  ≈ 1.44 · n · log2(1/p)
```
| Target p | Bits per element (m/n) | Optimal k |
|---|---|---|
| 10% | 4.8 | 3 |
| 1% | 9.6 | 7 |
| 0.1% | 14.4 | 10 |
| 0.01% | 19.2 | 13 |

Example: 1 billion URLs at 1% false positives needs about 9.6 Gbit ≈ 1.2 GB, compared with ~50+ GB to store the URLs themselves. Each extra 4.8 bits per element divides the error by ten. In practice, use double hashing (`h_i = h1 + i·h2`) from one 128-bit Murmur3 hash rather than k separate hash functions. Guava provides `BloomFilter.create(Funnels.stringFunnel(UTF_8), 1_000_000_000L, 0.01)`; Redis has `BF.ADD`/`BF.EXISTS` in Redis Stack.

Bloom filters fill up: past the designed `n`, the error rate climbs sharply. Scalable Bloom filters chain new, larger filters as you grow.

### Counting Bloom filter and cuckoo filter
- **Counting Bloom filter:** replace each bit with a 4-bit counter; insert increments, delete decrements. Supports deletion at 4x memory, and counters can overflow.
- **Cuckoo filter:** stores short fingerprints (8–16 bits) in a cuckoo hash table with two candidate buckets per item. Supports deletion, has better lookup locality (two memory accesses), and uses less space than a Bloom filter for false positive rates below ~3%. Inserts can fail when the table is ~95% full, and deleting an item never inserted can remove someone else's fingerprint.

### HyperLogLog (count distinct)
Hash each element; the number of leading zeros in the hash is a clue to cardinality (seeing a hash starting with 20 zeros suggests roughly 2^20 distinct values). HLL splits hashes into `m = 2^p` registers by their first `p` bits and keeps the maximum leading-zero run per register, then combines them with a harmonic mean and bias correction.
- Standard error ≈ **1.04 / √m**. With p = 14 (16,384 registers of 6 bits ≈ 12 KB), error ≈ 0.81%.
- Memory is fixed regardless of whether you count a thousand or a trillion distinct items.
- **Mergeable:** the union of two HLLs is the register-wise max. Count daily uniques per shard, then merge for weekly and monthly uniques without re-reading data. (Intersections are not directly supported; inclusion-exclusion is noisy.)
- Redis: `PFADD visitors:2026-10-09 user42`, `PFCOUNT`, `PFMERGE`. BigQuery `APPROX_COUNT_DISTINCT`, Presto/Trino `approx_distinct`, Druid and ClickHouse all use HLL variants.

Exact alternative for comparison: a set of 100 million 8-byte user IDs is ~800 MB per day per metric; HLL is 12 KB.

### Count-Min Sketch (frequency)
A 2-D array of counters with `d` rows and `w` columns, one hash per row. Increment: add 1 at `(i, h_i(x))` for each row. Estimate: take the **minimum** across rows (collisions only add, so the min is the least-polluted estimate).
```
w = ceil(e / ε)      d = ceil(ln(1/δ))
estimate ≤ true + ε·N   with probability 1 - δ   (N = total count)
```
Example: ε = 0.001 and δ = 0.01 gives w = 2,719 and d = 5, about 13,600 counters (~54 KB with 32-bit counters) to track frequencies over any number of distinct keys. It **overestimates, never underestimates**, and is accurate for heavy hitters but meaningless for rare items (their true count is smaller than the error bound). Conservative update (only increment the rows that are at the current minimum) reduces overestimation.

### Top-K heavy hitters
- **Count-Min Sketch + min-heap of size K:** for each item, update the sketch, read its estimate, and push it into the heap if it beats the heap minimum. Memory: sketch + K entries.
- **Space-Saving / Misra-Gries:** keep exactly K counters; when a new item arrives and all counters are taken, replace the smallest and inherit its count + 1. Deterministic error bounds and very simple; used in many stream processors.
- **Time windows:** keep one sketch per minute and sum the last 60 for "trending in the last hour", or use exponentially decaying counts.
- **Distributed:** compute local top-K per partition (by key hash, so each key lives on one partition) and merge; or do a two-stage aggregation (approximate fast path, exact batch path later, the classic Lambda architecture for "top songs today").
- Redis Stack: `TOPK.ADD`, `TOPK.LIST` (HeavyKeeper algorithm), `CMS.INCRBY`.

### Comparison
| Structure | Question | Memory | Error | Deletes | Mergeable |
|---|---|---|---|---|---|
| Bloom filter | Is x in the set? | ~10 bits/item for 1% | False positives only | No | Yes (bitwise OR, same params) |
| Counting Bloom | Same, with removal | ~4x Bloom | False positives | Yes | Yes |
| Cuckoo filter | Same, with removal | Less than Bloom below 3% FP | False positives | Yes | No |
| HyperLogLog | How many distinct? | ~12 KB fixed | ~0.8% std error | No | Yes (register max) |
| Count-Min Sketch | How often did x occur? | `w × d` counters | Overestimates by ≤ εN | Possible with care | Yes (cell-wise sum) |
| Space-Saving | Top-K items | K counters | Bounded overcount | No | Approximately |

## Real-world systems
- **Cassandra, HBase, RocksDB, LevelDB:** a Bloom filter per SSTable so reads skip files that cannot contain the key.
- **Chrome Safe Browsing (historically):** a local Bloom-style prefix set of malicious URLs, confirming hits with the server.
- **Medium / feed systems:** Bloom filters of articles a user has already seen to avoid re-recommending them.
- **CDNs (Akamai):** a Bloom filter to cache an object only on its second request ("one-hit wonders" never pollute the cache).
- **Redis HyperLogLog** for unique visitors; **Google BigQuery / Druid** HLL++ for approximate distinct counts.
- **Twitter / X trends and network monitoring:** sketches for heavy hitters and top talkers.
- **Twitter Snowflake, Instagram, Discord:** 64-bit time-ordered IDs; **PostgreSQL 18, MongoDB ObjectId:** time-prefixed IDs.

## How it shows up in interview problems
- **URL shortener:** range allocator or counter + base62 (7 chars), or hash + collision retry; Bloom filter to check "custom alias taken?" before hitting the DB; scramble codes to stop enumeration.
- **Chat / news feed / tweets:** Snowflake IDs give time ordering, so `ORDER BY id DESC` replaces a timestamp index and IDs work as pagination cursors.
- **Distributed cache:** Bloom filter in front of the DB to stop **cache penetration** (repeated lookups of keys that don't exist).
- **Web crawler:** Bloom filter of seen URLs (billions) to avoid recrawling.
- **Metrics, analytics, tracking (ad clicks, YouTube views):** HLL for unique viewers per video per day; Count-Min Sketch for click counts per ad in real time, reconciled by a batch job.
- **Top-K (trending hashtags, top songs, heavy hitters in logs):** sketch + heap per window, merge across partitions.
- **Payments / e-commerce orders:** UUIDv7 or Snowflake order IDs created client- or service-side, doubling as idempotency keys.
- **Rate limiter / security:** Count-Min Sketch to detect abusive IPs among millions without a counter per IP.
- **Recommendation / notification:** Bloom filter of "already notified" or "already shown" per user.

## Common pitfalls
- Using UUIDv4 as a clustered primary key in MySQL InnoDB, causing random inserts and bloated indexes.
- Duplicate Snowflake worker IDs after autoscaling; no lease or registry.
- Ignoring clock rollback, especially on VMs and containers.
- Exposing sequential IDs in public URLs (enumeration and business-volume leaks).
- Sizing a Bloom filter for today's data and silently exceeding `n` next year.
- Trying to delete from a standard Bloom filter.
- Using a Count-Min Sketch for rare items, or presenting approximate counts where money is involved (billing must be exact).
- Forgetting HLL counts are estimates; never use them for "exactly one free trial per user".

## Interview questions
1. **Why not UUIDv4 as the primary key?** Random values scatter inserts across the B-tree, causing page splits, poor cache locality and larger indexes; UUIDv7 or Snowflake keeps inserts append-only.
2. **Explain the Snowflake bit layout and its limits.** 1 sign + 41 ms timestamp (~69 years) + 10 worker (1,024 generators) + 12 sequence (4,096/ms/worker); limits are clock skew, worker ID uniqueness and epoch exhaustion.
3. **How do you handle clocks moving backwards?** Wait out small drifts, refuse and alert on large ones, persist the last timestamp, slew NTP instead of stepping, or use a logical timestamp that never decreases.
4. **How many characters for a short URL?** Base62: 62^7 ≈ 3.5 trillion, so 7 characters covers 100 billion URLs with room to spare.
5. **Size a Bloom filter for 100 million items at 1% FP.** About 9.6 bits/item ≈ 960 Mbit ≈ 120 MB, with k = 7 hash functions.
6. **Count unique daily visitors across 50 servers?** HyperLogLog per server per day (12 KB each), merge with register-wise max; ~0.8% error. Exact would need a distributed set.
7. **Find the top 10 trending hashtags in the last hour.** Partition by hashtag, Count-Min Sketch + min-heap (or Space-Saving) per minute bucket, sum the last 60 buckets, merge per-partition top-K.
8. **Why can't a Bloom filter return false negatives?** A queried element's bits were all set when it was inserted and bits are never cleared, so all k bits are always 1 for inserted items.

## Cheat sheet
- Want sortable, compact, coordination-free: Snowflake (64-bit) or UUIDv7 (128-bit). Never UUIDv4 as a clustered key.
- Snowflake: 41 time | 10 worker | 12 seq; 4,096 IDs/ms/worker; guard clock rollback and worker ID uniqueness.
- Dense short codes: range allocator + base62; 7 chars ≈ 3.5T. Hash approach needs collision retry.
- Bloom: `m ≈ 1.44·n·log2(1/p)`, `k = 0.693·m/n`; ~10 bits/item for 1%; no false negatives, no deletes.
- Deletes needed: counting Bloom (4x) or cuckoo filter.
- HLL: count distinct in 12 KB, error 1.04/√m, mergeable.
- Count-Min: frequencies, `w = e/ε`, `d = ln(1/δ)`, overestimates only. Top-K: CMS + heap or Space-Saving.
- Always say the exact solution first, then the approximation and its error.
