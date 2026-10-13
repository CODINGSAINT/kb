=== hld-load-balancing | HLD | Load balancing ===
A load balancer sits in front of a group of servers and spreads incoming requests across them, so no single server is overwhelmed and a dead server stops receiving traffic. It is what makes "just add more servers" actually work. This chapter covers the two kinds of load balancer, the common algorithms, health checks, why sticky sessions cause trouble, global load balancing, and how to stop the load balancer itself from becoming the weak point.

## 1. What a load balancer does

**Definition:** A load balancer (LB) is a component that receives client traffic and forwards each connection or request to one of several healthy backend servers.

Think of the host at a busy restaurant. Guests do not pick a table and a waiter themselves; the host spreads them across sections and skips the section whose waiter has gone home. Clients only know one address (the LB), so you can add, remove or replace servers behind it without telling anyone.

### The problem

```text
Clients --> app-1 (single server, 2,000 req/s capacity)
Traffic at peak: 5,000 req/s
```

One server cannot take 5,000 requests per second. If you start a second and third server, clients still need to know which one to call, and when app-2 crashes they keep calling it.

### Better design

```text
                 +--> app-1 (healthy)
Clients --> LB --+--> app-2 (failed health check, skipped)
                 +--> app-3 (healthy)
                 +--> app-4 (healthy)
```

Clients call one stable address. The LB spreads 5,000 req/s over the healthy servers and quietly routes around app-2 until it recovers.

**Trade-offs:**
- One more network hop (usually well under a millisecond inside a data center).
- One more component that must itself be highly available (see section 9).

**Key takeaway:** A load balancer gives you one stable entry point, horizontal scaling and automatic failover in a single box on the diagram.

---

## 2. L4 vs. L7 load balancing

**Definition:** An L4 load balancer routes by network information (IP address and port); an L7 load balancer understands the application protocol, usually HTTP, and routes by path, host, headers or cookies.

The names come from the OSI network model: layer 4 is transport (TCP/UDP), layer 7 is application (HTTP). An L4 LB is like a mail sorter that reads only the postcode. An L7 LB opens the envelope and reads the letter, so it can make smarter choices but does more work per request.

### The problem

```text
One public domain: api.shop.com
  /api/orders/*   -> should go to order-service
  /api/search/*   -> should go to search-service
  /ws             -> should go to websocket-gateway
```

An L4 LB only sees "TCP connection to port 443". It cannot read the URL path, so it cannot send `/api/search` to a different service than `/api/orders`.

### Better design

```text
# L7 rules (Nginx / Envoy / AWS ALB style)
host api.shop.com, path /api/orders/*  -> order-service pool
host api.shop.com, path /api/search/*  -> search-service pool
header X-Canary: true                  -> order-service-v2 (canary)
TLS terminated at the LB; one certificate managed in one place
```

The L7 LB decrypts the request (TLS termination), reads it and routes per request. It can also retry failed requests, add request IDs and send a small slice of traffic to a new version.

### L4 vs. L7

- **L4** (AWS NLB, IPVS, Google Maglev): very fast, handles millions of connections, works for any TCP/UDP protocol, but routes per connection and cannot see inside.
- **L7** (AWS ALB, Nginx, Envoy, HAProxy in HTTP mode): routes per request by path or header, terminates TLS, retries and does canaries, but costs more CPU per request.
- A common layout uses both: L4 at the very edge for raw scale, L7 behind it for smart routing.

**Key takeaway:** Default to L7 for HTTP APIs; reach for L4 when you need raw connection scale or a non-HTTP protocol.

---

## 3. Round robin and weighted round robin

**Definition:** Round robin sends each new request to the next server in a fixed rotation; weighted round robin gives bigger servers a bigger share of the rotation.

Round robin is the simplest fair rule, like dealing cards one at a time around the table. It works well when servers are identical and requests cost about the same.

### The problem

```text
Pool: app-1 (16 cores), app-2 (4 cores), app-3 (4 cores)
Plain round robin: each gets 1/3 of 6,000 req/s = 2,000 req/s
app-2 and app-3 can each handle only ~1,000 req/s -> overloaded
app-1 can handle ~4,000 req/s                     -> half idle
```

Plain round robin assumes every server is the same size, so the small servers fall over while the big one sits idle.

