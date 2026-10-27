> Historical twelve-article delivery. Current 27 October batch/push and pause state: [PUSH-REPORT-20261027.md](PUSH-REPORT-20261027.md).

# Twelve-article local review delivery

The owner narrowed the broader campaign to twelve articles and requested a local commit, Logseq handoff and stop. This report covers that lot. The other 45 first-pass references are deferred; this is not completion of the original 57-topic campaign. Fundamentals and the accepted Chess, Parking Lot and Elevator answers remain unchanged by hash.

Review folder: `C:/Users/07pal/OneDrive/Documents/New project/kb-learning-quality/`. Branch: `codex/kb-learning-quality-review`. The delivery is a local review commit; `git log -1` identifies it and the shared Logseq handoff records its actual hash after creation. No push, PR, merge or publication is part of this delivery. The original checkout and deployed website were not updated with this lot.

## What changed

Each answer begins with a concrete case, chooses and completes a design, explains its contracts and important failures, includes copyable code and answered follow-ups, and distinguishes the teaching mechanism from unimplemented production adapters. BENCHMARK.md records the three representative Fundamentals samples reviewed before writing. RUBRIC.md defines the nine review criteria; per-topic evidence records generation, validation and critical reading separately.

| Article | Main learning improvement | Interactive explanation |
| --- | --- | --- |
| LLD-4 Movie Booking | Whole-cart holds, fixed quote, payment outside the inventory lock, refund/reconciliation ownership | Step through both seat-race winners and a late capture without releasing the new owner |
| LLD-5 ATM | Exact bounded note planning, bank holds and uncertain physical cash outcomes | Five bank, dispenser and settlement histories |
| LLD-9 Library | Edition versus copy, loan ownership, FIFO pickup tokens, renewals and calendar-day fines | Follow a copy and hold queue, including stale ownership tokens |
| LLD-16 Tic-Tac-Toe | One move boundary, immutable snapshots, optimistic version and win-before-draw | Recorded Java games plus separately labelled browser play/invalid/stale-move mode |
| HLD-1 URL Shortener | Workload assumptions, collision/replay protocol, anchored cache permissions and bounded revocation | Follow collision handling, a lost create response and a delayed cache fill |
| HLD-2 Rate Limiter | Integer token accounting, sampled-clock envelope, expiry horizon and failure policy | Watch refill, spending, rejection and retry decisions |
| HLD-3 Distributed Cache | Database authority, invalidation versions, slot incarnation and bounded node memory | Delayed fill, invalidation and eviction/recreation histories |
| HLD-4 Notification System | Durable event/delivery identity, fresh authorization, claims, uncertain acceptance and reconciliation | Step through acceptance with a lost response, claim recovery and read-only lookup |
| AI-1 AI/LLM Fundamentals | Training/inference, tokens, retrieval, context, sampling and evidence are explained separately | Change toy temperature/probabilities and inspect a context budget |
| AI-6 Spring AI Fundamentals | A complete offline endpoint leads into dependency management, conditional wiring and provider selection | Follow offline and optional Ollama profile wiring |
| AI-7 ChatClient | Construction versus invocation, one response with usage, conversion and stream completion | Recorded Java invocation/conversion timelines |
| AI-8 Structured Output | Strict shape, exact value checks and factual review are separate gates | Five labelled illustrative receipt cases, including plausible but wrong facts |

The walkthroughs use manual stepping, text fallbacks and ordinary HTML/SVG. Nothing autoplays. Recorded histories come from the checked Java mechanisms where stated. The toy AI, Spring wiring and receipt illustrations are explicitly labelled; they are not live model evaluations. Code remains selectable text. LOCAL-REVIEW.md lists every application and walkthrough route.

## Validation evidence

Final consolidated commands ran successfully on 2026-10-26 UTC. `validation-commands.json` contains argument arrays; `evidence/lot-command-output.json` retains their actual output and hashes. `lot-checks.json` and per-topic `*-checks.json` bind the results to current inputs. `lot-runtime.json` consolidates dated service/browser observations without claiming it reran those services.

