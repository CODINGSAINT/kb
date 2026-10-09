=== hld-indexes | HLD | Database indexes and storage engines ===
Every database is a storage engine (how bytes are laid out on disk) with a query layer on top. The two dominant engine designs, **B-trees** (update in place) and **LSM trees** (append, then merge), make opposite trade-offs between read speed, write speed and space, and that choice explains most of the behaviour you see in Postgres, MySQL, RocksDB and Cassandra. This chapter covers how both engines work, the index types you build on top of them, how to read a query plan, and when an index makes things worse.

## Core concepts
- **Index:** an extra data structure, derived from the table, that lets you find rows without scanning everything. It speeds up reads and slows down writes, because every insert, update and delete must also update every index.
- **Heap vs clustered storage:** in a *heap* (Postgres), rows live in insertion order and every index points at a physical row location (a TID). In a *clustered* layout (MySQL InnoDB, SQL Server clustered index), the table itself *is* a B-tree ordered by primary key, and secondary indexes store the primary key as their pointer.
- **Selectivity:** the fraction of rows a predicate matches. Indexes pay off when selectivity is low (few rows). Matching 30% of a table through an index is usually slower than a sequential scan.
- **Write-ahead log (WAL):** an append-only log of changes, flushed to disk before the change is acknowledged. After a crash, the engine replays the WAL to recover. The WAL is also the raw material for replication and change data capture.

## B-tree engines
A B-tree (in practice a B+tree) is a balanced tree of fixed-size **pages** (8 KB in Postgres, 16 KB in InnoDB). Interior pages hold keys and child pointers; leaf pages hold keys plus either the row (clustered) or a pointer to it. Leaves are linked, so range scans walk sideways.

```
                 [ 100 | 500 ]                  root (1 page)
               /       |       \
      [20|60]      [200|350]     [700|900]      interior
      /  |  \       /  |  \       /  |  \
   leaf leaf leaf leaf leaf leaf leaf leaf leaf  -> linked list for range scans
```

With a branching factor of a few hundred, a tree of depth 3–4 covers billions of rows: 500^4 is about 6 x 10^10. A point lookup is therefore 3–4 page reads, and the upper levels are almost always cached in memory, so a lookup typically costs one disk read.

### How a write works
1. Append the change record to the WAL and fsync (this is the durability point).
2. Find the leaf page and modify it in the buffer pool (memory). The page is now *dirty*.
3. If the page is full, **split** it into two and insert a separator key into the parent (which can cascade upwards).
4. A background checkpointer later writes dirty pages to their place in the data file.

Because pages are modified in place, a crash during a half-written page could corrupt the tree. Engines protect against this with full-page images in the WAL (Postgres) or a doublewrite buffer (InnoDB).

### Strengths and costs
- Predictable read latency: one key lives in exactly one place.
- Excellent for range scans and ordered reads.
- Natural home for transactions and row locks.
- Writes are random I/O (a page anywhere in the file), and a one-row change rewrites a whole page: write amplification of roughly page size / row size, plus the WAL copy.
- Fragmentation: page splits leave half-empty pages; random keys (UUID v4) make this much worse than sequential keys.

## LSM-tree engines
A **log-structured merge tree** never updates data in place. It buffers writes in memory, flushes them as immutable sorted files, then merges those files in the background. RocksDB, LevelDB, Cassandra, ScyllaDB, HBase, Bigtable and the storage layers of CockroachDB, TiKV and YugabyteDB are all LSM-based.

```
write -> WAL (append) -> memtable (sorted, in memory: skiplist / red-black tree)
                              | full (e.g. 64 MB)
                              v
                         flush to SSTable (immutable, sorted, on disk)  L0
                              | background compaction
                              v
                     L1 (10x bigger) -> L2 (10x bigger) -> ...
```

### The pieces
- **Memtable:** sorted in-memory structure. Writes go to the WAL (for crash recovery) and the memtable, then return. That is why LSM writes are so fast: sequential I/O only.
- **SSTable (sorted string table):** an immutable file of sorted key-value pairs, with a sparse **block index** (first key of every 4–64 KB block) and a **Bloom filter**. Once written, never modified.
- **Deletes:** written as a **tombstone** marker, because older SSTables still contain the value. The data only disappears once compaction merges the tombstone with every older version.
- **Compaction:** background merge-sort of SSTables. Duplicate keys keep only the newest version, tombstones remove dead data, and the number of files a read must check stays bounded.

### How a read works
1. Check the memtable (and any immutable memtable being flushed).
2. For each SSTable from newest to oldest, check its Bloom filter. If the filter says "definitely not here", skip the file without touching disk.
3. If the filter says "maybe", use the block index to read one block and binary search it.
4. Return the first (newest) version found, or not-found if the newest entry is a tombstone.

