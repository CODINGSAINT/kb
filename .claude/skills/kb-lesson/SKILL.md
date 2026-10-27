---
name: kb-lesson
description: Write or revise a KB interview-prep lesson (LLD, HLD or AI/Spring AI) in the Coding Saint course style – step-by-step, dialogue, callouts, real-value examples, class diagrams and GIFs. Use for any change to build/topics/*.txt.
---

# KB lesson writer

Follow `docs/course-style/STYLE-GUIDE.md` exactly. The reference lessons are **LLD-2 Parking Lot** (`build/topics/lld-a.txt`) and **HLD-1 URL Shortener** (`build/topics/day-01-references.txt`). Read the matching one before writing.

## Workflow

1. **Coordinate.** If working with Codex/Claude in parallel, claim the topic in the shared Logseq brain first (see the `shared-brain` skill) and work on a branch.
2. **Read** the current topic block (`=== LLD 4 ===` etc.) and any linked runnable code, labs and figures. Keep useful depth for *Going deeper (optional)*.
3. **Write** the lesson with the skeleton for its track (style guide §2). Start the block with the selected-design `N|` / `E|` lines (4–7 nodes).
4. **Pictures.** Add class diagrams / flows / GIF specs to `build/learner-figures.json` (style guide §7). Render:
   - `node build/make-learner-figures.js`
   - `node build/make-learner-animations.js <gif-name>` (needs Playwright + ffmpeg; commit the GIF)
5. **Code (LLD).** Put a compact runnable demo in `examples/learning-java/src/kb/<topic>/` and copy it to `public/reference-code/learning/kb/<topic>/`. Compile and run it: `javac -d out <files> && java -cp out kb.<topic>.<Demo>`. Lesson snippets must match the demo.
6. **Build and check:**
   ```
   node build/assemble.js
   node build/make-model-designs.js
   node scripts/check-reference-content.js
   node scripts/check-lld-three.js
   node --check public/app.js
   node build/make-site.js
   ```
7. **Self-review** with the checklist in style guide §10, including the opaque-ID search. Look at the page in the site.
8. **Record** what changed (topic, branch, checks) in the shared brain handoff, then commit with a clear message.

## Do not

- Invent opaque IDs (`E17`, `C17`, `T1`, `D1`…) in prose or diagrams.
- Put idempotency keys, outboxes, ownership tokens or uncertain-payment logic in Steps 1–6.
- Write paragraphs longer than ~60 words or sections that are only prose.
- Copy wording from ByteByteGo, DesignGurus, Educative or other courses; mention them only in internal notes.
- Edit `content/*.json` by hand – it is generated from `build/topics/*.txt`.
