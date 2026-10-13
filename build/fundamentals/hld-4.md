=== hld-cdn-storage | HLD | CDNs, object storage and media delivery ===
Big files such as photos, videos, downloads and backups should not pass through your application servers or sit inside your database. They belong in object storage, with their metadata in a database, and they reach users through a CDN, a network of servers close to users that caches content. This chapter covers the storage types, upload patterns, CDN caching rules, private content, video streaming and file-sync chunking.

## 1. Block, file and object storage

**Definition:** Block storage is a raw disk attached to one machine; file storage is a shared folder tree many machines mount; object storage is a flat bucket of whole files (objects) read and written over HTTP by key.

A useful picture: block storage is your laptop's hard drive, file storage is the office shared drive, and object storage is a huge warehouse where every parcel has a label (the key) and you can only swap whole parcels, not edit inside one.

### The problem

```text
Photo app keeps uploads on the local disk of app-1:
/var/app/uploads/42/avatar.jpg
User's next request goes to app-2 -> image not found
app-1 disk fills up or dies -> photos gone
```

Local disk ties files to one server, does not scale, and has no built-in redundancy.

### Better design

```text
Block  (EBS, persistent disk) -> the database's own data files
File   (EFS, NFS)             -> legacy apps needing a shared folder
Object (S3, GCS, Azure Blob)  -> photos, videos, backups, logs
  key: users/42/avatar.jpg, any server reads it over HTTPS
  data copied across zones; S3 is designed for 11 nines durability
```

Each kind of data goes to the storage that fits it. Object storage scales to practically unlimited size, is cheap per GB, and is shared by every server.

**Trade-offs:**
- Objects are replaced whole; you cannot edit a byte in the middle.
- Data transfer out (egress) is often the biggest part of the bill.

**Key takeaway:** Databases on block storage, user files in object storage; avoid local disk for anything users upload.

---

## 2. Object storage plus metadata in a database

**Definition:** Store the file bytes in object storage and store facts about the file (owner, name, size, type, status, object key) as a row in your database.

Object storage is great at "give me the bytes for this key" and poor at queries such as "Alice's photos from 2025, newest first". A database is the opposite. Use each for what it does well.

### The problem

```sql
CREATE TABLE photos (
  id BIGINT PRIMARY KEY,
  owner_id BIGINT,
  data BYTEA          -- 4 MB image inside the row
);
-- 100M photos = ~400 TB in the database
```

Blobs inside the database make it huge and expensive, slow backups and replication, and tie up DB connections streaming bytes.

### Better design

```sql
CREATE TABLE photos (
  id BIGINT PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  object_key TEXT NOT NULL,    -- 'photos/42/9f3c.jpg' in S3
  size_bytes BIGINT,
  content_type TEXT,
  status TEXT,                 -- PENDING, READY, BLOCKED
  created_at TIMESTAMPTZ
);
CREATE INDEX ON photos (owner_id, created_at DESC);
```

Queries stay fast and small in the database, and the bytes live cheaply in S3.

**Key takeaway:** Bytes in object storage, metadata in a database, joined by the object key.

---

## 3. Pre-signed uploads

**Definition:** A pre-signed URL is a time-limited link, signed by your backend, that lets a client upload or download one specific object directly from object storage without holding storage credentials.

It is like a valet ticket: the backend checks who you are, hands you a ticket for one parking spot for 10 minutes, and you park the car yourself.

### The problem

```text
Client --(500 MB video)--> API server --(500 MB)--> S3
1,000 uploads at once = 500 GB flowing through API servers
API threads blocked for minutes, memory and bandwidth exhausted
```

App servers become expensive, slow pipes for bytes they never need to look at.

### Better design

```text
1. Client -> API: "upload cat.mp4, 500 MB"
2. API checks login and quota, inserts row status=PENDING,
   returns pre-signed PUT URL valid for 10 minutes
3. Client -> S3: PUT bytes directly
4. S3 event -> queue -> worker: virus scan, thumbnails
5. Worker sets status=READY
```

