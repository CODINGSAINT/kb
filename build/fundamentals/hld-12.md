=== hld-geo | HLD | Geospatial indexing and location services ===
"Drivers within 2 km" and "restaurants near me" are two-dimensional proximity questions, and a normal database index on latitude and longitude answers them badly. The trick is to turn 2-D space into 1-D keys (geohash, S2, H3) or a spatial tree (quadtree, R-tree), so a nearby search becomes a few key lookups plus an exact distance filter. This chapter explains each index, then shows how a ride-hailing app ingests millions of moving locations and matches riders to drivers.

## 1. Why lat/long range queries are hard

**Definition:** A proximity query asks for all points within some distance of a location; it needs locality in *both* dimensions at once.

A B-tree index sorts by one key. It is like a phone book sorted by surname: great for "all Sharmas", useless for "everyone living on my street". One degree of latitude is about 111 km everywhere, but one degree of longitude is `111 km x cos(latitude)`, about 108 km in Bengaluru and 71 km in London, so a "plus or minus 0.01 degree" box is not even square.

### The problem

```sql
-- index on (lat, lon)
SELECT * FROM drivers
WHERE lat BETWEEN 12.95 AND 12.99
  AND lon BETWEEN 77.58 AND 77.62;
```

The index narrows latitude well, but every row in that latitude band, across the whole city width, must then be checked for longitude. In a city with a million points, that band can be 100,000 rows to return 50.

### Better design

```text
2-D point -> cell ID (one key that keeps nearby points close together)
query: "which cells cover my 2 km circle?" -> fetch those few cells
       -> exact distance filter on a small candidate list
```

Spatial indexes preserve locality in both dimensions, so the database reads only nearby candidates.

**Key takeaway:** Say "a B-tree only narrows one dimension, so I'll map 2-D space to cells" before naming any specific index.

---

## 2. Geohash

**Definition:** Geohash splits the world in half again and again (alternating longitude and latitude) and writes the result as a base-32 string; a longer string means a smaller cell.

Each extra character divides the cell into 32 smaller ones. Points that share a longer prefix are usually close, so a plain string column with a normal index can answer "everything in this cell" as a prefix or range scan.

### The problem

You want a "restaurants within about 1 km" search in a key-value store that has no spatial index at all.

### Better design

```text
Length | Cell size (approx, at equator) | Use
  5    | 4.9 km x 4.9 km                | sparse areas, coarse search
  6    | 1.2 km x 0.6 km                | ~1 km nearby search
  7    | 153 m x 153 m                  | neighbourhood, precise matching
```

```sql
-- geohash6 column with an ordinary B-tree index
SELECT id, lat, lon FROM restaurants WHERE geohash6 = 'tdr1w2';
```

Store the geohash next to each point and query by prefix. Any database or key-value store can do this.

**Trade-offs:**
- Fixed precision: pick the length that matches your search radius.
- Cells are rectangles, and they distort near the poles.

**Key takeaway:** Geohash turns location into a string prefix that any ordinary index can search.

---

## 3. The geohash neighbour problem

**Definition:** Two points a few metres apart can sit on opposite sides of a cell boundary and have completely different geohashes.

At some boundaries even the first character differs (for example across the equator or the prime meridian). Prefix similarity implies closeness, but closeness does not imply prefix similarity.

### The problem

```text
+-------------+-------------+
|   cell W    |   cell X    |    R  = rider, near the left edge of cell X
|             |             |    D1 = driver inside cell X, 900 m away
|        D2 . | . R      D1 |    D2 = driver in cell W, only 30 m away
+-------------+-------------+
```

Searching only the rider's own cell returns D1 and misses D2, who is far closer but sits just across the border.

### Better design

```text
+------+------+------+
|  NW  |  N   |  NE  |
+------+------+------+     1. choose a cell size >= search radius
|  W   |  me  |  E   |     2. fetch me + 8 neighbours (9 cells)
+------+------+------+     3. compute exact distance, filter, sort
|  SW  |  S   |  SE  |     4. too few results? use one character less
+------+------+------+
```

