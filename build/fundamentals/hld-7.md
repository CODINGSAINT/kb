=== hld-cap | HLD | CAP, PACELC and consistency models ===
"Is it consistent?" means nothing until you say which kind of consistency you mean. CAP tells you what a replicated system gives up when the network splits, PACELC adds the latency cost you pay the rest of the time, and consistency models describe exactly what a reader is allowed to see. This chapter explains each one simply and then shows how to pick per feature, not per system.

## 1. CAP, stated precisely

**Definition:** When the network between replicas breaks, a replicated system must choose between answering every request (availability) and always returning the latest value (consistency).

CAP was conjectured by Eric Brewer in 2000 and proved by Gilbert and Lynch in 2002. The three letters have narrow meanings. **C** is linearizability: every read sees the most recent completed write, as if there were one copy. **A** means every request that reaches a non-failing node gets a non-error answer. **P** is a network partition: messages between nodes are lost or delayed. Think of two bank branches whose phone line is cut: either both keep serving customers and may disagree, or one branch stops serving until the line is back.

### The problem

```text
  US side                X  link down  X           EU side
 [replica 1][replica 2]  <-- no messages -->  [replica 3]
 Client A writes balance=50 on US side.
 Client B reads balance from replica 3.
```

Replica 3 cannot know about the new write. If it answers, B sees the old balance of 100. If it refuses, B gets an error.

### Better design

```text
 CP choice: replica 3 cannot reach a majority, so it rejects B's read.
            Correct, but EU users see errors until the link heals.
 AP choice: replica 3 answers 100 now; both sides reconcile later.
            Always answers, but B sees stale data for a while.
```

Neither choice is wrong. The point is to make it on purpose, per operation, instead of discovering it during an outage.

**Trade-offs:**
- CP: errors or timeouts on the minority side during a partition.
- AP: stale reads and possible conflicting writes that must be merged later.

### What CAP does not say
- "CA" is not a real option for a multi-node system: partitions happen, so the real choice is CP or AP during a partition.
- With no partition, a system can be both consistent and available. CAP is silent about normal operation.
- The C in CAP is not the C in ACID (which means your business rules hold after a transaction).
- Many real systems are neither strictly CP nor strictly AP, and many let you choose per request.

**Key takeaway: CAP is only about the moment of a partition: refuse to answer (CP) or answer with possibly stale data (AP).**

---

## 2. PACELC

**Definition:** If there is a Partition, choose Availability or Consistency; Else, choose Latency or Consistency.

Daniel Abadi proposed PACELC (2010) because partitions are rare, but the latency cost of consistency is paid on every request. To give a strongly consistent answer, a write must wait for other replicas, often in other zones or regions. To be fast, you answer from the nearest copy and accept that it may be a little behind.

### The problem

```text
 Leader in Mumbai, replicas in Singapore and Frankfurt.
 Synchronous write to a majority:  ~60-150 ms (cross-region round trip)
 Read from the leader only:        every EU user pays ~120 ms
```

A team picks "strong consistency everywhere" and the product page becomes slow for every user, even though no partition is happening.

### Better design

```text
 Write path:  wait for a majority (PC/EC) for orders and payments.
 Read path:   product descriptions read from the local replica (EL),
              allowed to be a few seconds behind.
```

Fast paths and safe paths now live side by side, chosen by what each piece of data needs.

Typical labels: Cassandra and DynamoDB (default settings) are PA/EL; Spanner and etcd are PC/EC. Treat these as defaults, not laws, since most systems are tunable.

**Key takeaway: Partitions are rare, but the latency cost of consistency is paid on every request; PACELC makes you price it.**

---

## 3. Strong consistency (linearizability)

**Definition:** The system behaves as if there is a single copy of the data, and every operation takes effect at one instant between its start and its end.

Once a write completes, every later read, from any client, on any node, sees it (or something newer). This is what people usually mean by "strongly consistent". It needs coordination: a single leader with a consensus protocol, or carefully designed quorum reads and writes.

### The problem

```text
 t=0  Alice: SET stock=0 on leader        -> OK
 t=1  Bob:   GET stock from async replica -> 1   (replica still behind)
 t=2  Bob buys the "last" item that no longer exists.
```

The replica answered with a value that was already overwritten. Bob's order is accepted for an item that is sold out.

### Better design