The API only handles small JSON calls. Bytes go straight to storage, and processing is triggered by the upload event.

**Trade-offs:**
- You must check size and content type after upload too; the client could send something else.

**Key takeaway:** The API authorises, storage carries the bytes.

---

## 4. Multipart uploads

**Definition:** A multipart upload splits a large file into parts that are uploaded separately (often in parallel) and then joined into one object by a final "complete" call.

On a phone in a train, a 2 GB single upload that fails at 95% must start again. With parts, only the failed part is retried.

### The problem

```text
Single PUT of 2 GB over a mobile network
Network drops at 1.9 GB -> whole upload lost, start from zero
One TCP stream -> slow, cannot use full bandwidth
```

Large single requests are slow and fragile.

### Better design

```text
initiate  -> uploadId
part 1..N -> 2 GB / 64 MB = 32 parts, 4 in parallel,
             each with its own pre-signed URL and checksum
part 17 fails -> retry part 17 only
complete(uploadId, [part ETags]) -> one object
(S3: parts are 5 MB to 5 GB, last part may be smaller,
 up to 10,000 parts)
```

Uploads are faster and resumable. A lifecycle rule should clean up uploads that were started and never completed.

**Key takeaway:** Large uploads should be multipart and resumable, with pre-signed URLs per part.

---

## 5. CDN: pull vs. push

**Definition:** A CDN is a set of edge servers in many cities that cache your content near users; a pull CDN fetches content from your origin on the first request, a push CDN is loaded by you ahead of time.

The origin is your own server or bucket that holds the master copy. The CDN is like local corner shops stocking popular items so customers do not drive to the central warehouse.

### The problem

```text
All images served from one bucket in us-east
User in Sydney: ~200 ms round trip, image page takes 3 s
Viral post: 1M requests in 10 minutes -> all hit the origin
```

Far-away users wait, and the origin pays for every byte and every request.

### Better design

```text
Pull CDN (default):
  user -> nearest edge -> hit? serve in ~10-30 ms
                       -> miss? fetch from origin once, cache, serve
  origin shield (one extra cache tier) collapses misses from
  hundreds of edges into a single origin fetch
Push CDN: upload a game patch to edges before launch day
```

Most requests are served near the user, and the origin sees a tiny fraction of traffic.

### Pull vs. push

- **Pull:** zero setup per file, first request per edge is slow; the right default.
- **Push:** you control what is where and when; good for big, predictable releases.

**Key takeaway:** Put a pull CDN in front of every static asset and media file; push only for planned big releases.

---

## 6. Cache-Control and versioned URLs

**Definition:** `Cache-Control` is the HTTP header that tells browsers and CDNs how long they may cache a response; a versioned URL puts a content hash or version in the file name so a new version gets a new URL.

CDN purges exist but are slower and limited. If the URL changes whenever the content changes, you never need to purge.

### The problem

```http
GET /static/app.js
Cache-Control: public, max-age=86400

-- You deploy a bug fix to app.js --
Browsers and edges keep the old app.js for up to 24 hours.
New HTML + old JS = broken page.
```

A fixed URL with a long TTL means users keep the old file; a short TTL means poor caching.

### Better design

```http
GET /static/app.3f9a2c.js
Cache-Control: public, max-age=31536000, immutable

GET /index.html
Cache-Control: no-cache          (always revalidate, cheap 304s)

Deploy: build emits app.81b7e0.js, index.html now points to it.
```

Assets cache for a year because their content never changes under that name. The small HTML page always revalidates and picks up new names immediately.

**Key takeaway:** Long TTL plus content-hashed names for assets, short or no-cache for the HTML that references them.

---

## 7. Signed URLs for private content

**Definition:** A signed URL (or signed cookie) is a CDN or storage link that includes an expiry time and a cryptographic signature, so only holders of a valid, unexpired link can fetch the content.

