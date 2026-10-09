=== hld-messaging | HLD | Message queues, pub/sub and event-driven architecture ===
Messaging decouples the service that produces work or facts from the services that react to them, in time, in availability and in scale. This chapter separates the two big families (queues and logs), opens up Kafka's internals, compares RabbitMQ and SQS semantics, and then covers the hard parts interviewers probe: delivery guarantees, retries and DLQs, backpressure, the outbox pattern, event sourcing, CQRS and choreography versus orchestration.

## Why asynchronous messaging
A synchronous call chain `A → B → C` has availability `A × B × C` and latency `A + B + C`. If C is slow, A's threads pile up. Putting a broker between them changes the contract from "do this now" to "this needs doing" or "this happened":
- **Temporal decoupling:** the consumer can be down for an hour; messages wait.
- **Load levelling:** a 10x spike becomes a growing backlog instead of a cascading failure. Consumers drain it at their own pace.
- **Fan-out:** one `OrderPlaced` event feeds billing, inventory, email, analytics and search indexing without the order service knowing any of them.
- **Independent scaling:** add consumers for the slow stage only.

The price is eventual consistency, harder debugging (correlation IDs and tracing become mandatory), duplicate and out-of-order delivery, and one more piece of infrastructure to run.

## Two families: queues and logs
| | Message queue (RabbitMQ, SQS, ActiveMQ) | Distributed log (Kafka, Pulsar, Kinesis) |
|---|---|---|
| Storage model | Messages deleted once acknowledged | Append-only log retained by time/size; reading does not delete |
| Consumption | Competing consumers; each message to one worker | Consumers track an offset; many independent groups re-read the same data |
| Ordering | Best effort (FIFO queues are a special mode) | Strict within a partition |
| Replay | No (once acked, gone) | Yes, rewind the offset |
| Per-message routing | Rich (exchanges, topics, headers, priorities, delays) | Minimal: topic + partition by key |
| Per-message ack/redelivery | Yes, individual | Offset commit (everything before offset N is done) |
| Throughput | Tens of thousands/s per node | Millions/s per cluster (sequential disk I/O, batching, zero-copy) |
| Best for | Task/job queues, RPC-style work distribution, per-message retry/delay | Event streams, CDC, analytics pipelines, event sourcing, many readers |

Rule of thumb: **"do this job" → queue; "this happened" → log.** Many companies run both.

**Point-to-point vs pub/sub.** A queue with several workers is point-to-point: each message processed once by one of them. Pub/sub delivers each message to every subscriber. Kafka gives both at once: within a consumer group it is point-to-point (partitions are split among members); across groups it is pub/sub.

## Kafka internals
```
Topic "orders" (3 partitions, replication factor 3)

P0: [0][1][2][3][4][5][6] ...   leader broker-1, followers broker-2, broker-3
P1: [0][1][2][3][4] ...         leader broker-2, followers broker-3, broker-1
P2: [0][1][2][3][4][5] ...      leader broker-3, followers broker-1, broker-2

Consumer group "billing":   c1 ← P0, P1     c2 ← P2
Consumer group "analytics": a1 ← P0, P1, P2  (independent offsets)
```

### Topics, partitions and offsets
- A **topic** is a named stream split into **partitions**. Each partition is an ordered, immutable sequence of records stored as segment files on disk; each record gets a monotonically increasing **offset**.
- Partitions are the unit of **parallelism** (one consumer per partition per group at a time) and of **ordering**.
- The producer chooses the partition: `hash(key) % numPartitions` when a key is set, otherwise sticky/round-robin batching. **Same key → same partition → ordered.** Key by `orderId`, `accountId` or `userId`, whichever entity's events must stay in order.
- Changing the partition count remaps keys, which breaks per-key ordering across the change. Over-provision partitions up front (for example 2–3x expected consumer count).

