# HLD-3 Distributed Cache — staged draft ready

Local staging only. No canonical articles, shared application files, manifests, lease, Logseq graph, commit, PR or published site changed by this subtask. Parent owns sequential integration and final gates.

## Files and destinations

| Staged path | Intended destination/action |
| --- | --- |
| `article.md` | Replace only HLD-3 markdown in `content/day-03.json`. Resolve source excerpts after copying Java. Starts Problem/Requirements; numbered sections1..7 include required final headings. |
| `header.txt` | Seven-node overview input; generate `public/designs/hld-3.svg` with the existing pipeline. |
| `examples/learning-java/src/kb/cache/BoundedCache.java` | Same path. Complete single-node bounded cache mechanism. |
| `examples/learning-java/src/kb/cache/CacheChecks.java` | Same path. Focused deterministic checks and injected monotonic ticker. |
| `examples/learning-java/src/kb/cache/CacheTrace.java` | Same path. Executes three teaching scenarios and emits JSON states. |
| `public/learning-figures/hld-3-stale-fill.svg` | Same path. Passive invalidation/generation and delayed-age diagram, with title/desc. |
| `public/learning-figures/hld-3-capacity.svg` | Same path. Passive slot/byte eviction and ABA retirement diagram, with title/desc. |
| `public/learning-labs/distributed-cache.html` | Same path. Standalone topic-owned walkthrough and complete no-JS/fetch-failure text fallback. |
| `public/learning-labs/distributed-cache.css` | Same path. Light/dark, responsive three-card state layout. |
| `public/learning-labs/distributed-cache.js` | Same path. Case switch, previous/next/reset, recorded transcript, keyboard-native controls and global `kb-theme` behavior. No shared lab files changed. |
| `public/learning-labs/distributed-cache-traces.json` | Same path. Actual Java trace output from the successful check run. |
| `mechanism-check.json` | Evidence only; parent may place under per-topic evidence. |

`.mechanism-classes/` is disposable local compilation output and is not a delivery input. WIP.md and this note are handoff records.

## Actual execution

One compile/focused check run succeeded with the configured Java21 binary:

```powershell
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe' -encoding UTF-8 -d .mechanism-classes examples/learning-java/src/kb/cache/BoundedCache.java examples/learning-java/src/kb/cache/CacheChecks.java examples/learning-java/src/kb/cache/CacheTrace.java
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.cache.CacheChecks
& 'C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/java.exe' -cp .mechanism-classes kb.cache.CacheTrace
```

Working directory was this staging directory. The check printed:

`PASS CacheChecks: generation/version fences, delayed fill, TTL equality, byte/slot bounds, LRU, ABA retirement, defensive copies, nanoTime wrap, 32 invalidations`

Trace stdout was saved as `public/learning-labs/distributed-cache-traces.json`. No second compile/check, network test, production Redis call, benchmark or browser gate was performed. A final prose-only codec clarification did not change the compiled source.

## Sources read and checked

- Current `content/day-03.json` HLD-3 and `docs/learning-quality/RUBRIC.md`. New article replaces the inconsistent multiple sizing examples and repeated generic follow-ups with one worked case.
- [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/): fixed slots, routing changes, ownership/configuration epochs and asynchronous replication write-loss limits. The article explicitly distinguishes its custom 4096-bucket/ticket protocol from Redis commands and uses the specification as a concrete reference.
- [Redis eviction reference](https://redis.io/docs/latest/develop/reference/eviction/): memory accounting/headroom and sampled LRU/LFU alternatives. No vendor capacity numbers were assumed.
- [Java21 System.nanoTime](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/System.html#nanoTime()): elapsed-time comparisons, arbitrary JVM-local origins, overflow-safe subtraction, precision versus resolution.

All research used primary official sources. No competitor/course referrals or paid calls.

## Chosen guarantees and material limits

- Product-card case: display price only, with checkout/permissions/stock authoritative elsewhere. Canonical tenant-qualified key has a serialization schema version; source version is in the value. Deterministic codec bytes are required for the same source version.
- One sizing model: 200k reads/s peak, 98% hits, 500 updates/s, 20M entries at1024B encoded/key/metadata allowance. Six primaries plus replicas is a load-test configuration, not a tested capacity recommendation.
- Ten-second maximum age begins at the cache ticket before an authoritative read. Late fills, L1, replica transfer and origin-response paths must not renew it. Production includes clock resolution/rate/suspend uncertainty and conservative margins; local equality tests are not distributed clock proof.
- Retained generation/minimum version rejects stale fills; new slot identity rejects tickets after bounded metadata eviction (ABA). Both slot count and encoded-payload bytes are bounded; the byte total does not measure actual Java heap occupancy.
- Java uses a monitor, opaque in-process Ticket and object identity. It has no transport, source DB, distributed membership, authenticated wire tickets, replication, origin admission or coalescing implementation. Those protocols are fully explained as design boundaries and require separate evidence.
- Async replicas may lose fills/invalidations. Copied values retain age budgets, old ownership tickets are retired, uncertain copies are discarded. No global linearizability/read-after-write/monotonic-read guarantee is claimed across eviction/failover. Merchant immediate reads bypass cache.
- A cache outage exposes50× ordinary miss load; origin admission is a whole-deployment budget. No stale-on-error extension past the hard budget.

## Exact next action and pending gates

Parent: copy intended Java/assets, resolve the two source excerpt markers and integrate only HLD-3 sequentially; generate the overview from header.txt. Then run consolidated integrity/link/source-generated parity checks and critical reading. Browser-check article and standalone lab at desktop/narrow widths in light/dark; exercise all three cases, previous/next/reset, text transcript/fallback, theme storage and navigation. Inspect SVG text clipping, console/fetch errors and bounds display. Review custom distributed age-transfer/ownership assumptions independently; the local tests do not validate them. No pending gate is represented as passed here.
