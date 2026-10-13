=== hld-indexes | HLD | Database indexes and storage engines ===
An index is a second, sorted copy of some of your data that lets the database jump straight to the rows a query needs instead of reading the whole table. This chapter covers how B-tree indexes work, how to order the columns of a composite index, when an index makes things slower, and why write-heavy systems use LSM trees instead. It ends with the inverted index, which powers search boxes.

## 1. What an index is

**Definition:** An index is a separate data structure, kept sorted by one or more columns, that points to the matching rows.

Think of the index at the back of a textbook. To find "quorum" you do not read all 600 pages; you look it up in an alphabetical list and go to page 412. A database index does the same for rows, at the price of keeping that list up to date on every write.

### The problem

```sql
-- orders has 100 million rows, no index on customer_id
SELECT * FROM orders WHERE customer_id = 42;
```

The database must do a **full table scan**: read every row and test it. That is tens of gigabytes of I/O to return perhaps 30 rows, and it gets slower every day as the table grows.

### Better design

```sql
CREATE INDEX idx_orders_customer ON orders (customer_id);
-- the query now walks a sorted structure to the 30 matching entries
```

The query cost now depends on how many rows match, not on how big the table is. It stays fast at 100 million rows or 1 billion.

**Trade-offs:**
- Extra disk and memory for every index.
- Every insert, update and delete must also update the index.

**Key takeaway:** An index turns "read everything" into "look it up", and you pay for it on every write.

---

## 2. The B-tree index

**Definition:** A B-tree is a balanced tree of fixed-size pages, sorted by key, where each page holds hundreds of keys and child pointers.

This is the default index in PostgreSQL, MySQL (InnoDB), Oracle and SQL Server. Because each page (8 KB in Postgres, 16 KB in InnoDB) holds hundreds of entries, the tree is very wide and very shallow. Three or four levels are enough for billions of rows, and the top levels usually sit in memory.

### The problem

Without a sorted structure, a range query like "orders from last week" has no place to start. A hash index can find one exact key quickly, but it cannot answer `BETWEEN`, `>`, `ORDER BY` or "starts with", because hashing destroys the order.

### Better design

```text
                 [ 100 | 500 | 900 ]                 root (in memory)
               /        |        \
      [ 10 | 40 | 70 ] [ ... ]  [ 910 | 950 ]        internal pages
        /    |    \
 [41 42 43 ... 69] -> [70 71 ... 99] -> ...          leaf pages, linked
```

A lookup reads one page per level: about 4 page reads for a billion rows. A range query finds the first key, then walks the linked leaf pages in order, so `WHERE created_at BETWEEN ...` and `ORDER BY` come almost free.

**Trade-offs:**
- Writes update pages in place at random locations, and a full page must split in two.
- Random keys (such as UUID v4) scatter inserts across the whole tree, hurting cache hit rates. Time-ordered keys (UUID v7, Snowflake IDs) keep inserts at the right-hand edge.

**Key takeaway:** B-trees give fast exact lookups and fast ranges with steady, predictable read performance.

---

## 3. Composite indexes and the leftmost prefix rule

**Definition:** A composite index is one index on several columns, sorted by the first column, then by the second within each first value, and so on.

A phone book is a composite index on (last name, first name). It is great for "Sharma, Pallav" and for "everyone named Sharma", but useless for "everyone named Pallav", because first names are scattered across the whole book. This is the **leftmost prefix rule**: an index can only seek using a prefix of its columns, starting from the left.

### The problem

```sql
CREATE INDEX idx_bad ON orders (created_at, customer_id);

SELECT * FROM orders
WHERE customer_id = 42
ORDER BY created_at DESC LIMIT 20;
```

The index is sorted by `created_at` first, so customer 42's orders are spread across the entire index. The database either scans the whole index or ignores it.

### Better design

```sql
CREATE INDEX idx_good ON orders (customer_id, created_at DESC);
-- seek to customer_id = 42, read the first 20 entries, stop
```

**Rule of thumb:** columns tested with equality go first, then the one range or sort column. This one index also serves `WHERE customer_id = 42` on its own, so you rarely need a separate index on `(customer_id)`.

**Trade-offs:**
- Column order is a real decision; one index cannot serve every query shape.
- Some engines can "skip scan" an index whose first column has few distinct values, but do not design around it.

