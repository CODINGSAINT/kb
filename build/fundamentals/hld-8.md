=== hld-messaging | HLD | Message queues, pub/sub and event-driven architecture ===
Messaging lets one service hand off work or announce a fact without waiting for the services that react to it. This chapter compares queues, pub/sub and logs, explains how Kafka partitions, offsets and consumer groups work, and then covers the parts interviewers probe: delivery guarantees, retries and dead-letter queues, backpressure, the outbox pattern, and choreography versus orchestration.

## 1. Sync vs. async communication

**Definition:** In synchronous calls the caller waits for the answer; in asynchronous messaging the caller drops a message on a broker and moves on.

A phone call is synchronous: both people must be available at the same time. A text message is asynchronous: the sender continues, and the receiver reads it when ready. A **broker** is the middleman (Kafka, RabbitMQ, SQS) that stores messages until consumers take them.

### The problem

```text
 POST /orders
   OrderService -> PaymentService   (80 ms)
                -> InventoryService (60 ms)
                -> EmailService     (900 ms, sometimes down)
                -> AnalyticsService (120 ms)
 Total ~1.2 s, and the order FAILS when EmailService is down.
```

The user waits for work they do not care about, and one non-critical service can break checkout.

### Better design

```text
 POST /orders
   OrderService -> PaymentService, InventoryService  (sync, must succeed)
                -> publish "OrderPlaced" to broker    (~5 ms)
   reply 201 to user  (~150 ms)

 broker -> EmailService      (sends when it can, retries if down)
        -> AnalyticsService  (consumes at its own pace)
```

Only steps that decide the response stay synchronous. Everything else reacts to an event, so a slow or failed consumer no longer hurts the user.

**Trade-offs:**
- Harder to debug: the flow is spread across services and time (use trace IDs).
- Results are eventually consistent; the email arrives a little later.

**Key takeaway: Keep the response path synchronous and minimal; push side effects to async messages.**

---

## 2. Queue vs. pub/sub vs. log

**Definition:** A queue gives each message to one consumer; pub/sub gives each message to every subscriber; a log stores messages durably in order so any reader can read from any position.

A queue is like a to-do pile shared by workers: each task is done once, then removed. Pub/sub is like a newsletter: every subscriber gets a copy. A log is like a ledger: entries are kept, and each reader keeps its own bookmark.

### The problem

```text
 Using a plain work queue for "OrderPlaced":
   EmailService and AnalyticsService both consume from one queue
   -> each message goes to ONE of them
   -> half the orders get no email, half are missing from analytics
 Later: "replay last week's orders into the new fraud model" -> data gone
```

A queue splits work; it does not broadcast. And once acknowledged, messages are deleted, so they cannot be replayed.

### Better design

| Need | Use | Examples |
|---|---|---|
| Spread tasks across workers, each done once | Queue | SQS, RabbitMQ queue |
| Every interested service gets every event | Pub/sub | SNS, RabbitMQ fanout exchange |
| Fan-out plus ordering, replay, high volume | Log | Kafka, Kinesis, Pulsar |

A log does both jobs: each consumer group gets every event, and within a group the work is split. Events stay for the retention period, so a new service can replay history.

**Key takeaway: Queue = work split, pub/sub = broadcast, log = broadcast + order + replay.**

---

## 3. Kafka partitions, offsets and consumer groups

**Definition:** A Kafka topic is split into partitions; each partition is an append-only log where every message has a sequential offset, and a consumer group shares the partitions among its members.

A **partition** is the unit of parallelism and ordering. An **offset** is a message's position in its partition (0, 1, 2...). A **consumer group** is a set of instances of one service; Kafka assigns each partition to exactly one consumer in the group. Each group commits its own offsets, so groups do not affect each other.

### The problem

```text
 Topic "payments" with 1 partition, 6 consumer instances in a group.
   partition 0 -> consumer 1;  consumers 2..6 sit idle.
 Or: 12 partitions, producer sends with NO key
   PaymentCreated(order 42) -> partition 3
   PaymentRefunded(order 42) -> partition 9  (processed first!)
```

