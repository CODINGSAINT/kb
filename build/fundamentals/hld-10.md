=== hld-api-design | HLD | API design and service communication ===
An API is the contract between a client and a service, or between two services. A good one is predictable, can evolve without breaking callers, and is safe to retry. This chapter covers REST basics (resources, verbs, status codes, errors, pagination, versioning), then how services talk: REST vs gRPC vs GraphQL, sync vs async, gateways and BFFs, and the timeouts and circuit breakers every remote call needs.

## 1. REST resources and verbs

**Definition:** In REST, URLs name things (resources, as nouns) and HTTP methods say what to do with them.

Think of a library: the shelf label says what is there (`/books/42`), and the action is borrow, return or replace. Keep URLs as nouns, use plural collections, and nest only one level when ownership is real.

### The problem

```http
POST /createOrder
POST /getOrderDetails?id=42
POST /cancelOrderNow
```

Every action is a new verb in the URL, everything is `POST`, so caches, retries and tools cannot tell reads from writes.

### Better design

```http
POST   /orders                   create an order          -> 201 Created + Location
GET    /orders/42                read one order
GET    /orders?status=PAID       list with a filter
PATCH  /orders/42                change some fields
DELETE /orders/42                remove
POST   /orders/42/cancellation   an action that is not plain CRUD, modelled as a sub-resource
```

The method tells everyone (browsers, proxies, retry logic) whether the call reads or writes and whether it is safe to repeat.

**Key takeaway:** **Nouns in the URL, verbs in the method.**

---

## 2. Status codes

**Definition:** The status code is a three-digit summary of the outcome: 2xx success, 4xx the caller's fault, 5xx the server's fault.

Clients and retry logic act on the code before reading the body, so the right code matters more than the message text.

### The problem

```http
HTTP/1.1 200 OK
{"success": false, "error": "Order not found"}
```

Monitoring counts this as success, caches may store it, and a client retry policy cannot tell it apart from a real success.

### Better design

- **200** OK, **201** Created (with `Location`), **202** Accepted (work queued), **204** No Content.
- **400** malformed, **401** not authenticated, **403** not allowed, **404** not found, **409** conflict with current state, **412** precondition (ETag) failed, **422** valid JSON but fails business validation, **429** too many requests (with `Retry-After`).
- **500** bug, **502** bad upstream response, **503** overloaded or down (retry later), **504** upstream timeout.

**Key takeaway:** **4xx means "do not retry as-is"; 429 and 503 mean "retry later"; never hide errors behind 200.**

---

## 3. Error format

**Definition:** An error format is one consistent JSON shape for every error your APIs return.

### The problem

Service A returns `{"msg": "..."}`, service B returns `{"error": {"code": 7}}`, service C returns an HTML stack trace. Every client writes three parsers, and the stack trace leaks internals.

### Better design

