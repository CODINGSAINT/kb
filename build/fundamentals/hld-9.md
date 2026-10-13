=== hld-idempotency | HLD | Idempotency, retries and exactly-once effects ===
Networks lose replies, so a caller often cannot tell "it failed" from "it worked but I never heard back". The only safe answer is to retry, and the only safe way to retry is to make the operation idempotent, so doing it twice has the same effect as doing it once. This chapter covers idempotent operations, idempotency keys, idempotent consumers and a sane retry policy with timeouts, backoff and jitter.

## 1. Why retries create duplicates

**Definition:** A duplicate happens when a retry repeats an operation that had already succeeded, because the caller never saw the success.

Think of posting a cheque and never getting a confirmation. You do not know if it was lost in the post or cashed, so you are tempted to send another one. Every hop in a system has this problem: client to API, API to database, service to broker, broker to consumer.

### The problem

```text
Client                 Payment API              Card network
  | POST /payments ---->  |                          |
  |                       | charge Rs 500 ---------> |
  |                       | <------------- approved  |
  |    X  reply lost (timeout, pod killed, LB reset)  |
  | POST /payments ---->  | charge Rs 500 again      |
```

From the client's side three cases look identical: the request never arrived, it failed, or it succeeded and the reply was lost. A naive retry in the third case charges the customer twice. Duplicates also come from double-clicks, load balancer retries, and message brokers that deliver at least once.

### Better design

```text
Client                 Payment API
  | POST /payments  (Idempotency-Key: k-81) ---> | charge, store result under k-81
  |    X  reply lost                              |
  | POST /payments  (Idempotency-Key: k-81) ---> | k-81 seen: return stored result
```

The retry carries the same identity as the first attempt, so the server can recognise it and replay the answer instead of repeating the work.

**Key takeaway:** **Retries are necessary for reliability, so every operation that changes state must be safe to repeat.**

---

## 2. Idempotent operations

**Definition:** An operation is idempotent if doing it N times leaves the system in the same state as doing it once.

Pressing a lift button five times still calls one lift. Note the subtlety: the response may differ (a second `DELETE` may return 404), but the state does not. Whenever possible, design operations to be idempotent by nature, so you do not need extra machinery.

### The problem

```sql
-- Relative update: each retry subtracts again
UPDATE accounts SET balance = balance - 100 WHERE id = 1;

-- "Create" call: each retry creates a new order
POST /orders  {"item": "book-7"}
```

If either of these is retried after a lost reply, the user loses Rs 200 or gets two orders.

### Better design

```sql
-- Conditional update: a replay matches 0 rows
UPDATE orders SET status = 'SHIPPED' WHERE id = 42 AND status = 'PAID';

-- Unique business key: a replay is ignored
INSERT INTO likes (user_id, post_id) VALUES (7, 42)
ON CONFLICT (user_id, post_id) DO NOTHING;

-- Client-generated id: PUT creates once, then overwrites the same row
PUT /orders/5f1c2e7a-...  {"item": "book-7"}
```

Absolute writes, conditional writes, unique constraints and client-generated IDs all turn "do it again" into "nothing changes".

**Trade-offs:**
- Absolute values (`SET balance = 400`) are not always possible; money movement is usually relative.
- Client-generated IDs need the client to keep the ID across retries.

**Key takeaway:** **Prefer naturally idempotent writes: set, do not add; check state in the `WHERE`; let a unique key reject repeats.**

---

## 3. Idempotency keys

**Definition:** An idempotency key is a unique ID the client sends with a request so the server can store the result once and return the same result for every retry.

It is used for operations that are inherently "do something": charge a card, transfer money, place an order. The client generates the key once per user action (for example, one checkout attempt) and reuses it on every retry. Stripe popularised the `Idempotency-Key` HTTP header and keeps keys for 24 hours.

### The problem

Without a key, the server sees two identical `POST /payments` bodies and cannot tell "a retry" from "the customer really wants to pay twice". Comparing bodies is not enough: two genuine Rs 100 transfers to the same person look identical.

