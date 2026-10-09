=== hld-cap | HLD | CAP, PACELC and consistency models ===
"Is it consistent?" is meaningless until you say *which* consistency. CAP tells you what a replicated system must give up when the network partitions; PACELC adds the trade-off that applies the rest of the time, latency versus consistency; and consistency models (linearizable, sequential, causal, session guarantees, eventual) describe exactly what a reader may observe. This chapter states each precisely, separates consistency from transaction isolation, and shows how to choose per feature rather than per system.

## CAP, stated precisely
The CAP theorem (conjectured by Eric Brewer in 2000, proved by Gilbert and Lynch in 2002) concerns a system that replicates a single read/write register across nodes:

- **C, consistency:** specifically **linearizability**. Every read returns the value of the most recent completed write, as if there were a single copy.
- **A, availability:** every request received by a **non-failing node** must eventually receive a non-error response. Not "99.99% uptime"; it means any live node must answer.
- **P, partition tolerance:** the system keeps operating even though the network may drop or delay arbitrarily many messages between nodes.

**The theorem:** when a network partition occurs, a system must choose between C and A. If nodes on both sides keep answering (A), a write on one side cannot be seen on the other, so reads are stale (not C). If the system refuses to answer on at least one side until the partition heals (C), those nodes are unavailable (not A).

### What CAP does and does not say
- Partitions are not optional in a distributed system; networks do fail. So "CA" is not a real choice for a multi-node system. The real choice is **CP or AP during a partition**.
- When there is no partition, a system can be both consistent and available. CAP says nothing about normal operation.
- The C in CAP is not the C in ACID (which means application invariants hold).
- It is a statement about one specific consistency model and one strict definition of availability. Many real systems are neither CAP-consistent nor CAP-available (for example, a single-leader database with async replicas, read from replicas: stale reads and the leader is a single point for writes).
- Systems are often configurable per operation, so labelling a whole product "CP" or "AP" is a simplification.

### A partition, concretely
```
   Region US                    X  network partition  X                 Region EU
 [ replica 1 ] [ replica 2 ]  <------ messages lost ------>  [ replica 3 ]
 Client A: write balance=50 lands on US side.   Client B reads from EU replica 3.

 CP choice: replica 3 cannot reach a majority, so it rejects or times out B's read.
 AP choice: replica 3 answers with the old balance=100; the two sides reconcile later.
```

## PACELC
Daniel Abadi's extension (2010): **if Partition, choose Availability or Consistency; Else, choose Latency or Consistency.**

The "else" half is the one you live with every day: keeping replicas strongly consistent requires coordination (waiting for a quorum, possibly across regions) on every write, and often on reads, which costs latency even when nothing is broken.

| System (typical configuration) | P: A or C | E: L or C | Notes |
|---|---|---|---|
| Cassandra, ScyllaDB, Riak | PA | EL | Tunable; `QUORUM` moves toward C at a latency cost |
| DynamoDB | PA | EL | Eventually consistent reads by default; strongly consistent reads optional (leader read, single region) |
| MongoDB (majority writes and reads) | PC-ish | EC | Defaults vary by version; read preference secondary makes it EL |
| Spanner, CockroachDB, YugabyteDB | PC | EC | Consensus per range; minority side unavailable |
| ZooKeeper, etcd, Consul | PC | EC | Built for coordination; writes need a majority |
| HBase / Bigtable | PC | EC | Single owner per region/tablet |
| Redis primary + async replicas | Neither cleanly | EL | Failover can lose acknowledged writes |
| Azure Cosmos DB | Tunable | Tunable | Five levels: strong, bounded staleness, session, consistent prefix, eventual |

## Consistency models
A consistency model is a contract: which values may a read return given the history of writes. From strongest to weakest:

### Linearizability (atomic consistency)
Every operation appears to take effect instantaneously at some point between its invocation and its response, and all clients agree on that order, which respects real time. Once any read sees a new value, every later read (by anyone) sees it or something newer.

- Needed for: leader election, locks, unique constraints ("username taken"), compare-and-set, inventory or seat allocation, bank balances with overdraft checks.
- Cost: coordination on every operation (consensus or a single leader), latency proportional to round trips between replicas, and unavailability on the minority side of a partition.
- Implemented by: Raft/Paxos-replicated stores (etcd, ZooKeeper writes, Spanner, CockroachDB), a single leader with synchronous reads from the leader.

A classic violation: Alice's phone shows the match result "final score 2–1" from an up-to-date replica; Bob, standing next to her, refreshes and gets "match in progress" from a lagging replica, *after* Alice's read completed. Each replica is internally fine, but there is no single-copy illusion.

### Sequential consistency
All clients see operations in the same total order, and each client's operations appear in its program order, but that order need not match real time across clients. Weaker than linearizable: a read can be "behind" as long as everyone agrees on the sequence. Mostly discussed for CPU memory models; ZooKeeper offers it for reads served by followers (with `sync()` to catch up).

