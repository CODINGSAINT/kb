# HLD-5 News Feed staged handoff

Local isolated draft only. No canonical/shared source, manifest, lease, graph, commit, PR or published content changed. Parent owns guarded Logseq checkpoints, integration, independent review and consolidated gates. Current shared-brain startup/decisions and both adoption handoffs were read after quota recovery; no duplicate configuration/claim was made.

## Destinations

- `article.md`: HLD-5 markdown only in `content/day-05.json`; resolve `#session` and `#page` excerpts after copying Java. Problem/Requirements and numbered1..7 contract retained.
- `header.txt`: seven-node overview source; parent generates `public/designs/hld-5.svg`.
- `examples/learning-java/src/kb/feed/{FeedEngine,FeedChecks,FeedTrace}.java`: same paths.
- `public/learning-figures/hld-5-session.svg` and `hld-5-visibility.svg`: same paths; passive SVGs with title/desc.
- `public/learning-labs/news-feed.{html,css,js}` and `news-feed-traces.json`: same paths. Standalone three-case walkthrough, manual controls, full transcript/fallback, kb-theme and direct topic backlink. Shared lab infrastructure untouched.
- `mechanism-check.json`: evidence only. `.mechanism-classes/` is disposable and must not be integrated. WIP/integration notes are handoff records.

## Actual checks

One Java21 compile, focused check and trace run succeeded from this staging directory:

```powershell
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe' -encoding UTF-8 -d .mechanism-classes examples/learning-java/src/kb/feed/FeedEngine.java examples/learning-java/src/kb/feed/FeedChecks.java examples/learning-java/src/kb/feed/FeedTrace.java
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.feed.FeedChecks
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.feed.FeedTrace
```

Output: `PASS FeedChecks: hybrid merge/dedup, frozen ranking, current visibility/delete/unfollow/block, scan cursor progress, tamper/viewer/incarnation binding, TTL equality, bounded sessions`

Trace stdout became `news-feed-traces.json`. No browser, database, fanout broker, distributed policy or performance check was run. No Java source changed after the successful check.

## Sources and limits

Primary research: [PostgreSQL17 LIMIT/OFFSET](https://www.postgresql.org/docs/17/queries-limit.html), [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [Redis ZADD](https://redis.io/docs/latest/commands/zadd/). Current original topic, OWNER-SCOPE/RUBRIC/BENCHMARK and accepted HLD-1/HLD-3 style were read. No competitor/course referrals or paid calls.

Chosen design is a bounded hybrid follower feed with authoritative visibility gates and frozen-ID ranking sessions. Order can stay stable while permission removes items. Cursor advances over examined candidates, so empty continuing pages are explicit. V1 rank is recency plus a30-minute favorite boost; sessions expire in five minutes and may be evicted. Retry reads may repeat pages; refresh may repeat posts. No global exactly-once exposure or instantaneous recall is claimed.

Local authority helpers and the author scan are synthetic mechanisms, not a scalable source query. One JVM monitor does not implement distributed privacy authority. The check key is public test data, and cursor binding includes an ephemeral engine incarnation; production needs managed keys plus shared session identities/state or owner routing. Body/media access still needs current authorization; previously returned content cannot be recalled. Actual memory overhead, database policy throughput, fanout freshness and p99 targets require separate evidence.

## Exact parent next action

Integrate intended files/excerpts and generate the overview. Run current content/link/source-generated/download parity, Java/trace and independent critical review gates. Browser-check three cases, previous/next/reset, text fallback/transcript, theme storage, direct backlink, desktop/narrow layouts, SVG clipping and console/fetch errors. No pending gate is claimed passed here. Worker now proceeds only to assigned HLD-6, then HLD-7.
