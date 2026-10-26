# Reference-design revamp

All 60 design references (20 LLD, 20 HLD and 20 AI/Spring AI) now have extended authored source. Day 1 previously existed only in generated JSON; its three blocks now live in `build/topics/day-01-references.txt`, so a content rebuild retains the expanded material.

The answer-first reveal boundary remains unchanged: `Problem` and `Requirements` are the visible brief; every other section and the diagram remain behind confirmation. Revealed references now have a keyboard-accessible contents list that scrolls without changing the topic hash route.

## Scope and editorial standard

- LLD: ownership, invariants, command/state contracts, Java/domain examples, contention, side-effect uncertainty, extension seams and verification exercises.
- HLD: explicit capacity assumptions, API/data/access outlines, incremental architecture, critical paths, consistency races, recovery, tenancy/lifecycle, SLOs and drills.
- AI: mechanisms, budget calculations, Java/Spring boundaries, structured contracts, retrieval/memory/tool policies, failure handling and evaluations. Spring snippets use an explicit 1.1 API family; the included API contract compiles against 1.1.8. This is a teaching baseline, not a claim that it is the latest release.
- Eight new AI prerequisites take the AI fundamentals group from 2 to 10 chapters. All 20 AI topics link to relevant chapters, with reciprocal “read before” links. Total fundamentals: 45. DSA remains 304 problems.

Shared reliability explanations recur so each reference can stand alone. Each topic also has its own ownership rule, model/access path, concurrency/failure scenario and practical exercise; word count alone is not an editorial quality guarantee. Review domain correctness and usefulness alongside the automated structural checks.

## Supplied sources and original writing

The supplied `url_shortener_grokking_style_enhanced.md` is the depth benchmark and basis for the expanded URL-shortener case study. Its request-flow diagrams are expressed as text paths alongside KB's existing rendered architecture diagram. It is not presented as a measured production deployment or copied proprietary course.

The creator-requested [AI fundamentals video](https://www.youtube.com/watch?v=ZaPbP9DwBOE), “Don't learn AI Agents without Learning these Fundamentals”, was reviewed using its English auto-generated transcript. Its progressive project-based sequence informed the new learning path: model requests/context, retrieval, prompts, tools, orchestration and MCP. The transcript and its labs are not redistributed. The Java/Spring chapters are original; model limits, token arithmetic and claimed improvement percentages from the video are not adopted as fixed facts.

Primary references used for independent technical checks and further reading:

- [Spring AI 1.1 ChatClient](https://docs.spring.io/spring-ai/reference/1.1/api/chatclient.html) and [tool execution](https://docs.spring.io/spring-ai/reference/1.1/api/tools.html).
- [Java 21 concurrency](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html).
- [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html) and [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).
- [Kafka design](https://kafka.apache.org/41/design/design/) and [Redis rate limiting](https://redis.io/docs/latest/develop/use-cases/rate-limiter/).
- [pgvector](https://github.com/pgvector/pgvector), [Transformer research](https://arxiv.org/abs/1706.03762), [RAG research](https://arxiv.org/abs/2005.11401), and [MCP 2025-06-18 specification](https://modelcontextprotocol.io/specification/2025-06-18).

## Verification

Run:

```text
node build/assemble.js
node build/make-fundamentals.js
node scripts/check-reference-content.js
node --check public/app.js
javac -d .qa-classes examples/reference-invariants/ReferenceInvariants.java
java -cp .qa-classes ReferenceInvariants
mvn -B -f examples/spring-api-contract/pom.xml compile
node build/make-site.js
```

The checker validates all source/generated manuscript pairs, 60-topic coverage, reference-depth floor, heading/reveal boundary, code fences, diagram edges, prerequisite reciprocity, chapter/DSA counts and absence of personal study fields. The production builder independently strips/checks personal fields. The Java executable checks real arithmetic, ownership, concurrency and bounded-execution cases. The Maven example verifies selected framework API shapes without credentials or provider calls. Most manuscript snippets remain labelled design/integration sketches, not full standalone applications.

Browser verification covers reveal confirmation, long-form rendering, reference contents navigation without hash changes, hiding the reference again, and new prerequisite navigation. These checks do not establish measured production throughput or model-quality guarantees.