```sql
-- route the decision to the single source of truth, atomically
UPDATE inventory SET stock = stock - 1
 WHERE sku = 'X1' AND stock > 0;      -- 0 rows updated = sold out
```

The check and the decrement happen in one atomic step on the leader, so two buyers can never both take the last unit.

**Trade-offs:**
- Higher latency (wait for the leader or a majority).
- Lower availability during partitions (the minority side must refuse).

**Key takeaway: Use linearizability where a stale read causes a wrong decision, such as stock, money and uniqueness.**

---

## 4. Read-your-writes and monotonic reads

**Definition:** Read-your-writes means a user always sees their own updates. Monotonic reads means a user never sees time go backwards.

These are **session guarantees**: promises to one client, not to everyone. They are much cheaper than linearizability and fix the most visible bugs. Think of editing your profile: you do not care if a stranger sees the new photo two seconds late, but you must see it yourself immediately.

### The problem

```text
 User updates bio -> write goes to leader.
 Page reloads     -> read hits replica B (200 ms behind) -> old bio.
 Reload again     -> replica C (caught up)  -> new bio.
 Reload again     -> replica B              -> old bio again!
```

The first read breaks read-your-writes ("my edit vanished"). The flip-flop breaks monotonic reads ("the data went back in time").

### Better design

```text
 Read-your-writes:
   - after a write, read that user's data from the leader for ~10 s, or
   - client sends its last-write position (LSN/version); the replica
     waits until it has applied that position before answering.
 Monotonic reads:
   - pin each user to one replica (hash userId -> replica), or
   - client remembers the highest version it has seen and rejects
     answers older than that.
```

Each user now sees a consistent story, while most reads still go to replicas.

**Key takeaway: Session guarantees fix "my edit disappeared" bugs without paying for global strong consistency.**

---

## 5. Causal consistency

**Definition:** If one event could have caused another, everyone sees them in that order; unrelated events may appear in any order.

"Caused" means the second operation happened after its author saw the first. A reply depends on the question it answers. Causal consistency is about the strongest model that can stay available during a partition, which makes it a sweet spot for social and chat features.

### The problem

```text
 Alice posts:  "I lost my job"           (write 1)
 Bob replies:  "So sorry to hear that"   (write 2, after seeing write 1)
 Carol's replica receives write 2 first:
     Bob: "So sorry to hear that"   <- reply to nothing
```

Carol sees an effect before its cause. With a different post, the reply could look rude or meaningless.

### Better design

```text
 write 2 carries a dependency: {depends_on: write 1}
 Carol's replica holds write 2 until write 1 has arrived,
 then shows them in order.
```

Dependencies travel with the data (often as version vectors), so replicas delay only what truly depends on something missing.

**Key takeaway: Causal consistency keeps cause before effect, which is exactly what comments, replies and chat threads need.**

---

## 6. Eventual consistency

**Definition:** If writes stop, all replicas will eventually converge to the same value.

It promises nothing about when, or what you read in the meantime. It is the cheapest and most available model. It needs a rule for conflicting writes, such as last-write-wins, version vectors with a merge, or CRDTs (data types like counters and sets designed so that concurrent updates always merge cleanly).

### The problem

```text
 Like counter stored as a plain value, two regions, last-write-wins:
 US reads 100, adds 1, writes 101
 EU reads 100, adds 1, writes 101   (concurrently)
 Final: 101   (one like lost)
```

Read-modify-write on an eventually consistent value silently loses updates.

### Better design

```text
 G-Counter CRDT: one slot per region, each region increments only its own.
 US: {us: 51, eu: 50} ; EU: {us: 50, eu: 51}
 Merge = max per slot -> {us: 51, eu: 51} -> total 102
```

Every increment survives the merge, and no coordination is needed on the write path.

**Trade-offs:**
- Readers may see stale or different values for a while.
- You must design conflict resolution; last-write-wins quietly drops data.

**Key takeaway: Eventual consistency is great for counts and feeds, as long as you design how conflicts merge.**

### Consistency models side by side

| Model | Promise | Cost |
|---|---|---|
| Linearizable | Latest value, for everyone | Highest latency, unavailable in minority |
| Causal | Cause before effect | Track dependencies |
| Read-your-writes / monotonic | Sane view for one user | Routing or version tokens |
| Eventual | Converges someday | Conflict resolution |

---

## 7. Consistency vs. isolation