**Key takeaway:** Order composite index columns as equality first, range or sort last, and check every important query against the leftmost prefix.

---

## 4. Covering indexes

**Definition:** A covering index contains every column a query reads, so the database answers the query from the index alone without visiting the table.

Normally an index lookup finds a pointer, then makes a second, often random, read to fetch the full row. If the index already holds everything needed, that second read disappears. Postgres calls this an "Index Only Scan"; MySQL's `EXPLAIN` shows "Using index".

### The problem

```sql
-- index on (customer_id, created_at) only
SELECT created_at, total, status
FROM orders WHERE customer_id = 42
ORDER BY created_at DESC LIMIT 20;
```

The index finds 20 entries quickly, but `total` and `status` are not in it, so the engine performs 20 extra random reads into the table. On a hot endpoint called thousands of times a second, those lookups dominate the cost.

### Better design

```sql
-- PostgreSQL 11+ / SQL Server: INCLUDE stores extra columns in leaf pages only
CREATE INDEX idx_orders_cover
  ON orders (customer_id, created_at DESC) INCLUDE (total, status);
```

The query is now answered from one small, contiguous slice of the index. In MySQL, which has no `INCLUDE`, you get the same effect by adding the columns to the end of the index key.

**Trade-offs:**
- A wider index uses more memory and makes writes to those columns slightly costlier.
- Use it for a few hot queries, not for every query.

**Key takeaway:** For a very hot read, put the selected columns into the index so the table is never touched.

---

## 5. When indexes hurt

**Definition:** An index hurts when the cost it adds to writes, memory and storage is larger than the time it saves on reads.

Every index is a promise the database must keep on every write. An index nobody queries is pure cost. An index on a column with few distinct values is often ignored by the query planner (the part of the database that picks how to run a query), because reading most of the table directly is cheaper.

### The problem

```text
events table: 50,000 inserts/sec, 9 indexes
one insert = 1 table write + 9 index writes = 10 writes
index on status ('NEW','DONE','FAILED') -> ~33% of rows per value, planner ignores it
```

Write throughput drops, the indexes no longer fit in memory, and the cache starts evicting the pages that real queries need.

### Better design

```text
events table: 2 indexes that match actual query patterns
  (device_id, created_at)                          -- the main read path
  partial index ON (created_at) WHERE status = 'FAILED'   -- only the rare value
analytics queries -> separate warehouse fed by change data capture
```

Keep the indexes that real queries use, index only the rare value with a partial index, and move ad-hoc analytics to a system built for scans.

**Trade-offs:**
- Fewer indexes means some unusual queries become slow; that is a deliberate choice.

**Key takeaway:** Index for the queries you actually run; on write-heavy tables, every extra index is a tax on every write.

---

## 6. LSM trees for write-heavy workloads

**Definition:** A log-structured merge tree (LSM tree) buffers writes in memory and writes them to disk as sorted, immutable files, which are merged in the background.

Instead of finding and editing the right page on disk, an LSM engine just appends. Writes go to a **write-ahead log** (WAL, an append-only file for crash recovery) and an in-memory sorted table called the **memtable**. When the memtable fills, it is flushed as a sorted file called an **SSTable**. A background process called **compaction** merges SSTables and throws away overwritten and deleted values. Cassandra, ScyllaDB, RocksDB, LevelDB and HBase all work this way.

### The problem

```text
chat app: 200,000 message writes/sec, B-tree storage
each write -> find leaf page (random read) -> modify 16 KB page -> write it back
a 200-byte message causes a full page write; random I/O everywhere
```

The disk spends its time seeking and rewriting whole pages for tiny changes. Throughput hits a ceiling long before the hardware's sequential write speed.

### Better design

```text
write:  WAL (append)  +  memtable (in memory, sorted)
        memtable full -> flush as SSTable-5 (one sequential write)
read:   memtable -> SSTable-5 -> SSTable-4 -> ...   (newest first)
        each SSTable has a Bloom filter: "key is definitely not here" -> skip it
background: compaction merges SSTables, drops old versions and tombstones
```

All disk writes are sequential and batched, so write throughput is very high. A **Bloom filter** is a small in-memory structure that can say "definitely not here" for a key, so reads skip most files.

**Trade-offs:**
- Reads may check several files; a missing key or a range scan costs more than in a B-tree.
- Compaction uses disk I/O and CPU in the background and can cause latency spikes.
- Deletes write a marker called a **tombstone**; many tombstones slow reads until compaction removes them.