Without Bloom filters, a lookup for a missing key would read a block from every SSTable. With about 10 bits per key (roughly 1% false positives), almost all of those reads are skipped. Range scans cannot use Bloom filters, so they must merge iterators across all overlapping files, which is why range scans are relatively more expensive on LSM engines.

### Compaction strategies
| Strategy | How | Good for | Cost |
|---|---|---|---|
| **Size-tiered** (Cassandra STCS default) | Merge several SSTables of similar size into one bigger one | Write-heavy workloads | Higher read amplification, up to 2x temporary disk space |
| **Leveled** (RocksDB default, Cassandra LCS) | Each level is 10x the previous; files in a level have non-overlapping key ranges | Read-heavy, space-sensitive | More write amplification (a key is rewritten ~10x per level) |
| **Time-window** (Cassandra TWCS) | Group SSTables by time window, never merge across windows | Time-series with TTL | Bad if old data is updated or deleted out of order |

## The three amplifications
Every engine trades these off; you cannot minimise all three at once (the RUM conjecture: Read, Update, Memory).

| | B-tree | LSM tree |
|---|---|---|
| Write amplification | Page rewrite per change + WAL (often 10–100x for small rows) | Rewritten once per compaction level (10–30x leveled; lower for tiered) |
| Read amplification | Low: one path, 3–4 pages, mostly cached | Higher: memtable + several SSTables, mitigated by Bloom filters and caches |
| Space amplification | Fragmentation, half-full pages (often 1.3–1.5x) | Stale versions and tombstones until compacted (~1.1x leveled, up to 2x tiered) |
| Write pattern | Random I/O | Sequential I/O, SSD friendly |
| Latency profile | Stable | Usually fast, with spikes when compaction falls behind |
| Typical systems | Postgres, MySQL InnoDB, Oracle, SQL Server, MongoDB WiredTiger | RocksDB, Cassandra, ScyllaDB, HBase, Bigtable, LevelDB |

Rule of thumb for interviews: **write-heavy, append-mostly, key-value or time-series access leans LSM; read-heavy, transactional, rich secondary indexes leans B-tree.**

## Index types you build on top
### Primary and clustered indexes
In InnoDB the primary key *is* the table order. Consequences: a sequential PK (auto-increment, Snowflake, UUID v7) appends to the right edge of the tree; a random PK (UUID v4) inserts all over the tree, causing page splits, cache misses and much higher disk usage. Secondary indexes store the PK, so a wide PK bloats every index. In Postgres the heap is unordered; `CLUSTER` reorders it once but does not maintain the order.

### Secondary indexes
Any extra index on non-PK columns. In InnoDB a secondary lookup is two tree traversals (secondary index to find the PK, then the clustered index to find the row). In Postgres it is an index probe plus a heap fetch.

### Composite indexes and the leftmost-prefix rule
An index on `(a, b, c)` is sorted by `a`, then `b` within `a`, then `c` within `b`, like a phone book sorted by last name then first name.

```sql
CREATE INDEX idx_orders_user_status_created
  ON orders (user_id, status, created_at);

-- Uses the index fully: equality on a prefix, range on the last used column
SELECT * FROM orders WHERE user_id = 42 AND status = 'PAID' AND created_at > now() - interval '7 days';

-- Seeks on user_id only (status skipped, so created_at cannot be used for seeking)
SELECT * FROM orders WHERE user_id = 42 AND created_at > now() - interval '7 days';

-- Cannot seek with this index (no leading user_id)
SELECT * FROM orders WHERE status = 'PAID';
```

Design rules:
- Put **equality** columns first, then the **range or sort** column. A range on a column stops the index from being used for seeking on the columns after it.
- Match the `ORDER BY` so the database can stream results in index order and stop at `LIMIT` without sorting.
- One well-designed composite index often replaces several single-column ones.

### Covering indexes
If the index contains every column the query needs, the engine answers from the index alone ("Index Only Scan" in Postgres, "Using index" in MySQL EXPLAIN) and skips the row fetch.

```sql
-- Postgres: key columns plus payload columns not used for ordering
CREATE INDEX idx_feed_cover ON posts (author_id, created_at DESC) INCLUDE (title, like_count);
```

In Postgres, index-only scans also depend on the visibility map, so a table that is not vacuumed regularly falls back to heap fetches.

### Partial (filtered) indexes
Index only the rows you query. Smaller, faster, cheaper to maintain.

```sql
CREATE INDEX idx_jobs_pending ON jobs (run_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX uniq_active_email ON users (email) WHERE deleted_at IS NULL;
```

The second is a classic: enforce uniqueness only among non-deleted users (soft deletes).

