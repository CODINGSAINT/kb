# Sample review before rewriting

Reviewed only three Fundamentals chapters: `lld-approach`, `hld-estimation`, and `ai-semantic-retrieval` from `content/fundamentals.json`. Their authorship is not inferred. No Fundamentals source is being rewritten.

## What to preserve

- **LLD approach:** one parking example carries the reasoning from scope to objects to operations. Questions have a stated purpose. Small code and a specific mistake make each decision easier to understand. Pattern names follow a real variation point.
- **HLD estimation:** formulas keep units visible; worked arithmetic shows how scale changes a decision. Assumptions and approximations are often stated explicitly instead of hiding them inside a diagram.
- **Semantic retrieval:** lexical search comes before embeddings; similarity is distinguished from truth; model-space compatibility, filtering and source permissions affect the design. It explains when a technique fails rather than treating it as automatically useful.

## Limits of the sample

The LLD method chapter contains deliberately incomplete service sketches, so those cannot be treated as complete runnable references. Advice such as always extending through new classes is a heuristic, not an absolute rule. The estimation chapter's KB/KiB terminology, hot-key sizing assumptions and local-versus-end-to-end latency examples need care when used in a new answer. Preserve the teaching method without copying assumptions as universal facts. Do not change these protected chapters under this campaign.

## Comparison with three current references

| Reference sampled | Useful material to retain | Concrete gaps to fix |
| --- | --- | --- |
| LLD-4 Movie Booking | Show-seat identity, hold tokens, all-seat transaction, late-payment compensation, frozen quote | Hold versus Booking states conflict later; a sketch uses undefined types/helpers; expiry rules differ; no complete Java flow or executed multi-seat race |
| HLD-2 Rate Limiter | Shared authority, explicit degraded policy, request identity, distinction between exhaustion and outage | Two incompatible sizing examples; fixed Lua expiry irrespective of refill horizon; clock-regression behavior; repeated sections and an empty heading; whole-architecture claims are not validated by an atomic local example |
| AI-7 ChatClient | Fresh request specs, response modes, usage, partial streams and authorization boundaries | Repeated API fragments; lacks complete dependency setup/service/test; some listed background sources do not explain ChatClient; method execution and subscription claims need checking against pinned source |

The Fundamentals samples are more effective at progressive explanation than these references, while the references contain useful domain-specific failure detail. The benchmark combines that progression with finished solutions and reproducible mechanism evidence. Completion is governed by RUBRIC.md, not by length or a claim of superiority.

## Version and research baseline

Use Java 21 and Spring AI **1.1.8** with Spring Boot **3.5.15** for this campaign. This is an explicit reproducible teaching baseline, not a claim that it is the latest release. The official [1.1.8 release announcement](https://spring.io/blog/2026/06/12/spring-ai-1-1-8-1-0-9-avaialble-now/) identifies that Boot baseline; the [versioned ChatClient documentation](https://docs.spring.io/spring-ai/reference/1.1/api/chatclient.html) identifies Spring AI 1.1.8. Check method behavior against the [v1.1.8 source](https://github.com/spring-projects/spring-ai/tree/v1.1.8), then compile the actual examples. Avoid mixing 2.x advice into 1.1.8 code.

Research notes belong here or in per-topic evidence. Do not insert competing-course referrals into customer lessons. Primary technical documentation may be linked when it directly helps explain a contract.
