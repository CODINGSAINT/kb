=== hld-idempotency | HLD | Idempotency, retries and exactly-once effects ===
In a distributed system a request can succeed while its response is lost, so the caller cannot distinguish "it failed" from "it worked but I never heard back". Retrying is the only way to be reliable, and retrying without idempotency is how customers get charged twice. This chapter shows how to make operations safe to repeat (idempotency keys, fingerprints, dedup windows, idempotent consumers, naturally idempotent designs) and how to retry well (timeouts, backoff with jitter, budgets and error classification).

## Why retries create duplicates
```
Client                    Payment API                 Card network
  | POST /payments  ------->  |                             |
  |                           |  charge $50  ------------>  |
  |                           |  <------------- approved    |
  |                           |  commit row                 |
  |   X  response lost (timeout, LB reset, pod killed)      |
  | retry POST /payments ---> |  charge $50 again?!         |
```
Three outcomes look identical to the client: the request never arrived, it arrived and failed, or it succeeded and the reply was lost. The same ambiguity exists at every hop: client to API, API to database, service to broker, broker to consumer. Duplicates come from:
- Client and SDK retries on timeouts.
- Users double-clicking or refreshing a form.
- Load balancers and service meshes retrying upstream.
- At-least-once message delivery and consumer rebalances.
- Batch jobs re-run after partial failure.

**Idempotent** means performing the operation N times has the same effect as performing it once. Note the subtlety: the *response* may differ (the second `DELETE` may return 404) but the *state* does not.

## Natural idempotency
Design operations so they are idempotent by construction whenever possible:
| Operation | Idempotent? | Why |
|---|---|---|
| `GET`, `HEAD` | Yes | No state change |
| `PUT /users/42/email {"email":"a@b.com"}` | Yes | Sets absolute state |
| `DELETE /carts/7/items/3` | Yes | Second delete is a no-op |
| `POST /orders` | No | Creates a new resource each time |
| `PATCH {"balance": +10}` | No | Relative change |
| `UPDATE accounts SET balance = 100 WHERE id = 1` | Yes | Absolute |
| `UPDATE accounts SET balance = balance - 10 WHERE id = 1` | No | Relative |
| `SADD followers:42 7` (set add) | Yes | Set semantics |
| `INCR views:42` | No | Counter |

Techniques to get natural idempotency:
- **Client-generated IDs:** `PUT /orders/{uuid}` instead of `POST /orders`; the second PUT with the same ID finds the row already there.
- **Absolute instead of relative updates** where the business allows it.
- **Conditional updates:** `UPDATE orders SET status='SHIPPED' WHERE id=? AND status='PAID'`; a replay updates zero rows.
- **Unique constraints** on business keys (`UNIQUE(order_id)` on payments, `UNIQUE(user_id, post_id)` on likes) with `INSERT ... ON CONFLICT DO NOTHING`.
- **Versioned writes:** apply an event only if `event.version = current_version + 1`.

## Idempotency keys
For operations that are inherently "create" or "do" (charge a card, send money, place an order), the client attaches a unique key, and the server remembers the outcome per key.
```
POST /v1/payments
Idempotency-Key: 5f1c2e7a-8d3b-4c09-9a51-2b6f0e3d1c44
{"amount": 5000, "currency": "INR", "source": "card_123"}
```

### Table design
```sql
CREATE TABLE idempotency_keys (
  tenant_id        BIGINT       NOT NULL,
  idem_key         VARCHAR(64)  NOT NULL,
  request_hash     CHAR(64)     NOT NULL,   -- SHA-256 of method + path + canonical body
  status           VARCHAR(16)  NOT NULL,   -- IN_PROGRESS | COMPLETED | FAILED_RETRYABLE
  response_code    INT,
  response_body    JSONB,
  resource_id      VARCHAR(64),             -- e.g. payment id created
  locked_until     TIMESTAMPTZ,             -- lease for in-flight requests
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ  NOT NULL,   -- e.g. created_at + 24h
  PRIMARY KEY (tenant_id, idem_key)
);
CREATE INDEX ON idempotency_keys (expires_at);   -- purge job
```

