# Seven-article batch for commit and push - 27 October 2026

Owner requested finishing the current turn, committing/pushing this batch, then picking up other articles on 2 November because weekly usage is approaching its limit. No PR, merge or website publication is authorized. The native ten-minute continuation is PAUSED; no automatic restart on 2 November is claimed.

Delivery branch: `codex/kb-learning-quality-review`, repository `https://github.com/CODINGSAINT/kb`. Canonical local review folder: `C:/Users/07pal/OneDrive/Documents/New project/kb-learning-quality/`. The actual commit and remote-ref verification are recorded in shared Logseq after pushing; `git log -1` and `git ls-remote origin refs/heads/codex/kb-learning-quality-review` reproduce that state. The older REPORT.md describes the earlier twelve-article delivery.

## Scope and routes

| New reference | Application route | Walkthrough |
| --- | --- | --- |
| Car Rental (LLD-6) | /#/t/6/0 | /learning-labs/rental.html |
| Cab Booking (LLD-7) | /#/t/7/0 | /learning-labs/cab.html |
| Splitwise (LLD-10) | /#/t/10/0 | /learning-labs/splitwise.html |
| News Feed (HLD-5) | /#/t/5/1 | /learning-labs/news-feed.html |
| Prompt Engineering (AI-2) | /#/t/2/2 | /learning-labs/prompt-engineering.html |
| LLM Parameters/APIs (AI-3) | /#/t/3/2 | /learning-labs/llm-parameters.html |
| Embeddings/Semantic Search (AI-4) | /#/t/4/2 | /learning-labs/semantic-search.html |

These seven build on the twelve previously reviewed references at ed62f0d. Target final status is 19/57 written, validated and reviewed; manifest is authoritative. Thirty-eight remain paused. The current diff changes exactly seven of the sixty topic documents compared with ed62f0d; the other fifty-three, protected Fundamentals and accepted Chess/Parking/Elevator are preserved. See evidence/preservation-20261027.json.

## Actual checks and review fixes

- Java21 compilation/mechanism runs passed: rental 29 focused checks, cab 38, Splitwise 1465 including two 32-caller races, feed identity/privacy/cursor/session checks plus 51-author/720-initial-candidate regressions, and executable prompt/parameter/semantic-search checks. The shared Java regression runner passed as well.
- **56 browser states** for the new seven: article and walkthrough in light/dark at 1280/390 px, real controls/navigation, no missing images or page-wide overflow, measured table contrast at least 9.99:1. Current retained reports cover 152 states across all nineteen topics; the earlier twelve were not re-rendered in this batch. Splitwise additionally passes script-blocked, failed-fetch and malformed-trace static-fallback cases with all 19 recorded frames.
- Current source/generated parity, exact excerpts/downloads, internal assets, passive SVG safety, JS syntax, ten writer-state tests, static-site build and staged whitespace checks passed. Source/implementation evidence: evidence/resume-20261027-checks.json and referenced actual command output. The runtime checker verifies existing 40 Spring test, 19 Redis and 6 loopback HTTP observations against unchanged artifacts; it does not rerun them or claim new live-provider testing.
- Separate Codex reading found missing Splitwise expense-history/reversal data, misleading first-frame changes and fallback failures. The final snapshot now exposes immutable original facts/links; histories begin from honest empty states, unknown previous values display a dash, and a build-generated full text fallback remains usable even if enhancement fails.
- Separate reading found that feed author fan-in was not bounded before the 200-ID retained-session cap. It now selects at most 50 pull authors by favorite, current eligible recency and ID, and caps initial merge at 200+50×10+20=720. Focused regressions cover both limits.
- Parent review corrected the semantic inspector so lexical retrieval does not depend on a query-embedding version; dense/hybrid reject an incompatible space. Browser checks exercise that distinction.

Per-topic *-review.json records all nine rubric criteria and actual limits. Separate-reader findings and their inspected-version caveats remain in evidence/reviews. No Claude technical acceptance, interview-selection promise, real model-quality score, provider payment, distributed durability/failover or production-load proof is claimed. Toy vectors/messages and illustrative parameter costs are labelled. Code remains copyable text; diagrams and manual HTML/SVG players serve the worked decisions.

## Resume later

All workers stopped. Portable **unchecked** partial drafts for Food Delivery (LLD-8) and Chat (HLD-6) are saved under deferred/2026-10-27/ with their WIP files. HLD-7 was not started. They are not customer content, validated articles or part of the nineteen-complete count. On an owner-authorized resumption on/after 2 November, inspect those WIP files, current shared-brain decisions and live ownership before assigning new work. Do not duplicate an active worker or recreate the old cancelled queues blindly.

Run locally from this review folder with `npm run start:local`, then open `http://localhost:4321/` and reveal Reference design. The existing static preview is `http://127.0.0.1:8790/` while its local server runs. Push to the review branch does not publish the website: the Pages workflow only deploys pushes to main or an explicit dispatch. No PR or dispatch was requested.