Neighbour cells are cheap to compute from the geohash itself, so this is nine lookups, not a scan.

**Key takeaway:** Always search the cell plus its 8 neighbours, then filter by real distance.

---

## 4. Quadtree

**Definition:** A quadtree is a tree where each node covers a rectangle and splits into four children when it holds too many points (say more than 100).

Dense areas get many small cells, empty areas get a few big ones, so every leaf holds a similar number of points. A busy city centre and a quiet village both return a sensible number of candidates.

### The problem

A fixed geohash grid at 1 km gives 5,000 restaurants per cell in central Mumbai and zero in rural areas. "Find the nearest 20" is slow in one place and needs many widening steps in the other.

### Better design

```text
              [ India ]
        /      |      |      \
      NW      NE     SW      SE
              /  |  |  \             split only where points > 100
            ...  [Mumbai centre: tiny leaves]  ...
```

Build the tree in memory on each search server from the places table (for example nightly), descend to the user's leaf, and expand to neighbouring leaves until you have K results. Hundreds of millions of places fit in tens of gigabytes across a few machines.

**Trade-offs:**
- Moving objects that update every few seconds cause constant splits and merges, so quadtrees suit places that rarely move (restaurants, hotels), not drivers.
- Custom in-memory code rather than a database feature.

**Key takeaway:** Quadtree adapts to density; ideal for a mostly static "nearby places" index.

---

## 5. S2 and H3

**Definition:** S2 (Google) and H3 (Uber) are hierarchical cell systems that cover the whole globe and give every cell a 64-bit integer ID.

**S2** projects the Earth onto the six faces of a cube and numbers cells along a Hilbert curve (a space-filling curve that keeps nearby cells close in ID order), with levels 0 to 30. It can cover any circle or polygon with a handful of cells, which makes it good for delivery zones and geofences. **H3** tiles the world with hexagons at 16 resolutions; a resolution-9 hexagon is roughly 0.1 square km.

### The problem

Surge pricing needs "demand vs supply per area". With square cells, a cell has 4 edge neighbours and 4 corner neighbours at different distances, so smoothing demand into neighbouring areas is uneven.

### Better design

```text
     __    __
  __/  \__/  \     every hexagon has 6 neighbours, all at the same distance
 /  \__/  \__/     gridDisk(cell, 1) = me + 6 neighbours
 \__/  \__/  \     gridDisk(cell, 2) = next ring (19 cells in total)
    \__/  \__/
```

Count riders and drivers per H3 cell, smooth over rings, and price per cell.

**Trade-offs:**
- H3's parent-child hierarchy is approximate (a hexagon cannot be split exactly into smaller hexagons); S2 is better for exact region coverings.
- Both need a library rather than a plain string prefix.

**Key takeaway:** S2 for exact coverings of shapes; H3 hexagons for uniform neighbours and aggregation such as surge and heat maps.

---

## 6. Redis GEO and PostGIS

**Definition:** Redis GEO stores points in a sorted set scored by a 52-bit geohash; PostGIS adds spatial types and R-tree-style (GiST) indexes to PostgreSQL.

They are the two off-the-shelf answers. Redis is fast and in memory for live, moving points; PostGIS is rich and durable for shapes, zones and static places.

### The problem

A team writes every driver ping into PostGIS. At a million updates per second the database falls over, while the data being written is overwritten four seconds later anyway.

### Better design

```text
# Live driver positions in Redis (Redis 6.2+)
GEOADD drivers:blr 77.5946 12.9716 driver:881
GEOSEARCH drivers:blr FROMLONLAT 77.60 12.97 BYRADIUS 2 km ASC COUNT 20 WITHDIST
```

```sql
-- Static zones in PostGIS: which delivery zone contains this address?
SELECT zone_id FROM delivery_zones
WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint(77.209, 28.613), 4326));
```

Use the right store for each job: Redis for "where is everyone right now", PostGIS for polygons, geofences and places that change slowly.