### Algorithm
1. **Claim:** `INSERT ... (status='IN_PROGRESS', locked_until=now()+30s) ON CONFLICT DO NOTHING`.
2. If the insert succeeded, you own the key: execute the operation.
3. If it conflicted, load the row:
   - `request_hash` differs → **422** "key reused with a different request" (protects against client bugs).
   - `COMPLETED` → return the **stored response** verbatim (same status code and body).
   - `IN_PROGRESS` and lease not expired → **409 Conflict** (or wait briefly); the client retries later.
   - `IN_PROGRESS` and lease expired → the previous owner crashed; take over carefully (see below).
4. On finish, store the response and set `COMPLETED` **in the same transaction as the business write** when they share a database. That atomicity is what makes it correct.
5. On a retryable failure (downstream timeout before any side effect), set `FAILED_RETRYABLE` or delete the row so the client can retry; on a deterministic failure (card declined), store the 402 response as completed, because a replay should get the same decline.

The hard case is a crash after calling an external system but before recording the result. Mitigate by passing your own idempotency key downstream (Stripe, Adyen and most payment gateways accept one), and by recording **recovery points**: `CREATED → CHARGE_REQUESTED → CHARGED → COMPLETED`, so a takeover knows which step to resume or verify by querying the provider.

### Spring example
```java
@RestController
@RequiredArgsConstructor
class PaymentController {
    private final IdempotencyService idem;
    private final PaymentService payments;

    @PostMapping("/v1/payments")
    ResponseEntity<?> create(@RequestHeader("Idempotency-Key") String key,
                             @AuthenticationPrincipal Merchant m,
                             @Valid @RequestBody PaymentRequest req) {
        String hash = Hashing.sha256(req.canonicalJson());
        IdemResult claim = idem.claim(m.id(), key, hash, Duration.ofSeconds(30));

        return switch (claim.state()) {
            case REPLAY      -> ResponseEntity.status(claim.code()).body(claim.body());
            case MISMATCH    -> ResponseEntity.unprocessableEntity()
                                   .body(Error.of("idempotency_key_reuse"));
            case IN_FLIGHT   -> ResponseEntity.status(409)
                                   .header("Retry-After", "1").build();
            case OWNED       -> {
                PaymentResponse resp = payments.charge(m.id(), key, req); // passes key downstream
                idem.complete(m.id(), key, 201, resp);   // same @Transactional boundary as the payment row
                yield ResponseEntity.status(201).body(resp);
            }
        };
    }
}

@Repository
class IdempotencyRepository {
    private final JdbcTemplate jdbc;
    boolean tryInsert(long tenant, String key, String hash, Instant lockUntil) {
        return jdbc.update("""
            INSERT INTO idempotency_keys (tenant_id, idem_key, request_hash, status,
                                          locked_until, expires_at)
            VALUES (?, ?, ?, 'IN_PROGRESS', ?, now() + interval '24 hours')
            ON CONFLICT (tenant_id, idem_key) DO NOTHING
            """, tenant, key, hash, Timestamp.from(lockUntil)) == 1;
    }
}
```
In practice you wrap this in a filter or AOP aspect (`@Idempotent`) so every mutating endpoint gets it consistently.

### Where to store keys
- **Same relational DB as the business data:** strongest, because the key and the effect commit atomically. Preferred for payments and orders.
- **Redis** `SET key value NX EX 86400`: fast, good for lower-stakes dedup (notifications, likes), but not atomic with your DB write and can be lost on failover.
- **DynamoDB** conditional put (`attribute_not_exists(pk)`): good when the business data is also in DynamoDB (use a transaction).

## Request fingerprinting and dedup windows
When clients do not send keys (legacy clients, webhooks, form posts), derive one:
- **Fingerprint** = hash of `(user, endpoint, normalised body)`; reject an identical fingerprint within a short window (e.g. 10 s) to stop double-clicks. Risky for legitimately repeated actions (two identical ₹100 transfers), so use short windows and only where duplicates are clearly accidental.
- **Upstream IDs:** webhooks carry an event ID; messages carry a message ID; use those.
- **Dedup window size:** must exceed the maximum retry horizon. If clients retry for up to 24 h, keep keys at least 24 h. Stripe keeps keys for 24 hours; SQS FIFO dedups within 5 minutes; Kafka's idempotent producer dedups per producer session.
- Memory-bounded dedup at high volume: a Bloom filter in front of an exact store (negative answers are definitive, positives are checked), or a time-bucketed set with TTL.

