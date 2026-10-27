# LLD-16 integration handoff

State: local staged draft only. No commit, push, PR, merge, deployment, manifest change or Logseq write by this subagent. All writes stayed below `.learning-work/parallel/LLD-16/`.

## Destinations

| Staged file | Destination / integration action |
| --- | --- |
| `article.md` | Replace only the LLD-16 topic markdown in `content/day-16.json`, using the parent's guarded campaign transaction. Keep `## Problem` and `## Requirements` first. |
| `header.txt` | Feed the campaign header option; five nodes describe the actual implemented boundary. |
| `examples/learning-java/src/kb/tictactoe/*.java` | Copy to the same paths under the worktree. Four Java 21 files, no dependencies. |
| `public/reference-code/learning/kb/tictactoe/*.java` | Exact downloadable copies of those four sources; same paths under worktree. The existing recursive source-export loop can also refresh them. |
| `public/learning-labs/tictactoe.{html,css,js}` | Same paths. Standalone topic lab; no shared `lab.js` or global app edit required. |
| `public/learning-labs/tictactoe-traces.json` | Same path; exported by `TicTacToeTrace` using the actual Game. |
| `public/designs/lld-16.svg` | Same path; parent may instead regenerate this overview from header.txt. |
| `public/lessons/lld-16-flow.svg`, `lld-16-failure.svg` | Same paths. Behavioral move-flow and race diagrams, both with title/description. |

The two source placeholders are **standalone**, since `scripts/apply_learning_article.py` supplies its own Java fences. Both use `#complete` markers; do not wrap them in another fence. The core excerpt contains the complete package, imports, class and helpers. The demo has its own complete marker.

The article's download links assume the supplied `public/reference-code/learning/kb/tictactoe/` copies are installed. The lab's back link is the observed topic route `../#/t/16/0`.

## Chosen design and content

- Fixed 3×3, two players, X starts; deliberately no generic game framework, player subclass tree, strategy interface, database or network stack in the implementation.
- `Game` owns a private Board, next mark, result and version. Both reads and moves synchronize on that object. Invalid requests return a typed rejection with no mutation.
- Immutable snapshots use a detached unmodifiable `List<Mark>`; no mutable board array escapes. Terminal snapshots have nextPlayer EMPTY.
- Version equals accepted move count for this no-undo game. The undo follow-up explicitly requires a separate monotonic revision so versions cannot be reused.
- Direct line scanning is justified for nine cells. The N×N complexity discussion distinguishes O(N) line checks, O(N²) snapshots and optional O(1) full-line counters; counters are not described as a connect-K solution.
- Worked win includes an occupied-cell rejection and a game-over rejection. Checked draw and ninth-move win sequences are also supplied, with complete explanations.
- Follow-ups answer bots, connect-K, counter alternative, exact retry receipts, multi-server authority, undo and snapshot ownership. Human input is trusted local input here; player accounts/authentication are explicitly outside scope.

## Actual checks run

One compilation of all four staged Java files with `C:/Users/07pal/.sdkman/candidates/java/21-oracle/bin/javac.exe --release 21`, then one mechanism run and demo run. Results:

```text
PASS: 119,800 checks; 5,478 legal positions; invalid moves, snapshots, final-square win/draw and same-version race
```

The checks enumerate all reachable legal positions and compare Game's outcome with an independent eight-line oracle. They check mark-count/turn/version invariants, immutable and detached snapshots, unchanged state on rejection, independent games, final-cell win versus draw, terminal rejection and two threads competing at the same version. The race proves the expected local mechanism for shared objects; no distributed or performance claim is made.

Evidence saved under `.checks/java-checks.txt` and `.checks/java-demo.txt` in this stage. Classes are also only in `.checks/classes/` and need not be integrated.

`TicTacToeTrace` was run once after compilation. Its JSON parsed successfully:

```text
win: 8 frames; final X_WON; terminal request GAME_OVER
draw: 11 frames; final DRAW; terminal request GAME_OVER
last-win: 11 frames; final X_WON; terminal request GAME_OVER
```

`node --check public/learning-labs/tictactoe.js` passed. All three SVGs parsed as XML and contain title/desc. Later changes added only excerpt-marker comments, source download links and the corrected topic back link; no Java behavior changed after this run. The four staged download copies were then verified against their sources by SHA-256 equality; an expanded article preview is saved at `.checks/expanded-article.md`.

To regenerate trace after integration, from repository root:

```text
java -cp <compiled-classes> kb.tictactoe.TicTacToeTrace
```

Save its UTF-8 stdout as `public/learning-labs/tictactoe-traces.json`. The current shared Java build script compiles recursively but runs only booking/rate-limit checks; if the parent extends its explicit runner, use the exact case-sensitive class names `TicTacToeChecks` and `TicTacToeTrace` (a simple package.title() produces the wrong capitalization).

## Pending gates and review

- Parent's source transaction, excerpt expansion, generated/source parity, manifest evidence and article link/structural gates.
- Parent's critical reading pass and browser checks after integration: light/dark, narrow layout, navigation, keyboard focus, guided prev/next/reset, transcript, free-play occupied/wrong-turn/stale/game-over, terminal line highlighting and no-JS fallback.
- No browser-rendering or accessibility audit was performed by this subagent. The lab includes visible focus, accessible labels/live result text, text traces, kb-theme with system fallback and no automatic motion; these are implementation facts, not a claim of passed browser review.
- Free play uses an isolated browser implementation of the same small rules. Guided cases are derived directly from Java; free-play parity remains a parent browser gate.
- No paid provider calls, external-service integration or production guarantees are involved.

Author self-review only (Codex subagent): clarity, scope, contracts, failure handling and trade-offs have concrete evidence in the article. Java correctness and code have the executed checks above. Visual learning has purposeful staged assets; rendering remains needs_work until parent browser review. No independent human, Claude or external review is claimed.

## Primary technical sources consulted

- Java 21 JLS 8.4.3.6, synchronized methods: https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4.3.6 . Confirms the instance method locks that object's monitor.
- Java 21 List API, List.copyOf: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection) . Confirms unmodifiable-list semantics; mutable elements still need attention, so this example copies enum values.

No competitor links or article text were used. The task's accepted Parking Lot opening and internal rubric/benchmark informed the progression. The owner's enhanced URL-shortener file was inspected as a depth/structure benchmark only.

Exact next action: parent copies these destinations, runs guarded article/header integration, exports source parity, and performs its final content/browser gates before marking this topic complete.
