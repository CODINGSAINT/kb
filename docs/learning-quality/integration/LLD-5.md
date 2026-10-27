# LLD-5 ATM integration handoff

State: local staged draft only. This subagent changed only `.learning-work/parallel/LLD-5/`; no shared source, manifest, writer lease, Logseq, commit, push, PR, merge or deployment actions.

## Destinations

| Staged file | Worktree destination / action |
| --- | --- |
| `article.md` | Replace only LLD-5 markdown in `content/day-05.json` using the parent's guarded campaign transaction. Problem and Requirements remain first. |
| `header.txt` | Use the campaign header option; six nodes describe the implemented responsibilities. |
| `examples/learning-java/src/kb/atm/*.java` | Same paths. Four complete Java 21 files: core, deterministic ports, demo/JSON exporter and checks. |
| `public/reference-code/learning/kb/atm/*.java` | Same paths. Exact source-download copies, already compared by SHA-256. |
| `public/learning-labs/atm.html`, `atm.css`, `atm.js` | Same paths. Isolated source-derived walkthrough; no shared lab.js edit. |
| `public/learning-labs/atm-traces.json` | Same path. Exported from `AtmDemo --json`. |
| `public/learning-figures/lld-5-flow.svg`, `lld-5-unknown.svg` | Same paths. Purposeful accessible operation figures; deliberately outside the regenerated legacy lessons directory. |
| `public/designs/lld-5.svg` | Same path, or parent may regenerate the header overview using header.txt. |

Article excerpt placeholders are standalone because `apply_learning_article.py` adds its own Java fences. Tags are `notes`, `contracts`, `withdraw` and `resolve` in Atm.java. The source-download links are included in the article. Back link uses observed route `../#/t/5/0`.

## Coherent chosen solution

- One ATM/card session, one bank, USD; positive $10 increments up to $500. Exact allocation is still required with $20/$50 cassettes.
- The bounded planner enumerates feasible $50 counts, then tests the remaining $20 count. It correctly pays $60 as three twenties when greedy $50-first would fail. More $50 notes minimize total notes for this specific two-denomination set.
- The card reader, secure-input adapter, session, bank authority, withdrawal record, cash inventory and dispenser have explicit boundaries. Three DENIED authentications request card ejection under the chosen policy; UNAVAILABLE is not a bad PIN. Failed ejection blocks another card.
- No PIN digits or card secrets are in source examples or trace data. `PinEvidence` is an opaque secure-input reference; the fake bank supplies configured auth replies and performs no real PIN verification.
- Stable withdrawal ID binds session, account and amount. A retry returns the saved result before any external action; changed payload/session is rejected. Reconciliation is a trusted maintenance operation that survives card-session end.
- Bank hold precedes cash; settle(id, delivered) atomically debits the finally delivered amount and releases the unused hold under the chosen bank port. Holds in the fixture do not auto-expire; the article answers real hold expiry as a separate contract issue.
- Distinct funds-unknown, cash-unknown and settlement-unknown phases determine different recovery actions. The ATM never turns an unknown cash reply into a full refund or a new dispense.
- Final evidence must account for every planned note as delivered, reusable or quarantined. Partial delivery charges only confirmed delivery; quarantine prevents reuse and blocks more cash until maintenance under the selected conservative policy.

## Actual checks run once

All four Java files compiled with:

```text
C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe --release 21 -encoding UTF-8 -d .checks/classes <all four staged sources>
```

Then AtmChecks, AtmDemo and the JSON exporter were each run once. Result:

```text
PASS: 2,389 checks; bounded note allocation, session rules, stable IDs, bank/cash uncertainty, partial reconciliation and atomic bank holds
```

The planner is checked against an independent two-loop bounded search over 30 cassette combinations and 50 requested amounts each. Feasible plans are also checked for exact amount, stock bounds and minimum note count. The remaining checks cover authentication/ejection rules, retry/payload conflicts, unavailable note plans, bank decline, proven zero delivery, ambiguous delivery, ending a card session while the withdrawal survives, partial settlement/quarantine, lost hold/settlement replies, inconsistent device counts and two concurrent holds at the local fixture bank.

Evidence: `.checks/java-checks.txt` and `.checks/java-demo.txt` inside this stage. Compiled classes in `.checks/classes/` are temporary and need not be integrated.

The exported trace parsed successfully:

