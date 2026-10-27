# AI-1 integration handoff

## Scope and state

Draft is ready for the parent to integrate and review. All writes from this worker are confined to `.learning-work/parallel/AI-1/` in the `kb-learning-quality` worktree. No source topic, protected Fundamentals file, shared lab infrastructure, campaign manifest/lease, Logseq page, Git commit, PR or publication was changed.

This is the **AI track reference AI-1 in content/day-01.json**, not `content/fundamentals.json` and not a build/fundamentals page.

## Destination mapping

| Staged file | Intended repository destination |
| --- | --- |
| `article.md` | Replace markdown only for category `AI`, number `1`, title `AI/LLM Fundamentals` in `content/day-01.json`, using normal article/excerpt integration tooling. |
| `header.txt` | Replace that same topic's overview nodes/edges; normal build produces `designs/ai-1.svg`. Six nodes and five edges are staged. |
| `examples/learning-java/src/kb/aifundamentals/AiFundamentals.java` | Same repository-relative path. No framework dependencies; Java 21 only. |
| `public/learning-figures/ai-1-training-inference.svg` | Same repository-relative path. |
| `public/learning-figures/ai-1-grounded-request.svg` | Same repository-relative path. |
| `public/learning-labs/ai-fundamentals.html` | Same repository-relative path. |
| `public/learning-labs/ai-fundamentals.css` | Same repository-relative path. |
| `public/learning-labs/ai-fundamentals.js` | Same repository-relative path. |

Do not copy `.check-classes/` as content. `mechanism-check.txt` is actual local evidence. WIP.md and this handoff are staging notes, not lesson content.

The article uses supported excerpt placeholders for `AiFundamentals.java#budget` and `#distribution`; matching `// BEGIN` / `// END` markers exist. The file also contains a complete cumulative sampler, entropy calculation, validated budget/passage records and a runnable main with mechanism checks.

## Content decisions

- Concrete case: explain the absence of an insertion-order guarantee in HashSet, then select LinkedHashSet for ordinary insertion-preserving additions. Java 21 repositioning methods are acknowledged. Source-card approval/revision labels are explicitly fictional application fixtures.
- Finished application: one Java service, approved/permitted revisioned sources, scoped search, counted context, a read-only generator, checked citation IDs and explicit answer/failure statuses. Semantic support is not falsely promised by ID/schema checks.
- Exact rules remain in deterministic code. Start small with static FAQs and full-text retrieval; embeddings and fine-tuning need evidence of a specific gap.
- Toy probability fixture is normalized correctly. T=0.5 squares and renormalizes 0.6/0.3/0.1 to 0.782609/0.195652/0.021739. Sequence probability uses the conditional product 0.6 × 0.8 = 0.48. Neither is a truth probability.
- Context example uses a declared fictional 4,096-token total, not a real model capacity. Token sizes are external tokenizer inputs; final assembled-request accounting is checked separately from additive planning estimates. S1/S2/S3 sizes are not asserted for the short source-card text.
- Lab changes toy distributions and temperature, displays entropy/leading scores, draws independently from one fixed prefix and explains why this is not a generated conversation. A wrong-leading fixture shows that lower temperature can sharpen an error. No provider, credentials, paid accounts, network call or fake model-quality test is involved.
- Lab is topic-owned HTML/CSS/JS, uses `kb-theme` with light/dark/prefers-color-scheme and an explicit toggle, has keyboard-native controls, live text status, a text table and no-JavaScript comparison. It modifies no shared lab.js/lab.css file. No animation runs.
- Passive SVGs have title/desc and text labels. They explain training/inference and the grounded question lifecycle; the article explains their paths and limitations.

## Primary sources actually opened

- [Java 21 HashSet API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/HashSet.html) — the ordering contract used by the concrete question.
- [Java 21 LinkedHashSet API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/LinkedHashSet.html) — insertion/encounter order, duplicate additions and explicit repositioning methods.
- [Attention Is All You Need](https://arxiv.org/abs/1706.03762), plus [full paper HTML](https://arxiv.org/html/1706.03762v7) — original Transformer, attention/causal masking and the encoder-decoder versus modern decoder-only distinction.
- [Hugging Face tokenizer documentation](https://huggingface.co/docs/transformers/en/tokenizer_summary) — model-dependent subword units; no fixed word/character ratio.
- [Hugging Face generation API](https://huggingface.co/docs/transformers/en/main_classes/text_generation) — temperature and top-k/top-p as distinct generation controls. The article does not claim a universal API default or accepted T=0 contract.
- [Original RAG paper](https://arxiv.org/abs/2005.11401) — retrieval with external passages versus model parameters.
- [scikit-learn data leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage) — test isolation and information unavailable at prediction time.
- [OWASP prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) — untrusted retrieved data, application authorization and output handling.

The attachment was sampled for depth/style only. No course/customer competitor referral was included. No Spring API is used or taught in this conceptual article, so no framework version mixing is introduced.

## Checks actually run and checks pending

**Passed:** one `javac --release 21` compile using the supplied Java 21 JDK, then one execution of `kb.aifundamentals.AiFundamentals`; exit 0. Evidence is `mechanism-check.txt`. Checks cover normalization and expected values, greedy/ties, logit shift invariance, entropy, a wrong leading answer, cumulative sampling intervals, invalid probabilities/temperature/draws, whole-passage omission, considering a smaller later passage, duplicate IDs and final context admission at the exact boundary.

**Pending parent gates:** excerpt integration and source/generated parity; normal build/integrity/link checks; standalone lab JS/browser behaviour; narrow layout, keyboard/assistive semantics and both themes; SVG layout; separate critical reading against every rubric criterion. This worker made a consistency pass while drafting but does not claim independent review, Claude review or a completed browser/accessibility audit.

**Limits:** the Java mechanism is not a real tokenizer, RAG implementation or provider client. The complete application is a finished bounded design, not a runnable backend. No model quality, privacy terms for a selected provider, production authorization implementation, provider pricing/capacity/performance or prompt-injection resistance was measured. The lesson states these limits and gives the separate evaluation plan.

**Exact next action:** parent copies the eight content/code/assets above to their destinations, applies article/excerpts and header to AI-1, then includes AI-1 in the batch's consolidated build/integrity/browser/critical-review gates. Do not mark AI-1 reviewed or complete in the campaign until those gates finish.
