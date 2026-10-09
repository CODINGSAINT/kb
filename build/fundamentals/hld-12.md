=== hld-geo | HLD | Geospatial indexing and location services ===
"Drivers within 2 km", "restaurants near me", "which delivery zone is this address in" are two-dimensional proximity queries, and an ordinary B-tree index on latitude and longitude cannot answer them efficiently. The trick is to map 2-D space onto 1-D keys (geohash, S2, H3) or to use spatial trees (quadtrees, R-trees) so a proximity query becomes a handful of key or range lookups followed by an exact distance filter. This chapter covers the geometry, each index family and its trade-offs, and how ride-hailing and delivery platforms ingest millions of moving locations and match them in milliseconds.

## Coordinates and distance
- **Latitude** runs from -90 (south pole) to +90; **longitude** from -180 to +180. GPS reports WGS84 coordinates.
- One degree of latitude is about **111 km** everywhere. One degree of longitude is `111 km × cos(latitude)`: 111 km at the equator, ~79 km in Delhi (28.6°N), ~71 km in London (51.5°N), 0 at the poles. So a "box of ±0.01°" is not square.
- Precision: 5 decimal places ≈ 1.1 m, 6 ≈ 11 cm. Phone GPS is typically accurate to 5–20 m in cities, worse among tall buildings.

### Haversine (great-circle distance)
```java
static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
    final double R = 6371.0; // mean Earth radius in km
    double dLat = Math.toRadians(lat2 - lat1);
    double dLon = Math.toRadians(lon2 - lon1);
    double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
             + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
             * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
}
```
For short distances (under a few km) the **equirectangular approximation** `x = Δlon·cos(meanLat), y = Δlat, d = R·√(x²+y²)` is accurate to well under 1% and far cheaper, which matters when filtering thousands of candidates per request. Remember that straight-line distance is not travel distance: a river or a one-way system can turn 500 m into 4 km, so ranking uses ETA, not haversine.

### Why a normal index fails
`WHERE lat BETWEEN a AND b AND lon BETWEEN c AND d` with separate B-tree indexes can use only one index range efficiently; the other dimension is filtered row by row. In a city with a million points, the latitude band alone may contain 100,000 rows. Spatial indexes solve this by preserving **locality in both dimensions**.

## Geohash
Geohash recursively bisects the world: one bit for longitude (left or right half), one for latitude (bottom or top), alternating, then encodes every 5 bits as one base-32 character. Each extra character divides the cell by 32.

| Length | Cell size (approx, at equator) | Typical use |
|---|---|---|
| 4 | 39 km × 19.5 km | Region, city-level sharding |
| 5 | 4.9 km × 4.9 km | "Nearby" search for sparse areas |
| 6 | 1.2 km × 0.61 km | Driver/restaurant search radius ~1 km |
| 7 | 153 m × 153 m | Neighbourhood, precise matching |
| 8 | 38 m × 19 m | Building level |
| 9 | 4.8 m × 4.8 m | Very fine; near GPS noise |

**Properties:** points sharing a longer prefix are close, so a geohash can be stored in a plain string column and queried with `LIKE 'tdr1w%'` or a range scan, and you can index it with any B-tree or key-value store.

**The edge (neighbour) problem:** two points 10 m apart on either side of a cell boundary can have completely different geohashes (especially at the prime meridian and equator, where even the first character differs). Therefore a proximity search must:
1. Pick a precision whose cell is at least as large as the search radius.
2. Compute the user's cell **plus its 8 neighbours** (a 3×3 block).
3. Fetch all points in those 9 cells.
4. Filter by exact distance and sort.

If too few results come back, drop one character (32x larger cells) and repeat. Geohash cells are also distorted near the poles and are rectangles rather than squares at odd lengths.

## Quadtree
A tree where each node covers a rectangle and splits into four children when it holds more than a threshold (say 100) points. Dense Manhattan gets tiny leaves, rural Montana gets huge ones, so every leaf holds a similar number of points, which makes "find the nearest 20 restaurants" efficient regardless of density.

```
                [World]
       ┌──────┬──────┬──────┐
      NW     NE     SW     SE        each node: bounds + children or point list
             │
      ┌───┬───┬───┐                  split when points > 100
     NW  NE  SW  SE
```
- **Static quadtree:** built offline (e.g. nightly from the business table) and loaded into memory on each search server. Yelp-style: 200 million places × ~100 bytes fits in ~20 GB across a few machines; rebuilds are cheap. Great for places that rarely move.
- **Dynamic quadtree:** supports inserts, deletes and merges of under-full nodes. Moving objects that update every few seconds cause constant split/merge churn and need locking, so for drivers a fixed grid or cell-based index is usually simpler.
- **Search:** descend to the leaf containing the user, then expand to neighbouring leaves until you have K candidates within the radius.

