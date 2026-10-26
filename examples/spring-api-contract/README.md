# Spring API compatibility check

Java 21 and Maven. `mvn -f examples/spring-api-contract/pom.xml compile` checks the ChatClient content, streaming, entity, usage and @Tool shapes used in the manuscripts against Spring AI **1.1.8**. The code does not run a provider or make model calls. Maven downloads build dependencies from Central.

This pins the educational 1.1 API family rather than silently combining APIs from different releases. It is not a claim that 1.1 is the newest stable family. Production applications must select a supported Spring Boot/Spring AI combination, configure authentication, validation, deadlines, budgets and authorized storage, and test the actual provider capabilities. The other pseudocode/domain-interface fragments in the manuscripts are explicitly labelled design sketches.
