=== hld-sharding | HLD | Partitioning (sharding) ===
Sharding splits one big dataset into smaller pieces, called shards or partitions, and puts them on different machines so no single machine has to hold all the data or take all the writes. Replication copies the same data; sharding divides different data. Almost everything about a sharded design depends on one choice, the shard key, so this chapter spends most of its time on choosing it well and on what to do when it goes wrong.

## 1. Why shard

**Definition:** Sharding (also called partitioning) means splitting a dataset by some key so each machine stores and serves only part of it.

Replication helps reads, but every replica still holds the full dataset and every write still goes through one leader. When the data no longer fits on one machine, or the write rate is more than one machine can absorb, you must split the data itself. Think of a library that outgrew its building: you do not build ten identical copies, you put A-F in one building and G-M in another.

### The problem

```text
orders database: 8 TB, growing 1 TB/month, 40,000 writes/sec at peak
largest practical single machine: ~10 TB fast disk, ~15,000 writes/sec
read replicas do not help: each one also needs 8 TB and replays all 40,000 writes/sec
```

Within two months the data no longer fits, and the write rate is already more than one leader can handle.

### Better design

```text
shard by customer_id across 8 shards (each one a small leader-follower group)
  shard 0: ~1 TB, ~5,000 writes/sec
  shard 1: ~1 TB, ~5,000 writes/sec
  ...
  shard 7: ~1 TB, ~5,000 writes/sec
router: shard = f(customer_id)
```

Each shard is small enough for one machine, and adding shards adds both storage and write capacity.

**Trade-offs:**
- Queries that span shards, joins and transactions across shards become hard (section 5).
- More moving parts: routing, rebalancing, per-shard monitoring.

**Key takeaway:** Shard when one machine cannot hold the data or take the writes. Before that, try a bigger machine, read replicas, caching and archiving old data.

---

## 2. Range vs. hash partitioning

**Definition:** Range partitioning gives each shard a continuous range of keys (A-F, G-M); hash partitioning gives each shard a range of hash values of the key, which scatters neighbouring keys.

Range partitioning is like a dictionary split into volumes: great for "all words from 'cat' to 'cow'", but if every new word started with "z", one volume would get all the work. Hashing turns the key into a random-looking number first, so load spreads evenly, but neighbouring keys end up on different shards.

### The problem

```text
range partitioning on created_at (one shard per month)
  shard Jan: idle
  shard Feb: idle
  shard Mar: idle
  shard Apr (current month): 100% of all writes  <- hot shard
```

Any key that grows over time (timestamps, auto-increment IDs) sends every new write to the last shard. The other shards sit idle while one melts down.

### Better design

```text
hash partitioning on order_id
  hash(order_id) in [0, 2^32) split into 8 equal ranges
  new orders land on random-looking shards -> ~12.5% of writes each
range partitioning still used where ranges matter:
  key = (sensor_id, timestamp) -> spreads by sensor, keeps time order within a sensor
```

Hashing removes the hot-shard problem for random lookups. When you also need range scans, put a well-spread value first and the time inside it.

**Trade-offs:**
- Hash partitioning makes range queries ("all orders last week") hit every shard.
- Range partitioning needs careful split points and watching for hot ranges.

**Key takeaway:** Hash for even load and point lookups; range when you truly need ordered scans, and never range on a key that only grows.

### Range vs. hash

- **Range:** keeps order, supports scans, risks hot spots. Used by HBase, Bigtable and MongoDB ranged sharding.
- **Hash:** spreads load evenly, loses order. Used by Cassandra (partition key), DynamoDB and Redis Cluster.
- Many systems combine them: hash on the first part of the key, sort by the second part within the shard (Cassandra partition key plus clustering columns).

---

## 3. Directory partitioning

**Definition:** Directory partitioning uses a lookup table that records, for each key or group of keys, which shard holds it.

Instead of computing the shard from the key with a fixed formula, you ask a directory, like a hotel front desk that knows which room each guest is in. That gives full control: you can move one customer without changing any formula.

### The problem

```text
SaaS app, hash(tenant_id) % 16 decides the shard
tenant "BigBank" grows to 40% of all traffic, stuck on shard 5 with 30 small tenants
moving BigBank means changing the formula -> which moves everyone else too
```