### Consumer groups and rebalancing
- Consumers in a group share partitions. With 6 partitions and 3 consumers each gets 2; a 7th consumer would sit idle. **Max parallelism = partition count.**
- When a member joins, leaves or misses heartbeats (`session.timeout.ms`) or takes too long between polls (`max.poll.interval.ms`), the group **rebalances**. Cooperative sticky assignment avoids the old "stop the world" rebalance.
- Each group commits its offset per partition to the internal `__consumer_offsets` topic. **Lag** = log end offset minus committed offset; it is the most important consumer metric.

### Replication, ISR and acks
- Each partition has one **leader** (handles reads and writes) and followers that replicate it. Followers that are caught up form the **in-sync replica set (ISR)**.
- The **high watermark** is the offset replicated to all ISR members; consumers only see records below it.
- Producer `acks`:

| Setting | Meaning | Risk |
|---|---|---|
| `acks=0` | Fire and forget | Loses data on any failure |
| `acks=1` | Leader wrote it | Lost if the leader dies before followers copy |
| `acks=all` | All ISR members have it | Durable, slightly higher latency |

- Pair `acks=all` with `min.insync.replicas=2` and replication factor 3: a write succeeds only if at least two copies exist, and the topic tolerates one broker down. Set `unclean.leader.election.enable=false` so an out-of-date replica never becomes leader.
- `enable.idempotence=true` gives each producer an ID and per-partition sequence numbers, so broker-side retries do not create duplicates or reorder records.

### Retention and compaction
- **Delete policy:** keep data for `retention.ms` (e.g. 7 days) or `retention.bytes`, then drop whole segments. Consumers can replay anything inside the window.
- **Compact policy:** keep at least the **latest value per key**; older values for the same key are garbage-collected, and a record with a null value (a **tombstone**) deletes the key. A compacted topic is a durable changelog of current state: user profiles, account settings, Kafka Streams state stores, CDC tables.
- Tiered storage moves old segments to object storage, making long retention cheap.

### Why Kafka is fast
Sequential appends to the OS page cache, batching and compression per partition, zero-copy `sendfile` from page cache to socket, and consumers that pull at their own pace.

## RabbitMQ and SQS semantics
**RabbitMQ (AMQP):** producers publish to an **exchange**; bindings route to **queues**. Exchange types: *direct* (exact routing key), *topic* (wildcards like `order.*.eu`), *fanout* (broadcast), *headers*. Consumers ack each message; `prefetch` (QoS) caps unacked messages per consumer, which is your backpressure knob. Nack with requeue, dead-letter exchanges, TTL, priorities and delayed delivery are built in. Quorum queues replicate via Raft. Streams add a Kafka-like log mode.

**Amazon SQS:**
- **Standard queues:** nearly unlimited throughput, at-least-once, best-effort ordering.
- **FIFO queues:** strict ordering per `MessageGroupId`, deduplication by `MessageDeduplicationId` within a 5-minute window, lower throughput.
- **Visibility timeout:** a received message is hidden, not deleted. If the consumer does not delete it before the timeout, it reappears for another consumer. That is how SQS gives at-least-once, and why long processing must extend the timeout.
- `maxReceiveCount` on a redrive policy moves repeat failures to a DLQ. Long polling (`WaitTimeSeconds=20`) cuts empty receives.
- SNS + SQS gives fan-out: one SNS topic, one SQS queue per subscriber service.

## Delivery guarantees
| Guarantee | How it arises | Consequence |
|---|---|---|
| **At-most-once** | Commit/ack *before* processing | Crash mid-processing loses the message |
| **At-least-once** | Process, *then* commit/ack | Crash after processing but before commit redelivers; duplicates |
| **Exactly-once** | Atomic "process + record progress" | Possible only inside a closed system, or as exactly-once *effects* via idempotency |

Exactly-once delivery over a network is impossible in general; what you build is **at-least-once delivery plus idempotent processing = exactly-once effect**. Kafka offers true exactly-once *within Kafka* (read-process-write between topics) with idempotent producers plus **transactions**: the output records and the consumer offset commit are written atomically, and downstream consumers use `isolation.level=read_committed`. The moment you call an external API or write to another database, you are back to idempotency (see the idempotency chapter).

