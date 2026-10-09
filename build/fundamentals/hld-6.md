=== hld-sharding | HLD | Partitioning (sharding) ===
When one machine can no longer hold the data or absorb the write rate, you split the dataset into **partitions** (shards) and spread them across nodes. Replication copies the same data; partitioning divides different data. The quality of a sharded design depends almost entirely on the partition key: it decides whether load spreads evenly, which queries stay on one shard, and how painful growth will be. This chapter covers partitioning schemes, choosing keys, hot spots, secondary indexes, cross-shard queries, rebalancing and a practical resharding playbook.

## Core concepts
- **Partition / shard:** a subset of the data owned by one node (or one replica group). Each record belongs to exactly one partition.
- **Partition key (shard key):** the attribute used to decide the partition, e.g. `user_id`, `tenant_id`, `conversation_id`.
- **Router:** the component that maps key to partition to node. It can live in the client library (Cassandra drivers, Redis Cluster clients), in a proxy (Vitess VTGate, MongoDB mongos, Citus coordinator), or in a metadata service the clients consult.
- **Skew:** some partitions receive more data or traffic than others. A partition that is much busier than the rest is a **hot spot**.
- **Sharding is combined with replication:** each partition usually has a leader and followers (or N leaderless replicas), and one physical node hosts many partitions.

```
               router (key -> partition -> node)
              /             |              \
   Node A                Node B               Node C
   P1 (leader)           P2 (leader)          P3 (leader)
   P3 (follower)         P1 (follower)        P2 (follower)
```

### When to shard
Sharding adds permanent complexity, so exhaust simpler options first: vertical scaling (a large modern server handles tens of thousands of transactions per second and tens of TB), read replicas, caching, archiving cold data, and table partitioning inside one database. Shard when the **write throughput**, **data size** or **working set** clearly exceeds one node, or when you need data residency per region. In interviews, do the back-of-envelope maths and say so: "6 TB per year and 40 K writes per second at peak, so we shard by user_id."

## Partitioning schemes
### Range partitioning
Each partition owns a contiguous key range: A–F, G–M, and so on, or timestamps by month. Used by HBase, Bigtable, Spanner, CockroachDB (ranges of ~512 MB), TiKV, MongoDB ranged sharding.

- Efficient range scans: "orders for user 42 between March and May" hits one or two partitions.
- Partitions can split dynamically when they grow.
- **Risk:** sequential keys (timestamps, auto-increment IDs) send every new write to the last partition, a hot tail. Mitigate by prefixing with a high-cardinality component (`sensor_id, timestamp`) rather than leading with time.

### Hash partitioning
Apply a hash to the key and assign hash ranges (or hash mod a fixed number of slots) to partitions. Used by Cassandra, DynamoDB, Redis Cluster, MongoDB hashed sharding, Citus, Vitess (default vindex).

- Spreads keys uniformly, even sequential ones.
- **Loses range queries** across keys: adjacent keys land on different partitions.
- Compound keys recover locality: Cassandra hashes only the partition key and keeps rows sorted by clustering columns within it, so `PRIMARY KEY ((user_id), created_at)` gives even distribution across users and ordered range scans within one user.

### Directory (lookup) partitioning
A mapping service stores `key -> shard` explicitly (or `tenant -> shard`).

- Maximum flexibility: move a single tenant, place a big customer on dedicated hardware, rebalance anything.
- Costs: an extra lookup (cache it aggressively), and the directory must be highly available and consistent; it becomes a critical dependency.
- Common for multi-tenant SaaS (Slack, Shopify-style "pods" or "cells"), and in Vitess as a lookup vindex.

### Geographic partitioning
Partition by region or country: EU users' data stays in EU shards. Driven by latency and data-residency law (GDPR, India's DPDP). Often combined with another scheme inside each region. Cross-region users (travelling, moving) need a migration path.

### Comparison
| Scheme | Distribution | Range queries | Rebalancing | Typical use |
|---|---|---|---|---|
| Range | Can be skewed (hot tail) | Excellent | Split/merge ranges | Time-ordered data, ordered scans, NewSQL |
| Hash | Even | Only within a partition (compound key) | Move hash slots/vnodes | KV workloads, user data, sessions |
| Directory | As good as your placement | Depends | Move individual keys/tenants | Multi-tenant SaaS, uneven tenants |
| Geo | By population | Within region | Move users between regions | Residency, latency |