### Other index types
| Type | What it does | Example |
|---|---|---|
| Hash index | Equality only, O(1); no ranges | Postgres `USING hash`, in-memory KV stores |
| Expression / functional | Index on a computed value | `CREATE INDEX ON users (lower(email))` |
| GIN (generalized inverted) | Many keys per row: arrays, JSONB, full text | `CREATE INDEX ON docs USING gin (tags)` |
| GiST / R-tree | Geometric and range overlap | PostGIS `ST_DWithin`, exclusion constraints for bookings |
| BRIN | Tiny min/max summary per block range | Huge append-only time-series tables |
| Bitmap | Bit per distinct value; combine with AND/OR | Low-cardinality columns in warehouses (Oracle, Druid) |

## Inverted indexes and full-text search
A B-tree on a `description` column cannot answer "which documents contain the word *kafka*". An **inverted index** maps each term to a **posting list** of document IDs (plus positions and frequencies).

```
Analysis: "Kafka Streams scales!" -> tokenise -> lowercase -> stem -> [kafka, stream, scale]

term     -> posting list (docId:positions)
kafka    -> 3:[0], 17:[4,9], 42:[1]
stream   -> 3:[1], 8:[2]
scale    -> 3:[2], 42:[7]
```

- Query `kafka AND scale`: intersect sorted posting lists (fast, especially with skip pointers).
- Phrase queries use positions; ranking uses BM25 (term frequency, inverse document frequency, document length).
- Lucene (inside Elasticsearch, OpenSearch and Solr) stores the index as immutable **segments** that are periodically merged: the same idea as an LSM tree. New documents become searchable after a *refresh* (about 1 s by default), which is why search is "near real time".
- Postgres has built-in full text (`tsvector` plus a GIN index), which is good enough for many products before you need a search cluster.

## Reading a query plan
Always confirm with `EXPLAIN` rather than guessing.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total FROM orders
WHERE user_id = 42 AND status = 'PAID'
ORDER BY created_at DESC LIMIT 20;

-- Good:
-- Limit (actual time=0.05..0.09 rows=20)
--   -> Index Scan Backward using idx_orders_user_status_created on orders
--        Index Cond: ((user_id = 42) AND (status = 'PAID'))
--        Buffers: shared hit=6
-- Bad signs:
--   Seq Scan on orders (rows=50000000)         -> missing or unusable index
--   Sort Method: external merge Disk           -> ORDER BY not served by an index
--   rows estimated=10 vs actual=900000         -> stale statistics, run ANALYZE
```

What to look for: Seq Scan vs Index Scan vs Index Only Scan vs Bitmap Heap Scan; the gap between estimated and actual rows; sorts and hashes spilling to disk; nested loops over large row counts. In MySQL, check `type` (`ALL` means full scan; `ref`, `range`, `const` are good), `key`, `rows` and `Extra` (`Using filesort`, `Using temporary`).

### Why an index is ignored
- A function or cast on the column: `WHERE date(created_at) = ...`, or comparing a varchar column to a number. Use an expression index or rewrite as a range.
- Leading wildcard: `LIKE '%abc'` (use a trigram GIN index or a search engine).
- Leftmost prefix not satisfied.
- Low selectivity: the planner correctly prefers a sequential scan.
- `OR` across different columns (sometimes solved by bitmap OR or a `UNION`).
- Stale statistics.

## Java/Spring example
```java
@Entity
@Table(name = "orders", indexes = {
    @Index(name = "idx_orders_user_status_created", columnList = "user_id, status, created_at")
})
public class Order {
    @Id
    private UUID id;            // generate UUID v7 (time-ordered) to avoid random B-tree inserts
    @Column(name = "user_id", nullable = false) private long userId;
    @Enumerated(EnumType.STRING) private OrderStatus status;
    @Column(name = "created_at") private Instant createdAt;
}