## Failure handling: retries, DLQs and poison messages
A **poison message** is one that will never succeed (malformed payload, a bug for that shape of data). With naive retry it blocks a Kafka partition forever or loops endlessly in a queue.

A robust pipeline:
1. **Classify** errors. Transient (timeout, 503, lock conflict) → retry. Permanent (validation, deserialization, 4xx) → straight to DLQ.
2. **Bounded in-place retry** with exponential backoff for a few attempts (milliseconds to seconds).
3. **Retry topics/queues** with increasing delay (`orders-retry-1m`, `orders-retry-10m`) so a slow retry does not block the main partition.
4. **Dead-letter queue** after N attempts, with the original payload, error, stack trace, attempt count and source offset in headers.
5. **Operate the DLQ:** alert on its depth, build tooling to inspect, fix and **redrive** messages.

Trade-off: moving a message to a retry topic lets later messages for the same key overtake it. If strict per-key ordering matters (account ledger), either block the partition (and alert) or park all subsequent messages for that key too.

## Backpressure
When producers outpace consumers something must give: buffer, drop, or slow the producer.
- Kafka is pull-based, so consumers are naturally protected; the backlog becomes lag on disk. Watch lag and autoscale consumers (up to the partition count), e.g. KEDA on lag.
- RabbitMQ: `prefetch` limits in-flight work per consumer; memory/disk alarms throttle publishers.
- Bounded in-process queues and thread pools; reject (`429/503`) at the edge rather than accepting work you cannot finish.
- Reactive streams (Project Reactor) propagate demand (`request(n)`) end to end.
- Size it: if each message takes 20 ms and you must process 5,000 msg/s, you need at least 100 concurrent workers, so at least 100 partitions (or batch processing).

## The transactional outbox
The **dual-write problem**: a service updates its DB and publishes an event. If it commits the DB and crashes before publishing, the event is lost; if it publishes first and the DB commit fails, the world hears about something that never happened.

The fix: write the event into an `outbox` table **in the same local transaction** as the business change, and relay it afterwards.
```sql
BEGIN;
INSERT INTO orders (id, user_id, total, status) VALUES (:id, :uid, 4999, 'PLACED');
INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at)
VALUES (gen_random_uuid(), 'Order', :id, 'OrderPlaced', :json, now());
COMMIT;
```
A relay publishes outbox rows to the broker, either a poller (`SELECT ... FOR UPDATE SKIP LOCKED`, publish, mark sent) or, better, **CDC** with Debezium reading the database's write-ahead log. The relay is at-least-once, so consumers must dedupe by event ID. The mirror image on the consumer side is the **inbox** table: record processed message IDs in the same transaction as the side effect.

## Event sourcing and CQRS
**Event sourcing** stores the sequence of state-changing events as the source of truth (`AccountOpened`, `MoneyDeposited`, `MoneyWithdrawn`); current state is a fold over the events. Benefits: full audit trail, time travel, rebuilding new read models by replay, natural fit for domains that are already ledgers. Costs: event schema evolution (events are forever; use upcasters), snapshots needed for long streams, harder ad-hoc queries, and a steep learning curve. Use it for ledgers, booking histories and compliance-heavy domains; not for a CRUD settings page.

**CQRS** (Command Query Responsibility Segregation) splits the write model (validates commands, enforces invariants, normalised) from one or more read models (denormalised, query-optimised, possibly in different stores) kept up to date by events. It pairs naturally with event sourcing but does not require it. Expect read-your-writes lag: return the new version on the command response, or have the UI wait for the projection to reach it.

## Choreography vs orchestration
| | Choreography | Orchestration |
|---|---|---|
| Control | Each service reacts to events and emits its own | A central orchestrator sends commands and tracks state |
| Coupling | Loose; producers do not know consumers | Orchestrator knows every step |
| Visibility | Flow is implicit, spread over services | Flow is explicit in one place |
| Change | Easy to add a listener; hard to change a sequence | Easy to change the sequence |
| Failure handling | Each service handles compensation | Orchestrator drives retries and compensations |
| Tools | Kafka/SNS events | Temporal, Camunda/Zeebe, AWS Step Functions, a saga state machine |

