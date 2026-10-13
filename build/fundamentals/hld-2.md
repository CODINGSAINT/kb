=== hld-scalability | HLD | Scalability, availability, reliability and latency ===
Every architecture decision trades among four qualities: scalability (handling growth), availability (being up), reliability (being correct over time) and latency (being fast). This chapter explains each one in plain terms, shows a small failure and its fix, and gives you the numbers interviewers expect. Most HLD answers are built from these ideas.

## 1. Vertical vs. horizontal scaling

**Definition:** Vertical scaling means a bigger machine; horizontal scaling means more machines sharing the load.

Vertical scaling (scale up) is like replacing a small shop counter with a bigger one: simple, but there is a limit to how big one counter can get. Horizontal scaling (scale out) is opening more counters: almost no ceiling, but you need someone at the door directing customers.

### The problem

```text
One server, 16 cores, handles 3,000 QPS. Traffic grows to 30,000 QPS.
Upgrade to 64 cores -> ~12,000 QPS, roughly 4x the price.
Next upgrade? There is no 640-core box. And it is still one machine: if it dies, everything dies.
```

Vertical scaling hits a hard ceiling, the cost grows faster than the capacity, and the single machine stays a single point of failure.

### Better design

```text
                 +--> app-1 (3k QPS)
Load balancer ---+--> app-2 (3k QPS)
                 +--> ...
                 +--> app-12 (3k QPS)     -> 36k QPS, and losing one box costs 1/12
```

A load balancer (a component that spreads requests across servers) sends traffic to many identical servers. Capacity grows almost linearly, and one failure only removes a slice.

**Trade-offs:**
- Horizontal scaling needs load balancing, stateless services and, for data, partitioning, which makes consistency harder.
- For databases, scaling up first is often right: modern servers are very large, and one box avoids distributed-data problems.

**Key takeaway:** Scale stateless services out; scale databases up until the numbers force you to partition.

---

## 2. Stateless services

**Definition:** A service is stateless when no per-user data lives in a server's memory or local disk, so any instance can serve any request.

State still exists; it simply moves into stores built for it: sessions into Redis or signed tokens, files into object storage, data into the database.

### The problem

```java
@RestController
class CartController {
    private final Map<String, Cart> carts = new HashMap<>(); // lives in THIS JVM only

    @PostMapping("/cart/{userId}/items")
    void add(@PathVariable String userId, @RequestBody Item item) {
        carts.computeIfAbsent(userId, id -> new Cart()).add(item);
    }
}
```

The user's next request lands on a different server and the cart is empty. A deploy or crash wipes every cart on that box. "Sticky sessions" (always routing a user to the same server) hide the bug but make load uneven and failures painful.

### Better design

```java
@RestController
class CartController {
    private final CartRepository carts;   // backed by Redis or the database

    @PostMapping("/cart/{userId}/items")
    void add(@PathVariable String userId, @RequestBody Item item) {
        carts.addItem(userId, item);      // any instance can serve the next request
    }
}
```

Now servers can be added, removed or replaced at any time, which is what autoscaling needs.

**Key takeaway:** Push state out of the app tier so app servers become interchangeable.

---

## 3. Availability and the nines

**Definition:** Availability is the fraction of time the system serves requests successfully, usually written as "nines".

Each extra nine cuts the allowed downtime by 10x, and usually costs far more than the previous one.

| Availability | Downtime per year | Per 30-day month |
|---|---|---|
| 99% | 3.65 days | 7.2 hours |
| 99.9% | 8.77 hours | 43.2 minutes |
| 99.99% | 52.6 minutes | 4.3 minutes |
| 99.999% | 5.26 minutes | 26 seconds |

### The problem

```text
Request path: LB (99.99%) -> App (99.95%) -> DB (99.95%)   -- all required, in series
Total = 0.9999 x 0.9995 x 0.9995 ~ 99.89%
```

Components in series multiply, so the whole is always less available than its weakest part. Each extra synchronous dependency lowers the total.

### Better design

```text
Two independent replicas, either can serve (in parallel):
  1 - (1 - 0.99)^2 = 1 - 0.0001 = 99.99%
```

Redundancy lifts availability, but only if the failures are independent: different racks, availability zones (separate datacenters in a region) or regions, with no shared dependency.

**Key takeaway:** Series multiplies down, parallel redundancy multiplies up.

### SLI vs. SLO vs. SLA

- **SLI (indicator):** what you measure, e.g. the share of requests that succeed in under 300 ms.
- **SLO (objective):** the internal target, e.g. 99.9% over 30 days. The error budget is 1 - SLO.
- **SLA (agreement):** the external promise with penalties, usually looser than the SLO.

