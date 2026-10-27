# LLD-6 Car Rental handoff

Local staged draft only. All writes stayed under `.learning-work/parallel/LLD-6/`. Parent owns guarded integration, manifest, lease, Logseq and distinct review. No shared source or publishing/commit action was performed.

## Install

- `article.md` -> only LLD-6 markdown in `content/day-06.json`; Problem/Requirements are first. Exact source placeholders are standalone (`#reserve`, `#pickup`, `#return`, `#price`, `#cancel`); parent expansion supplies fences.
- `header.txt` -> six-node campaign header input.
- `examples/learning-java/src/kb/rental/*.java` -> matching worktree paths (Rental, RentalDemo, RentalChecks).
- `public/reference-code/learning/kb/rental/*.java` -> matching downloadable source paths; byte-identical copies provided.
- `public/learning-labs/rental.html`, `rental.css`, `rental.js`, `rental-traces.json` -> matching paths. Standalone lab, no shared lab.js change. Back link `../#/t/6/0`.
- `public/learning-figures/lld-6-intervals.svg`, `lld-6-readiness.svg` -> matching paths, outside regenerated legacy lessons/.
- `public/designs/lld-6.svg` -> matching overview, or parent may regenerate from header.txt.

## Implemented scope and decisions

One branch and specifically allocated vehicles. The interval is `[start,end+1h preparation)`, with strict half-open overlap. Search/quote are not reservations; confirmation rechecks under the allocation boundary. Five-minute quotes bind customer/asset/dates/immutable tariff. Replay is customer-scoped and survives quote expiry for the existing reservation.

Actual handover is separate from the future promise. Pickup requires readiness/no current owner and the half-open 30-minute grace window. Returns identify their reservation/agreement, preserve readings/invoice, then clear only their own physical ownership. Old returns/no-show jobs cannot clear the later owner. Damaged returns require maintenance; preparation still applies after its flag is cleared.

Price policy is explicit: Rs1800 per started 24h planned period; booked base remains on early return; Rs200 per started late hour; cancellation before start is free and after start before pickup is Rs500. Operator unreadiness overrides the cancellation fee and prevents a customer no-show disposition. Late promises remain visible; the complete selected remedy is free cancellation, not an automatic replacement algorithm. Invoice assessment is implemented; actual payment/deposit/tax/fuel/damage charging is not included.

## Actual focused checks

One Java21 compile and one RentalChecks execution passed:

```text
PASS: 29 checks; interval/preparation, quotes, exact price boundaries, owner-bound handover/return, cancellation and concurrent allocation
```

Checks cover nested and touching intervals/preparation, quote expiry and replay, frozen rate/quote ownership, exact 24h and nanosecond boundary, 49h price, late-hour rounding, early-return base preservation, pickup replay, wrong odometer, cancellation after pickup, old return/no-show events, grace equality, company unreadiness, late return charge and two simultaneous reservations for the same car/window.

`RentalDemo` and its JSON exporter ran successfully. Three source-derived cases:

```text
boundary: 3 steps, two non-overlapping promises after preparation
late: 5 steps, R1 returned; R2 freely cancelled; actual ready-at 13:10
replay: 3 steps, final physical owner R2 after stale R1 events
```

Evidence is `.checks/java-checks.txt` and `.checks/java-demo.txt`; temporary classes stay under `.checks/classes/`. After the check pass, only the replay scenario title was changed from “barcode” to “vehicle ID”; its exporter is refreshed without repeating behavior checks.

`node --check public/learning-labs/rental.js` passed. All three SVGs parsed as XML with title/desc. Three source downloads were exported and compared by SHA-256.

Reproduce from repository root:

```text
javac --release 21 -encoding UTF-8 -d <classes> examples/learning-java/src/kb/rental/*.java
java -cp <classes> kb.rental.RentalChecks
java -cp <classes> kb.rental.RentalDemo
java -cp <classes> kb.rental.RentalDemo --json
```

Save final stdout as `public/learning-labs/rental-traces.json`. There is no RentalTrace class; generator is RentalDemo --json.

## Limits / next gate

No browser, full-site validation or distinct content review was performed by this writer. Parent should check both themes, narrow layout, keyboard controls/transcript, source/asset/back links, interval bars versus actual owner, and old-return/current-owner states after integration.

The one-process map/lock does not provide durable or multi-server scheduling. Real identity/licence verification and physical handover are trusted adapter boundaries; payment network work is excluded. Clock is injected for deterministic business instants, not a clock-health guarantee. Durable integration must preserve replay records, vehicle schedule transitions, actual agreement and invoice facts in its chosen transaction authority. No SQL/constraint/failover implementation or production performance claim is made.

Primary reference: Java21 Duration https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Duration.html confirms whole-duration division and 24-hour duration-day semantics. No competitor links or paid calls.

Exact next action: parent integrates and runs consolidated gates/review. Writer hands off this draft and proceeds to assigned LLD-7 Cab Booking in a new isolated stage.
