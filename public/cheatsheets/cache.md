---
keyword: CACHE
video: 006-hld-caching-v4
kb_chapter: https://www.codingsaint.com/kb/#/read/hld-caching
title: Caching cheat sheet — Redis in front of your database
---

# Caching cheat sheet: Redis in front of your database

From the reel *"12:00 phone sale. Why won't it load?"* — Coding Saint.

## 1. When a cache helps (and when it doesn't)

| Helps | Doesn't help |
|---|---|
| Many people **reading** the same data (product page, profile, config) | Many people **writing** or buying at once (checkout load, counters) |
| Data that can be a few seconds old | Data that must be exact right now (price at payment, stock, balance) |
| Expensive or slow queries repeated often | Data each user reads once |

Quick test: *if 90% of reads hit a small set of keys, cache them.*

## 2. Cache-aside (the default pattern)

```
read(key):
  value = redis.GET(key)
  if value != null: return value            # hit  (~sub-millisecond)
  value = db.query(key)                     # miss (~milliseconds)
  redis.SET(key, value, EX = ttl_seconds)   # keep a copy with an expiry
  return value
```

- The **app** talks to Redis and the database. Clients never talk to Redis directly.
- Always set a **TTL** (expiry). It is your safety net when everything else fails.

Spring Boot:

```java
@Cacheable(cacheNames = "product", key = "#id")
public Product findProduct(long id) { return repository.findById(id).orElseThrow(); }
```

## 3. Writes: update the database, then delete the copy

```
update(key, value):
  db.update(key, value)
  redis.DEL(key)          # next read refills it with the fresh value
```

- **Delete, don't overwrite**, the cached copy: deleting is simpler and avoids writing a value that a concurrent update just replaced.
- Keep the TTL as a backup in case a delete is missed.
- Caveat: a read that started before your update can still put the old value back. Short TTLs limit how long that lasts; for strict cases use versioned keys or a short delay-and-delete-again.

```java
@CacheEvict(cacheNames = "product", key = "#product.id")
public Product updatePrice(Product product) { return repository.save(product); }
```

## 4. Memory full: eviction policies

Set `maxmemory` and a policy in `redis.conf` (or your managed Redis settings):

| Policy | Removes | Good for |
|---|---|---|
| `allkeys-lru` | least **recently** used | general workloads |
| `allkeys-lfu` | least **frequently** used | a few very hot keys (sales, trending items) |
| `volatile-*` | only keys with a TTL | mixing cache data with keys that must stay |
| `noeviction` | nothing; writes fail | when Redis is a store, not a cache |

A one-off scan (a report reading every product once) **can** push hot keys out under LRU. LFU usually keeps the frequently used ones. Measure with `INFO stats` (`keyspace_hits`, `keyspace_misses`, `evicted_keys`).

## 5. Hot key expires: stop the stampede

When a popular key expires, thousands of requests miss at once and all hit the database.

Fixes (use one or combine):
- **One refill (single-flight / lock):** the first request takes a short lock (`SET lock:key 1 NX EX 5`), reads the database and refills; the others wait briefly and retry the cache.
- **Serve the old copy:** keep a slightly stale value while one request refreshes it in the background.
- **Jitter TTLs:** `ttl = base + random(0..base*0.1)` so keys don't all expire together.
- **Refresh early:** refresh hot keys shortly before they expire.

```java
@Cacheable(cacheNames = "product", key = "#id", sync = true) // one caller loads, the rest wait (per instance)
```

`sync = true` works within one app instance; across many instances use a Redis lock.

## 6. Never trust the cache for money or stock

At checkout, go to the database and do it **in one step**:

```sql
UPDATE stock
SET    quantity = quantity - 1
WHERE  product_id = :id AND quantity > 0 AND price = :expected_price;
-- 1 row updated  -> reserved;  0 rows -> sold out or price changed
```

Check the price and reserve stock in the same transaction, so one item is never sold twice.

## 7. Checklist before you ship a cache

- [ ] Every key has a TTL
- [ ] Writes delete the cached copy after the database commit
- [ ] `maxmemory` + an eviction policy are set (LFU for hot-key workloads)
- [ ] Hot keys are protected from stampedes (lock, stale-while-refresh, TTL jitter)
- [ ] Payments, stock and balances are read and changed in the database, not the cache
- [ ] Hit rate, misses and evictions are on a dashboard

> A cache needs a hit strategy, and a failure strategy.

Read the full chapter: https://www.codingsaint.com/kb/#/read/hld-caching
