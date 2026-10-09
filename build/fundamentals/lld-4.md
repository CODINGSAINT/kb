=== lld-behavioral-1 | LLD | Behavioral patterns I: Strategy, State, Observer, Command ===
Behavioral patterns organise **how objects collaborate and distribute responsibility**. Strategy, State, Observer and Command appear in the majority of LLD problems: pricing and matching rules, lifecycle state machines, notifications, and undoable or queued operations. Recognising them from the requirement wording is a core interview skill.

## Strategy
**Intent:** define a family of interchangeable algorithms, encapsulate each one, and let the client choose at runtime.
**Recognise it when** the problem says "different ways to calculate / choose / match / split / rank".

```java
public interface PricingStrategy { Money price(Ticket ticket, Instant exitTime); }

public final class HourlyPricing implements PricingStrategy {
    private final Map<VehicleType, Money> hourlyRate;
    public HourlyPricing(Map<VehicleType, Money> rates) { this.hourlyRate = Map.copyOf(rates); }
    public Money price(Ticket t, Instant exit) {
        long hours = Math.max(1, (Duration.between(t.entryTime(), exit).toMinutes() + 59) / 60);   // round up
        return hourlyRate.get(t.vehicle().type()).times(hours);
    }
}
public final class FlatWeekendPricing implements PricingStrategy { /* … */ public Money price(Ticket t, Instant e) { return Money.rupees(100); } }

public final class ExitGate {
    private final PricingStrategy pricing;                    // composed and injected
    public ExitGate(PricingStrategy pricing) { this.pricing = pricing; }
    public Receipt checkout(Ticket t, Instant now) { return new Receipt(t, pricing.price(t, now)); }
}
```
Where Strategy shows up:
| Problem | Strategy interface |
|---|---|
| Parking lot | `SpotAssignmentStrategy`, `PricingStrategy` |
| Uber | `DriverMatchingStrategy` (nearest, highest rated, ETA-based) |
| Splitwise | `SplitStrategy` (equal, exact, percentage, shares) |
| Elevator | `SchedulingStrategy` (SCAN/LOOK, nearest car, zoning) |
| Rate limiter | `RateLimitAlgorithm` (token bucket, sliding window) |
| Cart | `DiscountRule` per promotion |

**Selecting the strategy:** pass it in through the constructor, choose it via a factory keyed by configuration, or compose several strategies (a chain of discount rules). With Java lambdas, a one-method strategy can be a lambda: `PricingStrategy free = (t, e) -> Money.ZERO;`.

## State
**Intent:** let an object change its behaviour when its internal state changes, as if it changed class.
**Recognise it when** the problem says "the machine/order/elevator can be in states X, Y, Z, and actions behave differently in each".

Without the pattern you get methods like this in every operation:
```java
void insertCoin(Coin c) {
    if (state == IDLE) { … } else if (state == HAS_MONEY) { … } else if (state == DISPENSING) { throw … } else if (state == MAINTENANCE) { throw … }
}
```
With the pattern, each state is a class that handles every event and decides the transition:
```java
interface VendingState {
    default void insertCoin(VendingMachine m, Coin c) { throw new IllegalStateException("Can't insert coins now"); }
    default void select(VendingMachine m, String code) { throw new IllegalStateException("Can't select now"); }
    default void cancel(VendingMachine m) { throw new IllegalStateException("Nothing to cancel"); }
}
final class Idle implements VendingState {
    public void insertCoin(VendingMachine m, Coin c) { m.addCredit(c); m.setState(new HasCredit()); }
}
final class HasCredit implements VendingState {
    public void insertCoin(VendingMachine m, Coin c) { m.addCredit(c); }
    public void select(VendingMachine m, String code) {
        Product p = m.inventory().get(code);
        if (p == null || !m.inventory().inStock(code)) throw new IllegalArgumentException("Unavailable");
        if (m.credit().lessThan(p.price())) throw new IllegalStateException("Insert more money");
        m.setState(new Dispensing(p));
        m.state().dispense(m);
    }
    public void cancel(VendingMachine m) { m.refundAll(); m.setState(new Idle()); }
}
```
Interface `default` methods throwing for illegal actions give a clean "everything is invalid unless overridden" baseline.