Use **Problem Details** (RFC 9457, which replaced RFC 7807), which Spring 6 supports with `ProblemDetail`:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/errors/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Balance 300 is lower than amount 500",
  "instance": "/payments/p-81",
  "traceId": "4bf92f3577b34da6"
}
```

A stable `type` lets clients branch on the error, and a trace ID lets support find the logs.

**Key takeaway:** **One error shape everywhere, a machine-readable code, a trace ID, no stack traces.**

---

## 4. Pagination: offset vs. cursor

**Definition:** Pagination returns a large list in pages; offset pagination says "skip N rows", cursor pagination says "continue after this item".

Offset is like "open the book at page 500"; cursor is like a bookmark.

### The problem

```sql
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 100000;
```

The database still reads and throws away 100,000 rows, so deep pages get slow. If new posts arrive while the user scrolls, items shift and the user sees duplicates or misses some.

### Better design

```http
GET /posts?limit=20&cursor=eyJ0IjoiMjAyNi0xMC0xMlQxMDowMDowMFoiLCJpZCI6OTkxfQ
{"items": [...], "nextCursor": "eyJ0IjoiMjAyNi0xMC0xMlQwOTo1NTowMFoiLCJpZCI6OTcxfQ"}
```

```sql
-- the cursor decodes to the last item's (created_at, id)
SELECT * FROM posts
WHERE (created_at, id) < ('2026-10-12 10:00:00', 991)
ORDER BY created_at DESC, id DESC LIMIT 20;
```

The query uses the index to jump straight to the bookmark, so page 5,000 is as fast as page 1, and inserts do not shift results. The `id` breaks ties between equal timestamps.

**Trade-offs:**
- Cursors cannot jump to "page 37"; offset is fine for small admin tables that need page numbers.

**Key takeaway:** **Use opaque cursors for feeds and large lists; offset only for small, numbered pages.**

---

## 5. Versioning and backward compatibility

**Definition:** Versioning lets you change an API without breaking clients already using it.

Mobile apps make this real: an app released two years ago still calls your API, and you cannot force everyone to upgrade.

### The problem

You rename `amount` to `totalAmount` in the response. Every old app that reads `amount` now shows blank prices.

### Better design

```http
GET /v1/orders/42   ->  {"amount": 500}
GET /v2/orders/42   ->  {"totalAmount": {"value": 500, "currency": "INR"}}
```

Most changes should not need a new version at all: **add** optional fields, never remove or rename them, and make clients ignore unknown fields. Create `/v2` (path or header version) only for real breaking changes, run both for a deprecation period, and announce removal with a `Deprecation` or `Sunset` header.

**Key takeaway:** **Evolve by adding; version only for breaking changes, and keep old versions alive for a while.**

---

## 6. Idempotent methods

**Definition:** A method is idempotent if repeating the same request leaves the server in the same state as sending it once.

This decides which calls a client, proxy or SDK can safely retry after a timeout.

### The problem

```http
POST /payments {"amount": 500}     -- times out, client retries -> two payments
```

### Better design

- **Safe and idempotent:** `GET`, `HEAD`, `OPTIONS` (read-only).
- **Idempotent:** `PUT` (replace with the full state), `DELETE` (second delete changes nothing).
- **Not idempotent by default:** `POST`, and `PATCH` when it applies a relative change.

```http
POST /payments
Idempotency-Key: 5f1c2e7a-8d3b-4c09-9a51-2b6f0e3d1c44
{"amount": 500}
```

With an idempotency key, the server stores the first result and returns it for any retry, which makes `POST` safe to retry. (See the idempotency chapter for the table design.)

**Key takeaway:** **Retry GET, PUT and DELETE freely; retry POST only with an idempotency key.**

---

## 7. REST vs. gRPC vs. GraphQL

**Definition:** These are three API styles: REST (resources over HTTP and JSON), gRPC (typed remote calls over HTTP/2 with Protocol Buffers) and GraphQL (one endpoint where the client asks for exactly the fields it needs).

### The problem

A mobile home screen needs a user, their last 5 orders and 3 recommendations. With plain REST it makes three round trips over a slow network and receives many fields it never shows. Meanwhile, two backend services exchange 50,000 small JSON messages a second, spending CPU on parsing text.

### Better design

| | REST + JSON | gRPC | GraphQL |
|---|---|---|---|
| Best for | Public APIs, simple CRUD | Internal service-to-service | Many client screens with varied data needs |
| Contract | OpenAPI (optional) | `.proto` file, generated code | Schema, typed |
| Strength | Simple, cacheable, universal | Compact binary, streaming, deadlines | No over- or under-fetching, one round trip |
| Weakness | Chatty for complex screens | Not directly callable from browsers (needs gRPC-Web) | Hard to cache; costly queries and N+1 loads |

A common split: gRPC between internal services, REST for public and partner APIs, and GraphQL (or a BFF) in front of mobile and web clients.

**Key takeaway:** **REST at the edge, gRPC inside, GraphQL when many clients need different shapes of the same data.**

---

## 8. Sync vs. async communication

**Definition:** In synchronous calls the caller waits for the answer; in asynchronous communication the caller sends a message or event and moves on.

A phone call is synchronous; a WhatsApp message is asynchronous.

### The problem

```text
Checkout -> Payment -> Email -> Analytics -> Loyalty   (all sync, in a chain)
Availability = 0.999^5 = ~99.5%; latency = sum of all five
Email is down -> checkout fails
```

### Better design

```text
Checkout -> Payment            (sync: the user needs the answer now)
Checkout --publish OrderPlaced--> Kafka --> Email, Analytics, Loyalty  (async)
```

Keep only what the user must wait for on the synchronous path. Everything else consumes an event, so a slow email service no longer breaks checkout.

**Trade-offs:**
- Async adds eventual consistency, duplicate messages (consumers must be idempotent) and harder debugging.

**Key takeaway:** **Sync for "I need the answer now"; async for "tell others it happened".**

---

## 9. API gateway and BFF

**Definition:** An API gateway is the single entry point that handles cross-cutting concerns for all services; a BFF (Backend for Frontend) is a small backend tailored to one client type.

The gateway is the building's reception desk: it checks IDs and directs visitors. A BFF is a personal assistant for one kind of visitor.

### The problem

Every service re-implements authentication, rate limiting, TLS and logging, slightly differently. The mobile app calls eight services directly and breaks whenever one is renamed.

### Better design

```text
Mobile -> Mobile BFF --+
                       +--> API Gateway (auth, rate limit, routing, TLS) --> services