**Definition:** Consistency models are about replicas of data; isolation levels are about concurrent transactions on the data.

People mix them up because both use the word "consistent". Isolation levels (Read Committed, Repeatable Read, Snapshot, Serializable) answer "what can one transaction see of another running at the same time?" Consistency models answer "can a read see an old copy?"

### The problem

```text
 Single Postgres node, no replicas -> no stale copies at all.
 Isolation = Read Committed.
 Tx A: SELECT count(*) FROM oncall WHERE on_duty  -> 2, so I may leave
 Tx B: SELECT count(*) FROM oncall WHERE on_duty  -> 2, so I may leave
 Both UPDATE themselves to off-duty and commit -> 0 doctors on call.
```

There is no replication bug here. This is **write skew**, an isolation anomaly: two transactions read the same fact and each makes a change that is safe alone but not together.

### Better design

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT count(*) FROM oncall WHERE on_duty;
UPDATE oncall SET on_duty = false WHERE doctor_id = 7;
COMMIT;  -- one of the two transactions fails and must retry
```

Serializable (or locking the rows involved with `SELECT ... FOR UPDATE`) stops the second transaction from acting on an outdated count.

### Consistency vs. isolation
- **Consistency model:** can I read an old copy of one item?
- **Isolation level:** can concurrent multi-step transactions interleave badly?
- **Strict serializability** = serializable + linearizable, the strongest combination (Spanner offers it).

**Key takeaway: Replication lag and transaction interleaving are different bugs with different fixes; name which one you are solving.**

---

## 8. Choosing per feature

**Definition:** Pick the weakest model that keeps each feature correct, and pay for strong consistency only where a wrong read causes real harm.

One application usually needs several models. The test question is: "If this read is a few seconds stale, what is the worst thing that happens?"

### The problem

```text
 E-commerce app, one setting for everything:
   all strong   -> like buttons wait on cross-region quorum, slow pages
   all eventual -> two buyers get the last PS5, one refund, angry user
```

A single global choice is either too slow or too risky.

### Better design

```text
 Inventory decrement, payment, seat booking -> strong (leader / quorum)
 Order history for the buyer                -> read-your-writes
 Chat messages and comments                 -> causal (per-conversation order)
 Likes, view counts, "trending"             -> eventual (CRDT or batched counters)
 Product description, listing prices        -> eventual + short cache TTL,
                                              re-check price at checkout
```

Each feature gets the cheapest model that keeps it correct, and the critical step (checkout) re-validates against the source of truth.

**Key takeaway: Consistency is a per-feature decision; strong for money and stock, eventual for counters and feeds.**

---

## In an HLD interview
- **Amazon E-commerce / BookMyShow / Seat Reservation:** inventory and seats need a linearizable decrement or conditional write; browsing can be eventual and cached.
- **Payment System:** strong consistency plus idempotency keys; a stale balance read can lead to a double spend.
- **News Feed / YouTube likes and views:** eventual consistency with counters or CRDTs; nobody is hurt if a like count lags by seconds.
- **Chat/WhatsApp:** causal ordering within a conversation, read-your-writes for the sender's own messages.
- What to SAY: "I'll pick consistency per feature. Booking a seat is a CP operation with a conditional write; the like counter is AP and eventually consistent, because a stale count harms nobody."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| CAP | During a partition, choose errors or stale answers | What should this operation do when replicas cannot talk? |
| PACELC | Without a partition, choose latency or consistency | Is waiting for a quorum worth the latency here? |
| Linearizable | Behaves like one copy | Does a stale read cause a wrong decision? |
| Session guarantees | One user sees a sane, forward-moving view | Could a user see their own edit vanish? |
| Causal | Cause before effect | Can a reply appear before its message? |
| Eventual | Converges once writes stop | How do concurrent writes merge? |
| Isolation | How concurrent transactions interleave | Is this a replication bug or a transaction bug? |

## Final memory aid
- CAP: a partition happens, so pick CP (refuse) or AP (answer stale).
- PACELC: else, pick latency or consistency, on every request.
- Linearizable = one copy, latest value, for everyone.
- Read-your-writes and monotonic reads = a sane view for one user.
- Causal = replies never appear before the question.
- Eventual = converges someday; design the merge.
- Isolation is about transactions, not replicas.
- Strong for money and stock, eventual for likes and views.

=== hld-consensus | HLD | Consensus, leader election and coordination ===
Many distributed systems need a set of machines to agree on one thing: who the leader is, what the next log entry is, or who holds a lock. This chapter explains why that is hard, how quorums and Raft solve it in plain terms, what ZooKeeper and etcd are used for, and how to build locks that stay safe with leases and fencing tokens. It ends with why wall clocks cannot be trusted for ordering and what to use instead.

## 1. Why consensus

**Definition:** Consensus is getting several machines to agree on a single value, even if some of them crash or messages are delayed.

A single database server never has to agree with anyone. As soon as you have replicas, you must agree on who accepts writes and in what order. Think of a committee that must reach one decision even if some members leave the room mid-meeting.

### The problem

```text
 Two nodes, each thinks the other is dead (network glitch):
   Node A: "B is silent, I am leader now"  -> accepts writes
   Node B: "A is silent, I am leader now"  -> accepts writes
 Result: two leaders, two diverging histories ("split brain")
