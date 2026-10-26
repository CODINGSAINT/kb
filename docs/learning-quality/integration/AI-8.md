# AI-8 integration handoff

Scope: replace only the AI track Structured Output reference in `content/day-08.json`. All authored files stay below `.learning-work/parallel/AI-8/`. No shared source, app infrastructure, campaign manifest/lease, Logseq, commit, PR or publication was changed by this worker. AI-2/3/4 were cancelled before any files for those queued topics were created. Finish AI-8 and stop is the current owner scope.

## Destinations

| Staged path | Integration destination/action |
| --- | --- |
| `article.md` | AI-8 markdown only, using normal excerpt integration. |
| `header.txt` | Same topic's six-node/six-edge overview; normal build produces `designs/ai-8.svg`. |
| `examples/learning-spring-structured-output/` | Same repository-relative module path; copy pom/README/src only, exclude Maven target. |
| `public/learning-figures/ai-8-parse-validate.svg` | Same public path. |
| `public/learning-figures/ai-8-bounded-repair.svg` | Same public path. |
| `public/learning-labs/structured-output.html`, `.css`, `.js` | Same public paths; topic-owned assets, no shared lab.js/lab.css modification. |
| `public/reference-code/learning/spring-structured-output/` and `.zip` | Exact source text mirror and source ZIP; integrate both so all article download links resolve. |

Article placeholders are standalone. Record, validator and whole-object-buffer use complete markers; convenience API examples use entity and combined markers. The normal integrator supplies code fences. All code remains text.

## Chosen complete answer

- Concrete task: extract a fictional R17 office receipt into a versioned ExpenseDraft record, preserving an unknown date as null. No OCR, payment, expense approval/posting, external account or real personal data is involved.
- All keys are required; selected source facts are explicitly nullable. Currency/category use finite enums with UNKNOWN. Schema version/source identity are checked separately. Unknown properties are rejected by this application's strict policy; no silent schema migration occurs.
- StrictDraftConverter exercises the 1.1.8 BeanOutputConverter custom-mapper/identity-cleaner constructor, generated schema/format and local Jackson rules. It blocks duplicate/extra/missing fields, trailing documents, numeric enum ordinals and scalar coercions; generated schema instructions are not claimed to be complete independent schema validation or provider enforcement.
- Actual entity(converter) and responseEntity(converter) APIs are included and tested separately. The main pipeline obtains one raw ChatResponse to inspect output caps/finish metadata before local conversion.
- Exact BigDecimal arithmetic checks quantity×price=total with declared range/scale/precision limits. Numeric scale is bounded before arithmetic/normalization. An arithmetic conflict remains visible instead of silently rewriting a field.
- Outcomes: READY_FOR_REVIEW, NEEDS_INFORMATION, FAILED. A deliberately wrong but internally consistent example demonstrates that local validity and an existing quote do not establish source truth. No validated candidate is called approved/verified.
- At most one format retry, repeating the original source/schema with safe format feedback; no rejected output is echoed. Known truncation, overlong/empty output, model failures and version/source mismatches stop rather than silently growing budgets. The two-call limit is not a wall-clock, transport-byte or token/spending limit.
- WholeObjectBuffer expects deltas, caps local units, releases only on normal completion and discards on cancellation/overflow. It is a tested local helper, not a live streaming integration.
- Application and test configuration disable the pinned converter's raw-output error logger; the article states that other loggers/traces and retention require separate review. The demo prints built-in fictional data only.

## Visual scope

Two passive SVGs have title/desc and explained arrows. The standalone walkthrough has five manually controlled explanatory cases, kb-theme light/dark with system fallback, native keyboard controls, live step status, transcript and no-JavaScript fallback. It explicitly does not claim to run Java, call a provider or show a model-quality test. No automatic motion runs. Browser rendering/accessibility/parity remains a parent gate.

## Primary technical evidence actually inspected

- [Spring AI v1.1.8 BeanOutputConverter](https://github.com/spring-projects/spring-ai/blob/v1.1.8/spring-ai-model/src/main/java/org/springframework/ai/converter/BeanOutputConverter.java): custom mapper/cleaner, generated schema, default unknown-field tolerance and cleanup, sensitive parse-error logging, getFormat/getJsonSchema and actual readValue conversion boundary.
- [Spring AI v1.1.8 ChatClient](https://github.com/spring-projects/spring-ai/blob/v1.1.8/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/ChatClient.java): entity and responseEntity overloads accepting StructuredOutputConverter, raw response/stream interfaces and typed pair contract.
- Cached `spring-ai-model-1.1.8.jar` inspected with the supplied Java 21 javap: ChatGenerationMetadata finish-reason access and builder exist. Runtime tests use that actual API.
- [Official 1.1.8 release announcement](https://spring.io/blog/2026/06/12/spring-ai-1-1-8-1-0-9-avaialble-now/): Boot 3.5.15 baseline (already read for adjacent work in this same session).
- [Oracle Java 21 BigDecimal](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html): scale, exact arithmetic and numeric comparison versus representation-sensitive equals.
- [JSON Schema null reference](https://json-schema.org/understanding-json-schema/reference/null): explicit null differs from absent property.

No native provider endpoint was exercised. A failed fetch of the structured-output guide is not claimed as inspected evidence. No competitor/customer course referral was included.

## Checks and remaining work

The focused `mvn -B -ntp package` check passed using the supplied Java 21 JDK, Spring AI 1.1.8 and Boot 3.5.15: **15 tests, 0 failures/errors/skips, BUILD SUCCESS**, finished 2026-10-27T02:59:17+05:30; executable jar built. The initial run compiled all code but exposed an LF-versus-CRLF test assertion. Only that complete-source assertion was normalized, then the focused package run passed; no production behaviour changed. Both actual safe test reports and the two-run explanation are retained in .checks/ and mechanism-check.txt.

Tests cover real converter/client APIs, strict shape/coercion errors, decimal/date handling, retry limits, visible domain conflicts, source/version identity, extreme exponents, source-truth limitations, whole-object completion/cancellation/size and the Boot console repair demo. The 14 source/configuration/pom/README files were then mirrored and compared by SHA-256; the ZIP excludes Maven target. No Java or configuration changes followed the passing run. The existing shared build runner may not know this new module, so parent should include its package command explicitly in the consolidated check/export plan.

Parent gates remain pending: source/download/ZIP parity and normal integration/build/link/integrity checks; JS/browser interaction and both themes/narrow layouts; SVG layout; separate critical reading. There is no HTTP endpoint in this console module. No Claude/human acceptance, production security, live provider/native schema behaviour, latency/cost or extraction quality was measured.

Exact next action: parent integrates the listed destinations and article excerpts/header, includes this separate module in consolidated check/export work, and finishes current build/browser/critical-review gates. Worker stops after this AI-8 handoff; no queued-topic writing.
