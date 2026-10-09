=== hld-load-balancing | HLD | Load balancing ===
A load balancer (LB) distributes incoming traffic across multiple servers so no single instance is overwhelmed, detects and routes around unhealthy instances, and makes horizontal scaling and zero-downtime deploys possible. Almost every design diagram has one; knowing the layers, algorithms and failure behaviour lets you justify it in a sentence.

## Where load balancing happens
```
User ──DNS/GSLB──▶ Edge (CDN / anycast) ──▶ L7 LB / API gateway ──▶ service instances
                                                   │                 │
                                            internal LB / mesh ──▶ downstream services ──▶ DB proxies
```
1. **Global (DNS / GSLB):** chooses a region or datacenter by geography, latency or health (Route 53, Azure Traffic Manager, Cloudflare). It works through DNS answers or anycast.
2. **Edge / L7 at the front door:** terminates TLS and routes HTTP by host or path to services.
3. **Internal:** between services (internal LBs, client-side load balancing, service mesh sidecars).
4. **Data tier:** database proxies (PgBouncer, ProxySQL), Redis Cluster clients, Kafka partition assignment.

## L4 vs L7
| | Layer 4 (transport) | Layer 7 (application) |
|---|---|---|
| Sees | IPs, ports, TCP/UDP | HTTP method, path, headers, cookies, body |
| Routing | Per connection | Per request (path, host, header, weight) |
| TLS | Usually passes through (or terminates) | Terminates; can re-encrypt |
| Features | Very fast, high connection counts, protocol-agnostic | Retries, redirects, rewrites, auth hooks, caching, compression, canary routing |
| Examples | AWS NLB, IPVS, Maglev | AWS ALB, Nginx, Envoy, HAProxy (HTTP mode), Traefik |
| Use for | Raw TCP, WebSocket gateways at huge scale, non-HTTP protocols | Public HTTP APIs, microservice routing |

## Algorithms
| Algorithm | How it works | Best for | Watch out |
|---|---|---|---|
| Round robin | Next server in turn | Uniform servers and requests | Ignores current load |
| Weighted round robin | Proportional to weights | Mixed instance sizes, canaries (5% to v2) | Weights are static |
| Least connections | Server with the fewest active connections | Long-lived or variable requests | Needs connection tracking |
| Least outstanding requests / least response time | Fewest in-flight requests or lowest latency | Heterogeneous latency | Can herd onto a fresh instance |
| **Power of two choices (P2C)** | Pick two at random, choose the less loaded | Large fleets; avoids herding | Slightly random |
| IP hash | `hash(client IP) % N` | Crude stickiness | Breaks on N changes; NAT skews load |
| **Consistent hashing** (Maglev, ring hash) | Key → server, with minimal movement on changes | Cache affinity, sharded in-memory state | Hot keys still hot |

P2C with least-outstanding-requests is a strong modern default (Envoy, Linkerd, Netflix): almost as good as global least-loaded, without coordination.

## Health checking and failure handling
- **Active health checks:** the LB probes `/health` (or `/ready`) every N seconds and removes the instance after k failures.
- **Passive checks / outlier detection:** eject an instance that returns errors or high latency on real traffic, and re-admit it after a cool-down.
- **Liveness vs readiness:** liveness asks "should this process be restarted?"; readiness asks "should it receive traffic now?" (e.g. not until caches warm or migrations finish).
- **Connection draining:** on deploy or scale-in, stop new requests to an instance, let in-flight ones complete (e.g. 30 s), then terminate.
- **Retries:** an L7 LB can retry idempotent requests on another instance. Cap them with retry budgets to avoid retry storms.
- **Slow start:** ramp traffic gradually to new instances (JIT warm-up, cache fill).