**State vs Strategy:** they look the same structurally. In **State**, the context transitions *itself* between states as events happen, and states know about each other. In **Strategy**, the *client* picks an algorithm, and strategies are independent.

**Lightweight alternative:** an `enum` with a transition table is enough when per-state behaviour is trivial (an order lifecycle that only validates transitions):
```java
enum OrderStatus {
    CREATED, PAID, PACKED, SHIPPED, DELIVERED, CANCELLED, RETURNED;
    private static final Map<OrderStatus, Set<OrderStatus>> NEXT = Map.of(
        CREATED, EnumSet.of(PAID, CANCELLED), PAID, EnumSet.of(PACKED, CANCELLED),
        PACKED, EnumSet.of(SHIPPED, CANCELLED), SHIPPED, EnumSet.of(DELIVERED),
        DELIVERED, EnumSet.of(RETURNED), CANCELLED, EnumSet.noneOf(OrderStatus.class), RETURNED, EnumSet.noneOf(OrderStatus.class));
    boolean canMoveTo(OrderStatus next) { return NEXT.get(this).contains(next); }
}
```
Use the full State pattern when states have **rich, different behaviour** (vending machine, ATM, elevator, a turn-based game phase).

## Observer
**Intent:** define a one-to-many dependency so that when one object changes, its dependents are notified automatically.
**Recognise it when** the problem says "notify when…", "subscribers", "display board updates", "alert users".

```java
public interface BookAvailabilityListener { void onAvailable(Book book); }

public final class Book {
    private final List<BookAvailabilityListener> waiting = new CopyOnWriteArrayList<>();
    public void subscribe(BookAvailabilityListener l) { waiting.add(l); }
    public void unsubscribe(BookAvailabilityListener l) { waiting.remove(l); }
    void copyReturned() { for (BookAvailabilityListener l : waiting) safely(() -> l.onAvailable(this)); }
    private static void safely(Runnable r) { try { r.run(); } catch (RuntimeException e) { /* log, keep notifying others */ } }
}
```
Design decisions to state explicitly:
- **Push vs pull:** send the changed data in the event (push), or just a signal so observers query what they need (pull).
- **Synchronous vs asynchronous:** synchronous listeners slow the subject down and their exceptions propagate. Isolate them, or dispatch on an executor.
- **When to notify:** after the state change is committed, never halfway through.
- **Lifecycle:** unsubscribe to avoid memory leaks. Weak references are an option, but explicit unsubscribe is clearer.
- **Ordering:** don't rely on listener order unless you guarantee it.

