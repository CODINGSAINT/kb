# Chess, Parking Lot and Elevator: worked LLD answers

## Parking Lot clarity review

The follow-up changes **Parking Lot only**. It follows one vehicle/ticket through entry, payment and exit; explains terms after their everyday meaning; keeps the complete answer and useful physical/flow diagrams; and removes competitor links and the duplicate code-like class picture from the lesson. The Java excerpts are selectable text with readable spacing, copied from the complete source. Research provenance stays in this repository note.

Chess, Elevator and the other 57 references are unchanged by this follow-up. The single-article correction is for owner review before applying the style elsewhere or publishing it. Earlier technical checks below do not establish learner approval.

This revision replaces only **LLD-1, LLD-2 and LLD-3**. Each reference presents a chosen solution, ownership/contracts, complete worked execution, failure/recovery decisions, trade-offs and answered follow-ups. Other LLD, HLD, AI and prerequisite material is outside this revision.

## Editorial and implementation decisions

| Answer | The central design decision | Concrete evidence in the answer |
| --- | --- | --- |
| Chess | Immutable complete positions and one versioned game owner; separate attack geometry from legal moves | Before/trial boards, castling transit counterexample, horizontal en-passant pin, four promotions, mate versus stalemate and exact undo with a monotonic version |
| Parking Lot | A visit owns a spot; payment is a separate idempotent intent | Two-gate allocation trace, approved amount and exact fee boundaries, provider outside the lock, uncertain capture reconciliation, grace/top-up arithmetic and stale-exit protection |
| Elevator System | Separate fleet dispatch, per-car directional planning and door guards | Two-shaft pickup estimate, four-stop directional trace, distinct hall/cabin requests, door/load transitions and versioned fault reassignment |

The full Java 21 sources are in `examples/lld-three/` and mirrored to the public download links used by the answers. Named source regions supply 15 exact excerpts. Helpers are available in the complete files; article/source equality is checked rather than maintaining a second illustrative implementation.

The interview scope is explicit. Chess does not include a tournament draw adjudicator or clocks. Parking is in-memory and requires an external provider's idempotency/final-outcome contract. Elevators are a discrete floor-event simulator, not hardware control or a safety certification. Extensions explain what would change; they do not present missing core behavior as a learner assignment.

## Public comparison sources

Consulted on 2026-10-26. Only public material and accessible previews were used. Prose, Java and illustrations in this revision are original; no competitor implementation or diagram is reproduced.

- Design Gurus/Grokking: [parking case](https://www.designgurus.io/course-play/grokking-the-object-oriented-design-interview/doc/design-a-parking-lot), [chess answer](https://www.designgurus.io/answers/detail/how-to-design-chess), [elevator answer](https://www.designgurus.io/answers/detail/how-to-design-an-elevator), [LLD interview coverage](https://www.designgurus.io/blog/low-level-design-interview).
- Educative: [public parking article](https://www.educative.io/blog/design-a-parking-lot), [public elevator class-diagram lesson preview/outline](https://www.educative.io/courses/grokking-the-low-level-design-interview-using-ood-principles/class-diagram-for-the-elevator-system), [course outline](https://www.educative.io/courses/grokking-the-low-level-design-interview-using-ood-principles). Paid lessons were not represented as read.
- AlgoMaster's public problem descriptions: [chess](https://github.com/ashishps1/awesome-low-level-design/blob/main/problems/chess-game.md), [parking](https://github.com/ashishps1/awesome-low-level-design/blob/main/problems/parking-lot.md), [elevator](https://github.com/ashishps1/awesome-low-level-design/blob/main/problems/elevator-system.md). The linked Java implementation directories were not used as code sources.
- Correctness references: [FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023), [Java 21 Duration](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/time/Duration.html), [Strategy](https://refactoring.guru/design-patterns/strategy), [State](https://refactoring.guru/design-patterns/state).

The public comparisons informed expected interview coverage: requirements, actors, class relationships, interactions and extension seams. The additional position trials, allocation/payment lifecycle and direction/epoch traces make this revision's selected contracts explicit and executable. That is an editorial choice for these answers, not a claim about inaccessible paid content.

## Illustrations and reproduction

`build/make-lld-three.js` produces 15 original accessible SVGs: 3 detailed class diagrams and 12 board/layout/timeline/state drawings. They contain searchable vector text, titles/descriptions and no remote assets or active content. Each article supplies meaningful alt text and a full-size link.

Graphviz WASM is the repository's existing pinned `@viz-js/viz@3.31.0` build dependency. It is used only for the class diagrams. The physical boards, lot, lift shafts and execution/state drawings are authored directly as SVG. Browser inspection found and corrected a label overlap and reduced class-diagram fan-out; all 15 then had their rendered text bounds/overlaps checked.

```sh
npm ci
npm run build:content
npm run build:figures
npm run check:content
npm run check:lld-three
javac -d .qa-lld examples/lld-three/*.java
java -cp .qa-lld lldthree.ThreeChecks
npm run build:site
```

The harness checks initial chess perft counts 20/400/8,902 plus targeted special-move/undo fixtures; a 24-contender last-spot race, non-blocking provider boundary and payment/grace failures; and elevator direction/coalescing, 4/9-event pickup estimates, door/load guards, stale acknowledgements and 50 seeded finite workloads. These are meaningful regression checks for the selected behavior, not a quality score or a production/fairness proof.

Before publication, the actual three pages were opened in a local browser in light and dark themes: reference reveal, section navigation, all six pictures per page (overview plus five new drawings), and no page-wide horizontal overflow at 1280×720. Build safety checks continue to exclude personal study fields. A hash comparison against the base confirmed the other 57 generated references were unchanged.

The reference-content workflow rebuilds sources/figures, checks generated parity and source excerpts, runs both existing and new Java mechanisms, compiles the existing Spring API examples, and builds/scans the static site. Publication state is recorded separately in the PR and shared project handoff; a successful local build alone does not establish deployment.