### Causal consistency
Operations that are causally related (A happened before and could have influenced B: a reply to a post, a write after reading a value) are seen by everyone in that order. Concurrent, unrelated operations may be seen in different orders by different clients.

- It is the strongest model that remains available during partitions (no coordination on the critical path), which makes it attractive for geo-replicated apps.
- Implemented with dependency tracking: version vectors, Lamport or hybrid logical clocks, or "write after you have seen X" tokens. MongoDB causally consistent sessions, COPS/Eiger research systems, and many CRDT-based systems.

### Session guarantees (client-centric)
Weaker, per-client guarantees, often all a product needs:
| Guarantee | Promise | Typical implementation |
|---|---|---|
| **Read-your-writes** | You always see your own writes | Read from leader after a write, or from replicas past your write's log position |
| **Monotonic reads** | You never see older data after newer data | Sticky replica, or "min version" token |
| **Monotonic writes** | Your writes apply in the order you issued them | Single session order, sequence numbers |
| **Writes-follow-reads** | A write made after reading X is ordered after X | Carry the read version into the write |
| **Consistent prefix** | You see writes in an order that is a valid prefix of history | Same partition for related writes |

Cosmos DB's default "session" consistency packages these, using a session token returned on each write.

### Bounded staleness
Reads may lag, but by no more than K versions or T seconds. Useful for dashboards and leaderboards. Cosmos DB offers it; you can approximate it with replica lag monitoring that removes replicas lagging more than T from rotation.

### Eventual consistency
If writes stop, all replicas eventually converge to the same value. No promise about what you read in the meantime: stale, out of order, even values going backwards. Cheap, fast, highly available. Usually combined with a conflict-resolution rule (LWW, CRDT merge) so "eventually the same" is well defined.

### Hierarchy
```
strict serializability  (serializable transactions + linearizable real-time order; Spanner, CockroachDB*)
        |                          \
linearizability                serializability (transactions; no real-time guarantee)
        |
sequential consistency
        |
causal consistency     <- strongest model available under partition
        |
session guarantees (read-your-writes, monotonic reads/writes, writes-follow-reads)
        |
eventual consistency
* CockroachDB provides serializable isolation with real-time guarantees except in rare clock-skew edge cases.
```

## Consistency vs isolation
Two different questions that interviewers like to see separated:

| | Consistency models (distributed systems) | Isolation levels (databases, the I in ACID) |
|---|---|---|
| About | Recency and ordering of operations on replicated objects | How concurrent **transactions** over multiple objects interfere |
| Strongest | Linearizability | Serializability |
| Anomalies | Stale reads, reads going backwards, out-of-order causality | Dirty reads, non-repeatable reads, lost updates, write skew, phantoms |
| Example | "After my write returns, every reader sees it" | "Two transactions behave as if run one after the other" |

They are orthogonal: a single-node Postgres at serializable is serializable but you can still read stale data from its async replica; a linearizable key-value store gives no multi-key transactions. **Strict serializability** combines both, and is what Spanner calls "external consistency". And the C in ACID is a third thing: the application's invariants are preserved, which the database helps with through constraints and the other three letters.

## Tunable consistency
Leaderless stores let you pick per request:

```java
// DataStax Java driver 4.x: choose consistency per statement
SimpleStatement write = SimpleStatement.newInstance(
        "UPDATE inventory SET reserved = reserved + 1 WHERE sku = ?", sku)
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_QUORUM);

SimpleStatement readFeed = SimpleStatement.newInstance(
        "SELECT * FROM timeline WHERE user_id = ? LIMIT 50", userId)
    .setConsistencyLevel(DefaultConsistencyLevel.LOCAL_ONE);    // fast, may be stale
```

```java
// DynamoDB SDK v2: eventually consistent by default, strong on demand
GetItemRequest req = GetItemRequest.builder()
    .tableName("accounts").key(Map.of("id", AttributeValue.fromS(id)))
    .consistentRead(true)       // reads from the partition leader; costs 2x read units
    .build();
```

Rules of thumb with N = 3: `QUORUM` writes and reads (W + R > N) give read-after-write for a single key under normal operation (still not strictly linearizable with LWW and concurrent writers); `ONE`/`ONE` is fastest and eventually consistent; `LOCAL_QUORUM` keeps latency inside one region while remote regions converge asynchronously; `EACH_QUORUM` or `ALL` costs cross-region latency. For true compare-and-set, Cassandra offers lightweight transactions (`IF NOT EXISTS`, Paxos under the hood, about 4 round trips).

## Choosing per feature
Decide consistency **per data item and operation**, not per system. Ask: what is the cost of a stale or conflicting read, and what does strong consistency cost in latency and availability?