One partition caps throughput at one consumer. Without a key, related events land in different partitions and can be processed out of order.

### Better design

```java
// Same key -> same partition -> ordered for that key
producer.send(new ProducerRecord<>("payments", orderId, event));
```

```text
 12 partitions, key = orderId, group of 6 consumers -> 2 partitions each
 All events of order 42 go to one partition, so they stay in order.
 Max useful consumers in a group = number of partitions.
```

Ordering is guaranteed only within a partition, so pick the key that defines "must stay in order" (order ID, user ID, chat ID).

**Trade-offs:**
- A hot key (one celebrity user) overloads one partition.
- Adding partitions later changes the key-to-partition mapping for new messages.
- Rebalancing (when consumers join or leave) briefly pauses consumption.

**Key takeaway: Partition count sets parallelism; the message key sets ordering.**

---

## 4. Delivery guarantees

**Definition:** At-most-once may lose messages, at-least-once may duplicate them, and exactly-once means the effect happens once.

The difference is when the consumer records its progress (commits the offset or acks). Over a real network, "exactly-once delivery" end to end is not possible; what you can build is **exactly-once effect** with at-least-once delivery plus an idempotent consumer (one where processing the same message twice has the same result as once).

### The problem

```text
 at-most-once:  commit offset -> process -> crash  => message lost
 at-least-once: process (charge card) -> crash before commit
                restart -> same message again -> card charged TWICE
```

### Better design

```sql
-- at-least-once delivery + idempotent consumer
INSERT INTO processed_messages (message_id) VALUES ('evt-981');
-- unique key violation => already done, skip
UPDATE accounts SET balance = balance - 500 WHERE id = 7;
-- both statements in ONE database transaction, then commit the offset
```

Duplicates are now harmless. On the producer side, Kafka's idempotent producer (`enable.idempotence=true`) stops retries creating duplicates, and `acks=all` with `min.insync.replicas=2` stops acknowledged messages being lost. Kafka transactions give exactly-once for read-from-Kafka, write-to-Kafka pipelines, but not for external side effects like sending an email.

**Key takeaway: Default to at-least-once delivery with idempotent consumers; that is how real systems get exactly-once effects.**

---

## 5. Retries and dead-letter queues

**Definition:** Retries re-attempt a failed message; a dead-letter queue (DLQ) is where messages go after too many failures so they stop blocking others.

Some failures are temporary (a timeout), and a retry fixes them. Others are permanent (malformed JSON, a deleted account). A message that fails every time is called a **poison message**.

### The problem

```text
 partition 4:  [m100][m101 bad JSON][m102][m103]...
 consumer retries m101 forever -> m102 onward never processed
 lag grows to 2 million, alerts fire, orders stuck
```

In an ordered log, one poison message blocks everything behind it in that partition.

### Better design

```text
 attempt 1 fails -> retry after 1 s
 attempt 2 fails -> retry after 5 s   (exponential backoff + jitter)
 attempt 3 fails -> publish to "orders.DLQ" with error + headers,
                    commit offset, continue with m102
 DLQ: alert, inspect, fix the bug, replay the message to the main topic
```

Healthy messages keep flowing, and failures are kept for a human or automated replay instead of being dropped. For longer delays, use separate retry topics so the main consumer is not stuck sleeping.

**Trade-offs:**
- Moving a message aside breaks strict ordering for that key.
- A DLQ nobody watches is just a slower way to lose data.

**Key takeaway: Bounded retries with backoff, then park the message in a DLQ and keep going.**

---

## 6. Backpressure

**Definition:** Backpressure is a way for a slow consumer to slow down producers, or for the system to absorb or shed load, instead of falling over.

A broker is a buffer, like a reservoir behind a dam. It smooths spikes, but if inflow stays above outflow for long enough, it fills up.

### The problem

