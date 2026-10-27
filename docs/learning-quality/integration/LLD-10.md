# LLD-10 Splitwise integration

Root-authored isolated draft, ready for parent integration and independent review. No external bank/payment calls. Owner resumed all remaining KB work; this new topic remains local/uncommitted.

Copy `examples/learning-java/src/kb/splitwise/*.java` and all `public/` assets to matching canonical paths. Apply `article.md` with `header.txt` through the guarded transaction. Do not copy `.checks`. Canonical overview is generated from the seven-node header. Exact source markers: Splits#allocation, SplitLedger#expense, #posting, #settlement, #plan.

Core: fixed-member INR group, four exact allocation modes, multiple payers, immutable journal/projection, operation identity with changed-input conflict, two-party reported-payment confirmation, explicit reversal and deterministic optional net settlement plan. Actors are authenticated by an external trusted adapter; no network/payment/database/auth implementation is claimed.

One Java21 compile plus SplitChecks run passed 1460 checks before integration: rounding, four modes, multiple payers, immutable inputs/views, journal rebuild and plan conservation, stale suggestion versus actual received payment, correction after payment, overflow rollback, and two 32-caller races. A final null/blank-actor validation clarification was added afterwards; parent must rerun the same focused checks on integrated code. No broad performance/failover claim.

SplitTrace emits three actual histories, 17 frames, via its main method (no arguments): trip settlement, retry/stale suggestion, correction after confirmed payment. Source downloads are four Java files; rebuild mirrors after integration. The standalone splitwise.html/css/js viewer loads splitwise-traces.json, manually steps every case and includes exact text fallback and theme control. It draws current payment suggestions, not actual transfers. One passive SVG explains proposed versus confirmed receipt.

Pending: integrated compile/trace regeneration, exact excerpt/download parity, source/generated integrity, SVG/JavaScript checks, browser controls/layout/themes/narrow widths, and a separate critical reading. AI worker is assigned the separate Splitwise reading after AI-4. No claim of production persistence, real receipt verification, minimum-transfer optimization, or human acceptance.
