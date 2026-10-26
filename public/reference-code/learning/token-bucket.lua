-- Redis 7.4.2 teaching baseline. One trusted, versioned policy key; no client-supplied clock.
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local function integer(n) return n and n == math.floor(n) end
if not integer(capacity) or capacity < 1 or capacity > 1000000
  or not integer(rate) or rate < 1 or rate > 1000000
  or not integer(cost) or cost < 1 or cost > capacity then
  return redis.error_reply('invalid bucket policy or cost')
end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local saved = redis.call('HMGET', KEYS[1], 'units', 'last_ms', 'capacity', 'rate')
local cap = capacity * 1000 -- 1000 units = one token; rate units arrive per millisecond.
local units, last = cap, now
if saved[1] or saved[2] or saved[3] or saved[4] then
  units, last = tonumber(saved[1]), tonumber(saved[2])
  if not integer(units) or units < 0 or units > cap or not integer(last) or last < 0
    or last > 9000000000000 or tonumber(saved[3]) ~= capacity or tonumber(saved[4]) ~= rate then
    return redis.error_reply('corrupt bucket or policy version mismatch')
  end
end
local horizon = math.ceil(cap / rate)
local elapsed = math.max(0, now - last)
units = math.min(cap, units + math.min(elapsed, horizon) * rate)
last = math.max(last, now) -- A backwards clock must not move the refill watermark backwards.
local allowed = 0
local needed = cost * 1000
if units >= needed then allowed = 1; units = units - needed end
local debt = last - now
local retry = allowed == 1 and 0 or debt + math.ceil((needed - units) / rate)
-- Deleting a bucket is safe only once it would be full again, including any clock debt.
local ttl = debt + math.ceil((cap - units) / rate) + 1
redis.call('HSET', KEYS[1], 'units', units, 'last_ms', last, 'capacity', capacity, 'rate', rate)
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, units, retry, ttl, now}