Use choreography for simple fan-out reactions (send email when order placed). Use orchestration once a business process has more than 3–4 steps, timeouts, human steps or compensations.

## Spring Kafka example
```java
@Configuration
class KafkaConfig {
    @Bean
    DefaultErrorHandler errorHandler(KafkaTemplate<String, Object> template) {
        var recoverer = new DeadLetterPublishingRecoverer(template,
            (rec, ex) -> new TopicPartition(rec.topic() + ".DLT", rec.partition()));
        var backoff = new ExponentialBackOffWithMaxRetries(4);
        backoff.setInitialInterval(500);
        backoff.setMultiplier(2.0);
        var handler = new DefaultErrorHandler(recoverer, backoff);
        handler.addNotRetryableExceptions(ValidationException.class,
                                          DeserializationException.class);
        return handler;
    }
}

@Component
class PaymentListener {
    private final ProcessedEventRepository processed;
    private final LedgerService ledger;

    @KafkaListener(topics = "orders", groupId = "billing", concurrency = "6")
    @Transactional
    public void onOrderPlaced(@Payload OrderPlaced evt,
                              @Header(KafkaHeaders.RECEIVED_KEY) String orderId) {
        if (!processed.markIfNew(evt.eventId())) {   // INSERT ... ON CONFLICT DO NOTHING
            return;                                  // duplicate delivery, ignore
        }
        ledger.charge(evt.orderId(), evt.amount());  // same DB transaction as the marker
    }
}
```
```yaml
spring:
  kafka:
    producer:
      acks: all
      properties:
        enable.idempotence: true
        max.in.flight.requests.per.connection: 5
    consumer:
      enable-auto-commit: false
      auto-offset-reset: earliest
      properties:
        isolation.level: read_committed
        max.poll.records: 200
    listener:
      ack-mode: record
```
Spring Kafka also has `@RetryableTopic` for non-blocking retry topics with configurable delays.

## Real-world systems
- **LinkedIn** built Kafka for activity tracking and metrics; it now carries trillions of messages per day.
- **Uber** uses Kafka for trip events and a retry-topic/DLQ pattern documented in its engineering blog.
- **Netflix** pipes playback and device events through Kafka into Flink and its data lake.
- **Shopify, Debezium users** use CDC from MySQL/Postgres into Kafka as the outbox transport.

## How it shows up in interview problems
- **Notification system:** a queue per channel (email, SMS, push), priority queues, retry with backoff, DLQ, idempotency by notification ID, rate limits per provider.
- **News feed:** `PostCreated` event → fan-out workers write into followers' feed caches.
- **Chat:** Kafka between chat service and gateway servers, partitioned by conversation ID for ordering.
- **YouTube/Dropbox:** upload complete event → transcoding or indexing job queue.
- **E-commerce/payments:** outbox from the order service, saga across inventory, payment and shipping.
- **Logging/metrics/ads clicks:** Kafka as the durable buffer before stream processing.
- **Job scheduler:** due jobs pushed to a work queue; workers ack on completion; visibility timeouts for crashes.

## Common pitfalls
- Assuming exactly-once delivery and writing non-idempotent consumers.
- Auto-committing offsets before processing (silent message loss).
- Too few partitions, capping consumer parallelism; or keyless publishing that destroys ordering.
- Hot partitions from a skewed key (one celebrity user); salt the key if per-key order is not needed.
- Unbounded retries that block a partition on a poison message.
- Huge messages (multi-MB); store the blob in S3 and send a reference (claim-check pattern).
- No schema discipline; use Avro/Protobuf with a schema registry and backward-compatible evolution.
- Using a broker as a database for ad-hoc queries.