**Trade-offs:**
- Redis GEO has no per-member expiry, so stale drivers need a separate heartbeat key or sweeper; one key per city can become huge, so shard by city or cell.
- PostGIS does not scale to millions of writes per second.

**Key takeaway:** Redis GEO for moving points, PostGIS for shapes and static data.

---

## 7. Driver location updates at scale

**Definition:** Location ingestion is the pipeline that takes a ping from every active driver every few seconds and keeps a fresh, searchable index of current positions.

The key insight is that a driver's *current* position is short-lived data: it is replaced every few seconds. It belongs in memory, not in a transactional database.

### The problem

```text
5,000,000 active drivers / one ping every 4 s = 1,250,000 writes/s
each ping ~100 bytes                          = ~125 MB/s
INSERT each one into a relational DB          -> overloaded, and 99% is overwritten
```

### Better design

```text
Driver app --(WebSocket / gRPC stream)--> Location gateway (stateless, per region)
                                               |
                                               v
                              Kafka "driver-locations" (partitioned by city/cell)
                               /                                   \
              Location index service                         Cold path: trails to
              (in-memory cell -> drivers, per city shard)     data lake for ETA training,
                                                              disputes and analytics
```

Only move a driver between cell buckets when they cross a cell boundary (most pings stay in the same cell). Store `lastSeen` with each entry and drop drivers silent for 15-30 seconds, so ghost drivers vanish. If an index node dies, it rebuilds from the live stream within seconds, because everyone pings again shortly.

**Trade-offs:**
- In-memory state is lost on crash; acceptable because it refills from the next pings.
- Hot spots (airports, stadiums) need finer cells or extra replicas.

**Key takeaway:** Current location lives in memory, sharded by city then cell; history flows to cheap storage asynchronously.

---

## 8. Nearby search and matching

**Definition:** Matching finds candidate drivers near a rider, ranks them, and assigns exactly one driver with an atomic lock.

Straight-line distance only shortlists. A river or a one-way street can turn 500 m into 4 km, so ranking uses ETA (estimated time of arrival over the road network).

### The problem

Two riders request at the same moment. Both searches return driver 881 as nearest, both send an offer, and the driver gets two trips.

### Better design

```text
1. rider cell -> gridDisk(cell, 1 or 2) -> candidate drivers
2. filter: available, right vehicle type, lastSeen < 15 s
3. rank top N by ETA (routing engine), rating, acceptance chance
4. lock:  SET driver:881:offer trip:9 NX PX 15000   (only one wins)
5. offer for ~15 s; decline/timeout -> release, try next driver
6. accept -> create trip in the DB, stream driver location to rider
```

`NX` means "set only if the key does not exist", so only one trip can claim the driver; `PX 15000` makes the lock expire if nobody answers.

**Trade-offs:**
- Greedy nearest-driver is simple; batching requests over a 1-2 second window can match the whole area better but adds a little delay.

**Key takeaway:** Shortlist by cells, rank by ETA, and claim the driver with an atomic, expiring lock.

---

## In an HLD interview

- **Uber / Ride Tracking:** WebSocket pings, Kafka by city, in-memory cell index, re-index on cell change, TTL for stale drivers, ETA ranking, atomic offer lock.
- **Yelp / nearby places:** geohash or quadtree built offline, 9-cell search, results cached, ranked by distance and rating.
- **Food delivery:** delivery zones as polygons (PostGIS or S2 coverings), couriers tracked like drivers, ETA includes food prep time.
- **Notification System / Metrics:** geo-targeted pushes and heat maps by H3 cell.
- **What to say:** "Current positions live in memory sharded by city and cell; I search the rider's cell plus neighbours, filter by freshness, rank by ETA, and lock the chosen driver with SET NX and a timeout."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Why it is hard | B-tree narrows one dimension | Am I scanning a whole latitude band? |
| Geohash | Location as a string prefix | Which length matches my radius? |
| Neighbour problem | Close points, different prefixes | Did I search all 9 cells? |
| Quadtree | Split where dense | Do my points move often? |
| S2 / H3 | Global cells, 64-bit IDs | Do I need shape coverings or uniform hexagons? |
| Redis GEO / PostGIS | Moving points vs shapes | Is this live data or static data? |
| Location ingestion | Memory, not a DB per ping | What happens to a driver who stops pinging? |
| Matching | Cells -> ETA -> atomic lock | Can two riders get the same driver? |