### Better design

```sql
CREATE TABLE idempotency_keys (
  merchant_id   BIGINT       NOT NULL,
  idem_key      VARCHAR(64)  NOT NULL,
  request_hash  CHAR(64)     NOT NULL,  -- SHA-256 of the request body
  status        VARCHAR(16)  NOT NULL,  -- IN_PROGRESS | COMPLETED
  response_code INT,
  response_body JSONB,
  expires_at    TIMESTAMPTZ  NOT NULL,  -- e.g. now() + 24 hours
  PRIMARY KEY (merchant_id, idem_key)
);
```

The flow: try to insert the key as `IN_PROGRESS`. If the insert wins, do the work and save the response. If the key already exists, answer from the row.

```java
@PostMapping("/v1/payments")
ResponseEntity<?> pay(@RequestHeader("Idempotency-Key") String key,
                      @RequestBody PaymentRequest req, Merchant m) {
    String hash = sha256(req.canonicalJson());
    if (!idemRepo.tryInsert(m.id(), key, hash)) {        // INSERT ... ON CONFLICT DO NOTHING
        IdemRow row = idemRepo.find(m.id(), key);
        if (!row.hash().equals(hash)) return ResponseEntity.unprocessableEntity().build(); // 422
        if (row.inProgress())       return ResponseEntity.status(409).build();             // retry later
        return ResponseEntity.status(row.code()).body(row.body());                         // replay
    }
    PaymentResponse resp = payments.charge(m.id(), key, req);  // pass key to the gateway too
    idemRepo.complete(m.id(), key, 201, resp);   // same DB transaction as the payment row
    return ResponseEntity.status(201).body(resp);
}
```

The key row and the payment row commit together, so the database never shows "paid but no key". Passing the same key to the card gateway protects the one step outside your database. In a real service this logic lives in a filter or an `@Idempotent` aspect so every mutating endpoint gets it.

**Trade-offs:**
- An extra write per request and a cleanup job for expired keys.
- Redis (`SET key NX EX 86400`) is faster but not atomic with the database write, and keys can be lost on failover. Use the business database for money.
- Keep keys longer than the client's retry horizon; if clients retry for a day, keep them at least a day.

**Key takeaway:** **One key per user action, stored with the result in the same transaction as the effect; a retry gets the stored answer, never a second execution.**

### Timeout vs. failure

- A **failure** (card declined) is a known result: store it and replay it.
- A **timeout** is an unknown result: the charge may have happened. Never retry with a new key. Retry with the same key, or mark the payment `PENDING` and let a reconciliation job ask the provider.

---

## 4. Idempotent consumers and dedup

**Definition:** An idempotent consumer is a message handler that can receive the same message more than once and still apply its effect only once.

Kafka, SQS and RabbitMQ normally deliver **at least once**: a message can arrive again after a consumer crash or a rebalance. Picture a postman who sometimes delivers the same letter twice; you just need to notice you already read it.

### The problem

```text
consume "Debit Rs 100, msg m-9" -> update balance -> crash before ack / offset commit
restart -> broker redelivers m-9 -> balance debited again
```

The effect committed but the acknowledgement did not, so the broker sends the message again.

### Better design

```sql
BEGIN;
INSERT INTO processed_messages (consumer, message_id) VALUES ('billing', 'm-9')
ON CONFLICT DO NOTHING;            -- 0 rows inserted? duplicate: ROLLBACK and ack
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;                            -- then ack / commit the offset
```

The "already processed" record and the effect commit in one transaction, so a redelivery hits the primary key and is skipped. An alternative is a per-entity sequence: apply only `WHERE id = ? AND last_seq < :seq`, which also rejects old messages arriving late.

**Trade-offs:**
- The dedup table grows; expire rows older than the longest possible redelivery delay.
- The producer must give each event a stable ID created once (for example in the outbox row), not a fresh UUID per send attempt.