## Choosing a shard key
A good key has:
1. **High cardinality:** many distinct values (user_id, not country).
2. **Even access frequency:** no single value dominates traffic.
3. **Query alignment:** the most frequent and latency-critical queries include the key, so they hit one shard.
4. **Transaction alignment:** data changed together lives together (an order and its line items share `customer_id` or `order_id`).
5. **Stability:** it does not change. Changing a shard key value means moving the row.

Worked examples:
| System | Good key | Why | Bad key |
|---|---|---|---|
| Chat | `conversation_id` (plus time bucket) | All messages of a conversation in one partition, ordered | `message_id` (history scattered) |
| E-commerce orders | `customer_id` | "My orders" is single-shard; checkout touches one customer | `order_date` (hot tail) |
| Multi-tenant SaaS | `tenant_id` | Tenant isolation, joins stay local | `user_id` if most queries are tenant-wide |
| URL shortener | `short_code` (hash) | Point lookups only, even spread | creation time |
| Metrics | `(metric_id, time_bucket)` | Spread across metrics and time, range within bucket | `timestamp` alone |
| Ride hailing | `city_id` / geo cell | Matching queries are local | `driver_id` for proximity search |

## Hot keys and the celebrity problem
Even with a perfect hash, one key can be hot: a celebrity with 100 million followers, a viral tweet's like counter, a flash-sale product, a single huge tenant. Hashing cannot split a single key, so you need application-level techniques.

- **Key salting / write sharding:** append a suffix `0..N-1` to spread writes for one logical key across N partitions; reads fan out to all N and combine.

```java
// Spread writes for a hot counter across 16 sub-keys; read sums them
private static final int SALT = 16;

public void incrementLikes(String postId) {
    int bucket = ThreadLocalRandom.current().nextInt(SALT);
    redis.opsForValue().increment("likes:" + postId + ":" + bucket);
}

public long getLikes(String postId) {
    List<String> keys = IntStream.range(0, SALT)
        .mapToObj(i -> "likes:" + postId + ":" + i).toList();
    return redis.opsForValue().multiGet(keys).stream()
        .filter(Objects::nonNull).mapToLong(Long::parseLong).sum();
}
```

- **Salt only the hot keys:** detect heavy hitters (count-min sketch, per-key metrics) and salt them dynamically, keeping normal keys cheap to read.
- **Caching and request coalescing** for read-hot keys: replicate the hot value to many cache nodes or to an in-process near cache.
- **Aggregate before writing:** buffer increments in memory or a stream processor and flush every second.
- **Special handling for celebrities in feeds:** fan-out-on-write for normal users, fan-out-on-read for celebrity posts (merged at read time).
- **Dedicated shards** for whale tenants via directory partitioning.
- **Time bucketing** to stop one partition growing forever (`(device_id, day)`).

DynamoDB has "adaptive capacity" and split-for-heat that isolates hot items onto their own partitions, but a single item is still limited (about 1,000 write units per second per partition), so salting remains necessary for truly hot items.

## Secondary indexes in a sharded database
Data is partitioned by the primary key, but you also query by other attributes ("cars with colour = red", "orders by status"). Two designs:

### Local (document-partitioned) index
Each partition indexes only its own data.
- Writes are cheap: update the index on the same shard, in the same transaction.
- Reads by the secondary attribute must **scatter-gather** across all partitions and merge.
- Used by: MongoDB, Elasticsearch, Cassandra secondary indexes, DynamoDB **local** secondary indexes (same partition key, different sort key).

### Global (term-partitioned) index
The index itself is partitioned by the indexed value: all `colour=red` entries live on one index partition.
- Reads by the attribute hit one index partition.
- Writes touch the data shard plus one or more index shards: a distributed write, usually updated **asynchronously**, so the index is eventually consistent.
- Used by: DynamoDB **global** secondary indexes (async), Vitess lookup vindexes, Citus/Spanner/CockroachDB global indexes (kept consistent with distributed transactions, at a write-latency cost).

| | Local index | Global index |
|---|---|---|
| Write cost | Single shard | Multi-shard (async or distributed txn) |
| Read by indexed attribute | All shards (scatter-gather) | One index shard (+ fetch) |
| Consistency | Same as data | Often eventual |
| Good when | Queries also filter on the shard key, or rare | Frequent lookups by that attribute |