public interface OrderRepository extends JpaRepository<Order, UUID> {
    // Served by the composite index: equality, equality, then ordered by the third column
    List<Order> findTop20ByUserIdAndStatusOrderByCreatedAtDesc(long userId, OrderStatus status);
}
```

In production, create indexes through migrations (Flyway/Liquibase), not Hibernate `ddl-auto`, and in Postgres use `CREATE INDEX CONCURRENTLY` so the table is not locked against writes during the build (MySQL: online DDL or gh-ost / pt-online-schema-change).

## Real-world systems
- **PostgreSQL:** heap plus B-tree by default. MVCC keeps old row versions in the heap, so an update creates a new tuple and may add new entries to every index (HOT updates avoid this when no indexed column changes and the page has free space). VACUUM reclaims dead tuples. Rich index types: GIN, GiST, BRIN, partial, expression, covering.
- **MySQL InnoDB:** clustered PK B-tree; secondary indexes hold the PK; the change buffer defers secondary index updates; the doublewrite buffer protects against torn pages.
- **RocksDB:** embeddable LSM used inside Kafka Streams state stores, Flink, TiKV, MyRocks (MySQL on RocksDB, adopted by Meta for space efficiency); CockroachDB uses Pebble, a Go LSM inspired by it.
- **Cassandra / ScyllaDB:** LSM per node; the partition key picks the node, clustering columns set the sort order inside the partition, and tables are designed per query. Secondary indexes are local per node and should be used sparingly.
- **Elasticsearch:** Lucene inverted-index segments, merged in the background like LSM compaction.

## How it shows up in interview problems
- **URL shortener:** lookup by short code is a point query; a B-tree PK or a KV store works. Prefer time-ordered IDs if the code is the clustered key.
- **Chat / messaging:** write-heavy and time-ordered per conversation, so an LSM store (Cassandra) with a `(conversation_id, bucket)` partition and `message_id DESC` clustering.
- **Metrics, logging, tracking:** append-only, huge volume, TTL: LSM with time-window compaction or columnar stores; BRIN in Postgres at modest scale.
- **E-commerce / search:** catalog in a relational DB, search through an inverted index (Elasticsearch) fed by CDC.
- **Job scheduler:** partial index on `(run_at) WHERE status = 'PENDING'` plus `SELECT ... FOR UPDATE SKIP LOCKED`.
- **News feed:** covering index `(author_id, created_at DESC)` for fan-out-on-read queries.
- **Seat reservation (BookMyShow):** a unique index on `(show_id, seat_id)` is the last line of defence against double booking.

## Common pitfalls
- Indexing every column. Each index costs write throughput, memory and disk; write-heavy tables should carry only what queries need.
- Random UUID v4 as a clustered PK in MySQL.
- Composite index in the wrong column order.
- Forgetting that the ORM generates queries the index does not support (log and inspect the SQL).
- Building an index on a busy table without `CONCURRENTLY` / online DDL.
- Expecting an LSM store to do cheap cross-partition range scans or cheap deletes (tombstones pile up and slow reads; Cassandra warns after thousands per query).
- Unused indexes left behind; check `pg_stat_user_indexes.idx_scan` and drop them.

## Interview questions
1. **Why are LSM trees faster for writes than B-trees?** They turn random writes into sequential ones: append to the WAL, insert into the in-memory memtable, and flush sorted immutable files later. B-trees must locate and rewrite a page in place, which is random I/O and amplifies small writes to full pages.
2. **How does an LSM tree avoid reading every SSTable on a lookup?** Each SSTable has a Bloom filter that rules out files that cannot contain the key, plus a sparse block index so only one block is read from files that might. Compaction keeps the file count bounded.
3. **You have an index on (a, b). Does `WHERE b = ?` use it?** Not for seeking, because of the leftmost-prefix rule: the index is sorted by `a` first. Some engines can do a skip scan or full index scan, but generally you need an index starting with `b`.
4. **What is a covering index and why does it help?** An index containing every column the query reads, so the engine never touches the table rows: fewer random I/Os and often a large speed-up for hot queries.
5. **When does adding an index hurt?** On write-heavy tables (every write updates every index), for low-selectivity columns the planner will not use, when the index set exceeds memory and causes cache churn, and during creation on a live table if built with locking DDL.
6. **What is write amplification and why does it matter on SSDs?** Bytes physically written divided by bytes logically written. High amplification consumes disk bandwidth and SSD endurance; leveled compaction and B-tree page rewrites both cause it.
7. **How does full-text search differ from a B-tree index?** It tokenises text into terms and maps each term to posting lists of documents, supporting boolean, phrase and relevance-ranked queries that a sorted B-tree cannot answer.
8. **Why does a tombstone-heavy Cassandra table get slow?** Reads must skip every tombstone in the scanned range until compaction (after `gc_grace_seconds`) purges them; model with TTLs and time-window compaction instead of frequent deletes.

## Cheat sheet
- B-tree: pages, update in place, 3–4 levels, stable reads, random writes. LSM: WAL + memtable + SSTables + compaction, sequential writes, Bloom filters for reads.
- Amplification triangle: read vs write vs space; pick per workload.
- Compaction: size-tiered (writes), leveled (reads/space), time-window (TTL time-series).
- Composite index: equality columns first, then the range/sort column; leftmost prefix.
- Covering (`INCLUDE`), partial (`WHERE`), expression, GIN (JSON/arrays/text), GiST (geo, ranges), BRIN (huge append tables).
- Clustered PK: short and sequential (UUID v7, Snowflake).
- Verify with `EXPLAIN ANALYZE`; compare estimated vs actual rows.
- Inverted index = term to posting list; Lucene segments merge like LSM.

=== hld-replication | HLD | Replication: leader-follower, multi-leader and leaderless ===
Replication keeps copies of the same data on several machines to survive failures, serve more reads and put data closer to users. The hard part is not copying bytes but handling change: deciding who accepts writes, how fast followers catch up, what readers see in between, and what happens when the leader dies. This chapter covers the three architectures (single-leader, multi-leader, leaderless), synchronous versus asynchronous trade-offs, replication-lag anomalies, failover and split brain, conflict resolution, quorums and CDC.

## Why replicate
- **Availability and durability:** survive the loss of a disk, node, zone or region.
- **Read scaling:** spread reads across replicas.
- **Latency:** serve users from a nearby replica.
- **Workload isolation:** run analytics or backups on a replica, not the primary.

Replication is not a backup: a bad `DELETE` replicates to every copy within milliseconds. You still need snapshots and point-in-time recovery.

## What gets shipped
| Method | What travels | Notes |
|---|---|---|
| Statement-based | The SQL statement | Breaks on non-determinism (`now()`, `rand()`, auto-increment races); mostly historical |
| Physical / WAL shipping | Low-level page or byte changes | Exact copy; replicas must run the same engine version; whole-cluster only (Postgres streaming replication) |
| Logical / row-based | "Row with PK 42 in table orders changed to ..." | Version independent, filterable by table, readable by other systems: the basis of CDC (MySQL binlog ROW format, Postgres logical decoding) |
| Trigger / application-level | Custom code | Flexible but slow and error prone |

## Single-leader (leader-follower, primary-replica)
One node, the leader, accepts all writes. It appends to its log and streams the log to followers, which apply changes in the same order. Reads can go to the leader or to followers.

```
             writes
 clients ---------------> [ Leader ] --- replication log ---> [ Follower 1 ]
    |                                \--------------------> [ Follower 2 ]
    +--- reads (may be stale) --------------------------------^