A pure formula cannot make an exception for one huge tenant.

### Better design

```text
directory (cached in every app server, stored in etcd / a small DB):
  tenant_id     -> shard
  "acme"        -> shard-3
  "bigbank"     -> shard-17  (dedicated)
  "tinyco"      -> shard-3
move a tenant: copy data, update one directory row, done
```

Each tenant can be placed, moved or isolated individually.

**Trade-offs:**
- An extra lookup on every request, so the directory must be cached and highly available.
- The directory itself becomes critical infrastructure.

**Key takeaway:** Use a directory when a few keys are very different in size, typically tenants in a multi-tenant system.

---

## 4. Choosing a shard key

**Definition:** The shard key is the field used to decide which shard a record lives on.

A good shard key has four properties: **high cardinality** (many distinct values), **even spread** of data and traffic, it **matches the main query** so most requests touch one shard, and it is **stable** (it never changes, because changing it means moving the record).

### The problem

```text
chat messages, shard key = message_id (hashed)
query: "last 50 messages in conversation 881"
  -> those 50 messages are spread across all 16 shards
  -> every page load asks 16 shards and merges results
alternative bad key: country -> India shard holds 40% of users
```

The first key spreads load but breaks the main query; the second matches some queries but has few, uneven values.

### Better design

```text
shard key = conversation_id (hashed), sort by message_id inside the shard
  "last 50 messages in conversation 881" -> one shard, one sorted read
orders: shard key = customer_id
  "my orders" -> one shard; "order by id" -> include the shard in the order ID
```

Every common request now goes to exactly one shard, and load spreads because there are millions of conversations.

**Trade-offs:**
- Queries by any other field (for example "all messages by user X") need a secondary index or a second copy of the data.

**Key takeaway:** Pick the key your most important query filters on, as long as it has many values and spreads evenly.

---

## 5. Hot keys and salting

**Definition:** A hot key is a single key that gets far more traffic than others, overloading the one shard that holds it; salting splits that key into several sub-keys spread across shards.

Even with a perfect hash, all traffic for one key goes to one shard. A celebrity's post, a flash-sale product or a viral video can receive a large fraction of all requests. Hashing cannot help, because the same key always hashes to the same place.

### The problem

```text
like counter for a celebrity post, key = post:777
shard 4 holds post:777 -> 200,000 likes/sec
every other shard: ~3,000 ops/sec
shard 4 CPU 100%, timeouts for every other key that lives on shard 4
```

### Better design

```text
write: key = post:777#<random 0-9>      -> 10 sub-keys on ~10 shards, ~20,000/sec each
read:  sum(post:777#0 ... post:777#9)   -> 10 small reads, cached for 1-2 seconds
apply salting only to keys detected as hot (a small "hot keys" list)
```

Writes spread over ten shards, and reads pay a small fan-out that a cache absorbs.

**Trade-offs:**
- Reads become a fan-out and merge; salting every key would make all reads 10x more expensive.
- You need detection (per-key counters) to know which keys are hot.

**Key takeaway:** Hashing fixes uneven keys, not one hot key. For that, split the key (salting), cache its reads, or batch its writes.

---

## 6. Cross-shard queries

**Definition:** A cross-shard query needs data from more than one shard, so a router sends it to many shards and merges the results (scatter-gather).

Scatter-gather works, but the query is only as fast as the slowest shard, and the load is multiplied by the number of shards. Joins across shards and transactions across shards are even harder.

### The problem

```text
"top 10 products by sales today" with orders sharded by customer_id across 32 shards
  -> 32 queries in parallel, each returns its local top 10, router merges
  -> p99 latency = slowest of 32 shards; 32x the load of a single-shard query
"transfer money between customer A (shard 3) and customer B (shard 19)"
  -> one database transaction cannot span two shards
```

### Better design

```text
reporting: stream orders (CDC) into an analytics store; precompute top-10 every minute
transfers: saga -> debit A on shard 3, then credit B on shard 19,
           with a compensating "refund A" if the credit fails
           (or two-phase commit when strict atomicity is required)
co-locate data queried together: customer, their orders and their addresses share customer_id
```

Keep the hot path single-shard, move analytics elsewhere, and handle the rare cross-shard write explicitly.