**Key takeaway:** LSM trees trade some read cost and background work for very fast, sequential writes.

### B-tree vs. LSM

| | B-tree | LSM tree |
|---|---|---|
| Writes | In place, random I/O | Append, sequential I/O |
| Reads | Predictable, one path | May check several files |
| Best for | Read-heavy, transactional (orders, payments) | Write-heavy (chat, metrics, logs, IoT) |
| Examples | PostgreSQL, MySQL InnoDB | Cassandra, RocksDB, HBase |

The underlying idea is a three-way trade between read cost, write cost and space. No engine wins all three; you choose by workload.

---

## 7. The inverted index for search

**Definition:** An inverted index maps each word (term) to the list of documents that contain it, called a posting list.

A B-tree is sorted by the whole value, so it can find "starts with wireless" but not "contains headphones". An inverted index is like a cookbook's index by ingredient: look up "garlic" and get every recipe that uses it. Lucene, Elasticsearch, OpenSearch and Solr are built on it.

### The problem

```sql
SELECT * FROM products
WHERE description LIKE '%wireless headphones%';
-- leading % -> no B-tree can help -> scan all 50 million rows
```

Every search reads the whole table. It also misses "headphone" (singular), cannot rank results by relevance and cannot handle typos.

### Better design

```text
text is tokenised and normalised: "Wireless Headphones" -> [wireless, headphon]
  wireless  -> [3, 17, 42, 108, ...]
  headphon  -> [17, 42, 99, ...]
query "wireless headphones" -> intersect lists -> [17, 42] -> rank with BM25
```

The query reads two short posting lists instead of 50 million rows. A ranking formula such as BM25 scores rarer words higher, so the best match comes first.

**Trade-offs:**
- It is a second system to run, kept in sync with the main database, usually through change data capture (CDC: streaming every committed change), so search results lag slightly.
- At small scale, PostgreSQL full-text search with a GIN index may be enough.

**Key takeaway:** Use a B-tree for "find by value" and an inverted index for "find by words inside text".

---

## In an HLD interview

- **URL Shortener:** the lookup by short code is a point query on the primary key; a B-tree or a key-value store is fine. Use time-ordered IDs if the key is the clustered index.
- **Chat/WhatsApp, Logging, Metrics:** write-heavy and time-ordered, so pick an LSM store such as Cassandra, partitioned by conversation or source and sorted by time.
- **News Feed:** a composite index `(author_id, created_at DESC)`, possibly covering, serves "latest posts by this author" in one seek.
- **Seat Reservation / BookMyShow:** a unique index on `(show_id, seat_id)` is the last line of defence against double booking.
- **Amazon E-commerce / Google Search:** keep the catalogue in a relational database and serve search from an inverted index (Elasticsearch) fed by CDC.
- **What to SAY:** "My main read is X, so I index the equality columns, then the sort column. The table is write-heavy, so I keep only that index, and if writes keep growing I move to an LSM-based store."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Index | Sorted copy that points to rows | Which query is doing a full scan? |
| B-tree | Wide, shallow, sorted pages | Do I need ranges and ordering? |
| Composite index | Sorted by column 1, then column 2 | Equality first, range or sort last? |
| Covering index | Index holds every column read | Is this query hot enough to cover? |
| Indexes that hurt | Cost on every write | Does a real query use this index? |
| LSM tree | Append, flush, compact | Is the workload write-heavy? |
| Inverted index | Word -> list of documents | Am I searching inside text? |

## Final memory aid

- **Index:** look it up, do not scan
- **B-tree:** shallow, sorted, ranges are cheap
- **Composite:** leftmost prefix; equality first, range last
- **Covering:** never touch the table
- **Cost:** every index taxes every write
- **LSM:** append now, merge later
- **Search:** words to documents, not values to rows

=== hld-replication | HLD | Replication: leader-follower, multi-leader and leaderless ===
Replication keeps copies of the same data on several machines so the system survives failures, serves more reads and sits closer to users. Copying bytes is easy; the hard part is deciding who accepts writes, what readers see while copies catch up, and what happens when a machine dies. This chapter walks through leader-follower, multi-leader and leaderless replication, with the problems each one creates and how to handle them.

## 1. Why replicate

