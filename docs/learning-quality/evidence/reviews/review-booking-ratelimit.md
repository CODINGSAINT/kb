# Independent source review: LLD-4 and HLD-2

Reviewer: Codex subagent `hld_shortener`, 2026-10-26. I did not author the Movie Booking or Rate Limiter articles. This is a separate Codex technical/editorial reading, not Claude review, human review, or a browser acceptance result. No canonical source, writer token, shared ledger, or test fixture was changed. Findings below are source-derived scenarios; I did not rerun tests, Redis containers, browser gates or load tests.

Scope: current LLD-4 markdown in `content/day-04.json`, HLD-2 markdown in `content/day-02.json`, all three booking Java files, all three ratelimit Java files, and `examples/learning-redis/token-bucket.lua`. Markdown line numbers below count the decoded topic's markdown, starting at `## Problem`; these are not JSON physical lines. Existing check reports were not treated as current review proof.

## Findings requiring correction or an explicit narrower contract

### R1 — [P2] The exact traffic-envelope statement needs a clock-resolution qualification

Locations: `content/day-02.json`, HLD-2 markdown line 27; the resolution caveat at line 105; `examples/learning-redis/token-bucket.lua:12`, `:24`–`:26`; `examples/learning-java/src/kb/ratelimit/TokenBucket.java:18`–`:20`.

The prose promises `admitted cost <= starting balance + R*T` for **any** interval of actual seconds. The Redis implementation floors microsecond server time to integer milliseconds and grants a whole millisecond's refill at the next integer boundary. It satisfies the envelope in its sampled integer-time model, rather than an exact continuous-time envelope.

Concrete healthy-primary scenario, without failover or a clock jump: choose supported `C=1`, `R=1000 tokens/s`, cost 1. A first request arrives at physical time `...000999` microseconds within the current second, so `now=...000 ms`; it spends the initially full token. A second arrives one microsecond later at `...001000`, so `now=...001 ms`. `elapsed=1 ms` grants 1000 units and admits a second token. The physical interval is 0.000001 seconds: admitted cost 2 exceeds `1 + 1000*0.000001 = 1.001`. This is the visible effect already hinted at by line 105, but that caveat does not reconcile the unconditional line-27 bound.

Suggested correction: state the exact envelope over the model's integer-millisecond timestamps. For healthy-clock physical time, state the resolution slack explicitly (a conservative refill allowance of up to `R*0.001` tokens beyond the ideal continuous-time bound), and keep forward-jump/failover limitations separate. A finer timestamp/scale can reduce the slack if required. Existing integer-arrival envelope tests at `RatelimitChecks.java:26`–`:31` cannot detect a sub-millisecond physical-time mismatch by construction. No failing execution is claimed here; the counterexample is arithmetic from the actual floor/refill expressions.

### B1 — [P2] The database outline says to lock a request row that does not exist on first use

Locations: `content/day-04.json`, LLD-4 markdown lines 119–134, especially the comment at 122 and the uniqueness explanation at 134. This is a distributed-adapter explanation issue; the local synchronized Java implementation does not have this race.

For a new `(customer_id, request_key)`, there is no customer's request row to lock. A row-level `SELECT ... FOR UPDATE` of a missing row is not a claim on future inserts. Two servers can both find it absent and enter the inventory path. The later uniqueness constraint can still preserve correctness if the losing transaction rolls back all its reservation/seat changes and then reads the winner, but the outline does not specify that branch or how a missing request row becomes lockable.

Suggested correction: add one concrete request-identity protocol. For example, atomically insert a request claim with conflict handling, then lock/read that row, compare the fingerprint and replay a completed result; or explicitly insert the final result in the same inventory transaction and require a request-key loser to roll back the entire cart, then read/compare the winning result in a fresh transaction. Do not imply that naming a nonexistent row in a lock query serializes first requests. Preserve the stated bounded whole-transaction retry and consistent inventory-row ordering.

Suggested parent scenario: two simultaneous same-customer/same-key/same-cart requests both starting with no request row must return one reservation ID; changed-cart input with that key must fail without retaining any losing seat allocation.

### B2 — [P2] The cancellation API promises refund status, but the returned model cannot express it

Locations: `content/day-04.json`, LLD-4 markdown lines 64–65; `examples/learning-java/src/kb/booking/BookingService.java:11`–`:16`, `:124`–`:135`, `:158`.

The stated cancellation response is “terminal reservation + refund status.” `cancel()` returns `Reservation`, whose fields include reservation/payment state but no refund-required/refund-pending indication, captured amount or refund identity. Cancelling a confirmed captured reservation creates a `Refund` in a private map, yet the owner-facing returned snapshot remains only `CANCELLED/CAPTURED`. `pendingRefunds()` exposes a global worker list keyed by charge ID and does not associate its returned entries with a reservation ID. The customer contract therefore has no implemented way to distinguish “refund work recorded” from “no refund work recorded.” Actual refund settlement being out of scope does not require hiding the existence of the intent.

Suggested correction: either return a reservation-scoped refund-intent view/status from cancellation/get, or narrow the endpoint contract explicitly and show how an owner retrieves the pending intent. A boolean/enum such as `NOT_REQUIRED/REFUND_PENDING` is enough for this mechanism; full provider settlement is not necessary. Keep the global worker view internal.

Suggested parent scenario: cancel a confirmed captured reservation twice; both owner-facing results report the same one pending refund intent for the actual captured amount.

### B3 — [P2] The universal late-capture promise has an unowned conflicting-receipt exception

Locations: `examples/learning-java/src/kb/booking/BookingService.java:104`–`:109`; LLD-4 markdown line 23, line 144 diagram alt text, line 156's reconciliation exception, line 202, and closing line 271.