## Idempotent consumers
At-least-once delivery means every consumer must tolerate duplicates.
```sql
CREATE TABLE processed_messages (
  consumer_group VARCHAR(64),
  message_id     VARCHAR(64),
  processed_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (consumer_group, message_id)
);

BEGIN;
INSERT INTO processed_messages VALUES ('billing', :msgId) ON CONFLICT DO NOTHING;
-- if 0 rows inserted: duplicate, ROLLBACK and ack
UPDATE accounts SET balance = balance - :amt WHERE id = :acct;
COMMIT;
-- then commit the Kafka offset / ack the SQS message
```
Alternatives: store the last applied **sequence number per entity** (`WHERE id=? AND last_seq < :seq`), which also rejects out-of-order replays; or make the sink an **upsert** keyed by a deterministic ID. Producers must give each logical event a stable ID generated **once** (when the event is created, e.g. in the outbox row), not a new UUID per send attempt.

## Retry policy
Retries convert transient failures into success, but badly configured retries convert a small outage into a big one.

### Timeouts come first
- Every remote call needs a **connect timeout** and a **request timeout**. No timeout means a stuck thread forever.
- Set timeouts from the dependency's latency distribution (e.g. a bit above p99.9), not round numbers.
- **Deadline propagation:** if the caller has 800 ms left, pass that down (gRPC deadlines do this); never let a callee work longer than anyone will wait.

### Which errors to retry
| Retry | Do not retry |
|---|---|
| Connection refused/reset, timeouts (only if idempotent) | 400, 401, 403, 404, 422 validation |
| 429 Too Many Requests (honour `Retry-After`) | 409 business conflicts (re-read state instead) |
| 502, 503, 504 | 501, most 500s that are deterministic bugs |
| DB deadlock / serialization failure (retry the whole transaction) | Card declined, insufficient funds |
| Leader election / "not leader" errors | Anything non-idempotent without a key |

### Exponential backoff with jitter
```
sleep = random_between(0, min(cap, base * 2^attempt))      // "full jitter"
base = 100 ms, cap = 10 s, maxAttempts = 4–6
```
Without jitter, thousands of clients that failed at the same moment retry at the same moment (a **thundering herd**), synchronising load spikes that keep the service down. Full jitter spreads them out.

### Retry budgets and amplification
If each of 4 layers retries 3 times, one user request can become 3^4 = 81 calls to the bottom service exactly when it is struggling. Defences:
- **Retry at one layer** (usually the outermost that knows the operation is idempotent, or the client SDK).
- **Retry budget:** retries may be at most ~10% of requests per client/instance (Finagle, Envoy `retry_budget`). Beyond that, fail fast.
- **Circuit breaker:** stop calling a dependency that is failing; probe periodically.
- **Hedged requests** for tail latency on idempotent reads: send a second request after p95 latency, take the first answer, cancel the other.

### Spring/Resilience4j configuration
```yaml
resilience4j:
  retry:
    instances:
      ledgerClient:
        max-attempts: 4
        wait-duration: 200ms
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2
        enable-randomized-wait: true
        randomized-wait-factor: 0.5
        retry-exceptions:
          - java.net.SocketTimeoutException
          - org.springframework.web.client.HttpServerErrorException$ServiceUnavailable
        ignore-exceptions:
          - com.acme.payments.CardDeclinedException
  circuitbreaker:
    instances:
      ledgerClient:
        failure-rate-threshold: 50
        sliding-window-size: 50
        wait-duration-in-open-state: 20s
  timelimiter:
    instances:
      ledgerClient:
        timeout-duration: 800ms
```

## Putting it together: a payment flow
1. Client generates an idempotency key per checkout attempt and keeps it across retries (including app restarts, so persist it locally).
2. API claims the key, creates `payment(status=PENDING)` in the same transaction.
3. API calls the payment provider **passing the same key**, with a timeout.
4. On success: update `payment=SUCCEEDED`, store response under the key, write an outbox event `PaymentSucceeded`, all in one transaction.
5. On timeout: leave `PENDING`; a reconciliation worker queries the provider by key/reference and settles the state. Never blindly re-charge with a new key.
6. Downstream consumers (order, email, ledger) dedupe by event ID.
7. A daily reconciliation compares internal ledger with provider settlement files.