**Trade-offs:**
- Sagas are eventually consistent and need compensation logic; two-phase commit is atomic but slower and blocks if the coordinator fails.

**Key takeaway:** Design the shard key so frequent queries stay on one shard; treat scatter-gather as the exception.

---

## 7. Secondary indexes: local vs. global

**Definition:** A local secondary index lives inside each shard and covers only that shard's data; a global secondary index is partitioned by the indexed value itself and covers all shards.

If orders are sharded by `customer_id` and you need "all orders with status = SHIPPED" or "find user by email", the shard key does not help. A secondary index does, but you must decide where it lives.

### The problem

```text
users sharded by user_id across 16 shards, login by email
local index on email in each shard:
  "find email = a@b.com" -> ask all 16 shards, 15 answer "not here"
  at 10,000 logins/sec that is 160,000 index lookups/sec
```

### Better design

```text
global index, partitioned by email:
  hash(email) -> index shard 6 -> { email: a@b.com, user_id: 9912 }
  then hash(9912) -> user shard 11 -> the user row
  = 2 targeted reads instead of 16
```

Reads are targeted, but a write to a user can now touch two shards (the data and the index), so global indexes are usually updated asynchronously. DynamoDB global secondary indexes, for example, are eventually consistent.

**Trade-offs:**
- **Local:** writes are cheap and consistent, reads by that field scatter to every shard (Cassandra, MongoDB and Elasticsearch work this way).
- **Global:** reads are targeted, writes are costlier and the index can lag behind the data.

**Key takeaway:** Local index for rare or analytical lookups; global index (or a separate lookup table) for frequent lookups by a non-shard field such as email.

---

## 8. Rebalancing

**Definition:** Rebalancing is moving data between machines when you add or remove nodes, or when some shards grow larger or hotter than others.

The naive formula `shard = hash(key) % N` is fine until N changes. Going from 4 to 5 nodes changes the result for about 80% of keys, so most of the data has to move at once. Good schemes move only the minimum.

### The problem

```text
hash(key) % 4  ->  hash(key) % 5
key hash 6:  6 % 4 = 2,  6 % 5 = 1   -> moves
key hash 13: 13 % 4 = 1, 13 % 5 = 3  -> moves
~80% of 8 TB = ~6.4 TB copied over the network while serving live traffic
```

### Better design

```text
fixed number of logical partitions, many more than nodes:
  1024 partitions, 4 nodes -> 256 partitions each
  add node 5 -> it takes ~205 partitions from the others; nothing else moves
  partition -> node map kept in a coordinator (ZooKeeper / etcd)
moving one partition: copy snapshot -> stream new changes -> switch routing -> delete old copy
```

Only the partitions that change owner are copied, about 20% of the data, and the key-to-partition formula never changes. Redis Cluster (16,384 hash slots), Couchbase (1,024 vBuckets) and Elasticsearch (shard count fixed when the index is created) use this idea. Systems such as HBase and MongoDB instead split a range when it grows too big and move the pieces. Consistent hashing, the next chapter, is another answer.

**Trade-offs:**
- Moving data uses network and disk I/O, so throttle it and avoid it during incidents.
- Fully automatic rebalancing can make a bad situation worse; many teams keep a human approval step.

**Key takeaway:** Never use `% N` on physical nodes; map keys to many fixed partitions and move whole partitions.

---

## In an HLD interview

- **Chat/WhatsApp:** shard messages by `conversation_id`, sorted by message time inside the shard, so loading a chat is one shard read.
- **URL Shortener / Distributed Cache:** hash on the short code or cache key; mention consistent hashing or fixed hash slots for adding nodes.
- **News Feed / Twitter-like systems:** shard by `user_id`; call out celebrity hot keys and handle them with salting, caching or fan-out-on-read for very large accounts.
- **Amazon E-commerce / Payment System:** shard orders by `customer_id`, keep cross-shard transfers as sagas, and push reporting to an analytics store via CDC.
- **What to SAY:** "My shard key is X because the main query filters on it, it has millions of values and it never changes. Queries by Y use a global index. I will start with 1024 logical partitions so adding machines moves only whole partitions."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Sharding | Split data across machines | Does it still fit on one machine? |
| Range vs. hash | Keep order, or spread evenly | Do I need range scans on this key? |
| Directory | Lookup table decides the shard | Are a few keys much bigger than others? |
| Shard key | Field that decides placement | Does my main query hit one shard? |
| Hot keys | One key overloads one shard | Is there a celebrity or flash-sale key? |
| Cross-shard queries | Scatter-gather, sagas | Which queries touch every shard? |
| Secondary indexes | Local (per shard) or global | Do I look up often by a non-shard field? |
| Rebalancing | Move the minimum data | What moves when I add a node? |

