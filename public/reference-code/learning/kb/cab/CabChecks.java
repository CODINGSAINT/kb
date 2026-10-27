package kb.cab;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static kb.cab.Cab.*;
import static kb.cab.CabDemo.*;

public final class CabChecks {
    private static int checks;
    public static void main(String[] args) throws Exception {
        identityAndLocation(); expiryAndTokens(); lifecycleAndFare(); cancellation(); dispatchRace(); acceptanceCancellationRace();
        System.out.printf("PASS: %d checks; request identity, fresh candidates, exclusive offers, expiry tokens, lifecycle/fare, cancellation versions and assignment races%n", checks);
    }
    private static void identityAndLocation() {
        Fixture f = fixture(); Service s = f.service(); var t = request(s, "key", "A");
        check(request(s, "key", "A").id().equals(t.id()) && s.trips().size() == 1, "request replay");
        expect(IllegalArgumentException.class, () -> s.request("key", "A", new Point(1, 0), new Point(2_000, 0), Category.STANDARD));
        expect(IllegalStateException.class, () -> request(s, "other", "A"));
        f.time().atMillis(10_000); check(s.offerNext(t.id()).isEmpty(), "location equality at ten seconds is stale");
        check(s.location("D1", 1, new Point(100, 0)), "new location sequence refreshes server observation");
        check(!s.location("D1", 1, new Point(50_000, 0)) && !s.location("D1", 0, new Point(50_000, 0)), "out-of-order location cannot overwrite");
        var o = s.offerNext(t.id()).orElseThrow(); check(o.driverId().equals("D1"), "fresh candidate selected");
        check(s.driverView("D1").state() == DriverState.OFFERED && s.tripView(t.id()).state() == TripState.OFFERED, "offer reserves both sides");
        expect(IllegalStateException.class, () -> s.online("D1", false));
        Fixture categories = fixture(); categories.service().online("D1", false);
        categories.service().addDriver("XL", Category.XL, new Point(1, 0));
        var standard = request(categories.service(), "S", "A");
        check(categories.service().offerNext(standard.id()).isEmpty(), "offline/wrong category excluded");
    }
    private static void expiryAndTokens() {
        Fixture f = fixture(); Service s = f.service(); var a = request(s, "A", "A"); var b = request(s, "B", "B");
        var old = s.offerNext(a.id()).orElseThrow();
        check(!s.expireOffer(old.id()), "not expired before deadline");
        f.time().atMillis(15_000); check(s.accept(old.id(), "D1").decision() == Decision.EXPIRED, "accept rejects expiry equality");
        check(s.driverView("D1").state() == DriverState.AVAILABLE, "expiry releases original offer");
        s.location("D1", 1, new Point(100, 0)); var current = s.offerNext(b.id()).orElseThrow();
        check(!s.expireOffer(old.id()) && s.accept(old.id(), "D1").decision() == Decision.NOT_CURRENT, "old timer and acceptance are inert");
        check(s.driverView("D1").offerId().equals(current.id()), "old event cannot release newer offer");
        check(s.accept(current.id(), "D1").decision() == Decision.ACCEPTED, "current offer accepted");
        check(s.accept(current.id(), "D1").decision() == Decision.REPLAYED && !s.expireOffer(current.id()), "accepted offer replay cannot expire assignment");
        Fixture timeout = fixture(); var waiting = request(timeout.service(), "A", "A"); var pending = timeout.service().offerNext(waiting.id()).orElseThrow();
        timeout.time().atMillis(120_000); check(timeout.service().expireSearch(waiting.id()), "search deadline at equality");
        check(timeout.service().driverView("D1").state() == DriverState.AVAILABLE && timeout.service().accept(pending.id(), "D1").decision() == Decision.NOT_CURRENT, "search timeout retires only its pending ownership");
        Fixture decline = fixture(); var declinedTrip = request(decline.service(), "A", "A");
        var declinedOffer = decline.service().offerNext(declinedTrip.id()).orElseThrow();
        check(decline.service().decline(declinedOffer.id(), "D1") && !decline.service().decline(declinedOffer.id(), "D1"), "decline idempotently releases pending offer");
        check(decline.service().offerNext(declinedTrip.id()).isEmpty() && decline.service().driverView("D1").state() == DriverState.AVAILABLE, "same trip does not repeatedly offer a driver who declined");
    }
    private static void lifecycleAndFare() {
        Fixture f = fixture(); Service s = f.service(); var t = request(s, "A", "A"); var offer = s.offerNext(t.id()).orElseThrow(); s.accept(offer.id(), "D1");
        check(s.tripView(t.id()).estimatedPaise() == 7_400, "2km 5min estimate Rs74");
        expect(IllegalStateException.class, () -> s.start(t.id(), "A"));
        expect(IllegalArgumentException.class, () -> s.arrive(t.id(), "someone-else"));
        s.arrive(t.id(), "D1"); int arrivedVersion = s.tripView(t.id()).version();
        check(s.arrive(t.id(), "D1").version() == arrivedVersion, "arrival replay no extra state transition");
        f.time().atMillis(2_000); s.start(t.id(), "A");
        expect(IllegalStateException.class, () -> s.cancel(t.id(), "A", s.tripView(t.id()).version()));
        s.changeTariff(new Tariff(99_000, 99_000, 99_000, 99_000));
        f.time().atMillis(482_000); var done = s.finish(t.id(), "D1", 2_100);
        check(done.finalPaise() == 9_200 && done.state() == TripState.COMPLETED, "frozen fare Rs92 from trusted meter/time");
        s.location("D1", 1, new Point(100, 0)); var next = request(s, "B", "B"); var nextOffer = s.offerNext(next.id()).orElseThrow(); s.accept(nextOffer.id(), "D1");
        check(s.finish(t.id(), "D1", 2_100).finalPaise() == 9_200 && s.driverView("D1").tripId().equals(next.id()), "old completion cannot release next trip");
        expect(IllegalArgumentException.class, () -> s.finish(t.id(), "D1", 2_101));
        check(fare(RATE, 1_000, Duration.ofMinutes(1)) == 5_400, "exact fare unit boundaries");
        check(fare(RATE, 1_001, Duration.ofMinutes(1).plusNanos(1)) == 6_800, "started units preserve fractional duration");
    }
    private static void cancellation() {
        Fixture f = fixture(); Service s = f.service(); var t = request(s, "A", "A"); var offer = s.offerNext(t.id()).orElseThrow(); s.accept(offer.id(), "D1"); int assigned = s.tripView(t.id()).version(); s.arrive(t.id(), "D1");
        check(s.tripView(t.id()).cancellationQuotePaise() == 5_000, "current version exposes its frozen cancellation amount before approval");
        check(s.cancel(t.id(), "A", assigned).decision() == Decision.STALE_VERSION && s.driverView("D1").state() == DriverState.ON_TRIP, "old cancellation cannot approve new fee boundary");
        var cancelled = s.cancel(t.id(), "A", s.tripView(t.id()).version());
        check(cancelled.trip().cancellationPaise() == 5_000 && s.driverView("D1").state() == DriverState.AVAILABLE, "arrival fee and driver release together");
        check(s.cancel(t.id(), "A", assigned).decision() == Decision.REPLAYED, "cancellation replay does not reassess");
        Fixture before = fixture(); var waiting = request(before.service(), "A", "A"); var pending = before.service().offerNext(waiting.id()).orElseThrow();
        before.service().cancel(waiting.id(), "A", before.service().tripView(waiting.id()).version());
        check(before.service().accept(pending.id(), "D1").decision() == Decision.NOT_CURRENT && before.service().driverView("D1").state() == DriverState.AVAILABLE, "cancel-before-accept leaves no orphan driver");
    }
    private static void dispatchRace() throws Exception {
        Fixture f = fixture(); Service s = f.service(); var a = request(s, "A", "A"); var b = request(s, "B", "B"); CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var x = pool.submit(() -> { start.await(5, TimeUnit.SECONDS); return s.offerNext(a.id()).isPresent(); });
            var y = pool.submit(() -> { start.await(5, TimeUnit.SECONDS); return s.offerNext(b.id()).isPresent(); }); start.countDown();
            check(x.get(5, TimeUnit.SECONDS) != y.get(5, TimeUnit.SECONDS) && s.offers().size() == 1, "one concurrent dispatcher claims the last driver");
        } finally { start.countDown(); }
    }
    private static void acceptanceCancellationRace() throws Exception {
        Fixture f = fixture(); Service s = f.service(); var t = request(s, "A", "A"); var offer = s.offerNext(t.id()).orElseThrow(); int version = s.tripView(t.id()).version(); CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var accept = pool.submit(() -> { start.await(5, TimeUnit.SECONDS); return s.accept(offer.id(), "D1"); });
            var cancel = pool.submit(() -> { start.await(5, TimeUnit.SECONDS); return s.cancel(t.id(), "A", version); }); start.countDown(); accept.get(5, TimeUnit.SECONDS); cancel.get(5, TimeUnit.SECONDS);
            var state = s.tripView(t.id()).state(); var driver = s.driverView("D1");
            check((state == TripState.ASSIGNED && driver.state() == DriverState.ON_TRIP && t.id().equals(driver.tripId()))
                || (state == TripState.CANCELLED && driver.state() == DriverState.AVAILABLE && driver.tripId() == null), "accept/cancel race has one coherent joint result");
        } finally { start.countDown(); }
    }
    private static void expect(Class<? extends Throwable> type, Runnable action) {
        try { action.run(); } catch (Throwable error) { check(type.isInstance(error), "expected " + type.getSimpleName()); return; }
        throw new AssertionError("Expected " + type.getSimpleName());
    }
    private static void check(boolean value, String message) { checks++; if (!value) throw new AssertionError(message); }
}