A common alternative in practice: maintain a separate lookup table or search index (Elasticsearch fed by CDC) for secondary access patterns.

## Cross-shard queries and transactions
### Scatter-gather
The router sends the query to every shard, waits for all, and merges (sort, top-K, aggregate).
- Latency is governed by the **slowest shard** (tail latency amplification: with 100 shards, a 1-in-100 slow response hits most queries).
- Throughput does not scale: every query costs every shard.
- Pagination and `ORDER BY ... LIMIT` need per-shard top-K then a global merge.
- Mitigate with hedged requests, timeouts with partial results, pre-aggregated views, or a search/OLAP store for broad queries.

### Joins
- **Co-location:** shard related tables on the same key (`orders` and `order_items` by `customer_id`) so joins stay local. Citus calls these co-located distributed tables.
- **Reference (broadcast) tables:** small, rarely changing tables (countries, currencies, product categories) replicated to every shard.
- **Denormalise** into the shard's aggregate, or join in the application.

### Transactions
Single-shard transactions are cheap; multi-shard ones need two-phase commit (Vitess and Citus support it with caveats), a distributed SQL engine (Spanner, CockroachDB), or a saga with compensations. Design the key so that the critical transactions are single-shard: for payments between two accounts on different shards, the usual answer is a ledger with a saga or an idempotent two-step transfer rather than a cross-shard lock.

## Rebalancing
Over time nodes are added, removed or overloaded, and partitions must move. Goals: keep load even, move as little data as possible, keep serving during the move.

### Why not hash mod N
`partition = hash(key) % N` moves almost every key when N changes: going from 4 to 5 nodes relocates about 80% of the data (see the consistent hashing chapter). Never tie the key mapping directly to the node count.

### Strategy 1: fixed number of partitions
Create many more partitions than nodes up front (e.g. 1,024 for 10 nodes). Keys map to partitions with a fixed function; partitions map to nodes through a small table. Adding a node steals whole partitions from others; only the partition-to-node table changes.
- Examples: Redis Cluster (16,384 hash slots), Couchbase (1,024 vBuckets), Riak (ring of fixed partitions), Elasticsearch (fixed primary shard count per index), Kafka (fixed partitions per topic; increasing them changes key-to-partition mapping).
- Choose the count carefully: too few limits future scale-out and makes partitions huge; too many adds overhead. Elasticsearch fixes it at index creation, so you reindex or use the split API.

### Strategy 2: dynamic splitting
Start with few partitions; when one exceeds a size or load threshold, split it in two; merge small neighbours.
- Examples: HBase regions, Bigtable tablets, MongoDB chunks (split and moved by the balancer), CockroachDB/TiKV ranges, DynamoDB partitions (split on size over 10 GB or on throughput).
- Adapts to data volume and to skew; with an empty database, pre-split to avoid all writes hitting one partition initially.

### Strategy 3: partitions proportional to nodes
Each node owns a fixed number of partitions (Cassandra vnodes / tokens); a new node splits random existing ranges and takes half. This is consistent hashing with virtual nodes.

### Automatic vs manual
Fully automatic rebalancing can turn a slow node into a cascade (it looks dead, data is moved, the move overloads others). Many operators prefer the system to propose moves and a human or a rate-limited controller to apply them. Always throttle data movement.

## Real-world systems
- **Vitess (MySQL, used by YouTube, Slack, GitHub):** keyspaces split into shards by keyspace ID ranges; **vindexes** map column values to keyspace IDs (hash, lookup, custom). VTGate routes queries, scatters when needed. Resharding uses VReplication: copy, stream changes, verify (VDiff), then switch reads and writes with a brief write pause.
- **Citus (Postgres extension):** distributed tables hashed on a distribution column, reference tables on every node, co-location groups for local joins, a coordinator planning distributed queries; shard rebalancer moves shards online using logical replication.
- **DynamoDB:** partition key hashed to partitions; each partition about 10 GB and roughly 3,000 read / 1,000 write units per second; automatic splitting by size and heat; LSIs (local, strongly consistent, 10 GB per partition key limit) and GSIs (global, eventually consistent).
- **MongoDB:** `sh.shardCollection("db.orders", { customerId: "hashed" })` or ranged keys; data in chunks moved by the balancer; `mongos` routers and config servers holding metadata; targeted vs broadcast queries; reshardCollection (5.0+) for changing the key online.
- **Cassandra:** Murmur3 hash of the partition key on a token ring with vnodes; replication along the ring.
- **Spanner / CockroachDB:** range partitioning with automatic split, merge and load-based rebalancing; each range replicated with Paxos/Raft.