## Interview questions
1. **Queue or Kafka for sending emails?** Either works; a queue (SQS/RabbitMQ) fits naturally because each email is an independent job with per-message retry and delay. Choose Kafka if the same events also feed analytics or several consumers.
2. **How does Kafka guarantee ordering?** Only within a partition. Use the entity ID as the key, keep producer idempotence on, and have one consumer thread per partition (or per key).
3. **What happens when a consumer crashes mid-batch?** Its partitions are reassigned after the session timeout; the new owner resumes from the last committed offset, so uncommitted records are redelivered. Processing must be idempotent.
4. **How do you avoid losing data in Kafka?** RF=3, `acks=all`, `min.insync.replicas=2`, idempotent producer, unclean leader election off, commit offsets only after processing.
5. **Explain the outbox pattern.** Write the business row and an event row in one local transaction; a relay (poller or Debezium CDC) publishes events; consumers dedupe by event ID. It removes the dual-write inconsistency.
6. **How do you handle a poison message?** Classify the error; send non-retryable ones immediately to a DLQ; retry transient ones with backoff via retry topics; alert on DLQ depth and support redrive.
7. **Choreography or orchestration for order checkout?** Orchestration (Temporal or a saga orchestrator) once it involves payment, inventory, shipping and compensations; choreography for side reactions like emails and analytics.
8. **What is log compaction for?** Keeping the latest value per key indefinitely so a topic can rebuild current state (changelogs, KTables, CDC snapshots).

## Cheat sheet
- Queue = jobs, deleted on ack, per-message retry. Log = facts, retained, replayable, many groups.
- Kafka: partition = order + parallelism unit; key picks the partition; parallelism capped by partitions.
- Durability: RF 3, acks=all, min.insync=2, idempotent producer.
- At-least-once + idempotent consumer = exactly-once effect. Kafka EOS only inside Kafka.
- Retries with backoff → retry topics → DLQ; never block forever.
- Outbox (+ CDC) for DB + event atomicity; inbox for consumer dedupe.
- Event sourcing = events are the truth; CQRS = separate read models.
- Simple reactions: choreography. Multi-step with compensation: orchestration.
- Monitor consumer lag, DLQ depth, rebalance rate.

=== hld-stream-processing | HLD | Batch and stream processing ===
Once events are flowing through a log, you need to turn them into answers: counts, aggregates, joins, alerts and derived datasets. Batch processing computes over bounded data with high throughput and simple correctness; stream processing computes continuously over unbounded data with low latency but must deal with time, disorder, state and failure. This chapter covers both, the architectures that combine them, windowing and watermarks, exactly-once state, and the pre-aggregation tricks that power metrics, trending and ads systems.