Web    -> Web BFF -----+
```

The gateway (Spring Cloud Gateway, Kong, AWS API Gateway) handles shared concerns once. Each BFF aggregates and trims data for its screen.

**Trade-offs:**
- The gateway is an extra hop and must be highly available; keep business logic out of it.

**Key takeaway:** **Gateway for cross-cutting concerns, BFF for client-specific shaping.**

---

## 10. Timeouts and circuit breakers

**Definition:** A timeout bounds how long you wait for a call; a circuit breaker stops calling a dependency that keeps failing and fails fast instead.

A circuit breaker works like the one in your home: after too many faults it trips, and after a pause it lets a little current through to test.

### The problem

The recommendations service is slow. Without limits, every product-page request waits 30 seconds, threads pile up, and the whole product page goes down for a non-essential widget.

### Better design

```java
@CircuitBreaker(name = "recs", fallbackMethod = "noRecs")   // Resilience4j
@TimeLimiter(name = "recs")                                 // e.g. 300 ms
CompletableFuture<List<Product>> recommendations(String userId) { ... }

CompletableFuture<List<Product>> noRecs(String userId, Throwable t) {
    return CompletableFuture.completedFuture(List.of());    // degrade gracefully
}
```

The page renders without recommendations, and the broken service gets breathing room. The breaker states are **closed** (normal), **open** (fail fast) and **half-open** (a few trial calls).

**Key takeaway:** **Every remote call has a timeout; flaky dependencies get a circuit breaker and a fallback.**

---

## In an HLD interview

- **URL Shortener:** `POST /urls` returns 201 with the short code; `GET /{code}` returns 301 or 302 (302 if you need to count every click).
- **News Feed / Google Search:** cursor pagination with an opaque `nextCursor`.
- **Payment System / Amazon E-commerce:** idempotency key on `POST`, 202 for async processing, events for downstream services.
- **API Gateway / Rate Limiter:** gateway handles auth and limits, returns 429 with `Retry-After`.
- What to SAY: "I will define the API first: resources, methods, status codes and pagination. Public APIs are REST, internal calls gRPC, side effects go through events, and every call has a timeout."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Resources and verbs | Nouns in URL, verbs in method | Does the method say read vs write? |
| Status codes | Code drives client behaviour | Can a client decide to retry from the code alone? |
| Error format | One Problem Details shape | Does every service fail the same way? |
| Pagination | Cursor over offset | Will page 5,000 be slow or shift under inserts? |
| Versioning | Add, do not break | Will a two-year-old app still work? |
| Idempotent methods | Safe to repeat | Can this request be retried after a timeout? |
| REST / gRPC / GraphQL | Pick by caller | Who calls this, and what do they need? |
| Sync vs async | Wait only when needed | Must the user wait for this step? |
| Gateway / BFF | Shared concerns vs client shaping | Where do auth and aggregation live? |
| Timeout / breaker | Fail fast, degrade | What happens when this dependency hangs? |

## Final memory aid

- Nouns in URLs, verbs in methods.
- Right status codes; never 200 for an error.
- One error shape with a code and trace ID.
- Cursors for feeds, offset for small tables.
- Add fields, do not rename; version only for breaking changes.
- POST needs an idempotency key to be retried.
- REST outside, gRPC inside, GraphQL or BFF for varied clients.
- Timeouts everywhere; breakers and fallbacks for the flaky.

=== hld-realtime | HLD | Real-time communication: polling, long polling, SSE, WebSockets ===
Chat, live location, notifications, scores and AI token streaming all need the server to send data the moment it happens. HTTP was built for "client asks, server answers", so real-time delivery uses a ladder of techniques: polling, long polling, Server-Sent Events and WebSockets, plus mobile push when the app is closed. This chapter explains each, when to pick it, and how to scale WebSocket servers with a connection registry, pub/sub, heartbeats, resume and presence.

## 1. Short polling

**Definition:** Short polling means the client asks "anything new?" on a fixed timer.

It is a child asking "are we there yet?" every five minutes. Simple, but most answers are "no".

### The problem

```text
1,000,000 clients polling every 5 s = 200,000 requests/s
Most responses: 200 OK, []  (nothing new)
Average delay before seeing an update: ~2.5 s
```

Cost grows with clients times frequency, not with actual activity. Shorter intervals cut delay but multiply load.

### Better design

```http
GET /orders/42/status?since=17      every 30 s on an order tracking page
```

Keep short polling for updates that are rare and where seconds of delay are fine: job status, dashboards, order tracking. It is stateless, cacheable and works through every proxy.

**Key takeaway:** **Poll when updates are rare and delay is acceptable; it is the cheapest thing to build.**

---

## 2. Long polling

**Definition:** In long polling the server holds the request open until there is new data or a timeout, then the client immediately asks again.

It is a waiter who stands at your table until you order, instead of walking past every minute.

### The problem

Short polling wastes requests and adds delay. But WebSockets may be blocked by an old corporate proxy, and you still need near-instant updates.

### Better design

```text
Client                          Server
  | GET /events?cursor=41 -----> |  nothing yet, park the request
  |                              |  ... 12 s later event 42 arrives
  | <----- 200 [event 42] ------ |
  | GET /events?cursor=42 -----> |  park again ... 30 s timeout
  | <----- 204 No Content ------ |
  | GET /events?cursor=42 -----> |