```text
success: 5 frames; final COMPLETED; commands 1; held 0
cash-unknown: 9 frames; final PARTIAL; commands 1; held 0
none: 4 frames; final NO_CASH; commands 1; held 0
hold-unknown: 5 frames; final COMPLETED; commands 1; held 0
settlement-unknown: 5 frames; final COMPLETED; commands 1; held 0
```

In the partial case, the final bank ledger is $60 from an initial $100, delivered cash is $40, the held amount is $0, one twenty is quarantined and the fifty remains available. Command count stays one across both customer and maintenance retries. In the lost-settlement case, the fixture's bank debit already happened while the ATM's receipt remains unresolved until confirmation; the lab labels the bank panel as actual fixture state to make that distinction visible.

`node --check public/learning-labs/atm.js` passed. All three SVG files parsed as XML and contain title/desc. All four public source copies have identical SHA-256 hashes to their examples sources.

## Reproduction after integration

```text
javac --release 21 -encoding UTF-8 -d <classes> examples/learning-java/src/kb/atm/*.java
java -cp <classes> kb.atm.AtmChecks
java -cp <classes> kb.atm.AtmDemo
java -cp <classes> kb.atm.AtmDemo --json
```

Save the final command's UTF-8 stdout as `public/learning-labs/atm-traces.json`. The shared build script's current naming loop must not assume an `AtmTrace` class: this topic intentionally uses `AtmDemo --json`. Its recursive source-copy loop already supports these source files.

## Limitations and pending parent gates

- **Memory-only mechanism:** no disk journal, real bank, real PIN validation, real motor, cryptographic integration, reboot recovery or compliance certification is implemented/tested. The article supplies the durable journal fields, required phase-write ordering and recovery decisions before actual hardware integration; it does not claim memory maps survive power loss.
- **Port assumptions are explicit:** the bank must provide atomic/idempotent hold and settlement semantics, and the device adapter must return final customer-delivery evidence or UNKNOWN. Presentation is not assumed to prove collection. Local tests cannot verify these external contracts.
- **Single physical path:** Machine synchronizes bounded port calls for clarity. Production UI responsiveness requires recorded pending phases plus guarded re-entry after I/O; the follow-up answers that boundary. A Java lock does not coordinate other servers or bank accounts.
- **No physical exactly-once claim:** the live record prevents a repeated command in the tested process. After crash, a durable intent plus queryable device identity is required; otherwise the article keeps cash service blocked for physical reconciliation rather than resending.
- **Pending:** parent's guarded article/header integration, generated/source parity, source/link checks, manifest evidence, critical reading and consolidated browser checks. No browser or accessibility audit was performed by this subagent.
- Browser cases: light/dark and kb-theme persistence/system fallback; narrow width; keyboard prev/next/reset and select; transcript; article/back/download navigation; unknown versus proven zero; command count unchanged on retry; bank's actual ledger versus saved operation knowledge; quarantine and blocked-service labels; no-JS/fetch-failure fallback.

Author self-review only (Codex subagent): clarity has one $60 case; scope is explicit; contracts/ownership and failure handling have consistent source and traces; allocation arithmetic and state mechanisms have executed checks; code is complete in downloadable files; visuals show separate bank/cash authorities and original-ID recovery. Rendering remains needs_work until parent browser gates. No Claude, human or external reviewer is claimed.

## Primary references consulted

- Java 21 Map contract, including default putIfAbsent/concurrency caveats: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Map.html . The fixture's map access is enclosed in synchronized methods; no atomicity is inferred from an ordinary HashMap alone.
- Java 21 synchronized instance-method contract (also reused from LLD-16 research): https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4.3.6 . Supports the one-object concurrency boundary, not a distributed guarantee.
- CEN-hosted XFS cash-dispenser migration reference: https://www.cencenelec.eu/media/CEN-CENELEC/AreasOfWork/CEN%20sectors/Digital%20Society/CWA%20Download%20Area/XFS/CWA16926_Release3.40/TrackChanges/cwa-16926-64.pdf . Its presentation/taken/retraction distinctions informed the narrow evidence contract. It is a reference document, not a claim of standards compliance or an implemented API.
- Stripe's primary idempotency documentation was inspected as a comparison of explicit request-key/payload contracts: https://docs.stripe.com/api/idempotent_requests . No Stripe integration or banking equivalence is asserted; this link is not added as a customer-course referral.

Exact next action: parent installs these matching source/public files, applies article/header through the guarded campaign workflow, then runs the consolidated content and browser gates before marking LLD-5 complete.