## Final memory aid

- **1 degree latitude ~ 111 km;** longitude shrinks with cos(latitude)
- **Geohash:** 6 chars ~ 1.2 km, 7 chars ~ 150 m
- **Always** search the cell plus 8 neighbours
- **Quadtree** for static places, **H3** for aggregation, **S2** for shapes
- **Redis GEO** for live drivers, **PostGIS** for zones
- **Pings:** memory + Kafka, never one DB insert each
- **Match:** shortlist by cell, rank by ETA, lock with NX + expiry

=== hld-observability | HLD | Observability and resilience patterns ===
In a distributed system something is always partly broken, so the real questions are how fast you notice, how quickly you find the cause, and how small you keep the damage. Observability (logs, metrics, traces and SLOs) answers the first two; resilience patterns (timeouts, retries, circuit breakers, bulkheads, fallbacks, health checks and canary releases) answer the third. Each idea below comes with a failure scenario and the fix.

## 1. Logs, metrics and traces

**Definition:** Metrics are cheap numeric time series, logs are detailed event records, and traces show one request's path across services.

Think of a hospital: metrics are the vital-signs monitor (heart rate, at a glance), traces are the patient's journey through departments, and logs are the doctor's detailed notes. Metrics tell you *that* something is wrong, traces tell you *where*, logs tell you *why*.

### The problem

Checkout is slow. The team has only unstructured text logs on 40 pods. Engineers SSH into machines and `grep` for an hour before realising the slowness is in a downstream inventory call.

### Better design

```text
Metrics (Prometheus/Micrometer): checkout p99 jumped from 300 ms to 2 s at 14:05  -> alert
Trace (OpenTelemetry):           checkout 2.1 s = inventory call 1.9 s            -> where
Logs (JSON, searchable):         inventory: "connection pool exhausted"           -> why
```

Log JSON, not prose, so fields can be searched. OpenTelemetry is the vendor-neutral standard for producing all three, with a Java agent that instruments Spring, JDBC and Kafka without code changes.

**Trade-offs:**
- Logs are expensive at volume; sample successful requests and keep all errors.
- Traces are usually sampled, so a rare slow request might not be kept.

**Key takeaway:** Metrics detect, traces locate, logs explain.

---

## 2. Correlation IDs

**Definition:** A correlation ID (trace ID) is a unique ID created at the edge for each request and passed along to every service and log line it touches.

It is like a courier tracking number: every depot scans the same number, so you can follow one parcel end to end.

### The problem

```text
gateway   ERROR timeout calling order-service
order-svc ERROR payment failed
payment   ERROR card declined
(which of these 10,000 errors per minute belong to the same customer request?)
```

Without a shared ID, the logs from different services cannot be joined.

### Better design

```json
{"ts":"2026-10-13T14:05:12Z","level":"ERROR","service":"payment-service",
 "traceId":"4bf92f3577b34da6a3ce929d0e0e4736","orderId":"o_99172",
 "event":"charge_failed","errorCode":"card_declined","latencyMs":842}
```

The gateway creates the ID and sends it in the W3C `traceparent` header (and in Kafka record headers for async hops). Each service puts it into the logging MDC so every log line carries it. Search one `traceId` and you see the whole story.

**Key takeaway:** Every request gets one trace ID at the edge, and every log line carries it.

---

## 3. Golden signals

**Definition:** The four golden signals are latency, traffic, errors and saturation: the minimum set to watch for any service.

