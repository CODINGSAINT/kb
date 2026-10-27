# Authoring contract (for whoever writes content: you, or an assistant)

Flat JSON in `content/` is the source of truth. The site re-reads it on every request,
so a reload shows changes immediately. Keep JSON valid: 2-space indent, and touch only the fields named here.

## 1. Generating day N

`node scripts/new-day.js N` scaffolds `content/day-NN.json` from row N of all three
`study.md` tables (LLD, HLD, AI). Then, for each of the 3 topics:

- **Learner-first contract (27 Oct 2026):** follow [docs/learner-first/LEARNER-FIRST.md](docs/learner-first/LEARNER-FIRST.md). Teach the interview answer first (scope, classes or architecture, one worked example, the hard part, patterns, follow-ups, a 60-second closing answer); production protocol detail goes under an optional "Going deeper" section that links the labs and runnable code.
- **`markdown`** begins with `## Problem` and `## Requirements`, the visible brief. The gated reference is the completed answer a strong candidate could present and defend. Choose and finish a coherent design: scope/assumptions, concrete API or class/state contracts, final diagrams, worked operations, algorithms, consistency/failures, justified alternatives and answered follow-ups. Explain unfamiliar concepts inside the answer so a fresher can follow while experienced readers can inspect deeper guarantees. The supplied URL-shortener sample establishes depth, not a mandatory layout. Structure may vary by topic; never substitute a checklist, lab assignment or tutorial about how the reader should design it.
- Supply at least two captioned, accessible diagrams that explain this topic's successful operation and important failure. Use an actual board, quantity illustration, class/architecture drawing or timeline when it conveys more than a list of boxes. `build/make-model-designs.js` renders the selected graph directly from canonical topic data; `build/lesson-figures.json` contains the authored 120 causal illustrations; `build/make-lesson-figures.js` renders them. `build/make-special-figures.js` renders the additional board, architecture and bucket pictures. SVG has text alternatives and no scripts or remote content. Run `npm run build:figures` after changing sources.
- Do not pad manuscripts to a word target or paste universal reliability advice into unrelated domains. The earlier 1,500-word gate passed repetitive prose and was replaced by learner-structure, illustration, duplication and integrity checks. These checks detect regressions; they do not certify pedagogy, completeness or production readiness. Review the explanation and worked answers manually against the owner-supplied URL-shortener benchmark. Framework fragments are sketches unless their full executable setup is provided; the selected Spring API family remains explicitly pinned to 1.1.8.
- Author diagram+Markdown source in `build/topics/*.txt` using the block contract in `build/assemble.js`, then run `node build/assemble.js`. Every topic, including day 1, needs an authored block. Update `build/fundamentals/*.md` and `build/make-fundamentals.js` together when adding prerequisites, then run `node build/make-fundamentals.js`. Generated JSON must match authored source.
- **`diagram`** is `{nodes, edges}` with **4–7 nodes**. Coordinates are hand-placed within
  `x: 0–768, y: 0–320`. Default node size is `w:140, h:50`; widen `w` for long labels.
  `shape` is `rect` | `ellipse` | `diamond` | `cylinder` (cylinder = datastore).
  Edges are `{from, to, label?, dashed?}`, and labels should be ≤ 3 words. Leave ≥ 40px gaps between nodes.
- Set `generatedAt` to the current ISO time.

## 2. Evaluating an answer

When asked to evaluate (or listed as `NEEDS EVALUATION` by `node scripts/pending.js`):

- Design topics: compare `userAnswer` against that topic's `markdown`.
- DSA problems: judge `userAnswer` on the problem itself (correctness, complexity, edge cases).
- Write the verdict as Markdown into `answerEvaluation` and set `answerEvaluatedAt` to the current ISO time.
- Verdict shape: first line `**Verdict: Strong / Solid / Partial / Needs work**`, then
  `### What you got right`, `### Gaps`, `### To study next`. Be specific and quote their answer where useful.
- Never edit `userAnswer`. The site clears the verdict automatically when the answer changes.

## 3. Answering doubts

In any `notes` field, a line `#doubt <question>` with no `#doubt-answer` line after it is open.
Answer it by inserting `#doubt-answer <answer>` on the line directly below the question.
The answer can continue over following lines, and a blank line ends it. Don't change any other text in `notes`.

## 4. Day-level sketch review (optional)

Put an image in `content/sketches/`, set the day's `sketch` to `"sketches/<file>"`,
and write a Markdown critique into the day's `evaluation`.

## 5. Conversations (`chat`)

Any topic or DSA problem may carry `"chat": [{ "role": "user" | "assistant", "content": "<markdown>", "at": "<ISO time>" }, …]`.
`kb clarify` / `kb chat` and the site's tutor card append to it, and `kb clear` empties it. The last 24 turns go back to the model
as context. Hand edits are fine, as long as roles alternate user → assistant.

Evaluations and doubt answers made with `kb evaluate`, `kb doubts` or the site's AI buttons follow sections 2 and 3 above exactly,
so hand-written and AI-written verdicts look the same.

## 6. Images in answers

Images live in the data folder's `images/<hash>.<ext>` (older copies: `content/images/`) and are referenced from `userAnswer` as `![alt](/images/<file>)`.
Don't inline `data:` base64 images. The site converts them to files when an answer is saved, and `kb answer` does the same.
When evaluating, chatting or answering doubts, each image is replaced in the prompt text by `[Image N: alt — attached]` and sent as a real image input.

## Where personal fields live

`userAnswer`, `answerEvaluation`, `answerEvaluatedAt`, `notes`, `chat` and `readAt` are **not** stored in `content/`.
They live in the learner's data folder (`../kb-data/progress/<id>.json`, see `lib/userdata.js`), one file per item:
`lld-02.json`, `hld-07.json`, `ai-20.json`, `dsa-<problem key>.json`, `read-<fundamental id>.json`.
Read and write through `lib/store.js` (`readJson` / `writeJson` / `updateItem`), which merges them in and splits them back out.
Don't add these fields to files under `content/` by hand.