Paid videos or private photos still benefit from CDN caching, but must not be readable by anyone who guesses the URL.

### The problem

```text
https://cdn.example.com/courses/java-101/lesson1.mp4
Public URL -> shared on a forum -> anyone can stream it forever
```

Public URLs leak, and there is no way to take access back.

### Better design

```text
1. User asks API for lesson 1; API checks the purchase
2. API returns a link signed with a key the CDN trusts:
   .../lesson1.m3u8?Expires=1760000000&Signature=...&Key-Pair-Id=...
3. CDN validates signature and expiry, then serves from cache
4. Link stops working after, say, 1 hour
```

The CDN keeps caching, but only authorised users with fresh links get through. Signed cookies suit video, where one playback fetches hundreds of segment files.

**Key takeaway:** Authorise in your API, then hand out short-lived signed URLs or cookies the CDN can check.

---

## 8. Video transcoding and adaptive bitrate

**Definition:** Transcoding converts an uploaded video into several resolutions and formats; adaptive bitrate (ABR) streaming lets the player switch between them every few seconds based on current network speed.

The video is cut into short segments (commonly 2-6 seconds) listed in a manifest file: HLS uses `.m3u8`, MPEG-DASH uses `.mpd`. The player reads the manifest and picks, segment by segment, the best quality it can download in time.

### The problem

```text
Upload: one 4K file, 20 Mbps
Viewer on 3 Mbps mobile -> constant buffering
Viewer's network drops mid-video -> playback stops
One big file -> cannot start until enough is downloaded
```

One fixed quality is too heavy for weak networks and wastes quality on strong ones.

### Better design

```text
upload -> S3 -> event -> queue -> transcode workers (in parallel,
          split by chunk) -> renditions:
          240p 0.4 Mbps | 480p 1.5 Mbps | 720p 3 Mbps | 1080p 6 Mbps
       -> segments of ~4 s + master.m3u8 -> S3 -> CDN
player: bandwidth drops -> next segment at 480p, rises -> 1080p
```

Playback starts quickly and keeps going when the network changes. Very popular titles are pre-placed at edges or inside ISP networks (Netflix Open Connect).

**Trade-offs:**
- Storage multiplies with each rendition; transcoding is CPU-heavy, so it runs as an async pipeline.

**Key takeaway:** Transcode once into a ladder of qualities, segment it, and let the player adapt.

---

## 9. File sync chunking

**Definition:** Chunking splits files into blocks identified by their content hash, so a sync client uploads only the blocks that changed or that the server does not already have.

This is how Dropbox-style sync stays fast. A file becomes a list of block hashes; a new version is just a new list that mostly reuses old blocks.

### The problem

```text
User edits one paragraph in a 200 MB file
Naive sync re-uploads all 200 MB
10 users store the same 1 GB installer -> 10 GB stored
```

Whole-file sync wastes bandwidth and storage on data that did not change.

### Better design

```text
file v1 -> blocks (~4 MB): [h1, h2, h3, ..., h50]  (SHA-256 each)
edit    -> blocks:          [h1, h2, h3', ..., h50]
client: "server, which of these hashes are new?" -> only h3'
upload h3' (4 MB), then commit version v2 = new hash list
metadata DB: file -> version -> ordered block hashes
other devices: long-poll / WebSocket "changes since cursor X"
```

Only changed blocks travel, and identical blocks are stored once. Content-defined chunking (block boundaries chosen by a rolling hash) keeps an insertion from shifting every later block. If two devices edit the same base version, the loser's file is saved as a "conflicted copy".

**Key takeaway:** Hash-addressed blocks give you delta sync and deduplication; metadata tracks versions and changes.

---

## In an HLD interview

