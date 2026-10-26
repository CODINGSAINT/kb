# LLD-9 Library integration handoff

State: local staged draft only. This subagent changed only `.learning-work/parallel/LLD-9/`. No shared source, manifest, lease, Logseq, commit, push, PR or publishing actions. Owner's latest stop instruction is recorded: finish Library only; LLD-6/7/8 were not started and have no partial files.

## Destinations

| Staged file | Worktree destination / action |
| --- | --- |
| `article.md` | Replace only LLD-9 markdown in `content/day-09.json` through the parent's guarded campaign transaction. Problem and Requirements remain first. |
| `header.txt` | Campaign header input, six nodes. |
| `examples/learning-java/src/kb/library/*.java` | Same paths: complete Library core, demo/JSON exporter and focused checks. |
| `public/reference-code/learning/kb/library/*.java` | Same paths; three exact source downloads, verified by SHA-256. |
| `public/learning-labs/library.html`, `library.css`, `library.js` | Same paths. Standalone topic viewer; no shared lab.js changes. |
| `public/learning-labs/library-traces.json` | Same path; actual LibraryDemo --json output. |
| `public/learning-figures/lld-9-return.svg`, `lld-9-tokens.svg` | Same paths. Accessible operation figures, outside regenerated legacy lessons/. |
| `public/designs/lld-9.svg` | Same path, or parent may regenerate overview from header.txt. |

Standalone excerpt placeholders use `Library.java#values`, `#checkout`, `#renew`, `#return`, `#allocate` and `#holds`. The parent's apply script supplies Java fences. Download links use `reference-code/learning/kb/library/`; lab back link uses `../#/t/9/0`.

## Chosen rules and finished mechanism

- One branch, one catalogue edition per hold queue; BookEdition carries title/author/ISBN while Copy carries its barcode/state. Different editions are not substituted.
- Member composes an immutable Plan. Basic: max2/14days/one renewal/50 cents per late day. Plus: max4/21days/one renewal/25 cents. Loan stores the received plan terms. These are selected example policies, not universal library rules.
- Active membership and capacity gate checkout/hold placement. One active copy of an edition per member. Return is allowed for inactive members; fines do not gate eligibility under this simplified policy.
- FIFO assignment among eligible readers. Inactive/at-limit/already-borrowing heads are cancelled with a reason during allocation. Pickup does not reserve a loan slot; eligibility is checked again at checkout.
- Pickup deadline is assignedDate+2 local calendar dates, inclusive. A worker must eventually call expiry; checkout rejects a past-deadline assignment but does not bypass the queue.
- Fresh pickup tokens bind one copy assignment. An old expiry checks state/token before any mutation. Loan ID binds one borrowing visit; a returned old loan replays its saved receipt before changing current copy ownership.
- Renewal adds the frozen loan period to the current due date, with one stable request receipt. Another WAITING or PICKUP hold, overdue date, inactive member or used allowance denies renewal.
- Return records overdue days/fine once, releases member capacity, closes the exact loan, and either allocates to the next hold or enters REPAIR. No payment/message I/O occurs in circulation. Pickup notice intents are local immutable records; real delivery remains an adapter.
- Basic worked arithmetic: Oct1 checkout -> Oct15 inclusive due; Oct18 return -> 3 overdue days ×50 cents=$1.50. C's Plus checkout on Oct21 -> Nov11 due. These match the actual source-derived trace.

## Actual checks run once

Three sources compiled with Java21:

```text
C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe --release 21 -encoding UTF-8 -d .checks/classes <three staged sources>
```

One LibraryChecks run passed:

```text
PASS: 46 checks; edition/copy ownership, FIFO and stale tokens, limits, renewal, local-date fines, repair and concurrent checkout
```

Checks cover catalogue title/author/ISBN lookup, multiple physical copies of one edition, composed Plus terms, immutable views, member limit and capacity released on return, stable checkout/hold/renew IDs, wrong-payload conflicts, FIFO pickup order, inclusive deadline, wrong/stale pickup token, stale expiry before/after the next checkout, old loan return replay without another fine, renewal rules and retry, inactive returns, day0/day1/day3 fines, cross-year arithmetic, damage/repair, cancelled ineligible queue heads and two races: two members choosing the same copy, and two different copies competing for one member's only slot.

Evidence saved under `.checks/java-checks.txt` and `.checks/java-demo.txt`. Classes under `.checks/classes/` are temporary and need not be integrated.

LibraryDemo and its JSON export ran once. Parsed trace results:

```text
queue: 11 frames; final ON_LOAN L2; return receipts 1; fine cents 150
renew: 4 frames; final AVAILABLE; return receipts 1; fine cents 0
repair: 3 frames; final PICKUP P1; return receipts 1; fine cents 0
```

The queue trace explicitly contains the deadline day, real expiry, a repeated old P1 timer, C's P2 checkout and an old L1 return. The current L2 remains active and the fine remains a single $1.50 receipt.

`node --check public/learning-labs/library.js` passed. All three SVGs parsed as XML and contain title/desc. All three public source downloads match their source files by SHA-256.

## Reproduction after integration

```text
javac --release 21 -encoding UTF-8 -d <classes> examples/learning-java/src/kb/library/*.java
java -cp <classes> kb.library.LibraryChecks
java -cp <classes> kb.library.LibraryDemo
java -cp <classes> kb.library.LibraryDemo --json
```

Save the last command's UTF-8 stdout as `public/learning-labs/library-traces.json`. The existing recursive source copy loop can export downloads. The trace generator is LibraryDemo --json, not a LibraryTrace class.

## Limitations and parent gates

- Memory-only records and one service-object lock; no restart, SQL integration or multi-server correctness is tested. The article explains the durable transition: loan/copy/member capacity, edition queue, command receipt, fine identity and notice intent commit together. It makes no universal SQL isolation/index guarantee; a unique barcode over all loan history is explicitly rejected as incorrect.
- Eligibility is intentionally limited to active flag, loan count and same-edition borrowing. Authentication/roles, fines collection, membership expiry, holidays, lost items and multi-branch transfers are not implemented or claimed.
- No external payment or message service is connected. Notice records demonstrate intent only. Returning inventory is independent of network collection.
- Linear case-insensitive catalogue search is implemented; no million-title latency promise or external index performance test is claimed.
- Pending parent gates: guarded article/header apply, generated/source parity, links/download navigation, manifest evidence, critical reading, consolidated browser rendering/accessibility. This subagent did not run browser review.
- Browser cases: light/dark and kb-theme persistence/system fallback, narrow layout, keyboard select/prev/next/reset, transcript, article/back/download links, current owner/token versus hold history, due dates, fine count stable on old return, both deadline-day and old-expiry frames, damaged copy waiting/repair state, no-JS/fetch-failure fallback.

Author self-review only (Codex subagent): clarity has one copy/three-reader story; scope and policies are explicit; contracts and critical operations are complete; stale token/fine/date/limit behavior have executed checks; visual traces come from source. Rendering remains needs_work until the parent's browser gates. No human, Claude or external review is claimed.

## Primary sources consulted

- Java21 LocalDate: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/LocalDate.html . Confirms immutable calendar-date semantics without a stored time/zone; branch clock determines today's local date.
- Java21 ChronoUnit: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/temporal/ChronoUnit.html . Supports calendar DAYS.between arithmetic instead of dividing elapsed milliseconds into fixed-length days.

Exact next action: parent integrates this staged article/header and matching source/public destinations, runs final batch gates, updates Logseq and creates the requested local review commit. This subagent stops here; no next article is started.