## Resharding playbook
Changing shard count or key on a live system, without downtime:

1. **Plan:** choose the new key/layout; estimate data per shard and growth for 2–3 years; prefer a layout with many logical shards (so the next expansion is a move, not a re-hash).
2. **Provision** target shards and make the router aware of both old and new mappings.
3. **Backfill:** copy existing data to the new layout in throttled batches (snapshot at a known log position).
4. **Catch up:** stream ongoing changes from the source via CDC (binlog, logical replication, VReplication) until lag is near zero. Alternatively, dual-write from the application, but CDC avoids partial-failure inconsistencies.
5. **Verify:** row counts, checksums per key range, shadow reads comparing old and new results.
6. **Cut over reads** gradually (by percentage or tenant), watching error rates and latency.
7. **Cut over writes:** a brief write freeze or a fenced switch so no write lands on the old shard after the switch; keep reverse replication running to allow rollback.
8. **Clean up:** stop reverse replication after a bake period, delete the old copies, update runbooks.

## How it shows up in interview problems
- **URL shortener:** hash-shard by short code; 7-character codes and billions of rows fit in a handful of shards; directory not needed.
- **Chat (WhatsApp/Messenger):** shard messages by `conversation_id` with time buckets; user inboxes by `user_id`.
- **News feed / Twitter:** timelines sharded by `user_id`; celebrity problem solved by hybrid fan-out.
- **Distributed cache:** key hashed onto nodes via consistent hashing or hash slots.
- **Rate limiter:** counters sharded by API key; hot tenants get local pre-aggregation.
- **Uber / maps:** geo partitioning by city then cell; split hot cells (airports).
- **E-commerce:** orders by `customer_id`, catalog by `product_id`, inventory per `sku` with flash-sale hot keys handled by token buckets or pre-allocated stock shards.
- **Metrics / logging:** `(metric, time_bucket)` or time-partitioned indices (one index per day) that are dropped wholesale for retention.
- **Payments:** shard ledgers by account; cross-account transfers via saga or a distributed SQL store.

## Common pitfalls
- Sharding too early, or sharding before measuring.
- A low-cardinality or monotonically increasing shard key.
- Choosing a key that matches storage but not the critical queries, so everything becomes scatter-gather.
- Ignoring the hot-key problem until a celebrity or flash sale happens.
- `hash % N` mapping that forces a full reshuffle on growth.
- Global secondary indexes assumed to be strongly consistent.
- Cross-shard transactions on the hot path.
- Unbounded partitions (a Cassandra partition growing to GBs) because the key lacked a time bucket.
- Auto-increment IDs per shard colliding: use globally unique IDs (Snowflake, UUID v7).

## Interview questions
1. **Range or hash partitioning for time-series sensor data?** Hash (or compound) on `sensor_id` with a time bucket, then range within the partition. Pure time-range partitioning puts all current writes on one hot partition.
2. **How do you handle a celebrity account whose posts get millions of likes per minute?** Salt the counter key across N sub-keys and sum on read, aggregate increments in memory or a stream before writing, cache reads, and use fan-out-on-read for that author's posts in feeds.
3. **Local vs global secondary indexes?** Local indexes are updated with the data on the same shard but queries must scatter-gather; global indexes are partitioned by the indexed term so reads are targeted, but writes span shards and are usually eventually consistent.
4. **Why is hash mod N a bad idea?** Changing N remaps most keys (about 80% when going from 4 to 5 nodes), causing massive data movement and cache misses. Use a fixed number of logical partitions or consistent hashing.
5. **How would you reshard a live MySQL database?** Create target shards, backfill a snapshot, stream changes via binlog/CDC, verify with checksums and shadow reads, shift reads, then switch writes with a brief fenced cut-over, keeping reverse replication for rollback (Vitess automates this).
6. **What makes a good shard key for a multi-tenant SaaS?** Usually `tenant_id`: high cardinality, aligns with nearly every query and transaction, isolates tenants; use a directory to place very large tenants on dedicated shards.
7. **How do you run "top 10 products by sales" across 64 shards?** Each shard computes its local top-K (or partial aggregates) and the router merges; better, maintain a pre-aggregated view in a stream processor or OLAP store rather than querying OLTP shards.
8. **How many logical partitions should you create up front?** Enough to cover several years of growth with partitions of manageable size (often 10–100x the initial node count), so scaling out is moving partitions rather than re-hashing keys.