## Final memory aid

- **Shard:** divide the data; replication copies it
- **Hash:** even load; **range:** ordered scans
- **Key:** many values, even spread, main query, never changes
- **Hot key:** salt it, cache it
- **Cross-shard:** rare by design; sagas for writes
- **Index:** local writes cheap, global reads cheap
- **Rebalance:** many fixed partitions, never `% N` on nodes

=== hld-consistent-hashing | HLD | Consistent hashing ===
Consistent hashing is a way to spread keys across servers so that adding or removing a server moves only a small share of the keys, instead of nearly all of them. It places both servers and keys on a circle of hash values, and each key belongs to the next server clockwise. This chapter shows why the simple `hash % N` approach fails, how the ring and virtual nodes fix it, and how to build one in Java with a `TreeMap`.

## 1. The mod-N problem

**Definition:** Mod-N placement picks a server with `hash(key) % N`, where N is the number of servers.

It is simple and spreads keys evenly, and it works perfectly as long as N never changes. The trouble is that N does change: servers fail, and you add servers to grow. When N changes, the answer changes for almost every key.

### The problem

```text
4 cache servers -> 5 cache servers, 1,000,000 cached keys
a key stays put only if hash % 4 == hash % 5
  that is true only when (hash % 20) is 0, 1, 2 or 3  -> 4 out of 20 = 20%
  -> 80% of keys (800,000) now map to a different server
10 -> 11 servers: only 10 of 110 residues match -> ~91% of keys move
```

For a cache, 800,000 keys suddenly miss at once, and all of those requests hit the database together: a self-inflicted outage. For a database, 80% of the data must be copied over the network.

### Better design

```text
consistent hashing, 4 -> 5 servers:
  only the keys the new server takes over move: about 1/5 = 20% (200,000 keys)
  the other 800,000 keys stay exactly where they were
```

In general, adding one server to N moves about 1/(N+1) of the keys, the theoretical minimum needed to give the new server a fair share.

**Key takeaway:** `hash % N` moves almost everything when N changes; consistent hashing moves only what it must.

---

## 2. The hash ring

**Definition:** A hash ring treats the range of hash values (for example 0 to 2^32 - 1) as a circle; each server is placed at the hash of its name, and each key is owned by the first server found by walking clockwise from the key's hash.

Picture a round clock face. Servers sit at a few positions around it. To find a key's home, put the key on the clock face and walk clockwise until you hit a server. When a server is added, it only takes over the keys between itself and the server before it; nobody else is affected.

### The problem

With mod-N, every server's share is defined by N itself, so changing N redraws every boundary at once. There is no way to add capacity without moving keys between servers that did not change.

### Better design

```text
             0
         S1 (at 10)
   S4 (at 85)      key k1 (at 20) -> walks clockwise -> S2
                   S2 (at 30)
         S3 (at 60)
      key k2 (at 70) -> walks clockwise -> S4

add S5 at 45: only keys in (30, 45] move, from S3 to S5
remove S2:    only keys in (10, 30] move, to S3 (the next server clockwise)
```

Each server owns the arc between its predecessor and itself. Adding or removing a server changes exactly one arc.

**Trade-offs:**
- With only a few servers, the random positions create very uneven arcs: one server might own 50% of the circle and another 10%.
- When a server dies, its whole arc lands on one neighbour, which may then be overloaded.

**Key takeaway:** On a ring, a membership change affects only the neighbouring arc, not the whole key space.

---

## 3. Virtual nodes

**Definition:** Virtual nodes (vnodes) place each physical server at many points on the ring, for example 100 to 256, instead of just one.

Instead of one big arc per server, each server owns many small arcs scattered around the circle. By the law of large numbers, the total share per server evens out. It is like dealing a deck of cards: one card each is very unequal, but 50 cards each comes out close to fair.

