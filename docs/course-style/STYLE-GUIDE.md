# KB course style guide (design system)

Version 1 · 27 Oct 2026 · Reference lessons: **LLD-2 Parking Lot** and **HLD-1 URL Shortener**.
Every lesson – written by Pallav, Claude or Codex – follows this guide. When in doubt, copy what those two lessons do.

## 1. The promise to the reader

A learner preparing for an interview should be able to:

1. understand the problem in two minutes,
2. follow one clear design step by step,
3. say it out loud in an interview, and
4. answer the usual follow-ups.

Readability beats completeness. Production detail is welcome, but only after the interview answer, in **Going deeper (optional)**.

Benchmarks for look and feel: ByteByteGo (OOD chapters) and DesignGurus (Grokking). Learn from their structure, never copy their text.

## 2. Lesson skeleton

Every lesson starts with the visible brief, then numbered steps. Headings are exact.

```
## Problem            – 2–3 short paragraphs, plain language, one real-world example
## Requirements       – 4–6 bullets
## Step 1: …
## Step 2: …
…
## Interviewer follow-ups
## Wrap up            – (LLD/HLD) summary + 📝 Key takeaways callout
## Going deeper (optional)
## Closing answer     – the 60-second spoken answer, in quotes
```

Step titles may name the topic's own content ("Step 4: The hard part: two users, same seats"), but the order and the kind of content below are fixed.

### LLD steps

| Step | Heading | Contents |
| --- | --- | --- |
| 1 | Step 1: Clarify the requirements | Candidate/Interviewer dialogue (5–7 exchanges) → 🎯 callout → functional / non-functional table |
| 2 | Step 2: Identify the core objects | Bulleted nouns with one-line jobs → selected-design picture → ⚖️ callout |
| 3 | Step 3: Design the classes | `###` per class: 1–3 sentences each, a small class diagram for the key hierarchy, then the complete class diagram |
| 4 | Step 4: Write the code | `###` per class, short Java blocks, a worked example with real values, a table of edge cases |
| 5 | Step 5: The tricky part | Usually concurrency: numbered race → GIF → fix → ⚠️ callout → 🎯 multi-server note |
| 6 | Step 6: Deep dives | `###` per extension: new type, new rule (Strategy), faster lookup, observers |

### HLD steps

| Step | Heading | Contents |
| --- | --- | --- |
| 1 | Step 1: Clarify the requirements | 💡 tip → dialogue → numbered functional and non-functional lists |
| 2 | Step 2: Estimate the scale | 💡 tip → `text` blocks of aligned arithmetic, each followed by "What it means: …" |
| 3 | Step 3: Define the API | `http` blocks, error codes in one line, 🎯 callout |
| 4 | Step 4: Define the data model | One table per store, ⚖️ callout on database choice |
| 5 | Step 5: Draw the high-level design | Selected-design picture → numbered write path and read path → GIF |
| 6 | Step 6: Go deep | `###` per decision: Option 1/2/3 with **Good:** / **Problem:** bullets → ⚖️ decision → ⚠️ mistake |
| 7 | Step 7: Find bottlenecks and failure points | Table: what fails · what happens · how we handle it |
| – | Putting it together | 3 bullets: create / read / scale |

### AI / Spring AI steps

| Step | Heading | Contents |
| --- | --- | --- |
| 1 | Step 1: The idea in plain words | Plain-language explanation, one analogy, a term table, 🎯 "what interviewers ask" |
| 2 | Step 2: How it works (title may name the mechanism) | Numbered mechanism, a worked example with numbers, picture or GIF |
| 3 | Step 3–4: In code with Spring AI | Short Spring AI 1.1.8 code; one block per concept; explain each call in one line |
| 4 | Step 4–5: Common mistakes | Mistake → better table, ⚠️ callouts |
| 5 | Last step: Production concerns (limits, cost, testing, evaluation) | Limits, cost, testing, evaluation – short bullets |

## 3. Writing rules

- **Short paragraphs:** 1–3 sentences. One idea per paragraph.
- **Second person, active voice:** "You keep spots in one place", "We return 302".
- **Plain words first, term second:** "checking and taking the spot in one step – this is called *atomicity*".
- **Every number means something:** follow estimates with "What it means: …".
- **Options before decisions:** list options with **Good:** / **Problem:**, then a ⚖️ Design choice with the reason.
- **No walls of text:** if a paragraph passes ~60 words, split it or turn it into a list.
- Use ₹ and Indian examples where natural; money in paise (`long`) or `BigDecimal`, time as `Instant`/`LocalDate`.

## 4. Naming examples (the E17 rule)