```text
 Flash sale: producers 50,000 msg/s, consumers handle 10,000 msg/s
 Backlog grows by 40,000/s -> 144 million in an hour
 In-memory queue -> OutOfMemoryError; consumers retry harder -> DB melts
```

### Better design

```text
 1. Durable buffer (Kafka) absorbs the spike instead of memory.
 2. Consumers pull at their own pace (max.poll.records) -> no overload.
 3. Monitor consumer lag; autoscale consumers up to the partition count.
 4. At the edge: rate-limit or return 429 / "try later" for non-critical work.
 5. Bounded in-memory queues: when full, block or reject, never grow forever.
```

Pull-based consumption plus lag-based scaling lets the system catch up, and limits at the edge stop unbounded growth.

**Key takeaway: Every queue must be bounded or monitored; decide in advance whether you buffer, scale, slow down or shed.**

---

## 7. The outbox pattern

**Definition:** Write the business change and the event to the same database in one transaction, then publish the event from that table.

The core problem is the **dual write**: updating a database and a broker are two separate systems, and you cannot commit both atomically.

### The problem

```java
@Transactional
public void placeOrder(Order o) {
    orderRepo.save(o);                          // DB commit happens at method end
    kafka.send("orders", o.id(), placed(o));    // sent before the commit
}
// Kafka send succeeds, then DB commit fails -> event for an order that does not exist
// Or reorder them: DB commits, then the app crashes -> order with no event
```

Either way, the database and the event stream disagree.

### Better design

```sql
BEGIN;
INSERT INTO orders (id, status, ...) VALUES (42, 'PLACED', ...);
INSERT INTO outbox (id, topic, key, payload) VALUES (gen_random_uuid(), 'orders', '42', '{...}');
COMMIT;
-- A relay publishes outbox rows to Kafka, then marks them sent.
-- Relay = polling job, or CDC (Debezium reading the DB's change log).
```

Both rows commit or neither does. The relay may publish an event twice after a crash, so consumers must be idempotent.

**Key takeaway: Never dual-write; commit the event with the data and let a relay publish it.**

---

## 8. Choreography vs. orchestration

**Definition:** In choreography, services react to each other's events with no central controller; in orchestration, one coordinator tells each service what to do next.

Both are ways to run a **saga**: a multi-step business process across services, where each step has a compensating action (an undo, such as a refund) instead of one big distributed transaction.

### The problem

```text
 Choreography with 7 services:
 OrderPlaced -> Payment -> PaymentDone -> Inventory -> Reserved
   -> Shipping -> ... -> Loyalty -> ...
 Question: "Where is order 42 stuck, and who triggers the refund?"
 Answer: read logs from 7 services.
```

Pure choreography spreads the business flow across many services, so nobody owns it.

### Better design

```text
 OrderSaga (orchestrator, state stored in DB):
   1. command Payment.charge      -> ok
   2. command Inventory.reserve   -> FAILED
   3. compensate: Payment.refund  -> ok
   4. mark order CANCELLED
 Small flows (2-3 steps, e.g. "send email on signup") -> choreography is fine.
```

The orchestrator holds the state of each order, so failures, timeouts and compensation have one owner. Tools like Temporal or Camunda provide this.

### Choreography vs. orchestration
- **Choreography:** loose coupling, no single point of control; hard to see and change long flows.
- **Orchestration:** clear flow and status in one place; the orchestrator is extra code and must be highly available.

**Key takeaway: Choreography for simple reactions, orchestration for long business flows that need compensation.**

---