## Real-world systems
- **Stripe** popularised the `Idempotency-Key` header, storing results for 24 h and rejecting mismatched reuse.
- **AWS APIs** use `ClientToken` on `RunInstances` and similar calls.
- **Kafka** idempotent producers dedupe broker-side by producer ID and sequence.
- **SQS FIFO** dedupes by `MessageDeduplicationId` in a 5-minute window.
- The IETF has a draft standard for the `Idempotency-Key` HTTP header.

## How it shows up in interview problems
- **Payments / wallet:** idempotency keys, ledger entries with unique `(txn_id, leg)`, reconciliation.
- **E-commerce checkout / BookMyShow:** one order per key; seat hold confirmation is conditional (`WHERE status='HELD' AND hold_id=?`).
- **Notification system:** dedupe by `(notification_id, channel)` so a retry does not send two SMS.
- **URL shortener:** custom alias creation uses a unique constraint; retries return the existing mapping.
- **Rate limiter / API gateway:** 429 with `Retry-After` drives well-behaved client backoff.
- **Job scheduler:** a job run has an ID; workers claim with a conditional update; side effects keyed by run ID.
- **Ride hailing:** "request ride" with a key so a flaky network does not book two cars.

## Common pitfalls
- Generating a new idempotency key on each retry (defeats the purpose).
- Storing the key in Redis but the effect in Postgres, with no atomicity, then losing the key on failover.
- Not checking that the request body matches the original.
- Retrying non-idempotent calls on timeout.
- Retrying at every layer (amplification) and without jitter (synchronised herds).
- Dedup windows shorter than the retry horizon.
- Treating "timeout" as "failure" in money flows instead of "unknown, reconcile".

## Interview questions
1. **What does idempotent mean, and is POST idempotent?** Repeating the operation has the same effect as doing it once. POST is not by default; make it so with an idempotency key or a client-generated resource ID.
2. **Design an idempotency key store.** Table keyed by `(tenant, key)` with request hash, status, stored response and expiry; claim with insert-if-absent; return the stored response on replay; 409 while in progress; 422 on hash mismatch; commit with the business write.
3. **The payment provider times out. What do you do?** Treat the result as unknown; keep the payment pending; query the provider by our reference or retry with the same downstream key; reconcile. Never re-charge with a new key.
4. **How do you make a Kafka consumer idempotent?** Record processed message IDs (or per-entity sequence numbers) in the same DB transaction as the effect, or use upserts keyed deterministically; commit the offset afterwards.
5. **Why add jitter to backoff?** To desynchronise clients that failed together so retries do not arrive as coordinated waves that keep the service overloaded.
6. **Which errors should you retry?** Transient ones: timeouts, connection errors, 429, 502–504, deadlocks/serialization failures. Not validation, auth, not-found or business rejections.
7. **How do you prevent retry storms in a deep call graph?** Retry at one layer, use retry budgets, circuit breakers, propagate deadlines, and shed load.

## Cheat sheet
- Network ambiguity: success with lost reply looks like failure; retries are necessary, so effects must be idempotent.
- Prefer natural idempotency: PUT with client IDs, absolute updates, conditional updates, unique constraints, set ops.
- Idempotency key: client-generated, stable across retries; table `(tenant,key) → hash, status, response, expiry`; commit with the effect.
- Pass keys downstream; on timeouts reconcile, do not re-execute.
- Consumers: processed-ID table or per-entity sequence; stable event IDs created once.
- Retry: timeouts first; transient errors only; exponential backoff + full jitter; one layer; retry budget; circuit breaker.

=== hld-transactions | HLD | Transactions and distributed transactions ===
A transaction groups several reads and writes into one unit that either fully happens or not at all, and that behaves sensibly when run concurrently with others. Inside one database this is a solved, if subtle, problem; across services and databases it becomes one of the hardest parts of system design. This chapter covers ACID and isolation anomalies precisely, MVCC, pessimistic and optimistic locking with SQL and JPA, then two-phase commit, sagas, TCC and the outbox, with booking, inventory and payment examples.

