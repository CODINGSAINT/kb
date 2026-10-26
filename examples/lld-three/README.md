# Three complete LLD reference implementations

These original Java 21 examples accompany KB's **Chess**, **Parking Lot** and **Elevator System** answers. Read the answer for the requirements and trade-offs; use these files to inspect the complete implementation, including helpers omitted from article excerpts.

## Run without external Java dependencies

Download all four `.java` files into the same directory (or use this repository's `examples/lld-three/` folder). From the repository root:

```sh
mkdir -p .qa-lld
javac -d .qa-lld examples/lld-three/*.java
java -cp .qa-lld lldthree.ThreeChecks
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force .qa-lld | Out-Null
javac -d .qa-lld (Get-ChildItem examples/lld-three/*.java).FullName
java -cp .qa-lld lldthree.ThreeChecks
```

If you downloaded the files to a flat folder, use `javac -d .qa-lld *.java` from that folder instead. `package lldthree;` is intentional; the `-d` flag creates the package output directory. Assertions are explicit checks that run without `-ea`.

| File | What the working answer implements | Deliberate boundary |
| --- | --- | --- |
| [Chess.java](Chess.java) | Immutable positions; legal moves, check, castling, en passant, four promotions, mate/stalemate, resignation/agreed draw and exact undo with monotonic versions | No clocks, computer search, network authentication, repetition/dead-position/fifty- or seventy-five-move adjudicator. FEN import validates representation, not historical reachability. |
| [Parking.java](Parking.java) | Atomic multi-gate entry, compatible allocation, frozen entry tariff, approved-amount payment, external I/O outside the lock, uncertain-payment reconciliation, grace credit and ownership-checked exit | In-memory state; no restart durability or actual payment/barrier integration. Provider adapter must use stable idempotency keys and trustworthy final lookup results. |
| [Elevators.java](Elevators.java) | Hall/cabin separation, directional LOOK-style stops, known-plan pickup estimates, explicit door/load guards, request coalescing and versioned reassignment | A discrete floor-event simulator, not motor control or certified safety software. Finite-workload checks are not a fairness proof under ongoing arrivals. |
| [ThreeChecks.java](ThreeChecks.java) | Runnable examples, counterexamples, concurrency and recovery checks for the three implementations | No external services, secrets, real charges or hardware. |

The harness checks chess initial move-tree counts 20/400/8,902, special-move pitfalls and undo; a 24-contender last-spot race, payment uncertainty and grace arithmetic; and directional elevator traces, late acknowledgement rejection and 50 seeded finite workloads. It also checks movement guards on every observed elevator travel event.

## Article/source consistency

The Java files contain named `region` comments. Article Java excerpts bearing `// source: File.java#region` are exact copies of these regions. `node scripts/check-lld-three.js` checks that relationship, mirrored public downloads and illustration coverage. Changing a mechanism requires updating the explanation and the excerpt, not just making a separate example pass.

`node build/make-lld-three.js` deterministically generates the original SVG illustrations and mirrors this directory to `public/reference-code/lld-three/`. The examples are the canonical Java sources. The authored answers remain in `build/topics/*.txt`; `node build/assemble.js` generates the published content JSON.

Design comparisons were made against public Design Gurus, Educative previews/articles and AlgoMaster problem descriptions linked in the articles. Their implementations and diagrams were not copied. These examples make the chosen interview scope executable; they do not claim full production integrations.