| Feature | Model | Why |
|---|---|---|
| Seat booking, inventory decrement, flash-sale stock | Linearizable / serializable (single leader, conditional write, consensus) | Overselling costs money and trust |
| Payments, ledger, account balance | Strict serializability or single-leader ACID + idempotency | Correctness and audit |
| Username / email uniqueness | Linearizable (unique constraint, conditional put) | Two users cannot both win |
| Distributed lock, leader election | Linearizable (etcd/ZooKeeper) + fencing | Mutual exclusion |
| Likes, view counts | Eventual (CRDT counter or async aggregation) | Off by a few for a few seconds is fine |
| News feed, recommendations | Eventual | Freshness of seconds is acceptable |
| User's own profile edits, posts, cart | Read-your-writes / session | The author must see their change |
| Chat messages in a conversation | Causal / per-conversation ordering | Replies must follow the messages they answer |
| Shopping cart (Dynamo-style) | Eventual with merge (union) | Availability to add items beats exactness |
| Analytics dashboards | Bounded staleness | Minutes of lag acceptable |
| Configuration / feature flags | Linearizable writes, cached eventual reads | Writes rare; reads must be fast |

A strong interview answer sounds like: "Inventory reservation goes through a single-leader shard with a conditional update (`UPDATE ... SET stock = stock - 1 WHERE sku = ? AND stock > 0`), which is CP: if the shard's leader is unreachable we show 'try again' rather than oversell. Product reviews and ratings are AP and eventually consistent."

## Examples of CP and AP systems
- **CP:** ZooKeeper, etcd, Consul (KV), Spanner, CockroachDB, YugabyteDB, TiDB, HBase, MongoDB with majority read/write concerns, Kafka with `acks=all`, `min.insync.replicas=2` and unclean leader election disabled (refuses writes rather than losing data).
- **AP:** Cassandra and ScyllaDB at `ONE`, Riak, DynamoDB eventually consistent reads and global tables, CouchDB, DNS, CDN caches, Eureka service registry (prefers availability, self-preservation mode).
- **Neither cleanly:** Redis Sentinel/Cluster with async replication (may lose acknowledged writes, and minority-side masters keep accepting writes briefly until node timeout), typical primary plus async read replicas.

## How it shows up in interview problems
- **BookMyShow / seat reservation:** CP for seat holds (conditional write or `SELECT ... FOR UPDATE` with a TTL hold), AP for browsing showtimes.
- **E-commerce:** CP for stock and payment, AP for catalog, reviews, recommendations; read-your-writes for cart and orders.
- **Payments:** strongly consistent ledger, idempotency keys, outbox to emit events; reconciliation jobs as a safety net.
- **Chat:** causal ordering within a conversation (server sequence numbers); eventual for presence and typing indicators.
- **News feed / social:** eventual for feeds and counters; read-your-writes so the author sees their own post.
- **Distributed cache:** usually AP; explain stale-read tolerance and TTLs.
- **Rate limiter:** approximate (AP) counters are usually acceptable; a few extra requests during a partition is better than blocking all traffic.
- **Job scheduler:** linearizable lease or lock (etcd/ZooKeeper) so a job is not run twice, plus idempotent jobs anyway.
- **Multi-region (Netflix, Uber):** local-region strong consistency, cross-region async; pin a user's writes to a home region.

## Common pitfalls
- Saying "we choose CA". For a distributed system, partitions happen; the choice is what happens during one.
- Using "consistency" without naming the model; or confusing it with ACID consistency or isolation.
- Assuming quorum reads and writes give linearizability.
- Making everything strongly consistent "to be safe", adding cross-region latency to features that do not need it.
- Making everything eventual, then discovering overselling or duplicate usernames.
- Forgetting read-your-writes; users perceive lost updates even when nothing is lost.
- Reading from followers in ZooKeeper/etcd and assuming the result is current (use `sync()` or linearizable reads).

## Interview questions
1. **State CAP precisely.** In a system that replicates data, when a network partition happens you must choose between linearizable consistency and availability (every live node answers). Without a partition you can have both; CAP says nothing about latency.
2. **What does PACELC add?** Even without partitions, there is a trade-off between latency and consistency, because strong consistency requires synchronous coordination between replicas on each operation.
3. **Linearizability vs serializability?** Linearizability is a recency guarantee on single objects in real time; serializability is an isolation guarantee that concurrent multi-object transactions are equivalent to some serial order, not necessarily real-time order. Strict serializability is both.
4. **Which consistency model is the strongest that stays available during a partition?** Causal consistency (with session guarantees).
5. **How would you choose consistency for likes vs inventory?** Likes: eventual, CRDT or aggregated counters, cheap and available. Inventory: linearizable conditional decrement on a single-leader or consensus-backed store, rejecting rather than overselling during partitions.
6. **Is Cassandra AP or CP?** Configurable per request. At `ONE` it is AP/EL. At `QUORUM` it offers read-after-write for a key in normal operation but is not linearizable; lightweight transactions give linearizable compare-and-set at higher latency.
7. **A user posts a comment, refreshes, and it is missing. Which guarantee is violated and how do you fix it?** Read-your-writes. Route the author's subsequent reads to the leader or to replicas caught up to their write's version, or overlay the user's recent writes client-side.
8. **What is the difference between availability in CAP and in an SLA?** CAP availability requires every non-failing node to answer every request; SLA availability is the fraction of successful requests over time. A CP system can still have 99.99% SLA availability.

