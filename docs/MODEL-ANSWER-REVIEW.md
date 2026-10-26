# Completed reference answers

The owner clarified that KB references must give the completed, defensible answer to the problem. The URL-shortener attachment establishes the desired depth and reasoning; its exact headings are not compulsory. Beginner accessibility means explaining the completed answer, not replacing it with an exercise asking the reader to produce the design.

This revision gives every topic a selected solution, concrete contracts and core execution, a matching final-design image, detailed supporting reasoning, answered follow-ups and a closing position. It retains useful topic-specific material and worked calculations from earlier drafts, removes unfinished lab assignments and resolves selected-model conflicts such as library copy naming, the wallet transfer lifecycle and redundant Spring service examples.

## Canonical sources and scope

`build/topics/*.txt` contains all 60 authored answers and their selected component/class graphs. `build/assemble.js` generates day JSONs. `build/make-model-designs.js` derives 60 SVGs directly from those graphs; do not edit separate topology data. The existing operation/failure pictures remain supplementary. The UI places the final graph inside the answer instead of duplicating an older overview above it.

The core choices include atomic show-seat allocation and confirmation, segment-based train seats, ledger-backed transfers, idempotent payment intent reconciliation, lease/fencing scheduler ownership, hybrid feed fan-out and explicit application authority around model/tool calls. Assumed traffic, token and capacity numbers are interview assumptions unless stated otherwise. Java/Spring integration excerpts demonstrate defined boundaries; they are not a claim that every reference includes a deployable application.

## Editorial review criteria

For each answer, ask:

- Does it actually choose the design and finish the important operation?
- Can the reader identify records/classes, identities, source of truth and legal states?
- Does the diagram show that same selected model?
- Do worked inputs, arithmetic and failure outcomes agree with the chosen contracts?
- Are alternatives defended rather than listed without a decision?
- Are follow-ups answered rather than left as homework?

Checks verify source parity, selected topology, figures, code fences, links, absence of abandoned tutorial sections and long repeated prose. They support editorial inspection; word count and a passing build cannot certify conceptual mastery, exhaustive coverage or an interview outcome.

## Verification

Rebuild manuscripts and figures; run `npm run check:content`, JavaScript syntax, the public build/privacy scan, Java invariant examples and the pinned Spring API-contract compilation. Browse the completed answer after reveal, inspect its selected diagram and follow-up sections, verify contents jumps and hide behaviour, and check both themes. The 45 prerequisite chapters and 304 DSA problems are preserved.

Primary documentation reviewed for integration and correctness boundaries includes [Spring AI 1.1 ChatClient](https://docs.spring.io/spring-ai/reference/1.1/api/chatclient.html), [tool execution](https://docs.spring.io/spring-ai/reference/1.1/api/tools.html), [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) and [Redis script atomicity](https://redis.io/docs/latest/develop/programmability/eval-intro/). Existing reference-specific source links remain in the manuscripts.