**Saturation** means how "full" a resource is: queue depth, thread-pool usage, consumer lag. Two related checklists: **RED** (Rate, Errors, Duration) per service and **USE** (Utilisation, Saturation, Errors) per resource such as a connection pool.

### The problem

A team watches only CPU and memory. A bug makes the cart service return `200 OK` with an empty cart. CPU looks perfect, and nobody notices until sales drop.

### Better design

```text
Per service:   requests/s, error ratio, p50/p95/p99 latency
Per resource:  DB pool in use / max, Kafka consumer lag, queue depth
Business:      orders per minute, payment success rate
```

Business metrics catch "successful" failures that technical metrics miss.

**Key takeaway:** Watch latency, traffic, errors and saturation per service, plus one or two business metrics.

---

## 4. Percentiles

**Definition:** The p99 latency is the value that 99% of requests are faster than; it describes the slow tail that averages hide.

If 99 requests take 50 ms and one takes 5 s, the average is about 100 ms and looks fine, while 1 user in 100 waits 5 seconds.

### The problem

```text
Page calls 100 backends in parallel. Each backend: p99 = 1 s, usually 20 ms.
Chance at least one backend is slow = 1 - 0.99^100 = ~63%
-> most page loads are slow, while every backend's average looks healthy
```

Also wrong: averaging the p99 of 20 pods. Percentiles cannot be averaged.

### Better design

Export **histograms** (counts per latency bucket), add the buckets up across pods, then compute the percentile:

```text
histogram_quantile(0.99,
  sum by (le) (rate(http_server_requests_seconds_bucket[5m])))
```

In Spring Boot, enable `percentiles-histogram` for `http.server.requests`. Use route templates such as `/orders/{id}` as labels, never raw IDs, because every unique label value creates a new time series.

**Key takeaway:** Alert on p95/p99 from merged histograms, never on averages or averaged percentiles.

---

## 5. SLI, SLO and error budget

**Definition:** An SLI is a measured ratio of good events, an SLO is the target for it, and the error budget is the failure the SLO allows.

Example: SLI = "share of checkout requests that succeed in under 300 ms"; SLO = 99.9% over 30 days. The error budget is 0.1%: about 43 minutes of total outage, or 1 bad request in 1,000. An **SLA** is the external contract with penalties, set looser than the SLO.

### The problem

Product wants to ship daily; operations wants to freeze releases because "stability matters". The argument repeats every week with no data.

### Better design

```text
SLO 99.9% over 30 days -> budget ~43 min
Budget left   -> ship features normally
Budget burning 14x faster than allowed for 1 hour -> page someone
Budget spent  -> freeze risky releases, fix reliability first
```

The budget turns an opinion fight into a shared rule. Page on symptoms (users failing), not causes (CPU at 85%).

**Trade-offs:**
- Picking the wrong SLI (measured at the server, not near the user) hides real pain.

**Key takeaway:** SLO = target, error budget = 1 - SLO; spend it on shipping, stop when it runs out.

---

## 6. Timeouts

**Definition:** A timeout is the maximum time a caller waits for a response before giving up.

Many HTTP clients wait forever by default. A call with no timeout holds a thread until the other side answers, which may be never.

### The problem

```text
Tomcat threads: 200
Inventory service hangs; calls have no timeout
-> after a few seconds all 200 threads are stuck waiting
-> checkout, login, health checks: all stop responding
```

One hung dependency takes down a healthy service.

### Better design

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(500))
        .build();
HttpRequest req = HttpRequest.newBuilder(URI.create("http://inventory/stock/42"))
        .timeout(Duration.ofSeconds(1))      // based on the dependency's p99.9 + margin
        .build();
