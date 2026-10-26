# Final HLD review — same article lot

Reviewer: Codex subagent that did not author HLD-1, HLD-3 or HLD-4. Canonical files were not edited. Inspected their current article contracts and Java core/check sources; inspected NotificationTrace as well. No full suite, browser/build, real provider, database, Redis, broker, clock-health or failover test was run by this reviewer.

## HLD-4: an authorization can outlive the safe replay window

Sources: `examples/learning-java/src/kb/notification/DispatchEngine.java:19`, `:93`, `:101`, `:146`; `examples/learning-java/src/kb/notification/FakeProvider.java:22`–`:35`. Article sections “A provider can accept before a timeout” and “Classify outcomes and spend a bounded retry budget” say an expired replay window stops automatic replay.

Concrete executed scenario:

1. At t=0 the fake provider accepts the first request but returns UNKNOWN. Its 60-second replay record expires at t=60,000.
2. At t=59,000 worker B claims and authorizes a retry. `safeReplay` passes; B's claim lease lasts to t=89,000.
3. B pauses before calling the provider. At t=61,000 it sends the returned Attempt.
4. Attempt carries neither notification expiry nor provider-replay deadline. FakeProvider sees an expired replay record and creates another acceptance; complete accepts B's still-live epoch.

Observed output:

```text
late replay: authorized=59000 sent=61000 physicalAcceptances=2 state=PROVIDER_ACCEPTED
```

This needs no clock rollback, lost lease or changed payload. The checked window is at authorization, rather than actual dispatch/arrival, so the mechanism does not establish the article's automatic-replay stopping rule.

Correction: carry a conservative not-after deadline in Attempt, including notification expiry and the original provider replay limit. Reject an authorized-but-not-yet-dispatched attempt once that deadline is unusable. The adapter must also reserve a documented margin for dispatch/transport/clock uncertainty; if provider arrival cannot be bounded safely, quarantine rather than claim safe replay. Explicitly retain the limitation for calls already in flight; a local check cannot recall a request or guarantee arrival within a remote retention window. Add this pause-across-deadline case to the focused checks.

## HLD-4: business obsolescence is described as a fresh gate but is absent from the Java model

Sources: `DispatchEngine.java:16`–`:17`, `:63`, `:93`–`:106`. The article requires current obsolescence checking before each attempt and specifically says version10 cancellation must suppress an unattempted version9 reminder.

`Draft` has an opaque event ID but no aggregate identity/version or usefulness state. There is no method to update/check current order state. `authorize` checks channel preference, target, expiry, attempt budget and replay safety only.

A focused probe enqueued `OrderReady/O847/v9`, then `OrderCancelled/O847/v10`, and was still able to authorize the old ready delivery:

```text
obsolescence representation: old ready authorized after newer cancellation enqueued=true
```

Enqueuing a later notification is not itself proposed as a universal cancellation protocol; the defect is that this model has no representation or authority hook for the required gate. A newer event's encoded string cannot make the existing code compare business versions.

Correction: add explicit aggregate/version/usefulness data and a current authority checked at authorization, scoped to the relevant order so unrelated orders do not suppress one another. Alternatively, explicitly list this gate as omitted from the local mechanism and do not present the Java gate/tests as evidence that obsolete reminders are suppressed. The overall design still needs the stated authority and ordering contract.

## HLD-1 URL Shortener

No concrete defect found within inspected scope: owner-scoped create replay, collision handling, immutable response facts, exact expiry, late-fill deadlines, primary-read requirements, transaction conflict notes and conditional clock/failover promises were checked against Shortener.java and ShortenerChecks.java. This is not verification of the described PostgreSQL/Redis adapters, replication durability, distributed clock bound or operational failover.

## HLD-3 Distributed Cache

No concrete defect found within inspected scope: generation/version fences, slot incarnation after eviction, payload/slot bounds, defensive values, elapsed-time expiry and the described preserved-duration replica/L1 policy were checked against BoundedCache.java and CacheChecks.java. The article explicitly limits the Java proof to one node and does not claim implemented membership/replication/failover. No distributed execution or performance guarantee was verified here.

## Focused evidence

Only DispatchEngine.java, FakeProvider.java and a small review probe were compiled and run; no existing test-suite main was executed. Probe and stdout are saved under `.learning-work/parallel/.review-hld-final/ReviewHldProbe.java` and `probe-output.txt`. Canonical source and articles remain unchanged. Review complete; no new article or queued topic was started.
