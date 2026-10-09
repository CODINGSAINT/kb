=== hld-cdn-storage | HLD | CDNs, object storage and media delivery ===
Large binary content (images, video, downloads, backups, logs) should never stream through your application servers or live in your database. It belongs in **object storage** and is delivered through a **CDN**. This chapter explains storage types, how object stores and CDNs work, upload and download patterns, media pipelines and file-sync chunking.

## Storage types
| Type | Abstraction | Examples | Use for |
|---|---|---|---|
| Block storage | Raw disk volumes attached to one machine | EBS, persistent disks | Databases, OS disks: low latency, random I/O |
| File storage | Shared hierarchical file system (NFS/SMB) | EFS, Filestore | Shared files between servers, legacy apps |
| Object storage | Flat namespace of immutable objects over HTTP | S3, GCS, Azure Blob, MinIO | Media, backups, data lakes, static sites, logs |

## Object storage in depth
- **Model:** buckets contain objects addressed by key (`users/42/avatar.jpg`). "Folders" are just key prefixes.
- **Durability:** data is replicated or erasure-coded across devices and availability zones, typically quoted at 99.999999999% (11 nines) annual durability.
- **Consistency:** major providers now offer strong read-after-write consistency for new and overwritten objects.
- **Immutability:** objects are written whole and replaced, not edited in place. Appending means writing a new object (or a new version).
- **Scale:** effectively unlimited objects and bytes, with throughput scaling by key prefix and parallelism.
- **Cost model:** per GB stored (cheaper in colder tiers), per request, and especially **per GB of egress**.
- **Features:** versioning, lifecycle rules (move to infrequent access after 30 days, archive after 180, delete after 2 years), server-side encryption, object lock (WORM, for compliance), event notifications on upload.

### Metadata belongs in a database
Store bytes in object storage, and store **metadata** (owner, filename, size, MIME type, checksum, ACL, processing status) in your database. Queries ("list Alice's photos from 2025") hit the DB; downloads fetch the object by key.

## Upload patterns
### Pre-signed URLs (direct-to-storage)
```
1. Client → API: "I want to upload photo.jpg (4 MB)"
2. API checks auth/quota, creates metadata row (status=PENDING), returns a pre-signed PUT URL (valid 10 min)
3. Client → S3: PUT bytes directly using the signed URL
4. S3 → event (S3 notification / Kafka) → processing worker (virus scan, thumbnails, transcoding)
5. Worker updates metadata status=READY
```
App servers never touch the bytes, so they stay small and stateless and bandwidth costs drop. The same pattern works for downloads with **pre-signed GET URLs** for private content.
### Multipart and resumable uploads
Large files are split into parts (e.g. 8–100 MB), uploaded in parallel and retried individually, then completed with a final call. That gives faster uploads, resumability on flaky mobile networks, and no single huge request.
### Validation
Verify size limits and content type server-side after upload; check checksums (Content-MD5/CRC); scan for malware before making content public.

## CDN (content delivery network)
A CDN is a globally distributed set of edge servers (points of presence) that cache content near users.
### How it works
1. DNS or anycast routes the user to a nearby edge.
2. The edge checks its cache by **cache key** (URL plus selected headers, cookies and query parameters).
3. On a hit, it serves immediately (milliseconds). On a miss, it fetches from the **origin** (or a mid-tier "shield" cache), stores the response per its TTL, and serves it.
### Pull vs push
- **Pull CDN:** the edge fetches lazily on the first request. Easy and the default for websites and APIs.
- **Push CDN:** you upload content ahead of time. Useful for large, predictable releases (game patches, popular videos).
### Cache control
- `Cache-Control: public, max-age=31536000, immutable` for **fingerprinted assets** (`app.3f9a2c.js`). Change the file name to "invalidate" instantly.
- Short TTLs plus `stale-while-revalidate` for semi-dynamic content.
- Purges/invalidations exist but are slow and limited, so prefer versioned URLs.
- Normalise cache keys (strip tracking query params) to raise hit ratios.
### Private content
Signed URLs or signed cookies with expiry (CloudFront signed URLs, token auth) let the CDN serve paid or private media without exposing it publicly.
### Beyond caching
TLS termination near users, HTTP/2 and HTTP/3, DDoS absorption, WAF, image optimisation (resize, WebP/AVIF), edge compute (Workers, Lambda@Edge) for redirects, A/B routing and auth checks.
### Origin protection
An **origin shield** (an extra cache tier) collapses misses from hundreds of edges into one origin request, which is critical for viral content. Use request collapsing at the edge too.