Never invent opaque identifiers such as `E17`, `C17`, `S17`, `T1`, `D1`, `O1`, `P17`, `W17`, `R1`, `L1`.

| Instead of | Write |
| --- | --- |
| Ticket S17 for spot C17 | "Asha's ticket for Floor 1, spot 7" |
| Driver D1, trip T1 | "Ravi (the nearest driver) and Asha's trip" |
| Booking B1 | "Asha's booking" |
| Request E17 | "the entry request" (show an ID only inside code) |
| Loan L1 of copy C17 | "Asha's loan of the *Practical Java* copy" |

Real-looking values are fine: number plates (`KA-01-AB-1234`), seat numbers (`A7`), short codes (`aZ3k9Qx`), amounts (₹250), times (9:00).
Recurring people: **Asha**, **Bilal**, **Ravi** (driver/staff), **Chetan**. Use at most three per lesson.

## 5. Callouts

Write a blockquote whose first line is a bold emoji title. The site turns it into a coloured card.

```
> **💡 Tip**
> Do not start with servers or databases.
```

| Title | Use for | Per lesson |
| --- | --- | --- |
| `**💡 Tip**` | Interview technique or a mental shortcut | 1–3 |
| `**🎯 In the interview**` | What to say or ask; what interviewers look for | 1–3 |
| `**⚖️ Design choice**` | A decision and its reason | 2–5 |
| `**⚠️ Common mistake**` | A specific wrong approach and why it fails | 1–3 |
| `**📝 Key takeaways**` | 3–5 bullets in Wrap up | exactly 1 |

Keep callouts to 1–3 sentences (Key takeaways: bullets). Never put a whole section inside a callout.

## 6. Dialogue

Requirements are gathered as a conversation. Each turn is its own paragraph, starting exactly with `**Candidate:**` or `**Interviewer:**`. The site renders them as chat bubbles.

```
**Candidate:** Which vehicles do we support?

**Interviewer:** Motorcycles, cars and trucks.
```

The candidate asks; the interviewer answers briefly. The candidate may state a choice ("I'll give the smallest spot that fits"). 5–7 exchanges.

## 7. Pictures

| Picture | Where | How |
| --- | --- | --- |
| Selected design (required) | LLD Step 2 / HLD Step 5 / AI Step 2 | Topic header `N|`/`E|` lines → `public/designs/<cat>-<n>.svg` (4–7 nodes, labels ≤ 3 words) |
| Class diagrams | LLD Step 3 | `kind: "class"` in `build/learner-figures.json` |
| Flows and state machines | Any step | `kind: "flow"`; `engine: "circo"` for rings |
| Animated GIF | Only where motion teaches: a race, a state machine, a queue, a ring | Add `gif` + `steps` (4–7 steps, one short caption each) |

- Every picture has alt text of at least 30 characters that states what the picture shows.
- Every GIF has a static SVG twin with the same spec.
- At least two `learning-figures/*.svg` images per lesson (required by `check:content`).
- Graph labels use real values (`Floor 2, spot 9`), never opaque IDs.

## 8. Code

- Java 21, Spring Boot 3.5.x, Spring AI 1.1.8.
- Short classes, one block per class, ≤ 40 lines per block; lines ≤ 90 characters.
- Comments explain *why*, not *what*. No long trailing comments.
- LLD main-path code must compile. Put a compact runnable demo with checks in
  `examples/learning-java/src/kb/<topic>/` and the same file in `public/reference-code/learning/kb/<topic>/`.
- Advanced production code (idempotency, outboxes, ownership tokens) is linked from Going deeper, never inlined in Steps 1–6.

## 9. Interviewer follow-ups and closing

- 4–7 follow-ups, each `**Question?**` followed by a 1–3 sentence answer.
- Wrap up: one sentence summary + 📝 Key takeaways.
- Closing answer: 80–130 words in quotes, first person, the design in the order of the steps.

## 10. Quality checklist (run before committing)

- [ ] Skeleton headings exact; Steps numbered `Step N:`.
- [ ] Dialogue in Step 1; at least 4 callouts of 3 different kinds.
- [ ] No opaque IDs (search: `\b[A-Z]{1,2}\d{1,3}\b` outside code blocks).
- [ ] No paragraph over ~60 words; no section without a heading, list, table, code or picture for 3+ paragraphs.
- [ ] Pictures: selected design + ≥2 learning figures, alt text ≥30 characters; GIFs have SVG twins.
- [ ] LLD code compiles and its demo checks pass.
- [ ] `node build/assemble.js && node build/make-model-designs.js && node build/make-learner-figures.js && node scripts/check-reference-content.js && node scripts/check-lld-three.js` all pass.
- [ ] Read it once in the site (light and dark) before committing.