**Key takeaway:** **At-least-once delivery plus idempotent processing gives an exactly-once effect.**

### Exactly-once delivery vs. exactly-once effect

- **Exactly-once delivery** over a network is not achievable in general; a sender can never be sure whether a lost ack means a lost message.
- **Exactly-once effect** is achievable: deliver at least once and make the handler ignore repeats.
- Kafka's "exactly-once semantics" covers reading and writing within Kafka (idempotent producer plus transactions). Side effects outside Kafka, such as a database update or an email, still need idempotent handling.

---

## 5. Timeouts

**Definition:** A timeout is the maximum time a caller waits for a remote call before giving up.

Without one, a stuck dependency holds your thread forever, and soon every thread is stuck. Set a **connect timeout** (time to open the connection, usually short) and a **read or request timeout** (time for the response).

### The problem

```text
Order service: 200 threads, no timeout on calls to Inventory
Inventory hangs -> each request blocks forever
After ~200 requests: all threads blocked, Order service is down too
```

One slow dependency becomes a full outage of every caller.

### Better design

```java
var factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(200);    // ms
factory.setReadTimeout(800);       // a bit above Inventory's p99 latency
RestClient inventory = RestClient.builder()
        .baseUrl("http://inventory")
        .requestFactory(factory)
        .build();
```

Base the value on the dependency's real latency (a little above p99), not a round number. Also pass the remaining **deadline** down the call chain (gRPC does this natively), so a callee does not keep working after the caller has given up.

**Key takeaway:** **Every remote call gets a timeout; a timeout means "unknown", not "failed".**

---

## 6. Which errors to retry

**Definition:** A retryable error is a transient one, where trying again later has a real chance of succeeding.

Retry the weather, not the address. A busy server may be free in a second; a wrong request will be wrong forever.

### The problem

```text
POST /transfers -> 400 Bad Request (invalid IFSC code)
client retries 5 times -> 5 more 400s, 5x load, same answer
POST /payments (no key) -> timeout -> client retries -> double charge
```

Retrying permanent errors wastes capacity, and retrying non-idempotent calls creates duplicates.

### Better design

- **Retry:** connection refused or reset, timeouts (only if the call is idempotent or carries a key), 429 Too Many Requests (honour `Retry-After`), 502, 503, 504, database deadlocks and serialization failures (retry the whole transaction).
- **Do not retry:** 400, 401, 403, 404, 422, business rejections (card declined, insufficient funds), 409 conflicts (re-read state instead), and anything non-idempotent without a key.

**Key takeaway:** **Retry only transient errors, and only on idempotent operations.**

---

## 7. Exponential backoff with jitter

**Definition:** Exponential backoff waits longer after each failed attempt; jitter adds randomness to that wait so clients do not retry in sync.

If a shop reopens after a power cut and everyone outside rushes the door at once, nobody gets in. Backoff makes people wait longer each time; jitter makes them arrive at different moments.

### The problem

```text
10,000 clients fail at 12:00:00
All retry after exactly 1s -> 10,000 requests at 12:00:01
All retry after exactly 2s -> 10,000 requests at 12:00:03
```

The retries arrive as synchronised waves (a **thundering herd**: many clients hitting the same resource at the same moment) that keep the recovering service overloaded. Worse, if four layers each try 3 times, one user request can become 3^4 = 81 calls to the bottom service.

### Better design

```java
// "Full jitter": sleep a random time between 0 and the exponential cap
long backoffMillis(int attempt) {
    long base = 100, cap = 10_000;
    long exp = Math.min(cap, base * (1L << attempt));   // 100, 200, 400, 800 ...
    return ThreadLocalRandom.current().nextLong(exp + 1);
}

// Or with Resilience4j: exponential steps, each randomised by +-50%
RetryConfig cfg = RetryConfig.custom()
        .maxAttempts(4)
        .intervalFunction(IntervalFunction.ofExponentialRandomBackoff(200, 2.0, 0.5))
        .retryExceptions(IOException.class, TimeoutException.class)
        .build();
```

