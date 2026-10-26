import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

/** Java 21, no dependencies or model keys. Mechanism examples, not full products. */
public final class ReferenceInvariants {
    record Interval(Instant start, Instant end) {
        Interval {
            if (start == null || end == null || !start.isBefore(end))
                throw new IllegalArgumentException("Require start < end");
        }
        boolean overlaps(Interval other) {
            return start.isBefore(other.end) && other.start.isBefore(end);
        }
    }

    // Stable input order decides who receives the remaining minor units.
    static List<Long> equalShares(long amountMinor, int members) {
        if (amountMinor < 0 || members < 1 || members > 10_000)
            throw new IllegalArgumentException("Invalid amount/member count");
        long base = amountMinor / members, remainder = amountMinor % members;
        var result = new ArrayList<Long>(members);
        for (int i = 0; i < members; i++) result.add(base + (i < remainder ? 1 : 0));
        return List.copyOf(result);
    }

    static final class SeatHold {
        private String owner;
        private Instant expiresAt;
        private boolean booked;
        // One aggregate in one JVM. A distributed system needs shared durable CAS/transactions.
        synchronized boolean claim(String holdId, Instant now, Instant until) {
            if (holdId == null || holdId.isBlank() || now == null || until == null || !now.isBefore(until))
                throw new IllegalArgumentException("Invalid hold");
            if (booked) return false;
            // Replay does not extend the original lease.
            if (holdId.equals(owner) && now.isBefore(expiresAt)) return true;
            if (owner != null && now.isBefore(expiresAt)) return false;
            owner = holdId; expiresAt = until;
            return true;
        }
        synchronized boolean confirm(String holdId, Instant now) {
            if (holdId == null || now == null) throw new IllegalArgumentException();
            if (booked) return holdId.equals(owner); // idempotent same-owner replay
            if (!holdId.equals(owner) || !now.isBefore(expiresAt)) return false;
            booked = true;
            return true;
        }
        synchronized boolean releaseExpired(String holdId, Instant now) {
            if (holdId == null || now == null) throw new IllegalArgumentException();
            if (booked || !holdId.equals(owner) || now.isBefore(expiresAt)) return false;
            owner = null; expiresAt = null;
            return true;
        }
    }

    static final class TokenBucket {
        private final long capacity;
        private final double refillPerSecond;
        private final LongSupplier nanos;
        private double tokens;
        private long last;
        TokenBucket(long capacity, double refillPerSecond, LongSupplier nanos) {
            if (capacity < 1 || !Double.isFinite(refillPerSecond) || refillPerSecond <= 0 || nanos == null)
                throw new IllegalArgumentException("Invalid bucket policy");
            this.capacity = capacity; this.tokens = capacity;
            this.refillPerSecond = refillPerSecond; this.nanos = nanos; last = nanos.getAsLong();
        }
        synchronized boolean acquire(long cost) {
            if (cost < 1 || cost > capacity) throw new IllegalArgumentException("Invalid token cost");
            long now = nanos.getAsLong(), elapsed = now - last;
            if (elapsed < 0) throw new IllegalStateException("Clock regressed or unsupported interval");
            tokens = Math.min(capacity, tokens + elapsed / 1_000_000_000d * refillPerSecond);
            last = now;
            if (tokens < cost) return false;
            tokens -= cost;
            return true;
        }
    }

    record ContextBudget(long window, long instructions, long history, long output, long margin) {
        ContextBudget {
            if (window <= 0 || instructions < 0 || history < 0 || output < 0 || margin < 0)
                throw new IllegalArgumentException("Invalid context allowance");
        }
        long evidenceAllowance() {
            long used = Math.addExact(Math.addExact(instructions, history), Math.addExact(output, margin));
            if (used > window) throw new IllegalArgumentException("Context exhausted");
            return window - used;
        }
    }

    static double cosine(double[] left, double[] right) {
        if (left.length == 0 || left.length != right.length) throw new IllegalArgumentException("Dimensions");
        double dot = 0, a = 0, b = 0;
        for (int i = 0; i < left.length; i++) {
            if (!Double.isFinite(left[i]) || !Double.isFinite(right[i])) throw new IllegalArgumentException("Nonfinite");
            dot += left[i] * right[i]; a += left[i] * left[i]; b += right[i] * right[i];
        }
        if (a == 0 || b == 0 || !Double.isFinite(dot) || !Double.isFinite(a) || !Double.isFinite(b))
            throw new IllegalArgumentException("Zero or overflowing norm");
        // sqrt separately to avoid overflowing a*b for otherwise representable norms.
        return dot / Math.sqrt(a) / Math.sqrt(b);
    }

