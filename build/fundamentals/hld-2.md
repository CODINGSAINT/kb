=== hld-scalability | HLD | Scalability, availability, reliability and latency ===
Every architecture decision trades among four qualities: **scalability** (handling growth), **availability** (being up), **reliability** (being correct over time) and **latency** (being fast). This chapter defines each precisely, shows how to measure and improve it, and explains how they conflict.

## Scalability
Scalability is the ability to handle more load (users, requests, data) by adding resources, ideally with performance staying flat as load grows.
### Vertical scaling (scale up)
Bigger machines: more CPU, RAM, faster disks.
- Pros: no code changes; no distributed-systems problems; strong consistency stays easy.
- Cons: hard ceiling; cost grows super-linearly; still a single point of failure; downtime to upgrade.
- Reality: modern servers are huge (hundreds of cores, terabytes of RAM). **Scaling up first is often right**, especially for databases.
### Horizontal scaling (scale out)
More machines sharing the load.
- Pros: near-linear capacity growth, fault tolerance through redundancy, commodity hardware.
- Cons: needs load balancing, stateless services, data partitioning and coordination. Consistency gets harder.
### Prerequisite: stateless services
A service is stateless if any instance can serve any request because no per-user state lives in its memory.
- Sessions go to Redis, or signed tokens (JWT) carry them.
- Uploaded files go to object storage, not local disk.
- Caches are external, or local only as an optimisation.
Stateless services can be autoscaled and replaced freely; stateful components (databases, caches, brokers) get specialised scaling (replication, sharding).

### Scaling dimensions (the "scale cube")
- **X-axis:** clone the service behind a load balancer (horizontal duplication).
- **Y-axis:** split by function (microservices: orders, payments, catalog).
- **Z-axis:** split by data (shard users A–M and N–Z across separate stacks).

## Availability
Availability is the fraction of time a system serves requests successfully.
| Availability | Downtime per year | Per month |
|---|---|---|
| 99% ("two nines") | 3.65 days | 7.2 hours |
| 99.9% | 8.77 hours | 43.8 minutes |
| 99.95% | 4.38 hours | 21.9 minutes |
| 99.99% | 52.6 minutes | 4.4 minutes |
| 99.999% | 5.26 minutes | 26 seconds |

### Composing availability
- **In series** (each request needs all components): multiply. LB 99.99% × app 99.95% × DB 99.95% ≈ **99.89%**.
- **In parallel** (redundant replicas, any one suffices): `1 − (1 − a)ⁿ`. Two independent 99% replicas give 1 − 0.01² = **99.99%**.
Redundancy raises availability only if failures are **independent**: different racks, availability zones or regions; no shared dependencies.
### Techniques
- Eliminate single points of failure: N+1 or N+2 instances, replicated databases with automatic failover, redundant load balancers.
- Health checks plus automatic replacement (autoscaling groups, Kubernetes).
- Multi-AZ by default; multi-region for the most critical paths.
- Graceful degradation: serve partial functionality instead of failing entirely.
- Safe deployments: canary, blue-green, feature flags, fast rollback.

### SLIs, SLOs and SLAs
- **SLI** (indicator): what you measure, e.g. the fraction of requests completing successfully in under 300 ms.
- **SLO** (objective): an internal target, e.g. 99.9% of requests over 30 days.
- **SLA** (agreement): an external promise with penalties, usually looser than the SLO.
- **Error budget** = 1 − SLO. If you've spent it, slow down risky releases and focus on reliability.

## Reliability and fault tolerance
Reliability is the probability that the system performs correctly over time, including **not losing or corrupting data**. A system can be available (responding) but unreliable (returning wrong data).
- **Fault vs failure:** a fault is a component deviating (a disk dies); a failure is the system as a whole stopping service. Fault tolerance keeps faults from becoming failures.
- Hardware faults: disks, machines and network links fail daily at scale. Use redundancy and replication.
- Software faults: bugs, resource leaks, cascading failures. Use isolation, timeouts, bulkheads, staged rollouts and chaos testing.
- Human errors: misconfiguration is a leading cause of outages. Use automation, reviews, gradual rollouts and easy rollback.
- **MTBF** (mean time between failures) and **MTTR** (mean time to recovery): availability ≈ MTBF / (MTBF + MTTR). Reducing MTTR (fast detection and rollback) is often cheaper than increasing MTBF.

