package kb.shortener;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

/** Deterministic mechanism checks, including the stale-fill interleaving. */
public final class ShortenerChecks {
    static final Instant T0 = Instant.parse("2026-10-26T10:00:00Z");
    static final String DESTINATION = "https://example.com/course?lesson=1";

    public static final class MutableClock extends Clock {
        private volatile Instant now = T0;
        public void at(long seconds) { now = T0.plusSeconds(seconds); }
        @Override public Instant instant() { return now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now, zone); }
    }

    private static Shortener service(MutableClock clock, String... candidates) {
        ArrayDeque<String> queue = new ArrayDeque<>(List.of(candidates));
        return new Shortener(clock, queue::removeFirst);
    }
    private static Shortener.Command command(Instant expiry) {
        return new Shortener.Command(DESTINATION, null, expiry);
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static void problem(int expected, Runnable task) {
        try { task.run(); throw new AssertionError("Expected HTTP-equivalent " + expected); }
        catch (Shortener.Problem problem) { check(problem.status() == expected, problem.getMessage()); }
    }

    public static void main(String[] args) throws Exception {
        MutableClock clock = new MutableClock();
        Shortener shortener = service(clock, "A0000001", "A0000001", "B0000002");
        Shortener.Created first = shortener.create("owner", "r1", command(T0.plusSeconds(10)));
        Shortener.Created second = shortener.create("owner", "r2", command(null));
        check(second.code().equals("B0000002"), "Collision must retry, never overwrite");
        problem(409, () -> shortener.create("owner", "r1", command(null)));
        problem(404, () -> shortener.revoke("other-owner", first.code()));
        check(shortener.resolve(first.code()).outcome() == Shortener.Outcome.REDIRECT, "Active redirects");
        clock.at(10);
        check(shortener.resolve(first.code()).outcome() == Shortener.Outcome.GONE, "Expiry is exclusive");
        check(shortener.create("owner", "r1", command(T0.plusSeconds(10))).replayed(),
                "Same request replays after expiry; no new link");
        check(shortener.mappingCount() == 2, "Replays and collisions do not add extra rows");
        problem(409, () -> shortener.create("owner", "alias-1",
                new Shortener.Command(DESTINATION, first.code(), null)));

        clock.at(0);
        Shortener stale = service(clock, "C0000003");
        String code = stale.create("owner", "r3", command(null)).code();
        Shortener.CacheCopy oldRead = stale.readAuthority(code);
        clock.at(5);
        stale.revoke("owner", code);
        clock.at(6);
        check(stale.install(oldRead), "The example deliberately allows a late old fill");
        check(stale.cached(code).serveUntil().equals(T0.plusSeconds(30)), "Fill must preserve deadline");
        check(stale.resolve(code).outcome() == Shortener.Outcome.REDIRECT, "Bounded stale hit is explicit");
        clock.at(30);
        check(!stale.install(oldRead), "Deadline rejects old copy at equality");
        check(stale.resolve(code).outcome() == Shortener.Outcome.GONE, "Refresh sees committed revoke");
        problem(409, () -> stale.create("owner", "new-request",
                new Shortener.Command(DESTINATION, code, null)));

        clock.at(0);
        Shortener concurrent = service(clock, "D0000004");
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks = new ArrayList<Callable<String>>();
            for (int i = 0; i < 32; i++)
                tasks.add(() -> concurrent.create("owner", "same-request", command(null)).code());
            for (var future : executor.invokeAll(tasks))
                check(future.get().equals("D0000004"), "Concurrent request IDs share one result");
        }
        check(concurrent.mappingCount() == 1, "One local transaction wins");

        clock.at(0);
        Shortener exhausted = new Shortener(clock, () -> "E0000005");
        exhausted.create("owner", "once", command(null));
        problem(503, () -> exhausted.create("owner", "twice", command(null)));
        check(exhausted.mappingCount() == 1, "Exhaustion never overwrites an occupied code");
        problem(400, () -> exhausted.create("owner", "bad",
                new Shortener.Command("javascript:alert(1)", null, null)));
        System.out.println("PASS: collision retry, request fingerprint/replay, ownership, exact expiry, stale-fill deadline, no reuse, 32-way local replay, exhaustion, URL validation");
    }
}
