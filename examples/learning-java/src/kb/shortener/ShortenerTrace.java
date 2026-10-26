package kb.shortener;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Emits the exact states used by public/learning-labs/shortener.html. */
public final class ShortenerTrace {
    private record Step(String title, String time, String authority, String cache,
                        String response, String explanation, String focus) {}
    private record Scenario(String id, String title, String summary, List<Step> steps) {}

    public static void main(String[] args) {
        List<Scenario> scenarios = List.of(revocation(), expiry());
        StringBuilder json = new StringBuilder("{\n  \"source\": \"kb.shortener.ShortenerTrace (Java 21 local model)\",\n  \"scenarios\": [\n");
        for (int i = 0; i < scenarios.size(); i++) {
            if (i > 0) json.append(",\n");
            Scenario scenario = scenarios.get(i);
            json.append("    {\"id\":").append(quote(scenario.id()))
                    .append(",\"title\":").append(quote(scenario.title()))
                    .append(",\"summary\":").append(quote(scenario.summary())).append(",\"steps\":[\n");
            for (int j = 0; j < scenario.steps().size(); j++) {
                if (j > 0) json.append(",\n");
                Step step = scenario.steps().get(j);
                json.append("      {\"title\":").append(quote(step.title()))
                        .append(",\"time\":").append(quote(step.time()))
                        .append(",\"authority\":").append(quote(step.authority()))
                        .append(",\"cache\":").append(quote(step.cache()))
                        .append(",\"response\":").append(quote(step.response()))
                        .append(",\"explanation\":").append(quote(step.explanation()))
                        .append(",\"focus\":").append(quote(step.focus())).append('}');
            }
            json.append("\n    ]}");
        }
        json.append("\n  ]\n}\n");
        System.out.print(json);
    }

    private static Scenario revocation() {
        var clock = new ShortenerChecks.MutableClock();
        var service = new Shortener(clock, () -> "C0000003");
        String code = service.create("teacher", "worksheet",
                new Shortener.Command(ShortenerChecks.DESTINATION, null, null)).code();
        List<Step> steps = new ArrayList<>();
        Shortener.CacheCopy oldRead = service.readAuthority(code);
        steps.add(step("A read obtains an active snapshot", clock, service, code, null,
                "The authority returns version 1. Its permission ends at t=30, measured from this read's start. The response is deliberately held back to expose a race.", "authority"));
        clock.at(5);
        service.revoke("teacher", code);
        steps.add(step("Owner commits revocation", clock, service, code, null,
                "The authoritative mapping becomes revoked version 2. Invalidation removes a cache entry, but cannot cancel the old read already in flight.", "authority"));
        clock.at(6);
        boolean installed = service.install(oldRead);
        steps.add(step("The late version 1 fill arrives", clock, service, code, service.resolve(code),
                "install(oldRead) returned " + installed + ". The selected bounded policy permits this old snapshot until its original t=30 deadline. It does not get a new t=36 deadline.", "cache"));
        clock.at(29);
        steps.add(step("The bounded stale redirect is visible", clock, service, code, service.resolve(code),
                "At t=29 the original permission has not ended, so the service can still issue 302 from the stale cached mapping. This is the policy's accepted limitation.", "response"));
        clock.at(30);
        steps.add(step("At equality the old permission ends", clock, service, code, service.resolve(code),
                "now equals serveUntil, so the old snapshot is rejected. A fresh authority read sees revoked version 2 and produces 410; no stale-on-error extension is allowed.", "response"));
        clock.at(31);
        boolean lateAgain = service.install(oldRead);
        steps.add(step("Replaying the old fill cannot renew it", clock, service, code, service.resolve(code),
                "install(oldRead) now returned " + lateAgain + ". Cache insertion time never grants a fresh lease. A new request still sees 410.", "cache"));
        return new Scenario("revocation", "Revocation races a late cache fill",
                "Follow one old read across revocation. A bounded stale hit is allowed; copying the value never extends its original deadline.", steps);
    }

    private static Scenario expiry() {
        var clock = new ShortenerChecks.MutableClock();
        var service = new Shortener(clock, () -> "A0000001");
        String code = service.create("teacher", "expiring-worksheet",
                new Shortener.Command(ShortenerChecks.DESTINATION, null,
                        ShortenerChecks.T0.plusSeconds(10))).code();
        List<Step> steps = new ArrayList<>();
        steps.add(step("The first redirect caps its cache permission", clock, service, code, service.resolve(code),
                "The active link expires at t=10. min(t=30 lease, t=10 expiry) gives serveUntil t=10, so a cached permission cannot outlive the link.", "authority"));
        clock.at(9);
        steps.add(step("Just before expiry, a cache hit redirects", clock, service, code, service.resolve(code),
                "At t=9 both now < expiresAt and now < serveUntil hold. The service issues 302 with no-store for the browser.", "cache"));
        clock.at(10);
        steps.add(step("Exactly at expiry, redirecting stops", clock, service, code, service.resolve(code),
                "At t=10 the cache permission is unusable. The authoritative row still exists, but now < expiresAt is false, so the service returns 410. Cleanup timing is irrelevant.", "response"));
        clock.at(12);
        Shortener.Created replay = service.create("teacher", "expiring-worksheet",
                new Shortener.Command(ShortenerChecks.DESTINATION, null,
                        ShortenerChecks.T0.plusSeconds(10)));
        steps.add(step("A lost create response replays without revival", clock, service, code, service.resolve(code),
                "The same request replays code " + replay.code() + " (replayed=" + replay.replayed()
                        + "). It creates no new row and does not change expiry. Resolving it still returns 410.", "response"));
        return new Scenario("expiry", "Expiry shortens the same cache permission",
                "A ten-second expiry wins over the thirty-second lease. Request replay returns the original create result without reviving the link.", steps);
    }

    private static Step step(String title, ShortenerChecks.MutableClock clock, Shortener service,
                             String code, Shortener.Resolution result, String explanation, String focus) {
        Shortener.CacheCopy row = service.readAuthority(code);
        String authority = row == null ? "No mapping" : code + " · " + (row.revoked() ? "REVOKED" : "ACTIVE")
                + " · version " + row.version() + " · " + expiryText(row);
        Shortener.CacheCopy copy = service.cached(code);
        String cache = copy == null ? "No cached copy" : (copy.revoked() ? "REVOKED" : "ACTIVE")
                + " · version " + copy.version() + " · serveUntil t="
                + Duration.between(ShortenerChecks.T0, copy.serveUntil()).toSeconds();
        String response = result == null ? "No redirect decision yet" : switch (result.outcome()) {
            case REDIRECT -> "302 redirect · " + result.path() + " · version " + result.version();
            case GONE -> "410 gone · " + result.path() + " · version " + result.version();
            case MISSING -> "404 missing · " + result.path();
            case UNAVAILABLE -> "503 refresh required · " + result.path();
        };
        return new Step(title, "t=" + Duration.between(ShortenerChecks.T0, clock.instant()).toSeconds() + "s",
                authority, cache, response, explanation, focus);
    }

    private static String expiryText(Shortener.CacheCopy row) {
        return row.expiresAt() == null ? "no expiry" : "expires t="
                + Duration.between(ShortenerChecks.T0, row.expiresAt()).toSeconds();
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    }
}