**Definition:** Replication means keeping the same data on more than one machine, called replicas.

There are four reasons: survive the loss of a disk, machine or data centre (availability and durability); spread reads across machines (read scaling); serve users from a nearby copy (latency); and run backups or reports on a copy instead of the main database (isolation).

### The problem

```text
one database server, 99.9% of its disks never fail... until one does
  -> every write since the last nightly backup is gone (up to 24 hours)
  -> the app is down until a new server is restored (hours)
  -> meanwhile 20,000 reads/sec were already saturating its CPU
```

A single copy is a single point of failure for both data and uptime, and it caps read throughput at one machine.

### Better design

```text
             writes
 app ---------------------> [ Leader ] --log--> [ Follower A, zone 2 ]
  |                                    \--log--> [ Follower B, zone 3 ]
  +--- reads spread over A and B ------------------^
```

If the leader dies, a follower holding the same data takes over in seconds, and reads scale by adding followers.

**Trade-offs:**
- More machines to pay for and operate.
- Copies can disagree for a while; the rest of this chapter is about that.

**Key takeaway:** Replication buys availability, read scale and locality. It is not a backup: a bad `DELETE` is copied to every replica within milliseconds, so you still need snapshots.

---

## 2. Leader-follower replication

**Definition:** In leader-follower (also called primary-replica) replication, one node, the leader, accepts all writes and streams its change log to followers, which apply the changes in the same order.

This is how PostgreSQL streaming replication, MySQL replication, MongoDB replica sets and Kafka partitions work. Because every write goes through one node, there is one clear order of events and no write conflicts. Reads can go to the leader or to any follower.

### The problem

If any node could accept writes without coordination, two updates to the same row could land on different nodes in a different order:

```text
node 1: balance = 100 -> set 150 -> set 80
node 2: balance = 100 -> set 80  -> set 150
the two copies now disagree forever
```

### Better design

```text
client -> Leader: log #101 "set 150", #102 "set 80"
Leader -> Follower A: apply #101, #102 in order
Leader -> Follower B: apply #101, #102 in order
every copy ends at 80
```

One writer means one order, and followers that replay the same log in the same order end up identical.

**Trade-offs:**
- Write throughput is limited to what one leader can handle (sharding fixes that; see the next chapter).
- Followers can be behind the leader (replication lag, section 4).

**Key takeaway:** Leader-follower is the default because one writer gives one order and no conflicts.

---

## 3. Synchronous vs. asynchronous replication

**Definition:** With synchronous replication the leader waits for a follower to confirm a write before telling the client "done"; with asynchronous replication it confirms immediately and ships the change afterwards.

It is like sending a parcel. Synchronous is "wait at the counter until the other branch confirms it has a copy". Asynchronous is "drop it off and leave"; usually fine, but if the shop burns down before shipping, the parcel is lost.

### The problem

```text
asynchronous only:
  10:00:00.000  client writes payment #9001 -> leader says OK
  10:00:00.050  leader crashes before shipping #9001
  10:00:30      follower promoted to leader -> payment #9001 does not exist
```

The client was told the payment succeeded, but it is gone. With fully synchronous replication to every follower the opposite happens: one slow or dead follower blocks all writes.

### Better design

```text
semi-synchronous: wait for ANY 1 follower, the rest are asynchronous
  leader --sync--> Follower A (zone 2)   must ack before client gets OK
  leader --async-> Follower B (zone 3)   catches up in the background
PostgreSQL:  synchronous_standby_names = 'ANY 1 (a, b)'
```

At least two machines hold every confirmed write, and if one follower is slow the leader can wait for the other.

**Trade-offs:**
- Every write pays one extra network round trip (about 1-2 ms across zones; far more across regions).
- Async keeps writes fast and available but can lose the last few writes on failover.

**Key takeaway:** For data you must not lose (payments), wait for at least one other copy; for data you can afford to lose a second of (likes, metrics), async is fine.

---

## 4. Replication lag and read-your-writes

**Definition:** Replication lag is the delay between a write landing on the leader and that write appearing on a follower.

Lag is usually milliseconds, but under heavy load or a long-running write it can grow to seconds or minutes. During that window, followers serve old data. The system is **eventually consistent**: copies agree if writes stop for long enough. The most visible symptom is breaking **read-your-writes**, the promise that a user always sees their own changes.

### The problem

