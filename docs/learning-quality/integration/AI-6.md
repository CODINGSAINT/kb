# AI-6 integration handoff

Scope: AI track topic AI-6, `content/day-06.json`, not protected Fundamentals. All worker writes are inside `.learning-work/parallel/AI-6/`; no shared source/app edits, commits, PRs, publication, lease/manifest or Logseq writes.

## Staged destinations

- `article.md`: replace only the AI-6 markdown through the normal article/excerpt integrator.
- `header.txt`: six nodes/six edges for that same overview, generating `designs/ai-6.svg`.
- `examples/learning-spring-fundamentals/`: complete separate Java 21 / Spring AI 1.1.8 / Boot 3.5.15 Maven module. Copy source/pom/README/resources/tests, excluding target/.
- `public/learning-figures/ai-6-boot-wiring.svg` and `ai-6-request-journey.svg`: same public paths.
- `public/learning-labs/spring-fundamentals.html`, `.css`, `.js`: same public paths; topic-owned manual explanatory walkthrough, no shared lab.js modification.
- Exact source text mirror under `public/reference-code/learning/spring-fundamentals/` plus `public/reference-code/learning/spring-fundamentals.zip`: created after the successful compile; mirror files were compared to the nine module source/config/pom/README files by SHA-256. Integrate both the mirror and ZIP so all article links resolve.

All Java files used as full excerpts carry complete markers. `ExplanationService` also carries an explain tag. The normal excerpt integrator supplies Java fences, so article placeholders are standalone.

## Design and scope

One MVC endpoint, `POST /api/explain`, receives `{"question":"..."}`. A singleton service builds one client from an injected prototype builder and starts a fresh prompt for each question. Default provider selectors are none and an explicit FixtureChatModel supplies a labelled fixed answer. Inputs are guarded by UTF-16-code-unit count (not tokens); null/blank/oversize produces 400, empty model text or a call exception produces a fixed 502 error body.

The optional ollama profile excludes the fixture, selects provider auto-configuration, requires OLLAMA_CHAT_MODEL, binds versioned `spring.ai.ollama.chat.options.*`, keeps embedding auto-configuration disabled and automatic pulling set to never. Tests construct that adapter against local port 1 to examine bindings but deliberately never call its model/service. No model weights or live/paid generation are required.

This is a complete local teaching application with explicit deployment limits. It does not implement authentication/tenant storage, retrieval, tools, conversation memory, token accounting, production request deadlines/concurrency/spending controls or model-quality evaluation. The article identifies these boundaries and links AI-7 for deeper streaming/structured topics.

## Primary technical evidence inspected

- [Spring AI 1.1.8 release announcement](https://spring.io/blog/2026/06/12/spring-ai-1-1-8-1-0-9-avaialble-now/) — pinned Boot 3.5.15 baseline.
- [v1.1.8 Ollama starter pom](https://github.com/spring-projects/spring-ai/blob/v1.1.8/starters/spring-ai-starter-model-ollama/pom.xml) — adapter plus model/client/memory auto-configuration dependencies.
- [v1.1.8 ChatClient auto-configuration](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/models/chat/client/spring-ai-autoconfigure-model-chat-client/src/main/java/org/springframework/ai/model/chat/client/autoconfigure/ChatClientAutoConfiguration.java) — prototype builder and ChatModel injection.
- [v1.1.8 Ollama chat docs](https://github.com/spring-projects/spring-ai/blob/v1.1.8/spring-ai-docs/src/main/antora/modules/ROOT/pages/api/chat/ollama-chat.adoc) — selector, versioned options prefix, initialization properties.
- [v1.1.8 OllamaChatAutoConfiguration](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/models/spring-ai-autoconfigure-model-ollama/src/main/java/org/springframework/ai/model/ollama/autoconfigure/OllamaChatAutoConfiguration.java) — property conditions, default options and pull strategy.
- [v1.1.8 OllamaChatProperties](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/models/spring-ai-autoconfigure-model-ollama/src/main/java/org/springframework/ai/model/ollama/autoconfigure/OllamaChatProperties.java), [OllamaEmbeddingAutoConfiguration](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/models/spring-ai-autoconfigure-model-ollama/src/main/java/org/springframework/ai/model/ollama/autoconfigure/OllamaEmbeddingAutoConfiguration.java) and [OllamaApiAutoConfiguration](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/models/spring-ai-autoconfigure-model-ollama/src/main/java/org/springframework/ai/model/ollama/autoconfigure/OllamaApiAutoConfiguration.java) — checked actual bean/property boundaries.
- [v1.1.8 retry properties](https://github.com/spring-projects/spring-ai/blob/v1.1.8/auto-configurations/common/spring-ai-autoconfigure-retry/src/main/java/org/springframework/ai/retry/autoconfigure/SpringAiRetryProperties.java) — configured retry prefix/max-attempts.

The unversioned docs currently show 2.x settings and were not used as this lesson's implementation contract. No competitor/customer course referrals were included.

## Checks and exact next action

One focused `mvn -B -ntp package` run passed with the supplied Java 21 JDK, Spring AI 1.1.8 and Boot 3.5.15: **6 tests, 0 failures/errors/skips; BUILD SUCCESS**, finished 2026-10-26T22:18:37+05:30. The executable jar was built. Evidence is `mechanism-check.txt` and the actual safe Surefire summary `.checks/test-summary.txt`. The console's blank-model startup exception was asserted by the negative startup test and did not fail the build. No generation/model-server call was made.

Source download packaging and byte-for-byte mirror hash comparisons were performed after that build. No Java/config changes followed it; a follow-up wording change only records the six-test result in the article. Do not integrate the Maven target directory as lesson source. The existing shared build runner may not know this new module; parent should include its package/check command explicitly when updating consolidated gates.

Parent gates remain pending: source/generated parity and exports, normal build/link/integrity checks, current HTTP demo checks, browser light/dark/narrow/keyboard inspection, diagram layout and separate critical review. The walkthrough is a configuration explanation, not a fake recorded Boot execution. No Claude/human acceptance or model-quality evaluation is claimed.

Exact next action: parent copies staged module/public assets, applies article excerpts and six-node header only to AI-6, includes the new module in its consolidated checking/export plan, and finishes current build/HTTP/browser/critical-review gates before marking campaign acceptance.