```

Updates arrive almost instantly over plain HTTP, and the cursor makes it resumable after a disconnect. The server must be asynchronous (for example Servlet async or WebFlux) so parked requests do not each hold a thread.

**Trade-offs:**
- A full HTTP request (headers, auth) per batch of events.

**Key takeaway:** **Long polling is push over plain HTTP; a good fallback when streaming is blocked.**

---

## 3. Server-Sent Events (SSE)

**Definition:** SSE is one long-lived HTTP response (`Content-Type: text/event-stream`) that the server keeps writing events into, one way, server to client.

It is a radio broadcast: you tune in once and keep listening.

### The problem

A stock ticker or an AI answer streaming token by token needs a steady one-way flow. Polling is too slow, and WebSockets bring a second protocol and two-way machinery you do not need.

### Better design

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

id: 1042
event: price
data: {"symbol":"INFY","price":1874.5}

: keep-alive comment
```

```java
@GetMapping(path = "/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<ServerSentEvent<Notification>> stream(@RequestHeader(value = "Last-Event-ID",
                                                          required = false) Long lastId) {
    return notifications.after(lastId)                       // replay, then live
            .map(n -> ServerSentEvent.builder(n).id(String.valueOf(n.seq())).build());
}
```

The browser's `EventSource` reconnects automatically and sends `Last-Event-ID`, so the server can resume where the client left off. It uses normal HTTP, so existing auth, load balancers and HTTP/2 work.

**Trade-offs:**
- Server-to-client only (the client sends via normal requests); text only.
- On HTTP/1.1 browsers allow about 6 connections per domain; HTTP/2 removes this limit.

**Key takeaway:** **For one-way streams (notifications, tickers, LLM tokens), use SSE.**