- **YouTube, Netflix:** pre-signed multipart upload to object storage, an async transcoding pipeline, HLS/DASH segments, ABR players, CDN delivery with signed URLs for paid content.
- **Dropbox / Google Drive:** content-hashed chunks in object storage, a metadata DB of file versions and block lists, a change cursor for sync, conflicted copies.
- **News Feed, Chat/WhatsApp, Amazon E-commerce:** images and attachments uploaded via pre-signed URLs, served through a CDN with versioned URLs and thumbnails made by workers.
- **URL Shortener, Google Search:** CDN and long-TTL caching for static assets; the redirect API itself stays behind the LB.
- **What to say:** "Clients upload directly to S3 with pre-signed URLs; a metadata row tracks status; an S3 event starts processing; everything is served from a CDN with versioned URLs, and private media uses short-lived signed URLs."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Block / file / object | Disk vs. shared folder vs. HTTP bucket | Is this a DB disk or user content? |
| Metadata in DB | Bytes in S3, facts in a table | Can I query files without touching bytes? |
| Pre-signed uploads | Client sends bytes straight to storage | Do my API servers carry file bytes? |
| Multipart | Parallel, retryable parts | What if the upload fails at 95%? |
| CDN pull vs. push | Cache near users, origin as source | Where are users, how popular is the file? |
| Cache-Control + versioned URLs | New content, new URL | How do users get the new version? |
| Signed URLs | Expiring, signed access | Can someone share this link forever? |
| Transcoding + ABR | Quality ladder, player adapts | What happens on a slow network? |
| Sync chunking | Upload only new blocks | Am I re-sending unchanged data? |

## Final memory aid

- **Bytes to object storage, metadata to the database**
- **Upload direct with pre-signed URLs; big files multipart**
- **Pull CDN in front of every static and media file**
- **Hashed file names + one-year TTL; never purge**
- **Private content: short-lived signed URLs or cookies**
- **Video: transcode, segment, adapt, CDN**
- **Sync: hash-addressed blocks, send only what changed**

=== hld-databases | HLD | Choosing a database: SQL vs NoSQL and beyond ===
"Which database?" comes up in every design, and the right answer comes from how the data is read and written, not from brand names. This chapter walks through relational databases and the main NoSQL families (key-value, document, wide-column, graph), plus search engines and time-series stores, each with the problem it solves. It ends with polyglot persistence and worked choices you can say out loud in an interview.

## 1. Choose by access pattern

**Definition:** An access pattern is a concrete description of how data is queried and written: by what key, how often, in what order, and with what consistency need.

Choosing a database without listing access patterns is like buying a vehicle without knowing whether you will carry passengers, cargo or race. Write them down first, then match a store.

### The problem

```text
"We'll use MongoDB because it scales."
Later requirements:
  - transfer money between two accounts atomically
  - report: revenue by region by month with joins
Team now fights the database every sprint.
```

Picking by reputation leads to a store that does not fit the real queries.

### Better design

```text
Access patterns for a chat app:
  1. send message          -> 50,000 writes/s, append-only
  2. last 50 messages in a conversation, newest first
  3. user profile by id    -> read-heavy, small
  4. search old messages by text
Choices: (1,2) wide-column by conversation_id; (3) relational
         or key-value + cache; (4) search engine fed by events
```

Each pattern points at a store. Also note read/write ratio, data size, latency targets and what your team can operate.

**Key takeaway:** List the top queries, the write rate and the consistency need before naming any database.

---

## 2. Relational databases

**Definition:** A relational database (PostgreSQL, MySQL) stores data in tables with a fixed schema, links them with keys and joins, and offers ACID transactions.

ACID means a transaction is all-or-nothing (atomic), keeps rules valid (consistent), is not disturbed by other transactions running at the same time (isolated), and survives crashes once committed (durable). Relational databases are the safe default for business data with relationships and rules.

### The problem

```text
Key-value store, no transactions:
put(account:A, balance - 500)    -- succeeds
put(account:B, balance + 500)    -- server crashes before this
500 disappears from the system.
```

Without multi-row transactions, a crash halfway through leaves money in neither account.

### Better design