## Latency
Latency is the time to serve one request; **throughput** is how many requests per second you can serve.
### Measure percentiles, not averages
An average hides the slow tail. Track p50 (median), p95, p99 and p99.9.
- Users with the most data (your best customers) often hit the tail.
- **Fan-out amplifies the tail:** if a page calls 100 backends and each is slow 1% of the time, 1 − 0.99¹⁰⁰ ≈ **63%** of page loads include a slow call.
### Reducing latency
| Technique | Effect |
|---|---|
| Caching (client, CDN, app, DB) | Avoid repeated work and long trips |
| Geographic proximity (CDN, regional deployments) | Cut network round trips |
| Fewer round trips (batching, connection reuse, HTTP/2) | Remove protocol overhead |
| Asynchronous processing | Respond before slow work completes |
| Precomputation (materialised views, feed fan-out) | Move work from read time to write time |
| Efficient data access (indexes, denormalisation) | Fewer and cheaper queries |
| Parallel fan-out with timeouts | Overlap independent calls |
### Taming the tail
- Timeouts and deadlines on every call.
- **Hedged requests:** send a duplicate request to another replica if the first hasn't answered by the p95 time, and use whichever returns first.
- Load shedding: reject early under overload rather than queueing forever.
- Avoid head-of-line blocking (separate pools for slow and fast requests).