### The problem

```text
3 servers, 1 position each (random hashes):
  S1 owns 55% of the ring, S2 owns 30%, S3 owns 15%
S1 fails -> its whole 55% lands on the next server clockwise
  -> that server now holds 70-85% of all keys and falls over too (cascading failure)
```

### Better design

```text
3 servers x 150 vnodes = 450 points on the ring
  positions: hash("S1#0"), hash("S1#1"), ..., hash("S3#149")
  each server owns ~33% of the ring, typically within a few percent
S1 fails -> its 150 small arcs are spread over S2 and S3 roughly equally
weighted: a server with twice the memory gets twice the vnodes
```

More points per server means smoother load, and a failed server's load is shared by all survivors instead of one neighbour.

**Trade-offs:**
- The ring is bigger (servers x vnodes entries) and lookups cost O(log of ring size), still microseconds.
- Too many vnodes makes repair and streaming in databases more expensive; Cassandra lowered its default `num_tokens` from 256 to 16 in version 4.0, using a smarter token allocator for balance.

**Key takeaway:** Always use virtual nodes; they fix uneven arcs, spread failure load and allow weighting by capacity.

---

## 4. Replication on the ring

**Definition:** To keep R copies of a key, store it on the owner and on the next R-1 distinct physical servers clockwise; this ordered list is called the preference list.

The ring already gives an order, so replica placement needs no extra metadata. The one catch with vnodes is that the next few points clockwise may belong to the same physical server, which would put two "replicas" on one machine.

### The problem

```text
replication factor 3, walking the next 3 POINTS clockwise:
  key k -> S2#17, S2#88, S4#3
  two of the three copies are on S2 -> if S2 dies, only one copy is left
```

### Better design

```text
walk clockwise, skip points whose physical server is already chosen:
  S2#17 (take S2) -> S2#88 (skip) -> S4#3 (take S4) -> S2#40 (skip) -> S1#9 (take S1)
  preference list for k = [S2, S4, S1]
rack/zone aware: also skip a server in a zone already used
```

Three copies on three different machines, ideally in three different zones, so one failure never removes more than one copy.

**Trade-offs:**
- Rack or zone awareness makes placement more complex and can unbalance load if zones have unequal capacity.

**Key takeaway:** Replicas are the next N distinct physical servers (and zones) clockwise, not the next N points.

---

## 5. A Java implementation with TreeMap

**Definition:** A `TreeMap<Long, String>` makes a natural ring: the keys are ring positions, and `ceilingEntry(hash)` finds the first position at or after a key's hash.

A sorted map gives O(log n) lookups. If `ceilingEntry` returns null, the key's hash is past the last server, so you wrap around to `firstEntry()`. That one line is what turns a sorted list into a circle.

### The problem

```java
// Naive mod-N routing: most keys move when servers.size() changes
String serverFor(String key, List<String> servers) {
    int i = Math.abs(key.hashCode()) % servers.size();   // also a bug:
    return servers.get(i);   // Math.abs(Integer.MIN_VALUE) is negative -> crash
}
```

Besides moving most keys on every resize, `String.hashCode()` is poorly spread for similar strings, and `Math.abs` can return a negative number.

### Better design

```java
public final class HashRing {
    private final TreeMap<Long, String> ring = new TreeMap<>();
    private final int vnodes;

    public HashRing(int vnodes) { this.vnodes = vnodes; }

    public void addServer(String server) {
        for (int i = 0; i < vnodes; i++) ring.put(hash(server + "#" + i), server);
    }

    public void removeServer(String server) {
        for (int i = 0; i < vnodes; i++) ring.remove(hash(server + "#" + i), server);
    }

    public String serverFor(String key) {
        if (ring.isEmpty()) throw new IllegalStateException("no servers");
        Map.Entry<Long, String> e = ring.ceilingEntry(hash(key));
        return (e != null ? e : ring.firstEntry()).getValue();   // wrap around
    }
}
```

```java
// Well-spread 64-bit hash: first 8 bytes of MD5 (Murmur3 or xxHash are faster)
private static long hash(String s) {
    try {
        byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.wrap(d).getLong();
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException(e);
    }
}

HashRing ring = new HashRing(150);
List.of("cache-1", "cache-2", "cache-3").forEach(ring::addServer);
ring.serverFor("user:42");   // same answer until the arc owning user:42 changes
```