```

### Synchronous, asynchronous, semi-synchronous
| Mode | Leader acknowledges the client when | On leader loss | Write latency | Availability |
|---|---|---|---|---|
| **Asynchronous** | Its own log is durable | Recent writes can be lost | Lowest | Writes continue even if all followers are down |
| **Synchronous** (all followers) | Every follower has the write | No loss | Slowest follower dictates latency | Any follower failure blocks writes |
| **Semi-synchronous** (one or a quorum) | At least one / a quorum of followers have it | No loss if that follower survives | One round trip to the fastest follower(s) | Tolerates some follower failures |

In practice: MySQL semi-sync (`rpl_semi_sync_master_wait_for_slave_count`), Postgres `synchronous_standby_names = 'ANY 1 (s1, s2)'`, and consensus-replicated systems (Spanner, CockroachDB, etcd, Kafka with `acks=all` and `min.insync.replicas=2`), which wait for a majority or an in-sync set. A common production setup is one synchronous standby in another zone of the same region plus asynchronous replicas elsewhere.

### Adding a new follower
1. Take a consistent snapshot of the leader tied to a log position (Postgres LSN, MySQL GTID set).
2. Copy the snapshot to the new node.
3. Stream the log from that position until caught up.

## Replication lag and its anomalies
With asynchronous followers, a follower may be milliseconds or minutes behind. The system is eventually consistent, and three user-visible anomalies appear.

### 1. Read-your-writes (read-after-write)
A user updates their profile, the page reloads from a lagging follower, and the old value appears. The user thinks the save failed.

Fixes:
- Read the user's own data (or anything they edited in the last N seconds) from the leader.
- Track the write's log position and route the read to a replica that has applied at least that position (or wait until it has).
- Sticky routing to the leader for a session after a write.

### 2. Monotonic reads
A user refreshes twice; the first read hits an up-to-date replica, the second a lagging one. A comment appears, then disappears, and time seems to run backwards.

Fix: pin each user to one replica (hash the user ID), or carry a "last seen position" token and never read from a replica behind it.

### 3. Consistent prefix reads
Causally related writes are seen out of order: an observer sees the answer to a question before the question, because the two writes landed on different partitions with different lag.

Fix: write causally related data to the same partition (one conversation, one partition), or track causal dependencies (version vectors, hybrid logical clocks).

```java
// Read-your-writes using a log-position token (illustrative)
public Profile updateProfile(long userId, ProfileUpdate u) {
    long lsn = primaryDao.updateAndReturnLsn(userId, u);   // e.g. pg_current_wal_lsn()
    session.setAttribute("minLsn", lsn);
    return primaryDao.find(userId);
}

