package kb.ratelimiterlld;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

// region:api
/** Decides whether one request for a key may go ahead now. */
interface RateLimiter {
    boolean allow(String key);
}
// endregion:api

// region:bucket
/** Holds up to `capacity` tokens and refills at `perSecond`. One request = one token. */
class TokenBucket {
    private final double capacity, perNano;
    private double tokens;
    private long lastNanos;

    TokenBucket(int capacity, double perSecond, long nowNanos) {
        this.capacity = capacity;
        this.perNano = perSecond / 1_000_000_000.0;
        this.tokens = capacity;                         // start full
        this.lastNanos = nowNanos;
    }

    /** Refill and take in one step, so two threads can't spend the same token. */
    synchronized boolean tryTake(long nowNanos) {
        tokens = Math.min(capacity, tokens + (nowNanos - lastNanos) * perNano);
        lastNanos = nowNanos;
        if (tokens < 1) return false;
        tokens -= 1;
        return true;
    }
}
// endregion:bucket

// region:limiter
class TokenBucketLimiter implements RateLimiter {
    private final int capacity;
    private final double perSecond;
    private final LongSupplier clock;                   // System::nanoTime in production
    private final ConcurrentHashMap<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    TokenBucketLimiter(int capacity, double perSecond, LongSupplier clock) {
        this.capacity = capacity; this.perSecond = perSecond; this.clock = clock;
    }

    public boolean allow(String key) {
        long now = clock.getAsLong();
        TokenBucket b = buckets.computeIfAbsent(key,
                k -> new TokenBucket(capacity, perSecond, now));
        return b.tryTake(now);
    }
}
// endregion:limiter

// region:window
/** Alternative: at most `limit` requests in any rolling window. Stores timestamps. */
class SlidingWindowLimiter implements RateLimiter {
    private final int limit;
    private final long windowNanos;
    private final LongSupplier clock;
    private final ConcurrentHashMap<String, Deque<Long>> log = new ConcurrentHashMap<>();

    SlidingWindowLimiter(int limit, long windowMillis, LongSupplier clock) {
        this.limit = limit; this.windowNanos = windowMillis * 1_000_000; this.clock = clock;
    }

    public boolean allow(String key) {
        long now = clock.getAsLong();
        Deque<Long> times = log.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() >= windowNanos) {
                times.pollFirst();                      // drop requests outside the window
            }
            if (times.size() >= limit) return false;
            times.addLast(now);
            return true;
        }
    }
}
// endregion:window

public class RateLimiterDemo {
    public static void main(String[] args) throws Exception {
        long[] now = {0};
        LongSupplier fakeClock = () -> now[0];
        RateLimiter limiter = new TokenBucketLimiter(5, 2.0, fakeClock);   // burst 5, 2/s

        int allowed = 0;
        for (int i = 0; i < 7; i++) if (limiter.allow("asha")) allowed++;
        check(allowed == 5, "burst of 5, then refused");
        check(limiter.allow("bilal"), "each key has its own bucket");

        now[0] = 1_250_000_000L;                        // 1.25 s later: +2.5 tokens
        check(limiter.allow("asha") && limiter.allow("asha"), "2 tokens refilled");
        check(!limiter.allow("asha"), "only 0.5 token left");

        now[0] = 60_000_000_000L;                       // a minute later
        allowed = 0;
        for (int i = 0; i < 10; i++) if (limiter.allow("asha")) allowed++;
        check(allowed == 5, "refill is capped at capacity");

        // 100 threads race for one fresh key: exactly 5 must win
        RateLimiter shared = new TokenBucketLimiter(5, 0.0, fakeClock);
        AtomicInteger wins = new AtomicInteger();
        try (ExecutorService pool = Executors.newFixedThreadPool(16)) {
            for (int i = 0; i < 100; i++) {
                pool.submit(() -> { if (shared.allow("k")) wins.incrementAndGet(); });
            }
        }
        check(wins.get() == 5, "no token spent twice");

        RateLimiter window = new SlidingWindowLimiter(3, 1000, fakeClock);
        now[0] = 0;
        check(window.allow("c") && window.allow("c") && window.allow("c"), "3 in the window");
        check(!window.allow("c"), "4th refused");
        now[0] = 1_000_000_000L;
        check(window.allow("c"), "oldest left the window");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