## Cheat sheet
- Shard when write throughput, size or working set exceeds one node; try replicas, caching and archiving first.
- Range: scans, hot tail risk. Hash: even, no cross-key ranges. Directory: flexible, extra lookup. Geo: residency and latency.
- Shard key: high cardinality, even access, matches main queries and transactions, immutable.
- Hot keys: salting, heavy-hitter detection, caching, pre-aggregation, dedicated shards, hybrid fan-out.
- Secondary indexes: local (cheap writes, scatter reads) vs global (targeted reads, async/distributed writes).
- Cross-shard: co-locate, reference tables, denormalise, saga instead of 2PC.
- Rebalancing: fixed many partitions (Redis 16,384 slots) or dynamic split (HBase, Mongo, DynamoDB); never hash % N.
- Resharding: backfill, CDC catch-up, verify, shift reads, fenced write cut-over, rollback path.

=== hld-consistent-hashing | HLD | Consistent hashing ===
Consistent hashing maps keys to nodes so that when a node joins or leaves, only a small fraction of keys, roughly 1/N, has to move, instead of nearly all of them. It is the placement algorithm behind Dynamo-style databases, distributed caches and sticky load balancing. This chapter explains why naive modulo hashing fails, how the hash ring and virtual nodes work, replication along the ring, the alternatives (rendezvous hashing, jump consistent hash, bounded loads), and gives a Java implementation you can write in an interview.

## The problem with hash mod N
The obvious placement is `node = hash(key) % N`. It distributes evenly, but adding or removing one node changes N for every key.

Worked numbers: with 4 nodes, keys map as `h % 4`; after adding a fifth node they map as `h % 5`. A key stays put only if `h % 4 == h % 5`. The pattern repeats every lcm(4, 5) = 20 hash values, and within hashes 0..19 only 0, 1, 2 and 3 satisfy it: 4 out of 20. So **80% of keys move**. In general, going from N to N+1 nodes moves about N/(N+1) of keys.

Consequences:
- **Cache:** a cache cluster of 10 nodes becomes 11, and about 91% of lookups miss at once. The database behind it sees a sudden thundering herd and may fall over.
- **Storage:** almost the entire dataset must be copied across the network during a simple expansion.

The ideal is that adding the (N+1)th node moves only about 1/(N+1) of keys, all of them *to the new node*, and none between existing nodes. Consistent hashing achieves that.

## The hash ring
1. Choose a hash function with a large output space, e.g. 0 to 2^32 − 1 or 2^64 − 1, and imagine it bent into a circle.
2. Hash each **node** (by its ID, e.g. `"10.0.0.7:6379"`) to a position on the ring.
3. Hash each **key** to a position on the ring.
4. A key belongs to the **first node clockwise** from its position (its successor), wrapping around at the end.

```
                  0 / 2^32
                     |
          Node A (10) *
                   /      \
   key k3 (95) .              . key k1 (18)
              |                |
  Node D (80) *                * Node B (35)
              |                |
    key k4 (70) .              . key k2 (50)
                   \       /
                    * Node C (60)

  k1 (18) -> B (35)   k2 (50) -> C (60)   k4 (70) -> D (80)   k3 (95) -> wraps -> A (10)
```

### Adding and removing nodes
- **Add node E at position 45:** only keys between B (35) and E (45) move, from C to E. Every other key keeps its node.
- **Remove node C:** only C's keys (35, 60] move, to its successor D.

So each membership change moves about K/N keys, and only between the neighbours involved.

### The uneven-load problem
With only a few nodes at random positions, the arcs between them are very uneven. With N nodes placed randomly, the largest arc is on the order of (ln N)/N of the ring, so one node can own several times the average share. Also, when a node fails, its entire load lands on a single successor, which may then overload: a cascading failure.

## Virtual nodes (vnodes)
Give each physical node many positions on the ring, e.g. 100–256 tokens, by hashing `"nodeA#0"`, `"nodeA#1"`, and so on.