public Profile getProfile(long userId) {
    Long minLsn = (Long) session.getAttribute("minLsn");
    DataSource ds = (minLsn == null) ? replicaRouter.any()
                                     : replicaRouter.anyCaughtUpTo(minLsn).orElse(primary);
    return dao(ds).find(userId);
}
```

In Spring, the common simpler pattern is an `AbstractRoutingDataSource` that routes `@Transactional(readOnly = true)` to replicas and everything else to the primary, plus a rule that reads immediately after a write go to the primary.

## Failover
When the leader dies, a follower must be promoted.

1. **Detect** failure, usually by missed heartbeats over a timeout (too short causes needless failovers under load; too long extends downtime).
2. **Choose** a new leader: the follower with the most up-to-date log, ideally decided via a consensus system (Patroni with etcd, Orchestrator for MySQL, RDS/Aurora managed failover).
3. **Reconfigure:** clients and other followers point to the new leader (DNS, virtual IP, a proxy such as PgBouncer/ProxySQL/HAProxy, or service discovery).
4. **Demote** the old leader when it returns so it rejoins as a follower, discarding any writes it never replicated.

### What goes wrong
- **Lost writes:** with async replication, writes the old leader acknowledged but did not ship are gone. If those writes had side effects elsewhere (IDs cached in Redis, emails sent), the system becomes inconsistent: a promoted replica can reuse auto-increment IDs that other systems already associate with different rows.
- **Split brain:** a network partition makes the old leader *think* it is still leader while a new one is elected. Both accept writes and data diverges.
- **Wrong timeout:** a GC pause or overloaded network triggers failover of a healthy leader, and the cluster flaps.

### Fencing
You cannot rely on the old leader to know it has been deposed (it may be paused mid-write). Protect the system instead:
- **Fencing tokens / epochs:** every new leader gets a monotonically increasing term number. Storage and downstream services reject requests carrying an older term.
- **STONITH** ("shoot the other node in the head"): power off or network-isolate the old node via the hypervisor or a fencing device.
- **Leases:** the leader holds a time-limited lease from a coordinator and stops accepting writes when it cannot renew it. This relies on bounded clock drift and pauses, so combine it with tokens.
- **Quorum requirement:** a leader can only commit with acknowledgements from a majority, so an old leader on the minority side of a partition cannot make progress (this is how Raft avoids split brain).

## Multi-leader replication
Several nodes accept writes, typically one leader per data centre, replicating to each other asynchronously.

```
   DC us-east                       DC eu-west
 [ Leader A ] <--- async, both ---> [ Leader B ]
   |   |                               |   |
followers                            followers
```

Uses: multi-region active-active with local write latency; offline-capable clients (each phone is effectively a leader: calendar and notes apps); collaborative editing (each user's document copy is a leader).

The cost is **write conflicts**: two leaders accept different changes to the same record concurrently, and you only find out later.

### Conflict handling
| Approach | How | Trade-off |
|---|---|---|
| **Avoid conflicts** | Route all writes for a record to one "home" leader (each user homed in a region) | Simplest and most common; breaks down when the home DC fails over |
| **Last-write-wins (LWW)** | Attach a timestamp; highest wins | Simple, but silently drops concurrent writes, and clock skew can let an older write win |
| **Version vectors + siblings** | Detect concurrency; keep both values and let the app or user merge (Riak, the Dynamo shopping cart) | Correct, but pushes complexity into the application |
| **CRDTs** | Data types whose merge is commutative, associative and idempotent, so replicas converge automatically | Limited to types that have a CRDT; metadata overhead |
| **Operational transform** | Transform concurrent edits against each other (Google Docs) | Complex; usually needs a central server |
| **Custom merge logic** | On-write or on-read handlers | Domain specific and hard to test |

### CRDT examples
- **G-Counter:** each replica keeps its own count; value = sum; merge = element-wise max. Good for likes and views.
- **PN-Counter:** two G-Counters (increments and decrements).
- **OR-Set (observed-remove set):** adds carry unique tags; a remove deletes only the tags it has seen, so a concurrent add wins. Good for shopping carts and group membership.
- **LWW-Register / LWW-Map:** per-field last-writer-wins.
- **Sequence CRDTs** (RGA, Yjs, Automerge): collaborative text editing.

```java
// G-Counter CRDT: merge is element-wise max, so replicas converge regardless of order
public final class GCounter {
    private final Map<String, Long> counts = new HashMap<>();
    private final String replicaId;
    public GCounter(String replicaId) { this.replicaId = replicaId; }