```

Better still, pass a **deadline**: if the user request has 2 s in total and 1.5 s is used, the next call gets at most 0.5 s.

**Key takeaway:** Every network call gets a timeout shorter than the caller's own.

---

## 7. Retries with backoff and jitter

**Definition:** A retry repeats a failed call; backoff waits longer after each attempt, and jitter adds randomness to the wait.

Retries fix brief glitches, but done badly they multiply load exactly when a service is struggling.

### The problem

```text
Gateway retries 3x -> Service A retries 3x -> Service B retries 3x -> DB
One DB failure = 3 x 3 x 3 = 27 calls to the DB
All clients retry at exactly 100 ms -> synchronised waves of traffic
```

### Better design

```text
retry only: timeouts, connection resets, 503   (never 400s)
retry only: idempotent calls, or calls with an idempotency key
retry at ONE layer, max 2-3 attempts
sleep = random(0, min(cap, base * 2^attempt))   <- exponential backoff + full jitter
```

Retrying a non-idempotent payment without an idempotency key can charge a customer twice.

**Trade-offs:**
- Retries add latency; keep them inside the overall deadline.

**Key takeaway:** Retry transient failures on idempotent calls, at one layer, with backoff and jitter.

---

## 8. Circuit breaker

**Definition:** A circuit breaker watches calls to a dependency and, when too many fail, stops calling it for a while and fails fast instead.

Like a household fuse: when something is wrong, it trips, protecting the rest of the house, and you try again later.

### The problem

The payment provider is down. Every checkout waits the full 2-second timeout and then fails. Threads pile up, and the provider gets hammered while trying to recover.

### Better design

```text
            failure rate >= 50% (over last 50 calls)
 CLOSED  ------------------------------------------> OPEN  (fail fast, use fallback)
   ^                                                  |
   | trial calls succeed                              | after 10 s
   |                                                  v
   +------------------------------------------- HALF_OPEN (let 5 trial calls through)
                         trial calls fail -> back to OPEN
```

```yaml
resilience4j.circuitbreaker.instances.payment:
  slidingWindowSize: 50
  failureRateThreshold: 50
  slowCallDurationThreshold: 800ms
  waitDurationInOpenState: 10s
  permittedNumberOfCallsInHalfOpenState: 5
```

Callers fail in microseconds instead of seconds, and the dependency gets room to recover. Counting slow calls catches degradation before outright failure.

**Key takeaway:** Closed -> open -> half-open: fail fast while a dependency is sick, probe gently to recover.

### Circuit breaker vs. retry

- **Retry** bets the failure is brief and tries again.
- **Circuit breaker** decides the failure is not brief and stops trying for a while.
- Use both: retries inside, and the breaker stops retries once it opens.

---

## 9. Bulkhead

**Definition:** A bulkhead gives each dependency its own limited pool of threads or connections, so one slow dependency cannot use up everything.

Ships have watertight compartments: one flooded section does not sink the ship.

### The problem

A slow recommendation service holds all 200 shared Tomcat threads. Checkout, which never calls recommendations directly but shares the threads, stops working too.

### Better design

```java
@Bulkhead(name = "recommendations")              // maxConcurrentCalls: 20
public List<Product> recommend(String userId) { ... }
```

```text
Thread budget: recommendations max 20 | inventory max 40 | payment max 40 | rest free
```

Recommendations can use at most 20 concurrent calls; the 21st is rejected immediately and the page shows a fallback.

**Key takeaway:** Isolate resources per dependency so one failure stays in its own compartment.

---

## 10. Fallbacks and graceful degradation

**Definition:** A fallback is the planned alternative response when a dependency fails: cached data, a default, or a feature switched off.

Decide per feature what "degraded but working" looks like, before the incident.

### The problem

The personalised recommendations service fails, and the whole home page returns an error, even though the catalogue and cart work fine.

### Better design

```text
Recommendations down -> show "popular items" from cache
Reviews down         -> hide the reviews section
Price service slow   -> show last cached price; checkout re-validates
Payment provider down -> accept order as PENDING, charge async, email later
```

Never fall back to a lie on correctness-critical paths: a payment must never be "assumed successful".

**Key takeaway:** Degrade features, not the whole product, and never fake correctness.

---

## 11. Health checks

**Definition:** Health checks are endpoints the platform polls: **liveness** asks "is this process stuck and in need of a restart?", **readiness** asks "can it take traffic right now?".

Kubernetes restarts a container that fails liveness and removes a pod from the load balancer while it fails readiness.

### The problem

```text
liveness probe = "can I reach the database?"
DB has a 30-second blip -> every pod fails liveness
-> Kubernetes restarts the whole fleet at once -> full outage, cold caches
```

A dependency hiccup becomes a self-inflicted outage.

### Better design

```text
/actuator/health/liveness   -> only internal state (app not deadlocked)
/actuator/health/readiness  -> warm-up done, can serve; may include critical local deps
```

Spring Boot exposes both groups. Liveness never checks downstream services.

**Key takeaway:** Liveness restarts, readiness removes from traffic; keep dependencies out of liveness.

---

## 12. Canary releases

**Definition:** A canary release sends a small share of traffic to the new version first and widens it only if its metrics stay healthy.

Most outages come from changes, so the release process itself is a resilience mechanism. Like miners' canaries, the small group warns you before everyone is affected.

### The problem

Version 2.31 is rolled out to all pods at once. It has a bug that fails 5% of checkouts. Every customer is affected within minutes, and rollback takes 20 minutes.

### Better design

```text
1% traffic -> compare error rate and p99 with the old version for 10 min
  healthy  -> 5% -> 25% -> 100%
  worse    -> automatic rollback (Argo Rollouts, Flagger)