---

## 4. Single points of failure and redundancy

**Definition:** A single point of failure (SPOF) is any component whose failure stops the whole system.

Redundancy means running spare copies so a failure is absorbed. Common forms are N+1 instances (one more than needed), database replicas with automatic failover, and redundant load balancers.

### The problem

```text
Users -> LB -> [app x 6] -> one DB primary (no replica)
                          -> one Redis node
```

Six app servers look redundant, but the database and the cache are each one box. Lose either and the six app servers have nothing to talk to.

### Better design

```text
Users -> LB pair -> [app x 6 across 3 AZs] -> DB primary (AZ-a) + standby (AZ-b), auto failover
                                            -> Redis primary + replica, auto failover
Health checks remove dead instances; autoscaling replaces them.
```

**Trade-offs:**
- More copies cost money, and failover is not instant (often seconds to a minute for a database).

**Key takeaway:** Walk every box on the diagram and ask "what if this one dies?".

---

## 5. Reliability vs. availability

**Definition:** Reliability is the system doing the right thing over time, including never losing or corrupting data; availability is just being up.

A cash machine that is always on but sometimes dispenses the wrong amount is available but not reliable.

### The problem

```text
Payment service: 99.99% available.
A retry after a timeout charges the customer twice. A cache bug serves another user's order.
```

Every request got a fast response, so availability looks perfect, yet the system is wrong.

### Better design

```text
- Idempotency keys so retries cannot double-charge
- Replicated, durable writes (acknowledge only after the data is safely stored)
- Staged rollouts and fast rollback for software bugs
- Availability ~ MTBF / (MTBF + MTTR)
```

MTBF is the mean time between failures; MTTR is the mean time to recovery. Cutting MTTR (fast detection, one-click rollback) is often cheaper than making failures rarer.

### Fault vs. failure

- **Fault:** one component misbehaves (a disk dies, a node hangs).
- **Failure:** the whole system stops serving users.
- **Fault tolerance** is the art of keeping faults from becoming failures.

**Key takeaway:** Up is not the same as correct; design for both.

---

## 6. Latency percentiles

**Definition:** Latency is the time to serve one request; percentiles describe its distribution, such as p99 = 99% of requests are faster than this.

Averages hide the slow tail. Track p50 (the median), p95, p99 and sometimes p99.9.

### The problem

```text
Average latency 40 ms, looks great. But p99 = 2 s.
A page calls 100 backends in parallel; each is slow 1% of the time.
Chance at least one is slow = 1 - 0.99^100 ~ 63% of page loads
```

Fan-out (one request calling many services) turns a rare slow call into a common slow page. Heavy users, often your best customers, hit the tail most.

### Better design

```text
- Set an SLO on p99, not the average
- Timeouts and deadlines on every call
- Hedged requests: if no reply by the p95 time, send a copy to another replica; use the first answer
- Cache, colocate data near users, precompute, and reduce sequential round trips
```

**Key takeaway:** Measure and promise percentiles, never averages.

---

## 7. Throughput and utilisation

**Definition:** Throughput is how many requests per second the system completes; it is different from latency, which is how long each one takes.

A highway's throughput is cars per hour; latency is your travel time. Pushing more cars on raises throughput only until jams form, and then travel time explodes.

### The problem

```text
Server at 95% CPU utilisation. A small burst arrives.
Requests queue; queueing delay grows sharply as utilisation nears 100%.
p99 jumps from 50 ms to 3 s even though throughput barely rose.
```

Little's law (L = arrival rate x time in system) ties them together: when requests stay longer, more of them pile up in the system.

### Better design

Run critical resources at about 50-70% utilisation, autoscale on that signal, and shed load (reject early with 429 or 503) rather than queueing forever.

**Trade-offs:**
- Batching raises throughput but adds latency; spare headroom costs money.

**Key takeaway:** Keep headroom; latency explodes near 100% utilisation.

---

## 8. Graceful degradation

**Definition:** When a part fails, keep the core working with reduced features instead of failing completely.

A restaurant out of one dish still serves the rest of the menu.

### The problem

```text
Product page = product info + price + reviews + recommendations
Recommendations service times out after 30 s -> the whole page returns 500.
```

A non-critical feature took down the critical path.

### Better design

```text
Recommendations: 200 ms timeout + circuit breaker -> fall back to "top sellers" (cached)
Reviews:         serve stale cached reviews, or hide the section
Product + price: critical; served from DB/cache with replicas
```

A circuit breaker stops calling a failing dependency for a while so it can recover. The page still sells the product.