```

Both nodes accept conflicting writes, for example selling the same seat twice. Merging the two histories later may be impossible.

### Better design

```text
 Rule: a leader needs votes from a MAJORITY of a fixed cluster.
 5 nodes -> majority = 3.  A partition into {A,B} and {C,D,E}:
   {A,B}   has 2 votes  -> cannot elect, refuses writes
   {C,D,E} has 3 votes  -> elects one leader, keeps working
```

Two majorities of the same group always share at least one member, so two leaders can never both win the same term.

**Trade-offs:**
- Every decision costs at least one round trip to a majority.
- The minority side stops accepting writes (a CP choice).

**Key takeaway: Consensus exists to prevent split brain; the majority rule is what makes two leaders impossible.**

---

## 2. Quorums

**Definition:** A quorum is the minimum number of nodes that must take part in an operation for it to count.

With N replicas, if writes wait for W nodes and reads ask R nodes, and **R + W > N**, every read set overlaps every write set in at least one node, so a read can find the latest acknowledged write. Consensus systems use a majority (floor(N/2) + 1) for every decision.

### The problem

```text
 N=3, W=1, R=1   (R + W = 2, not > 3)
 Write x=5 lands only on node 1.
 Read asks node 3 -> old x.  No overlap, stale read.
```

### Better design

```text
 N=3, W=2, R=2   (R + W = 4 > 3)
 Write x=5 on nodes 1,2.  Read asks nodes 2,3 -> node 2 has x=5.
 Fault tolerance: 3 nodes tolerate 1 failure; 5 tolerate 2.
```

The overlap guarantees the read touches at least one fresh copy. Leaderless quorums (Dynamo style) still have edge cases, such as concurrent writes and sloppy quorums, so on their own they are not fully linearizable.

**Trade-offs:**
- Larger quorums mean slower operations and less availability.
- Clusters use odd sizes (3, 5); a fourth node adds cost but no extra fault tolerance.

**Key takeaway: R + W > N gives overlap; a majority of 2f+1 nodes tolerates f failures.**

---

## 3. Raft leader election

**Definition:** Raft is a consensus algorithm where one elected leader orders all writes, and a new leader is chosen by majority vote when it fails.

Time is split into numbered **terms**. Each node is a follower, a candidate or the leader. The leader sends regular heartbeats. If a follower hears nothing for its **election timeout** (randomized, for example 150-300 ms), it becomes a candidate, increases the term and asks for votes.

### The problem

```text
 Leader crashes. All 4 followers time out at exactly the same moment,
 all become candidates, each votes for itself:
   votes = 1,1,1,1 -> nobody gets 3 -> retry -> same tie again ...
```

With identical fixed timeouts, elections could split again and again.

### Better design

```text
 Randomized timeouts: B=170ms, C=240ms, D=210ms, E=290ms
 t=170ms  B becomes candidate for term 8, asks for votes
          C, D, E have not timed out yet -> vote for B (one vote per term)
          B has 4/5 votes -> leader of term 8, starts heartbeats
 Voting rule: refuse a candidate whose log is less up to date than yours.
