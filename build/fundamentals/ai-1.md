=== ai-approach | AI | How to approach an AI/LLM system design question ===
AI design rounds mix classic system design with model-specific concerns: grounding, evaluation, cost, latency and safety. A structured approach stops you from waving "add an LLM" at the problem.

## Framework
1. **Use case and success criteria.** What decision or output does the AI produce? How is "good" measured: accuracy on a labelled set, deflection rate, time saved? What's the cost of a wrong answer (annoying vs regulatory)?
2. **Is an LLM the right tool?** Rules, search or a classic ML model may be cheaper and more reliable. LLMs shine at language understanding, synthesis and flexible reasoning over text.
3. **Knowledge strategy.** Prompt only → RAG (private or changing knowledge) → tools/agents (live data and actions) → fine-tuning (style, format, narrow skills, rarely for facts).
4. **Architecture.** Ingestion pipeline (for RAG) → retrieval → prompt assembly → model call(s) → post-processing/validation → response, with memory, tool execution and guardrails around it.
5. **Quality.** An offline eval set (golden Q&A, retrieval recall@k, faithfulness), online feedback, regression tests on prompt and model changes.
6. **Operations.** Latency budget (streaming), cost per request (tokens × price), caching, rate limits, model routing and fallback, observability (traces with prompts and token counts).
7. **Safety and security.** Prompt injection, data leakage, PII handling, authorisation on retrieved documents and tool calls, output filtering, human-in-the-loop for high-impact actions.

## Numbers to keep in mind
- Tokens ≈ ¾ of an English word. Latency splits into time-to-first-token (prefill) and per-output-token generation, and output tokens dominate.
- Cost scales with input + output tokens. Long contexts and agent loops multiply it.
- Retrieval: top-k of 3–10 chunks of ~300–800 tokens each is a common starting point.

## Typical deep dives
- Chunking and retrieval quality (hybrid search, re-ranking, metadata filters).
- Conversation memory (window vs summary vs retrieval) and per-user isolation.
- Tool calling safety: allow-lists, argument validation, least-privilege credentials, confirmation for destructive actions.
- Evaluation pipeline and how a prompt change gets shipped safely.
- Cost control: smaller models for easy queries, semantic caching, prompt compression.

## Red flags
- No evaluation plan ("we'll see if users like it").
- Fine-tuning to add knowledge that changes weekly.
- Trusting model output as code or SQL without validation.
- Retrieving documents the user isn't allowed to see.

=== ai-spring-boot | AI | Spring Boot and Reactor essentials for Spring AI ===
Spring AI builds on standard Spring Boot mechanics. Being fluent in beans, auto-configuration, configuration properties and reactive streams makes the Spring AI topics straightforward.

## Dependency injection and beans
- Spring creates and wires **beans**; prefer **constructor injection** (immutable, testable).
- `@Configuration` + `@Bean` methods define beans explicitly; `@Component`/`@Service` are discovered by scanning.
- Default scope is singleton (one per context). Beans must therefore be thread-safe: no per-request state in fields.
- Several implementations of one interface: `@Qualifier`, `@Primary`, or inject a `Map<String, Interface>`, which is handy for multiple chat models or vector stores.

## Auto-configuration and starters
A starter (e.g. `spring-ai-starter-model-openai`) brings dependencies plus auto-configuration classes that create beans (a `ChatModel`, a `ChatClient.Builder`) **only if** conditions hold (`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`). Define your own bean of the same type to override. `--debug` prints the conditions report.

## Configuration
- `application.yml` with `@ConfigurationProperties` records for typed settings.
- Profiles (`application-local.yml`, `-prod.yml`) for local vs production models and keys.
- Secrets come from environment variables or a vault, never committed. Spring AI reads keys from properties such as `spring.ai.openai.api-key: ${OPENAI_API_KEY}`.

## Web layer
- Spring MVC (servlet, thread-per-request; with Java 21 virtual threads this scales well).
- Spring WebFlux (reactive, event loop) for streaming and high-concurrency I/O.
- Streaming LLM output to browsers: return `Flux<String>` (or `Flux<ServerSentEvent<String>>`) with `produces = TEXT_EVENT_STREAM_VALUE`.

## Project Reactor basics
- `Mono<T>`: 0..1 values. `Flux<T>`: 0..N values, emitted asynchronously.
- Nothing happens until something **subscribes**. In WebFlux the framework subscribes for you.
- Operators: `map`, `flatMap` (async composition), `filter`, `buffer`, `timeout`, `retryWhen(Retry.backoff(...))`, `onErrorResume`.
- Never block (`.block()`) on an event-loop thread; offload blocking calls with `subscribeOn(Schedulers.boundedElastic())`.

## Cross-cutting
- **AOP/proxies:** `@Transactional`, `@Cacheable` and `@Retryable` work through proxies, so self-invocation bypasses them.
- **Observability:** Micrometer metrics and tracing; Spring AI emits observations for model calls (tokens, latency) that Actuator can expose.
- **Testing:** `@SpringBootTest` with test slices; mock `ChatModel` for unit tests; Testcontainers for vector stores (pgvector, Redis).

## Mental model for Spring AI
`ChatModel` (provider-specific, auto-configured) → `ChatClient` (fluent API built from `ChatClient.Builder`, with defaults and advisors) → your service beans. Vector stores, chat memory and tools are just more beans wired in.