**Key takeaway:** Decide in advance what is critical and what can be dropped.

---

## In an HLD interview

- **URL Shortener / API Gateway:** stateless app tier behind a load balancer; redirects stay available even when analytics is down.
- **Payment System:** reliability beats availability; idempotency keys and durable writes before saying "success".
- **News Feed / Amazon E-commerce:** graceful degradation; the feed or product page works without recommendations or ads.
- **Google Search / Metrics:** fan-out to many shards makes p99 the real target; use timeouts and hedged requests.
- **What to SAY:** "The app tier is stateless so it scales out; I'll remove each SPOF with replicas across zones, target p99 latency, and degrade non-critical features first."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Vertical vs horizontal | Bigger box vs more boxes | Have I hit the single-box ceiling? |
| Stateless services | State lives in stores, not servers | Can any instance serve this request? |
| Availability | Series multiplies down, parallel up | How many nines, and through which path? |
| SPOF / redundancy | Spare copies in separate zones | What if this box dies? |
| Reliability | Correct over time, no data loss | Can a retry or bug corrupt data? |
| Latency percentiles | p99, not average | What does the slowest 1% see? |
| Throughput | Requests completed per second | Am I running too close to 100%? |
| Graceful degradation | Drop extras, keep the core | What can fail without hurting the main flow? |

## Final memory aid

- **Scale out** stateless apps; **scale up** databases first
- **State** goes to Redis, the DB or object storage
- **Series** multiplies down; **redundancy** multiplies up
- **Every box** can die: find the SPOFs
- **Up** is not the same as **correct**
- **p99**, never the average
- **50-70%** utilisation keeps latency calm
- **Degrade**, do not die

=== hld-networking | HLD | Networking essentials: DNS, TCP/UDP, HTTP, TLS and proxies ===
Every arrow on a system design diagram is a network hop with its own costs: finding the address, opening a connection, encrypting it, and passing through proxies. Knowing what happens at each step explains where latency comes from, why connection reuse matters, and where to put caching, security and routing. This chapter walks through each layer with a small failure and its fix, then ties them together in "what happens when you type a URL".

## 1. DNS resolution and TTL

**Definition:** DNS (Domain Name System) turns a name like `api.example.com` into an IP address, and caches the answer for a time called the TTL (time to live).