## ACID, precisely
- **Atomicity:** all writes in the transaction commit, or none do. Implemented with a write-ahead log (WAL/redo log) and undo information. It is about *abortability*, not concurrency.
- **Consistency:** the application's invariants hold before and after (balance never negative, every order has a customer). The database helps with constraints, but this is mostly the application's responsibility.
- **Isolation:** concurrent transactions do not see each other's intermediate states; ideally the result equals some serial order. Real databases offer weaker levels for performance.
- **Durability:** once committed, data survives crashes (WAL fsync, replication).

## Isolation anomalies
| Anomaly | What happens | Example |
|---|---|---|
| **Dirty read** | T2 reads T1's uncommitted write; T1 rolls back | Report shows a transfer that never happened |
| **Dirty write** | T2 overwrites T1's uncommitted write | Two buyers' writes interleave on one order |
| **Non-repeatable read** | T1 reads a row twice and gets different values because T2 committed in between | Balance check then debit sees different numbers |
| **Phantom read** | T1 re-runs a range query and new rows appear | "Count bookings for room 12 tonight" changes mid-transaction |
| **Lost update** | Two read-modify-write cycles; the second overwrites the first | Two clerks each add 1 to stock 10, final is 11 not 12 |
| **Write skew** | Two transactions read the same data, each updates *different* rows based on it, together breaking an invariant | Two doctors both go off call; two users book the last two seats of a constraint "max 1 VIP per room" |

| Level | Dirty read | Non-repeatable | Phantom | Lost update | Write skew |
|---|---|---|---|---|---|
| Read uncommitted | possible | possible | possible | possible | possible |
| Read committed (Postgres, Oracle, SQL Server default) | no | possible | possible | possible | possible |
| Repeatable read / snapshot isolation (MySQL InnoDB default) | no | no | mostly no (snapshot) | Postgres: detected; MySQL: possible | possible |
| Serializable | no | no | no | no | no |

Notes: Postgres "repeatable read" is snapshot isolation and aborts on concurrent update of the same row; MySQL InnoDB repeatable read uses snapshot reads for plain `SELECT` but current reads with gap locks for locking reads. Postgres **SSI** (serializable snapshot isolation) detects dangerous read-write dependency cycles and aborts one transaction, so you must retry on `40001 serialization_failure`.

## MVCC
Multi-version concurrency control keeps several versions of each row, tagged with the creating and deleting transaction IDs. Each transaction reads from a **snapshot**: the versions committed before it started (snapshot isolation) or before each statement (read committed).
- **Readers never block writers, writers never block readers.** Only write-write conflicts need locks.
- Cost: old versions must be cleaned up (Postgres `VACUUM`, InnoDB purge of undo logs); long-running transactions hold back cleanup and bloat tables.
- MVCC alone gives snapshot isolation, which still allows write skew.

## Concurrency control in practice
### Atomic single-statement updates
Before reaching for locks, see if the database can do it in one statement:
```sql
UPDATE inventory SET available = available - 1
WHERE sku = 'SKU-42' AND available >= 1;      -- 1 row updated = success, 0 = sold out
```
This is atomic and prevents both lost updates and overselling, with no explicit lock.

### Pessimistic locking: SELECT ... FOR UPDATE
```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- row lock until commit
-- application checks balance >= 100
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```
- Others wanting the same row wait. Good under **high contention** where conflicts are likely and retries would be wasteful (hot seat map, a popular SKU, account balance).
- Lock in a **consistent order** (e.g. ascending account ID in a transfer) to avoid deadlocks; databases detect deadlocks and abort one transaction.
- `FOR UPDATE NOWAIT` fails immediately; `SKIP LOCKED` skips locked rows, ideal for **job queues** and seat allocation ("give me any free seat").
- Keep lock-holding transactions short; never call a remote service while holding a row lock.
- Write skew fix: lock the rows the decision depends on (`SELECT ... FOR UPDATE` on all on-call doctors), or materialise the conflict into a row you can lock.