---

## 4. WebSockets

**Definition:** A WebSocket upgrades an HTTP connection into a persistent, two-way channel where either side can send messages at any time.

It is a phone call: once connected, both people can talk whenever they want.

### The problem

A chat app, a multiplayer game or a driver app sends and receives many small messages per second. A new HTTP request per message adds headers and latency each time.

### Better design

```http
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

After the handshake, each frame carries only 2-14 bytes of overhead, in both directions, with binary support.

**Trade-offs:**
- The connection is stateful: load balancing, deploys and scaling get harder.
- No built-in reconnect, resume or acknowledgements; you design them (or use STOMP, MQTT or Socket.IO on top).

**Key takeaway:** **Use WebSockets for frequent two-way traffic: chat, games, collaboration, live driver location.**

### SSE vs. WebSocket

- **Direction:** SSE is server to client; WebSocket is both ways.
- **Resume:** SSE has `Last-Event-ID` built in; WebSocket needs your own sequence numbers.
- **Infra:** SSE is plain HTTP; WebSocket needs upgrade support and long idle timeouts on load balancers.
- Rule of thumb: one-way stream, SSE; two-way and frequent, WebSocket; app closed, push notification; rare updates, polling.

---

## 5. Scaling WebSocket servers: registry and pub/sub

**Definition:** A connection registry records which server holds each user's connection; pub/sub carries a message to that server.

With async I/O (Netty, WebFlux) one server can hold on the order of 100K or more mostly idle connections, limited by memory and file descriptors more than CPU. So you will have many gateway servers, and the sender and receiver are usually on different ones.

### The problem

```text
Asha  --ws--> Gateway 3        Ravi --ws--> Gateway 17
Chat service receives "Asha -> Ravi: hi"
Which of 100 gateways holds Ravi's socket?
```

Sticky sessions keep a user on one server, but they do not tell the chat service where another user is.

### Better design

```text
Clients --LB--> Gateway tier (stateful, holds sockets, auth)
                  | on connect:  HSET conn:user:ravi phone gw-17 ; EXPIRE 90 s
                  | subscribes to its own channel "gw-17"
                  v
           Pub/sub (Redis pub/sub, Kafka, NATS)
                  ^
Chat service: 1) store message with seq  2) look up conn:user:ravi -> gw-17
              3) publish to "gw-17"       4) gw-17 writes to Ravi's socket
