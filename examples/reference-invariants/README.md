# Executable reference mechanisms

Requires Java 21. No dependencies, credentials, network calls, or learner data.

```powershell
New-Item -ItemType Directory -Force .qa-classes | Out-Null
javac -d .qa-classes examples/reference-invariants/ReferenceInvariants.java
java -cp .qa-classes ReferenceInvariants
```

The program checks exact money splits, interval boundaries, expiring seat ownership, an atomic single-JVM token bucket, context arithmetic, cosine similarity and bounded scripted execution. It is deliberately **not** a full wallet, reservation system, embedding provider or agent runtime. Multi-process correctness needs durable shared authority. Spring AI fragments in the manuscripts are separately labelled integration sketches and require their documented framework dependencies.