Randomness spreads the retries over time, so the service sees a smooth trickle instead of spikes. Retry at **one layer** only (usually the outermost one that knows the call is safe), cap the attempts, and add a **retry budget** (for example, retries may be at most 10% of traffic) plus a circuit breaker so a dead dependency is not hammered.

**Trade-offs:**
- More attempts raise the success rate but add latency for the user.
- Jitter makes individual latency less predictable.

**Key takeaway:** **Back off exponentially, add jitter, cap attempts, and retry at one layer.**

---

## In an HLD interview

- **Payment System / Amazon checkout:** client-generated idempotency key per checkout, stored with the payment row and passed to the gateway; a timeout leads to `PENDING` plus reconciliation, never a blind re-charge.
- **Notification System:** dedupe on `(notification_id, channel)` so a consumer retry does not send two SMS.
- **BookMyShow / Seat Reservation:** confirming a hold is a conditional update (`WHERE hold_id = ? AND status = 'HELD'`), so a retry is harmless.
- **Rate Limiter / API Gateway:** return 429 with `Retry-After` so well-behaved clients back off.
- What to SAY: "Delivery is at least once and replies can be lost, so every write is idempotent: a key for creates, conditional updates for state changes, and dedup in consumers. Retries use exponential backoff with jitter at one layer only."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Duplicates | A lost reply looks like a failure | What happens if this request runs twice? |
| Idempotent operation | N runs = 1 run | Can I make this a set, conditional or unique write? |
| Idempotency key | Client ID per action, server stores result | Is the key saved in the same transaction as the effect? |
| Idempotent consumer | Skip already-processed message IDs | Does a redelivery change anything? |
| Timeout | Bound every remote wait | Is every call bounded, and do I treat a timeout as unknown? |
| Retryable errors | Transient only | Will trying again ever give a different answer? |
| Backoff + jitter | Wait longer, randomly | Will clients retry in sync, or at every layer? |

## Final memory aid

- A timeout is "unknown", not "failed".
- Retries are required, so writes must be idempotent.
- Set, do not add; check state in the `WHERE`; unique keys reject repeats.
- One idempotency key per user action, reused on every retry.
- Store the key with the effect in one transaction.
- At-least-once delivery + idempotent consumer = exactly-once effect.
- Retry transient errors only, with exponential backoff and jitter, at one layer.

=== hld-transactions | HLD | Transactions and distributed transactions ===
A transaction groups several reads and writes into one unit that either fully happens or not at all, and that behaves sensibly when other transactions run at the same time. Inside one database this is mostly solved, as long as you pick the right locking style. Across services it gets hard, and the practical tools are sagas with compensation and the transactional outbox rather than two-phase commit.

## 1. ACID, simply

**Definition:** ACID is the set of four guarantees a database transaction gives: Atomicity, Consistency, Isolation, Durability.

- **Atomicity:** all writes happen or none do. A crash halfway leaves nothing half-done.
- **Consistency:** your rules (balance never negative, every order has a customer) hold before and after. The database helps with constraints, but mostly this is the application's job.
- **Isolation:** concurrent transactions do not trip over each other's half-finished work.
- **Durability:** once committed, data survives a crash (it is in the write-ahead log on disk, usually also replicated).

### The problem

```sql
UPDATE accounts SET balance = balance - 500 WHERE id = 1;   -- debit Asha
-- server crashes here
UPDATE accounts SET balance = balance + 500 WHERE id = 2;   -- credit Ravi
```

Without a transaction, Rs 500 disappears: Asha was debited and Ravi was never credited.

### Better design

```sql
BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;
COMMIT;   -- both or neither
```

If the crash happens before `COMMIT`, recovery rolls the debit back. Money is never created or lost.

**Key takeaway:** **A transaction is all-or-nothing; isolation is the part you must actually think about.**

---

## 2. Isolation anomalies

**Definition:** An isolation anomaly is a wrong result caused by two transactions interleaving.