## Cheat sheet
- CAP: during a partition choose linearizability or availability; "CA" is not an option for distributed systems.
- PACELC: else, choose latency or consistency.
- Models: linearizable > sequential > causal > session (RYW, monotonic reads/writes, writes-follow-reads) > eventual; bounded staleness in between.
- Causal = strongest available under partition.
- Isolation (transactions) is separate from consistency (replicas); strict serializability = both; ACID C = invariants.
- Tunable: W + R > N for read-after-write, not linearizability; LWT/conditional writes for CAS.
- Choose per feature: money, stock, uniqueness, locks = strong; counters, feeds, recommendations = eventual; user's own data = read-your-writes; chat = causal.

=== hld-consensus | HLD | Consensus, leader election and coordination ===
Consensus is how a group of machines agrees on a value, such as who the leader is or what the next log entry is, even when some machines crash and messages are delayed. It underpins leader election, distributed locks, configuration stores and every strongly consistent replicated database. This chapter explains why consensus is hard (FLP), walks through Raft in detail, sketches Paxos, shows how ZooKeeper and etcd are used for elections, locks with fencing tokens, discovery and configuration, explains Redlock's caveats and leases, and covers clocks: physical, logical, vector, hybrid logical and TrueTime.

## Why consensus
Many problems reduce to "all nodes must agree on one thing, once, and never change their minds":
- **Leader election:** exactly one leader per term, or two leaders corrupt data (split brain).
- **Atomic commit:** all participants commit or all abort.
- **Replicated state machines:** every replica applies the same commands in the same order, so they end in the same state. This is how etcd, ZooKeeper, Spanner, CockroachDB, Kafka KRaft and Consul replicate.
- **Uniqueness and locks:** only one client gets the username, the lock, the seat.

Properties a consensus protocol must provide:
- **Agreement:** no two nodes decide differently.
- **Validity:** the decided value was proposed by someone.
- **Integrity:** a node decides at most once.
- **Termination:** every non-faulty node eventually decides.

Practical protocols tolerate **crash failures** (nodes stop) with `2f + 1` nodes surviving `f` failures, because any two majorities overlap. A 3-node cluster tolerates 1 failure, 5 tolerates 2. Byzantine (malicious or arbitrary) failures need `3f + 1` nodes and protocols like PBFT or Tendermint; ordinary data-centre systems do not pay that cost.

## FLP: the intuition
Fischer, Lynch and Paterson (1985) proved that in a fully **asynchronous** system (no bounds on message delay or processing time), no deterministic algorithm can guarantee consensus terminates if even one process may crash. The reason: you cannot distinguish a crashed node from a slow one, so there is always some execution where the protocol waits forever or decides unsafely.

Real systems escape FLP by assuming **partial synchrony**: the network is usually timely, and timeouts are used to suspect failures. Raft and Paxos are designed so that **safety** (never two different decisions) holds always, regardless of timing, while **liveness** (making progress) holds only when the network behaves well enough for a leader to be elected and stay in contact. That is the right trade: a stuck cluster is an outage, but a cluster that decides two things is corruption.

## Raft in detail
Raft (Ongaro and Ousterhout, 2014) was designed to be understandable. It splits consensus into leader election, log replication and safety.

### Roles and terms
- Each node is a **follower**, **candidate** or **leader**.
- Time is divided into **terms**, numbered with increasing integers. Each term begins with an election; at most one leader per term.
- Every message carries the sender's term. A node that sees a higher term updates its own term and steps down to follower. A message with a stale term is rejected. Terms act as a logical clock and as fencing.

```
term 1         term 2           term 3             term 4
[elect|normal ][elect|normal...][elect|(split vote)][elect|normal ...]
   leader A       leader B          no leader          leader C
```

### Leader election
1. Followers expect periodic **heartbeats** (empty AppendEntries) from the leader.
2. If a follower hears nothing for its **election timeout** (randomised, e.g. 150–300 ms, so nodes rarely time out simultaneously), it becomes a candidate: increments its term, votes for itself and sends `RequestVote(term, candidateId, lastLogIndex, lastLogTerm)` to all.
3. A node grants its vote if (a) it has not voted for anyone else in this term, and (b) the candidate's log is **at least as up to date** as its own (compare last entry's term, then index). This is the **election restriction**.
4. A candidate that receives votes from a **majority** becomes leader and immediately sends heartbeats.
5. If it receives a message from a leader with a term at least as high, it steps down. If the vote splits, the timeout fires again and a new term starts; randomisation makes repeated splits unlikely.

### Log replication
Clients send commands to the leader. The leader appends the command to its log as an entry `(term, index, command)` and sends `AppendEntries(term, prevLogIndex, prevLogTerm, entries[], leaderCommit)` to followers.