```text
t=0     user saves new display name "Pallav S" -> leader
t=5ms   page reloads, read goes to Follower B (lag 2 s)
        -> shows the OLD name; user thinks the save failed and tries again
```

A second symptom is **monotonic reads** breaking: two refreshes hit two followers with different lag, so a new comment appears and then disappears.

### Better design

```java
// After a write, route that user's reads to the leader for a short window
public Profile getProfile(long userId) {
    Instant lastWrite = recentWrites.get(userId);          // set on every update
    boolean fresh = lastWrite != null
            && lastWrite.isAfter(Instant.now().minusSeconds(10));
    DataSource ds = fresh ? leader : replicaFor(userId);   // replicaFor pins a user to one follower
    return profileDao.find(ds, userId);
}
```

The user reads their own recent changes from the leader, and pinning each user to one follower (for example by hashing the user ID) gives monotonic reads. A stricter option is to remember the log position of the user's last write and read only from a follower that has reached it.

**Trade-offs:**
- More reads hit the leader right after writes.
- Other users may still briefly see the old value; that is usually acceptable.

**Key takeaway:** Lag is normal; design so a user never sees their own write disappear.

---

## 5. Failover and split brain

**Definition:** Failover is promoting a follower to leader when the leader dies; split brain is when two nodes both believe they are the leader and both accept writes.

Failover has three steps: detect the leader is dead (usually missed heartbeats for some timeout), choose the most up-to-date follower, and point clients and other followers at it. Each step can go wrong. The hardest case is a leader that is not dead, only slow or cut off by the network.

### The problem

```text
network partition:
  [ Old leader ]  X  [ Follower A, Follower B ]
  A is promoted -> new leader, accepts writes for seat 12 -> user 1
  old leader still serving its own clients -> writes seat 12 -> user 2
partition heals: two histories, two owners of seat 12
```

Split brain silently corrupts data. Another real failure: if an async follower is promoted, writes it never received are lost, and IDs the old leader already handed out can be reused. GitHub had a well-known incident where a stale MySQL follower was promoted, primary keys were reused, and some private data was shown to the wrong users.

### Better design

```text
leader election through consensus (Raft, ZooKeeper, etcd): needs a majority (2 of 3)
each new leader gets a higher epoch (term) number: old = 7, new = 8
every write carries the epoch; storage and followers reject epoch 7
  -> the old leader's writes are refused (fencing)
old leader cannot reach a majority -> steps down on its own
```

A majority vote means only one side of a partition can elect a leader, and the epoch number (a **fencing token**) makes any stale leader's writes harmless.

**Trade-offs:**
- A short timeout fails over on a mere slow spell; a long one means longer downtime. Typical values are seconds to tens of seconds.
- You need an odd number of voters (3 or 5), possibly across three zones.

**Key takeaway:** Automatic failover is only safe with a majority-based election and fencing so an old leader cannot keep writing.

---

## 6. Multi-leader replication and conflicts

**Definition:** In multi-leader replication, several nodes (typically one per region) each accept writes and replicate them to each other asynchronously.

This helps when users in Mumbai and New York both need fast local writes, or when a device must work offline (a calendar app on your phone is effectively a leader that syncs later). The price is **write conflicts**: the same record changed in two places at once.

### The problem

```text
Mumbai leader:    doc 77 title = "Q3 plan"     at 10:00:00.100
New York leader:  doc 77 title = "Q3 roadmap"  at 10:00:00.120
both succeed locally, then replicate to each other -> which one wins?
```

With **last-writer-wins** (LWW: keep the higher timestamp), "Q3 roadmap" wins and the Mumbai edit is silently thrown away. If the clocks are skewed, the "later" write may not even be the real later one.

### Better design

```text
Option 1, avoid conflicts: each record has a home region; all writes for doc 77 go to Mumbai
Option 2, merge: use data types that combine safely (CRDTs)
  like counter:  Mumbai +3, New York +2  -> merged = +5, nothing lost
  tag set:       add "urgent" in one region, add "q3" in the other -> both kept
Option 3, keep both versions and let the app or user pick
```

Routing each record to a home region removes most conflicts. For data that truly is edited everywhere, **CRDTs** (conflict-free replicated data types: counters, sets and similar structures designed so merges always agree) avoid losing updates.