## Throughput vs latency
Queueing theory (Little's law: `L = λ × W`) says the number of requests in the system equals arrival rate × time in the system. As utilisation approaches 100%, queueing delay explodes. **Run important resources at 50–70% utilisation** to keep latency stable. Batching increases throughput at the cost of latency; streaming reduces latency at the cost of overhead.

## How the qualities conflict
| Choice | Helps | Hurts |
|---|---|---|
| Synchronous replication to all replicas | Durability, consistency | Write latency, availability during partitions |
| Aggressive caching | Latency, DB load | Freshness/consistency |
| Strong consistency everywhere | Correctness simplicity | Latency, availability, scalability |
| Microservices split | Independent scaling and teams | Latency (network hops), operational complexity |
| Redundancy across regions | Availability | Cost, consistency complexity |

## Interview questions
1. **How do you make a stateful service horizontally scalable?** Move state out (cache/DB), or partition the state with consistent hashing so each instance owns a slice, plus replication for failover.
2. **What's the availability of a system with three sequential 99.9% services?** ~99.7%. Then improve it with redundancy and by removing serial dependencies (async).
3. **Why track p99 instead of the average?** Tail latency affects many users through fan-out, and averages hide it.
4. **How would you get from 99.9% to 99.99%?** Remove SPOFs, multi-AZ, faster detection and rollback (reduce MTTR), graceful degradation, safer deploys.

## Cheat sheet
```
Scale up first (esp. DBs); scale out stateless services; state → purpose-built stores
Scale cube: X clone · Y split by function · Z split by data
Availability: series multiply; parallel 1-(1-a)^n; independent failure domains
SLI → SLO → SLA; error budget = 1 - SLO; availability ≈ MTBF/(MTBF+MTTR)
Latency: percentiles; fan-out amplifies tail; cache, colocate, async, precompute, hedge
Keep utilisation ~50–70% for stable latency (queueing)
```

=== hld-networking | HLD | Networking essentials: DNS, TCP/UDP, HTTP, TLS and proxies ===
Every request in a system design diagram crosses a network: name resolution, connection setup, encryption, proxies and load balancers. Knowing what happens at each hop explains where latency comes from, why connection reuse matters, and where to put caching, security and routing.

## What happens when you type a URL
1. **DNS resolution:** the browser asks for `api.example.com`'s IP (browser cache → OS cache → recursive resolver → root → `.com` → the authoritative server).
2. **TCP connection:** a three-way handshake (SYN, SYN-ACK, ACK) costs one round trip.
3. **TLS handshake:** certificate verification and key exchange cost one more round trip with TLS 1.3 (two with TLS 1.2); 0-RTT resumption is possible.
4. **HTTP request/response** over the encrypted connection.
5. **Connection reuse** (keep-alive, HTTP/2 multiplexing) avoids repeating steps 2–3.
For a user 150 ms away, a cold HTTPS request costs ~3 round trips (≈450 ms) before the first byte of the response. That's why CDNs terminate TLS close to users and why connection pooling matters between services.

## DNS in depth
- **Record types:** A (IPv4), AAAA (IPv6), CNAME (alias to another name), MX (mail), TXT (verification, SPF), NS (delegation), SRV (service discovery).
- **TTL** controls caching. Low TTLs (30–60 s) allow fast failover but increase query load; high TTLs reduce load but slow down changes.
- **DNS-based load balancing and geo-routing:** return different IPs per region, latency or health (Route 53, Cloud DNS). This is the first layer of global traffic management.
- **Anycast:** the same IP is announced from many locations, and BGP routes users to the nearest one. CDNs and public resolvers (1.1.1.1, 8.8.8.8) use it.
- Gotcha: clients and intermediate resolvers may ignore TTLs, so DNS failover is never instant.

## TCP vs UDP
| | TCP | UDP |
|---|---|---|
| Connection | Connection-oriented (handshake) | Connectionless |
| Delivery | Reliable, ordered, retransmits | Best effort, unordered |
| Flow/congestion control | Yes | No (the application decides) |
| Overhead | Higher | Minimal |
| Use cases | HTTP/1.1, HTTP/2, databases, most APIs | DNS, video calls, gaming, QUIC/HTTP/3, metrics (StatsD) |
TCP's ordered delivery causes **head-of-line blocking**: one lost packet delays everything behind it. QUIC (UDP-based, used by HTTP/3) runs independent streams, so loss affects only one stream, and it combines the transport and TLS handshakes.

## HTTP versions
| Version | Key features | Implications |
|---|---|---|
| HTTP/1.1 | Text, one request at a time per connection (pipelining rarely used), keep-alive | Browsers open ~6 connections per host; domain sharding was a hack |
| HTTP/2 | Binary framing, **multiplexed streams** on one connection, header compression (HPACK), server push (deprecated) | One connection per host; still TCP head-of-line blocking; gRPC runs on it |
| HTTP/3 | QUIC over UDP, per-stream loss recovery, faster handshakes, connection migration (switching Wi-Fi to mobile) | Better on lossy mobile networks |
### Semantics you should know
- **Methods:** GET (safe, idempotent), PUT (idempotent replace), PATCH (partial), DELETE (idempotent), POST (not idempotent).
- **Status classes:** 2xx success, 3xx redirect (301 permanent, 302/307 temporary, 304 not modified), 4xx client error (400, 401, 403, 404, 409, 422, 429), 5xx server error (500, 502 bad gateway, 503 unavailable, 504 gateway timeout).
- **Caching headers:** `Cache-Control` (max-age, no-store, private/public), `ETag` + `If-None-Match` (304 responses), `Last-Modified`, `Vary`.
- **Cookies and CORS** matter for browser clients: `SameSite`, `HttpOnly`, `Secure`, plus preflight requests for cross-origin calls.

## TLS
- Provides **confidentiality** (encryption), **integrity** (tamper detection) and **authentication** (the server proves identity with a certificate chained to a trusted CA).
- TLS 1.3: 1-RTT handshake, forward secrecy by default, fewer cipher choices.
- **TLS termination:** decrypt at the edge (CDN or load balancer) and forward plain or re-encrypted traffic inside. Re-encryption (or a service mesh with **mTLS**) is now standard for zero-trust networks.
- Certificates expire, so automate renewal (ACME/Let's Encrypt, cert-manager).

## Proxies
### Forward proxy
Sits in front of **clients** and makes requests on their behalf: corporate egress filtering, caching outbound traffic, anonymity. The server sees the proxy, not the client.
### Reverse proxy
Sits in front of **servers** and receives requests on their behalf (Nginx, Envoy, HAProxy, cloud load balancers, API gateways). Responsibilities:
- Load balancing across backends.
- TLS termination and HTTP/2 or HTTP/3 to clients.
- Caching responses and compression.
- Routing by host or path to different services.
- Security: rate limiting, WAF rules, hiding internal topology, request size limits.
- Observability: access logs, request IDs.
### Sidecar proxies and service mesh
In a service mesh (Istio, Linkerd), each service instance gets a local proxy that handles mTLS, retries, timeouts, circuit breaking and telemetry for **service-to-service** traffic, configured centrally rather than in each codebase.

## Connection management between services
- **Connection pooling** (database pools, HTTP client pools) avoids handshake costs and limits concurrency.
- **Keep-alive and HTTP/2** multiplexing reduce connections.
- **Timeouts:** connect timeout (short), read/response timeout (based on SLO), and overall deadlines propagated across calls.
- **Long-lived connections** (WebSockets, gRPC streams) need load balancers that support them and graceful draining during deploys.

## Network partitions and failure modes
Networks drop, delay, duplicate and reorder packets; links fail partially (one direction). Consequences for design:
- A timeout doesn't tell you whether the request was processed, so operations need **idempotency**.
- Split brain is possible, so you need quorum-based coordination.
- Gray failures (slow but not dead) are the hardest to detect, so use latency-based health checks and outlier ejection.

## Interview questions
1. **Why put a CDN in front of an API?** TLS termination near users (fewer slow round trips), caching of cacheable responses, DDoS absorption, and HTTP/2 or HTTP/3 to clients.
2. **Forward vs reverse proxy?** A forward proxy acts for clients (outbound); a reverse proxy acts for servers (inbound), doing routing, TLS, caching and load balancing.
3. **Why does gRPC need HTTP/2?** Multiplexed streams on one connection, binary framing and bidirectional streaming.
4. **How does DNS-based failover work, and what are its limits?** Health-checked records switch IPs, but caching beyond the TTL delays clients. Combine it with anycast or global load balancers for faster failover.

## Cheat sheet
```
URL → DNS → TCP (1 RTT) → TLS 1.3 (1 RTT) → HTTP; reuse connections!
DNS: A/AAAA/CNAME/NS/TXT; TTL trade-off; geo/latency routing; anycast
TCP reliable+ordered (HOL blocking) · UDP best effort · QUIC/HTTP3 per-stream recovery
HTTP/2 multiplexing (gRPC) · status codes · Cache-Control/ETag · idempotent methods
TLS: confidentiality+integrity+auth; terminate at edge; mTLS inside (mesh)
Reverse proxy: LB, TLS, cache, routing, WAF/rate limit · Forward proxy: client egress
```
