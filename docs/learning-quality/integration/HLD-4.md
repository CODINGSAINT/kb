# HLD-4 Notification System — staged draft ready for parent review

Local staging only. This subtask did not change canonical articles, shared application files, manifests, the writer lease, Logseq, commits or publication state. No real notifications, credentials, provider APIs or paid calls were used. Parent owns integration, the twelve-article lot's checks and the local commit. HLD-5/6/7 were cancelled before work began; no queued partials exist.

## Intended destinations

| Staged path | Destination/action |
| --- | --- |
| `article.md` | Replace only HLD-4 markdown in `content/day-04.json`. Resolve the two source-excerpt directives after copying Java. Starts Problem/Requirements and includes numbered1..7 with required final headings. |
| `header.txt` | Seven-node overview input. Generate `public/designs/hld-4.svg` with the existing pipeline. |
| `examples/learning-java/src/kb/notification/DispatchEngine.java` | Same repository-relative path. Complete local dispatch decision state machine. |
| `examples/learning-java/src/kb/notification/FakeProvider.java` | Same path. Local fake provider with accepted/rejected/timeout-after-accept outcomes and a configurable replay contract. |
| `examples/learning-java/src/kb/notification/NotificationChecks.java` | Same path. Focused deterministic checks and controlled clock. |
| `examples/learning-java/src/kb/notification/NotificationTrace.java` | Same path. Executes four walkthrough cases and emits the recorded states. |
| `public/learning-figures/hld-4-handoff.svg` | Same path. Passive business/notification outbox handoff diagram with title and desc. |
| `public/learning-figures/hld-4-uncertainty.svg` | Same path. Passive timeout/replay/identity diagram with title and desc. |
| `public/learning-labs/notification.html` | Same path. Standalone topic-owned walkthrough, full text fallback and direct HLD-4 backlink. |
| `public/learning-labs/notification.css` | Same path. Responsive light/dark state-card layout. |
| `public/learning-labs/notification.js` | Same path. Four cases, previous/next/reset, transcript, fetch-failure fallback and global `kb-theme` read/write with system fallback. No shared lab.js/lab.css edits. |
| `public/learning-labs/notification-traces.json` | Same path. Actual Java trace output, not manually invented state. |
| `mechanism-check.json` | Evidence only; parent may move into per-topic evidence. |

`.mechanism-classes/` is disposable local compilation output and must not be copied to public/source trees. This note and WIP.md are handoff records.

## Actual checks performed

One focused compile/check run succeeded with the configured Java21 binaries. It ran from this staging directory:

```powershell
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe' -encoding UTF-8 -d .mechanism-classes examples/learning-java/src/kb/notification/DispatchEngine.java examples/learning-java/src/kb/notification/FakeProvider.java examples/learning-java/src/kb/notification/NotificationChecks.java examples/learning-java/src/kb/notification/NotificationTrace.java
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.notification.NotificationChecks
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.notification.NotificationTrace
```

Actual output:

`PASS NotificationChecks: identity, timeout-after-accept replay, preferences/contact gate, claim fencing/evidence, replay deadline, retry budget, schedule/expiry equality, 32 claimants`

Trace stdout was saved in `public/learning-labs/notification-traces.json`. On resumption, the saved check evidence and complete file inventory were read; the already successful check was not redundantly rerun. No Java changes were made after the check. No browser, real provider, database, broker, load or distributed failover check was performed by this subtask.

## Sources and teaching decisions

Read current HLD-4 and applied the campaign rubric/plain-style contract. Primary sources opened for specific technical claims:

- [Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html): receive/delete processing can still encounter another message copy; consumers need idempotent behavior.
- [Amazon SES event reference](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html): separate send, delivery, bounce, complaint, open and click evidence; email delivery concerns the recipient mail server, not universal human read.
- [PostgreSQL17 SELECT/locking](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE): row claiming with SKIP LOCKED is a queue-consumer pattern, not a general consistent-view guarantee.

Chosen case: OrderReady O847/version9 -> U21; one durable in-app item and separate optional email/push deliveries. The business outbox uses an HTTP relay into durable notification ingestion. Delivery rows and a delivery outbox commit together. Recipient/channel identities survive duplicate ingest/publication.

One capacity model:10M events/day, two external channels,20× peak. About2315 events/s and4630 channel attempts/s before retries/suppression at peak. Storage plan distinguishes event, inbox and frozen delivery bytes; provider quotas and concurrency are assumptions to validate.

Acceptance/enqueue/provider acceptance/provider delivery evidence/user read are explicitly separate. Preferences/contact/expiry are checked at each final authorization. A request already authorized/in flight cannot be recalled by later opt-out. Frozen target/template/payload and provider key remain unchanged across retries.

## Material mechanism limits

- The fake provider's60-second replay window is an illustrative controlled contract, not a claim about any real provider. Unknown outcomes without safe replay, or after its window, become reconciliation work instead of blind resend/provider failover.
- Claim epochs fence local dispatch-state updates, not remote side effects. An old worker's acceptance evidence is retained separately even when its state update returns STALE.
- The example starts at per-delivery dispatch. It does not implement durable business/notification outboxes, broker acknowledgements, authenticated callbacks, provider lookup/reconciliation workers, campaign fanout or real contact verification.
- Maps, local IDs, one monitor and an injected epoch-millisecond clock do not establish multi-server ownership or crash durability. Production needs database transactions/time, globally unique delivery IDs, provider/account-scoped receipt identities, and retention/restoration policies. The fixed category is order updates; the model's preference map is channel-scoped within that case.
- The walkthrough's four cases are timeout-after-accept, opt-out before authorization, stale worker after lease reclaim, and uncertainty without safe replay. It does not show or claim real delivered/read state.

## Exact next action

Parent: integrate only intended HLD-4 files, resolve source excerpts and generate the overview. Run consolidated article integrity, links, source/generated parity, current Java/trace and independent critical-reading gates. Browser-check desktop/narrow and light/dark, all four cases, step boundaries/reset, complete transcript/fallback, theme storage, article backlink, SVG clipping, console/fetch errors and visibility of the separate provider/local states. Review outbox/reconciliation/opt-out boundary claims against the staged source. None of those pending gates is represented as passed here. Finish the lot's local review commit; no push/PR/publication was performed by this subtask.