```

Randomness usually lets one node start first and win. The "up-to-date log" rule ensures the new leader already holds every committed entry.

**Key takeaway: Raft elects one leader per term by majority vote; random timeouts break ties and the log check keeps committed data safe.**

---

## 4. Raft log replication

**Definition:** The leader appends each command to its log, copies it to followers, and marks it committed once a majority has stored it.

The log is an ordered list of commands such as "set x=5". Every node applies committed entries in the same order, so every node ends in the same state. This is called a **replicated state machine**.

### The problem

```text
 Leader L receives "x=5", applies it, replies OK to client,
 then crashes before sending it to any follower.
 New leader never saw "x=5" -> the acknowledged write is lost.
```

Acknowledging before replicating breaks the promise made to the client.

### Better design

```text
 1. Client -> L: "x=5"
 2. L appends it at index 42 (term 8), sends AppendEntries to F1..F4
 3. F1, F2 store it and ack     -> 3 of 5 have it (majority)
 4. L marks index 42 committed, applies it, replies OK to client
 5. Next heartbeat tells followers "commit index = 42"; they apply it
```

Any future leader must win votes from a majority, and that majority overlaps the one that stored index 42, so a committed entry is never lost.

**Trade-offs:**
- Write latency = one round trip to the fastest majority plus a disk flush.
- All writes go through one leader, so the leader caps write throughput.

**Key takeaway: Commit only after a majority stores the entry; that overlap is why committed data survives any leader change.**

---

## 5. ZooKeeper and etcd

**Definition:** ZooKeeper and etcd are small, strongly consistent key-value stores, built on consensus, that other systems use for coordination.

You do not store business data in them. You store small facts that many machines must agree on: who the leader is, which config is current, which nodes are alive. etcd uses Raft; ZooKeeper uses a similar protocol called ZAB. etcd is the brain of Kubernetes; ZooKeeper was used by Kafka (before KRaft), HBase and Hadoop.

### The problem

```text
 Each service instance runs its own "am I the leader?" logic
 using a database flag and wall-clock heartbeats.
 Edge cases: clock drift, a crashed holder never clears the flag,
 two instances both read "no leader" and both set it.
```

Hand-built coordination usually has subtle races that only appear under failure.

### Better design

```text
 etcd: create key /scheduler/leader attached to a lease (TTL 10s),
       only if the key does not exist (transaction: create_revision = 0).
       Winner keeps the lease alive; if it dies, the key expires.
       Others WATCH the key and retry when it disappears.
 ZooKeeper: same idea with ephemeral sequential znodes; the lowest
       sequence number is leader, each node watches the one before it.
```

Leader election, membership and config watching now come from a battle-tested consensus core.

**Trade-offs:**
- Writes are relatively slow, and the stored data must stay small.
- Another critical cluster to run (usually 3 or 5 nodes).

**Key takeaway: Use ZooKeeper or etcd for small coordination facts, never as a general database.**

---

## 6. Distributed locks with leases and fencing tokens

**Definition:** A distributed lock lets only one process act on a resource at a time; a lease is a lock that expires automatically, and a fencing token is an increasing number that proves which holder is current.

Leases solve "the holder crashed and never released". But they create a new danger: a holder that is merely paused (long GC, VM freeze) may still think it holds a lease that has already expired.

### The problem

```text
 t=0   Worker A gets lease (TTL 10s), starts writing file F
 t=1   A pauses for 15s (stop-the-world GC)
 t=11  Lease expires; Worker B gets lease, writes F
 t=16  A wakes up, still believes it has the lock, writes F
 Result: A overwrites B's work.
```

A lease alone cannot stop a paused process, because A cannot notice that time passed while it was frozen.

### Better design

```java
// Lock service hands out an increasing token with each grant
long token = lock.acquire("file-F");   // A gets 33, later B gets 34

// The storage service checks the token on every write
if (token < highestTokenSeen.get("file-F")) {
    throw new StaleLockException();    // A's late write with 33 is rejected
}
highestTokenSeen.put("file-F", token);
write(fileF, data);
```

The resource itself rejects old tokens (atomically, in real storage), so a zombie holder cannot do damage. In ZooKeeper the zxid can serve as the token; in etcd, the key's revision.

### Lease vs. fencing token
- **Lease:** frees the lock if the holder dies. Protects liveness (progress).
- **Fencing token:** rejects a holder that does not know it lost the lock. Protects safety (correctness).
- Redis-based Redlock gives leases but no fencing tokens, so it should not guard correctness-critical work.

**Key takeaway: Leases stop locks being stuck forever; fencing tokens checked by the resource stop stale holders corrupting data.**

---

## 7. Clocks: why wall clocks lie

**Definition:** A wall clock is a machine's time-of-day clock; across machines it drifts and jumps, so it cannot reliably order events.

Each server's quartz clock drifts, and NTP corrects it, sometimes by stepping it backwards. Leap seconds and VM pauses add more noise. Skew of a few milliseconds between machines is normal, and much more is possible after a bad sync.

### The problem

```text
 Node A's clock is 50 ms ahead of node B's.
 t_real=0   Client writes x=1 via A  -> stamped 10:00:00.050
 t_real=10  Client writes x=2 via B  -> stamped 10:00:00.010
 Last-write-wins keeps x=1 (bigger timestamp); x=2 is silently lost.
