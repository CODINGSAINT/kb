# Authoring contract (for whoever writes content: you, or an assistant)

Flat JSON in `content/` is the source of truth. The site re-reads it on every request,
so a reload shows changes immediately. Keep JSON valid: 2-space indent, and touch only the fields named here.

## 1. Generating day N

`node scripts/new-day.js N` scaffolds `content/day-NN.json` from row N of all three
`study.md` tables (LLD, HLD, AI). Then, for each of the 3 topics:

- **`markdown`** is an interview-style write-up with exactly these `##` sections, in order:
  `Problem`, `Requirements`, `Key abstractions` (HLD may use `Architecture`, AI may use
  `Key concepts`), `Design decisions & trade-offs`, `Follow-up questions` (5–7 numbered questions).
  Aim for 600–900 words. LLD examples are in Java. HLD includes back-of-envelope numbers.
  AI topics connect to Spring AI where relevant.
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
