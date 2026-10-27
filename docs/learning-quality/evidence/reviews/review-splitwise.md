# LLD-10 Splitwise — independent source review

Reviewer: Codex worker ai_fundamentals, separate from the root author. Date: 2026-10-27. This is a critical source reading, not Claude/human acceptance or a global review/gate result. No canonical files were changed.

Read the LLD topic in content/day-10.json, all four examples/learning-java/src/kb/splitwise files, README-splitwise.md, the lab HTML/CSS/JS and saved trace structure, and the payment/correction SVG source. Arithmetic and state paths below were traced from source. I did not rerun the existing suites, regenerate histories, launch a browser or test database/authentication/payment integration. Parent consolidated/browser gates remain pending. No external API/version claim needed fresh research in this JDK-only review.

## 1. Promised expense history is missing from the public read contract

Priority: P2. Paths: examples/learning-java/src/kb/splitwise/SplitLedger.java:20–21, 25, 145–146; article Requirements and section 2's Read group balance/history contract.

The requirements promise that members can see group expenses. However, Snapshot returns only balances, net Entry deltas and payments. The original Expense objects remain in the private expenses map; there is no authenticated expense read method or expense collection in a snapshot. Only addExpense returns an Expense, requiring the caller to already supply its original facts and original recorder. A later read by Ben cannot display who paid what, the total, or everybody's agreed share.

This information cannot be reconstructed from net deltas. In two otherwise identical two-member ledgers, expense E recorded by A with total100, paid A100, shares A50/B50 and expense E with total200, paid A200, shares A150/B50 both produce Entry(EXPENSE,E,{A:+50,B:-50}) and equal public snapshots. Their recorded facts differ. Likewise Entry(REVERSAL,fix,deltas) exposes no original expense ID; the association exists only in private reversal maps. Two equal-net expenses cannot be distinguished by inspecting that reversal entry.

Fix: expose immutable authenticated expense history, and the reversal-to-original association, inside the same snapshot/revision boundary or through a clearly documented immutable history DTO. Preserve original facts after reversal. Add a check where another member reads an expense after the add call, inspects multiple-payer shares, and identifies which of two equal-net expenses was reversed. This needs no new service or persistence layer.

## 2. First frames in two cases show a zero change for the expense just described

Priority: P2. Paths: public/learning-labs/splitwise.js:12,18; examples/learning-java/src/kb/splitwise/SplitTrace.java:28,35; public/learning-labs/splitwise.html:11.

At position0 the renderer assigns prior=step. The trip scenario begins with an empty ledger, so this happens to be appropriate there. The retry scenario begins after first() posted the taxi, and correction begins after dinner was posted. Selecting the correction case therefore shows “A records dinner for A and B” but the Before/Change/Now table shows Asha +₹45 / ₹0 / +₹45 and Ben −₹45 / ₹0 / −₹45. The table is labelled “Balance change at this step”; it conceals the very expense effect being taught. The original-taxi first frame has the same issue.

Fix: record an explicit zero-balance frame before posting those first expenses, or label the first frame as a starting snapshot and show no Before/Change values until there is a prior frame. Regenerate the traces if changed and check the first frame of all three cases. Do not invent a zero prior for every future scenario: a legitimate scenario could start with pre-existing balances.

## 3. The advertised text case disappears with JavaScript or fetch failure

Priority: P2. Paths: public/learning-labs/splitwise.html:6,9–16; public/learning-labs/splitwise.js:34,36.

“Read the complete case as text” contains an empty list in saved HTML. JavaScript fills that list only after fetching splitwise-traces.json. With JavaScript disabled, the selector and controls stay disabled, the SVG/table/transcript are empty and the heading stays “Loading…”. A failed fetch similarly produces an error without any worked case. The page therefore has no independent readable fallback for its visual explanation.

