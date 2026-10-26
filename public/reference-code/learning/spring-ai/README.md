# ChatClient: an executable offline example

Java 21, Spring AI 1.1.8, Spring Boot 3.5.15. This reproducible baseline is not a claim about the newest release.

Run `mvn package` to compile, execute the checks and build the runnable jar. Then run `java -jar target/learning-spring-ai-1.0.0.jar`. It listens only on 127.0.0.1:8097. POST JSON `{"text":"What is encapsulation?"}` to `/answer`, `/card` or `/stream`. The last endpoint returns server-sent events.

The demo uses explicitly configured text and structured offline fixtures. They are not LLMs, make no provider calls, need no API key and report synthetic token metadata. A question containing a quoted field name cannot change their output shape. They isolate framework behavior without a paid account. For a live application, give StudyAssistant's one-argument constructor a provider-configured ChatModel; provider networking, quality, credentials and billing are separate integration work.

StudyAssistant contains the application operations. LearningApplication wires them into WebFlux endpoints. ChatClientChecks verifies request isolation, actual invocation timing, structured conversion, missing/empty output, stream subscription/cancellation and idle timeouts. ChatClientTraceChecks records walkthrough states from actual API executions.

This is a loopback teaching demo. Authentication, tenant quotas, remote-provider deadlines, output-size limits, logging redaction and model evaluation are required before exposing an AI endpoint to other users. The system message is guidance, not an authorization boundary.