## Session affinity (sticky sessions)
Stickiness routes a user to the same instance (cookie- or IP-based). It's sometimes needed for legacy stateful apps or WebSocket reconnection to the same node, but:
- Uneven load (heavy users pin to one instance).
- Failover loses the session state.
- Deploys and scale-in break sessions.
Preferred: **stateless services**, with session state in Redis or signed tokens. If affinity is needed for cache locality, use consistent hashing on a key (user or tenant ID) rather than cookies.

## Making the load balancer itself highly available
- Managed cloud LBs are distributed services with no single box.
- Self-managed: an active-passive pair sharing a virtual IP (keepalived/VRRP), or active-active behind DNS or ECMP routing.
- Anycast plus many edge nodes (how Cloudflare and Google's front ends work).

## TLS termination, security and extras at the LB
- Terminate TLS centrally (certificate management in one place), then re-encrypt to backends or rely on mTLS in a service mesh.
- WAF rules, bot protection, IP allow/deny lists, request size limits.
- Rate limiting per client or API key (often in an API gateway layer).
- Compression, response caching, HTTP/2 or HTTP/3 to clients.
- Request IDs and access logs for tracing.

## Load balancing long-lived connections
WebSockets, gRPC streams and database connections stay open for minutes or hours:
- Connection-count balancing (least connections) matters more than request balancing.
- Rebalancing after scaling out is slow, because existing connections don't move. Use connection max-age or periodic client reconnects with jitter.
- gRPC over HTTP/2 multiplexes many requests over one connection, so an L4 LB balances connections, not requests. Use L7 (Envoy) or client-side balancing for even request distribution.

## Client-side load balancing and service discovery
Instead of a central LB, clients fetch the instance list from a registry (Consul, Eureka, Kubernetes endpoints, DNS SRV) and choose an instance themselves (gRPC client LB, Spring Cloud LoadBalancer). That's one fewer hop and no central bottleneck, but logic lives in every client. Service meshes move this into sidecars.

## Typical interview usage
- "Clients hit an L7 load balancer (ALB/Envoy) that terminates TLS, routes `/api/*` to the API service and `/ws` to the WebSocket gateway tier, health-checks instances and drains them on deploy."
- "WebSocket gateways sit behind an L4 NLB because of the connection counts."
- "Inside the cluster, the service mesh does P2C least-request balancing with outlier ejection."

## Interview questions
1. **L4 or L7 for a REST API?** L7: path routing, TLS termination, retries, header-based canaries. L4 only if you need raw throughput or non-HTTP protocols.
2. **How do you deploy without dropping requests?** Readiness checks, connection draining, rolling or blue-green deployment, slow start.
3. **Why avoid sticky sessions?** Uneven load, lost state on failover, harder scaling. Externalise the session instead.
4. **How would you send 5% of traffic to a new version?** Weighted routing at the L7 LB or mesh (canary), with metrics-based promotion or rollback.

## Cheat sheet
```
Layers: DNS/GSLB → edge L7 (TLS, routing) → internal LB/mesh → data-tier proxies
L4 = fast, connection-level · L7 = request-aware routing, retries, TLS, canaries
Algorithms: RR/weighted · least conn/requests · P2C (great default) · consistent hashing (affinity)
Health: active + passive (outlier ejection) · readiness vs liveness · draining · slow start
Avoid sticky sessions → stateless + Redis/JWT; long-lived conns need max-age rebalancing
LB HA: managed, VRRP pair, anycast
```

=== hld-caching | HLD | Caching ===
Caching stores copies of frequently accessed data in faster storage, usually memory, closer to where it's needed. A well-placed cache cuts latency from milliseconds to microseconds and shields databases from load. It also introduces the classic hard problems: staleness, invalidation, stampedes and hot keys. Nearly every system design uses caching, and interviewers probe the details.

## Why caching works
Access patterns are skewed: a small fraction of keys (popular products, celebrity profiles, recent posts) receives most requests, often following a power law (the 80/20 rule or more extreme). Caching that hot set yields a high **hit ratio** and offloads most traffic.
**Effective latency** = hit_ratio × cache_latency + (1 − hit_ratio) × backend_latency. With a 95% hit ratio, 0.5 ms cache and 20 ms DB: 0.95 × 0.5 + 0.05 × 20 ≈ **1.5 ms** average, and the DB sees only 5% of reads.

## Cache layers
| Layer | Examples | Caches |
|---|---|---|
| Client | Browser HTTP cache, mobile app storage | Static assets, API responses with `Cache-Control` |
| CDN / edge | CloudFront, Cloudflare, Akamai | Static files, media, cacheable API responses |
| Reverse proxy / gateway | Nginx, Varnish | Full HTTP responses |
| Application (in-process) | Caffeine, Guava | Very hot, small, read-mostly data (config, feature flags) |
| Distributed cache | Redis, Memcached | Shared hot data, sessions, counters |
| Database | Buffer pool, query cache, materialised views | Pages, results |
Combining a **local in-process cache** (microseconds, per instance) with a **distributed cache** (sub-millisecond, shared) is a common two-level design for very hot keys.

## Caching strategies
### Cache-aside (lazy loading): the default
```
read:  value = cache.get(k); if miss → value = db.get(k); cache.set(k, value, ttl)
write: db.update(k, v); cache.delete(k)
```
- Pros: simple; caches only what's requested; a cache failure degrades to DB reads.
- Cons: the first read after expiry or delete is a miss; it can serve stale data until invalidated; there's a race (see below).
### Read-through
The cache library loads from the DB on a miss (the app talks only to the cache). Same semantics as cache-aside, with less app code.
### Write-through
Writes go to the cache and the DB synchronously (via the cache layer).
- Pros: the cache is always fresh for written keys.
- Cons: write latency includes both; it caches data that may never be read.
### Write-behind (write-back)
Write to the cache; flush to the DB asynchronously in batches.
- Pros: very fast writes; absorbs write bursts.
- Cons: **data loss** if the cache crashes before flushing; complex ordering. Use only with a durable cache or for data that tolerates loss (counters, analytics).
### Write-around
Write only to the DB; the cache fills on later reads. Good for write-heavy data that's rarely re-read soon (logs, bulk imports).
### Refresh-ahead
Proactively refresh popular keys before they expire, to avoid miss spikes.

## Invalidation: the hard part
> "There are only two hard things in computer science: cache invalidation and naming things."

### TTL (time to live)
Every entry expires after a period. It's simple and bounds staleness. Choose the TTL by how stale data may be (product description: hours; stock count: seconds or not cached). **Add jitter** (TTL ± 10%) so keys created together don't expire together.
### Explicit invalidation on write
After updating the DB, **delete** the cache key (don't update it). Why delete instead of set? Two concurrent writers can interleave their cache sets in the wrong order and leave an old value; deleting forces the next read to load fresh data.
### The cache-aside race
1. Reader A misses and reads the old value V1 from the DB.
2. Writer B updates the DB to V2 and deletes the cache key.
3. Reader A writes the stale V1 into the cache, where it stays until the TTL expires.
Mitigations: a short TTL as a backstop; **delayed double delete** (delete again after a short delay); versioned values (write only if newer); or **change-data-capture (CDC)** driven invalidation from the DB's log, which orders events correctly.
### Event-driven invalidation across services
When service A owns the data and service B caches it, A publishes change events (Kafka, or CDC via Debezium) and B invalidates. That keeps freshness without coupling.

## Eviction policies
When memory is full, something must go:
| Policy | Evicts | Good for |
|---|---|---|
| LRU (least recently used) | Oldest access | General purpose (the default choice) |
| LFU (least frequently used) | Least accessed | Stable popularity; resists scan pollution |
| FIFO | Oldest inserted | Simple, rarely optimal |
| TTL / volatile-only | Entries with expiry first | Mixed persistent and cache data |
| W-TinyLFU (Caffeine) | Frequency sketch plus recency | Excellent hit ratios in-process |
Redis supports `allkeys-lru`, `allkeys-lfu`, `volatile-ttl` and others, using approximate algorithms. Size the cache to hold the hot working set; monitor the hit ratio and evictions.

## Failure modes and fixes
### Cache stampede (thundering herd)
A hot key expires and thousands of concurrent requests miss and hit the DB at once.
- **Request coalescing / single flight:** only one request rebuilds; others wait for its result (a per-key lock in-process, or `SET lock NX PX` in Redis).
- **Stale-while-revalidate:** serve the stale value while one background request refreshes.
- **Probabilistic early expiration:** each read refreshes early with a probability that rises as expiry approaches.
- Never-expiring hot keys refreshed by a background job.
### Hot keys
One key (a celebrity, a flash-sale product) receives more traffic than one cache node can serve.
- Local in-process cache in front (even a 1-second TTL absorbs most of the load).
- Replicate the key: `key#1 … key#N` across nodes, picking a replica at random on reads.
- Read replicas of the cache shard.
### Cache penetration
Requests for keys that **don't exist** (maybe malicious) always miss and hit the DB.
- Cache the negative result ("not found") with a short TTL.
- A Bloom filter of existing keys to reject impossible lookups.
### Cache avalanche
Many keys expire at once, or the cache cluster restarts empty.
- TTL jitter; warm-up before taking traffic; rate-limit DB fallbacks; circuit breakers.
- Persistence or replication in Redis so a restart isn't a cold start.

## Distributed cache design
- **Partitioning:** consistent hashing (client-side, e.g. Memcached clients) or hash slots (Redis Cluster's 16,384 slots), so adding nodes moves only part of the keyspace.
- **Replication:** primary-replica per shard for failover and read scaling. Replication is asynchronous, so a failover can lose the latest writes.
- **Memcached vs Redis:** Memcached is a simple, multithreaded key-value cache. Redis offers rich data structures (hashes, sorted sets, streams), persistence, replication, Lua scripting and pub/sub.
- **Serialisation:** compact formats (Protobuf, Kryo) reduce memory and network use; beware of format changes across deploys (version your keys).

## What (not) to cache
Good candidates: read-heavy, expensive to compute, tolerant of brief staleness. Examples: user profiles, product pages, rendered fragments, session data, computed feeds, configuration.
Be careful with: rapidly changing data with strict correctness needs (balances, inventory counts at checkout). Read those from the source of truth, or use write-through with versioning, and use the cache only for display ("~3 left").

## Consistency stance in interviews
State it explicitly: "Product details are cache-aside with a 10-minute TTL and invalidation on update, so up to a few seconds of staleness. Inventory at checkout is read from the DB with a conditional decrement; the cached count is only for display."

## Interview questions
1. **Delete or update the cache on write?** Delete, to avoid concurrent writers leaving stale values; the next read repopulates it.
2. **How do you prevent a stampede on a viral post?** Single-flight rebuild, stale-while-revalidate, a local cache layer, and jittered TTLs.
3. **Your cache cluster restarts. What happens?** The miss storm hits the DB. Mitigate with warm-up, persistence/replicas, rate-limited fallback and circuit breakers.
4. **How do you cache personalised responses?** Cache the building blocks (per-user data and shared fragments) rather than whole pages, with keys including the user ID and `Cache-Control: private` at the HTTP level.

## Cheat sheet
```
Layers: client → CDN → proxy → in-process (Caffeine) → Redis/Memcached → DB buffer
Patterns: cache-aside (default) · read-through · write-through · write-behind (loss risk) · write-around · refresh-ahead
Invalidate: TTL (+jitter) · delete-on-write · CDC/events; beware cache-aside race
Evict: LRU default · LFU for stable popularity · TinyLFU in-process
Failures: stampede→single-flight/SWR · hot key→local cache/replicate · penetration→negative cache/Bloom · avalanche→jitter/warm-up
Say your consistency stance per data type
```