    public void increment() { counts.merge(replicaId, 1L, Long::sum); }
    public long value() { return counts.values().stream().mapToLong(Long::longValue).sum(); }
    public void merge(GCounter other) {
        other.counts.forEach((k, v) -> counts.merge(k, v, Math::max));
    }
}
```

Real systems: Redis Enterprise active-active (CRDT-based), Riak data types, DynamoDB global tables (LWW per item), Cassandra multi-DC (LWW per cell), CouchDB/PouchDB (revision trees with exposed conflicts), MySQL Group Replication multi-primary (certification-based conflict detection).

## Leaderless replication (Dynamo style)
Any replica accepts reads and writes. The client, or a coordinator node acting for it, sends each request to several replicas in parallel. Used by the original Amazon Dynamo design (2007 paper), Cassandra, ScyllaDB, Riak and Voldemort. (DynamoDB, despite the name, uses leader-based Multi-Paxos replication per partition.)

### Quorums: N, W, R
- **N:** number of replicas for each key (replication factor), typically 3.
- **W:** replicas that must acknowledge a write.
- **R:** replicas that must answer a read.
- If **W + R > N**, the read set and the write set overlap in at least one replica, so a read sees the latest acknowledged write under normal conditions.

| N, W, R | Property |
|---|---|
| 3, 2, 2 | Classic quorum; tolerates one node down for both reads and writes |
| 3, 3, 1 | Fast reads; writes fail if any replica is down |
| 3, 1, 3 | Fast writes; reads need all replicas |
| 3, 1, 1 | Fastest and most available; no overlap, eventual consistency only |

Each value carries a version (a timestamp in Cassandra, a version vector in Riak), so the reader picks the newest response.

Quorums are not linearizable on their own. Edge cases: a write that succeeded on fewer than W nodes is reported as failed but not rolled back, so later reads may or may not see it; concurrent writes under LWW lose data; a replica restored from an old copy shrinks the effective overlap; and sloppy quorums break the overlap entirely.

### Sloppy quorum and hinted handoff
If some of the N home replicas are unreachable, a **sloppy quorum** lets the write land on other healthy nodes so it still collects W acknowledgements. Those stand-in nodes store a **hint** ("this belongs to node C") and forward the data when C returns: **hinted handoff**. Write availability goes up, but W + R > N no longer guarantees reading the latest value until hints are delivered.

### Repairing divergence
- **Read repair:** a read collects R responses; if some are stale, the coordinator writes the newest value back to them. This fixes frequently read keys.
- **Anti-entropy:** a background process compares replicas and copies missing data. Comparing every key would be too expensive, so replicas build **Merkle trees** (hash trees) over key ranges.

```
             root = H(H12 + H34)
            /                  \
     H12 = H(H1+H2)      H34 = H(H3+H4)
       /     \             /      \
     H1      H2          H3       H4      <- hash of each key range's data
```

Two replicas compare root hashes; if equal, they are in sync. If not, they descend only into subtrees that differ, so finding a few changed keys among billions takes O(log n) hash comparisons plus transfer of the differing ranges. Cassandra runs this as `nodetool repair`, which must complete within `gc_grace_seconds` (default 10 days), otherwise a replica that missed a tombstone can resurrect deleted data.

### Cassandra example
```sql
CREATE KEYSPACE chat WITH replication =
  {'class': 'NetworkTopologyStrategy', 'us_east': 3, 'eu_west': 3};

-- Per-request consistency level (cqlsh syntax; drivers set it per statement)
CONSISTENCY LOCAL_QUORUM;   -- 2 of 3 in the local DC: strong within the DC, low latency
INSERT INTO messages (conversation_id, message_id, body) VALUES (?, ?, ?);
SELECT * FROM messages WHERE conversation_id = ? LIMIT 50;
```

With `LOCAL_QUORUM` for both reads and writes, W + R = 4 > 3 within a data centre, while the remote DC is updated asynchronously.

## Change data capture (CDC) and logical replication
CDC turns the database's replication log into an event stream other systems can consume. Instead of dual writes (write to the DB, then publish to Kafka, which can fail halfway), you write only to the database and a connector tails the log.

```
Postgres (wal_level=logical) --logical decoding--> Debezium --> Kafka topic orders.cdc
                                                                   |-> Elasticsearch (search)
                                                                   |-> Redis (cache invalidation)
                                                                   |-> Data warehouse