### Better design

```text
Weights: app-1 = 4, app-2 = 1, app-3 = 1   (total 6)
app-1 gets 4/6 of 6,000 = 4,000 req/s
app-2 gets 1/6 of 6,000 = 1,000 req/s
app-3 gets 1/6 of 6,000 = 1,000 req/s
```

Weights match each server's capacity. The same trick gives you canary releases: weight 95 for v1 and 5 for v2 sends about 5% of traffic to the new version.

**Trade-offs:**
- Weights are static; they do not react if one server becomes slow.

**Key takeaway:** Round robin is the fine default for identical, stateless servers; weights handle mixed sizes and canaries.

---

## 4. Least connections

**Definition:** Least connections sends each new request or connection to the server that currently has the fewest active ones.

Round robin counts turns, not work. When some requests take 5 ms and others take 5 seconds, or connections stay open for hours (WebSockets), counting what is in flight right now is a much better signal of load.

### The problem

```text
WebSocket gateway pool, round robin by new connection
gw-1: 40,000 open connections (been up for 6 hours)
gw-2: 40,000 open connections
gw-3:      0 open connections (just added for scale-out)
Round robin still gives gw-3 only 1 in 3 new connections.
```

The new server stays nearly empty for hours while the old ones stay overloaded, because existing long-lived connections never move.

### Better design

```text
Least connections:
new connection -> gw-3 (0) -> gw-3 (1) -> gw-3 (2) ...
until gw-3 catches up with gw-1 and gw-2
```

New connections flow to the emptiest server until the pool is balanced. A close cousin, **power of two choices**, picks two servers at random and sends the request to the less loaded one; it is nearly as good and avoids every LB rushing to the same "emptiest" server at once (Envoy and Linkerd use it).

**Trade-offs:**
- The LB must track live connection counts per server.
- A brand-new server can get a sudden flood; "slow start" ramps it up gradually.

**Key takeaway:** For long-lived connections or very uneven request costs, balance by current load, not by turn.

---

## 5. Consistent hashing

**Definition:** Consistent hashing maps each key (such as a user ID) to a server in a way that, when servers are added or removed, only a small fraction of keys move to a different server.

Sometimes you want the same key to always reach the same server, because that server holds useful state in memory (a cache shard, a chat room). The naive way, `hash(key) % N`, breaks badly when N changes. Consistent hashing places servers and keys on a ring and gives each key to the next server clockwise.

### The problem

```text
Cache shards chosen by hash(userId) % N
N = 4 -> user 1001 lands on shard 1
Add one shard, N = 5 -> user 1001 now lands on shard 0
Roughly 80% of all keys change shard at once.
```

Adding a fifth cache node turns almost every lookup into a miss, and the database receives a flood of reads.

### Better design

```text
Ring: hash space 0 .. 2^32, each node placed at ~100 points
      ("virtual nodes") so load evens out
key -> walk clockwise -> first node point owns it
Add node E -> E takes over only the arcs just before its points
Keys that move: about 1/5 of the total (1/N), not 80%
```

Only the keys between the new node and its neighbours move. Virtual nodes keep the share per server roughly equal.

**Trade-offs:**
- A single very hot key still lands on one server; hashing cannot spread one key.

**Key takeaway:** Use consistent hashing when a key must stick to a server and the pool size changes.

---

## 6. Health checks and draining

**Definition:** A health check is a regular probe the LB sends (or a signal it reads from real traffic) to decide whether a server should receive requests.

**Active** checks call an endpoint such as `GET /health` every few seconds and remove the server after, say, 3 failures in a row. **Passive** checks (outlier detection) watch real responses and eject a server that returns too many errors. **Draining** means stopping new requests to a server while letting in-flight ones finish, used before shutting it down.

### The problem

```text
Deploy v2 to app-2:
t=0s   process killed
t=0s   LB still sends requests to app-2 -> connection refused
t=15s  health check finally fails 3 times -> app-2 removed
       ~15 s of errors for 1/4 of users
```

Killing a server before the LB knows means real users see errors until the next health checks notice.

### Better design

```text
1. Mark app-2 "draining": LB sends no NEW requests to it
2. Wait for in-flight requests to finish (e.g. up to 30 s)
3. Stop app-2, deploy v2, start it
4. LB polls GET /ready; only when it returns 200 (caches warm,
   DB pool open) does app-2 rejoin, ramped up slowly
```