The article does say a conflicting terminal receipt is rejected for reconciliation. However, its requirements/diagram/closing answer broadly say late captures on terminal reservations create refund work, and neither the object nor the stated adapter contract identifies a durable handoff for the conflicting case.

Concrete scenario: begin an attempt, apply `DECLINED` (the reservation becomes `CANCELLED` and releases inventory), then receive an authenticated `CAPTURED` for that same attempt/actual charge. Line 109 throws before recording the charge or refund. A second distinct capture after one accepted capture also throws at 106. These may represent contradictory provider evidence rather than ordinary stale callbacks; blindly confirming or refunding without provider reconciliation is not required. The defect is that “reconcile” has no identified stored work/acknowledgement rule while the general money-handling promise reads as complete.

Suggested correction: explicitly require the authenticated callback adapter to durably quarantine these conflicts for reconciliation before acknowledging delivery, preserving charge/attempt/amount identity, or model a deduplicated reconciliation intent locally. Qualify the late-capture diagram/closing rule to distinguish a first consistent capture from conflicting provider evidence. A thrown exception alone must not be described as recorded refund/reconciliation work. This is a recovery-boundary gap, not a newly found double-booking path.

## Smaller clarity/security observations

- **R2 [P3] Name the script cache.** HLD-2 markdown line 118 says “A cache miss returns NOSCRIPT.” A missing bucket starts full; it is a missing *Redis script-cache entry* that produces NOSCRIPT. Change that phrase so a beginner does not conflate the two kinds of absence.
- **B4 [P3] Keep seat-owner identity in the trace/admin view.** `BookingService.java:17`, `:136`–`:140` returns each holder's `customer` in a public `seats(show)` view. This is useful for the teaching trace but is unnecessary for the stated browse-seat use case. Explicitly mark it internal/diagnostic, or return availability without another customer's identity from the browsing API. There is no implemented HTTP endpoint here, so this observation is not a claim of a deployed information leak.

## Rubric observations for the inspected scope

| Criterion | LLD-4 | HLD-2 | Evidence/limits |
| --- | --- | --- | --- |
| Clarity | `needs_work` | `needs_work` | B2/B3 obscure what the customer/reconciler learns; R1/R2 blur exact versus sampled-time semantics and two kinds of cache miss. The complete opening examples were read. |
| Scope | `passed` | `passed` | Local mechanism versus durable/distributed adapter and operational validation boundaries are stated. No requirement here to implement provider settlement or production Redis topology in the local example. |
| Contracts | `needs_work` | `needs_work` | B1–B3 and R1 need the specific narrowing/protocol corrections above. |
| Correctness | `needs_work` | `needs_work` | No new local double-booking path identified in source reading; B1 is the database-extension gap. R1 is a definite mismatch in the exact wall-time claim. Monetary and capacity arithmetic checked below. |
| Failure handling | `needs_work` | `passed` | B3 needs an explicit durable reconciliation owner. HLD-2 distinguishes timeout, exhaustion, fail-closed outage, replication loss, eviction and forward clock jumps; no distributed failure test was performed by this reviewer. |
| Code | `passed` | `passed` | Complete compilable-looking source and explicit run commands are present; excerpts match the inspected methods. This is static reading, not a new compile or runtime pass. |
| Visual learning | `passed` | `passed` | The trace drivers call the real mechanisms and emit explanatory state; source sequences agree with their normal scenarios. This is source-level trace review only, not browser/asset rendering acceptance. |
| Trade-offs | `passed` | `passed` | Monitor versus row transactions; firm expiry versus grace; token bucket versus window semantics; local versus shared/regional authority and alternative failure policies are answered in the inspected text. |
| Rendering | `needs_work` | `needs_work` | Final browser gates are pending. This reviewer did not inspect themes, clipping, navigation, console errors or current generated-page parity. |

Checked arithmetic by inspection: booking `25,000 + 25,000 = 50,000 paise = ₹500`; wrong-amount refund uses actual capture; exactly 120 seconds expires a held reservation. Rate limiter 2 units/ms gives 500 units at 250 ms and 1 token at 500 ms; the 1,000-capacity/1-token-per-second empty bucket needs 1,000,000 ms plus the extra millisecond before planned expiry; a fixed 60-second expiry would add 940 tokens. Sizing: 2M × 300 B = 600 MB decimal; one replica doubles raw planned state to 1.2 GB; 200k/s × 300 B = 60 MB/s; eight primaries average 25k checks/s before skew. The backwards-clock retry/TTL includes debt and the bounded multiplication stays within the stated supported integer ranges. These checks do not establish production capacities or clock health.

## Snapshot identity and next action

SHA-256 at inspection:

```text
content/day-04.json                                      58521E33A22128799F4ABC982DB59C874411DF19D1AF394943D3472640720A61
content/day-02.json                                      8C6E3A80D3EB44BB3D2349EC7ACB49BA78381FA139A1D0F94CB729D4D1A786F8
examples/learning-java/src/kb/booking/BookingService.java  271A0BF8AEE6FB48A8525CC560532C60F91EA668251CFCB12C108061AAD29EBB
examples/learning-java/src/kb/ratelimit/TokenBucket.java   85FF3F1E4FBDF1B376C16429C9D8BDEC6B46F28E5431D515768E8CC8374E7F83
examples/learning-redis/token-bucket.lua                  3EFDEDC9A6D057DC13A1FC66B9C8041A76065F4BB60CEDC1A32B0AAB18618EB7
```

Parent next action: assess/fix R1 and B1–B3, update excerpts/trace assets if their source changes, add only targeted regression evidence where appropriate, then run the pending consolidated source/generated/browser gates. This review does not mark either topic fully complete.