Databases offer **isolation levels** that trade safety for speed. Most default to a weaker level than people assume, so know what each one still allows.

### The problem

Tiny examples, each with two transactions T1 and T2:

```text
Dirty read:          T2 debits Rs 100 (not committed). T1 reads the new balance. T2 rolls back.
                     T1 used a balance that never existed.
Non-repeatable read: T1 reads balance = 500. T2 commits balance = 300. T1 reads again: 300.
Phantom:             T1 counts bookings for room 12 = 3. T2 inserts one. T1 counts again: 4.
Lost update:         T1 and T2 both read stock = 10, both write 10 - 1 = 9. Two sales, stock 9.
Write skew:          Rule: at least one doctor on call. Two are on call. Each checks "the other
                     is on call" and goes off call. Now zero doctors are on call.
```

Lost update and write skew are the ones that bite in interviews, because common defaults allow them.

### Better design

| Level | Prevents | Still allows |
|---|---|---|
| Read committed (Postgres, Oracle, SQL Server default) | Dirty reads | Non-repeatable reads, phantoms, lost update, write skew |
| Repeatable read / snapshot (MySQL InnoDB default) | Also non-repeatable reads | Write skew (and lost update in MySQL) |
| Serializable | All of the above | Nothing, but more aborts and retries |

Most databases use **MVCC** (multi-version concurrency control): each transaction reads a snapshot of committed row versions, so readers do not block writers. Snapshots alone still allow write skew. Fix lost updates and write skew with serializable isolation or with the explicit techniques in the next three sections.

**Key takeaway:** **The default isolation level does not stop lost updates or write skew; add a condition, a lock or a version.**

---

## 3. Atomic conditional updates

**Definition:** An atomic conditional update checks and changes a row in a single SQL statement.

This is the simplest fix and should be your first choice. The database applies the check and the write together, so no other transaction can sneak in between.

### The problem

```java
int stock = jdbc.queryForObject(
        "SELECT available FROM inventory WHERE sku = ?", Integer.class, sku);
if (stock >= 1) {
    jdbc.update("UPDATE inventory SET available = ? WHERE sku = ?", stock - 1, sku);
}
```

Two buyers both read 1, both write 0, and the last item is sold twice.

### Better design

```sql
UPDATE inventory SET available = available - 1
WHERE sku = 'SKU-42' AND available >= 1;
-- 1 row updated = success, 0 rows = sold out
```

The row lock taken by the `UPDATE` serialises the two buyers; the second one re-checks `available >= 1`, finds 0, and updates no row.

**Key takeaway:** **Put the check in the `WHERE` clause and read the affected-row count.**

---

## 4. Pessimistic locking

**Definition:** Pessimistic locking locks the rows first, then reads and decides, assuming a conflict is likely.

It is like taking the only key to the meeting room: others wait until you return it. Use it when many users fight over the same rows and the logic needs more than one statement.

### The problem

A transfer must check the balance, apply a fee rule and write two ledger rows. A single `UPDATE` cannot express it, and two concurrent transfers can both pass the balance check.

### Better design

```sql
BEGIN;
SELECT id, balance FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;  -- lock both
-- application checks balance and fees
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;
COMMIT;   -- locks released
```

```java
interface SeatRepo extends JpaRepository<Seat, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)            // SELECT ... FOR UPDATE
    @Query("select s from Seat s where s.id in :ids order by s.id")
    List<Seat> lockSeats(@Param("ids") List<Long> ids);
}
```

Others wanting those rows wait, so the check and the write cannot interleave. Locking in a fixed order (ascending ID) avoids deadlocks. `FOR UPDATE SKIP LOCKED` skips rows someone else holds, which suits job queues and "give me any free seat".

**Trade-offs:**
- Waiting reduces throughput on hot rows.
- Never hold a lock while calling a remote service or waiting for a user.

**Key takeaway:** **Lock first, in a consistent order, and keep the transaction short.**

---

## 5. Optimistic locking