    enum Outcome { COMPLETE, BUDGET_EXHAUSTED }
    interface Step { boolean performAuthorizedStep(int index); }
    static Outcome boundedRun(int maxSteps, long deadlineNanos, LongSupplier clock, Step step) {
        if (maxSteps < 0 || clock == null || step == null) throw new IllegalArgumentException();
        for (int i = 0; i < maxSteps; i++) {
            if (clock.getAsLong() - deadlineNanos >= 0) return Outcome.BUDGET_EXHAUSTED;
            if (step.performAuthorizedStep(i)) return Outcome.COMPLETE;
        }
        return Outcome.BUDGET_EXHAUSTED;
    }

    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static void rejects(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException | IllegalStateException | ArithmeticException expected) { return; }
        throw new AssertionError("Expected rejection");
    }
    static void race(int workers, Callable<Boolean> action, int expected) throws Exception {
        var barrier = new CyclicBarrier(workers);
        try (var pool = Executors.newFixedThreadPool(workers)) {
            List<Future<Boolean>> futures = new ArrayList<>();
            for (int i = 0; i < workers; i++) futures.add(pool.submit(() -> { barrier.await(); return action.call(); }));
            int winners = 0;
            for (var f : futures) if (f.get()) winners++;
            check(winners == expected, "Race winners: " + winners);
        }
    }
    public static void main(String[] args) throws Exception {
        var t = Instant.parse("2026-01-01T00:00:00Z");
        var first = new Interval(t, t.plusSeconds(60));
        check(!first.overlaps(new Interval(t.plusSeconds(60), t.plusSeconds(90))), "Half-open adjacency");
        check(first.overlaps(new Interval(t.plusSeconds(30), t.plusSeconds(90))), "Overlap");
        rejects(() -> new Interval(t, t));
        check(equalShares(100, 3).equals(List.of(34L, 33L, 33L)), "Remainder conservation");
        for (long amount = 0; amount < 1_000; amount++) {
            for (int n = 1; n <= 15; n++) {
                long sum = equalShares(amount, n).stream().mapToLong(Long::longValue).sum();
                check(sum == amount, "Conservation");
            }
        }
        var hold = new SeatHold();
        check(hold.claim("A", t, t.plusSeconds(10)), "Initial hold");
        check(!hold.claim("B", t, t.plusSeconds(10)), "Exclusive owner");
        check(hold.claim("B", t.plusSeconds(10), t.plusSeconds(20)), "Expiry boundary");
        check(!hold.releaseExpired("A", t.plusSeconds(11)), "Stale worker cannot release B");
        check(!hold.confirm("A", t.plusSeconds(11)), "Late A callback");
        check(hold.confirm("B", t.plusSeconds(11)), "Current owner confirms");
        check(hold.confirm("B", t.plusSeconds(30)), "Confirmed replay");
        check(!hold.claim("C", t.plusSeconds(40), t.plusSeconds(50)), "Booked cannot be reclaimed");
        long[] clock = {0};
        var bucket = new TokenBucket(1, 1, () -> clock[0]);
        race(24, () -> bucket.acquire(1), 1);
        clock[0] = 500_000_000L;
        check(!bucket.acquire(1), "Fractional refill");
        clock[0] = 1_000_000_000L;
        check(bucket.acquire(1), "One second refill");
        clock[0] = 900_000_000L;
        rejects(() -> bucket.acquire(1));
        check(new ContextBudget(16_000,1_000,3_000,2_000,1_000).evidenceAllowance() == 9_000, "Context arithmetic");
        rejects(() -> new ContextBudget(10,5,5,1,0).evidenceAllowance());
        rejects(() -> new ContextBudget(Long.MAX_VALUE,Long.MAX_VALUE,1,1,0).evidenceAllowance());
        check(Math.abs(cosine(new double[]{1,0},new double[]{1,0}) - 1) < 1e-12, "Cosine identical");
        check(cosine(new double[]{1,0},new double[]{0,1}) == 0, "Cosine orthogonal");
        rejects(() -> cosine(new double[]{0,0},new double[]{1,0}));
        rejects(() -> cosine(new double[]{1},new double[]{1,2}));
        AtomicInteger steps = new AtomicInteger();
        check(boundedRun(3,100,() -> 0,i -> {steps.incrementAndGet(); return false;}) == Outcome.BUDGET_EXHAUSTED, "Loop bound");
        check(steps.get() == 3, "Exactly three steps");
        check(boundedRun(3,100,() -> 100,i -> {throw new AssertionError();}) == Outcome.BUDGET_EXHAUSTED, "Deadline before action");
        check(boundedRun(3,100,() -> 0,i -> i == 1) == Outcome.COMPLETE, "Early success");
        System.out.println("PASS: intervals, 15,000 conservation cases, hold ownership/expiry, 24-thread bucket race, context bounds, cosine and bounded loop");
    }
}