```sql
BEGIN;
UPDATE accounts SET balance = balance - 500
 WHERE id = 'A' AND balance >= 500;
UPDATE accounts SET balance = balance + 500 WHERE id = 'B';
INSERT INTO transfers(from_id, to_id, amount) VALUES ('A','B',500);
COMMIT;
```

Either all three changes happen or none does, and constraints and foreign keys guard the data.

**Trade-offs:**
- Scaling writes beyond one primary needs sharding or a distributed SQL database (Spanner, CockroachDB), which adds complexity or write latency.
- Schema changes on very large tables need care.

**Key takeaway:** Use relational for orders, payments, bookings and anything with invariants; scale with replicas, then partitioning, then sharding.

---

## 3. Key-value stores

**Definition:** A key-value store saves a value under a key and retrieves it by that key, with little else in the way of querying.

It is a giant, distributed hash map. Because every request is "get by key", it can partition data across many machines and keep latency low at huge scale. Examples: Redis (in memory), DynamoDB (managed, durable).

### The problem

```text
Session lookups: 200,000 reads/s, always by session_id
Stored in Postgres with joins to users and roles
Primary at 90% CPU just answering one-row lookups
```

A general-purpose database spends effort on features this pattern never uses.

### Better design

```text
Redis:    GET session:7f3a...   -> {userId, roles, expiresAt}
          SET with TTL 30 min
DynamoDB: partition key = sessionId
          single-digit ms reads at any scale, auto partitioning
```

Each lookup is one key, so the store can spread keys over many nodes and keep latency flat.

**Trade-offs:**
- No joins or ad-hoc queries; any query not by key needs a secondary index or another store.

**Key takeaway:** Use key-value for lookups by ID at large scale: sessions, carts, short URLs, idempotency keys.

---

## 4. Document stores

**Definition:** A document store (MongoDB, Couchbase, Firestore) stores JSON-like documents, each with its own flexible shape, and lets you query and index fields inside them.

It fits data that is read and written as one unit (an aggregate) and whose shape varies, like a product whose attributes differ by category.

### The problem

```text
Relational catalog: products + attributes(product_id, name, value)
Phone has 40 attributes, T-shirt has 6, book has 10
Showing one product page = joins over 5 tables,
and every new category means a schema change.
```

Variable shapes fight a fixed schema, and the page needs many joins to rebuild one object.

### Better design

```json
{
  "_id": "sku-123",
  "title": "Pixel phone",
  "category": "phones",
  "price": { "amount": 49900, "currency": "INR" },
  "attrs": { "ram": "8GB", "storage": "128GB", "colour": "black" },
  "variants": [ { "sku": "sku-123-b", "colour": "blue" } ]
}
```

One read returns the whole product, and new attributes need no migration. Index fields such as `category` for queries.

**Trade-offs:**
- Joins across documents are limited and costly, so you duplicate data; multi-document transactions exist but are best kept rare at scale.

**Key takeaway:** Use a document store for self-contained aggregates with varying shape, such as catalogs, profiles and content.

---

## 5. Wide-column stores

**Definition:** A wide-column store (Cassandra, ScyllaDB, HBase, Bigtable) groups rows by a partition key and keeps rows inside each partition sorted by clustering columns, built for very high write rates across many nodes.

Writes go to an append-only log and memory first (an LSM tree), so they are very fast. You design one table per query: the partition key decides which node holds the data, and the sort order inside it serves "latest N" reads.

### The problem

```text
Chat messages in one Postgres table:
  50,000 inserts/s, 5 billion rows, growing daily
  SELECT ... WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 50
Single primary cannot absorb the writes; index keeps growing.
```

One relational primary hits its write ceiling, and the table outgrows a single machine.

### Better design