- **Smoother distribution:** each node owns many small arcs, so its total share converges to 1/N. With V vnodes per node, the relative standard deviation of load is roughly 1/sqrt(V): about 10% at 100 vnodes, about 3% at 1,000.
- **Failure spreads out:** a dead node's many small arcs are taken over by many different successors, so the load is shared across the cluster.
- **Heterogeneous hardware:** give a bigger machine proportionally more vnodes (weighting).
- **Cost:** a larger ring table (still tiny: 100 nodes x 256 vnodes = 25,600 entries) and more, smaller ranges to stream and repair.

Cassandra historically used `num_tokens: 256`; Cassandra 4.0 changed the default to 16 with a token allocation algorithm that places tokens deliberately rather than randomly, achieving good balance with fewer ranges (fewer ranges makes repair and streaming cheaper).

## Replication along the ring
To store N replicas, walk clockwise from the key's position and pick the next N **distinct physical nodes** (skipping vnodes of a node already chosen). This list is the key's **preference list**.

- **Rack/zone awareness:** also skip nodes in an already-used rack or availability zone so replicas survive a zone outage (Cassandra `NetworkTopologyStrategy`).
- The first node in the list often acts as the coordinator for that key.
- Sloppy quorum and hinted handoff extend the list past unavailable nodes (see the replication chapter).

## Java implementation (TreeMap ring)
A sorted map gives O(log V) lookup: `ceilingEntry(hash)` finds the successor, and wrapping to `firstEntry()` closes the circle.

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentSkipListMap;

public final class ConsistentHashRing<N> {
    private final ConcurrentSkipListMap<Long, N> ring = new ConcurrentSkipListMap<>();
    private final int virtualNodes;

    public ConsistentHashRing(Collection<N> nodes, int virtualNodes) {
        this.virtualNodes = virtualNodes;
        nodes.forEach(this::addNode);
    }

    public void addNode(N node) {
        for (int i = 0; i < virtualNodes; i++) {
            ring.put(hash(node + "#" + i), node);
        }
    }

    public void removeNode(N node) {
        for (int i = 0; i < virtualNodes; i++) {
            ring.remove(hash(node + "#" + i), node);
        }
    }

    /** Primary owner: first vnode clockwise from the key's hash. */
    public N getNode(String key) {
        if (ring.isEmpty()) throw new IllegalStateException("empty ring");
        Map.Entry<Long, N> e = ring.ceilingEntry(hash(key));
        return (e != null ? e : ring.firstEntry()).getValue();
    }

    /** Preference list: next `replicas` distinct physical nodes clockwise. */
    public List<N> getReplicas(String key, int replicas) {
        LinkedHashSet<N> result = new LinkedHashSet<>();
        long h = hash(key);
        for (N n : ring.tailMap(h, true).values()) {
            if (result.size() == replicas) break;
            result.add(n);
        }
        for (N n : ring.headMap(h, false).values()) {   // wrap around
            if (result.size() == replicas) break;
            result.add(n);
        }
        return new ArrayList<>(result);
    }

    private static long hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8));
            long h = 0;
            for (int i = 0; i < 8; i++) h = (h << 8) | (d[i] & 0xFF);
            return h;   // any well-mixed 64-bit hash works; Murmur3/xxHash are faster
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

Notes for the interview:
- Use a well-distributed hash (Murmur3, xxHash, or MD5 truncated); `String.hashCode()` clusters badly.
- Signed `long` ordering is fine: it is still a total order over the circle.
- `ConcurrentSkipListMap` allows lock-free reads while membership changes; alternatively, build an immutable sorted array and swap it atomically (copy-on-write), which is faster for lookups.
- Hash collisions between vnodes are possible but rare in 64 bits; handle by skipping or re-salting.
- In production, membership comes from a coordinator (gossip in Cassandra, ZooKeeper/etcd, or a config service), and every client must converge on the same ring.

## Alternatives and refinements
### Rendezvous hashing (highest random weight, HRW)
For each key, compute `score = hash(key, node)` for every node and pick the node with the highest score (top N for replicas).
- When a node leaves, only its keys move, each to its own second-best node, so load spreads evenly without any virtual nodes.
- No ring structure to maintain; trivial to implement and naturally supports weights.
- Cost: O(N) per lookup, fine for tens or hundreds of nodes, less so for thousands (hierarchical/skeleton variants fix this).
- Used in: Apache Ignite's `RendezvousAffinityFunction`, GitHub's GLB Director forwarding tables, and many CDN and cache tiers.