```

- **Postgres:** logical replication slots plus publications/subscriptions (native table-level replication between clusters), or the `pgoutput` plugin for Debezium. Beware: an abandoned slot makes the primary retain WAL forever and can fill its disk.
- **MySQL:** row-based binlog with GTIDs; Debezium, Maxwell, Canal.
- **MongoDB:** change streams over the oplog. **DynamoDB:** Streams. **Cassandra:** a CDC commit-log directory.
- **Outbox pattern:** write the business row and an `outbox` event row in one local transaction; CDC publishes the outbox row. This gives atomic "update state and emit event" without distributed transactions.

## Comparing the three architectures
| | Single-leader | Multi-leader | Leaderless |
|---|---|---|---|
| Write path | One node | One per region/device | Any W of N replicas |
| Conflicts | None (serialised at the leader) | Yes, must be resolved | Yes (concurrent writes), resolved by versions/LWW |
| Write availability | Lost during failover | High (regions independent) | High (sloppy quorum) |
| Consistency achievable | Strong on the leader; lag on followers | Eventual | Tunable via R/W; not linearizable by default |
| Multi-region write latency | Remote writes cross regions | Local | Local with LOCAL_QUORUM |
| Examples | Postgres, MySQL, MongoDB replica sets, Redis, Kafka partitions | DynamoDB global tables, CouchDB, Redis active-active | Cassandra, ScyllaDB, Riak, Dynamo |

## How it shows up in interview problems
- **E-commerce / payments:** single leader per shard with semi-sync or consensus replication so an acknowledged payment is never lost; read replicas for catalog browsing; read-your-writes for order status right after checkout.
- **Chat / messaging:** Cassandra with RF 3 and `LOCAL_QUORUM`; per-conversation ordering via server-assigned sequence numbers rather than wall clocks.
- **News feed / likes:** replica reads are fine; like counts can be CRDT counters or asynchronously aggregated.
- **Distributed cache:** Redis primary-replica with Sentinel or Cluster failover; accept a small window of lost writes.
- **Multi-region user profiles:** home each user in a region (conflict avoidance) with async replication for reads elsewhere.
- **Collaborative editing:** CRDTs or OT.
- **Search and analytics:** CDC from the source of truth into Elasticsearch and the warehouse.
- **Seat reservation / inventory:** never multi-leader LWW for the authoritative count; use a single leader or a consensus store.

## Common pitfalls
- Reading from replicas without thinking about read-your-writes, so users see their own changes vanish.
- Treating async replicas as a durable copy during failover.
- Automatic failover with aggressive timeouts (flapping), or without fencing (split brain).
- LWW in multi-leader setups for data that cannot tolerate silently lost updates (balances, inventory).
- Believing W + R > N gives linearizability.
- Not running repair in Cassandra, so deleted data resurrects.
- Dual writes to the DB and a message broker instead of outbox plus CDC.
- An unused Postgres replication slot filling the primary's disk.

## Interview questions
1. **Synchronous or asynchronous replication for a payments database?** Semi-synchronous (or quorum/consensus) so an acknowledged write exists on at least two nodes. Fully synchronous to every replica turns any replica failure into a write outage; fully async can lose acknowledged payments on failover.
2. **A user updates their profile and immediately sees the old value. Why, and how do you fix it?** The read hit a lagging replica. Route the user's own reads to the leader for a short window after a write, or track the write's log position and read only from replicas that have caught up to it.
3. **What is split brain and how do you prevent it?** Two nodes both believe they are leader and accept conflicting writes, usually after a partition. Prevent it with majority-based election, fencing tokens checked by storage, leases and STONITH.
4. **How does Cassandra stay consistent without a leader?** Quorum reads and writes (W + R > N) with timestamps, plus hinted handoff for temporary failures, read repair for hot keys and Merkle-tree anti-entropy repair for everything else.
5. **What is a sloppy quorum?** Writes are accepted by any reachable nodes, not only the key's home replicas, to stay available; the stand-ins forward data later via hinted handoff. Reads may miss the write until then.
6. **How do you resolve conflicts in active-active multi-region?** Prefer avoiding them by homing each record in one region; otherwise LWW where loss is acceptable, CRDTs for counters and sets, or keep siblings and merge in the application.
7. **Why CDC instead of publishing events from application code?** Dual writes can partially fail and leave the DB and the stream inconsistent; CDC derives events from the committed log (often via an outbox table), so every committed change is published, in commit order.
8. **Is replication a backup?** No. Mistakes and corruption replicate instantly; you still need snapshots and point-in-time recovery.

## Cheat sheet
- Single-leader: simple, no conflicts, follower lag, failover risk. Multi-leader: local writes, conflicts. Leaderless: quorums, high availability, versioning.
- Sync = no loss, slow and fragile; async = fast, can lose writes; semi-sync = practical default for critical data.
- Lag anomalies: read-your-writes (leader or LSN-aware reads), monotonic reads (sticky replica), consistent prefix (same partition / causal tracking).
- Failover: detect, elect most up-to-date, redirect, demote; fence with epochs/tokens and STONITH.
- Conflicts: avoid (home region) > CRDT > siblings > LWW (lossy).
- Quorum: W + R > N overlap; N=3, W=2, R=2 classic; not linearizable alone.
- Repair: hinted handoff, read repair, Merkle-tree anti-entropy (within gc_grace).
- CDC: logical decoding/binlog to Debezium to Kafka; outbox pattern; watch replication slots.
