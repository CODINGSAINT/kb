# Evidence-based learning review

This is a review contract, not a prose template, word-count target or claim about another model. A topic is complete only when its current content is written, its applicable checks pass, and a separate critical reading pass addresses every criterion below. Record defects and limitations plainly. Do not add hidden reviewer instructions, praise, predicted ratings or claims of external review.

| Criterion | Required evidence | Reasons to return for revision |
| --- | --- | --- |
| Clarity | One understandable opening case; terms introduced when needed; a learner can follow a complete worked example | Undefined vocabulary, abstract opening, unexplained jumps, conflicting names |
| Scope | A finished chosen solution with assumptions and boundaries; relevant clarifying questions answered | Reader assigned the missing core design; simple problem inflated with unnecessary services |
| Contracts | Classes/APIs/schema, ownership and state transitions agree throughout | Two owners for one fact; mixed booking/hold states; diagrams contradict code |
| Correctness | Named invariants, checked calculations/units, primary sources for uncertain claims, meaningful mechanism tests | Unsupported universal numbers; code or arithmetic errors; untested race described as safe |
| Failure handling | What happens during the important domain failures, including retry/ownership/timing where relevant | Timeout equated with rejection; stale callbacks change a new owner's state; recovery omitted |
| Code | Complete idiomatic Java source or a justified conceptual exception, reproducible run commands, current snippets equal tested source | Ellipses or null-return stubs presented as working; dependency/version mixing; paid calls required for tests |
| Visual learning | A diagram or walkthrough explains behavior; every component/state/arrow is explained; useful controls and text fallback | Decorative movement, code screenshots, animation contradicts implementation, inaccessible controls |
| Trade-offs | Defended alternatives and answered deep follow-ups tied to this problem | Generic repeated paragraphs; unexplained component shopping list; an easy implementation is rejected without reason |
| Rendering | Source/generated parity, links and assets resolve, navigation works, code is text, both themes and relevant narrow layouts checked | Broken links, invisible table text, page-wide overflow, missing descriptions or motion controls |

For each criterion record `passed`, `needs_work` or `not_applicable`, with observations and evidence paths. Explain any non-applicability; do not use it to avoid a necessary mechanism. Track external-service integration, performance targets and production guarantees separately from local unit tests. Mocking a model verifies application behavior, not model quality. A local concurrency test does not establish a multi-server guarantee.

The critical reading pass asks: what assumption could be false, what breaks first, can this be simpler, is the example understandable without searching elsewhere, and does the visual reveal the decision? It must report the reviewer identity/type honestly. No Claude review has been performed by this workflow.