## In an HLD interview
- **Notification System:** order events go to a topic; email, SMS and push services each have a consumer group, with retries, DLQs and idempotency keys to avoid double notifications.
- **Chat/WhatsApp:** partition by conversation ID so messages in one chat stay in order.
- **Payment System / Amazon E-commerce:** outbox for "PaymentCompleted", idempotent consumers, and an orchestrated saga for order, payment and inventory.
- **YouTube / Logging/Monitoring:** async pipelines (upload -> transcode -> thumbnail) and logs buffered in Kafka to absorb spikes.
- What to SAY: "Kafka gives at-least-once delivery, so every consumer is idempotent with a processed-message table, and I key by orderId to keep each order's events in order."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Async messaging | Don't wait for side effects | Does the user need this step's result now? |
| Queue / pub-sub / log | Split work / broadcast / ordered replayable history | One consumer, all consumers, or replay? |
| Partitions and keys | Parallelism and per-key ordering | What must stay in order? |
| Delivery guarantees | At-least-once + idempotency | What happens if this message arrives twice? |
| Retries and DLQ | Bounded retries, then park it | Can one bad message block a partition? |
| Backpressure | Buffer, scale, slow or shed | What if producers outpace consumers for an hour? |
| Outbox | Commit event with data | Am I writing to DB and broker separately? |
| Choreography vs. orchestration | Reactions vs. a coordinator | Who owns this flow and its compensation? |

## Final memory aid
- Sync for the answer, async for side effects.
- Queue splits, pub/sub copies, log keeps and replays.
- Partitions give parallelism; keys give order.
- At-least-once + idempotent consumer = exactly-once effect.
- Retry with backoff, then DLQ.
- Every buffer needs a limit and a lag alarm.
- Outbox kills the dual write.
- Long flows with refunds need an orchestrator.

=== hld-stream-processing | HLD | Batch and stream processing ===
Batch processing works on a fixed pile of data after the fact; stream processing works on events continuously as they arrive. This chapter explains how streams handle time correctly with event time, windows and watermarks, how they keep state safe with checkpoints, and when to use Lambda or Kappa architecture. It ends with worked examples: metrics, trending topics and click counting.

## 1. Batch vs. stream processing