```

Only 1% of users see the bug, for minutes. Pair with feature flags (deploy code dark, switch on separately) and treat config changes the same way.

**Trade-offs:**
- Needs good metrics and traffic splitting; database changes must work with old and new code (expand, migrate, then contract).

**Key takeaway:** Release to a few, measure, then widen; automate the rollback.

### Canary vs. blue-green

- **Blue-green:** two full environments, switch all traffic at once, instant rollback, double capacity.
- **Canary:** shift traffic gradually while comparing metrics, limiting the blast radius.

---

## In an HLD interview

- **Every design:** close with "what I'd monitor" (golden signals, p99, consumer lag, cache hit ratio) and "how it fails" (timeouts, breakers, fallbacks).
- **Payment System:** idempotent retries, a circuit breaker per provider with failover to a second provider, never fall back to "success".
- **Netflix / YouTube / News Feed:** bulkhead the recommendation call and degrade to popular content from cache.
- **Logging/Monitoring and Metrics systems:** agents -> Kafka -> processors -> hot and cold storage, histograms, label cardinality limits, tail sampling of traces.
- **What to say:** "Every call has a timeout and a circuit breaker; retries happen at one layer with jitter; I'd define an SLO of 99.9% for checkout and alert on error-budget burn rate."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Logs, metrics, traces | Detect, locate, explain | Can I find a slow call in minutes? |
| Correlation ID | One ID through every hop | Can I join logs from all services? |
| Golden signals | Latency, traffic, errors, saturation | Would I notice a 200 with wrong data? |
| Percentiles | Tail, not average | Am I averaging percentiles? |
| SLO / error budget | Target and allowed failure | Do we ship or stabilise this week? |
| Timeouts | Never wait forever | Is my timeout shorter than my caller's? |
| Retries | Backoff + jitter, one layer | Is this call idempotent? |
| Circuit breaker | Fail fast when sick | What happens while it is open? |
| Bulkhead | Separate pools | Can one dependency drain all threads? |
| Fallback | Degrade, never lie | What does "degraded" look like here? |
| Health checks | Liveness vs readiness | Does liveness depend on the DB? |
| Canary | Small slice first | Who notices a bad release, users or metrics? |

## Final memory aid

- **Metrics** detect, **traces** locate, **logs** explain
- **One trace ID** per request, in every log line
- **p99 from histograms,** never averages
- **Error budget = 1 - SLO;** page on burn rate
- **Timeout everything;** retry once, with jitter
- **Breaker:** closed, open, half-open
- **Bulkheads + fallbacks** keep failures small
- **Liveness ignores dependencies;** canary every release
