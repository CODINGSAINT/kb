=== lld-approach | LLD | How to approach an LLD interview ===
A low-level design (LLD) round checks whether you can turn a fuzzy product idea into a clean, extensible, correct set of classes in about 45 minutes, while thinking aloud like a senior engineer. This chapter gives you a repeatable process, the scoring rubric behind it, and a fully worked example.

## What the interviewer is really evaluating
LLD rounds (also called machine coding, object-oriented design or OOD rounds) are not about memorising patterns. Interviewers typically score five things:

| Dimension | What "strong" looks like |
|---|---|
| **Requirement handling** | You clarify scope, write requirements down, and push back on ambiguity instead of guessing silently. |
| **Object modelling** | Classes map to real concepts, each has one clear responsibility, and relationships (has-a vs is-a) are right. |
| **Extensibility** | New variants (vehicle type, payment method, pricing rule) are added by writing a new class, not by editing existing `if/else` chains. |
| **Correctness** | Edge cases and concurrency are handled: the last seat, a double click, an expired hold. |
| **Communication** | You explain trade-offs, take hints gracefully and keep the interviewer oriented. |

Code quality matters too (naming, small methods, immutability), especially in "machine coding" rounds where you must produce runnable code within 60–90 minutes.

## The 45-minute process
### 1. Clarify scope (≈5 minutes)
Ask questions that change the design, not trivia. For a parking lot:
- Single building or multiple? Multiple floors? Different spot sizes?
- Which vehicles: bikes, cars, trucks, EVs needing chargers?
- How are fees computed: hourly, flat, different rates per vehicle?
- Payment at exit only, or prepaid? Which payment methods?
- Is there a display board showing free spots? Entry/exit gates?
Then **write down what's in and out**: "In: multi-floor, 3 spot sizes, hourly pricing, cash/card. Out: reservations, monthly passes."