**Definition:** Optimistic locking takes no lock; it checks at write time, with a version number, that nobody changed the row since you read it.

It is like editing a shared document and being told "someone saved a newer version" when you click save. It is cheap when conflicts are rare.

### The problem

Two admins open product 42 (price 500). One saves 450; the other saves 520 a minute later. The first change is silently lost.

### Better design

```sql
UPDATE products SET price = 450, version = version + 1
WHERE id = 42 AND version = 7;      -- 0 rows: someone changed it, reload and retry
```

```java
@Entity
class Product {
    @Id Long id;
    BigDecimal price;
    @Version Long version;   // JPA adds "AND version = ?" and increments it
}
// A stale write throws ObjectOptimisticLockingFailureException: reload, retry or tell the user
```

Over HTTP the same idea uses an `ETag` with `If-Match`; the server answers **412 Precondition Failed** if the version has moved.

**Trade-offs:**
- Under heavy contention many writers fail and retry, wasting work.

**Key takeaway:** **Use a version column when conflicts are rare or the user "thinks" between read and write.**

### Pessimistic vs. optimistic

- **Pessimistic** assumes conflict: lock early, others wait, each attempt eventually succeeds. Good for hot rows (popular seats, balances).
- **Optimistic** assumes no conflict: no lock, a version check at write, losers retry. Good for low-contention edits and long think-time.
- Neither works across services; that needs the patterns below.

---

## 6. Two-phase commit (2PC)

**Definition:** 2PC makes several databases commit or abort together: a coordinator first asks every participant to prepare, then tells them all to commit.

It works like a wedding: the officiant asks each person "do you?", and only after both say yes declares them married.

### The problem

```text
Coordinator       Order DB              Payment DB
  | PREPARE ----> | locks rows, votes YES
  | PREPARE --------------------------> | locks rows, votes YES
  X  coordinator crashes before sending COMMIT
                  | "in doubt": rows stay locked until the coordinator returns
```

Participants that voted yes cannot decide alone, so they hold locks and block. 2PC also adds round trips and holds locks across the network, and most brokers and SaaS APIs (a card gateway, an email provider) cannot take part at all.

### Better design

Keep 2PC where its coordinator is itself replicated: inside distributed SQL databases such as Spanner or CockroachDB, which run 2PC over consensus-replicated groups, so one machine failing does not block. Across microservices, use a saga.

**Key takeaway:** **2PC is atomic but blocking; avoid it across microservices.**

---

## 7. Sagas with compensation

**Definition:** A saga is a sequence of local transactions, one per service, where each step has a compensating action that undoes it if a later step fails.

Booking a holiday works this way: book the flight, then the hotel; if the hotel fails, cancel the flight. Nothing is locked across services, but others can briefly see the in-between state.

### The problem

```text
Order service: create order  (own DB)   ok
Inventory:     reserve item  (own DB)   ok
Payment:       charge card              FAILS
Without a saga: stock reserved forever, order stuck in limbo
```

### Better design

```text
Step                         Compensation
1. Order: create PENDING     -> mark CANCELLED
2. Inventory: reserve        -> release reservation
3. Payment: authorise        -> void / refund
4. Order: mark CONFIRMED     (point of no return; after this, only move forward)
```

An **orchestrator** (a workflow engine such as Temporal, or a state-machine table) calls each step and, on failure, runs the compensations in reverse order. In **choreography**, each service instead reacts to the previous service's event; fine for 2-3 steps, hard to follow beyond that.

**Trade-offs:**
- No isolation: others see `PENDING` states, so treat status as a soft lock.
- Every step and compensation must be idempotent and retryable.
- Some actions cannot be undone (an email sent); put them after the point of no return.

**Key takeaway:** **A saga trades isolation for availability: local commits plus compensations, driven by persisted state.**

---

## 8. Transactional outbox

**Definition:** The outbox pattern writes the business change and the event to publish in the same database transaction; a separate relay publishes the event afterwards.

### The problem

