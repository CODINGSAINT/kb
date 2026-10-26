# Independent Codex peer review — partial handoff

Reviewer: Codex subagent that did not author AI-7 or LLD-16. This is source review, not Claude/human acceptance. The parent reassigned the worker to new writing before the review was finalized. No suites, HTTP tests, browser or accessibility gates were rerun. Historical reports were read only and are not current verification by this reviewer.

Reviewed current `content/day-07.json` AI-7 and `content/day-16.json` LLD-16; Spring example pom/config/main/test sources; TicTacToe core/check/trace sources and lab HTML/JS; the existing dated AI-7 HTTP report and LLD-16 integration handoff.

## Concrete findings for parent triage

### AI-7: a completed empty stream is accepted without an answer

- Location: `examples/learning-spring-ai/src/main/java/kb/ai/StudyAssistant.java:46-50`, `LearningApplication.java:34-35`; tests `ChatClientChecks.java:68-86`; article section 5.
- Scenario: a ChatModel stream returns `Flux.empty()`, or completes after responses that contain no text. In Spring AI 1.1.8, `DefaultStreamResponseSpec.content()` drops missing/empty text. The service then completes normally with no output. The idle timeout does not turn an already completed publisher into an error. `/stream` can therefore finish with an empty successful response, while `/answer` explicitly rejects absent/empty text.
- Fix: specify an empty-stream outcome and add `switchIfEmpty(Flux.error(...))` for the no-content case; decide separately how whitespace-only completion should be treated. Add an empty/completed-metadata-only fixture case. Keep the article's distinction between a stream error and an already committed HTTP response; do not claim this alone adds a production completion-event protocol.
- Basis: direct reading of the local method and [Spring AI v1.1.8 DefaultChatClient source](https://github.com/spring-projects/spring-ai/blob/v1.1.8/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/DefaultChatClient.java), especially the stream content filter. Reactor defines Flux as 0..N values and provides [switchIfEmpty](https://projectreactor.io/docs/core/release/api/reactor/core/publisher/Flux.html#switchIfEmpty-org.reactivestreams.Publisher-) specifically for completion without values. This scenario was reasoned from source, not executed by this reviewer.

### AI-7: the fixture chooses response shape from user-controllable text

- Location: `examples/learning-spring-ai/src/main/java/kb/ai/FixtureChatModel.java:17-19`.
- Scenario: `/answer` with a legitimate question containing the exact substring `"concept"` (for example `What does "concept" mean?`) receives the fixture's study-card JSON, because the fixture searches all prompt contents for that substring. That substring is also used as its proxy for the converter's schema instructions.
- Fix: make the fixture's response selection explicit at its task/test boundary, or inspect converter/task metadata instead of a substring that can occur in the user's question. Add a test that the two endpoint response shapes remain stable when that literal appears in user data. This is a fixture/demo ambiguity, not a model-quality or authorization claim.

## Technical claims examined without a new execution

- AI-7's Java 21 / Spring AI 1.1.8 / Boot 3.5.15 baseline matches pom.xml and the [official 1.1.8 announcement](https://spring.io/blog/2026/06/12/spring-ai-1-1-8-1-0-9-avaialble-now/).
- Tagged DefaultChatClient source supports fresh request copies, model invocation at call-spec consumption, and structured converter instructions versus optional native schema handling.
- The [v1.1.8 DefaultAroundAdvisorChain](https://github.com/spring-projects/spring-ai/blob/v1.1.8/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/DefaultAroundAdvisorChain.java) consumes advisor deques. The article's fresh `Flux.defer` wrapper addresses that raw-stream resubscription trap. Its claim that repeated safe subscriptions cause fresh work is consistent with code and test assertions.
- The article distinguishes idle timeout from overall deadline, local cancellation from remote cancellation/billing, EmptyUsage from reported zero, and synchronous blocking work from returning a Mono. The source review did not establish production behaviour or a current test pass.
- LLD-16 Game validation, monitor boundary, detached snapshots, version monotonicity within the no-undo scope, affected-line scanning and win-before-draw match the article. No game-rule defect was found in the inspected code. Its exhaustive traversal has a separate eight-line outcome oracle; the 5,478-position and race claims are existing author evidence, not a rerun by this reviewer.
- TicTacToe JS creates its nine cell buttons once and updates them in place; it does not recreate focused cell elements on every move. Free play is explicitly a separate browser implementation, while guided frames come from Java. Do not infer browser parity/accessibility acceptance from this static read.

## Unfinished review work

Parent should finish independent critical review and current batch gates: source/download/zip parity, browser lab execution and both themes/narrow layouts, keyboard/assistive behaviour, HTTP failure presentation and live-adapter-specific semantics when a real provider is later attached. No new defect was confirmed in TicTacToe's core rules, but this partial handoff is not a completion stamp for either article.