## S2 and H3: hierarchical cell systems
### Google S2
S2 projects the sphere onto the six faces of a cube and orders each face's cells along a **Hilbert curve**, giving 31 levels of cells identified by a 64-bit integer. Key properties:
- Cells nearby in space have nearby IDs (Hilbert locality is better than geohash's Z-order), so a region maps to a small set of **ID ranges** that can be scanned in any sorted store.
- `RegionCoverer` turns any circle or polygon into a covering of a few cells at mixed levels.
- Cells are roughly equal-area across the globe, with no pole or meridian discontinuities.
- Used by Google Maps, Foursquare, MongoDB `2dsphere`, Pokémon Go and Uber (historically for its dispatch index).

### Uber H3
H3 tiles the world with **hexagons** across 16 resolutions (resolution 7 ≈ 5 km², resolution 9 ≈ 0.1 km², each ~174 m across).
- Every hexagon has **six neighbours at equal distance**; squares have 4 edge and 4 corner neighbours at different distances. That makes "k-ring" searches (`gridDisk(cell, k)`) and smoothing or diffusion calculations clean.
- Ideal for **aggregation**: supply/demand per cell, surge pricing, heat maps, delivery-time models.
- Hierarchy is approximate (a hexagon cannot be exactly divided into seven hexagons), so parent/child containment is not perfect; S2 is better for exact region coverings.

### R-trees and PostGIS
An R-tree groups nearby objects into nested **minimum bounding rectangles**; it indexes points and also shapes (polygons, lines), which cell systems handle less naturally. PostgreSQL's PostGIS uses GiST-based R-trees:

```sql
CREATE TABLE restaurants (
  id     BIGINT PRIMARY KEY,
  name   TEXT,
  geom   GEOGRAPHY(Point, 4326)
);
CREATE INDEX idx_restaurants_geom ON restaurants USING GIST (geom);

-- within 2 km, nearest first (KNN operator <-> uses the index)
SELECT id, name, ST_Distance(geom, ST_MakePoint(77.209, 28.613)::geography) AS m
FROM restaurants
WHERE ST_DWithin(geom, ST_MakePoint(77.209, 28.613)::geography, 2000)
ORDER BY geom <-> ST_MakePoint(77.209, 28.613)::geography
LIMIT 20;

-- which delivery zone contains this address? (point-in-polygon)
SELECT zone_id FROM delivery_zones
WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint(77.209, 28.613), 4326));
```
PostGIS is the right answer for relatively static data with rich queries (polygons, zones, geofences, routes). It is not the right place for millions of location updates per second.

### Redis GEO
Redis stores members in a sorted set whose score is a 52-bit interleaved geohash:
```
GEOADD drivers:blr 77.5946 12.9716 driver:881
GEOSEARCH drivers:blr FROMLONLAT 77.60 12.97 BYRADIUS 2 km ASC COUNT 20 WITHDIST
ZREM drivers:blr driver:881
```
Updates are O(log N) and searches touch only the relevant score ranges. Weaknesses: no per-member TTL (stale drivers must be removed explicitly or tracked in a separate heartbeat key), and one key per city can become a hot, very large key, so shard by city and cell.

### Comparison
| Index | Shape | Strengths | Weaknesses | Typical use |
|---|---|---|---|---|
| Geohash | Rectangles, Z-order string | Works in any KV/B-tree store, simple prefix queries | Edge/neighbour problem, distortion, fixed precision | Simple nearby search, sharding keys |
| Quadtree | Adaptive rectangles | Adapts to density, K-nearest efficiently | Churn with moving objects, custom in-memory code | Yelp-style static POIs |
| S2 | Quad cells on cube, Hilbert | 64-bit IDs, great locality, exact coverings | More complex library | Region covering, geofences, Google-scale |
| H3 | Hexagons | Uniform neighbours, aggregation, k-rings | Imperfect hierarchy | Surge pricing, supply/demand, analytics |
| R-tree (PostGIS) | Bounding rectangles | Shapes, polygons, rich SQL | Write throughput, single DB scaling | Zones, geofencing, static places |
| Redis GEO | Geohash in sorted set | Fast in-memory updates and radius search | No member TTL, big keys | Live driver positions |

## Location services at scale: the ride-hailing pattern
### Requirements and numbers
Say 5 million active drivers worldwide, each sending a location every 4 seconds: **1.25 million writes/second**. Each payload (driver ID, lat, lon, heading, speed, accuracy, timestamp, status) is ~100 bytes, so ~125 MB/s of ingress. Riders request ~50,000 matches/second at peak, each needing "available drivers near me" in under 100 ms.

### Ingestion path
```
Driver app ──(WebSocket/gRPC stream or batched HTTP)──> Location gateway (stateless, regional)
     │                                                     │
     │                                                     ├──> Kafka topic "driver-locations"
     │                                                     │       partitioned by city / cell
     │                                                     │
     │                                       ┌─────────────┴──────────────┐
     │                              Location index service          Trip tracking service
     │                              (in-memory grid per city shard) (pushes to rider app)
     │                                                     │
     │                                       Cold path: S3/data lake (trails for analytics,
     │                                       ETA training, fraud, disputes)
```
Key decisions:
- **Do not write every ping to a database.** Current position is ephemeral, overwritten every 4 seconds. Keep it in memory (in-process grid or Redis); persist trails asynchronously in bulk via Kafka to a data lake or Cassandra (`(driver_id, day)` partition) for history.
- **Client-side smoothing:** send more often when moving fast or on a trip, less often when idle; snap to the road network (map matching) to remove GPS jitter.
- **Only re-index on cell change:** most pings stay in the same cell; update the position in place and move the driver between cell buckets only when crossing a boundary.
- **Expiry:** a driver that stops pinging (tunnel, app killed) must disappear from search after ~15–30 seconds. Store `lastSeen` with each entry and filter or sweep stale ones.

### The in-memory grid
Each location index server owns a set of cells (for example H3 resolution 8 or S2 level 13) for one city. Structure:
```java
// cellId -> drivers currently in that cell
ConcurrentHashMap<Long, Set<Long>> driversByCell;
// driverId -> latest state (position, status, vehicle type, lastSeen)
ConcurrentHashMap<Long, DriverState> stateByDriver;

void onPing(Ping p) {
    long newCell = H3.latLngToCell(p.lat(), p.lon(), 8);
    DriverState old = stateByDriver.put(p.driverId(), DriverState.from(p, newCell));
    if (old == null || old.cell() != newCell) {
        if (old != null) driversByCell.getOrDefault(old.cell(), Set.of()).remove(p.driverId());
        driversByCell.computeIfAbsent(newCell, c -> ConcurrentHashMap.newKeySet()).add(p.driverId());
    }
}
```
Search: compute the rider's cell, take `gridDisk(cell, k)` (k = 1 or 2), collect drivers, filter by status (available, vehicle type) and freshness, compute approximate distance, then rank the top N by ETA. A single server comfortably holds a large city (a million drivers × ~200 bytes = 200 MB).

### Sharding by region
- **Shard by city / region first:** almost all queries are local, and the business is organised that way (pricing, regulation). A city maps to one or more index servers.
- **Large cities split by cell:** consistent hashing of cell IDs across servers; a query fans out to the servers owning the k-ring cells (usually one or two).
- **Hot spots:** airports, stadiums and concert exits concentrate drivers and requests; use finer cells there or replicate read-heavy shards.
- **Replication:** run each shard with a replica; because state rebuilds from the live stream within seconds (everyone pings every 4 s), losing a node means a brief degradation, not data loss. Uber's Ringpop used gossip-based consistent hashing for exactly this.

### Matching and dispatch
1. Rider requests a trip; the dispatch service queries the index for available drivers within the k-ring.
2. Rank candidates by **ETA** (road-network routing, not straight-line), driver rating, acceptance probability, and global efficiency (batch matching over a 1–2 second window can beat greedy nearest-driver for the whole city).
3. **Offer and lock:** mark the driver as `OFFERED` atomically (`SET driver:881:lock trip:9 NX PX 15000` or a compare-and-set on driver state) so two riders never get the same driver; offer with a 10–15 second timeout; on decline or timeout, release and try the next.
4. On accept, create the trip (durable DB transaction), switch the driver to `ON_TRIP`, and start streaming the driver's location to the rider via WebSocket or push.

### ETA
- Model the road network as a weighted graph (edges = road segments, weights = current travel time from live speed data).
- Plain Dijkstra on a continent-sized graph is too slow; production routers use **Contraction Hierarchies** or similar precomputation to answer point-to-point queries in milliseconds (OSRM, GraphHopper, Valhalla).
- Adjust with ML using historical trips, time of day, weather and events. Cache ETAs between cell pairs for coarse estimates (pricing) and compute precise ones only for the final candidates.

### Other location products
- **Yelp / "nearby places":** read-heavy, write-light. Static quadtree or geohash index in memory, rebuilt periodically; business details in a DB and cache; results ranked by distance, rating and relevance; CDN for photos.
- **Food delivery:** three moving parties (customer, restaurant, courier); delivery zones as polygons (PostGIS or S2 coverings); courier assignment includes food prep time; order batching for couriers.
- **Geofencing:** "notify when the user enters the store area": precompute S2/H3 coverings of each fence, index fences by cell, and on each location update check only fences in the user's cell.
- **Friends nearby / location sharing:** pub/sub per user or per cell; only send updates to friends within some radius; throttle.

## How it shows up in interview problems
- **Uber / Lyft / Ola:** the whole ingestion + in-memory grid + matching + lock + ETA story; mention WebSockets for live tracking and Kafka for trails.
- **Yelp / Google Places / proximity service:** geohash or quadtree, 9-cell search, read replicas and caching, rebuild index offline.
- **Food delivery (Swiggy, DoorDash):** zones as polygons, courier location like drivers, ETA including prep.
- **Tracking / logistics / fleet:** ingestion at scale, time-series storage of trails, geofence alerts.
- **Notification system:** geo-targeted pushes ("users in this H3 cell") using cell-tagged segments.
- **Metrics / analytics:** aggregate events by H3 cell for heat maps and surge.

## Common pitfalls
- Searching only the user's own geohash cell and missing everything just across the boundary.
- Treating degrees as equal distances in both directions.
- Writing every location ping to a relational DB.
- Ranking by straight-line distance instead of ETA.
- No staleness handling, so ghost drivers who went offline still appear.
- A single global Redis key for all drivers (hot, huge key).
- Matching without an atomic lock, double-assigning a driver.
- Choosing precision too fine for the radius, turning one query into hundreds of cell lookups.

## Interview questions
1. **Why can't a B-tree on (lat, lon) answer "nearby" efficiently?** A composite index narrows only the first dimension's range; the second is filtered row by row. Spatial encodings preserve 2-D locality in one key.
2. **What is the geohash edge problem and how do you fix it?** Nearby points across a cell boundary have different prefixes; always query the cell plus its 8 neighbours and then filter by exact distance.
3. **Quadtree vs geohash?** Quadtrees adapt to density (similar counts per leaf) and suit static POIs in memory; geohash is a fixed grid that works in any key-value store and handles updates simply.
4. **Why does Uber use hexagons?** H3 hexagons have six equidistant neighbours, making radius rings, smoothing and supply/demand aggregation uniform; squares have uneven neighbour distances.
5. **How do you handle 1M+ location updates per second?** Persistent connections into stateless regional gateways, Kafka partitioned by city/cell, in-memory cell index per shard, update membership only on cell change, persist trails asynchronously in batches.
6. **How do you prevent two riders getting the same driver?** An atomic state transition (`SET NX PX` lock or CAS on driver status) with an offer timeout, released on decline.
7. **How do you shard a location index?** By city/region first, then by cell with consistent hashing; split hot cells; rebuild from the live stream on failure.

## Cheat sheet
- 1° lat ≈ 111 km; 1° lon ≈ 111 km × cos(lat). Haversine for accuracy, equirectangular for speed.
- Geohash: base32 Z-order; 6 chars ≈ 1.2 km, 7 ≈ 150 m; query 9 cells then filter.
- Quadtree: adaptive, in-memory, great for static places. R-tree/PostGIS: shapes, polygons, zones.
- S2: Hilbert curve, 64-bit cell IDs, region coverings. H3: hexagons, k-rings, aggregation/surge.
- Moving objects: memory, not DB; Kafka for trails; re-index on cell change; TTL stale entries.
- Shard by city, then cell; hot cells split; rebuild from stream.
- Match: k-ring candidates → filter → rank by ETA → atomic lock with timeout.

=== hld-observability | HLD | Observability and resilience patterns ===
In a distributed system something is always partially broken, so the questions are how quickly you notice, how precisely you can locate the cause, and how small you can keep the blast radius. Observability (logs, metrics, traces, SLOs and alerting) answers the first two; resilience patterns (timeouts, retries, circuit breakers, bulkheads, fallbacks, health checks) and safe deployment practices answer the third. This chapter gives you the vocabulary and the concrete Spring and Resilience4j configuration to discuss both convincingly.

## Monitoring vs observability
Monitoring checks known failure modes ("is CPU above 90%?"). Observability is the ability to ask **new** questions about a system from its outputs without shipping new code ("why are checkout requests from Android users in Mumbai slow since 14:05?"). That requires high-quality, correlated telemetry: logs, metrics and traces linked by shared identifiers.

## The three signals
| Signal | What it is | Strength | Cost / weakness | Tools |
|---|---|---|---|---|
| Metrics | Numeric time series (counters, gauges, histograms) with labels | Cheap, aggregatable, ideal for dashboards and alerts | Lose per-request detail; label cardinality limits | Prometheus, Micrometer, Datadog, CloudWatch |
| Logs | Timestamped event records | Rich detail, arbitrary context | Expensive at volume; hard to aggregate | ELK/OpenSearch, Loki, Splunk |
| Traces | Tree of spans for one request across services | Shows where latency and errors originate | Needs instrumentation and sampling | OpenTelemetry, Jaeger, Tempo, Zipkin |

Increasingly, **profiles** (continuous CPU/memory profiling) and **events** (deploys, config changes) are treated as further signals; overlaying deploy markers on dashboards resolves a large share of incidents ("latency rose at 14:05, which is when v2.31 shipped").

### Structured logging and correlation IDs
Log JSON, not prose, so fields can be indexed and queried:
```json
{"ts":"2026-10-09T14:05:12.481Z","level":"ERROR","service":"payment-service",
 "traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"00f067aa0ba902b7",
 "userId":"u_8812","orderId":"o_99172","event":"charge_failed",
 "provider":"stripe","errorCode":"card_declined","latencyMs":842}
```
- Every request gets a **trace ID** at the edge (W3C `traceparent` header); every service propagates it and puts it in every log line through the MDC. Clicking from a trace to its logs, or from an error log to its trace, is the core debugging loop.
- Log **events and decisions**, not every line of control flow. Use levels consistently; avoid logging in tight loops.
- Never log secrets, tokens, full card numbers or unnecessary PII; mask at the logging layer.
- At high volume, **sample** successful requests (keep 1–10%) but keep all errors; set retention by tier (hot 7 days searchable, cold in object storage for 90+ days).

### Distributed tracing and OpenTelemetry
A **trace** is a tree of **spans**; each span records a unit of work (an HTTP handler, a DB query, a Kafka publish) with start time, duration, attributes and status, and a parent span ID. Context propagates in headers (HTTP `traceparent`, Kafka record headers, gRPC metadata).

**OpenTelemetry (OTel)** is the vendor-neutral standard: APIs and SDKs for traces, metrics and logs, auto-instrumentation agents (the Java agent instruments Spring MVC, JDBC, Kafka, gRPC and HTTP clients with no code), and the **Collector**, which receives, batches, samples and exports to any backend.

Sampling:
- **Head sampling:** decide at the start (keep 5% of traces). Cheap, but may drop the interesting slow or failed ones.
- **Tail sampling:** the collector buffers complete traces and keeps all errors and slow ones plus a percentage of the rest. Better signal, more infrastructure.

In Spring Boot 3, Micrometer Tracing bridges to OTel:
```yaml
management:
  tracing:
    sampling:
      probability: 0.1
  otlp:
    tracing:
      endpoint: http://otel-collector:4318/v1/traces
  endpoints:
    web:
      exposure:
        include: health,prometheus,info
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
      slo:
        http.server.requests: 100ms,300ms,1s
logging:
  pattern:
    level: "%5p [${spring.application.name},%X{traceId:-},%X{spanId:-}]"
```

## What to measure
### RED, USE and the four golden signals
- **RED** (per request-driven service): **R**ate (requests/sec), **E**rrors (failed requests/sec or ratio), **D**uration (latency distribution).
- **USE** (per resource such as CPU, disk, connection pool, thread pool, queue): **U**tilisation (% busy), **S**aturation (queued work: run queue, pool wait time, consumer lag), **E**rrors.
- **Google's four golden signals:** latency, traffic, errors, saturation. RED plus saturation.

Add **business metrics**: orders per minute, payment success rate, matches per second, messages delivered. They catch failures that technical metrics miss (a bug that returns 200 with an empty cart).

### Percentiles and histograms
Averages hide pain. If 99 requests take 50 ms and one takes 5 s, the mean is ~100 ms and looks fine while 1% of users wait 5 seconds. Report **p50, p95, p99, p99.9**.
- **Tail amplification:** a page that fans out to 100 backends sees each backend's p99 on 63% of page loads (`1 - 0.99^100`). Tail latency of dependencies becomes typical latency of aggregators.
- **You cannot average percentiles** across instances. Averaging the p99 of 20 pods is mathematically meaningless. Instead, export **histograms** (bucket counts), sum buckets across instances, then compute the percentile: `histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket[5m])))`.
- Choose bucket boundaries around your SLO thresholds, or use native/exponential histograms.

### Cardinality
Each unique label combination is a separate time series. Labels like `endpoint`, `status`, `region` are fine; `userId`, `orderId` or raw URLs with IDs (`/orders/91827`) explode storage and crash Prometheus. Use the route template (`/orders/{id}`); put high-cardinality detail in logs and traces.

## SLI, SLO, SLA and error budgets
| Term | Meaning | Example |
|---|---|---|
| SLI (indicator) | A measured ratio of good events to total | % of checkout requests that succeed in < 300 ms |
| SLO (objective) | Internal target for an SLI over a window | 99.9% over a rolling 28 days |
| SLA (agreement) | External contract with penalties | 99.5% monthly or service credits |
| Error budget | `1 - SLO` of allowed failure | 0.1% of 28 days ≈ 40 minutes; or 1 in 1,000 requests |

- SLAs are looser than SLOs so you breach internally before you pay externally.
- **Error budget policy:** while budget remains, ship features fast; when it is exhausted, freeze risky releases and prioritise reliability work. It turns "reliability vs velocity" into a data-driven agreement.
- Nines and downtime per year: 99% ≈ 3.65 days, 99.9% ≈ 8.8 hours, 99.95% ≈ 4.4 hours, 99.99% ≈ 53 minutes, 99.999% ≈ 5.3 minutes. Serial dependencies multiply: three services at 99.9% in series give ~99.7%.
- Measure SLIs as close to the user as possible (load balancer logs, client RUM), not just at the service.

## Alerting
- **Alert on symptoms, not causes.** Page on "checkout error rate above SLO burn" (users are affected); put "CPU at 85%" on a dashboard or ticket, not a pager.
- **Burn-rate alerts:** page when the error budget is being consumed fast. A common multi-window rule: page if the 1-hour burn rate exceeds 14.4x (2% of a 30-day budget in an hour) **and** the 5-minute burn rate confirms it is still happening; ticket for slow burns (e.g. 6-hour window at 6x).
- Every page must be **actionable** and link to a runbook and dashboard. Noisy alerts train people to ignore them.
- Alert on **absence** too: "no orders processed for 10 minutes" or "consumer lag growing for 15 minutes" catches silent failures.

## Resilience patterns
### Timeouts
Every network call needs a timeout; the default in many clients is infinite. Set connect timeouts short (~100 ms–1 s) and read timeouts based on the dependency's p99.9 plus margin. Propagate a **deadline**: if the user request has 2 s total and 1.5 s has elapsed, the next call gets at most 0.5 s, and work whose deadline passed is dropped.

### Retries
- Retry only **transient** failures (connection reset, 503, timeout) and only **idempotent** operations, or operations made idempotent with an idempotency key.
- Use **exponential backoff with jitter** (`sleep = random(0, base × 2^attempt)`, capped) so clients don't synchronise.
- Retry at **one layer**. If the gateway, service and client each retry 3 times, one failure becomes 27 calls (retry amplification). Use a **retry budget** (retries limited to e.g. 10% of requests) so retries can't multiply load during an outage.

### Circuit breaker
Wraps calls to a dependency and tracks failures over a sliding window.
```
          failure rate >= threshold
 CLOSED ───────────────────────────> OPEN  (fail fast, return fallback, no calls)
   ^                                   │
   │ trial calls succeed               │ wait duration elapsed
   │                                   v
   └──────────────────────────── HALF_OPEN (allow N trial calls)
                trial calls fail ──> back to OPEN
```
Benefits: callers fail in microseconds instead of waiting for timeouts, freeing threads; the struggling dependency gets breathing room to recover. Breakers also count **slow calls** (Resilience4j `slowCallRateThreshold`), which catches degradation before outright failure.

### Bulkheads
Isolate resources per dependency so one slow dependency can't drain everything: separate thread pools or semaphores per downstream, separate connection pools, separate consumer groups, even separate clusters per tenant tier ("cell-based architecture"). Without bulkheads, a slow recommendation service can exhaust Tomcat's 200 threads and take down checkout.

### Fallbacks and graceful degradation
Decide per feature what "degraded" looks like:
- Serve **cached or stale** data (last known product price display, with checkout re-validating).
- Return a **default** (generic popular items instead of personalised recommendations).
- **Disable non-critical features** (hide reviews, turn off live typing indicators) via feature flags or kill switches.
- **Queue for later** (accept the order, process payment asynchronously, email confirmation).
Never fall back silently on correctness-critical paths: a payment must not be "assumed successful".

### Health checks
| Probe | Question | On failure | Should check |
|---|---|---|---|
| Liveness | Is the process stuck beyond recovery? | Restart container | Only internal state (event loop alive, no deadlock); not dependencies |
| Readiness | Can it serve traffic right now? | Remove from load balancer | Warm-up done, critical local resources ready |
| Startup | Has slow startup finished? | Delay other probes | Initialisation complete |
Classic mistake: a liveness probe that checks the database. When the DB blips, every pod fails liveness and Kubernetes restarts the whole fleet, turning a dependency hiccup into a full outage. Spring Boot exposes `/actuator/health/liveness` and `/actuator/health/readiness` groups for exactly this split.

### Resilience4j in Spring Boot
```yaml
resilience4j:
  circuitbreaker:
    instances:
      inventory:
        slidingWindowType: COUNT_BASED
        slidingWindowSize: 50
        minimumNumberOfCalls: 20
        failureRateThreshold: 50
        slowCallDurationThreshold: 800ms
        slowCallRateThreshold: 60
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 5
  retry:
    instances:
      inventory:
        maxAttempts: 3
        waitDuration: 100ms
        enableExponentialBackoff: true
        exponentialBackoffMultiplier: 2
        enableRandomizedWait: true
        retryExceptions: [java.io.IOException, java.util.concurrent.TimeoutException]
  bulkhead:
    instances:
      inventory:
        maxConcurrentCalls: 30
        maxWaitDuration: 0
  timelimiter:
    instances:
      inventory:
        timeoutDuration: 1s
```
```java
@Service
public class InventoryClient {
    private final RestClient restClient;
    private final MeterRegistry meters;

    public InventoryClient(RestClient.Builder builder, MeterRegistry meters) {
        this.restClient = builder.baseUrl("http://inventory-service").build();
        this.meters = meters;
    }

    // Order of decoration: Retry( CircuitBreaker( RateLimiter( TimeLimiter( Bulkhead( call )))))
    @Retry(name = "inventory")
    @CircuitBreaker(name = "inventory", fallbackMethod = "cachedAvailability")
    @Bulkhead(name = "inventory")
    public Availability check(String sku) {
        return restClient.get().uri("/stock/{sku}", sku).retrieve().body(Availability.class);
    }

    private Availability cachedAvailability(String sku, Throwable t) {
        meters.counter("inventory.fallback", "reason", t.getClass().getSimpleName()).increment();
        return Availability.unknown(sku); // UI shows "check availability at checkout"
    }
}
```
Resilience4j publishes breaker state, failure rates and bulkhead usage to Micrometer automatically, so breaker transitions show up on dashboards. Custom business metrics are a line each:
```java
Timer.builder("checkout.latency").publishPercentileHistogram().register(meters)
     .record(() -> checkoutService.placeOrder(cmd));
meters.counter("orders.placed", "channel", channel).increment();
```

### Chaos engineering
Verify all of this deliberately: inject latency and failures (Chaos Monkey for Spring Boot, Gremlin, AWS FIS, Toxiproxy, Chaos Mesh), kill instances and zones, and run **game days**. Start with a hypothesis ("if the recommendation service adds 2 s latency, checkout p99 stays under 500 ms"), limit the blast radius, start in staging, and graduate to production with abort conditions. Netflix's Simian Army popularised this; the point is to find missing timeouts and bad fallbacks before your customers do.

## Safe deployments
Most outages are caused by changes, so the release process is a resilience mechanism.
| Strategy | How | Pros | Cons |
|---|---|---|---|
| Rolling | Replace instances in batches | No extra capacity, default in Kubernetes | Mixed versions during rollout; slower rollback |
| Blue-green | Two full environments; switch traffic at the LB | Instant switch and rollback | Double capacity; DB schema must suit both |
| Canary | Send 1% → 5% → 25% → 100% to the new version, comparing SLIs | Limits blast radius, data-driven promotion | Needs good metrics and traffic splitting |
| Feature flags | Deploy code dark, enable per user/tenant/percentage at runtime | Decouples deploy from release; kill switch | Flag debt; combinatorial testing |
| Shadow / dark launch | Mirror production traffic to the new version, discard responses | Real load without user impact | Side effects must be suppressed |

- **Automated canary analysis** (Argo Rollouts, Flagger, Spinnaker Kayenta) compares canary vs baseline error rate and latency and rolls back automatically.
- **Database changes** use expand → migrate → contract so old and new code both work during a rollout: add the nullable column, deploy code writing both, backfill, switch reads, then drop the old column later.
- **Config changes** deserve the same canarying as code; many famous outages were a bad config pushed globally in seconds.

## Real-world systems
- **Google SRE:** SLOs, error budgets, burn-rate alerting, golden signals.
- **Netflix:** Hystrix (now Resilience4j in the ecosystem), Chaos Monkey, adaptive concurrency limits, Atlas metrics.
- **Amazon:** cell-based architecture and shuffle sharding to limit blast radius; Builders' Library guidance on timeouts, retries, jitter and backoff.
- **Uber:** Jaeger (open-sourced tracing), M3 metrics platform.
- **Stack:** OpenTelemetry → Collector → Prometheus/Mimir (metrics), Loki/OpenSearch (logs), Tempo/Jaeger (traces), Grafana dashboards and alerting.

## How it shows up in interview problems
- **Every design:** close with "what I'd monitor" (RED per service, consumer lag, cache hit ratio, p99) and "how it fails" (timeouts, breakers, DLQ, degraded mode).
- **Logging / metrics system design:** agents → Kafka → stream processors → tiered storage (hot index, cold object store), downsampling, cardinality control, tail sampling.
- **Payments:** idempotent retries, circuit breaker per provider with failover to a second PSP, never fallback to "success", reconciliation jobs, alerts on success-rate drop.
- **News feed / Netflix / YouTube:** degrade personalisation to popular content; serve stale cache; bulkhead the recommendation call.
- **Notification system:** per-provider breakers and retry queues with backoff; DLQ and replay.
- **E-commerce / BookMyShow:** canary releases before a sale, load shedding of browse traffic to protect checkout, feature-flag kill switches.
- **API gateway:** central place for timeouts, retries (careful), breakers, request IDs and access logs.
- **Job scheduler:** heartbeats and liveness of workers, alert on missed schedules ("absence" alerts).

## Common pitfalls
- No timeout, or a timeout longer than the caller's own.
- Retrying non-idempotent operations, or retrying at every layer.
- Averaging percentiles or alerting on averages.
- High-cardinality labels (user IDs) in metrics.
- Liveness probes that depend on downstream services.
- Fallbacks that hide correctness failures.
- Alerts on causes that page at 3 a.m. with no user impact; or no alert at all for silent failures.
- Logs without trace IDs, making cross-service debugging guesswork.
- Big-bang global deploys and config pushes.

## Interview questions
1. **Logs, metrics or traces: which for what?** Metrics to detect and alert cheaply, traces to locate which service or call is slow, logs for the detailed context of a specific failure; link them with trace IDs.
2. **Why p99 instead of average, and how do you compute it across pods?** Averages hide tail pain that fan-out amplifies; export histograms, sum buckets across instances, then compute the quantile; never average per-pod percentiles.
3. **Explain SLO and error budget with numbers.** 99.9% success over 28 days allows ~40 minutes or 0.1% failures; while budget remains, ship; when spent, freeze risky changes.
4. **Describe circuit breaker states.** Closed (normal, counting failures), open (fail fast for a wait period), half-open (allow a few trial calls; success closes, failure re-opens).
5. **How do you avoid retry storms?** Retry only idempotent, transient failures, at one layer, with exponential backoff and jitter, within a retry budget, and honour circuit breakers and `Retry-After`.
6. **Liveness vs readiness?** Liveness restarts a stuck process and must not check dependencies; readiness removes an instance from the load balancer while it can't serve.
7. **Canary vs blue-green?** Blue-green switches all traffic at once with instant rollback but needs double capacity; canary shifts traffic gradually, comparing SLIs, to limit blast radius.
8. **What would you alert on for a Kafka-based pipeline?** Consumer lag growth, DLQ rate, end-to-end latency SLO burn, and absence of output events; not broker CPU alone.

## Cheat sheet
- Signals: metrics (detect), traces (locate), logs (explain); correlate with trace ID via W3C `traceparent` and MDC.
- OpenTelemetry: vendor-neutral SDK + Java agent + Collector; head vs tail sampling.
- RED per service, USE per resource, golden signals = latency, traffic, errors, saturation.
- Percentiles from histograms; never average percentiles; watch label cardinality.
- SLI → SLO → SLA; error budget = 1 - SLO; page on burn rate and symptoms.
- Timeouts + deadline propagation; retries with jitter, idempotent only, one layer, budgeted.
- Circuit breaker closed/open/half-open; bulkheads per dependency; fallbacks that degrade, never lie.
- Liveness (process) vs readiness (traffic) vs startup; never check deps in liveness.
- Deploy safely: canary with automated analysis, blue-green, feature flags, expand-migrate-contract.
- Chaos engineering with hypotheses and limited blast radius.
