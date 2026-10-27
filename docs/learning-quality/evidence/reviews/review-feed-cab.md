# HLD-5 News Feed / LLD-7 Cab Booking — independent source review

Reviewer: Codex worker ai_fundamentals, separate from the root author. Date: 2026-10-27. Complete bounded source/contract reading; this is not Claude/human acceptance or a global gate result. No canonical/manifest/lease/graph edits.

Read both current articles, FeedEngine/FeedChecks/FeedTrace, Cab/CabChecks/CabDemo, corresponding lab HTML/JS and saved trace fields, and four operation SVG sources. No suites or browser checks were run by this reviewer. Parent is consolidating those gates. This review is source reasoning, not executed production/load/authentication evidence.

## HLD-5 finding: enforce the declared pull-author budget before merging

Priority P2. Path: examples/learning-java/src/kb/feed/FeedEngine.java:107–118 and the matching article excerpt; content/day-05.json HLD section 5, “Fanout, mode changes and bounded retrieval”.

The design declares at most 200 inbox references, 50 selected pull authors ×10 posts and20 own posts: at most720 initial IDs before dedup/filter/ranking. However, open iterates every matching edge in follows and adds ten posts for every followed pull author. The only later cap is maxCandidates on the final sorted session. That bounds retained session state, not initial candidate fan-in, permission/ranking work or author queries.

Concrete small scenario: V follows51 pull authors, each with one eligible post, and has no materialized/own posts. With maxCandidates200, the current method freezes51 IDs. The specified author selection limit would contribute at most50. At1,000 followed pull authors with ten distinct posts each, the implementation constructs10,000 candidate IDs rather than the declared at-most720 plan.

The source/article already distinguish the toy global post scan from a scalable database query. This finding is the separate missing author/candidate limit; replacing each scan with an indexed read still leaves1,000 timeline reads. The lesson's capacity/coverage trade-off depends on bounding that input before scoring.

Fix: select at most50 eligible pull authors using a stated deterministic recent/favorite policy, then read at most10 posts for each. Keep per-viewer indexed retrieval as the production adapter boundary. Add a fixture with51 followed pull authors and one post each so the200-ID session cap cannot hide the missing50-author cap, plus a maximum initial-candidate budget assertion. If the teaching core intentionally omits selection, say so explicitly and stop describing that part as its bounded implementation; implementing the small cap would make the example match the chosen design directly.

## LLD-7 result and review limits

I found no additional concrete source/contract defect in this bounded Cab pass. I traced offer retirement against both current IDs, acceptance/cancellation serialization, driver/rider identity checks on progression, completion replay before touching later driver ownership, frozen tariff and started-unit arithmetic, and the three recorded ownership cases. This is not a global pass claim or proof of actual contention, deployed clock behavior, telemetry truth, HTTP authorization, durable recovery or multi-server transactions. The lesson explicitly excludes those adapters/guarantees; I did not reclassify those stated exclusions as implementation defects.

The feed workload arithmetic was recomputed from the chosen assumptions:100M requests/day≈1,157/s average;1.8B ordinary references/day≈20,833/s;20M five-page sessions/day ×300s≈69,444 live sessions;3,600B each≈250MB decimal average and1.25GB at five-times peak. I found no arithmetic correction needed in those estimates. They remain assumptions, not measured capacity.

No primary API lookup was required for these JDK-only paths; no external freshness/version claim or paid provider was introduced. Lab/SVG content was read, not visually rendered or tested with assistive technology. The source files are the review evidence; source/download parity and saved trace regeneration remain parent gates. Reviewed SHA256: FeedEngine 272C19162E08E178979D8871B585B8278D2344C9CB4CD9FA71C2AAA26E65D244; Cab EFA296E2415E17001D7872322637DD3D2FC37501D9651E03F8199983DB358089; FeedTrace 0417714BBC83A03C60BA42A81AC2A173CB61805DD190F740512197161E6E4FB5; CabDemo 0C92242B822B5CB68B179DF644B5370FF1FDCD558A34458468E0708266B40856.

Exact next action: parent resolves the feed author-limit mismatch and performs applicable focused/consolidated checks. Worker now performs only the requested targeted source follow-up on the three Splitwise fixes and appends its factual result to review-splitwise.md; no new writing batch or graph claim.

Owner stop update: finish this review/follow-up only, then pause further articles/reviews until2 November. Parent owns the newly authorized batch commit/push after its gates; this worker performed no commit/push/canonical/graph mutation.