```
index:      1    2    3    4    5    6
leader:    [1x] [1y] [2z] [3a] [3b] [3c]      commitIndex = 5 (on a majority)
follower1: [1x] [1y] [2z] [3a] [3b]           matchIndex = 5
follower2: [1x] [1y] [2z] [3a] [3b] [3c]      matchIndex = 6
follower3: [1x] [1y] [2q]                     conflicting entry at 3
follower4: [1x]                               lagging
(entry shown as [term + command])
```

- **Consistency check:** a follower accepts entries only if its log contains an entry at `prevLogIndex` with term `prevLogTerm`. Otherwise it rejects, and the leader decrements `nextIndex` for that follower and retries, walking back until logs match. The follower then deletes any conflicting entries after that point and appends the leader's. (Follower 3 above loses `[2q]`, which was never committed.)
- This induction gives the **Log Matching property:** if two logs contain an entry with the same index and term, the logs are identical up to that index.

### Commit index
- An entry is **committed** once the leader has stored it on a majority of nodes **and** it is from the leader's current term (entries from earlier terms are committed indirectly when a current-term entry after them commits; this rule avoids a subtle case where an old-term entry on a majority could still be overwritten).
- The leader advances `commitIndex`, applies entries up to it to its state machine, replies to clients, and tells followers the new `leaderCommit` in subsequent AppendEntries so they apply too.
- A write is acknowledged to the client only after commit, so an acknowledged write survives any minority of failures.

### Safety properties
| Property | Meaning |
|---|---|
| Election safety | At most one leader per term (each node votes once per term; majorities overlap) |
| Leader append-only | A leader never overwrites or deletes its own entries |
| Log matching | Same index and term implies identical prefixes |
| Leader completeness | A committed entry is present in the logs of all future leaders (thanks to the election restriction) |
| State machine safety | No two nodes apply different commands at the same index |

### Operations you also need
- **Linearizable reads:** a leader may have been deposed without knowing. Either replicate a no-op/read through the log, use **ReadIndex** (leader confirms it is still leader with a heartbeat round to a majority, then serves the read once applied up to that index), or **lease reads** (leader serves reads locally while within a lease shorter than the election timeout, which depends on bounded clock drift).
- **Log compaction:** periodic snapshots of the state machine; followers far behind receive `InstallSnapshot`.
- **Membership changes:** add or remove one server at a time, or use joint consensus, so two disjoint majorities can never exist during reconfiguration.
- **Pre-vote and check-quorum:** extensions (etcd uses them) that stop a partitioned node from disrupting the cluster with ever-higher terms when it rejoins.

### Latency and sizing
A write costs one round trip from the leader to the fastest majority plus a durable fsync. In one region that is a few milliseconds; across regions it is the RTT to the nearest majority. Use 3 or 5 voters (more voters means slower writes, not more throughput); add non-voting learners/observers for read scaling.

## Paxos, briefly
Leslie Lamport's Paxos (1989/1998) is the original. Single-decree Paxos decides one value with roles **proposers**, **acceptors** and **learners**:

1. **Prepare / Promise:** a proposer picks a unique ballot number `n` and sends `prepare(n)` to acceptors. Each acceptor promises to ignore ballots lower than `n` and returns the highest-numbered value it has already accepted, if any.
2. **Accept / Accepted:** with promises from a majority, the proposer sends `accept(n, v)`, where `v` is the value from the highest-ballot accepted response (or its own value if none). Acceptors accept unless they have promised a higher ballot. Once a majority accepts, the value is chosen and learners are told.

**Multi-Paxos** runs this per log slot, with a stable leader that skips phase 1 for successive slots, which is effectively what Raft formalises. Variants: Fast Paxos, EPaxos (leaderless), Flexible Paxos (phase-1 and phase-2 quorums only need to intersect). Used by Google Chubby and Spanner, and DynamoDB and Cassandra LWTs use Paxos too. ZooKeeper uses **ZAB** (ZooKeeper Atomic Broadcast), a closely related primary-backup protocol with epochs.

| | Raft | Multi-Paxos | ZAB |
|---|---|---|---|
| Leader | Strong leader, required | Optimisation (stable proposer) | Strong leader |
| Log holes | Not allowed (contiguous log) | Allowed per slot | Not allowed |
| Understandability | Designed for it | Notoriously subtle | Moderate |
| Users | etcd, Consul, CockroachDB, TiKV, Kafka KRaft, MongoDB (Raft-like) | Spanner, Chubby, DynamoDB | ZooKeeper |

## Quorums in one picture
```
5 nodes, majority = 3.  Any two majorities share >= 1 node:
  {A,B,C} and {C,D,E} overlap at C -> a new leader always sees the latest committed entry.
Partition {A,B} | {C,D,E}: only {C,D,E} can elect a leader and commit; {A,B} stall (CP).
```

## Coordination services: ZooKeeper and etcd
You rarely implement Raft yourself. You use a small, strongly consistent coordination store and build primitives on it.

