# Structured output: a candidate receipt draft

Java 21 / Spring AI 1.1.8 / Spring Boot 3.5.15. Complete console Boot project, using an explicitly scripted offline ChatModel. It is not an LLM, OCR pipeline, paid integration or model-quality evaluation.

Run in this directory:

```text
mvn package
java -jar target/learning-spring-structured-output-1.0.0.jar
java -jar target/learning-spring-structured-output-1.0.0.jar --demo.case=bad-total
java -jar target/learning-spring-structured-output-1.0.0.jar --demo.case=repair
```

Other fixture cases: failed-format and truncated. The default valid case returns READY_FOR_REVIEW with one call and purchaseDate=null. bad-total returns NEEDS_INFORMATION with one call. repair returns READY_FOR_REVIEW with two calls. failed-format returns FAILED after two calls. truncated returns FAILED after one call, even if its text happens to be valid JSON. No provider starter, credentials or model download is needed.

The pipeline has a 4,000-UTF-16-code-unit source guard, 4,096-unit raw output guard, strict Jackson converter policy and at most one format retry. Those guards are not real token accounting, network response-size enforcement or a total time deadline. A live adapter needs separate transport/output-token/deadline and aggregate spending controls.

All record keys are required. Explicit nullable source facts preserve unknown; currency/category use finite enums including UNKNOWN. The local parser rejects extra/missing keys, duplicate keys, trailing documents, scalar coercion, bad enum values and invalid dates. Local domain rules require a supported currency, 1..100 quantity, bounded exact nonnegative money with scale 0..2, matching quantity×unitPrice=total, a merchant appearing in the source, and an exact source quote. purchaseDate is legitimately optional/null. Parsed but incomplete/inconsistent candidates go to NEEDS_INFORMATION without automatically repairing the facts.

READY_FOR_REVIEW is deliberately not approval or proof of source fidelity. A wrong but internally consistent extraction can pass these checks; one test demonstrates this limit. A person must compare the draft to its source before any expense posting. The application has no payment, posting or approval tool.

StrictDraftConverter uses BeanOutputConverter's custom ObjectMapper and identity cleaner. Generated format/schema instructions do not make the provider enforce a schema. The default converter is more lenient than this application's policy. The pinned converter can log rejected text on parse failure, so this application and its test logging disable that logger; a real integration must review other loggers/traces and retention too.

ReceiptExtractor handles capped raw text and finish metadata before converting; ConvenienceApis separately demonstrates entity(converter) and responseEntity(converter), which still return candidates requiring domain/evidence checks. Each API demonstration is a separate model invocation. WholeObjectBuffer expects text deltas, releases text only on normal completion, and discards on cancellation/overflow. It is not a live streaming adapter.

Tests exercise the actual pinned converter/client APIs, strict shape errors, exact decimals, missing facts, unchanged arithmetic failures, one format retry, terminal failures, version/source identity, extreme numeric scale, the source-truth limitation, and full-object buffering. A Boot context executes the scripted repair demo. No test claims model extraction accuracy or provider-native schema compliance.