### 2. Requirements (≈5 minutes)
Split them explicitly:
- **Functional:** what actors do (park, unpark, pay, view availability).
- **Non-functional:** concurrency (two cars must not get the same spot), extensibility (new vehicle types), testability (pricing testable without real time), performance of the hot path (finding a spot shouldn't scan 10,000 spots linearly).

### 3. Identify entities and actors (≈5 minutes)
Read your requirements and underline nouns: *ParkingLot, Floor, Spot, Vehicle, Ticket, Gate, Payment, DisplayBoard*. Then:
- Drop nouns that are just attributes (licence plate is a field of `Vehicle`).
- Merge synonyms (Slot = Spot).
- Identify **actors** (Customer, Attendant, Admin) and the **use cases** each one triggers.

### 4. Relationships and class diagram (≈10 minutes)
For every pair of related classes, decide:
- **Ownership:** does the whole create and destroy the part (composition), or just reference it (association/aggregation)?
- **Multiplicity:** one-to-one, one-to-many.
- **Variation points:** where behaviour differs by type (spot assignment, pricing, payment). These become interfaces.

```
ParkingLot ◆── 1..* Floor ◆── 1..* Spot
Spot ──0..1 Vehicle            (currently parked vehicle)
Ticket ── 1 Vehicle, 1 Spot, entryTime, exitTime
<<interface>> SpotAssignmentStrategy  ◁─ NearestFirst, FillLowestFloor
<<interface>> PricingStrategy         ◁─ HourlyPricing, FlatPricing
<<interface>> PaymentProcessor        ◁─ CashProcessor, CardProcessor, UpiProcessor
```

### 5. APIs and main flows (≈10 minutes)
Write the public methods that matter and walk through one flow end to end:
```java
public interface ParkingService {
    Ticket park(Vehicle vehicle);                 // throws NoSpotAvailableException
    Receipt unpark(String ticketId, PaymentMethod method);
    Map<SpotSize, Integer> availability();
}
```
Walk it: *entry gate → `park(car)` → strategy picks a free MEDIUM spot → spot is atomically marked occupied → ticket created with `clock.instant()` → display board updated.*

### 6. Patterns, concurrency, extensibility (≈10 minutes)
- Name patterns **only when they solve a stated requirement**: "Pricing varies by vehicle and time, so I'm using Strategy."
- Find the race: "two entry gates may choose the same free spot". Explain the fix: per-size free-spot queues with atomic poll, or a lock per floor.
- Show how to extend: "EV spots: add `SpotType.EV` and a `ChargingSpot` subclass, and the assignment strategy filters on capability."

### 7. Wrap-up (≈2 minutes)
Summarise the design in three sentences, list what you'd add with more time (persistence, monthly passes), and note trade-offs you made.

## Working from behaviour, not data
Beginners start with fields ("Spot has id, size, isFree"). Strong candidates start with **behaviour and invariants**:
- *A spot can be assigned only if free; once assigned it must be released exactly once.*
- *A ticket's fee is computed once at exit and can't change afterwards.*
Invariants tell you which class should **own** which rule. The class that enforces the invariant is the one that holds the data. That's encapsulation done right.

## A worked mini-example: Tic-Tac-Toe in 10 minutes
**Requirements:** N×N board, two players, alternate turns, detect win or draw, reject invalid moves.
**Entities:** `Game`, `Board`, `Player`, `Move`, `Symbol` (enum).
**Responsibilities:**
- `Board` knows cells and can tell whether a move is valid and whether the last move won.
- `Game` enforces turn order and game state (IN_PROGRESS, WON, DRAW).
- `Player` decides moves (human input or AI strategy), behind an interface for extensibility.

```java
enum Symbol { X, O }
interface Player { Symbol symbol(); Move nextMove(Board board); }

final class Board {
    private final int n; private final Symbol[][] cells;
    private final int[] rows, cols; private int diag, anti, filled;
    Board(int n) { this.n = n; cells = new Symbol[n][n]; rows = new int[n]; cols = new int[n]; }
    boolean place(int r, int c, Symbol s) {            // returns true if this move wins
        if (r < 0 || c < 0 || r >= n || c >= n || cells[r][c] != null) throw new IllegalArgumentException("invalid move");
        cells[r][c] = s; filled++;
        int d = s == Symbol.X ? 1 : -1;                  // +1 for X, -1 for O
        rows[r] += d; cols[c] += d;
        if (r == c) diag += d;
        if (r + c == n - 1) anti += d;
        return Math.abs(rows[r]) == n || Math.abs(cols[c]) == n || Math.abs(diag) == n || Math.abs(anti) == n;
    }
    boolean full() { return filled == n * n; }
}
```
The win check is **O(1) per move**, which is exactly the kind of detail that turns a "Solid" into a "Strong".

## Habits that earn points
- **Interfaces at variation points only.** `PricingStrategy` is an interface because pricing varies; `Ticket` is a concrete class because it doesn't.
- **Enums for closed sets** (`SpotSize`, `OrderStatus`), polymorphism for open sets (`PaymentProcessor`).
- **Inject time and randomness** (`Clock`, a `Random` or dice abstraction) so logic is testable.
- **Keep I/O at the edges.** The domain model doesn't print to the console or read input.
- **Fail fast with meaningful exceptions** (`SpotUnavailableException`), and validate in constructors so invalid objects can't exist.
- **Name things after domain concepts** (`Reservation`, `Hold`), not technical roles (`DataManager`).

## Red flags interviewers note
| Red flag | Better |
|---|---|
| A `ParkingLotManager` god class with 30 methods | Split responsibilities: assignment, pricing, payment, ticketing |
| `if (vehicle instanceof Car) … else if …` chains | Polymorphism or a strategy map keyed by type |
| Inheritance for reuse (`Ticket extends Spot`) | Composition: `Ticket` *has* a `Spot` |
| Singleton for the lot, the DB and everything else | One instance managed by the application, injected where needed |
| No mention of concurrency in booking-style problems | Identify the critical section and pick a locking strategy |
| Jumping into code before agreeing requirements | Five minutes of scoping saves twenty minutes of rework |

## Machine-coding variant (60–120 minutes, runnable code)
Some companies ask for working code. Additional advice:
- Start with a **walking skeleton**: entities, a service, and a `main` or tests showing one flow end to end.
- Use **in-memory repositories** behind interfaces (`TicketRepository`), so storage could be swapped.
- Write a few **unit tests** for the trickiest rule (pricing, win detection).
- Keep packages simple: `model`, `service`, `strategy`, `repository`, `exception`.
- Leave 10 minutes to refactor names and remove dead code. Readability is scored.

## Common interview questions about your process
**"How would you add X?"** Point to the extension point: "a new class implementing `PricingStrategy`, registered in the factory. Nothing else changes."
**"What happens if two users do Y at the same time?"** Name the shared state, the race, and the guard (lock scope, atomic operation, optimistic version check).
**"How would you test this?"** Inject a fixed `Clock`, mock the payment processor, and test pricing and assignment in isolation.
**"What would change for a distributed system?"** In-memory locks become database row locks or a distributed lock, IDs come from a generator, and events go through a queue. Hand-wave to HLD briefly.

## Cheat sheet
```
1  Clarify → write in/out of scope
2  Functional + non-functional requirements
3  Nouns → entities; verbs → methods; actors → use cases
4  Class diagram: ownership, multiplicity, interfaces at variation points
5  Public APIs + one end-to-end flow
6  Patterns that solve stated needs; concurrency; extensibility story
7  Summarise, list trade-offs and next steps
```

=== lld-oop | LLD | OOP in Java: pillars, composition and interfaces ===
Object-oriented programming is the language of LLD interviews. Everyone can recite "encapsulation, abstraction, inheritance, polymorphism". What separates a strong candidate is knowing *when* to use each tool, the costs of each, and how modern Java (records, sealed types, pattern matching) changes the answers.

## Encapsulation: protect invariants
Encapsulation is not "make fields private and add getters and setters". It means **an object owns its state and enforces its own rules**. Callers ask the object to *do* things; they don't reach in and change its data.

```java
// Weak: anyone can break the invariant "balance never negative"
class Account { public long balance; }

// Weak too: setters are public fields with extra steps
class Account2 { private long balance; public void setBalance(long b) { this.balance = b; } }

// Strong: behaviour-oriented, invariant enforced in one place
public final class Account3 {
    private long balancePaise;
    public void deposit(long amount) { requirePositive(amount); balancePaise += amount; }
    public void withdraw(long amount) {
        requirePositive(amount);
        if (amount > balancePaise) throw new InsufficientFundsException(balancePaise, amount);
        balancePaise -= amount;
    }
    public long balance() { return balancePaise; }
    private static void requirePositive(long a) { if (a <= 0) throw new IllegalArgumentException("amount must be > 0"); }
}
```
Guidelines:
- Expose **operations** named after domain actions (`withdraw`, `reserve`, `cancel`), not setters.
- Return **defensive copies** or unmodifiable views of internal collections (`List.copyOf(items)`).
- Make classes `final` and fields `final` unless there's a reason not to; immutability is the strongest encapsulation.
- "Tell, don't ask": instead of `if (order.getStatus() == PAID) order.setStatus(SHIPPED)`, call `order.ship()` and let `Order` validate the transition.

## Abstraction: depend on what, not how
Abstraction hides implementation details behind a stable contract. It exists at several levels:
- **Method level:** `ticket.close(clock)` hides how duration and fee are computed.
- **Type level:** callers depend on `PaymentProcessor`, not `RazorpayClient`.
- **Module level:** the booking module exposes `BookingService`; its repositories and helpers stay package-private.

Good abstractions are **small and stable**. If an interface changes every time a new implementation arrives, it's leaking details (for example, `charge(amount, cardNumber, upiId, walletId)`). Prefer `charge(PaymentRequest)` where `PaymentRequest` is a sealed type per method, or let each processor accept its own details.

## Inheritance: powerful, and expensive
Inheritance creates an **is-a** relationship and reuses implementation. Its costs:
- **Tight coupling:** subclasses depend on the parent's internals (the fragile base class problem). A change in the parent can silently break children.
- **Rigid hierarchies:** behaviour combinations explode (`ElectricSportsCar`, `ElectricFamilyCar`, `PetrolSportsCar`…).
- **Liskov violations:** a subclass that can't fully honour the parent's contract (a `Penguin extends Bird` whose `fly()` throws).

Use inheritance when:
1. There's a genuine is-a relationship that holds for the whole contract.
2. Subclasses share state and a common algorithm skeleton (Template Method).
3. The hierarchy is shallow (two levels is plenty in an interview).

```java
abstract class Piece {
    protected final Color color;
    protected Piece(Color color) { this.color = color; }
    public abstract boolean canMove(Board board, Square from, Square to);
    public final boolean isEnemy(Piece other) { return other != null && other.color != color; }
}
final class Rook extends Piece {
    Rook(Color c) { super(c); }
    @Override public boolean canMove(Board b, Square f, Square t) {
        return (f.row() == t.row() || f.col() == t.col()) && b.isPathClear(f, t) && !sameColorAt(b, t);
    }
    private boolean sameColorAt(Board b, Square t) { Piece p = b.pieceAt(t); return p != null && p.color == color; }
}
```

## Polymorphism: replace conditionals
Polymorphism lets one call site behave differently based on the runtime type. This is the main tool for **removing `switch`/`instanceof` chains**, which violate the open/closed principle.

```java
// Before: every new vehicle type edits this method
long fee(Vehicle v, Duration d) {
    if (v instanceof Bike) return 10 * hours(d);
    else if (v instanceof Car) return 20 * hours(d);
    else if (v instanceof Truck) return 50 * hours(d);
    throw new IllegalStateException();
}
// After: each type (or a pricing strategy per type) knows its rate
interface Vehicle { long hourlyRatePaise(); }
long fee(Vehicle v, Duration d) { return v.hourlyRatePaise() * hours(d); }
```
- **Runtime (subtype) polymorphism** = overriding, chosen by the object's class at runtime. This is what interviews mean.
- **Compile-time polymorphism** = overloading (same name, different parameters), resolved by the compiler.
- **Parametric polymorphism** = generics (`Repository<T, ID>`), useful for repositories and caches in LLD code.

## Composition over inheritance
Composition models **has-a**: an object delegates part of its behaviour to another object it holds. It's more flexible because behaviour can be chosen and swapped at runtime and combined freely.

```java
interface FlyBehavior { void fly(); }
final class Duck {
    private FlyBehavior flyBehavior;                 // composed, swappable
    Duck(FlyBehavior f) { this.flyBehavior = f; }
    void performFly() { flyBehavior.fly(); }
    void setFlyBehavior(FlyBehavior f) { this.flyBehavior = f; }
}
```
A practical rule: **inherit interfaces, compose implementations.** In LLD answers, strategies (pricing, matching, payment) are almost always composed into the class that uses them.

| Question | Inheritance | Composition |
|---|---|---|
| Relationship | is-a | has-a / uses-a |
| Binding | compile time | runtime (swappable) |
| Coupling | high (sees internals) | low (talks through an interface) |
| Combining behaviours | class explosion | mix and match objects |
| Testing | harder (must construct the hierarchy) | easy (inject fakes) |

## Interfaces vs abstract classes
| | Interface | Abstract class |
|---|---|---|
| State (instance fields) | No (constants only) | Yes |
| Constructors | No | Yes |
| Multiple inheritance | A class can implement many | Only one superclass |
| Methods | abstract, `default`, `static`, `private` | any |
| Typical use | Capabilities and roles: `Payable`, `Comparable`, `PricingStrategy` | Shared skeleton plus state: `Piece`, `AbstractNotifier` |

`default` methods let interfaces evolve without breaking implementers. Use them for convenience behaviour, not to sneak in state-dependent logic.

## Modern Java features that sharpen designs
- **Records** for immutable data carriers and value objects:
  `record Money(long minor, Currency currency) { Money { if (minor < 0) throw new IllegalArgumentException(); } }`
- **Sealed hierarchies** make a closed set of variants explicit and let the compiler check exhaustiveness:
```java
sealed interface PaymentMethod permits Card, Upi, Wallet {}
record Card(String token) implements PaymentMethod {}
record Upi(String vpa) implements PaymentMethod {}
record Wallet(String walletId) implements PaymentMethod {}

String describe(PaymentMethod m) {
    return switch (m) {                                   // exhaustive: no default needed
        case Card c -> "card " + c.token();
        case Upi u -> "UPI " + u.vpa();
        case Wallet w -> "wallet " + w.walletId();
    };
}
```
- **Enums with behaviour** for small state machines and strategies with a fixed set of options.
- **`Optional`** for "might be absent" return values (not for fields or parameters).

Sealed types plus pattern matching are an alternative to the Visitor pattern and to some polymorphism. Mention them when variants are closed and operations are many.

## Cohesion and coupling
Two metrics summarise good OOP:
- **High cohesion:** everything in a class serves one purpose. If you can't name the class without "And" or "Manager", it's doing too much.
- **Low coupling:** classes know as little about each other as possible. Depend on interfaces, pass only what's needed, and follow the Law of Demeter ("talk to friends, not strangers": avoid `a.getB().getC().doX()`).

## Interview questions you should be able to answer
1. **Why is composition preferred over inheritance?** Flexibility at runtime, lower coupling, no fragile base class, easier testing. Inheritance is still right for genuine is-a with shared skeletons.
2. **When would you choose an abstract class over an interface?** When implementations share state or a fixed algorithm skeleton and you control the hierarchy.
3. **How does polymorphism help with the open/closed principle?** New behaviour arrives as new subtypes; call sites don't change.
4. **Is a class with only getters and setters encapsulated?** Technically, but not meaningfully. It has no behaviour protecting its invariants (an "anemic" model).
5. **What's the difference between overloading and overriding?** Overloading: same name, different parameters, chosen at compile time. Overriding: same signature in a subclass, chosen at runtime.

## Pitfalls
- Deep hierarchies created "for reuse" that nobody can change safely.
- Public mutable collections returned from getters.
- `equals` overridden without `hashCode` (breaks `HashMap`/`HashSet`). Records do both correctly.
- Calling overridable methods from constructors (the subclass isn't initialised yet).

## Cheat sheet
```
Encapsulation  → behaviour methods protect invariants; final + immutable by default
Abstraction    → small, stable interfaces at variation points
Inheritance    → only for true is-a; shallow; template method
Polymorphism   → replaces if/switch on type
Composition    → has-a; inject strategies; swap at runtime
Modern Java    → records (values), sealed + switch (closed variants), enums (small state machines)
```