## Video delivery
1. **Upload** the source to object storage (multipart, resumable).
2. **Transcode** into multiple renditions (240p…4K) and codecs (H.264, H.265, AV1) using a pipeline of workers fed by a queue. Split the video into chunks for parallel transcoding.
3. **Package** into short segments (2–6 s) with manifests: HLS (`.m3u8`) or MPEG-DASH (`.mpd`).
4. **Adaptive bitrate (ABR) streaming:** the player measures bandwidth and buffer level and switches renditions segment by segment, so playback continues when the network drops.
5. **Distribute** via CDN; extremely popular content is pre-positioned at edges or inside ISP networks (Netflix Open Connect).
6. **Live streaming** adds an ingest protocol (RTMP/SRT/WebRTC), real-time transcoding and low-latency HLS/DASH with smaller segments.
Thumbnails, previews and captions are additional outputs of the same pipeline.

## File sync (Dropbox / Google Drive)
- **Chunking:** split files into blocks (fixed ~4 MB, or **content-defined chunking** with rolling hashes so an insertion doesn't shift every later block).
- **Content addressing:** identify chunks by hash (SHA-256). Upload only chunks the server doesn't already have, which deduplicates across versions and users.
- **Metadata service:** maps file → version → ordered list of chunk hashes, plus a per-user change journal (cursor) so clients fetch "what changed since cursor X".
- **Sync protocol:** clients watch local changes, upload new chunks, commit the new file version (with conflict detection via the base version), and receive notifications (long poll or WebSocket) of remote changes.
- **Conflicts:** if two devices edit the same base version, keep both ("conflicted copy") or merge for specific formats.

## Image pipelines
Generate standard sizes on upload, or resize on the fly at the edge with caching. Strip EXIF metadata (privacy), convert to modern formats, and serve via CDN with long TTLs and versioned URLs.

## Interview questions
1. **How should users upload large videos?** Pre-signed multipart upload direct to object storage, an event-triggered transcoding pipeline, a metadata status in the DB, and CDN delivery with ABR.
2. **How do you serve private photos through a CDN?** Short-lived signed URLs or cookies issued by your API after authorisation; the CDN validates the signature.
3. **How do you invalidate a CSS file cached at the edge for a year?** Don't. Version the filename and update the HTML reference.
4. **Why not store images in the database?** DB storage is expensive, inflates backups and replication, and isn't built for streaming large blobs; object storage plus a CDN is cheaper and faster.

## Cheat sheet
```
Bytes → object storage (S3); metadata → DB; delivery → CDN
Uploads: pre-signed URLs, multipart/resumable, event → workers, status in DB
CDN: edge cache by key; pull vs push; long TTL + versioned filenames; signed URLs for private
Shield/collapsing to protect origin; egress is the big cost
Video: transcode → segments (HLS/DASH) → ABR → CDN/ISP caches
Sync: content-defined chunks, hash-addressed, dedup, metadata journal + cursor, conflict copies
```

=== hld-databases | HLD | Choosing a database: SQL vs NoSQL and beyond ===
"Which database?" comes up in every design. The right answer comes from **access patterns, consistency needs, scale and operational constraints**, not brand names. This chapter covers the main database families, how they store and query data, their trade-offs, and a decision process you can say out loud.

## Start from access patterns
Before naming a database, write down:
1. The main **queries** (lookups by key? range scans by time? joins? full-text? graph traversal?).
2. **Read/write ratio** and QPS.
3. **Consistency needs** (must every read see the latest write? multi-row transactions?).
4. **Data size and growth.**
5. **Latency targets.**
6. **Operational context** (managed service available? team expertise?).

## Relational databases (PostgreSQL, MySQL, Oracle, SQL Server)
- **Model:** tables with typed columns, primary and foreign keys, constraints, joins.
- **Transactions:** ACID with configurable isolation levels.
- **Query flexibility:** ad-hoc SQL, secondary indexes, aggregations.
- **Scaling:** vertical first; read replicas for read scaling; partitioning (declarative partitioning by range or hash) for large tables; sharding (Vitess, Citus) or distributed SQL for write scaling.
- **Best for:** core business data with relationships and invariants: users, orders, payments, inventory, bookings.
- **Watch:** cross-shard joins and transactions once you shard; schema migrations on huge tables.

### Isolation levels and their anomalies
| Level | Prevents | Still allows |
|---|---|---|
| Read uncommitted | (almost nothing) | Dirty reads |
| Read committed (Postgres default) | Dirty reads | Non-repeatable reads, lost updates, write skew |
| Repeatable read / snapshot isolation | Non-repeatable reads, (in Postgres) lost updates | Write skew |
| Serializable | All of the above | Nothing (at a throughput cost, retries on conflict) |
**Write skew example:** two doctors each check "at least one other doctor is on call" and both go off call. Prevent it with `SELECT … FOR UPDATE`, serializable isolation, or a constraint.

## Distributed SQL / NewSQL (Spanner, CockroachDB, YugabyteDB, TiDB)
SQL and ACID transactions with automatic sharding and replication via consensus (Raft/Paxos). Horizontal scaling without hand-made sharding, and multi-region with strong consistency, at the cost of higher write latency (consensus round trips) and operational and cost considerations. Good for global systems needing strong consistency (financial ledgers, inventory across regions).

## Key-value stores (Redis, DynamoDB, Riak, RocksDB embedded)
- **Model:** `get(key)`, `put(key, value)`, sometimes range by sort key.
- **Strengths:** extreme throughput, predictable low latency, simple horizontal partitioning.
- **DynamoDB specifics:** partition key plus optional sort key; queries within one partition by sort-key range; global and local secondary indexes; on-demand or provisioned capacity; single-digit millisecond latency at any scale. Design tables around access patterns, often **single-table design**.
- **Best for:** sessions, carts, user preferences, feature flags, counters, idempotency keys, metadata lookups by ID.

## Document stores (MongoDB, Couchbase, Firestore)
- **Model:** JSON-like documents with flexible schemas; query by fields inside documents; secondary indexes.
- **Strengths:** natural fit for aggregates read and written together (a product with its variants and attributes); fast iteration on schema.
- **Trade-offs:** joins are limited (`$lookup` exists but is costly), so denormalise; multi-document transactions exist but are best avoided at high scale.
- **Best for:** catalogs, content management, user profiles with varying attributes, event payloads.

## Wide-column stores (Cassandra, ScyllaDB, HBase, Bigtable)
- **Model:** rows identified by a **partition key**; within a partition, rows are sorted by **clustering columns**. Sparse columns.
- **Storage:** LSM trees, so writes are sequential and very fast; reads use Bloom filters and compaction.
- **Strengths:** massive write throughput, linear horizontal scaling, multi-datacenter replication, tunable consistency (`ONE`, `QUORUM`, `ALL`).
- **Modelling rule:** one table **per query**, denormalised. `messages_by_conversation (conversation_id, message_id DESC)` serves "latest 50 messages in a conversation" in one partition read.
- **Watch:** no joins, limited secondary indexes, unbounded partitions (bucket by time, e.g. `(conversation_id, month)`), tombstones from deletes.
- **Best for:** messaging, time-ordered events, IoT telemetry, activity feeds, write-heavy logs.

## Search engines (Elasticsearch, OpenSearch, Solr)
Inverted indexes for full-text search, relevance scoring (BM25), fuzzy matching, faceting and aggregations. Usually a **secondary store** fed asynchronously from the source of truth (via CDC or events), so they're eventually consistent. Use for product search, log search and autocomplete.

## Time-series databases (InfluxDB, TimescaleDB, Prometheus, Druid, ClickHouse)
Optimised for append-mostly timestamped data: compression (delta encoding, Gorilla), time-based partitioning, downsampling and retention policies, fast time-range aggregations. Use for metrics, monitoring, IoT and financial ticks.

## Graph databases (Neo4j, Amazon Neptune, JanusGraph)
Nodes and edges with properties; traversal queries ("friends of friends who like X", shortest paths) are efficient regardless of graph size. Use for social graphs, fraud rings, recommendations and knowledge graphs. Many social networks still store graphs in sharded relational or KV stores with application-level traversal.

## Columnar / OLAP warehouses (BigQuery, Snowflake, Redshift, ClickHouse)
Column-oriented storage compresses well and scans only the needed columns, so aggregations over billions of rows are fast. Built for analytics, not transactional updates. Feed them via ETL/ELT or CDC from OLTP systems.

## Vector databases (pgvector, Pinecone, Weaviate, Milvus, OpenSearch k-NN)
Store embeddings and answer approximate nearest-neighbour queries (HNSW, IVF), for semantic search and RAG. Often an extension of an existing store (Postgres + pgvector) rather than a new system.

## Decision guide
| Requirement | Lean towards |
|---|---|
| Multi-row ACID transactions, relationships, flexible queries | Relational (PostgreSQL/MySQL) |
| Global strong consistency + horizontal writes | Distributed SQL (Spanner, CockroachDB) |
| Simple key lookups at huge scale, predictable latency | Key-value (DynamoDB, Redis for in-memory) |
| Aggregates with varying shape, read as a whole | Document (MongoDB) |
| Massive write throughput, time-ordered partitions | Wide-column (Cassandra/Scylla) |
| Full-text search, relevance, facets | Search engine (Elasticsearch/OpenSearch) |
| Metrics and time-range aggregations | Time-series DB |
| Deep relationship traversal | Graph DB |
| Analytics over large history | Columnar warehouse |
| Semantic similarity | Vector index/DB |

## Polyglot persistence and data flow
Real systems combine stores: Postgres for orders (source of truth) → CDC (Debezium) → Kafka → Elasticsearch (search), Redis (cache), ClickHouse (analytics). State clearly **which store is the source of truth** for each piece of data and how others are derived (and how stale they may be).

## Normalisation vs denormalisation
- **Normalised:** no duplication, so updates happen in one place and integrity is easy, but reads need joins.
- **Denormalised:** duplicate data for fast reads (author name stored on each post), but updates fan out and can be temporarily inconsistent.
Read-heavy systems at scale usually denormalise read models while keeping a normalised source of truth.

## Interview questions
1. **SQL or NoSQL for an e-commerce order system?** Relational for orders, payments and inventory (transactions, constraints); NoSQL or a search engine for the catalog and browsing; a cache for hot product pages.
2. **Why Cassandra for chat messages?** Write-heavy, partitioned by conversation, time-ordered reads within a partition, linear scaling and multi-DC replication.
3. **How do you avoid hot partitions in DynamoDB/Cassandra?** High-cardinality partition keys, write sharding (`key#suffix`), and time bucketing.
4. **When would you pick a distributed SQL database?** When you need horizontal write scaling **and** strong consistency/transactions, possibly across regions, and can accept higher write latency.

## Cheat sheet
```
Access patterns → store. Name the source of truth; derive the rest (CDC/events).
Relational: ACID, joins, flexible queries; replicas → partitioning → sharding/distributed SQL
KV: get/put at scale (DynamoDB pk+sk) · Document: flexible aggregates · Wide-column: write-heavy, query-per-table
Search: inverted index (secondary) · Time-series: metrics · Graph: traversals · OLAP: columnar analytics · Vector: ANN
Isolation: RC (lost update/write skew possible) → snapshot → serializable
```