```sql
-- Cassandra CQL
CREATE TABLE messages_by_conversation (
  conversation_id uuid,
  bucket text,             -- e.g. '2026-10', bounds partition size
  message_id timeuuid,
  sender_id uuid,
  body text,
  PRIMARY KEY ((conversation_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

"Latest 50 messages" is one partition read, writes spread across nodes by conversation, and adding nodes adds capacity roughly linearly.

**Trade-offs:**
- No joins and weak ad-hoc querying; a new query often means a new table.
- Consistency is tunable (ONE, QUORUM, ALL) rather than full ACID.

**Key takeaway:** Use wide-column for huge, write-heavy, time-ordered data read by a known key.

---

## 6. Graph databases

**Definition:** A graph database (Neo4j, Amazon Neptune) stores nodes and the edges between them, and is built to follow relationships quickly.

When the question is about connections ("friends of friends", "accounts sharing a device with a known fraudster"), following links directly is much cheaper than repeated self-joins.

### The problem

```sql
-- friends of friends of friends in SQL
SELECT DISTINCT f3.friend_id
FROM friends f1
JOIN friends f2 ON f2.user_id = f1.friend_id
JOIN friends f3 ON f3.user_id = f2.friend_id
WHERE f1.user_id = 42;
-- each extra hop = another join, cost explodes
```

Multi-hop relationship queries become slow and awkward as depth grows.

### Better design

```text
// Cypher (Neo4j)
MATCH (me:User {id: 42})-[:FRIEND*1..3]->(other:User)
RETURN DISTINCT other.id
```

The query follows edges from one starting node, so its cost depends on the neighbourhood it touches, not the size of the whole graph.

**Trade-offs:**
- Harder to shard; many large social networks still keep the graph in sharded key-value or relational stores with app-level traversal.

**Key takeaway:** Reach for a graph database when deep relationship traversal is the core query, such as fraud rings or recommendations.

---

## 7. Search engines

**Definition:** A search engine (Elasticsearch, OpenSearch, Solr) builds an inverted index, a map from each word to the documents containing it, for fast full-text search, relevance ranking and filters.

It is the index at the back of a book: look up the word, get the pages. It is usually a secondary store, fed from the source of truth.

### The problem

```sql
SELECT * FROM products
WHERE title LIKE '%wireless headphone%';
-- full scan of 50M rows, no typo tolerance,
-- no ranking by relevance, no facets
```

`LIKE '%...%'` cannot use a normal index and has no idea which result is most relevant.

### Better design

```text
Postgres (source of truth) -> CDC (Debezium) -> Kafka
  -> indexer -> Elasticsearch index "products"
Query: match "wireles headphone" (fuzzy), filter brand, price,
       facets by brand, sorted by relevance (BM25)
Index lags the DB by about a second.
```

Search is fast, typo-tolerant and ranked, while orders and stock stay in the database.

**Key takeaway:** Use a search engine for text search and facets, as an eventually consistent copy of the real data.

---

## 8. Time-series databases

**Definition:** A time-series database (Prometheus, InfluxDB, TimescaleDB) stores timestamped measurements and is built for appending them and aggregating over time ranges.

Metrics arrive in order, are rarely updated, and are queried as "average over the last hour per host". Time-series stores compress such data heavily and drop or shrink old data automatically.

### The problem

```text
10,000 servers x 200 metrics x every 10 s = 200,000 points/s
Stored as rows in a general-purpose table:
  storage grows by TBs, "p99 latency per service last 24 h"
  takes minutes, deleting old rows causes heavy churn
```

A general table is not built for constant appends, range aggregation and retention.

### Better design

```text
metric: http_latency_ms{service="orders", host="h17"}
- data split by time chunks, compressed (delta encoding)
- retention: raw 15 days, 1-minute rollups 1 year
- query: p99 over 5-minute windows, last 24 h -> milliseconds
```

Writes are cheap appends, queries scan only the needed time range, and old data expires by dropping whole chunks.

**Key takeaway:** Use a time-series store for metrics, monitoring and IoT data with time-range queries and retention.

---

## 9. Polyglot persistence

**Definition:** Polyglot persistence means using several databases in one system, each for the access pattern it handles best, with one clear source of truth per piece of data.

The risk is copies that disagree. The fix is to name the owner of each piece of data and derive the other copies from its changes.

### The problem

```text
Order service writes to Postgres AND Elasticsearch AND Redis
in the same request (dual writes)
Elasticsearch write fails -> order exists but is not searchable
Redis write succeeds, Postgres rolls back -> ghost order in cache
```

Writing to several stores from the app with no ordering or retry leaves them inconsistent.

### Better design

```text
Postgres (source of truth for orders)
   |  CDC / outbox events
   v
 Kafka --> Elasticsearch (search, ~1 s behind)
       --> Redis (cache invalidation)
       --> ClickHouse (analytics, minutes behind)