Fix: include a static initial table and worked transcript in the delivered HTML, retaining them until successful enhancement; a compact noscript explanation should also identify the disabled interactive controls. Generate static values from the same trace if necessary to avoid drift. Verify with scripts disabled and with a simulated trace-fetch failure. This is a source-evident fallback gap, not a claim about screen-reader or visual browser testing.

## Boundaries checked while reading

The review traced largest-remainder arithmetic and percentage scale, paid-minus-owed posting, precommit overflow handling, same-ID conflicts, confirmed-payment retry, correction after receipt, snapshot immutability and the deterministic non-minimum transfer plan. I found no additional source-evident arithmetic/state defect in those paths. This observation is limited to the read code; it does not replace running its checks or establish remote durability, identity or receipt truth. The article explicitly excludes fixed-membership changes, bank transfer execution, dispute/cancellation resolution and atomic replacement of a reversed expense, so those exclusions are not defects against the chosen scope.

Reviewed fingerprints (SHA256): SplitLedger 9E9683CF9A0D93FB9AF35D226B162E7DDDC0BA7EA1F8534C5210700785CBF0EE; SplitTrace 63495AEA5C26EB83184D9EDC4BF19C3284A69BF26D7C5287835659FD0973F43E; splitwise.js EF52333B7F4C03CFD7E0C4B289FA7054F21AA18880DF7429C10F968B9AE1FAED. Day10 file fingerprint 27E3FEE90E3069FAC2E8C2093C176667CEA9D9CEE6FF5BC2AF79C2523B7AED09 includes unrelated categories and is only a review-version marker.

Exact next action: parent resolves the three findings, updates source/download/trace parity as applicable, and runs the appropriate focused read-history and browser checks before consolidated acceptance. Worker starts no further writing batch. Parent owns the guarded Logseq checkpoint; no graph claim or worker graph write was made.

## Targeted fix follow-up — 27 October 2026

Re-read the parent's corrected canonical SplitLedger, relevant regression-check lines, SplitTrace, saved trace JSON, lab HTML and JS. No canonical changes, suite execution or browser testing by this reviewer. The parent's reported1465-check result is parent evidence; I did not independently rerun it.

- Finding1 addressed in source: Snapshot now includes copied Expense and Reversal lists (SplitLedger.java:20–24,148–150). Reversal explicitly carries id,expenseId,recordedBy. The authenticated synchronized snapshot includes original paid/share facts after reversal. Expense maps remain copied/unmodifiable; the new checks inspect preserved history and an unmodifiable expense list. This closes the original missing-read-contract defect.
- Finding2 addressed in source/data: retry and correction now record an empty-ledger baseline before their first expense. Parsed saved JSON contains6 trip,8 retry and5 correction frames,19 total; each first frame has A/B/C=0. The renderer uses prior=null at index0 and shows em dashes for unavailable Before/Change cells. Later frames compare distinct recorded states, so the dinner effect is no longer shown as zero.
- Finding3 addressed for JavaScript disabled and rejected/404 fetches: the delivered HTML contains a visible static transcript for all19 frames with actual balances, independent of JavaScript. A fetch rejection reaches catch before fallback hiding, so it remains readable.

One related ordering issue remains at public/learning-labs/splitwise.js:36: fallback.hidden=true executes before choose() and its initial render complete. For a valid JSON response such as {"scenarios":[{"label":"Broken","steps":[]}]}, the current array/nonempty check passes, fallback is hidden, then render accesses the absent first step and throws. Catch displays an error but does not restore fallback. A structurally stale/corrupt trace can therefore still leave no case text. Move hiding after successful choose()/render and explicitly restore fallback in catch; validating steps before enhancement is also appropriate. This is a source-traced failure path, not a reproduced browser result. Parent has been notified.

Current next action under the owner's latest stop: parent resolves that small fallback-ordering issue and the separate Feed author-cap finding, completes consolidated gates, then owns the authorized commit/push and pause until2 November. Worker stops here; no further writing/review batch or graph claim.
