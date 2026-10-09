=== hld-api-design | HLD | API design and service communication ===
APIs are the contracts between clients and services and between services themselves. A good API is predictable, evolvable and safe to retry; the communication style you pick (REST, gRPC, GraphQL, events) decides coupling, latency and how failures propagate. This chapter covers REST resource modelling, status codes, pagination, filtering, versioning and error formats, then gRPC and GraphQL trade-offs, sync versus async, gateways and BFFs, service discovery, resilience on calls, and backward compatibility, with Spring examples throughout.

## Designing the contract first
In an interview, after requirements and estimates, write 3–6 endpoints with request and response shapes. It pins down the data model and exposes hidden requirements (pagination, idempotency, auth). In real projects, contract-first (OpenAPI or `.proto` files reviewed before code) lets clients and servers develop in parallel and generates SDKs, mocks and contract tests.

## REST resource modelling
- **Resources are nouns**, collections are plural, hierarchy expresses ownership: `/users/{id}/orders/{orderId}`. Keep nesting shallow (one level); `/orders/{orderId}` is fine on its own.
- **HTTP methods carry the verb:**

| Method | Semantics | Idempotent | Safe | Typical response |
|---|---|---|---|---|
| GET | Read | Yes | Yes | 200 |
| POST | Create in a collection / non-idempotent action | No | No | 201 + `Location`, or 202 |
| PUT | Replace whole resource (or create at client-chosen ID) | Yes | No | 200 / 204 / 201 |
| PATCH | Partial update (JSON Merge Patch / JSON Patch) | Not necessarily | No | 200 / 204 |
| DELETE | Remove | Yes | No | 204 |

- **Actions that are not CRUD:** model them as sub-resources or state transitions: `POST /orders/{id}/cancellation`, `POST /payments/{id}/refunds`. Avoid `/cancelOrder` RPC-style paths in a REST API, though a pragmatic `POST /orders/{id}:cancel` (Google AIP style) is acceptable if consistent.
- **Long-running operations:** `POST /videos` → `202 Accepted` with `Location: /operations/{opId}`; clients poll or receive a webhook/push.
- Use consistent naming (`snake_case` or `camelCase`, pick one), ISO-8601 UTC timestamps, string IDs (future-proof against 64-bit overflow in JavaScript), and money as integer minor units plus currency.

## Status codes that matter
| Code | When |
|---|---|
| 200 OK / 201 Created / 204 No Content | Success variants |
| 202 Accepted | Queued for async processing |
| 301/308, 302/307 | Redirects (URL shortener: 301 cacheable vs 302 for analytics) |
| 304 Not Modified | Conditional GET with `If-None-Match` matched |
| 400 Bad Request | Malformed syntax |
| 401 Unauthorized / 403 Forbidden | Not authenticated / authenticated but not allowed |
| 404 Not Found | Resource missing (also to hide existence from unauthorised callers) |
| 409 Conflict | State conflict, duplicate, idempotency key in flight |
| 412 Precondition Failed | `If-Match` ETag mismatch (optimistic locking) |
| 422 Unprocessable Entity | Validation errors on a well-formed body |
| 429 Too Many Requests | Rate limited, with `Retry-After` |
| 500 / 502 / 503 / 504 | Server bug / bad upstream / overloaded or down / upstream timeout |

Clients base retry decisions on these codes, so correctness matters: returning 500 for validation errors causes pointless retries.

## Error format
Use one consistent machine-readable shape, ideally **RFC 9457 Problem Details** (`application/problem+json`):
```json
{
  "type": "https://api.example.com/errors/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Wallet balance 1200 is less than amount 5000",
  "instance": "/v1/payments/req_8f2c",
  "code": "INSUFFICIENT_FUNDS",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [{"field": "amount", "message": "must be <= 1200"}]
}
```
Spring 6 / Boot 3 supports it natively:
```java
@RestControllerAdvice
class ApiErrors extends ResponseEntityExceptionHandler {
    @ExceptionHandler(InsufficientFundsException.class)
    ProblemDetail insufficient(InsufficientFundsException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setType(URI.create("https://api.example.com/errors/insufficient-funds"));
        pd.setProperty("code", "INSUFFICIENT_FUNDS");
        return pd;
    }
}
```
Never leak stack traces or SQL in errors; include a trace ID so support can find the logs.

## Pagination
| | Offset (`?page=40&size=20`) | Cursor / keyset (`?after=eyJpZCI6...&limit=20`) |
|---|---|---|
| SQL | `ORDER BY created_at DESC LIMIT 20 OFFSET 800` | `WHERE (created_at, id) < (:ts, :id) ORDER BY created_at DESC, id DESC LIMIT 20` |
| Deep pages | Slow: DB scans and discards OFFSET rows | Constant: index seek |
| Concurrent inserts/deletes | Skips or duplicates items | Stable |
| Jump to page N | Yes | No (next/prev only) |
| Total count | Easy but expensive (`COUNT(*)`) | Usually omitted or approximate |
| Fits | Admin tables, small datasets | Feeds, timelines, chat history, large lists, infinite scroll |