Readiness (can it take traffic now?) is kept separate from liveness (should the process be restarted?). Users see no errors during the deploy.

**Key takeaway:** Health checks plus draining turn crashes and deploys into non-events for users.

---

## 7. Sticky sessions and why to avoid them

**Definition:** Sticky sessions (session affinity) make the LB send every request from one user to the same server, usually via a cookie or the client IP.

It is a workaround for servers that keep user state, such as a login session or a shopping cart, in their own memory. It works until that server goes away.

### The problem

```text
LB cookie pins Alice -> app-3
app-3 holds Alice's cart in memory (3 items)
app-3 crashes, or is scaled in at night
Next request -> LB picks app-1 -> cart is empty, Alice is logged out
Meanwhile: 20 heavy users pinned to app-1 -> app-1 at 95% CPU,
           app-4 at 10% CPU, LB is not allowed to move them
```

State is lost on failure, and load becomes uneven because users cannot be moved.

### Better design

```text
Stateless servers:
  session -> signed token (JWT) or Redis key "session:{id}"
  cart    -> Redis or the database
Any request -> any healthy server -> loads state from shared store
```

Every server can serve every request. A crash loses nothing, and the LB is free to balance load.

**Trade-offs:**
- An extra Redis call per request (well under 1 ms) or a slightly larger token.
- If you need locality for performance, use consistent hashing on a key, not cookie stickiness.

**Key takeaway:** Keep app servers stateless and put session state in a shared store; stickiness is a last resort.

---

## 8. Global load balancing: DNS and anycast

**Definition:** Global load balancing chooses which region or data center a user should reach, before any regional LB is involved.