```java
<N> N rendezvous(String key, List<N> nodes) {
    N best = null; long bestScore = Long.MIN_VALUE;
    for (N n : nodes) {
        long score = murmur64(key + "|" + n);
        if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
}
```

### Jump consistent hash
Google's 2014 algorithm maps a key to a bucket number 0..N−1 with no memory and near-perfect balance, moving the minimal 1/(N+1) of keys when a bucket is added.

```java
// Lamping & Veach, "A Fast, Minimal Memory, Consistent Hash Algorithm"
static int jumpConsistentHash(long key, int numBuckets) {
    long b = -1, j = 0;
    while (j < numBuckets) {
        b = j;
        key = key * 2862933555777941757L + 1;
        j = (long) ((b + 1) * ((double) (1L << 31) / (double) ((key >>> 33) + 1)));
    }
    return (int) b;
}
```

- O(log N) time, zero memory, very even distribution.
- Limitation: buckets are numbered; you can only add or remove at the **end**. Removing an arbitrary node needs an extra indirection (bucket to node table, replace in place). Ideal for sharded storage where shards are numbered and replicated (each "bucket" is a replica group), less so for caches where arbitrary nodes die. Guava exposes it as `Hashing.consistentHash`.

### Consistent hashing with bounded loads
Google (Mirrokni, Thorup, Zadimoghaddam, 2017): give each node a capacity of `ceil((1 + epsilon) * average load)`. A key goes to its successor on the ring unless that node is full, in which case it continues clockwise to the next node with spare capacity. This caps the maximum load (for example at 1.25x average) while keeping most of consistent hashing's stability. Vimeo added it to HAProxy for video caching, and it is useful for load balancers where some keys are hot.

### Maglev hashing
Google's load balancer builds a fixed-size lookup table (e.g. 65,537 entries) by letting each backend fill slots by its own permutation. Lookups are O(1), balance is near-perfect, and backend changes disturb only a small fraction of entries. Used by L4 load balancers (Maglev, Envoy's Maglev LB policy) for connection affinity.

### Comparison
| Algorithm | Lookup | Memory | Balance | Arbitrary node removal | Typical use |
|---|---|---|---|---|---|
| Mod N | O(1) | None | Perfect | Moves ~all keys | Never for elastic clusters |
| Ring + vnodes | O(log V·N) | O(V·N) | Good (improves with V) | Yes, minimal movement | Cassandra, Dynamo, memcached clients |
| Rendezvous (HRW) | O(N) | O(N) | Excellent | Yes, minimal movement | Small/medium clusters, caches, CDNs |
| Jump hash | O(log N) | None | Excellent | Only last bucket | Numbered shards (storage) |
| Bounded loads | O(log) + probing | O(V·N) | Capped max load | Yes | Load balancing with hot keys |
| Maglev | O(1) | Table (~65K) | Near perfect | Yes, small disruption | L4 load balancers |
| Fixed slots (Redis Cluster) | O(1) | 16,384 slots | Depends on slot assignment | Move slots explicitly | Redis Cluster, Couchbase |

## Real-world systems
- **Amazon Dynamo (2007 paper):** ring with virtual nodes, preference lists of N distinct nodes, sloppy quorum and hinted handoff. The paper later moved to equal-sized fixed partitions assigned to nodes, to make bootstrapping and archival simpler: a sign that fixed partitions plus a placement table is often easier to operate.
- **Cassandra / ScyllaDB:** Murmur3 tokens on a 64-bit ring, vnodes, `NetworkTopologyStrategy` for rack/DC-aware replica placement; clients are token-aware and send requests straight to a replica.
- **Memcached clients:** Ketama (libketama, spymemcached, Xmemcached) implements a client-side ring so that adding a cache server only invalidates ~1/N of keys.
- **Redis Cluster:** not a ring; uses CRC16(key) mod 16,384 hash slots assigned to masters, with hash tags `{user42}` to force related keys into one slot. Same goal, different mechanism.
- **Load balancers:** Envoy ring-hash and Maglev policies, Nginx `hash $key consistent`, HAProxy `hash-type consistent` with bounded loads, used for sticky sessions and cache affinity.
- **Kafka:** partitioner is `murmur2(key) % numPartitions`, which is why adding partitions breaks per-key ordering for existing keys; plan partition counts up front.
- **Discord, Akka Cluster Sharding, Orleans:** ring- or rendezvous-based placement of actors/sessions across nodes.