The cursor is an **opaque** base64 encoding of the last item's sort key (plus a tie-breaker ID), so you can change its internals later. Response:
```json
{ "data": [ ... ], "next_cursor": "eyJ0cyI6IjIwMjYtMTAtMDlUMTA6MDA6MDBaIiwiaWQiOjk4MTJ9", "has_more": true }
```
Cap `limit` server-side (e.g. max 100).

## Filtering, sorting, sparse fields and caching
- Filtering: `GET /orders?status=SHIPPED&created_after=2026-10-01`. Sorting: `?sort=-created_at,id`. Only allow indexed fields, or you have built a DoS endpoint.
- Sparse fieldsets: `?fields=id,name,price` to trim payloads for mobile.
- Expansion: `?expand=customer` to embed related resources and save round trips.
- Caching: `Cache-Control`, `ETag` with `If-None-Match` → 304, `Vary` on headers that change the response. GET responses for public data can sit behind a CDN.
- Search beyond simple filters belongs in a search endpoint backed by a search engine.

## Versioning and backward compatibility
| Strategy | Example | Pros | Cons |
|---|---|---|---|
| URI | `/v1/orders` | Obvious, easy routing and caching | Version per whole API |
| Header | `Accept: application/vnd.acme.v2+json` | Clean URLs, per-resource | Less visible, harder to test in a browser |
| Query | `?api-version=2026-10-01` | Simple | Pollutes caches if misused |
| Date-based (Stripe) | `Stripe-Version: 2026-09-30` pinned per account | Fine-grained evolution | Server must keep transformation layers |