| | ZooKeeper | etcd |
|---|---|---|
| Protocol | ZAB | Raft |
| Data model | Hierarchical znodes (small data, < 1 MB) | Flat key space with prefixes, MVCC revisions |
| Liveness of clients | Sessions; **ephemeral** znodes deleted when session expires | **Leases** with TTL; keys attached to a lease are deleted when it expires |
| Ordering primitive | **Sequential** znodes (`lock-0000000042`), zxid | Global revision numbers, `create_revision` |
| Notifications | One-shot watches (persistent watches in 3.6+) | Streaming watches from a revision |
| Atomic ops | `multi`, versioned set | Transactions: `If(compare).Then(ops).Else(ops)` |
| Used by | Kafka (pre-KRaft), HBase, Hadoop, Solr, older Kafka consumers | Kubernetes, CoreDNS, Patroni, Vitess topology, M3 |

### Leader election
Recipe with ZooKeeper: each candidate creates an **ephemeral sequential** znode under `/election`. The lowest sequence number is leader. Every other node watches only the node immediately before it (not the leader), avoiding a herd effect when the leader dies. If the leader crashes, its session expires, its znode vanishes and the next node becomes leader.

```java
// Apache Curator LeaderLatch
CuratorFramework client = CuratorFrameworkFactory.newClient(
        "zk1:2181,zk2:2181,zk3:2181", new ExponentialBackoffRetry(1000, 3));
client.start();

LeaderLatch latch = new LeaderLatch(client, "/services/scheduler/leader", nodeId);
latch.addListener(new LeaderLatchListener() {
    public void isLeader()  { scheduler.start(); }
    public void notLeader() { scheduler.stop(); }   // must stop promptly
});
latch.start();
```

With etcd: `campaign` on an election prefix under a lease (the `concurrency` package in Go, `jetcd` Election client in Java); the key with the lowest create revision wins. Kubernetes controllers use `Lease` objects for the same purpose, and Spring Integration offers `LeaderInitiator` for ZooKeeper and a Kubernetes leader-election module.

### Distributed locks with fencing tokens
A lock in a distributed system is really a **lease**: it expires if the holder disappears. The danger is a holder that *thinks* it still holds the lock after it expired (long GC pause, VM freeze, network delay):

```
Client 1 acquires lock (token 33) ... GC pause 40 s ... lease expired
Client 2 acquires lock (token 34), writes to storage
Client 1 wakes, still believes it holds the lock, writes to storage  -> corruption
```

**Fix: fencing tokens.** The lock service hands out a monotonically increasing number with each grant (ZooKeeper zxid or znode version, etcd revision of the lock key). Every write to the protected resource carries the token, and **the resource rejects tokens lower than the highest it has seen**.

```sql
-- Storage-side fencing check: a stale holder's write affects 0 rows
UPDATE job_state
SET    status = 'DONE', fencing_token = :token
WHERE  job_id = :jobId AND fencing_token < :token;
```

```java
// Curator mutex; derive a fencing token from the lock node's sequence/zxid
InterProcessMutex lock = new InterProcessMutex(client, "/locks/invoice-run");
if (lock.acquire(5, TimeUnit.SECONDS)) {
    try {
        long token = currentLockZxid(client, "/locks/invoice-run");  // monotonically increasing
        invoiceStore.applyBatch(batch, token);                      // store rejects older tokens
    } finally {
        lock.release();
    }
}
```

If the resource cannot check tokens (a third-party API), make the operation idempotent instead.

### Service discovery and configuration
- **Discovery:** each instance registers an ephemeral node or a lease-backed key (`/services/payments/10.0.0.7:8080`); clients watch the prefix. Health is implied by the session or lease. Consul, etcd and ZooKeeper (Curator Service Discovery, Spring Cloud Zookeeper/Consul) all do this. Eureka deliberately chooses AP instead.
- **Configuration and feature flags:** store config under a key; services watch and hot-reload. Writes are linearizable; reads are usually served from a local cache.
- **Membership and partition assignment:** which worker owns which shard (Kafka controller metadata, Helix on ZooKeeper, Vitess topology in etcd).
- **Keep coordination data small and low-write.** These systems handle thousands of writes per second, not hundreds of thousands; they are not general databases or message queues.