### Optimistic locking: version columns
```sql
UPDATE products SET price = 499, version = version + 1
WHERE id = 42 AND version = 7;     -- 0 rows → someone else changed it, reload and retry
```
```java
@Entity
class Seat {
    @Id Long id;
    Long showId;
    String status;          // FREE, HELD, BOOKED
    String heldBy;
    Instant holdExpiresAt;
    @Version Long version;  // JPA adds "AND version = ?" and increments on update
}

@Service
class SeatService {
    @Transactional
    @Retryable(retryFor = ObjectOptimisticLockingFailureException.class, maxAttempts = 3)
    public void hold(Long seatId, String userId) {
        Seat s = seatRepo.findById(seatId).orElseThrow();
        if (!"FREE".equals(s.getStatus())) throw new SeatUnavailableException();
        s.setStatus("HELD"); s.setHeldBy(userId);
        s.setHoldExpiresAt(Instant.now().plus(Duration.ofMinutes(10)));
    }   // flush issues UPDATE ... WHERE id=? AND version=?; 0 rows → exception
}

// Pessimistic alternative in Spring Data JPA
interface SeatRepo extends JpaRepository<Seat, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Seat s where s.id in :ids order by s.id")
    List<Seat> lockSeats(@Param("ids") List<Long> ids);
}
```
| | Pessimistic | Optimistic |
|---|---|---|
| Assumes | Conflicts are common | Conflicts are rare |
| Mechanism | Locks held until commit | Version check at write |
| Cost under low contention | Lock overhead, waiting | Nearly free |
| Cost under high contention | Queueing, but each succeeds | Many retries, wasted work |
| Long user think-time | Unusable (cannot hold locks for minutes) | Natural fit (ETag / `If-Match` over HTTP) |
| Deadlocks | Possible | No |

HTTP maps optimistic locking onto **ETags**: `GET` returns `ETag: "v7"`; `PUT` with `If-Match: "v7"`; the server answers **412 Precondition Failed** if the version moved.

## Distributed transactions
Once one business operation touches two databases or services (order DB, payment service, inventory service), a local transaction is no longer enough.

### Two-phase commit (2PC)
```
Coordinator                Participant A             Participant B
   | -- PREPARE ----------->   | write+lock, log      |
   | -- PREPARE ------------------------------------> | write+lock, log
   | <-------------- YES --    |                      |
   | <---------------------------------------- YES -- |
   | log COMMIT decision                              |
   | -- COMMIT ------------>   | apply, release       |
   | -- COMMIT --------------------------------------> | apply, release
```
- Phase 1: every participant durably prepares and promises it can commit. Phase 2: coordinator commits if all voted yes, else aborts.
- **Problems:** it is **blocking**: if the coordinator dies after participants vote yes, they hold locks and cannot decide alone (in doubt) until it recovers. Latency is at least two round trips with fsyncs, locks are held across the network, throughput suffers, and availability is the product of all participants. XA support is uneven, and most modern infrastructure (Kafka, most NoSQL, SaaS APIs) cannot participate.
- 3PC adds a phase to reduce blocking but breaks under network partitions; rarely used.
- Where 2PC is fine: inside one distributed database, where the coordinator state is itself replicated via consensus (Spanner, CockroachDB), so coordinator failure does not block.

### Sagas
A saga is a sequence of **local transactions**, each committed independently, with a **compensating transaction** for each step that semantically undoes it if a later step fails. You trade isolation (other transactions can see intermediate states) for availability and loose coupling.

Checkout saga:
| Step | Action | Compensation |
|---|---|---|
| 1 | Order service: create order `PENDING` | Mark order `CANCELLED` |
| 2 | Inventory: reserve items | Release reservation |
| 3 | Payment: authorise card | Void authorisation / refund |
| 4 | Shipping: create shipment | Cancel shipment |
| 5 | Order: mark `CONFIRMED` | (pivot: after this, only forward recovery) |