**Trade-offs:**
- Conflict handling is complex and often surprising for users.
- LWW is simple but loses data; for example, DynamoDB global tables resolve concurrent writes with last-writer-wins.

**Key takeaway:** Use multi-leader only when you need local writes in several regions or offline, and decide up front how each conflict is resolved.

---

## 7. Leaderless replication and quorums (N, R, W)

**Definition:** In leaderless replication, the client (or a coordinator node) sends each write to several replicas and reads from several replicas, with no single leader; quorums decide when an operation counts as successful.

This is the Amazon Dynamo design, used by Cassandra, ScyllaDB and Riak. Three numbers matter: **N** is how many replicas hold each key, **W** is how many must confirm a write, and **R** is how many are asked on a read. If **W + R > N**, the set of nodes you read from must overlap the set that took the latest write, so at least one answer is fresh.

### The problem

```text
N = 3, W = 1, R = 1   (fast, but no overlap)
write x = 5 -> only replica 1 confirms; replicas 2 and 3 still have x = 4
read  x     -> asks replica 3 only -> returns 4 (stale)
```

Because 1 + 1 is not greater than 3, the read and the write can miss each other entirely.

### Better design

```text
N = 3, W = 2, R = 2   (2 + 2 > 3)
write x = 5 -> replicas 1 and 2 confirm (replica 3 is down)
read  x     -> asks replicas 2 and 3 -> gets {5 (newer version), 4}
            -> returns 5, then writes 5 back to replica 3 (read repair)
Cassandra: replication_factor = 3, consistency level QUORUM (= 2) for reads and writes
```

The overlap guarantees the newest version is seen, and version numbers tell the coordinator which answer is newer. Replicas that missed writes catch up through **read repair** (fix on read) and **anti-entropy** (a background job that compares replicas, often with Merkle trees, which are hash trees that find differences cheaply).

**Trade-offs:**
- Higher W or R means higher latency and less tolerance of down nodes; W = N blocks writes if any replica is down.
- The guarantee weakens with a **sloppy quorum** (writes stored on substitute nodes during failures, then handed back later by **hinted handoff**) and with concurrent writes resolved by timestamps. Quorums are not the same as transactions.

**Key takeaway:** Pick N, R and W per use case: W + R > N for fresher reads, small R or W for speed and availability.

### Leader-follower vs. multi-leader vs. leaderless

- **Leader-follower:** one writer, no conflicts, simple; failover is the hard part. The default for most systems.
- **Multi-leader:** local writes in many regions or offline; you must resolve conflicts.
- **Leaderless:** no failover at all and high write availability; you tune consistency with N, R and W and accept repair work.

---

## In an HLD interview

- **Payment System / Amazon E-commerce orders:** leader-follower with at least one synchronous follower in another zone, consensus-based failover with fencing, and reads of a user's own orders from the leader.
- **News Feed / Notification System:** async followers serve the heavy read traffic; a few seconds of lag is fine, but read-your-writes for the author's own post.
- **Chat/WhatsApp, Metrics, Ride Tracking:** leaderless (Cassandra) with RF = 3 and QUORUM for messages, ONE for high-volume location pings you can afford to lose.
- **Google Docs-style editing or offline apps:** multi-leader with CRDTs or operational transforms; say how conflicts merge.
- **What to SAY:** "Writes go to a single leader; I replicate synchronously to one follower in another zone so a confirmed write survives a crash, and asynchronously to read replicas. After a user writes, I route their reads to the leader for a few seconds."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Replication | Same data on several machines | What happens if this machine dies? |
| Leader-follower | One writer, followers replay its log | Can one leader take all the writes? |
| Sync vs. async | Wait for a copy, or ship later | Can I afford to lose the last second of writes? |
| Replication lag | Followers are behind | Will a user see their own write vanish? |
| Failover and split brain | Promote a follower safely | What stops the old leader from writing? |
| Multi-leader | Many writers, conflicts | How exactly do conflicts merge? |
| Leaderless quorum | W + R > N gives overlap | Which N, R, W fit this data? |

## Final memory aid

- **Why:** survive, scale reads, stay close; not a backup
- **Leader-follower:** one writer, one order
- **Sync:** safe but slow; **async:** fast but lossy
- **Lag:** read your own writes from the leader
- **Failover:** majority vote plus fencing token
- **Multi-leader:** home region or CRDT, never silent LWW for money
- **Leaderless:** W + R > N
