# AI-2 handoff

Ready for parent integration/review, not campaign acceptance. All writes are isolated here. No shared source/state/manifest/lease/Logseq/commit/publication changes.

Destinations: article.md → AI category/number2 in content/day-02.json using excerpt tooling; header.txt → that topic's six-node overview/designs/ai-2.svg. Copy examples/learning-java/src/kb/prompting/PromptEngineering.java and all staged public/ files to the same repository-relative destinations. Public assets are two learning-figures SVGs, prompt-engineering.html/.css/.js and the exact source download under reference-code/learning/kb/prompting. Java source mirror SHA-256 matches. No shared lab changes; do not integrate .checks/classes.

The chosen answer preserves the incident-summary task while replacing sketches with a finished prompt/data contract, explicit unknowns, immutable message assembly, candidate guards and a controlled evaluation design. The code is a complete JDK21 mechanism, not a provider adapter or response JSON parser. Conceptual exception is deliberate: this lesson teaches prompt construction/evaluation; AI-6/7/8 supply the framework/parser boundaries. No new framework API is claimed; adjacent baseline is Java21/SpringAI1.1.8/Boot3.5.15.

Actual focused check: supplied JDK21 javac --release21, then java kb.prompting.PromptEngineering, exit0. Output:

```text
PASS: role/data assembly, escaping, immutable isolated requests, bounds, identity and unknown fields.
LIMIT: an invented cause can pass structural guards; evidence review/model evaluation is separate.
incident-card-v1: 2 messages; incident-card-v2-example: 4 messages.
```

Opened primary sources: Brown et al. [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165), for demonstrations in context without gradient updates; [OWASP prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), for layered external enforcement. Existing accepted AI-1/6/7/8 and OWNER-SCOPE/RUBRIC/BENCHMARK were read. No competitor/course referrals.

Visuals: explicit role/message assembly and permission/data boundary SVGs with title/desc. Inspector toggles example pair and ordinary/hostile data and shows human-specified expected facts; it explicitly calls no model and claims no prompt-quality gain. Manual controls, text fallback and kb-theme light/dark/system default are implemented. Browser/assistive/rendering checks remain pending.

Limits and parent gates: no model calls, real quality score, tokenizer/token budget, injection-resistance rate, JSON-response parsing, live provider or production endpoint was tested. Pending excerpt/source-generated parity, normal build/links/integrity, narrow/theme/keyboard browser checks, SVG layout and distinct critical review. An invented cause passing structural checks is intentionally demonstrated, not hidden.

Exact next action: parent integrate the listed files/AI-2 source, run consolidated gates and review; worker proceeds immediately to AI-3 as assigned.