Most important is **not needing new versions**: evolve additively.
- **Backward-compatible (safe):** adding optional request fields, adding response fields, adding endpoints, adding enum values *if clients were told to tolerate unknown ones*.
- **Breaking:** removing or renaming fields, changing types or meaning, making optional fields required, changing default behaviour, tightening validation, changing error codes.
- Follow the **robustness principle**: clients ignore unknown fields (`@JsonIgnoreProperties(ignoreUnknown = true)`, Jackson's `FAIL_ON_UNKNOWN_PROPERTIES=false`), servers accept old shapes.
- Deprecate with `Deprecation` and `Sunset` headers, usage metrics per version, and a published timeline.
- Verify with **consumer-driven contract tests** (Pact, Spring Cloud Contract) in CI, so a provider change that breaks a consumer fails the build.

## Idempotency in the API
GET, PUT and DELETE are idempotent by definition; POST and PATCH are not. For creation and money movement accept an `Idempotency-Key` header and return the stored response on replay (see the idempotency chapter). Let clients choose IDs (`PUT /uploads/{uuid}`) where natural.

## Authentication and security basics
OAuth 2.0 / OIDC with short-lived JWT access tokens for users; mTLS or signed service tokens between services; API keys for server-to-server partners (hashed at rest, scoped, rotatable). Validate input sizes, enforce authorisation on every object (prevent IDOR: check the order belongs to the caller), rate limit per key, and sign webhooks with HMAC plus a timestamp to stop replays.

## gRPC
- Contract in **Protocol Buffers**; code generated for many languages; binary encoding is compact and fast to parse; runs over **HTTP/2** with multiplexed streams on one connection.
- Four call types: unary, server streaming, client streaming, bidirectional streaming.
- Built-in **deadlines** (propagate across hops), cancellation, status codes, metadata, interceptors.
```proto
syntax = "proto3";
package ride.v1;

service DriverLocation {
  rpc GetNearby(NearbyRequest) returns (NearbyResponse);
  rpc StreamLocations(stream LocationUpdate) returns (Ack);      // client streaming
  rpc WatchTrip(TripId) returns (stream TripEvent);               // server streaming
}
message LocationUpdate {
  string driver_id = 1;
  double lat = 2;
  double lng = 3;
  int64  ts_ms = 4;
  // field numbers are the wire contract: never reuse or renumber; add new fields with new numbers
  reserved 5;
}
```
- Protobuf evolution rules: add fields with new numbers, never change a number's type, `reserved` removed numbers and names, all fields optional by default in proto3.
- Weaknesses: browsers need gRPC-Web or a proxy; binary payloads are harder to debug (use `grpcurl`); HTTP/2 long-lived connections need **L7 load balancing** (Envoy, a service mesh or client-side balancing), because an L4 balancer pins all requests of a connection to one backend.
- Use for internal, high-QPS, low-latency, polyglot service-to-service calls and streaming.

## GraphQL
- One endpoint; the client sends a query describing exactly the fields it needs; a schema defines types; resolvers fetch each field.
- **Pros:** no over- or under-fetching, one round trip for nested data (great for mobile and varied UIs), strongly typed schema with introspection, schema evolution by adding fields and `@deprecated`.
- **Cons:**
  - **N+1 queries:** resolving `author` for 50 posts makes 50 calls; fix with **DataLoader** batching (Spring for GraphQL `@BatchMapping`).
  - **HTTP caching is harder** (POST to one URL); use persisted queries with GET and client caches (Apollo).
  - **Abuse:** deeply nested or huge queries; enforce depth and complexity limits, timeouts, persisted query allow-lists.
  - Errors return 200 with an `errors` array, which confuses generic monitoring.
- Common placement: a **GraphQL BFF or federation gateway** in front of REST/gRPC microservices (Apollo Federation, Netflix DGS).

| | REST | gRPC | GraphQL |
|---|---|---|---|
| Transport | HTTP/1.1 or 2, JSON | HTTP/2, Protobuf | HTTP, JSON |
| Contract | OpenAPI (optional) | `.proto` (mandatory) | Schema (mandatory) |
| Best for | Public APIs, CRUD, cacheable reads | Internal service mesh, streaming, low latency | Client-driven aggregation for UIs |
| Caching | Excellent (HTTP, CDN) | Application-level | Hard; client-side |
| Browser | Native | Needs gRPC-Web | Native |
| Streaming | SSE/WebSocket alongside | Native bidi | Subscriptions (WebSocket) |

## Synchronous vs asynchronous communication
- **Synchronous** (REST/gRPC): simple mental model, immediate result, but temporal coupling: if the callee is slow or down, so is the caller. Availability multiplies across a chain (five 99.9% services in series give about 99.5%).
- **Asynchronous** (queues, events): the caller only needs the broker; spikes are absorbed; consumers scale independently. Costs: eventual consistency, duplicates, ordering, harder tracing.
- **Async request-reply:** accept synchronously (validate, persist, 202 with an ID), process asynchronously, report via polling, webhook, SSE or push. This is the default shape for uploads, report generation, payouts and transcoding.
- Rule of thumb: use sync calls on the **user-facing read path** and for commands needing an immediate answer; use events for **side effects** and for propagating state to other services. Avoid long synchronous chains; a service that needs another's data constantly should keep a local replica fed by events.

## API gateway and BFF
An **API gateway** (Spring Cloud Gateway, Kong, Envoy, AWS API Gateway) is the single entry point that handles cross-cutting concerns:
- TLS termination, authentication (JWT validation), coarse authorisation.
- Routing, path rewriting, canary and weighted routing.
- Rate limiting and quotas, request size limits, WAF.
- Request/response transformation, protocol translation (REST to gRPC).
- Observability: access logs, metrics, trace ID injection.

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: orders
          uri: lb://order-service           # resolved via service discovery
          predicates:
            - Path=/api/v1/orders/**
          filters:
            - StripPrefix=2
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 50
                redis-rate-limiter.burstCapacity: 100
                key-resolver: "#{@apiKeyResolver}"
            - name: CircuitBreaker
              args:
                name: ordersCb
                fallbackUri: forward:/fallback/orders
```
Keep business logic out of the gateway; it should be thin and highly available.

A **Backend-for-Frontend (BFF)** is a per-client-type service (web BFF, iOS BFF, partner API) that aggregates and shapes data for that client, so the mobile home screen is one call instead of eight. It is owned by the front-end team. Netflix and SoundCloud popularised the pattern.

## Service discovery and load balancing
Instances come and go (autoscaling, deploys), so callers cannot hard-code addresses.
- **Server-side discovery:** the caller hits a stable name; a load balancer or DNS resolves to healthy instances. Kubernetes `Service` (ClusterIP plus kube-proxy, DNS `order-service.prod.svc`) is the common case.
- **Client-side discovery:** the client queries a registry (Eureka, Consul) and balances itself (Spring Cloud LoadBalancer, gRPC client-side LB), enabling smarter policies such as least outstanding requests.
- **Service mesh** (Istio, Linkerd): sidecar proxies do discovery, mTLS, retries, timeouts and telemetry transparently.
- Health checks drive membership: readiness gates traffic; liveness restarts stuck processes.

## Resilience on every remote call (brief)
- **Timeouts** on connect and read, shorter than the caller's own budget; propagate deadlines.
- **Retries** only for idempotent operations or with idempotency keys; exponential backoff with jitter; retry budget.
- **Circuit breaker:** open after a failure-rate threshold, fail fast, half-open probes.
- **Bulkheads:** separate pools per dependency.
- **Fallbacks:** cached or default data, degraded features.
```java
@Service
class PricingClient {
    private final RestClient rest;
    @CircuitBreaker(name = "pricing", fallbackMethod = "cachedPrice")
    @Retry(name = "pricing")
    @TimeLimiter(name = "pricing")
    CompletableFuture<Price> price(String sku) {
        return CompletableFuture.supplyAsync(() ->
            rest.get().uri("/prices/{sku}", sku).retrieve().body(Price.class));
    }
    CompletableFuture<Price> cachedPrice(String sku, Throwable t) {
        return CompletableFuture.completedFuture(priceCache.getOrDefault(sku, Price.unavailable()));
    }
}
```

## Webhooks
For notifying external systems: sign with HMAC over `timestamp.body`, include a unique event ID for dedup, retry with exponential backoff for up to a day or more, deliver at-least-once and possibly out of order (receivers should fetch current state by ID if order matters), and offer a dashboard to replay failed deliveries.

## Real-world systems
- **Stripe:** resource-oriented REST, idempotency keys, date-based versioning pinned per account, expandable objects, cursor pagination (`starting_after`).
- **Google APIs:** gRPC-first with REST transcoding, AIP design guidelines, long-running operations resource.
- **GitHub:** REST plus GraphQL v4 API; ETag-based conditional requests that do not count against rate limits.
- **Netflix:** GraphQL federation (DGS) at the edge, gRPC internally.

## How it shows up in interview problems
- **URL shortener:** `POST /urls {long_url, custom_alias?, ttl?}` → 201 `{short_code}`; `GET /{code}` → 301/302 with `Location`.
- **News feed / chat history:** cursor pagination by `(created_at, id)` or message sequence.
- **Payments / e-commerce:** `POST /payments` with `Idempotency-Key`; webhooks for async status; 202 for payouts.
- **YouTube/Dropbox upload:** `POST /uploads` returns a pre-signed URL and upload ID; processing status via polling or push.
- **Uber:** gRPC streaming for driver location ingestion; REST for ride requests; push for trip updates.
- **Rate limiter / API gateway:** where limits are enforced and the 429 contract.
- **Search:** `GET /search?q=&filters=&cursor=` with relevance sort and facets.
- **Job scheduler:** `POST /jobs` returns 201 with job ID; `GET /jobs/{id}/runs` paginated.

## Common pitfalls
- Verbs in URLs and inconsistent naming across endpoints.
- 200 for everything, with errors buried in the body; or 500 for client mistakes.
- Offset pagination on large, changing datasets.
- Breaking changes shipped without a version or deprecation period; strict deserialisation that fails on new fields.
- Chatty APIs (N calls to render one screen) instead of a BFF or composite endpoint.
- Deep synchronous call chains without timeouts or circuit breakers.
- gRPC behind an L4 load balancer, so all traffic sticks to one pod.
- Unbounded GraphQL queries with no complexity limits.

## Interview questions
1. **Cursor or offset pagination for a news feed, and why?** Cursor (keyset on `(created_at, id)`): constant-time deep pages via index seeks and stable results while new posts arrive. Offset is fine for small admin lists that need page jumps.
2. **How do you make `POST /payments` safe to retry?** Require an `Idempotency-Key`, store the outcome keyed by it with a request hash, return the stored response on replay, and pass the key downstream.
3. **REST, gRPC or GraphQL for internal calls between 30 microservices?** gRPC for typed contracts, low latency, streaming and deadlines, with L7 or client-side load balancing; REST at the public edge; GraphQL optionally as an aggregation layer for UIs.
4. **How do you evolve an API without breaking clients?** Additive changes only, tolerant readers, contract tests, deprecation headers and metrics, and a new version only for unavoidable breaks, running both during migration.
5. **What belongs in an API gateway vs a BFF?** Gateway: generic cross-cutting concerns (auth, rate limits, routing, TLS, observability). BFF: client-specific aggregation and shaping, owned by the front-end team.
6. **When would you choose async over sync communication?** When the caller does not need the result immediately, work is slow or spiky, multiple services react to the same fact, or you need to decouple availability. Return 202 and notify later.
7. **How does service discovery work in Kubernetes?** A `Service` gets a stable DNS name and virtual IP; endpoints are updated from ready pods; kube-proxy or a mesh routes to them. Client-side discovery (Eureka/Consul) is the non-Kubernetes alternative.

## Cheat sheet
- Nouns + HTTP verbs; shallow nesting; actions as sub-resources; 202 + operation resource for long jobs.
- Status codes: 201, 202, 304, 400, 401/403, 404, 409, 412, 422, 429, 503 — correctness drives client retries.
- Errors: RFC 9457 Problem Details with code + traceId.
- Pagination: opaque keyset cursors for large/changing lists; cap limits.
- Versioning: evolve additively, tolerant readers, contract tests, Deprecation/Sunset.
- POST/PATCH need idempotency keys; GET/PUT/DELETE are idempotent.
- gRPC internal (HTTP/2, protobuf, deadlines, streaming, L7 LB); REST public; GraphQL for UI aggregation (DataLoader, complexity limits).
- Sync for immediate reads; async for side effects and slow work.
- Gateway = cross-cutting; BFF = per-client aggregation; discovery via K8s Service, Eureka/Consul or mesh.
- Every call: timeout, bounded retry with jitter, circuit breaker, bulkhead, fallback.

=== hld-realtime | HLD | Real-time communication: polling, long polling, SSE, WebSockets ===
Chat, live location, notifications, dashboards, collaborative editing and LLM token streaming all need the server to push data to clients as it happens. HTTP was designed for request-response, so real-time delivery is built from techniques that range from repeated polling to persistent full-duplex connections. This chapter explains how each technique works on the wire, how to choose, and, most importantly for interviews, how to scale millions of persistent connections with connection registries, pub/sub fan-out, heartbeats, resumable delivery, presence and mobile push.

## Short polling
The client asks on a timer: `GET /notifications?since=123` every N seconds.
- **Pros:** trivial, stateless, works through every proxy and firewall, cacheable.
- **Cons:** average latency is N/2; most responses are empty, so cost scales with clients × frequency regardless of activity. 1M clients polling every 5 s is 200K requests/s for mostly nothing.
- **Use when:** updates are infrequent and latency tolerance is seconds to minutes (job status, order tracking page, dashboards refreshed every 30 s).

## Long polling
The client sends a request; the server **holds it open** until there is data or a timeout (e.g. 30 s), then responds; the client immediately sends the next request.
```
Client                         Server
  | GET /events?cursor=41 ----> |  (no data yet; park request)
  |                             |  ... 12 s later, event 42 arrives
  | <---- 200 [event 42] ------ |
  | GET /events?cursor=42 ----> |  (park again)
  |                             |  ... 30 s timeout
  | <---- 204 No Content ------ |
  | GET /events?cursor=42 ----> |
```
- **Pros:** near-real-time latency over plain HTTP; works everywhere; the cursor makes it naturally resumable.
- **Cons:** a request/response (headers, possibly TLS and auth) per message batch; a gap between response and next request where events must be buffered server-side; parked requests consume connections, so the server must be asynchronous (Servlet async, WebFlux `DeferredResult`), not thread-per-request.
- **Use when:** you need push-like behaviour but cannot rely on WebSockets or SSE (restrictive corporate proxies, legacy clients). Dropbox used long polling for change notifications; early Facebook chat did too.

## Server-Sent Events (SSE)
A single long-lived HTTP response with `Content-Type: text/event-stream` that the server keeps writing to.
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 1042
event: price
data: {"symbol":"INFY","price":1874.5}

id: 1043
event: price
data: {"symbol":"TCS","price":4012.0}

: keep-alive comment
```
- Browser API: `new EventSource('/stream')` with **automatic reconnect** and the **`Last-Event-ID`** header sent on reconnect, so the server can resume from where the client left off. Servers can set `retry:` to tune reconnect delay.
- **Pros:** plain HTTP (works with existing auth, proxies, HTTP/2 multiplexing), built-in resume, simple to implement and debug.
- **Cons:** server-to-client only (client sends via normal HTTP requests); UTF-8 text only; under HTTP/1.1 browsers limit about 6 connections per origin (HTTP/2 removes this); some proxies buffer responses unless disabled (`X-Accel-Buffering: no` for Nginx).
- **Use when:** one-way streams: notifications, live scores, stock tickers, build logs, progress updates, and **LLM token streaming** (OpenAI and Anthropic APIs stream over SSE).

### Spring WebFlux SSE example
```java
@RestController
@RequiredArgsConstructor
class NotificationStreamController {
    private final NotificationBus bus;          // backed by Redis pub/sub or Kafka
    private final NotificationStore store;      // durable, per-user sequence

    @GetMapping(path = "/v1/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    Flux<ServerSentEvent<Notification>> stream(
            @AuthenticationPrincipal Jwt jwt,
            @RequestHeader(value = "Last-Event-ID", required = false) Long lastId) {

        String userId = jwt.getSubject();
        Flux<Notification> missed = lastId == null ? Flux.empty()
                : store.findAfter(userId, lastId);                  // replay gap on reconnect
        Flux<Notification> live = bus.subscribe(userId);            // hot stream for this user

        Flux<ServerSentEvent<Notification>> events = Flux.concat(missed, live)
            .map(n -> ServerSentEvent.builder(n)
                    .id(String.valueOf(n.seq()))
                    .event(n.type())
                    .build());

        Flux<ServerSentEvent<Notification>> heartbeats = Flux.interval(Duration.ofSeconds(20))
            .map(i -> ServerSentEvent.<Notification>builder().comment("ping").build());

        return Flux.merge(events, heartbeats)
                   .onBackpressureBuffer(500, BufferOverflowStrategy.DROP_OLDEST);
    }
}
```
WebFlux runs on Netty's event loop, so tens of thousands of idle streams cost memory, not threads. (Subscribe to `live` before reading `missed` in production, then de-duplicate by sequence, to avoid a gap between the two.)

## WebSockets
An HTTP/1.1 request upgrades the TCP connection to a full-duplex, message-framed protocol:
```
GET /chat HTTP/1.1
Host: ws.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```
After the handshake both sides send frames (text, binary, ping, pong, close) with 2–14 bytes of overhead.
- **Pros:** bidirectional, lowest per-message overhead and latency, binary support.
- **Cons:** stateful connections that complicate load balancing, deploys and scaling; no built-in reconnect, resume, acks or multiplexing (you design them, or use a protocol like STOMP, MQTT or Socket.IO on top); some proxies kill idle connections, so heartbeats are needed.
- **Use when:** high-frequency two-way interaction: chat, multiplayer games, collaborative editing (Google Docs, Figma), trading terminals, driver apps.

## Comparison
| | Short polling | Long polling | SSE | WebSocket | Mobile push (APNs/FCM) |
|---|---|---|---|---|---|
| Direction | Client pull | Client pull, server-timed | Server → client | Both | Server → device OS |
| Latency | Up to interval | Near real time | Real time | Real time | Seconds, best effort |
| Overhead per message | Full HTTP request | Full HTTP request | Small (text frame) | Tiny (2–14 B) | Provider-managed |
| Connection state | None | Parked requests | Long-lived HTTP | Long-lived TCP | None on your side |
| Reconnect/resume | N/A | Cursor | Built-in `Last-Event-ID` | Build it yourself | N/A |
| Proxy/firewall friendliness | Best | Good | Good | Usually fine (443), some issues | N/A |
| Binary | Yes | Yes | No | Yes | Small payload only |
| Works with app closed | No | No | No | No | **Yes** |
| Typical use | Status pages | Fallback, change feeds | Notifications, tickers, LLM output | Chat, games, collaboration, live location | Wake-ups, alerts for offline users |

Decision shortcut: **one-way stream → SSE; two-way, frequent → WebSocket; app in background → push notification; everything else → polling.**

## Scaling WebSocket and SSE servers
### Architecture
```
 Clients ──TLS──> L4/L7 LB ──> Gateway tier (stateful, holds sockets)
                                  |  register: user → gateway  (Redis, TTL)
                                  |  subscribe: gateway's inbox channel/topic
                                  v
                         Pub/sub backbone (Redis pub/sub, Kafka, NATS)
                                  ^
                                  |  publish to recipient's gateway
                     Chat / trip / notification services (stateless)
                                  |
                         Durable store (Cassandra/DynamoDB) + push service
```
Separate the **connection gateway** (dumb, stateful, holds sockets, does auth and framing) from **stateless business services**. Gateways can then be scaled and deployed independently, and business logic changes without dropping connections.

### Capacity
With async I/O (Netty, WebFlux, Go, Erlang) one server holds 100K–1M mostly idle connections; the limits are memory per connection (TLS buffers, application state: plan ~10–50 KB), file descriptors (`ulimit -n`), ephemeral ports on the LB, and CPU for TLS handshakes during reconnect storms. Example: 50M concurrent users at 200K connections per box needs about 250 gateway servers, plus headroom for a zone failure.

### Load balancing and sticky sessions
- WebSockets pin a client to one server for the connection's lifetime, so the LB must support upgrades and long idle timeouts (raise the default 60 s, or send heartbeats more often).
- **Sticky sessions** (hash on user ID or cookie) are needed for long polling or Socket.IO fallbacks spanning several HTTP requests, and helpful for cache locality, but they are **not** a substitute for a registry: you still need to route messages from other servers.
- Use least-connections balancing for new connections, since connection counts drift.

### Connection registry
"Which gateway holds user X?" Maintain it in Redis:
```
HSET conn:user:42  device:ios-7f  gw-17     # a user may have several devices
EXPIRE conn:user:42 90                       # refreshed by heartbeats
```
On connect: register; on disconnect: remove; on gateway crash: entries expire via TTL. Alternatives: a consistent-hash ring mapping users to gateways (route the user's connection to its owner gateway, so no lookup is needed), or Kafka partitions owned by gateways.

### Fan-out via pub/sub
To deliver a message to user 42:
1. Chat service persists the message, assigns a sequence number.
2. Looks up `conn:user:42` → `gw-17` (and other devices).
3. Publishes to channel `gw-17` (Redis pub/sub or a per-gateway Kafka topic/partition).
4. `gw-17` receives it and writes to the socket.

Alternatives: **per-user or per-room channels** (each gateway subscribes to channels for users it holds; Redis pub/sub handles millions of channels, but Redis pub/sub is fire-and-forget, so durability comes from the message store plus resume). For group chats or live events with huge fan-out (a cricket match with 10M viewers), publish once per gateway that has subscribers, not once per user, and let the gateway fan out locally.

### Heartbeats and dead connection detection
TCP can look open for minutes after a phone loses signal (half-open connections). Send application-level pings every 15–30 s (WebSocket ping/pong or SSE comments); close connections that miss 2–3; refresh the registry TTL on each heartbeat. Heartbeats also keep NATs and proxies from timing out idle connections. Mobile clients should adapt intervals to save battery.

### Reconnection and resume with sequence numbers
Disconnects are routine (tunnels, Wi-Fi to 4G handover, deploys).
- Every message gets a **monotonic sequence number per conversation** (or per user inbox), assigned by the server at persistence time.
- The client stores the last sequence it processed and, on reconnect, sends `resume(conversationId, lastSeq)` (or SSE's `Last-Event-ID`); the server replays `seq > lastSeq` from the durable store, then switches to live.
- Clients **dedupe by message ID** and order by sequence, because replay and live streams can overlap.
- Reconnect with **exponential backoff and jitter**, otherwise a gateway restart causes 200K clients to reconnect in the same second (a thundering herd that can take down auth and the registry).
- Deploys: drain gateways gradually (send a "reconnect elsewhere" control frame, stop accepting new connections, close existing ones over minutes).

### Delivery receipts
Chat-style states:
```
client ──send(clientMsgId)──> server: persist, assign seq ──ack(seq)──> client     ✓ sent
server ──deliver(seq)──> recipient device ──ack(seq)──> server ──> sender            ✓✓ delivered
recipient opens chat ──read(upToSeq)──> server ──> sender                             ✓✓ read (blue)
```
The client-generated `clientMsgId` makes sends idempotent across retries. Read receipts are sent as a high-water mark (`read up to seq 981`), not per message, to cut traffic. Group chats aggregate receipts per member, often only on request.

### Presence
- Online/offline from the connection registry plus heartbeats; "last seen" timestamp written on disconnect or heartbeat expiry, with a debounce (e.g. 30 s) to absorb flaky reconnects.
- Fan-out is the cost: telling every contact about every status change is O(users × contacts). Mitigate by pushing presence only for **currently visible conversations**, fetching presence lazily when a chat opens, batching updates, and dropping presence entirely for large groups.
- Typing indicators are ephemeral: send via pub/sub only, never persist, rate limit.

### Backpressure on the socket
Slow consumers (bad networks) make server-side write buffers grow. Bound per-connection queues; drop or coalesce non-critical updates (only the latest location matters); disconnect consistently slow clients and let them resume from the store.

## Mobile push notifications (APNs / FCM)
When the app is backgrounded or killed, the OS closes your socket. Only the platform's push channel can reach the device:
- The app registers with **APNs** (iOS) or **FCM** (Android) and gets a **device token**; it sends the token to your backend, which stores `user → [tokens]`.
- Your notification service sends to APNs (HTTP/2, token-based auth) or FCM (HTTP v1 API) with the token and a small payload (APNs max 4 KB).
- Delivery is **best effort**: may be delayed, coalesced or dropped; not ordered; rate limited. Treat it as a **wake-up/nudge**, then the app connects and syncs over your own channel using sequence numbers.
- Handle token invalidation responses (uninstalled app → remove token), collapse keys for replaceable updates, priority levels, and user notification preferences and quiet hours.
- Web Push (VAPID) is the browser equivalent.

## WebRTC (briefly)
For audio/video calls, screen sharing and peer-to-peer data, **WebRTC** sends media directly between peers over UDP (SRTP), with low latency and congestion control. Your servers still provide:
- **Signalling** (exchange SDP offers/answers and ICE candidates), typically over WebSockets.
- **STUN** servers so peers learn their public address, and **TURN** relays when NAT traversal fails (around 10–20% of calls, and the bandwidth cost driver).
- **SFUs** (selective forwarding units) for group calls: each participant uploads once, the SFU forwards streams, avoiding a full mesh.

## Worked examples
**Chat (WhatsApp/Slack):** WebSocket gateways; Redis registry `user → gateways`; chat service persists to Cassandra partitioned by conversation with per-conversation sequence numbers; Kafka (keyed by conversation ID) or Redis pub/sub routes to recipient gateways; acks for sent/delivered/read; resume from last sequence on reconnect; push notification via APNs/FCM when the recipient has no live connection; presence via heartbeats with lazy fan-out.

**Uber live tracking:** driver app sends GPS every 4 s over a persistent connection (WebSocket, MQTT or gRPC stream) to a location gateway; updates go to an in-memory geo index (Redis/H3) and to Kafka; the trip service publishes driver position to the rider subscribed to that trip (WebSocket or SSE); throttle to what the map needs and send only the latest position (drop stale ones); push notifications for "driver arrived" when the app is backgrounded.

**Live comments / sports scores:** SSE to millions of viewers via edge-fanout servers; publish once per server; sample or aggregate comments for huge events.

**Notification system:** in-app via SSE/WebSocket when online, APNs/FCM/email/SMS otherwise, with per-channel queues, user preferences and dedup.

**Collaborative editing:** WebSocket per document session, operations ordered by a server sequence, OT or CRDTs to merge concurrent edits, document sessions sharded so one server owns each active document.

## How it shows up in interview problems
- **Chat / WhatsApp / Slack:** the full gateway + registry + pub/sub + sequence + receipts + push design.
- **Uber / food delivery tracking:** bidirectional streams for drivers, server push to riders, throttled updates.
- **Notification system:** in-app real-time channel plus mobile push and fallbacks.
- **News feed:** "new posts available" via SSE or long poll; the feed itself fetched by normal paginated API.
- **Google Docs / collaborative editor:** WebSocket with operation sequencing.
- **Stock ticker / live sports / auctions:** SSE or WebSocket fan-out, coalescing to the latest value.
- **Dropbox sync:** long poll or WebSocket for "something changed", then fetch deltas by cursor.
- **BookMyShow seat map:** live seat availability updates via SSE/WebSocket during peak sales; the hold itself is a transactional API call.

## Common pitfalls
- Choosing WebSockets for one-way updates where SSE would be simpler.
- Assuming a connection means delivery: no acks, no persistence, no resume.
- Treating Redis pub/sub as durable (it drops messages when subscribers are disconnected).
- Relying only on sticky sessions without a registry for cross-server routing.
- No heartbeats, so half-open connections and stale presence accumulate.
- Synchronised reconnect storms after a deploy; no jitter, no gradual draining.
- Treating APNs/FCM as reliable or ordered, or putting sensitive data in push payloads.
- Thread-per-connection servers that fall over at 10K connections.

## Interview questions
1. **SSE or WebSocket for notifications and LLM token streaming?** SSE: one-way, plain HTTP, automatic reconnect with `Last-Event-ID`, works with HTTP/2 and existing auth. Client actions go over normal HTTP requests.
2. **How do you route a chat message to a user connected to another server?** Persist it, look up the user's gateway(s) in a registry (Redis with TTL), publish to that gateway's channel/topic, and the gateway writes to the socket; if no gateway, send a push notification.
3. **How do clients avoid losing messages during reconnects?** Per-conversation sequence numbers; the client sends its last processed sequence on resume; the server replays from durable storage, then streams live; clients dedupe by message ID.
4. **How many WebSocket servers for 20M concurrent users?** At ~200K connections per server, about 100 servers, plus headroom for a zone failure and reconnect spikes; size by memory and file descriptors, not CPU.
5. **How do you implement presence at scale?** Heartbeats refresh a TTL key; debounce offline transitions; push presence only to users viewing the relevant chat, fetch lazily otherwise, and skip it for large groups.
6. **What happens on a gateway deploy?** Drain gradually: stop new connections, ask clients to reconnect, close over minutes; clients reconnect with jittered backoff to other gateways and resume by sequence.
7. **When are push notifications required?** When the app is backgrounded or closed and has no socket; they are best effort, so use them to wake the app, which then syncs over its own channel.
8. **Why might long polling still be used?** Maximum compatibility with restrictive proxies and older clients, simple resumability with cursors, and it reuses ordinary HTTP infrastructure.

## Cheat sheet
- Polling (simple, wasteful) → long polling (held request, cursor) → SSE (one-way stream, auto-resume) → WebSocket (full duplex) → APNs/FCM (app closed, best effort).
- One-way: SSE. Two-way frequent: WebSocket. Background: push. Rare updates: poll.
- Stateful gateway tier + stateless services; async I/O; 100K+ connections per box, size by memory/FDs.
- Registry `user → gateway` in Redis with TTL; pub/sub (Redis/Kafka/NATS) to the target gateway; publish once per gateway for big fan-out.
- Heartbeats 15–30 s; detect half-open; refresh presence TTL.
- Per-conversation sequence numbers; resume from lastSeq; dedupe by ID; jittered reconnect; drain on deploy.
- Receipts: client msg ID → sent ack → delivered ack → read high-water mark.
- WebRTC for media: signalling over WebSocket, STUN/TURN, SFU for groups.