**Orchestration:** a saga orchestrator (Temporal workflow, Camunda, Step Functions, or a state machine table) sends commands and reacts to replies:
```java
@WorkflowImpl
public class CheckoutWorkflowImpl implements CheckoutWorkflow {
    public OrderResult checkout(Order o) {
        Saga saga = new Saga(new Saga.Options.Builder().build());
        try {
            inventory.reserve(o.id(), o.items());
            saga.addCompensation(inventory::release, o.id());
            payments.authorize(o.id(), o.total());          // idempotent by orderId
            saga.addCompensation(payments::voidAuth, o.id());
            shipping.create(o.id(), o.address());
            orders.confirm(o.id());
            return OrderResult.confirmed(o.id());
        } catch (ActivityFailure e) {
            saga.compensate();                              // runs in reverse order
            orders.cancel(o.id(), e.getMessage());
            return OrderResult.failed(o.id());
        }
    }
}
```
**Choreography:** each service listens for the previous event and emits its own (`OrderCreated → InventoryReserved → PaymentAuthorized → ...`, failures emit `PaymentFailed`, which inventory listens to and releases). Simpler for 2–3 steps; harder to see, test and change for longer flows.

Saga design rules:
- Every step and every compensation must be **idempotent** and retryable (messages are at-least-once).
- Compensations are semantic, not rollbacks: you cannot unsend an email, so send it after the pivot step.
- Order steps so the ones most likely to fail and easiest to undo come first; put irreversible steps (capture payment, ship) last.
- Handle the **lack of isolation** with *semantic locks* (status `PENDING` that other flows respect), commutative updates, re-reading values, and versioning.
- Persist saga state so it survives crashes; set timeouts per step.

### Transactional outbox (recap)
Every saga step must update its DB and emit its event atomically. Use the outbox table in the local transaction and a relay (Debezium CDC or poller) to publish, with idempotent consumers. Without it, sagas silently lose steps.

### TCC (Try-Confirm-Cancel)
A reservation-based variant: each participant exposes **Try** (check and reserve resources, e.g. place a hold on funds or seats), **Confirm** (make the reservation final, must not fail if Try succeeded) and **Cancel** (release). The coordinator calls Try on all; if all succeed, Confirm all; otherwise Cancel. Unlike a plain saga, resources are **reserved**, not consumed, so intermediate states are less visible. Reservations need **expiry** so a crashed coordinator does not hold them forever, and Confirm/Cancel must be idempotent and handle "cancel arrives before try" (empty rollback). Card authorisation then capture is TCC in the wild; so is a hotel hold.

| Approach | Consistency | Availability/latency | Complexity | Use for |
|---|---|---|---|---|
| Local ACID | Strong | Best | Low | Anything that fits in one DB; redesign boundaries to get here |
| 2PC/XA | Atomic | Blocking, slow | Medium, infra-limited | Legacy enterprise; inside distributed SQL |
| Saga | Eventual, no isolation | High | High (compensations) | Microservice business workflows |
| TCC | Eventual with reservations | High | High (3 APIs per service) | Inventory, seats, funds holds |
| Outbox | DB + message atomic | High | Low-medium | Every event-publishing service |

### Distributed SQL: Spanner and CockroachDB
These databases give serializable (or strict serializable) ACID transactions across shards and regions:
- Data is split into ranges, each replicated with **Paxos/Raft**; a cross-range transaction uses 2PC whose coordinator and participants are themselves replicated groups, removing the blocking-coordinator problem.
- **Spanner** uses **TrueTime** (GPS and atomic clocks with bounded uncertainty) and commit-wait to assign globally meaningful timestamps, giving external consistency and lock-free snapshot reads.
- **CockroachDB** uses hybrid logical clocks with an uncertainty window and transaction restarts instead of special hardware.
- Cost: cross-region writes pay consensus round trips (tens to hundreds of ms); contention causes retries. Use them for ledgers, inventory and global user data where correctness beats latency.

## Worked examples
**Seat booking (BookMyShow):**
1. Hold: `UPDATE seats SET status='HELD', hold_id=:h, hold_expires=now()+'10 min' WHERE show_id=:s AND seat_no IN (...) AND status='FREE'`; success only if row count equals seats requested (else roll back).
2. Pay via gateway with an idempotency key = `hold_id`.
3. Confirm: `UPDATE seats SET status='BOOKED' WHERE hold_id=:h AND status='HELD' AND hold_expires > now()`.
4. A sweeper (or Redis TTL) releases expired holds; late payment success after expiry triggers an automatic refund (compensation).