## Bounded vs unbounded data
- **Batch:** input is finite and known (yesterday's logs in S3). Jobs run to completion, can be re-run from scratch, and see all data before producing output. Latency: minutes to hours.
- **Stream:** input never ends (clicks arriving now). The job runs forever, emits results incrementally, and must decide when it has "enough" data to emit. Latency: milliseconds to seconds.

A useful mental model: **a batch is just a stream that ends**, and modern engines (Flink, Spark Structured Streaming, Beam) use the same APIs for both.

## Batch processing
### MapReduce
```
input splits → map(k1,v1) → list(k2,v2) → shuffle & sort by k2 → reduce(k2, list(v2)) → output
word count: map emits (word, 1); shuffle groups by word; reduce sums
```
Key ideas that still matter: move computation to the data, partition by key so all values for a key meet in one reducer, materialise intermediate results to disk for fault tolerance (a failed task is simply re-run), and keep tasks deterministic so re-execution is safe. Combiners pre-aggregate on the map side to shrink the shuffle.

### Spark
Spark keeps intermediate data in memory and builds a DAG of transformations, so iterative and multi-stage jobs are 10–100x faster than chained MapReduce. Narrow transformations (`map`, `filter`) stay within a partition; **wide** ones (`groupByKey`, `join`) trigger a **shuffle** across the network, which is the expensive part. Lineage lets lost partitions be recomputed. DataFrames/SQL with the Catalyst optimiser are the normal interface.

Batch patterns to know:
- **ETL/ELT** into a warehouse or lakehouse (Parquet/Iceberg/Delta on S3).
- **Broadcast join** when one side is small; **sort-merge join** when both are large.
- **Skew handling:** salt hot keys, then aggregate twice.
- **Idempotent outputs:** write to a partition path (`dt=2026-10-09/`) and overwrite atomically, so re-runs replace instead of duplicating.

## Stream processing engines
| Engine | Model | Strengths | Notes |
|---|---|---|---|
| **Apache Flink** | True record-at-a-time, distributed dataflow | Event-time semantics, large keyed state (RocksDB), exactly-once checkpoints, low latency | The default answer for serious stateful streaming |
| **Kafka Streams** | Library inside your Java app | No separate cluster; state in local RocksDB backed by compacted changelog topics; EOS within Kafka | Input and output must be Kafka; scale = partitions |
| **Spark Structured Streaming** | Micro-batches (or continuous mode) | Unified with batch Spark, SQL | Latency typically hundreds of ms to seconds |
| **Apache Beam / Dataflow** | Unified model, runner-agnostic | Rigorous windowing/triggers model | Runs on Flink, Spark or Google Dataflow |
| **ksqlDB, Flink SQL** | Streaming SQL | Fast to build simple pipelines | Less control for complex logic |

## Lambda vs Kappa architecture
```
Lambda:  events ─┬─> batch layer (Spark over all history) ──> batch views ─┐
                 └─> speed layer (stream, recent only)  ──> realtime view ─┴─> serving: merge

Kappa:   events ──> log (long retention) ──> stream processor ──> serving views
         reprocess = start a new job version from offset 0, swap when caught up
```
| | Lambda | Kappa |
|---|---|---|
| Code paths | Two (batch + stream), must agree | One |
| Correctness | Batch layer periodically fixes stream approximations | Stream engine must be correct (event time, exactly-once) |
| Reprocessing | Re-run batch | Replay the log into a new job |
| Ops cost | High (two systems, reconciliation) | Lower, but needs long log retention or tiered storage |

Lambda was a response to early stream engines being inaccurate. With Flink-class engines, Kappa is the usual modern answer, often with the lake as the long-term replay source. Many ad and billing systems still keep a daily batch **reconciliation** job as a correctness backstop, which is effectively Lambda-lite.

## Time: event time vs processing time
- **Event time:** when the event happened on the device (timestamp in the payload).
- **Ingestion time:** when it reached the broker.
- **Processing time:** when the operator sees it.

Mobile clients go offline, networks delay, partitions lag. A click at 10:59:58 may arrive at 11:03. Aggregating by processing time is simple but gives wrong and non-reproducible answers (replaying yesterday puts everything into "now"). Aggregate by **event time** for anything business-relevant (billing, ads, metrics per minute).

## Watermarks and late data
A **watermark** is the engine's assertion: "I believe no more events with timestamp less than T will arrive." When the watermark passes the end of a window, the window fires.
```
Watermark = max event time seen − allowed out-of-orderness (e.g. 10 s)

events:  10:00:03  10:00:07  10:00:01  10:00:12  10:00:15 ...
max seen:   :03       :07       :07       :12       :15
watermark:  9:59:53   9:59:57   9:59:57   10:00:02  10:00:05
```
Trade-off: a larger bound means more complete results but higher latency; a smaller bound means faster results but more late events.

Handling events that arrive after the watermark:
- **Allowed lateness:** keep window state for an extra period and emit **updated** results (downstream must accept upserts).
- **Side output:** route very late events to a separate stream for correction or batch reconciliation.
- **Drop** them, with a metric, if accuracy at the margin does not matter.

Idle partitions can stall watermarks (the minimum across inputs stops moving); engines provide idleness timeouts.

## Windows
| Window | Definition | Example |
|---|---|---|
| **Tumbling** | Fixed size, non-overlapping | Clicks per ad per minute |
| **Sliding / hopping** | Fixed size, advancing by a smaller slide (an event is in several windows) | Requests in the last 5 min, updated every 10 s (rate limiting, alerting) |
| **Session** | Per key, closes after a gap of inactivity | User sessions with a 30-min gap; watch time per viewing session |
| **Global + trigger** | One window per key, emits on custom triggers | Emit every 1,000 events or every 5 s |

```
Tumbling 1m: |----W1----|----W2----|----W3----|
Sliding 5m/1m: |-----W1-----|
                 |-----W2-----|
                   |-----W3-----|
Session (gap 30m):  e e e     e       ......(31m idle)......   e e
                    |-------S1-------|                         |-S2-|
```

## Stateful processing and checkpoints
Aggregations, joins, dedup and pattern detection need **state**: counts per key, the last seen event, a buffer of a window. In Flink, state is **keyed** (partitioned by the same key as the stream, so it scales out) and held in memory or RocksDB on local disk.

Fault tolerance via **distributed snapshots** (Chandy-Lamport style):
1. The job manager injects a **checkpoint barrier** into each source.
2. Each operator, on receiving barriers from all inputs, snapshots its state to durable storage (S3/HDFS) and forwards the barrier.
3. The checkpoint completes when every operator has acknowledged. Source offsets are part of it.
4. On failure, every operator restores the last completed checkpoint and sources rewind to the recorded offsets. State and input position are consistent, so internal results are **exactly-once**.

**End-to-end exactly-once** also needs the sink to cooperate:
- **Transactional sink:** two-phase commit tied to checkpoints (Flink's Kafka sink pre-commits a Kafka transaction and commits it when the checkpoint completes). Readers use `read_committed`.
- **Idempotent sink:** upsert by a deterministic key (`(ad_id, window_start)`), so replays overwrite instead of double-counting. This is the simplest and most common choice for databases.

Kafka Streams does the same with Kafka transactions: input offsets, state changelog writes and output records are committed atomically (`processing.guarantee=exactly_once_v2`).

**Savepoints** are manually triggered checkpoints used to upgrade or rescale a job without losing state.

## Stream joins
| Join | What | State needed |
|---|---|---|
| **Stream-stream (windowed)** | Match impressions with clicks within 30 min by `impression_id` | Buffer both sides for the window |
| **Stream-table** | Enrich each order event with the current customer record | Table materialised locally from a compacted topic/CDC (KTable, broadcast state) |
| **Table-table** | Maintain a joined materialised view of two changelogs | Both tables |
| **Temporal join** | Join with the table *as of the event's time* (FX rate at trade time) | Versioned table |

Prefer a local, co-partitioned table over calling a database per event: a remote lookup per record caps throughput at the DB's QPS and adds latency. If you must call out, use async I/O with a cache.

## Pre-aggregation for metrics, top-K and counting
Raw events are too many to query at read time; push aggregation into the stream.
- **Rollups:** per-second counters → per-minute → per-hour, stored in a time-series DB or OLAP store (Druid, Pinot, ClickHouse). Downsample old data.
- **Local pre-aggregation:** aggregate on the producer or in a first operator (combiner) before the network shuffle; this also fixes hot keys.
- **Two-stage aggregation for skew:** key by `(videoId, random 0..N)`, aggregate, then re-key by `videoId` and merge.
- **Top-K / trending:** per partition keep counts in a **count-min sketch** plus a min-heap of size K; merge heaps across partitions every window. Exact counting with a hash map per window works if the key space fits in memory.
- **Distinct counts:** HyperLogLog per window, mergeable across windows and shards (unique viewers per hour).
- **Percentiles:** t-digest or HDR histograms, mergeable; never average p99s.

## Real-world systems
- **Netflix:** Kafka plus Flink (Keystone) for real-time personalisation and operational insight.
- **Uber:** Flink-based platform for surge pricing and marketplace metrics, Pinot for real-time OLAP.
- **LinkedIn:** Samza (and Kafka Streams-style processing) for feeds and metrics; Pinot for "who viewed your profile".
- **Twitter/X:** trending topics with windowed counting and heavy-hitter algorithms.
- **Google:** MillWheel and Dataflow, where the watermark model came from.

## How it shows up in interview problems
- **Ad click aggregation:** Kafka (key `ad_id`) → Flink with 1-minute tumbling event-time windows, watermark 10–30 s, dedupe by `click_id` (state with TTL), allowed lateness with upserts, idempotent sink to an OLAP store keyed by `(ad_id, minute)`, and a daily batch reconciliation from raw logs in S3 for billing.
- **Metrics/monitoring:** agents → Kafka → stream rollups (10 s, 1 min) → time-series DB; alerting rules as sliding windows.
- **Logging:** Kafka → stream parsing/enrichment → Elasticsearch hot tier + S3 cold tier; batch jobs for long-range analytics.
- **Trending hashtags / top-K songs / YouTube views:** windowed counts with count-min sketch and heaps; approximate is fine and stated as such.
- **Uber:** location stream → geo-cell aggregation of supply and demand per H3 cell per minute → surge pricing.
- **Fraud/payments:** stateful pattern detection (5 failed attempts in 2 minutes across cards per device) with session or sliding windows.
- **Web crawler / search indexing:** batch for full re-index, stream for incremental updates.

## Common pitfalls
- Using processing time for billing or metrics, so replays and lag produce wrong numbers.
- Ignoring late data, or not telling downstream that results may be updated.
- Unbounded state (dedup sets without TTL, session windows on bot traffic that never goes idle).
- Hot keys overwhelming one task; fix with local pre-aggregation or salting.
- Per-event synchronous DB lookups for enrichment.
- Non-idempotent sinks, which turn checkpoint replays into double counts.
- Claiming "exactly-once" without explaining sources, state and sink.
- Under-sizing Kafka retention so you cannot reprocess after a bug.

## Interview questions
1. **Event time vs processing time, and why it matters?** Event time is when it happened; processing time is when the system sees it. Business aggregates must use event time so delayed, out-of-order or replayed events land in the right window.
2. **What is a watermark?** A monotonically advancing timestamp asserting no older events are expected; windows fire when it passes their end. Its delay trades completeness against latency.
3. **How do you handle late events in ad click counting?** Allowed lateness with updated (upserted) window results; very late events to a side output; a daily batch reconciliation from raw logs for billing.
4. **How does Flink achieve exactly-once?** Checkpoint barriers create consistent snapshots of operator state plus source offsets; on failure it restores and replays. End to end requires a transactional (2PC) or idempotent sink.
5. **Lambda or Kappa?** Kappa (one streaming code path, replay from the log) unless you need a batch layer for heavy historical recomputation or financial reconciliation; mention the duplicate-logic cost of Lambda.
6. **How do you compute top-K trending items over the last hour?** Sliding window counts per key with local pre-aggregation; per-partition heap of size K (or count-min sketch plus heap for large key spaces); merge partial top-Ks centrally; serve from cache.
7. **How do you enrich a click stream with ad metadata?** Stream-table join: materialise the ad table from a CDC/compacted topic into local state (or broadcast state) instead of querying the DB per event.
8. **How do you deal with a hot key?** Two-phase aggregation with a salted key, or local combiners before the shuffle.

## Cheat sheet
- Batch: bounded, re-runnable, high throughput (Spark, MapReduce). Stream: unbounded, incremental, low latency (Flink, Kafka Streams).
- Kappa = one stream path + replay; Lambda = batch + speed layers; keep a batch reconciliation for money.
- Use event time; watermark = max seen minus bound; late data → allowed lateness, side output or drop.
- Windows: tumbling (fixed), sliding (overlapping), session (gap-based).
- State is keyed and checkpointed; barriers give consistent snapshots; sinks must be transactional or idempotent.
- Joins: stream-stream windowed, stream-table via local materialised table, temporal for as-of.
- Pre-aggregate: combiners, rollups, salting, count-min + heap for top-K, HLL for distinct, t-digest for percentiles.
