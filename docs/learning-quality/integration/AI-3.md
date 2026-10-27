# AI-3 handoff

Ready for parent integration/review. All authored files isolated here; no shared source/state/manifest/lease/Logseq/commit/publication edits.

Destinations: article.md → AI category/number3 in content/day-03.json using excerpt tooling; header.txt → that six-node overview/designs/ai-3.svg. Copy examples/learning-java/src/kb/llmparameters/RequestControls.java and every staged public/ file to identical repository-relative paths. Public contains two learning-figures SVGs, llm-parameters.html/.css/.js and the source download under reference-code/learning/kb/llmparameters. Source mirror SHA-256 verified. Excerpts are standalone supported markers. Do not integrate .checks/classes.

Actual focused check: supplied JDK21 javac --release21 then java kb.llmparameters.RequestControls, exit0:

```text
T=1, top-p=.7: [0.666667, 0.333333, 0.000000, 0.000000]
T=.5, top-p=.7: [1, 0, 0, 0]; made-up charge = 0.008 credits.
PASS: normalized nucleus, shift invariance, invalid input, capabilities, context, unknown usage and retry budgets.
```

The JDK mechanism is deliberately framework-independent: declared temperature-then-nucleus order with stable ties, simplified capability/context admission, exact fictional per-million rates, missing usage preserved, and retry admission under original time/attempt bounds. It is not a tokenizer/provider/transport/retry executor. Real parameter ranges/combinations, reasoning/cached accounting, stop/refusal normalization, cancellation/billing and output enforcement need the actual endpoint contract. Adjacent framework baseline remains Java21/SpringAI1.1.8/Boot3.5.15; no new uncompiled framework methods or 2.x advice.

Opened primary sources: [Holtzman et al., nucleus sampling](https://arxiv.org/abs/1904.09751) and [official Transformers generation API](https://huggingface.co/docs/transformers/en/main_classes/text_generation). Article explains one normalized example, explicit artificial context/rates, Little's-Law average assumptions, first-token versus remaining-token timing, one retry owner and side-effect reconciliation. No price/model-capacity recommendation, paid call or fake model-quality/performance result.

Visuals: separate controls/finish gate SVG and original-deadline/backoff SVG with title/desc. Manual inspector computes the same four-candidate toy temperature/top-p stages; table/transcript/no-JS fallback, native controls and kb-theme/system-default toggle are implemented. No provider/quality claims.

Pending parent gates: excerpt/source-generated parity, build/link/integrity, both themes/narrow/keyboard/assistive/browser interaction, SVG layout and distinct critical review. No tokenizer, provider, real billing, remote retry, load or model quality was tested. Parent should include the new JDK package in consolidated example checks/exports.

Exact next action: parent integrates/checks/reviews AI-3; worker proceeds immediately to assigned AI-4.