- Java 21 compiled all offline mechanisms and emitted the downloadable sources and trace data. Checks include 111 booking checks with 40 rounds of 40 contenders, 8,833 token-bucket checks, 119,800 Tic-Tac-Toe checks across 5,478 legal positions, 2,389 ATM checks, 46 library checks, and focused shortener/cache/notification/AI arithmetic checks. Counts measure exercised cases, not course quality or distributed guarantees.
- Three Spring projects were packaged/tested offline against **Spring AI 1.1.8, Boot 3.5.15 and Java 21**: ChatClient 19 tests, Fundamentals 6, Structured Output 15; **40 tests, zero failures/errors/skips** in the actual Surefire reports. This is a reproducible teaching baseline, not a latest-version claim. The final evidence checker parses those existing runs rather than rerunning Maven.
- Six loopback HTTP checks exercised the packaged ChatClient application, including text, structured response, SSE and invalid input. The app used explicit offline fixtures; provider calls were zero.
- An earlier isolated execution against pinned **Redis 7.4.2** passed 19 Lua checks. The final Lua hash matches that report. These are single-primary functional tests, not replication/failover or throughput evidence.
- **96 final browser states**: twelve articles and twelve walkthroughs, light/dark, 1280px/390px. Actual theme controls and walkthrough controls were exercised; reference contents links kept their route and scrolled correctly. No broken images or page-wide overflow were observed. Measured table-cell contrast was at least **9.96:1** across this matrix. Representative screenshots were visually inspected; the matrix is not a full assistive-technology audit.
- Integrity checks covered twelve topics, 82 unique local assets, 36 exact source excerpts, Java/Spring source-download parity, source ZIP safety, source/generated content parity, navigation/prerequisite structure, eleven JavaScript syntax checks, ten guarded-writer tests, static-site safety build and whitespace. The build still contains 60 design topics, 45 chapters and 304 DSA problems.
- All 48 out-of-lot reference documents match their initial topic hashes, including the three protected accepted examples. Protected Fundamentals files also match. No customer-facing competitor links or code screenshots were added to this lot.

For reproduction, use the project README commands under each `examples/learning-*` folder. Run the three Maven projects' offline `package` command after their dependencies are cached, then the commands in `validation-commands.json`. Browser checks use the local preview and the isolated Playwright CLI definition in `browser/lot.js`. These checks never require a paid provider. A fresh machine needs Java 21, Maven, Node, Python and the browser tooling/dependencies first.

## Critical review and corrections

Final `*-review.json` files record observations for each rubric criterion. The primary performed the final reading after checks. Separate Codex readers inspected selected articles they had not authored; their original findings remain under `evidence/reviews/`. No human or Claude review/acceptance is claimed. A passing rubric is a scoped engineering assessment, not a prediction that a learner will be selected in an interview.

RESOLVED-FINDINGS.md records substantive corrections: nonexistent request-row locking; missing reservation refund status; contradictory receipt reconciliation; physical versus sampled clock bounds; empty-stream success and user-text fixture routing; and notification attempts delayed beyond provider retention. The notification fix uses a documented **read-only lookup** after uncertainty, rather than claiming a local deadline can guarantee remote arrival before an idempotency record expires. An explicit trusted obsolescence marker now gates old reminders.

No known critical defect remains in the checked local mechanisms within their stated scope. Database transaction adapters, broker/outbox durability, remote provider semantics, distributed failover, operational SLAs, production throughput, live Ollama/model generation and model-quality evaluation remain unverified. The answers identify these boundaries; local concurrency tests and fake-provider histories do not establish them.

## Handoff and stop

The persistent manifest, checkpoint, review evidence and continuation prompt remain in this folder. The native periodic continuation is deleted at this handoff. Its 21:17 UTC heartbeat did resume actual work after capacity returned; there is no restored-quota detector. All article workers stopped and cancelled queues were not restarted.

Shared notes are saved through the Logseq guarded protocol at `C:/Users/07pal/development/logseq/`, with the actual local branch/commit, checks, limits and owner-review next action. If that final graph operation is unavailable, the assistant must explicitly report it pending; this local report is the fallback, not evidence of a successful graph write. The cross-project Claude adoption document is `C:/Users/07pal/development/logseq/CLAUDE_HANDOFF.md`.

Next action: the owner runs and reviews this local twelve-article lot. Further articles and publication await a new request.