## How it shows up in interview problems
- **Distributed cache (design Memcached/Redis cluster):** the canonical use. Explain mod-N failure, ring with vnodes, replication to the next distinct node, and how clients learn membership.
- **Key-value store (design Dynamo):** ring + vnodes + preference list + quorum + hinted handoff + Merkle repair.
- **Rate limiter / API gateway:** route all requests for one API key to the same limiter node (consistent hashing in the gateway) so counters are local.
- **Chat / WebSocket gateways:** map users or rooms to gateway or session servers; on scale-out only a fraction of connections must move.
- **URL shortener / object storage:** place keys on storage nodes; Ceph uses CRUSH, a hierarchical relative of rendezvous hashing.
- **CDN / video:** map content to edge cache servers within a PoP so each object is cached once per PoP, not on every server.
- **Job scheduler / sharded workers:** assign job partitions to workers stably as workers come and go.

## Common pitfalls
- Using mod N and then trying to scale the cache under load.
- Too few virtual nodes, giving skewed load; or forgetting that a failed node's load all lands on one neighbour without vnodes.
- A poor hash function (`hashCode()`), producing clustered positions.
- Clients with inconsistent views of membership, so the same key is read and written on different nodes. Membership must come from one authoritative source or converge via gossip.
- Replicas placed on vnodes of the same physical node or the same rack.
- Assuming consistent hashing fixes hot keys: it balances key *counts*, not traffic to a single popular key (use salting, replication of hot keys, or bounded loads).
- Forgetting data movement: for storage (not cache), the moved 1/N must be streamed before the new node serves reads.

## Interview questions
1. **Why not use hash(key) % N for a distributed cache?** Changing N remaps nearly every key (about 80% from 4 to 5 nodes), causing a mass cache miss and a stampede on the database. Consistent hashing moves only about 1/N.
2. **What problem do virtual nodes solve?** Uneven arcs with few nodes, and a dead node's entire load hitting one successor. Many vnodes per node smooth the distribution (deviation about 1/sqrt(V)), spread failover load, and allow weighting for bigger machines.
3. **How do you choose replicas with consistent hashing?** Walk clockwise from the key's position and take the next N distinct physical nodes, skipping vnodes of already chosen nodes and preferably nodes in the same rack or zone.
4. **What is the time complexity of a lookup?** O(log M) with a sorted structure (TreeMap or binary search over a sorted array), where M is the total number of vnodes.
5. **Rendezvous hashing vs ring hashing?** Rendezvous computes a score per node and picks the highest: no vnodes needed, excellent balance and minimal movement, but O(N) per lookup. The ring is O(log M) and scales to many nodes, but needs vnodes for balance.
6. **When would you use jump consistent hash?** For numbered shards that only grow or shrink at the end (storage replica groups), where you want zero memory and perfect balance; not for caches where arbitrary nodes fail.
7. **Does consistent hashing solve hot keys?** No. It balances how many keys each node owns, not traffic per key. Handle hot keys with replication of the hot item, client-side caching, key salting, or bounded-load hashing.
8. **How does Redis Cluster differ?** It uses 16,384 fixed hash slots (CRC16 mod 16,384) explicitly assigned to masters, and rebalancing moves slots; hash tags keep related keys in one slot for multi-key operations.

## Cheat sheet
- Mod N moves N/(N+1) of keys on growth (80% for 4 to 5). Consistent hashing moves about 1/N.
- Ring: hash nodes and keys onto a circle; key goes to the first node clockwise; `TreeMap.ceilingEntry` then wrap to `firstEntry`.
- Virtual nodes: 100–256 per node (Cassandra 4.0: 16 with smart allocation); deviation about 1/sqrt(V); spreads failover load; weights.
- Replicas: next N distinct physical nodes clockwise, rack/zone aware.
- Rendezvous: max hash(key, node), O(N), no vnodes. Jump hash: O(log N), no memory, append-only buckets. Bounded loads: cap at (1 + epsilon) x average. Maglev: O(1) table for L4 LBs.
- Used by Dynamo, Cassandra, Ketama memcached clients, Envoy/HAProxy/Nginx hashing; Redis Cluster uses fixed slots instead.
- It balances keys, not hot keys; membership must be consistent across clients.