```java
@Transactional
void placeOrder(Order o) {
    orderRepo.save(o);
    kafka.send("orders", new OrderPlaced(o.id()));   // sent, then the DB commit fails?
}
```

If the commit fails after the send, consumers see an order that does not exist. If you send after the commit and crash in between, the event is lost and the saga stalls.

### Better design

```sql
BEGIN;
INSERT INTO orders (id, status) VALUES (42, 'PENDING');
INSERT INTO outbox (event_id, type, payload)
VALUES ('e-901', 'OrderPlaced', '{"orderId":42}');
COMMIT;
-- relay (a poller or Debezium CDC) reads the outbox, publishes, marks rows sent
```

Both rows commit or neither does. The relay may publish an event twice after a crash, so consumers dedupe by `event_id`.

**Key takeaway:** **Never write to a database and a broker separately; write both to the database and relay.**

---

## 9. Putting it together: seats, inventory, payment

**Definition:** Real flows combine a local atomic step, a short-lived hold, and a saga for the parts outside your database.

### The problem

A BookMyShow user picks seats, then spends two minutes paying. You cannot hold a database lock for two minutes, and payment runs in another system.

### Better design

```sql
-- 1. Hold: all seats or none (roll back unless row count = seats requested)
UPDATE seats SET status = 'HELD', hold_id = 'h-77',
       hold_expires = now() + interval '10 minutes'
WHERE show_id = 9 AND seat_no IN ('A7', 'A8') AND status = 'FREE';
-- 2. Pay via the gateway with idempotency key = 'h-77'
-- 3. Confirm only if the hold is still ours and alive
UPDATE seats SET status = 'BOOKED'
WHERE hold_id = 'h-77' AND status = 'HELD' AND hold_expires > now();
```

A sweeper frees expired holds. If payment succeeds after the hold expired, the compensation is an automatic refund. Flash-sale inventory has the same shape: conditional decrement, reserve with a TTL, confirm on payment. A wallet transfer inside one database stays a single ACID transaction with two ledger rows; a transfer to another bank becomes a saga with a pending state and daily reconciliation.

**Key takeaway:** **Hold with a TTL, pay with an idempotency key, confirm conditionally, compensate on late failure.**

---

## In an HLD interview

- **BookMyShow / Seat Reservation:** conditional `UPDATE` or `SKIP LOCKED` for holds, TTL expiry, payment saga with refund compensation.
- **Amazon E-commerce:** conditional stock decrement, checkout saga, outbox events to shipping and email.
- **Payment System:** double-entry ledger in one ACID database; sagas and reconciliation for external rails.
- **Uber / Job Scheduler:** assign a driver or claim a job with a conditional update on status, so two workers never both win.
- What to SAY: "Inside one database I use a conditional update or a row lock; across services I avoid 2PC and use a saga with compensations, an outbox for events, and idempotent steps."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| ACID | All-or-nothing, isolated, durable | Can a crash leave half a change? |
| Anomalies | Interleaving breaks reads and rules | Does my isolation level allow lost update or write skew? |
| Conditional update | Check in the `WHERE` | Can one SQL statement do the check and the write? |
| Pessimistic lock | Lock, then decide | Is contention high and the logic multi-step? |
| Optimistic lock | Version check at write | Are conflicts rare, or is the user thinking? |
| 2PC | Prepare, then commit everywhere | What happens if the coordinator dies? |
| Saga | Local steps + compensations | What undoes each step, and is it idempotent? |
| Outbox | Event in the same transaction | Can my DB write and my event disagree? |

## Final memory aid

- Transaction = all or nothing; isolation needs thought.
- Defaults allow lost updates and write skew.
- First choice: `UPDATE ... WHERE condition`, then check the row count.
- Hot rows: `FOR UPDATE` in ID order; queues: `SKIP LOCKED`.
- Rare conflicts: `@Version`, or ETag with `If-Match`.
- 2PC blocks; sagas compensate.
- Outbox for every event; consumers dedupe.
- Hold with a TTL, pay with a key, confirm conditionally.