**Inventory for flash sales:** atomic conditional decrement in the DB, or in Redis (Lua) as a gate with async durable write; reserve on add-to-checkout with TTL, commit on payment; never "read stock, then write stock" without a lock or condition.

**Money transfer within one bank DB:** single ACID transaction, lock both accounts in ID order, insert two ledger entries (debit and credit) that sum to zero, with a unique transaction ID for idempotency.

**Transfer across banks/services:** saga with a ledger: debit source into a *pending/suspense* account, call the external rail, then settle or reverse; reconcile daily against bank statements.

## How it shows up in interview problems
- **BookMyShow / seat reservation:** holds with TTL, conditional updates or `SKIP LOCKED`, payment saga with refund compensation.
- **E-commerce:** inventory reservation, checkout saga, outbox events.
- **Payments / wallet:** double-entry ledger in one ACID store, idempotency keys, sagas for external rails.
- **Uber:** assigning a driver is a conditional update or lock on driver status to prevent double dispatch.
- **Job scheduler:** claim jobs with `FOR UPDATE SKIP LOCKED` or a conditional update with a lease.
- **URL shortener:** unique constraint on the short code; retry on collision.
- **Distributed cache:** cache updates are not transactional with the DB; use delete-after-commit or CDC invalidation.

## Common pitfalls
- Assuming the default isolation level prevents lost updates or write skew (it usually does not).
- Read-check-write in application code without a lock, a condition, or a version.
- Holding DB locks or transactions open while calling remote services.
- Proposing 2PC across microservices without addressing blocking and infra support.
- Sagas without idempotent steps, persisted state or compensations for every step.
- Forgetting hold expiry, so crashed flows lock inventory forever.
- Not retrying serialization failures and optimistic lock exceptions.

## Interview questions
1. **What is write skew, and how do you prevent it?** Two transactions read the same condition and update different rows, together violating an invariant. Prevent with serializable isolation, locking the rows the decision is based on (`FOR UPDATE`), or materialising the constraint into a lockable row or unique constraint.
2. **Optimistic or pessimistic locking for seat booking?** Under heavy contention for the same seats, pessimistic (`FOR UPDATE` or `SKIP LOCKED`) or an atomic conditional update; optimistic for low-contention edits like profile updates or long user think-time with ETags.
3. **Why avoid 2PC across microservices?** It blocks when the coordinator fails, holds locks across network calls, multiplies latency and failure probability, and most brokers and SaaS APIs cannot participate.
4. **Explain a saga for order checkout.** Local transactions per service (order, inventory, payment, shipping) with compensations, driven by an orchestrator or events, idempotent steps, outbox for atomic publishing, irreversible steps last.
5. **What does MVCC give you and not give you?** Non-blocking reads via snapshots and no dirty or non-repeatable reads; it does not prevent write skew by itself.
6. **How is TCC different from a saga?** TCC reserves resources in Try and finalises in Confirm, so intermediate state is a reservation rather than a committed change needing compensation; it needs three idempotent operations and reservation expiry.
7. **How does Spanner do distributed transactions without blocking?** 2PC across Paxos-replicated groups (so coordinators do not disappear) plus TrueTime commit timestamps for external consistency.
8. **How do you prevent overselling inventory?** `UPDATE ... SET qty = qty - n WHERE sku = ? AND qty >= n` and check the row count, or reserve with TTL then confirm, with idempotent order keys.

## Cheat sheet
- ACID: atomic (WAL), consistent (invariants), isolated (levels), durable (fsync + replication).
- Anomalies: dirty read, non-repeatable, phantom, lost update, write skew. Read committed allows the last four.
- MVCC: snapshots, readers do not block writers; still has write skew; vacuum long transactions.
- First choice: atomic conditional UPDATE. High contention: `FOR UPDATE` (ordered), `SKIP LOCKED` for queues. Low contention: `@Version` / ETag + retry.
- 2PC: atomic but blocking; fine inside Spanner/CockroachDB, avoid across services.
- Saga: local txns + compensations; orchestrate long flows; idempotent steps; outbox; irreversible last.
- TCC: Try (reserve with expiry), Confirm, Cancel; all idempotent.
- Redesign boundaries so invariants live in one database when possible.