**Definition:** Batch processing runs a job over a bounded dataset (for example, all of yesterday's logs); stream processing runs continuously over an unbounded flow of events.

Batch is like counting the day's cash after the shop closes: simple, complete, but late. Streaming is like a running total updated at the till with every sale: fresh, but you must handle sales recorded out of order. Batch tools include Spark and Hadoop MapReduce; stream tools include Flink, Kafka Streams and Spark Structured Streaming.

### The problem

```text
 Fraud detection as a nightly batch job:
   02:00  job scans yesterday's 40M transactions
   02:40  flags a stolen card used 300 times since 14:00 yesterday
 Fraud found 12 hours too late.
```

### Better design

```text
 Stream: transactions -> Kafka -> Flink job
   per card: count in last 5 minutes > 10?  -> block card (seconds)
 Batch (still useful): nightly job retrains the fraud model on all data
   and recomputes exact daily reports.
```

Use streaming when the value of the answer decays in minutes; use batch for heavy, complete, recomputable work.

**Trade-offs:**
- Streaming adds complexity: time, state, late data, and 24x7 operation.
- Batch is simpler and easier to rerun, but results are hours old.

**Key takeaway: Choose by freshness: seconds need streams, hours can be batch.**

---

## 2. Event time vs. processing time

**Definition:** Event time is when something actually happened (stamped on the device); processing time is when your system handles it.

They differ because of network delays, offline phones and backlogs. A phone in airplane mode may upload yesterday's clicks this morning.

### The problem

```text
 Count clicks per minute using processing time:
 Ad clicked at 10:00:30 on a phone on a slow train.
 Event arrives at 10:04:10.
 Report: 10:00 minute undercounted, 10:04 minute overcounted.
 After a consumer outage, a 30-minute backlog lands in one minute -> fake spike.
```

Results depend on when your pipeline was healthy, not on what users did.

### Better design

```text
 Each event carries eventTime = 10:00:30 (set by the client or edge).
 Group by eventTime -> the click goes into the 10:00 bucket,
 whenever it arrives.  Replaying old data gives the same answer.
```

Correct, reproducible results come from grouping by event time.

**Key takeaway: Aggregate by event time when correctness matters; processing time is only fine for rough operational dashboards.**

---

## 3. Windows: tumbling, sliding, session

**Definition:** A window groups an endless stream into finite chunks so you can compute an aggregate over each chunk.

You cannot "count all clicks" on an infinite stream, but you can count clicks per minute. The window type decides how the chunks are cut.

### The problem

```text
 "Requests in the last 5 minutes, updated every minute"
 implemented with fixed 5-minute buckets:
   10:00-10:05, 10:05-10:10 ...
 At 10:07 the dashboard shows 10:00-10:05 (stale) or a half-full bucket.
```

The wrong window shape gives answers that jump or lag.

### Better design

```text
 Tumbling (fixed, no overlap): 10:00-10:01, 10:01-10:02 ...
     -> clicks per minute, billing per hour
 Sliding / hopping (size 5 min, every 1 min): 10:00-10:05, 10:01-10:06 ...
     -> "last 5 minutes" metrics; each event lands in 5 windows
 Session (gap-based): a window per user that closes after 30 min idle
     -> visits per user session, watch-time per sitting
```

Each shape matches a question: per period, rolling recent, or per burst of activity.

**Key takeaway: Tumbling for per-period totals, sliding for rolling metrics, session for user activity bursts.**

---

## 4. Watermarks and late data

**Definition:** A watermark is the stream's estimate that "no more events older than time T will arrive", which tells a window when it may close.

Using event time raises a question: when is the 10:00-10:01 window finished? Events can always be late. A watermark is usually set as "largest event time seen, minus an allowed delay" (for example, 30 seconds).

### The problem

```text
 Close each window the moment the clock passes its end:
   10:01:00 -> emit count for 10:00-10:01 = 980
   10:01:20 -> 40 more events for 10:00 arrive -> dropped
 Or wait 1 hour before closing every window -> dashboard 1 hour late
```

Closing too early loses data; waiting too long kills freshness.

### Better design

```text
 watermark = max eventTime seen - 30 s
 Window 10:00-10:01 emits when watermark passes 10:01  (~10:01:30)
 Allowed lateness 10 min: late events update the result (emit a correction)
 Later than that -> side output to a "late events" store for batch repair
```

Most data is counted promptly, stragglers still fix the result, and very late data is kept rather than lost.

**Trade-offs:**
- Bigger watermark delay = more complete but slower results.
- Allowing late updates means downstream systems must accept corrections (upserts, not appends).

**Key takeaway: Watermarks trade latency for completeness; decide what happens to late events, never ignore them.**

---

## 5. Stateful processing and checkpoints

**Definition:** Stateful processing keeps data between events (counts, open windows, last seen values); checkpoints periodically save that state so the job can recover after a crash.

Counting clicks per ad requires remembering the running count. That state lives inside the stream processor (in Flink, often in RocksDB on local disk), partitioned by key like the data.

### The problem

```text
 Job keeps counts in a HashMap in memory.
 Machine dies at 10:42.
 Restart -> counts start from 0, or re-read Kafka from the beginning
 -> numbers wrong, or hours to recover.
```

### Better design

```text
 Every 1 minute, Flink takes a consistent checkpoint:
   - all operator state (counts, open windows) -> S3 / HDFS
   - the Kafka offsets that state corresponds to
 Crash at 10:42 -> restore checkpoint from 10:41
   -> rewind Kafka to the saved offsets -> reprocess 1 minute
```

State and input position are saved together, so after recovery each event affects the state exactly once. Output to external systems still needs idempotent writes or transactional sinks to avoid duplicates.

**Trade-offs:**
- Large state makes checkpoints slower and recovery longer.
- Shorter checkpoint intervals mean less replay but more overhead.

**Key takeaway: Save state and input offsets together; that is what makes streaming results exactly-once inside the job.**

---

## 6. Lambda vs. Kappa architecture

**Definition:** Lambda runs a batch layer and a streaming layer side by side; Kappa uses a single streaming pipeline and reprocesses history by replaying the log.

Lambda arose when streaming engines were not trusted to be accurate: the stream gave fast approximate numbers, and the nightly batch overwrote them with exact ones. Modern engines with event time, watermarks and checkpoints made Kappa practical.

### The problem

```text
 Lambda: the same "revenue per hour" logic written twice
   - Spark batch job (SQL) and a Flink streaming job (Java)
 A bug fix lands in one but not the other -> two numbers that never match
```

### Better design

```text
 Kappa: Kafka (long retention or tiered storage) -> one Flink job -> store
 Need to fix logic? Deploy job v2, replay from offset 0 into a new table,
 switch readers when it catches up, delete v1.
```

One codebase, one set of numbers. Lambda still fits when history is too large to replay or when the batch side needs tools the stream lacks, such as model training over years of data.

### Lambda vs. Kappa
- **Lambda:** two pipelines; accurate batch plus fast stream; double the code.
- **Kappa:** one pipeline; reprocess by replay; needs long log retention.

**Key takeaway: Prefer Kappa today; keep a batch layer only when replaying history through the stream is impractical.**

---

## 7. Worked examples: metrics, trending, click counting

**Definition:** Most streaming interview questions are a key, a window and an aggregate, plus a sink to serve the results.

### The problem

```text
 Ad click counting: every click does
   UPDATE ads SET clicks = clicks + 1 WHERE id = ?
 At 200,000 clicks/s, hot ads become lock hotspots; the DB falls over.
 Retries double-count; no protection against bots.
```

### Better design

```text
 Click counting:
   clicks -> Kafka (key = adId) -> Flink: dedupe by clickId,
   tumbling 1-min window, count per adId -> upsert into OLAP store
   (one row per ad per minute), hourly rollups for billing.
 Metrics / Monitoring:
   agents pre-aggregate per 10 s -> stream computes p50/p99 per service
   per minute -> time-series DB; alerts on sliding 5-min windows.
 Trending hashtags:
   sliding 1-hour window, hop 1 min, count per tag (sharded by tag),
   then a top-K per window merged across shards; approximate counts
   (Count-Min Sketch) when tags are too many to count exactly.
```

Writes become one row per key per window instead of one per event, and dedupe by event ID makes retries safe.

**Key takeaway: Key, window, aggregate, then write small pre-aggregated results; never update a database row per event.**

---

## In an HLD interview
- **Metrics / Logging/Monitoring:** agents to Kafka to a stream job; tumbling windows per minute into a time-series store; alerts on sliding windows.
- **News Feed / Google Search trending:** sliding windows plus top-K; mention approximate counting for huge key spaces.
- **Uber / Ride Tracking:** location events keyed by driver ID; event time matters because phones lose signal; session windows for trips.
- **Payment System fraud, Rate Limiter analytics:** stateful per-card or per-user counts over short windows.
- What to SAY: "I'll aggregate on event time with one-minute tumbling windows, a 30-second watermark and late events sent to a correction path, and Flink checkpoints with Kafka offsets give exactly-once counts."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Batch vs. stream | Bounded later vs. unbounded now | How fast does the answer lose value? |
| Event vs. processing time | When it happened vs. when we saw it | Would a backlog distort my numbers? |
| Windows | Tumbling, sliding, session | Per period, rolling, or per activity burst? |
| Watermarks | "Nothing older than T is coming" | How late can data be, and what do I do then? |
| State + checkpoints | Save state with input offsets | What happens to my counts after a crash? |
| Lambda vs. Kappa | Two pipelines vs. one with replay | Can I reprocess history through the stream? |
| Pre-aggregation | One write per key per window | Am I updating a DB row per event? |

## Final memory aid
- Batch = complete but late; stream = fresh but must handle time.
- Group by event time, not arrival time.
- Tumbling per period, sliding for "last N minutes", session for activity.
- Watermarks decide when a window closes; plan for late data.
- Checkpoint state and offsets together.
- Kappa by default; Lambda only when replay is impractical.
- Key, window, aggregate, then write small results.