It works like a phone directory with many local copies. Your browser and OS keep a cache; on a miss, a recursive resolver (usually your ISP's or a public one like 8.8.8.8) asks the root servers, then the `.com` servers, then the domain's authoritative server, and caches the result.

### The problem

```text
api.example.com  A  203.0.113.10   TTL 86400   (24 hours)
The server at 203.0.113.10 dies; you switch the record to 203.0.113.20.
Resolvers and clients keep using the old IP for up to a day.
```

A long TTL means failover through DNS is slow. Some clients also cache beyond the TTL, so DNS changes are never instant.

### Better design

```text
api.example.com  A  203.0.113.10   TTL 60      health-checked, auto-switches on failure
Global traffic:  geo/latency-based DNS returns the nearest healthy region
Instant failover: anycast IP or a global load balancer in front, so the IP never changes
```

**Trade-offs:**
- Short TTLs mean more DNS queries and slightly slower first requests; long TTLs mean slow changes.

**Key takeaway:** TTL is a dial between fast failover and fewer lookups.

---

## 2. TCP vs. UDP

**Definition:** TCP is a connection-based protocol that delivers bytes reliably and in order; UDP sends independent packets with no delivery or ordering guarantee.

TCP is registered post with tracking and redelivery; UDP is shouting across a room. TCP starts with a three-way handshake (SYN, SYN-ACK, ACK) that costs one round trip before any data flows.

### The problem

```text
Video call over TCP: one packet is lost.
TCP holds back every later packet until the lost one is resent (~1 round trip).
The call freezes, then plays stale audio that is no longer useful.
```

This is head-of-line blocking: one lost packet delays everything behind it. For live media, late data is worse than missing data.

### Better design

```text
Live video/voice, games -> UDP (or WebRTC on top of it): skip lost packets, keep going
DNS lookups             -> UDP (small, single request/response; retry if lost)
APIs, DB connections    -> TCP: correctness and order matter
HTTP/3                  -> QUIC over UDP, with its own reliability per stream
```

**Key takeaway:** Use TCP when every byte matters, UDP when freshness matters more.

---

## 3. HTTP/1.1 vs. HTTP/2 vs. HTTP/3

**Definition:** Three versions of the same request/response protocol that differ in how many requests can share one connection and how they handle packet loss.

| Version | Transport | Key idea | Weak spot |
|---|---|---|---|
| HTTP/1.1 | TCP | One request at a time per connection; keep-alive | Browsers open ~6 connections per host |
| HTTP/2 | TCP | Many streams multiplexed on one connection; binary; header compression | One lost TCP packet stalls all streams |
| HTTP/3 | QUIC (UDP) | Independent streams; transport and TLS handshake combined | Some networks block or throttle UDP |

### The problem

A page needs 80 small files over HTTP/1.1. With ~6 connections, requests wait in line behind each other, and each new connection pays its own handshakes.

### Better design

HTTP/2 sends all 80 requests at once over one connection. HTTP/3 also stops a single lost packet from stalling every stream, and survives a phone switching from Wi-Fi to mobile data (connection migration). gRPC runs on HTTP/2 because it needs multiplexed, bidirectional streams.

**Key takeaway:** HTTP/2 fixes application-level queueing; HTTP/3 also fixes TCP-level head-of-line blocking.

---

## 4. Keep-alive and connection pooling

**Definition:** Keep-alive reuses an open connection for many requests; a connection pool keeps a set of open connections ready for reuse.

Opening a connection is like dialling a call: you pay setup time before you can talk. Reusing it skips that cost.

### The problem

```java
// creates a new client (and new connections) for every call
String getPrice(String sku) throws Exception {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req = HttpRequest.newBuilder(URI.create(PRICE_URL + sku)).build();
    return client.send(req, HttpResponse.BodyHandlers.ofString()).body();
}
```

Every call pays a TCP handshake plus a TLS handshake. At 5,000 calls/s that wastes CPU on both sides, and can exhaust ephemeral ports.

### Better design

```java
private static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(500))
        .build();                         // shared; pools and reuses connections

String getPrice(String sku) throws Exception {
    HttpRequest req = HttpRequest.newBuilder(URI.create(PRICE_URL + sku))
            .timeout(Duration.ofSeconds(2)).build();
    return CLIENT.send(req, HttpResponse.BodyHandlers.ofString()).body();
}
```

One shared client keeps connections open and adds timeouts. Database connection pools (such as HikariCP) apply the same idea and also cap how many connections hit the database.

**Key takeaway:** Create clients once, reuse connections, and always set timeouts.

---

## 5. TLS handshake

**Definition:** TLS (Transport Layer Security, the "S" in HTTPS) encrypts traffic, detects tampering, and proves the server's identity with a certificate.

During the handshake the client and server agree on keys, and the server presents a certificate signed by a trusted certificate authority (CA). TLS 1.3 needs one round trip for this; TLS 1.2 needed two.

### The problem

```text
User in India, server in the US, round trip ~200 ms. Cold HTTPS request:
  TCP handshake          1 RTT   200 ms
  TLS 1.2 handshake      2 RTT   400 ms
  HTTP request/response  1 RTT   200 ms
                                 ~800 ms before the first byte of the page
```

### Better design

```text
TLS 1.3                        -> 1 RTT for the handshake (0-RTT on resumption, replay-safe requests only)
Terminate TLS at a nearby edge -> the handshakes cross ~20 ms, not 200 ms
Reuse connections              -> handshake paid once, not per request
Inside the network             -> re-encrypt or use mTLS (both sides present certificates)
```

TLS termination means decrypting at the load balancer or CDN. mTLS (mutual TLS) is the standard way services prove identity to each other in a service mesh.

**Key takeaway:** Handshakes cost round trips; terminate near the user and reuse connections.

---

## 6. Forward vs. reverse proxy

**Definition:** A forward proxy acts for clients going out; a reverse proxy acts for servers, receiving traffic coming in.

A forward proxy is a company's reception desk that places outside calls for employees. A reverse proxy is a hotel front desk that receives every visitor and sends them to the right room.

### The problem

```text
Internet -> app-1 (public IP)
Internet -> app-2 (public IP)
Internet -> app-3 (public IP)
```

Every server is exposed, each handles its own TLS certificate, clients must know which one to call, and there is no single place for rate limiting or routing.

### Better design

```nginx
upstream app { server 10.0.1.11:8080; server 10.0.1.12:8080; server 10.0.1.13:8080; }

server {
    listen 443 ssl http2;                 # TLS terminated here
    location /api/ { proxy_pass http://app; }       # load balanced
    location /static/ { root /var/www; expires 7d; } # served and cached here
}
```

The reverse proxy (Nginx, Envoy, HAProxy, a cloud load balancer or an API gateway) handles TLS, load balancing, routing, caching, rate limiting and logging, and hides the internal servers.

### Forward proxy vs. reverse proxy

- **Forward:** sits next to clients; the server sees the proxy's IP. Used for egress filtering and outbound caching.
- **Reverse:** sits next to servers; the client sees only the proxy. Used for load balancing, TLS and routing.
- **Sidecar:** in a service mesh each service gets its own local proxy for service-to-service traffic.

**Key takeaway:** Put a reverse proxy in front of every fleet of servers.

---

## 7. NAT

**Definition:** NAT (Network Address Translation) lets many devices with private IP addresses share one public IP address.

Private ranges such as `10.0.0.0/8` and `192.168.0.0/16` are not routable on the internet. The NAT device rewrites outgoing packets to its public IP and remembers a port mapping so replies find their way back, like a company switchboard with one external number.

### The problem

```text
Phone (192.168.1.5) behind home router NAT.
Chat server tries to open a connection TO the phone to deliver a message.
There is no mapping for unsolicited inbound traffic -> dropped.
```

Servers cannot start connections to clients behind NAT. Idle mappings also expire, silently breaking long-lived connections.

### Better design

```text
Client opens the connection outward (WebSocket / long-lived TCP) and keeps it alive
with periodic heartbeats (e.g. every 30-60 s); the server pushes messages down it.
Cloud: app servers in private subnets reach the internet through a NAT gateway
       but cannot be reached directly from it.
```

Peer-to-peer calls use helper techniques (STUN to discover the public address, TURN to relay when direct paths fail).

**Key takeaway:** Behind NAT, the client must dial out; the server cannot dial in.

---

## 8. What happens when you type a URL

**Definition:** The full journey of `https://shop.example.com/cart` from keypress to rendered page.

### The sequence

```text
1. DNS:   browser cache -> OS cache -> recursive resolver -> root -> .com -> authoritative
          -> IP of the nearest CDN edge (via geo-DNS or anycast)
2. TCP:   SYN, SYN-ACK, ACK                                  (1 RTT)
3. TLS:   TLS 1.3 handshake, certificate checked             (1 RTT; QUIC merges 2+3)
4. HTTP:  GET /cart sent over the encrypted connection
5. Edge:  CDN serves cached static parts; forwards /cart to the origin
6. Origin: load balancer / reverse proxy -> stateless app server -> cache / DB
7. Back:  response flows back; browser parses HTML, fetches CSS/JS/images
          over the SAME connection (HTTP/2 or HTTP/3 multiplexing)
8. Render: page painted; the connection stays open for the next click
```

### Common mistake

Listing only "DNS, then the server responds". Interviewers want the round trips counted and the places where each cost is cut: DNS caching, edge TLS termination, connection reuse and caching at every layer.

**Key takeaway:** Count the round trips, then show where each one is saved.

---

## In an HLD interview

- **Netflix / YouTube:** geo-DNS or anycast to the nearest CDN edge, TLS terminated at the edge, HTTP/3 for lossy mobile networks.
- **Chat / WhatsApp / Ride Tracking:** clients behind NAT keep a long-lived WebSocket open with heartbeats; servers push over it.
- **API Gateway / Rate Limiter:** a reverse proxy layer handles TLS, routing, auth and rate limiting before traffic reaches services.
- **Payment System / microservices:** pooled connections with timeouts between services, and mTLS inside the network.
- **What to SAY:** "Users resolve to the nearest edge via DNS; TLS terminates there; behind it a reverse proxy load-balances to stateless services over pooled, mTLS connections."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| DNS and TTL | Name to IP, cached for TTL | How fast must failover be? |
| TCP vs UDP | Reliable order vs fresh speed | Is late data worse than lost data? |
| HTTP/1.1, 2, 3 | Multiplexing, then per-stream recovery | Are requests queueing behind each other? |
| Keep-alive / pooling | Reuse connections | Am I paying handshakes on every call? |
| TLS handshake | Encrypt, verify, costs round trips | Where do I terminate TLS? |
| Forward vs reverse proxy | Acts for clients vs for servers | Which side does this proxy protect? |
| NAT | Many private IPs share one public IP | Who opens the connection? |
| Typing a URL | DNS, TCP, TLS, HTTP, edge, origin | How many round trips, and which can I save? |

## Final memory aid

- **DNS:** name to IP; TTL trades failover speed for lookups
- **TCP:** reliable and ordered; **UDP:** fast and fresh
- **HTTP/2** multiplexes; **HTTP/3** avoids TCP head-of-line blocking
- **Reuse** connections; always set timeouts
- **TLS 1.3:** one round trip; terminate near the user
- **Reverse proxy** guards servers; **forward proxy** guards clients
- **NAT:** clients dial out, servers push back
