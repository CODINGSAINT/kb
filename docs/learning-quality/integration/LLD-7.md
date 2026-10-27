# LLD-7 Cab Booking handoff

Local staged draft only. All new writes stayed under `.learning-work/parallel/LLD-7/`; no canonical source, manifest, lease, Logseq, commit or publication changed. Updated shared-brain startup/adoption/Decisions were read; no duplicate configuration or graph claim was taken.

## Install

- `article.md` -> only LLD-7 markdown in `content/day-07.json`, through parent guarded integration. Problem/Requirements first; six-node `header.txt` supplied.
- `examples/learning-java/src/kb/cab/*.java` -> matching paths: complete Cab core, demo/JSON exporter and checks.
- `public/reference-code/learning/kb/cab/*.java` -> matching paths; exact copies already verified by SHA-256.
- `public/learning-labs/cab.html`, `cab.css`, `cab.js`, `cab-traces.json` -> matching paths, isolated viewer. Back link `../#/t/7/0`; no shared lab.js edits.
- `public/learning-figures/lld-7-assignment.svg`, `lld-7-offer-tokens.svg` -> matching operation assets outside regenerated lessons/.
- `public/designs/lld-7.svg` -> same path or regenerate from header.

Standalone excerpt tags in Cab.java: offer, expiry, cancel, lifecycle, fare. Parent apply script adds Java fences. Full values/helpers are in the downloadable complete source.

## Finished chosen design

One dispatch authority with at most one live trip per rider, one exclusive sequential pending offer per driver/trip, and joint accepted assignment. Candidate lookup is a hint, not ownership. Synthetic city-plane distance ranks available matching-category drivers within 5km and with server-observed position age <10s. Monotonic location sequence rejects old updates. Real map/telemetry authentication is an adapter boundary.

Offers last 15s, within a two-minute search deadline. Accept/decline/expiry use exact offer IDs; a retired O1 cannot release a newer O2 or accepted assignment. A driver's accepted ownership does not expire because location becomes stale or its phone disconnects. The same request does not repeatedly offer a declined driver.

Cancellation uses the observed trip version and exposes the current frozen cancellation quote in TripView: Rs0 before arrival, Rs50 after arrival, unavailable after start. A stale cancellation commits neither state nor fee. Acceptance/cancellation share the same authority and cannot leave an orphan driver.

Rider confirms start after arrival. Completion records trusted synthetic meter evidence, elapsed time and the frozen tariff, assesses one cash fare, then releases only this trip's driver ownership. Old completion replay returns the old trip/fare before touching the driver's later trip. Assessment is not collection.

Example estimate: 2km/5min -> Rs40+24+10=Rs74. Actual 2.1km/eight minutes -> 3 started km -> Rs40+36+16=Rs92. Fractional time is retained before rounding. Event intents are recorded locally; actual pushes/payments do not run under the transition lock.

## Actual focused checks

One Java21 compile and CabChecks run passed:

```text
PASS: 38 checks; request identity, fresh candidates, exclusive offers, expiry tokens, lifecycle/fare, cancellation versions and assignment races
```

The checks exercise request replay/conflict, live-rider limit, location freshness at equality and old sequence rejection, offline/category exclusion, exclusive offers, expiry equality, stale timers/acceptance, accepted-offer replay, search expiry, decline and no immediate reoffer, lifecycle guards/replay, frozen fare and fractional unit rounding, old completion preserving a newer assignment, cancellation quote/version boundary, cancellation-before-accept, two dispatchers competing for D1 and acceptance/cancellation racing.

CabDemo and its JSON exporter ran once, yielding:

```text
expiry: 5 steps; final D1 ON_TRIP, T2
cancel: 4 steps; final D1 AVAILABLE, no current trip
fare: 4 steps; final D1 ON_TRIP, T2 after T1 completion replay
```

Evidence: `.checks/java-checks.txt`, `.checks/java-demo.txt`. Compiled classes stay under `.checks/classes/` and need not be integrated. `node --check public/learning-labs/cab.js` passed. All three SVGs parsed as XML with title/desc; three exact source-download copies passed SHA-256 parity.

Reproduce:

```text
javac --release 21 -encoding UTF-8 -d <classes> examples/learning-java/src/kb/cab/*.java
java -cp <classes> kb.cab.CabChecks
java -cp <classes> kb.cab.CabDemo
java -cp <classes> kb.cab.CabDemo --json
```

Save exporter stdout as UTF-8 `public/learning-labs/cab-traces.json`. There is no CabTrace class; generator is CabDemo --json.

## Limits / next gate

No browser checks, whole-site validation or distinct review were performed by this writer. Parent should check both themes/kb-theme fallback, narrow layout, keyboard controls/transcript, source/back links, current driver ownership versus completed-trip historical references, expiry equality, live cancellation quote versus assessed debt, and old completion preserving T2.

The maps/monitor are not durable or cross-server transactions. Locations, route estimates and meter data are synthetic trusted inputs. The Estimator contract is a pure bounded local computation; a real routing API must run outside the allocation transaction and provide a proposal/quote that is rechecked during claim. Authentication, push delivery, payment collection, emergency workflows, driver cancellation and pooling are excluded. Timeouts use an injected authoritative server clock for reproducibility; no production clock-health or failover guarantee is made.

Primary source reused for exact duration division: Java21 Duration, https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Duration.html . No competitor sources, paid calls or external side effects.

Exact next action: parent integrates and performs consolidated gates/distinct review. Writer hands off this staged topic and proceeds immediately to assigned LLD-8 Food Delivery, with its own WIP.
