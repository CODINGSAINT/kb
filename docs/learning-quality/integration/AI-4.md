# AI-4 handoff

Ready for parent integration/review. All authored files are isolated in AI-4 staging; no canonical source, manifest, lease, graph, commit or publication changes.

Destinations: article.md → AI category/number4 in content/day-04.json using excerpt tooling; header.txt → the six-node overview/designs/ai-4.svg. Copy examples/learning-java/src/kb/semanticsearch/SemanticSearch.java and each staged public/ file to identical repository-relative destinations. Public contains two learning-figures SVGs, semantic-search.html/.css/.js and the exact Java source download at reference-code/learning/kb/semanticsearch/SemanticSearch.java. Excerpts use supported standalone markers. Do not integrate .checks/.

The complete JDK21 example is framework independent. It normalizes finite vectors without avoidable overflow, rejects zero/dimension/space failures, detaches arrays, applies tenant/role/current-revision policy before scoring, implements exact cosine plus simple lexical overlap and reciprocal rank fusion, and checks metric arithmetic. Its immutable policy snapshot is not production identity, revocation propagation or multi-server authorization. All vectors are hand-assigned: no learned relevance, embedding throughput, vector database or model quality is tested. Adjacent framework baseline remains Java21 / Spring AI1.1.8 / Boot3.5.15; no new framework API is introduced.

Focused mechanism check: Java21 javac --release21 and main execution, exit0; the captured output is in .checks/result.txt. Source download SHA-256 parity verified: AD2C3868882CE9C5E7C526BC136D746E4225CB09E16549EA9CFE59B47A248D08. Earlier compiled artifacts survived interruption but the original tool output was truncated; the final focused compile/run was captured explicitly. No full-suite or provider/paid calls.

```text
cosine(reset,error)=0.707107; hybrid E1042 score=0.032522
Student dense hits: [reset-2, error-1]
PASS: geometry, space/dimension/finite guards, detached vectors, scoped revision filtering, lexical/fusion and metric arithmetic.
LIMIT: hand-assigned vectors test retrieval mechanics, not learned semantic relevance or production ACL enforcement.
```

Primary sources opened: [Sentence-BERT](https://arxiv.org/abs/1908.10084), [Faiss metric definitions](https://github.com/facebookresearch/faiss/wiki/MetricType-and-distances), [Faiss index families](https://github.com/facebookresearch/faiss/wiki/Faiss-indexes), [Elastic reciprocal rank fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion). The original RRF PDF fetch timed out and is not treated as inspected evidence. The article explains its own rank-one/constant60 convention and does not add unlike raw scores.

Visuals: accessible title/desc vector-geometry and permission-filter SVGs; owned manual retrieval inspector with public fixture actor/query/route/cutoff/revision/encoder controls, static text/table fallback, native controls and kb-theme/system-default light/dark toggle. No production browser authority, provider call, model-quality claim or automatic motion.

Pending parent gates: source/excerpt/generated parity, full build/link/integrity, browser narrow/light/dark/keyboard/assistive interaction, SVG layout and distinct critical review. No live encoder/database/authentication/load or relevance evaluation was run. Include kb/semanticsearch in consolidated Java example checks/exports.

Exact next action: parent integrates/checks AI-4; worker independently reads LLD-10 Splitwise and saves concrete findings only to .learning-work/parallel/review-splitwise.md, then stops for parent gates.
