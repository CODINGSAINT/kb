# Spring AI fundamentals: one bounded application boundary

Pinned baseline: Java 21, Spring Boot 3.5.15, Spring AI 1.1.8. Maven resolves ordinary dependencies; the application does not require a paid account.

From this directory:

```text
mvn package
java -jar target/learning-spring-fundamentals-1.0.0.jar
```

The default is a fixed offline ChatModel fixture. It is not an LLM or a tokenizer. It returns a labelled dependency-injection explanation for every accepted question. Provider chat/embedding auto-configuration is disabled by default; the Ollama starter supplies ChatClient.Builder auto-configuration around our explicit fixture bean.

The MVC server binds to 127.0.0.1:8096. POST JSON to `/api/explain`:

```powershell
$body = @{ question = 'What is dependency injection?' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8096/api/explain' -Method Post -ContentType 'application/json' -Body $body
```

Blank/null or over-1000-UTF-16-code-unit questions receive 400; an empty answer or model call failure receives 502. This is a string-size limit, not token accounting. Malformed JSON is handled by Spring's normal HTTP input handling. No memory advisor, tools or retrieval are configured.

Tests start the real Boot application context without an HTTP server, verify the default fixture and prototype builders, role/message isolation, input boundaries and error mapping. An opt-in Ollama profile context is created against port 1 with model pulling set to never, solely to check bean selection/property binding. It never calls ChatModel.call or generates text. These tests do not evaluate model quality, live HTTP behaviour, performance or production security.

## Optional live Ollama adapter

Only use this after installing/running Ollama and explicitly installing a suitable chat model yourself. This example never auto-downloads model weights. In PowerShell, use an actual installed model name in place of the placeholder:

```powershell
$env:OLLAMA_CHAT_MODEL = '<installed-chat-model-name>'
$env:OLLAMA_BASE_URL = 'http://localhost:11434'
java -jar target/learning-spring-fundamentals-1.0.0.jar --spring.profiles.active=ollama
```

Use the same POST request. The profile removes the fixture and enables the auto-configured OllamaChatModel. It requests temperature 0.2 and num-predict 128 using the versioned adapter properties; those settings are not a universal model contract, exact output length, correctness guarantee or latency limit. It leaves embeddings disabled. The explicit profile guard requires a nonblank OLLAMA_CHAT_MODEL rather than silently selecting a model default.

The build checks profile wiring only; no live model request was made in the learning checks. Provider-server reachability, actual installed model capabilities, tokenizer/context rules, HTTP/overall deadlines, concurrency, privacy, access control and answer evaluation are separate integration work before any external deployment. Keep keys in environment/secret management if a future provider needs them. Do not put them in source, URLs, browser JavaScript or command examples.

For auto-configuration diagnosis use `java -jar target/learning-spring-fundamentals-1.0.0.jar --debug`; inspect the condition report locally. Do not publish a full environment or request-payload dump. Use `mvn dependency:tree` to inspect resolved dependencies; do not add random duplicate beans to mask an ambiguous ChatModel.
