# Learner-first article contract

> Superseded on 27 Oct 2026 by [../course-style/STYLE-GUIDE.md](../course-style/STYLE-GUIDE.md). Kept for history.

Adopted 27 October 2026 for the 19 completed references (LLD 4, 5, 6, 7, 9, 10, 16; HLD 1–5; AI 1, 2, 3, 4, 6, 7, 8).
Use it for every new or revised reference. It supersedes the "complete production answer" emphasis in earlier reviews.

## Why

The previous pass made each reference a complete, defensible production design: idempotency keys, uncertain
payment outcomes, ownership tokens, outboxes, epochs and clock-error budgets in the main path. That work is
correct and is kept, but it hid the interview answer. A learner preparing for a 45-minute round needs to
understand the problem, choose a clear design, explain it confidently and answer the usual follow-ups.

Benchmarks checked on 27 Oct 2026 (structure only, no content copied):

- Hello Interview LLD delivery framework: requirements → entities → class design → implementation → extensibility;
  warns against forcing patterns and diving into edge cases before the structure is understood.
- Educative "Grokking the Low-Level Design Interview": requirements → use case → class diagram → sequence/activity
  diagrams → code → key insights.
- AlgoMaster LLD guide: clarify → entities → classes → implement → exceptions.
- ByteByteGo / *System Design Interview* (Alex Xu): understand and scope → high-level design → deep dive → wrap up,
  with back-of-the-envelope estimates.

## Structure

Every reference keeps the `## Problem` and `## Requirements` brief, then:

| LLD | HLD | AI / Spring AI |
| --- | --- | --- |
| 1. Clarify the scope (questions + chosen answers, 45-minute plan) | 1. Clarify requirements and estimate the scale | 1. The idea in plain words (+ what interviewers ask) |
| 2. Core classes (table, enums, class diagram) | 2. API and data model | 2. How it works (concept + numbers) |
| 3. Main flow with a worked example and code | 3. High-level design (create/read paths) | 3.–4. In code with Spring AI 1.1.8 |
| 4. The hard part interviewers probe (usually concurrency) | 4.–5. Deep dives, scaling and failures | 5. Common mistakes / trade-offs |
| 5. Design patterns and extensibility | | |
| Interviewer follow-ups | Interviewer follow-ups | Interviewer follow-ups |
| Going deeper (optional) – the earlier production detail, labs and runnable code | same | same |
| Closing answer – a 60-second spoken summary (doubles as a video outro) | same | same |

## Rules

- One running example with concrete numbers (Asha and Bilal, ₹ amounts, real timings) carries the lesson.
- Main-path code is short, idiomatic Java that a candidate could write on a whiteboard. Advanced protocol code
  lives in the linked reference implementation, not in the main path.
- Name the standard patterns where they genuinely fit (State for ATM, Strategy for pricing/splits/matching,
  Observer for notifications) and say why; never add a pattern only to decorate.
- Explain one hard part properly (check-then-act race, interval overlap, greedy correctness) instead of every
  possible failure.
- Production concerns (idempotency, uncertain outcomes, outboxes, tokens, epochs) go in "Going deeper (optional)"
  with a one-line reason, the existing labs and the runnable code.
- Pictures: a class or architecture diagram first, then the key flow. Animated GIFs only where motion teaches
  something (a race, a state machine, a queue, a ring). Every GIF has descriptive alt text and a static SVG twin.
- Money in paise/cents as `long` or `BigDecimal`, time as `Instant`/`LocalDate` – say why once.

## Figures

- `build/learner-figures.json` – specs for class diagrams, flows and state machines (Graphviz).
- `node build/make-learner-figures.js` – renders the static SVGs into `public/learning-figures/` (part of `npm run build:figures`).
- `node build/make-learner-animations.js [name]` – optional; renders step-by-step GIFs from specs that have `gif` and
  `steps`. Needs Playwright (Chromium) and ffmpeg. GIFs are committed, so normal builds and CI do not run it.
