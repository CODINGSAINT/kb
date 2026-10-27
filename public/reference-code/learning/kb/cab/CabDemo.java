package kb.cab;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import static kb.cab.Cab.*;

/** Synthetic dispatch scenarios; --json exports actual immutable snapshots. */
public final class CabDemo {
    public static final Instant BASE = Instant.parse("2026-10-27T08:00:00Z");
    public static final Tariff RATE = new Tariff(4_000, 1_200, 200, 5_000);
    public static final class Time extends Clock {
        private Instant instant = BASE;
        public void atMillis(long millis) { instant = BASE.plusMillis(millis); }
        public Instant instant() { return instant; }
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return Clock.fixed(instant, zone); }
    }
    public record Fixture(Time time, Service service) {}
    public static Fixture fixture() {
        Time time = new Time();
        Service service = new Service(time, (pickup, destination) -> new Estimate(2_000, 300), RATE);
        service.addDriver("D1", Category.STANDARD, new Point(100, 0));
        return new Fixture(time, service);
    }
    public static TripView request(Service service, String key, String rider) {
        return service.request(key, rider, new Point(0, 0), new Point(2_000, 0), Category.STANDARD);
    }
    private record Step(String title, String note, long millis, List<TripView> trips,
                         List<DriverView> drivers, List<OfferView> offers, int eventCount) {}
    private record Scenario(String id, String title, List<Step> steps) {}

    public static void main(String[] args) {
        List<Scenario> scenarios = List.of(expiry(), cancellation(), completion());
        if (args.length == 1 && args[0].equals("--json")) { System.out.println(json(scenarios)); return; }
        for (Scenario scenario : scenarios) {
            System.out.println(scenario.title());
            for (Step step : scenario.steps()) System.out.printf("  t=%d %s; D1=%s offer=%s trip=%s%n",
                step.millis(), step.title(), step.drivers().getFirst().state(),
                step.drivers().getFirst().offerId(), step.drivers().getFirst().tripId());
        }
    }

    private static Scenario expiry() {
        Fixture f = fixture(); Service s = f.service(); List<Step> steps = new ArrayList<>();
        var first = request(s, "A", "A"); var second = request(s, "B", "B");
        var old = s.offerNext(first.id()).orElseThrow();
        steps.add(step("O1 temporarily owns D1's offer slot", "A's T1 is OFFERED. B's T2 remains SEARCHING; one driver cannot receive both pending offers.", f));
        f.time().atMillis(15_000); s.expireOffer(old.id());
        steps.add(step("At 15 seconds O1 expires", "Equality is expired. D1 becomes available and T1 returns to search; there is no accepted trip yet.", f));
        s.location("D1", 1, new Point(100, 0)); var current = s.offerNext(second.id()).orElseThrow();
        steps.add(step("D1 receives B's new O2", "A fresh server-observed location is used. O2 is a different ownership token from O1.", f));
        s.expireOffer(old.id()); s.accept(old.id(), "D1");
        steps.add(step("Delayed O1 events arrive", "The old expiry/acceptance cannot release O2 or assign T1. D1 is still exclusively offered to T2.", f));
        s.accept(current.id(), "D1");
        steps.add(step("O2 accepts both ownership changes together", "T2 becomes ASSIGNED and D1 becomes ON_TRIP for T2 in the same transition.", f));
        return new Scenario("expiry", "An old timer cannot release a new offer", List.copyOf(steps));
    }

    private static Scenario cancellation() {
        Fixture f = fixture(); Service s = f.service(); List<Step> steps = new ArrayList<>();
        var t = request(s, "A", "A"); var offer = s.offerNext(t.id()).orElseThrow(); s.accept(offer.id(), "D1");
        int versionBeforeArrival = s.tripView(t.id()).version();
        steps.add(step("A sees the assigned trip", "Before arrival, the selected cancellation fee is zero. A's screen knows this trip version.", f));
        f.time().atMillis(1_000); s.arrive(t.id(), "D1");
        steps.add(step("Driver arrival changes the trip version", "Arrival now makes the chosen cancellation fee Rs 50. It does not start the passenger journey.", f));
        if (s.cancel(t.id(), "A", versionBeforeArrival).decision() != Decision.STALE_VERSION) throw new AssertionError("Old cancellation must conflict");
        steps.add(step("A's old cancellation request is stale", "No fee or cancellation is committed under the old screen version. A must see and approve the current state.", f));
        s.cancel(t.id(), "A", s.tripView(t.id()).version());
        steps.add(step("A confirms the current cancellation", "The trip closes with a Rs 50 amount owed and releases D1. This is not a payment receipt.", f));
        return new Scenario("cancel", "Version checks protect the cancellation boundary", List.copyOf(steps));
    }

    private static Scenario completion() {
        Fixture f = fixture(); Service s = f.service(); List<Step> steps = new ArrayList<>();
        var t = request(s, "A", "A"); var offer = s.offerNext(t.id()).orElseThrow(); s.accept(offer.id(), "D1");
        s.arrive(t.id(), "D1"); f.time().atMillis(2_000); s.start(t.id(), "A");
        steps.add(step("Rider confirms the trip start", "The route fixture estimates 2 km and 5 minutes: Rs 40 + Rs 24 + Rs 10 = Rs 74. Actual fare will use recorded usage.", f));
        f.time().atMillis(482_000); s.finish(t.id(), "D1", 2_100);
        steps.add(step("2.1 km and eight minutes finish once", "Started kilometres are three. Final fare is Rs 40 + 3 x Rs 12 + 8 x Rs 2 = Rs 92. D1 is released; collection is separate.", f));
        s.location("D1", 1, new Point(100, 0)); var next = request(s, "B", "B"); var nextOffer = s.offerNext(next.id()).orElseThrow(); s.accept(nextOffer.id(), "D1");
        steps.add(step("D1 is now assigned to T2", "T1 remains completed history, while T2 owns the driver slot.", f));
        s.finish(t.id(), "D1", 2_100); s.expireOffer(offer.id());
        steps.add(step("T1's completion and timer replay", "T1's saved fare is returned. Neither old operation clears D1's current T2 assignment.", f));
        return new Scenario("fare", "Finish history does not own the driver's next trip", List.copyOf(steps));
    }

    private static Step step(String title, String note, Fixture f) {
        return new Step(title, note, Duration.between(BASE, f.time().instant()).toMillis(),
            f.service().trips(), f.service().drivers(), f.service().offers(), f.service().events().size());
    }
    private static String json(List<Scenario> scenarios) {
        StringBuilder out = new StringBuilder("{\"source\":\"kb.cab.CabDemo --json\",\"scenarios\":[");
        for (int i = 0; i < scenarios.size(); i++) {
            if (i > 0) out.append(','); var scenario = scenarios.get(i);
            out.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title())).append(",\"steps\":[");
            for (int j = 0; j < scenario.steps().size(); j++) {
                if (j > 0) out.append(','); var step = scenario.steps().get(j);
                out.append("{\"title\":").append(q(step.title())).append(",\"note\":").append(q(step.note()))
                    .append(",\"millis\":").append(step.millis()).append(",\"eventCount\":").append(step.eventCount()).append(",\"drivers\":[");
                for (int k = 0; k < step.drivers().size(); k++) {
                    if (k > 0) out.append(','); var d = step.drivers().get(k);
                    out.append("{\"id\":").append(q(d.id())).append(",\"state\":").append(q(d.state().name()))
                        .append(",\"offerId\":").append(q(d.offerId())).append(",\"tripId\":").append(q(d.tripId())).append('}');
                }
                out.append("],\"trips\":[");
                for (int k = 0; k < step.trips().size(); k++) {
                    if (k > 0) out.append(','); var t = step.trips().get(k);
                    out.append("{\"id\":").append(q(t.id())).append(",\"rider\":").append(q(t.riderId()))
                        .append(",\"state\":").append(q(t.state().name())).append(",\"version\":").append(t.version())
                        .append(",\"offerId\":").append(q(t.offerId())).append(",\"driverId\":").append(q(t.driverId()))
                        .append(",\"estimatedPaise\":").append(t.estimatedPaise()).append(",\"finalPaise\":").append(t.finalPaise() == null ? "null" : t.finalPaise())
                        .append(",\"cancellationQuotePaise\":").append(t.cancellationQuotePaise() == null ? "null" : t.cancellationQuotePaise())
                        .append(",\"cancellationPaise\":").append(t.cancellationPaise()).append('}');
                }
                out.append("],\"offers\":[");
                for (int k = 0; k < step.offers().size(); k++) {
                    if (k > 0) out.append(','); var o = step.offers().get(k);
                    out.append("{\"id\":").append(q(o.id())).append(",\"tripId\":").append(q(o.tripId()))
                        .append(",\"driverId\":").append(q(o.driverId())).append(",\"expiresMillis\":").append(Duration.between(BASE, o.expiresAt()).toMillis())
                        .append(",\"state\":").append(q(o.state().name())).append('}');
                }
                out.append("]}");
            }
            out.append("]}");
        }
        return out.append("]}").toString();
    }
    private static String q(String value) { return value == null ? "null" : "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
}