Inside one process this is Observer (or Spring's `ApplicationEventPublisher`). Across services it becomes **publish/subscribe over a message broker** (Kafka, SNS), with durability and retries; see the HLD messaging chapter.

## Command
**Intent:** encapsulate a request as an object, so you can queue it, log it, retry it, schedule it or undo it.
**Recognise it when** the problem says "undo/redo", "queue of requests", "replay", "macro", "audit every action".

```java
interface Command { void execute(); void undo(); String describe(); }

final class PlaceMark implements Command {
    private final Board board; private final int row, col; private final Symbol symbol;
    PlaceMark(Board b, int r, int c, Symbol s) { board = b; row = r; col = c; symbol = s; }
    public void execute() { board.place(row, col, symbol); }
    public void undo() { board.clear(row, col); }
    public String describe() { return symbol + " at (" + row + "," + col + ")"; }
}

final class CommandHistory {
    private final Deque<Command> undo = new ArrayDeque<>(), redo = new ArrayDeque<>();
    void run(Command c) { c.execute(); undo.push(c); redo.clear(); }
    void undo() { if (!undo.isEmpty()) { Command c = undo.pop(); c.undo(); redo.push(c); } }
    void redo() { if (!redo.isEmpty()) { Command c = redo.pop(); c.execute(); undo.push(c); } }
}
```
Where Command fits:
- **Elevator:** floor requests are commands queued for the scheduler.
- **Text editor / drawing app:** undo/redo stacks.
- **Job scheduler:** jobs are commands with retry metadata.
- **Smart home / remote control:** buttons bound to commands; macros are composite commands.
- **Audit log:** persisting commands gives a record of who did what (and enables event-sourcing ideas).

## Combining them
Real designs combine patterns. An elevator system might use:
- **Command** for requests (`FloorRequest(floor, direction)`).
- **Strategy** for which car serves a request.
- **State** for each car (`Idle`, `MovingUp`, `MovingDown`, `DoorsOpen`, `Maintenance`).
- **Observer** so floor displays update when a car moves.

## Spotting patterns from requirement phrases
| Phrase | Pattern |
|---|---|
| "support multiple ways to …", "configurable algorithm" | Strategy |
| "can be in states …", "behaves differently when …" | State |
| "notify / alert / update display when …" | Observer |
| "undo", "redo", "queue requests", "replay", "log every operation" | Command |

## Interview questions
1. **State vs Strategy?** State: the object transitions itself on events. Strategy: the client picks an algorithm. Same structure, different intent.
2. **How do you prevent one slow observer from blocking others?** Isolate failures, dispatch asynchronously (bounded executor), or move to a message queue.
3. **How would you implement undo for "move piece" in chess?** A Command storing the move, plus the captured piece and any flags (castling rights) needed to restore state. Undo is the inverse.
4. **When is an enum enough instead of the State pattern?** When states only constrain transitions and don't change behaviour much.

## Pitfalls
- Strategy classes that need to know who's calling them (leaky context). Pass what they need as parameters.
- State classes mutating unrelated parts of the context.
- Observers notified before the transaction commits (they see state that's later rolled back).
- Commands without enough captured state to undo correctly.

## Cheat sheet
```
Strategy  interchangeable algorithms behind one interface; injected/selected
State     object's behaviour depends on its state; states handle events and transition
Observer  subject notifies subscribers; decide push/pull, sync/async, failure isolation
Command   request as object → queue, retry, log, undo/redo
Combine   elevator = Command + Strategy + State + Observer
```

=== lld-behavioral-2 | LLD | Behavioral patterns II: Chain of Responsibility, Template Method, Iterator, Mediator, Memento, Visitor ===
These patterns appear less often than Strategy or State, but when the problem has the right shape they're the cleanest answer: request pipelines, fixed algorithms with variable steps, custom traversal, many-to-many coordination, snapshots, and operations over closed hierarchies.

## Chain of Responsibility
**Intent:** pass a request along a chain of handlers; each one handles it, passes it on, or does both.
**Recognise it when:** validation pipelines, approval workflows by amount, ATM note dispensing, filters and middleware, support-ticket escalation.

```java
abstract class CashDispenser {
    private CashDispenser next;
    private final int denomination;
    protected CashDispenser(int denomination) { this.denomination = denomination; }
    public CashDispenser then(CashDispenser next) { this.next = next; return next; }

    public void dispense(int amount, Map<Integer, Integer> out, Map<Integer, Integer> available) {
        int notes = Math.min(amount / denomination, available.getOrDefault(denomination, 0));
        if (notes > 0) out.put(denomination, notes);
        int remaining = amount - notes * denomination;
        if (remaining == 0) return;
        if (next == null) throw new IllegalStateException("Cannot dispense remaining ₹" + remaining);
        next.dispense(remaining, out, available);
    }
}
final class Note2000 extends CashDispenser { Note2000() { super(2000); } }
final class Note500 extends CashDispenser { Note500() { super(500); } }
final class Note100 extends CashDispenser { Note100() { super(100); } }

CashDispenser chain = new Note2000();
chain.then(new Note500()).then(new Note100());
```
Two variants:
- **Pure chain:** exactly one handler processes the request (approvals: manager up to ₹10k, director up to ₹1L, CFO above).
- **Pipeline:** every handler does its part (servlet filters, Spring Security's filter chain, a validation pipeline that collects all errors).

Watch for requests falling off the end unhandled (add a terminal handler or an explicit failure), for order dependence (make the chain order configuration, not accident), and for a gotcha in the ATM example: a greedy chain can fail when fewer large notes are available. Check feasibility first, then commit.

## Template Method
**Intent:** define an algorithm's skeleton in a base class and let subclasses fill in specific steps, without changing the overall structure.
**Recognise it when** several variants follow the same steps in the same order but differ in details: games with the same turn loop, report export pipelines, data imports.

```java
public abstract class BoardGame {
    public final void play() {                       // final: the skeleton can't be overridden
        setup();
        while (!isOver()) { Player p = nextPlayer(); takeTurn(p); }
        announceResult();
    }
    protected abstract void setup();
    protected abstract boolean isOver();
    protected abstract Player nextPlayer();
    protected abstract void takeTurn(Player p);
    protected void announceResult() { System.out.println("Game over"); }   // hook with a default
}
```
- **Hooks** are optional steps with default implementations that subclasses may override.
- It relies on inheritance, which brings coupling. If the steps vary **independently** (setup varies separately from turn logic), inject Strategies for each step instead.
- Frameworks use it everywhere: `AbstractList`, Spring's `JdbcTemplate` (with callbacks, a functional variant of the idea).

## Iterator
**Intent:** access the elements of an aggregate sequentially without exposing its internal representation.
Java has `Iterator`/`Iterable`, enhanced for-loops and streams. Custom iterators appear in LLD as:
- A BST iterator (in-order traversal with a stack).
- A paginated API client that fetches the next page lazily.
- A playlist with shuffle or repeat modes.
- A merged iterator over k sorted sources (a heap of iterators).

```java
final class PagedIterator<T> implements Iterator<T> {
    private final Function<String, Page<T>> fetch; private Iterator<T> current = Collections.emptyIterator(); private String nextToken = ""; private boolean done;
    PagedIterator(Function<String, Page<T>> fetch) { this.fetch = fetch; }
    public boolean hasNext() {
        while (!current.hasNext() && !done) {
            Page<T> p = fetch.apply(nextToken);
            current = p.items().iterator(); nextToken = p.nextToken(); done = nextToken == null;
        }
        return current.hasNext();
    }
    public T next() { if (!hasNext()) throw new NoSuchElementException(); return current.next(); }
}
```
Follow-ups: "make it skip deleted items" (a filter iterator), "make it thread-safe" (don't share iterators; snapshot instead), "what if the collection changes mid-iteration?" (fail-fast `ConcurrentModificationException` vs weakly consistent iterators in `ConcurrentHashMap`).

## Mediator
**Intent:** define an object that encapsulates how a set of objects interact, so they don't refer to each other directly.
**Recognise it when** many components need to coordinate and direct references would form a tangled mesh: an air-traffic controller, chat rooms, UI dialogs where widgets enable each other, an **elevator dispatcher** assigning requests to cars, an auction house.

```java
interface ElevatorDispatcher { void request(int floor, Direction dir); void carArrived(ElevatorCar car, int floor); }
final class SmartDispatcher implements ElevatorDispatcher {
    private final List<ElevatorCar> cars; private final SchedulingStrategy strategy;
    SmartDispatcher(List<ElevatorCar> cars, SchedulingStrategy s) { this.cars = cars; this.strategy = s; }
    public void request(int floor, Direction dir) { strategy.choose(cars, floor, dir).addStop(floor); }
    public void carArrived(ElevatorCar car, int floor) { /* update displays, clear hall calls */ }
}
```
Cars and floor buttons talk only to the dispatcher. Many-to-many coupling becomes many-to-one. The risk is that the mediator grows into a god object, so keep algorithms in strategies.

## Memento
**Intent:** capture an object's internal state so it can be restored later, without exposing that state.
**Recognise it when:** undo via snapshots, game save points, form drafts, transaction rollback inside a domain object.
```java
final class Editor {
    private String text = ""; private int cursor;
    public Snapshot save() { return new Snapshot(text, cursor); }
    public void restore(Snapshot s) { this.text = s.text(); this.cursor = s.cursor(); }
    public record Snapshot(String text, int cursor) {}   // immutable, opaque to callers
}
```
**Command vs Memento for undo:** Command stores the *operation* and knows its inverse (cheap, but each command must implement `undo`). Memento stores *state* (simple, but memory-heavy for large objects). Editors often combine them: commands for most edits, snapshots at checkpoints.

## Visitor
**Intent:** add new operations to a stable class hierarchy without modifying those classes, via double dispatch.
**Recognise it when** the set of element types is closed but you keep adding operations: computing area, perimeter and SVG export over shapes; evaluating, pretty-printing and type-checking an expression tree; pricing, tax and shipping calculations over cart item types.

```java
sealed interface Shape permits Circle, Rect {}
record Circle(double r) implements Shape {}
record Rect(double w, double h) implements Shape {}

// Modern Java alternative to classic Visitor: exhaustive pattern matching
static double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Rect r -> r.w() * r.h();
    };
}
```
The classic Visitor uses `accept(Visitor v)` in each element and `visit(Circle)`/`visit(Rect)` overloads. With **sealed types and pattern-matching `switch`** (Java 21) you get the same "operations outside the hierarchy" benefit, with the compiler checking exhaustiveness. Mention both; it signals modern Java fluency.
**Trade-off:** easy to add operations, hard to add element types (every visitor or switch must change). Polymorphism has the opposite trade-off.

## Interpreter (recognise it)
Represent a small grammar as classes and evaluate sentences: rule engines ("discount if cartTotal > 1500 AND category == 'books'"), search filter expressions, feature-flag targeting rules. It's usually combined with Composite (an expression tree).

## Choosing among them
| Problem shape | Pattern |
|---|---|
| Sequence of handlers, each may act or pass on | Chain of Responsibility |
| Same algorithm skeleton, variable steps | Template Method (or Strategy per step) |
| Traverse a custom structure lazily | Iterator |
| Many objects coordinating through rules | Mediator |
| Snapshot and restore state | Memento |
| New operations over a closed set of types | Visitor / sealed + switch |
| Small rule language | Interpreter + Composite |

## Interview questions
1. **How would you implement multi-level purchase approval?** Chain of Responsibility with an approver per level, each with a limit, and a terminal handler that rejects or escalates. The chain is configured from data.
2. **Template Method or Strategy?** Template Method when steps are tied together and variants are few and stable. Strategy when steps vary independently or must be swapped at runtime.
3. **How do you undo in a text editor with large documents?** Command objects for operations (store diffs, not whole documents), occasional Memento snapshots, and bounded history.
4. **Why might you avoid Visitor?** Adding a new element type forces changes to every visitor, and double dispatch is harder to read. Sealed types with pattern matching are simpler in modern Java.

## Cheat sheet
```
Chain of Responsibility  pipeline/escalation; define terminal behaviour; order is config
Template Method          final skeleton + abstract steps + hooks (inheritance)
Iterator                 lazy traversal; paging; merged/filtering iterators
Mediator                 central coordinator replaces mesh of references
Memento                  opaque snapshot for undo/save points
Visitor                  ops over closed hierarchy; sealed + switch is the modern form
```