Two main tools exist. **GeoDNS / latency-based DNS** (Route 53, Azure Traffic Manager) answers the same hostname with a different IP depending on the user's location or the region's health. **Anycast** announces the same IP address from many locations using BGP (the internet's routing protocol), so the network itself delivers each user to a nearby site; CDNs such as Cloudflare work this way.

### The problem

```text
All users -> api.shop.com -> one region: us-east
User in Mumbai: ~200-250 ms round trip per request
us-east has a full outage -> service down worldwide
```

One region means high latency for far-away users, and a single region-wide failure takes everyone down.

### Better design

```text
api.shop.com (latency-based DNS, health-checked, TTL 60 s)
  Mumbai user    -> ap-south   regional LB -> app pool
  Frankfurt user -> eu-central regional LB -> app pool
  ap-south unhealthy -> DNS answers with eu-central instead
```

Users reach a nearby region, and a dead region is removed from DNS answers.

**Trade-offs:**
- DNS failover is slow-ish: resolvers and clients cache answers for the TTL, and some ignore it.
- Anycast fails over in seconds through routing, but you need many sites and BGP control (or a provider that has them).
- Multi-region data replication is the hard part, not the routing.

**Key takeaway:** DNS or anycast picks the region; regional LBs pick the server.

---

## 9. The load balancer as a single point of failure

**Definition:** A single point of failure (SPOF) is any one component whose failure stops the whole system.

If all traffic flows through one LB machine, you have removed the SPOF from your app tier and moved it to the front door.

### The problem

```text
Clients -> lb-1 (one VM running Nginx) -> 10 app servers
lb-1 kernel panic -> 10 healthy app servers, 0 traffic
```

Ten healthy servers are useless if the one box in front of them dies.

### Better design

```text
Option A: managed cloud LB (ALB/NLB, GCP LB) - already spread
          across zones, no single machine to lose
Option B: self-managed pair sharing a virtual IP (keepalived/VRRP)
          lb-1 active, lb-2 passive; lb-1 dies -> lb-2 takes the
          IP within a few seconds
Option C: several active LBs behind DNS or anycast
```

Redundancy at the LB layer means losing one LB node costs seconds, not an outage.

**Key takeaway:** Always draw the LB as a redundant pair or a managed service, and say so.

---

## In an HLD interview

- **URL Shortener, News Feed, Amazon E-commerce:** an L7 LB in front of stateless app servers, round robin or least requests, health checks and draining for zero-downtime deploys.
- **Chat/WhatsApp, Ride Tracking:** long-lived WebSocket connections behind an L4 or L7 LB with least connections; mention client reconnects with jitter when gateways scale.
- **Distributed Cache, Rate Limiter:** consistent hashing so each key lands on the same node and adding nodes moves only a small slice of keys.
- **Netflix, YouTube, Google Search:** DNS or anycast for global routing to the nearest region or edge, then regional LBs.
- **API Gateway:** it is an L7 LB plus auth, rate limiting and routing; it must be redundant too.
- **What to say:** "Clients hit a managed L7 load balancer across zones that terminates TLS, routes by path, health-checks the stateless app servers and drains them on deploy; sessions live in Redis, so no sticky sessions."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Load balancer | One entry point spreading traffic | Who decides which server gets this request? |
| L4 vs. L7 | Route by connection vs. by request | Do I need to read the path or header? |
| Round robin / weighted | Rotate, scaled by capacity | Are my servers and requests uniform? |
| Least connections | Send to the least busy | Are connections long or costs uneven? |
| Consistent hashing | Key sticks to a node, few keys move | Does a key need the same server? |
| Health checks | Probe and eject, drain before stop | What happens to in-flight requests on deploy? |
| Sticky sessions | Pin user to server | Can I move this state to Redis or a token? |
| Global LB | DNS or anycast picks the region | How are far users and dead regions handled? |
| LB redundancy | No single LB box | What if the LB itself dies? |

## Final memory aid

- **L7 for HTTP, L4 for raw connections**
- **Round robin for equal servers, weights for unequal ones**
- **Least connections for long-lived connections**
- **Consistent hashing when a key must stick to a node**
- **Health checks + draining = invisible deploys**
- **Stateless servers beat sticky sessions**
- **DNS/anycast picks the region, the LB picks the server**
- **The LB itself must be redundant**

=== hld-caching | HLD | Caching ===
A cache keeps a copy of frequently read data in a faster place, usually memory, so most requests never reach the slower database. Done well, it cuts latency from tens of milliseconds to under one and shields the database from load. Done carelessly, it serves stale data, collapses under a stampede or melts on one hot key; this chapter covers where to cache, the main patterns, invalidation, eviction and these failure modes.

## 1. Why caching works and where to cache

**Definition:** A cache is a fast, smaller store holding copies of data whose source of truth lives somewhere slower.

Caching works because access is skewed: a small set of keys (popular products, celebrity profiles, today's posts) gets most of the reads. The **hit ratio** is the share of reads served from the cache. It is like keeping the ten books you use most on your desk instead of walking to the library each time.

### The problem

```text
Product page: 50,000 reads/s, each a 20 ms DB query
DB capacity: ~10,000 queries/s
Result: DB at 500% load, pages time out
```

The database is asked to answer the same popular questions thousands of times per second.

### Better design

```text
Hit ratio 95%, cache 0.5 ms, DB 20 ms
Average latency = 0.95 x 0.5 + 0.05 x 20 = ~1.5 ms
DB load = 5% of 50,000 = 2,500 queries/s  (fits easily)

Layers, nearest first:
browser -> CDN -> in-process cache -> Redis -> DB buffer pool
```

Most reads stop at the cache. You can cache at several layers; the closer to the user, the faster, but the harder to invalidate.

**Key takeaway:** Cache the hot, read-heavy, slightly-stale-is-fine data, as close to the reader as invalidation allows.

---

## 2. Cache-aside (lazy loading)

**Definition:** In cache-aside, the application checks the cache first; on a miss it reads the database and puts the result into the cache.

The application owns all the logic, and the cache only holds what was actually requested. This is the default pattern for most designs.

### The problem

```java
Product getProduct(long id) {
    return productRepo.findById(id);   // every call hits the DB
}
```

Every request, even for the same product a million times, costs a DB query.

### Better design

```java
Product getProduct(long id) {
    String key = "product:" + id;
    Product p = redis.get(key);
    if (p != null) return p;                       // hit
    p = productRepo.findById(id);                  // miss -> DB
    redis.set(key, p, Duration.ofMinutes(10));     // fill with TTL
    return p;
}

void updateProduct(Product p) {
    productRepo.save(p);
    redis.delete("product:" + p.id());             // invalidate
}
```

Only requested keys enter the cache, and if Redis is down the code can fall back to the DB.

**Trade-offs:**
- The first read after a miss is slow.
- Data can be stale until the key is deleted or expires.

**Key takeaway:** Cache-aside is the safe default: read cache, fall back to DB, fill, and delete on write.

---

## 3. Read-through and write-through

**Definition:** In read-through, the cache layer itself loads missing data from the database; in write-through, every write goes through the cache layer, which updates the database and the cache together.

The application only talks to the cache layer, which is configured with a loader and a writer. This keeps app code simpler and keeps written keys fresh in the cache.

### The problem

```text
Cache-aside in 12 services: each one re-implements
get -> miss -> load -> set, with slightly different TTLs and bugs.
After a write, a key is re-read from the DB on the next request.
```

Duplicated cache logic drifts, and freshly written data is not in the cache yet.

### Better design

```java
LoadingCache<Long, Product> cache = Caffeine.newBuilder()
    .maximumSize(100_000)
    .expireAfterWrite(Duration.ofMinutes(10))
    .build(id -> productRepo.findById(id));   // read-through loader

Product p = cache.get(42L);  // loads from DB on miss, automatically

// write-through: write DB and cache together
void save(Product p) { productRepo.save(p); cache.put(p.id(), p); }
```

The loader lives in one place. With write-through, a key is fresh in the cache right after it is written.

### Cache-aside vs. read-through

- **Cache-aside:** the app does the miss handling; most flexible.
- **Read-through:** the cache library does it; same behaviour, less code.
- **Write-through** adds write latency (DB plus cache) and may cache data nobody reads.

**Key takeaway:** Read-through and write-through move cache logic out of business code; the behaviour stays close to cache-aside.

---

## 4. Write-behind and write-around

**Definition:** In write-behind (write-back), the app writes only to the cache, and the cache flushes to the database later in batches; in write-around, writes go only to the database and the cache fills on later reads.

Write-behind is like jotting notes on a whiteboard and typing them up at the end of the day: very fast, but if someone wipes the board first, they are gone.

### The problem

```text
Video view counter: 200,000 increments/s
Each increment = UPDATE videos SET views = views + 1 WHERE id = ?
Row lock contention on popular videos, writes queue up
```

Writing every tiny update straight to the database overwhelms it.

### Better design

```text
INCR views:{videoId} in Redis           (microseconds)
Every 5 s a worker flushes:
  UPDATE videos SET views = views + :delta WHERE id = :id
200,000 writes/s -> a few thousand batched DB writes/s
```

The cache absorbs the burst and the database gets a few big writes instead of many small ones.

**Trade-offs:**
- If the cache node dies before flushing, those writes are lost. Use it only for data that tolerates loss (counters, analytics) or with a durable cache.
- Write-around suits data that is written often but rarely read soon after (logs, bulk imports).

**Key takeaway:** Write-behind trades durability for write speed; never use it for money or orders.

---

## 5. TTL and invalidation

**Definition:** TTL (time to live) makes a cache entry expire after a set time; invalidation removes an entry when the source data changes.

TTL bounds how stale data can get even if you forget to invalidate. Invalidation keeps data fresh right after a write. Use both: invalidate on write, with TTL as a safety net.

### The problem

```text
Two writers update price for product 42:
W1: DB price=100 ... cache.set(42, 100)
W2: DB price=120 ... cache.set(42, 120)
Network delays reorder the cache sets:
cache.set(42, 120) then cache.set(42, 100)
DB says 120, cache says 100 - until TTL expires (hours?)
```

Updating the cache on write lets concurrent writers leave an old value behind.

### Better design

```text
On write:  UPDATE DB; then DELETE cache key   (never SET)
On read:   miss -> load latest from DB -> set
TTL:       10 min +/- 10% random jitter (backstop, and keys
           created together do not all expire together)
Cross-service: owner publishes change events (Kafka / CDC with
           Debezium) -> other services delete their copies
```

Deleting forces the next reader to load the current value. One rare race remains: a slow reader loads the old value, a write deletes the key, then the reader stores the old value. A short TTL, a second delayed delete, or versioned values close that gap.

**Key takeaway:** Delete on write, keep a jittered TTL as a backstop, and pick the TTL by how stale each data type may be.

---

## 6. Eviction: LRU vs. LFU

**Definition:** Eviction decides which entry to remove when the cache is full; LRU removes the least recently used entry, LFU removes the least frequently used one.

Memory is finite, so something must go. The policy decides whether "hot" means "used lately" or "used often".

### The problem

```text
Cache holds 1M entries, LRU policy
A nightly report scans 5M rarely-used products once each
Every popular product is pushed out by one-time scan entries
Next morning: hit ratio drops from 95% to 30%
```

A one-off scan pollutes an LRU cache because recency alone looks like popularity.

### Better design

```text
Redis:    maxmemory-policy allkeys-lfu   (approximate LFU)
Caffeine: default W-TinyLFU (frequency sketch + recency window)
Popular products keep high frequency counts and survive the scan.
```

Frequency-aware policies keep the truly popular keys. LRU is still a fine default for most workloads without big scans.

### LRU vs. LFU

- **LRU:** simple, adapts fast to new trends, but is fooled by scans.
- **LFU:** resists scans and suits stable popularity, but is slower to forget old favourites (real implementations decay counts over time).

**Key takeaway:** Size the cache for the hot working set, start with LRU, and switch to LFU-style when scans or stable popularity matter.

---

## 7. Cache stampede (thundering herd)

**Definition:** A stampede happens when a popular key expires and many concurrent requests miss at the same moment and all hit the database to rebuild it.

It is like a shop opening its doors and everyone rushing the single till at once.

### The problem

```text
Key "home:feed" read 20,000 times/s, rebuild query takes 300 ms
t=0 key expires
t=0..300 ms: ~6,000 requests miss and all run the 300 ms query
DB CPU spikes to 100%, queries slow down, more requests miss
```

Thousands of identical rebuilds run at once, and the database can collapse.

### Better design

```text
Single-flight rebuild with a short Redis lock:
  miss -> SET lock:home:feed <token> NX PX 5000
    got lock  -> rebuild, SET home:feed, release lock
    no lock   -> serve stale copy, or wait ~50 ms and re-read
Plus: stale-while-revalidate (serve old value, refresh in background)
Plus: jittered TTLs; very hot keys refreshed by a background job
```

Only one request rebuilds; everyone else gets the old value or the new one moments later.

**Key takeaway:** One rebuild per key, never thousands; serve stale while refreshing.

---

## 8. Hot keys

**Definition:** A hot key is a single cache key that receives more traffic than one cache node can handle.

Hashing puts each key on one node, so a celebrity profile or flash-sale product sends all its reads to one machine, however big the cluster.

### The problem

```text
Redis Cluster, 10 nodes, each ~100,000 ops/s
Key "product:iphone-launch": 400,000 reads/s -> all on node 7
Node 7 saturated; every other key on node 7 slows down too
```

Adding nodes does not help because one key cannot be split by hashing.

### Better design

```text
1. Local in-process cache (Caffeine) with a 1-2 s TTL in each app
   server: 100 app servers -> Redis sees only ~50-100 reads/s
2. Or replicate the key: product:iphone-launch#0 .. #9 on different
   nodes; readers pick a random suffix, writers update all copies
```

The local cache absorbs nearly all reads, and replicas spread what remains.

**Key takeaway:** Fix hot keys with a short local cache in front, or by copying the key across nodes.

---

## 9. Cache penetration

**Definition:** Cache penetration is a flood of lookups for keys that do not exist, so they always miss the cache and always hit the database.

Since there is nothing to cache, the normal pattern never fills the cache. This can be a bug or an attacker probing random IDs.

### The problem

```text
GET /users/987654321   (no such user)
cache miss -> DB query -> no row -> nothing cached
Bot repeats with random IDs at 30,000 req/s -> all reach the DB
```

The cache gives zero protection for keys that do not exist.

### Better design

```text
1. Negative caching: DB returns nothing -> SET user:987654321 "NULL"
   with a short TTL (e.g. 60 s)
2. Bloom filter of all existing user IDs in memory: "definitely
   not present" -> return 404 without touching cache or DB
   (false positives possible, false negatives impossible)
3. Rate-limit and validate ID format at the edge
```

Repeat misses stop at the cache, and impossible IDs never reach it.

**Key takeaway:** Cache "not found" too, and use a Bloom filter for large ID spaces.

---

## 10. Consistency stance

**Definition:** A consistency stance is your explicit statement of how stale cached data may be, decided per data type.

A cache in front of a database is eventually consistent by nature. Interviewers want to hear that you know which data can be a bit stale and which must not be.

### The problem

```text
Checkout reads stock from cache: "2 left" (cached 5 minutes ago)
Real DB stock: 0
Order accepted -> oversold, refund and angry customer
```

Using a cached value for a correctness decision breaks business rules.

### Better design

```text
Product description, images : cache-aside, TTL 1 h, delete on edit
Price on product page        : TTL 1 min, delete on edit
Stock on product page        : cached, shown as "Only a few left"
Stock at checkout            : DB with a conditional update
  UPDATE stock SET qty = qty - 1 WHERE sku = ? AND qty >= 1
```

Display data may be stale; decisions that move money or inventory go to the source of truth.

**Key takeaway:** Say out loud which data may be stale and for how long, and keep correctness checks on the database.

---

## 11. Redis vs. local cache

**Definition:** A local (in-process) cache lives inside each application instance's memory; a distributed cache such as Redis is a separate shared server all instances use.

Local is like a notepad on each desk: instant, but every desk has its own copy. Redis is a shared whiteboard: one truth for everyone, but you have to walk over to it.

### The problem

```text
User profile cached in Caffeine on each of 50 app servers
User changes their name -> server 3 deletes its local copy
Other 49 servers keep the old name until their TTL expires
```

Local caches drift apart, and invalidating 50 copies is hard.

### Better design

```text
Shared data that changes   -> Redis (one copy, delete on write)
Tiny, very hot, rarely changing (config, feature flags)
                           -> local cache, short TTL
Very hot keys              -> two levels: local (1-2 s) -> Redis -> DB
```

Each kind of data goes to the layer whose staleness it can accept.

### Redis vs. Memcached

- **Memcached:** simple, multithreaded key-value cache only.
- **Redis:** rich types (hashes, sorted sets, counters), TTLs, replication, optional persistence, Lua scripts and pub/sub; Redis Cluster splits keys over 16,384 hash slots.

**Key takeaway:** Redis for shared, changing data; local cache for tiny, hot, mostly-static data; both levels for extreme hot keys.

---

## In an HLD interview

- **URL Shortener, Amazon E-commerce:** cache-aside in Redis for short-code lookups and product pages; delete on write; a long TTL for short links that never change.
- **News Feed, Netflix:** precomputed feeds or home rows cached per user; stampede protection on celebrity posts and a local cache for hot keys.
- **Rate Limiter, Distributed Cache:** Redis counters with TTLs, consistent hashing across nodes, LRU or LFU eviction.
- **BookMyShow, Payment System, Seat Reservation:** cache show listings and seat maps for display, but confirm seats and payments against the database.
- **What to say:** "Product data is cache-aside in Redis with a 10-minute jittered TTL and delete-on-write, so staleness is seconds at most; stock at checkout is read from the database with a conditional update."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Where to cache | Hot reads, close to the reader | Which layer can I invalidate safely? |
| Cache-aside | App reads cache, falls back to DB | Is this my default read path? |
| Read/write-through | Cache layer loads and writes | Do I want the logic out of my code? |
| Write-behind | Write cache, flush later | Can I afford to lose these writes? |
| TTL and invalidation | Delete on write, TTL backstop | How stale may this data be? |
| Eviction | LRU or LFU when full | Do scans or stable favourites matter? |
| Stampede | One rebuild per key | What if this hot key expires now? |
| Hot keys | Local cache or key replicas | Can one node handle this key? |
| Penetration | Misses for keys that do not exist | What if someone asks for fake IDs? |
| Consistency stance | Stale for display, DB for decisions | Does this read drive money or stock? |
| Redis vs. local | Shared vs. per-instance | How many copies must I invalidate? |

## Final memory aid

- **Cache-aside by default; delete, never set, on write**
- **Every key gets a TTL, with jitter**
- **Write-behind only for data you can lose**
- **LRU by default, LFU when scans pollute**
- **Stampede: single-flight plus serve-stale**
- **Hot key: local cache in front, or replicate the key**
- **Missing keys: negative cache or Bloom filter**
- **Stale is fine for display, never for decisions**