```

One write path; every other store is a derived copy that can be rebuilt by replaying events, with known lag.

**Key takeaway:** Many stores are fine, as long as each piece of data has one owner and the copies are derived from it.

---

## 10. Worked choices for common problems

**Definition:** A worked choice pairs a known interview problem with the store that fits its main access pattern, plus a one-line reason.

Having these ready lets you answer "which database?" in one sentence and move on.

| Problem | Main store | Why |
|---|---|---|
| URL Shortener | Key-value (DynamoDB) + Redis cache | Lookup by short code at huge read scale |
| Payment System, BookMyShow | Relational (Postgres) | ACID, constraints, no double booking |
| Chat/WhatsApp | Wide-column (Cassandra) | Write-heavy, latest messages per conversation |
| Amazon catalog | Document store + search engine | Varying product shapes, text search and facets |
| Metrics, Logging/Monitoring | Time-series DB / log search engine | Appends, time-range queries, retention |
| Social graph, fraud | Graph DB (or sharded KV + app traversal) | Multi-hop relationships |
| Uber driver locations | Redis geo index + Cassandra history | Fast nearby queries, high write rate |

### SQL vs. NoSQL

- **SQL:** flexible queries, joins and transactions; the default until a specific scale or shape forces a change.
- **NoSQL:** designed around known access patterns at large scale; fewer query options, more modelling up front.
- "NoSQL scales, SQL does not" is too simple: relational databases scale far with replicas and sharding, and NoSQL needs careful key design to avoid hot partitions.

**Key takeaway:** Start relational for core business data and add specialised stores where a pattern clearly needs one.

---

## In an HLD interview

- **Payment System, Seat Reservation, BookMyShow:** relational for bookings and money, with transactions and unique constraints to prevent double booking.
- **Chat/WhatsApp, News Feed, Notification System:** wide-column for message and feed timelines partitioned by conversation or user, Redis for hot data.
- **Amazon E-commerce, Google Search:** document store or relational for the catalog, a search engine fed by CDC for text search and facets.
- **Metrics, Logging/Monitoring, Ride Tracking:** time-series storage with retention and rollups; a search engine for log text.
- **What to say:** "Orders live in Postgres as the source of truth; changes flow through CDC into Kafka, which feeds Elasticsearch for search and Redis for caching, each a few seconds behind at most."

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Access patterns | Queries decide the store | What are my top 3 queries and write rate? |
| Relational | Tables, joins, ACID | Do I need multi-row transactions or rules? |
| Key-value | Get/put by key at scale | Is every read by a known ID? |
| Document | Flexible aggregates | Is the object read and written as one unit? |
| Wide-column | Partition key + sorted rows | Is it write-heavy and read by key and time? |
| Graph | Follow edges fast | Is the question about multi-hop links? |
| Search engine | Inverted index, relevance | Do users type free text? |
| Time-series | Timestamped appends, retention | Is it metrics over time ranges? |
| Polyglot | One owner, derived copies | Which store is the source of truth? |

## Final memory aid

- **Access patterns first, database second**
- **Relational for money, bookings and invariants**
- **Key-value for lookups by ID at scale**
- **Document for flexible, self-contained objects**
- **Wide-column for huge write-heavy timelines**
- **Graph for deep relationships, search engine for text**
- **Time-series for metrics with retention**
- **One source of truth; derive the rest through CDC**