## Redlock and its caveats
Redlock (proposed by Redis's author) acquires a lock on a majority of N (typically 5) independent Redis masters with `SET key value NX PX ttl`, treats the lock as held if a majority succeeded within less than the TTL, and releases with a compare-and-delete Lua script.

Caveats (well argued by Martin Kleppmann):
- **No fencing token:** the random value identifies the holder for release but is not monotonic, so storage cannot reject a stale holder after a pause.
- **Timing assumptions:** safety depends on bounded clock drift, bounded network delay and bounded process pauses. A clock jump on a Redis node (NTP step) can expire a key early and let a second client acquire a majority.
- **Persistence and restarts:** a Redis node that restarts without fsynced data forgets locks, unless it delays rejoining for at least the TTL.

Guidance: a single Redis `SET NX PX` lock (or Redlock) is fine for **efficiency** locks, where a rare double execution only wastes work (avoid two workers sending the same digest email if the operation is idempotent anyway). For **correctness** locks (money, inventory, exclusive file writes), use a consensus-backed store (etcd, ZooKeeper, a database row lock or conditional write) plus fencing tokens.

## Leases
A lease is a lock with a time limit: the holder has rights until time T unless it renews.
- Leases let systems make progress when holders die, without manual cleanup.
- They depend on time, so the holder must stop acting **before** the lease expires, using a monotonic clock and a safety margin for clock drift (e.g. renew at one third of the TTL, stop work at TTL minus drift).
- Examples: Raft leader leases for local reads, Chubby/ZooKeeper sessions, etcd leases, Kubernetes `Lease` objects, Kafka consumer-group session timeouts, GFS chunk leases for the primary replica.

## Clocks and ordering
### Physical clocks
- **Time-of-day (wall) clocks** (`System.currentTimeMillis()`, `Instant.now()`): synchronised by NTP, typically within milliseconds in a data centre, tens to hundreds of milliseconds over the internet, and can **jump backwards** on correction or leap seconds. Never use them to measure durations or to order events across machines.
- **Monotonic clocks** (`System.nanoTime()`): only go forward; meaningful only on one machine; use for timeouts and durations.
- Consequence: last-write-wins by wall-clock timestamp can drop a later write if the writer's clock is behind.

### Lamport clocks
Each process keeps a counter. Increment on each local event; send the counter with every message; on receipt set `counter = max(local, received) + 1`. Ordering by `(counter, nodeId)` gives a total order consistent with causality: if A happened before B, then `L(A) < L(B)`. The converse does not hold, so Lamport clocks cannot tell you whether two events were concurrent.

```java
public final class LamportClock {
    private final AtomicLong time = new AtomicLong();
    public long tick()                 { return time.incrementAndGet(); }          // local event / send
    public long onReceive(long remote) { return time.accumulateAndGet(remote, (l, r) -> Math.max(l, r) + 1); }
}
```

### Vector clocks
Each node keeps a vector of counters, one per node. Compare element-wise: if every entry of A is less than or equal to B's (and one is strictly less), A happened before B; if neither dominates, they are **concurrent** and a conflict exists. Used for conflict detection in Dynamo and Riak (as version vectors per key). Cost: size grows with the number of writers; systems prune or use dotted version vectors.

```
A = [2,1,0]  B = [2,2,0]  -> A < B (B saw A)
A = [2,1,0]  C = [1,1,1]  -> concurrent: keep both siblings or merge
```

### Hybrid logical clocks (HLC)
HLC (Kulkarni et al., 2014) combines a physical timestamp with a logical counter: `(max physical time seen, logical counter)`. It stays close to wall-clock time (so timestamps are meaningful to humans and for snapshot reads "as of 10:00"), never goes backwards, and captures causality like a Lamport clock. Used by CockroachDB, YugabyteDB and MongoDB (cluster time). CockroachDB also enforces a maximum clock offset (500 ms by default) and uses **uncertainty intervals**: a read that sees a value with a timestamp slightly in its future, within the offset, restarts at a higher timestamp to preserve consistency. Nodes whose clocks drift too far shut themselves down.

### TrueTime (Google Spanner)
TrueTime exposes time as an interval `[earliest, latest]` with bounded uncertainty epsilon, maintained using GPS receivers and atomic clocks in every data centre (epsilon is typically a few milliseconds). Spanner assigns each transaction a commit timestamp `s` and then performs **commit wait**: it does not make the commit visible until `TT.now().earliest > s`, guaranteeing that any transaction starting afterwards gets a larger timestamp. This yields **external consistency** (strict serializability) globally, and lock-free consistent snapshot reads at any timestamp. The price is that each write waits about epsilon, which is why small, well-bounded uncertainty matters. Cloud providers now expose similar precise clock services (for example AWS Time Sync with published error bounds, which Aurora DSQL relies on).

| Clock | Captures causality | Detects concurrency | Close to real time | Typical use |
|---|---|---|---|---|
| Wall clock | No | No | Yes (with skew) | Logs, TTLs, human display |
| Monotonic | Single node only | No | No | Timeouts, durations |
| Lamport | Yes (one direction) | No | No | Total ordering, Raft terms are similar |
| Vector / version vector | Yes | Yes | No | Conflict detection (Dynamo, Riak) |
| HLC | Yes | No | Yes | CockroachDB, YugabyteDB, MongoDB |
| TrueTime | Via commit wait | No | Yes, bounded | Spanner external consistency |

## Real-world systems
- **etcd:** Raft; Kubernetes stores all cluster state here; leases for leader election; linearizable reads by default (ReadIndex), serializable (possibly stale) reads optional.
- **ZooKeeper:** ZAB; writes linearizable, reads from followers sequentially consistent (use `sync()` first if you need the latest). Kafka used it for controller election and metadata until **KRaft** replaced it with an internal Raft quorum.
- **Consul:** Raft for the catalog and KV; gossip (Serf) for membership and failure detection; sessions for locks.
- **Spanner / CockroachDB / YugabyteDB / TiKV:** a Paxos or Raft group per range or tablet, thousands of groups per cluster, with leaseholders serving reads.
- **MongoDB replica sets:** Raft-inspired election protocol (protocol version 1) with terms.
- **Chubby:** Google's Paxos-based lock service, the inspiration for ZooKeeper, which introduced sequencers (fencing tokens).

## How it shows up in interview problems
- **Job scheduler (cron at scale):** leader election for the scheduler or lease-based ownership of job partitions; fencing tokens or idempotent job runs to survive a stale leader.
- **Distributed lock service / seat reservation:** etcd/ZooKeeper locks with fencing, or (often better) a conditional write in the database itself.
- **Distributed key-value store / database design:** Raft per partition, leader leases for reads, majority quorums.
- **Kafka-like log or message queue:** controller election and per-partition leader with an in-sync replica set; KRaft for metadata.
- **Service discovery / API gateway:** registry in Consul/etcd/ZooKeeper, or AP Eureka; config pushed via watches.
- **Payments:** a single writer per account shard (via leader election) plus idempotency keys.
- **Chat / collaborative editing:** Lamport or vector clocks and CRDTs to order and merge concurrent edits.
- **Unique ID generator:** worker IDs assigned via ZooKeeper sequential nodes; guard against clock rollback.

## Common pitfalls
- Even-sized clusters (4 nodes tolerate 1 failure, same as 3, with slower writes). Use 3 or 5.
- Putting high-volume data or queues into ZooKeeper/etcd.
- Distributed locks without fencing tokens on correctness-critical paths; trusting Redis TTL locks for money.
- A leader that keeps working after losing leadership; it must stop on `notLeader` or lease loss, before the lease runs out.
- Ordering events by wall-clock timestamps across machines; measuring timeouts with wall clocks.
- Spreading 3 voters across 2 data centres (losing the one with 2 voters stops everything); use 3 sites or 5 voters over 3 sites.
- Election timeouts shorter than typical GC pauses or cross-zone latency spikes, causing election storms.
- Reading from followers and assuming linearizability.

## Interview questions
1. **Why do consensus systems use an odd number of nodes?** Fault tolerance depends on the majority size: 2f + 1 nodes tolerate f failures. A fourth node adds latency and cost without tolerating an extra failure compared with three.
2. **Walk through a Raft leader election.** A follower times out (randomised), increments its term, votes for itself and requests votes; nodes grant at most one vote per term and only to candidates whose log is at least as up to date; a majority makes it leader, and it sends heartbeats. Split votes retry in a new term.
3. **When is a Raft entry committed?** When the leader has replicated an entry from its current term to a majority; it and all preceding entries are then committed, applied to the state machine and acknowledged to the client.
4. **What does FLP say and how do real systems live with it?** In a purely asynchronous system with even one crash, deterministic consensus cannot guarantee termination. Real systems assume partial synchrony: always safe, live when timeouts are reasonable.
5. **Why do distributed locks need fencing tokens?** A holder can pause past its lease and resume believing it holds the lock. A monotonically increasing token checked by the resource rejects the stale holder's writes.
6. **Is Redlock safe?** Not for correctness-critical mutual exclusion: it provides no fencing token and depends on timing assumptions about clocks and pauses. It is acceptable for efficiency locks; use etcd/ZooKeeper plus fencing for correctness.
7. **Lamport clocks vs vector clocks vs HLC?** Lamport gives a causality-consistent total order but cannot detect concurrency; vector clocks detect concurrency at the cost of size per writer; HLC adds a logical counter to physical time so timestamps are causal and near real time.
8. **How does Spanner achieve external consistency?** TrueTime gives bounded clock uncertainty; Spanner waits out that uncertainty (commit wait) before exposing a commit, so timestamp order matches real-time order across the globe.

## Cheat sheet
- Consensus = agreement on a value or log order despite crashes; 2f + 1 nodes tolerate f; Byzantine needs 3f + 1.
- FLP: no guaranteed termination in pure async; real systems are always safe, live under partial synchrony.
- Raft: terms; randomised election timeouts; vote once per term; election restriction (up-to-date log); AppendEntries consistency check; commit on majority for current-term entries; ReadIndex/lease reads; snapshots; single-server membership changes.
- Paxos: prepare/promise, accept/accepted; Multi-Paxos with a stable leader; ZooKeeper uses ZAB.
- ZooKeeper (ephemeral sequential znodes, watches) and etcd (leases, revisions, txns) for election, locks, discovery, config. Keep them small.
- Locks are leases; always use fencing tokens for correctness; Redlock only for efficiency.
- Clocks: wall (skews, jumps), monotonic (durations), Lamport (order), vector (concurrency), HLC (causal + near real time), TrueTime (bounded uncertainty + commit wait).