```

The later write lost only because its machine's clock was behind.

### Better design

```text
 Use wall time for humans (display) and TTLs with a safety margin.
 Use versions, sequence numbers or logical clocks for ordering.
 Within one machine, measure durations with a monotonic clock
 (Java: System.nanoTime(), not System.currentTimeMillis()).
```

Ordering now comes from counters that cannot run backwards.

**Key takeaway: Never order events across machines by wall-clock timestamps alone.**

---

## 8. Logical clocks

**Definition:** A logical clock is a counter that orders events by cause and effect instead of by physical time.

A **Lamport clock** is one counter per node: increment it on every event, attach it to messages, and on receiving set `counter = max(local, received) + 1`. If A happened before B, A's number is smaller. But a smaller number does not prove that A happened before B. A **vector clock** keeps one counter per node, so it can also tell when two events are concurrent (neither saw the other).

### The problem

```text
 Lamport: event P has 4, event Q has 6.
 Did P cause Q, or were they independent?  Cannot tell.
```

### Better design

```text
 Vector clocks [A, B]:
   P = [2, 1]   Q = [1, 3]
   P <= Q?  no (2 > 1).  Q <= P?  no (3 > 1).  -> concurrent
   -> real conflict: keep both versions, merge or ask the user.
 R = [2, 3] >= both -> R saw both and can safely replace them.
```

Vector clocks detect true conflicts (Dynamo-style stores use them). Hybrid logical clocks (HLC), used by CockroachDB, combine physical time with a logical counter to stay close to real time while preserving causality. Google Spanner instead uses TrueTime, which reports time as an uncertainty interval and waits it out before committing.

**Trade-offs:**
- Vector clocks grow with the number of writers.
- Lamport clocks are tiny but cannot detect concurrency.

**Key takeaway: Lamport clocks give an order consistent with causality; vector clocks also tell you when two writes conflict.**

---

## In an HLD interview
- **Job Scheduler:** one active scheduler elected through etcd or ZooKeeper with a lease; job writes carry fencing tokens so a paused old leader cannot double-run a job.
- **Distributed Cache / Rate Limiter:** cluster membership and config come from a coordination service, not from each node guessing.
- **Payment System / Seat Reservation:** a lock alone is not enough; pair it with fencing tokens or a conditional write in the database.
- **Chat/WhatsApp, Logging/Monitoring:** order messages with per-conversation sequence numbers, not server timestamps.
- What to SAY: "I'll use etcd for leader election with a lease, and every write carries a fencing token that storage checks, so a GC-paused old leader cannot corrupt data."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Consensus | Agree on one value despite failures | Could two nodes both think they are leader? |
| Quorum | Overlapping majorities | Does R + W > N? How many failures can I survive? |
| Raft election | One leader per term by majority vote | What happens when the leader dies? |
| Raft replication | Commit after a majority stores it | Was this write acknowledged before it was safe? |
| ZooKeeper/etcd | Coordination store built on consensus | Am I hand-rolling leader election? |
| Lease + fencing | Expiring lock + token checked by the resource | What if the lock holder pauses for 20 s? |
| Wall clocks | Drift and jump across machines | Am I ordering events by timestamps? |
| Logical clocks | Counters that follow causality | Do I need to detect concurrent writes? |

## Final memory aid
- Consensus prevents split brain.
- A majority of 2f+1 nodes survives f failures.
- Raft: random timeouts, one vote per term, commit on majority.
- etcd and ZooKeeper hold small coordination facts, not business data.
- Lease = liveness; fencing token = safety.
- Wall clocks lie; use versions or logical clocks for order.
- Vector clocks spot conflicts; Lamport clocks only order.