Adding `cache-4` inserts 150 new points; only keys that fall just before those points change owner. Using `remove(key, value)` means a rare hash collision with another server's point is not removed by mistake.

**Trade-offs:**
- `TreeMap` is not thread-safe. In a real client, build a new map on membership change and swap it in atomically (copy-on-write), or use `ConcurrentSkipListMap`.
- Every client must see the same server list, usually from a coordinator such as ZooKeeper or etcd, or through gossip.

**Key takeaway:** A sorted map plus "ceiling, else wrap to first" is the whole algorithm; vnodes are just a loop.

---

## 6. Where it is used

**Definition:** Consistent hashing is used wherever many clients must agree, without asking a central service, which server owns a key, while servers come and go.

The idea comes from a 1997 paper by Karger and others, written for web caching, and it was central to Akamai's CDN. Amazon's Dynamo paper (2007) made it the standard design for distributed key-value stores.

### The problem

```text
Memcached fleet behind 200 app servers, simple % N in each client
one cache node replaced at 3 a.m. -> most keys remap -> cache hit rate drops sharply
-> database receives a flood of misses -> latency alarms everywhere
```

### Better design

```text
Cassandra, ScyllaDB, Riak, DynamoDB  -> ring of token ranges with vnodes, replicas clockwise
Memcached clients (ketama)            -> consistent hashing in the client library
Envoy / NGINX / HAProxy               -> "ring hash" load balancing for sticky routing
Discord, chat and gateway services    -> route each user/channel to one stateful server
```

Replacing a cache node now loses only that node's share of keys, so the database sees a small bump instead of a flood.

### Consistent hashing vs. alternatives

- **Hash slots** (Redis Cluster): a fixed 16,384 slots, `CRC16(key) % 16384`, and an explicit slot-to-node table. Same goal, with an explicit map instead of a ring.
- **Rendezvous hashing** (highest random weight): score every server with `hash(key, server)` and pick the highest. No ring, even spread, but O(N) per lookup.
- **Jump consistent hash:** tiny, fast and almost perfectly even, but servers can only be added or removed at the end of a numbered list.
- **Maglev hashing:** a lookup table built for very fast, even load balancing; used in Google's network load balancer.

**Key takeaway:** Reach for consistent hashing when keys live on a changing set of servers and every client must compute the owner on its own.

---

## In an HLD interview

- **Distributed Cache:** consistent hashing with 100-200 vnodes in the client, so replacing a node loses only its share of keys and the database is not flooded.
- **Chat/WhatsApp, Uber Ride Tracking:** route each conversation or driver to one stateful server on a ring so its connection state lives in one place; on failure, only that server's users reconnect elsewhere.
- **URL Shortener / key-value storage:** a Dynamo-style ring with RF = 3, replicas on the next three distinct servers in different zones.
- **Rate Limiter / API Gateway:** consistent-hash each user or API key to one limiter node so its counter is not split across nodes.
- **What to SAY:** "I will not use hash mod N, because adding a fifth node would move 80% of keys. I place nodes on a hash ring with about 150 virtual nodes each, so adding a node moves about 1/N of keys, and replicas go to the next distinct nodes clockwise."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Mod-N problem | Changing N remaps most keys | What happens when I add one server? |
| Hash ring | Next server clockwise owns the key | Which arc changes on a membership change? |
| Virtual nodes | Many points per server | Is load even, and where does a failed server's load go? |
| Replication on ring | Next N distinct servers clockwise | Are two replicas on the same machine or zone? |
| TreeMap ring | `ceilingEntry`, else wrap to first | Is my hash well spread and my map swap thread-safe? |
| Where used | Caches, Dynamo-style stores, sticky load balancing | Do clients need to agree on owners without a central lookup? |

## Final memory aid

- **Mod-N:** 4 to 5 servers moves 80% of keys
- **Ring:** walk clockwise to the first server
- **Change:** only one arc moves, about 1/N of keys
- **Vnodes:** many small arcs, fair load, shared failover
- **Replicas:** next N distinct machines clockwise
- **Java:** `ceilingEntry`, else `firstEntry`