```

Gateways stay thin and stateful; business services stay stateless and can be deployed without dropping connections. If the registry has no entry, the user is offline: store the message and send a push notification.

**Trade-offs:**
- Redis pub/sub is fire-and-forget: a disconnected subscriber misses messages, so durability must come from the message store plus resume.

**Key takeaway:** **Separate connection gateways from logic; find users with a TTL'd registry and route with pub/sub.**

---

## 6. Heartbeats

**Definition:** A heartbeat is a small periodic ping that proves a connection is still alive.

### The problem

A phone enters a tunnel. TCP does not notice for minutes (a **half-open** connection: one side thinks it is still connected). The server keeps writing into a dead socket, the registry says "online", and some load balancers silently drop idle connections after about 60 seconds.

### Better design

```text
every 20 s:  server --ping--> client --pong--> server  (refresh registry TTL)
missed 2-3 pongs -> close the socket, remove the registry entry
```

Heartbeats keep idle connections open through proxies, detect dead clients, and keep presence accurate.

**Key takeaway:** **Ping every 15-30 s, close after a few misses, refresh the registry TTL on each beat.**

---

## 7. Reconnect and resume

**Definition:** Resume means a reconnecting client tells the server the last message it saw and receives everything after it.

Disconnects are normal: Wi-Fi to 4G handovers, tunnels, server deploys.

### The problem

```text
Ravi's connection drops at seq 980. Messages 981-985 are published while he is away.
He reconnects to a new gateway and only sees live messages from 986.
200,000 clients of a restarted gateway all reconnect in the same second.
```

Messages are silently lost, and the reconnect storm hammers auth and the registry.

### Better design

```text
client stores lastSeq = 980
reconnect after random backoff (e.g. 1-5 s, growing with each failure)
client -> resume(conversation=7, lastSeq=980)
server -> replay 981..985 from the durable store, then switch to live
client  -> dedupe by message id, order by seq
```

Each message gets a server-assigned sequence number per conversation, so gaps are visible and replay is exact. Jittered backoff spreads reconnects; during deploys, drain gateways gradually.

**Key takeaway:** **Sequence numbers plus a durable store make reconnects lossless; jitter makes them gentle.**

---

## 8. Presence

**Definition:** Presence is showing whether a user is online, offline or "last seen at".

### The problem

A user with 500 contacts flips between online and offline ten times in a minute on a weak network. Sending every change to every contact multiplies into a flood of updates across millions of users.

### Better design

```text
online  = registry key exists (kept alive by heartbeats)
offline = key expired; write lastSeen, but only after a 30 s grace period (debounce)
fan-out = only to users who currently have this chat open; fetch lazily otherwise
typing  = pub/sub only, never stored, rate-limited
```

Debouncing hides flaky reconnects, and lazy fan-out sends presence only where someone is looking.

**Key takeaway:** **Presence comes from heartbeats, is debounced, and is fanned out only to people who can see it.**

---

## 9. Push notifications

**Definition:** Push notifications deliver a message through the phone platform's own service (APNs for iOS, FCM for Android) when your app has no open connection.

When the app is in the background or closed, the OS shuts your socket. Only the platform channel can reach the device.

### The problem

Ravi's app is closed, so the registry has no entry for him. A WebSocket or SSE design alone simply cannot tell him he has a new message.

### Better design

```text
app start: get device token from APNs/FCM -> POST /devices {token}
message for offline user: notification service -> APNs/FCM (token, small payload)
user taps -> app opens -> reconnects -> resumes from lastSeq
```

Treat push as a best-effort nudge: it can be delayed, merged or dropped, and payloads are small (APNs allows up to 4 KB). The real data arrives through your own channel after the app wakes. Remove tokens the provider reports as invalid, and respect user preferences and quiet hours.

**Key takeaway:** **Push wakes the app; your own channel delivers the data.**

---

## In an HLD interview

- **Chat / WhatsApp:** WebSocket gateways, Redis registry with TTL, pub/sub to the target gateway, per-conversation sequence numbers, resume, receipts, push for offline users.
- **Uber / Ride Tracking:** driver app streams GPS every few seconds over a persistent connection; riders get updates via WebSocket or SSE, throttled to the latest position.
- **Notification System / News Feed:** SSE or long polling for "new items" in-app; APNs/FCM when the app is closed.
- **BookMyShow / Seat Reservation:** live seat map via SSE; the hold itself is a normal transactional API call.
- What to SAY: "One-way updates go over SSE, two-way chat over WebSockets. Gateways are stateful and separate from logic; a registry tells me which gateway holds a user, pub/sub routes the message, and sequence numbers let clients resume."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Short polling | Ask on a timer | Are updates rare and is delay fine? |
| Long polling | Server holds the request | Is streaming blocked but I need low delay? |
| SSE | One-way HTTP stream with resume | Is data flowing only server to client? |
| WebSocket | Two-way persistent channel | Do both sides send often? |
| Registry + pub/sub | Find the user's gateway, route there | How does a message reach another server's socket? |
| Heartbeats | Prove the connection is alive | How fast do I detect a dead client? |
| Resume | Replay after lastSeq | What does a reconnecting client miss? |
| Presence | Debounced, lazy fan-out | Who actually needs this status change? |
| Push | Platform wakes the app | How do I reach a user with the app closed? |

## Final memory aid

- Rare updates: poll. Blocked streaming: long poll.
- One-way stream: SSE. Two-way and frequent: WebSocket.
- App closed: APNs/FCM, as a nudge only.
- Gateways hold sockets; services hold logic.
- Registry (with TTL) finds the gateway; pub/sub delivers to it.
- Heartbeats every 15-30 s catch half-open connections.
- Sequence numbers + durable store = lossless resume; jitter the reconnects.
- Presence: debounce, and fan out only to who is looking.
