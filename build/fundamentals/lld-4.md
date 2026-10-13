=== lld-behavioral-1 | LLD | Behavioral patterns I: Strategy, State, Observer, Command ===
Behavioral patterns are about how objects share work and talk to each other. Strategy, State, Observer and Command show up in almost every LLD interview problem, from parking lot pricing to elevator control to undo in a game. If you can spot them from the wording of the requirements, half the design is already done.

## 1. Strategy

**Intent:** Put each version of an algorithm in its own class behind a common interface, so the caller can pick one at runtime.

Look for phrases like "different ways to calculate", "multiple pricing models" or "the matching rule should be configurable". Each way becomes one small class, and the code that uses it does not care which one it got.

### The problem

```java
class ParkingFeeCalculator {
    public double calculate(String model, long minutes) {
        long hours = Math.max(1, (minutes + 59) / 60);   // round up
        if (model.equals("HOURLY")) {
            return hours * 40;
        } else if (model.equals("FLAT_WEEKEND")) {
            return 100;
        } else if (model.equals("FIRST_HOUR_FREE")) {
            return Math.max(0, hours - 1) * 40;
        }
        throw new IllegalArgumentException("Unknown model " + model);
    }
}
```

Every new pricing rule means editing this class and retesting all the old branches. The branches also tend to grow their own special cases until nobody wants to touch the method.

### Better design: Strategy

```java
interface PricingStrategy {
    double price(long minutes);
}

class HourlyPricing implements PricingStrategy {
    private final double ratePerHour;
    HourlyPricing(double ratePerHour) { this.ratePerHour = ratePerHour; }

    public double price(long minutes) {
        long hours = Math.max(1, (minutes + 59) / 60);
        return hours * ratePerHour;
    }
}

class FlatWeekendPricing implements PricingStrategy {
    public double price(long minutes) { return 100; }
}

class ExitGate {
    private final PricingStrategy pricing;
    ExitGate(PricingStrategy pricing) { this.pricing = pricing; }

    double checkout(long minutes) { return pricing.price(minutes); }
}
```

Adding a "first hour free" rule is now a new class, not an edit to working code. Each strategy is also trivially easy to unit test on its own.

You can choose the strategy through the constructor, through a small factory keyed by configuration, or even with a lambda for one-line rules: `PricingStrategy free = minutes -> 0;`.

**When to use:** You have two or more interchangeable ways to do the same job, and the choice depends on configuration, the user, or the situation.

**Key takeaway:** Strategy replaces "if model is X, else if model is Y" with "call whatever algorithm I was given".

---

## 2. State

**Intent:** Let an object change its behaviour when its internal state changes, as if it switched to a different class.

Look for phrases like "the machine can be idle, waiting for money, or dispensing" and "this action is only allowed when...". Each state becomes a class that knows which actions are legal and which state comes next.

### The problem

```java
class VendingMachine {
    private String state = "IDLE";
    private int credit;

    void insertCoin(int amount) {
        if (state.equals("IDLE")) {
            credit += amount;
            state = "HAS_CREDIT";
        } else if (state.equals("HAS_CREDIT")) {
            credit += amount;
        } else if (state.equals("DISPENSING")) {
            throw new IllegalStateException("Please wait");
        }
    }

    void selectProduct(String code) {
        if (state.equals("IDLE")) { /* error */ }
        else if (state.equals("HAS_CREDIT")) { /* check price, dispense */ }
        else if (state.equals("DISPENSING")) { /* error */ }
    }
}
```

The same `if/else` on `state` is repeated in every method. Adding a "MAINTENANCE" state means hunting through every method, and it is easy to miss one.

### Better design: State

```java
interface VendingState {
    default void insertCoin(VendingMachine m, int amount) {
        throw new IllegalStateException("Cannot insert coins now");
    }
    default void select(VendingMachine m, String code) {
        throw new IllegalStateException("Cannot select now");
    }
}

class Idle implements VendingState {
    public void insertCoin(VendingMachine m, int amount) {
        m.addCredit(amount);
        m.setState(new HasCredit());
    }
}

class HasCredit implements VendingState {
    public void insertCoin(VendingMachine m, int amount) { m.addCredit(amount); }

    public void select(VendingMachine m, String code) {
        Product p = m.findProduct(code);
        if (m.credit() < p.price()) throw new IllegalStateException("Insert more money");
        m.dispense(p);
        m.returnChange();
        m.setState(new Idle());
    }
}
```

Each state only overrides the actions it allows; everything else falls back to the `default` method that rejects it. A new state is a new class, and the rules for that state live in one place.

**When to use:** An object has a clear lifecycle and the same action behaves differently, or is forbidden, depending on where it is in that lifecycle.

**Key takeaway:** State moves "what am I allowed to do right now?" out of `if/else` chains and into one class per state.

### When an enum is enough

If the states only control which transitions are legal and do not change behaviour much, a plain `enum` is simpler:

```java
enum OrderStatus {
    CREATED, PAID, SHIPPED, DELIVERED, CANCELLED;

    boolean canMoveTo(OrderStatus next) {
        return switch (this) {
            case CREATED -> next == PAID || next == CANCELLED;
            case PAID -> next == SHIPPED || next == CANCELLED;
            case SHIPPED -> next == DELIVERED;
            case DELIVERED, CANCELLED -> false;
        };
    }
}
```

Use full State classes when each state has real behaviour of its own: a vending machine, an ATM, an elevator car, or a phase in a turn-based game.

### Strategy vs. State

The two look almost identical in code: an interface plus several implementations. The difference is who decides and why.

-   **Strategy:** The client picks the algorithm, usually once. Strategies do not know about each other. "Use weekend pricing."
-   **State:** The object switches its own state as events happen. States know which state comes next. "After the coin, move to HasCredit."

A useful check: if the implementations call `setState(...)` on the context, it is State. If they just compute a result and return, it is Strategy.

---

## 3. Observer

**Intent:** When one object changes, automatically notify every object that has signed up to hear about it.

Look for phrases like "notify the user when", "send an email and an SMS and update analytics", or "the display board should update". The object that changes (the subject) keeps a list of listeners and calls each of them.

### The problem

```java
class OrderService {
    private final EmailSender email = new EmailSender();
    private final SmsSender sms = new SmsSender();
    private final AnalyticsClient analytics = new AnalyticsClient();

    void placeOrder(Order order) {
        save(order);
        email.sendConfirmation(order);
        sms.sendConfirmation(order);
        analytics.track("order_placed", order.id());
    }
}
```

`OrderService` knows about every downstream reaction. Adding a push notification or a loyalty-points update means editing the order code, which has nothing to do with notifications.

### Better design: Observer

```java
interface OrderListener {
    void onOrderPlaced(Order order);
}

class OrderService {
    private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();

    void subscribe(OrderListener l) { listeners.add(l); }
    void unsubscribe(OrderListener l) { listeners.remove(l); }

    void placeOrder(Order order) {
        save(order);                         // commit first
        for (OrderListener l : listeners) {
            try {
                l.onOrderPlaced(order);
            } catch (RuntimeException e) {
                log(e);                      // one bad listener must not stop the rest
            }
        }
    }
}

class EmailListener implements OrderListener {
    public void onOrderPlaced(Order o) { /* send email */ }
}
```

Usage:

```java
orderService.subscribe(new EmailListener());
orderService.subscribe(new SmsListener());
orderService.subscribe(order -> analytics.track("order_placed", order.id()));
```

The order code now only announces "an order was placed". New reactions are added by subscribing a new listener, with no change to `OrderService`.

**When to use:** One event has several independent reactions, and you expect that list of reactions to grow.

**Key takeaway:** Observer lets the subject say "this happened" without knowing who cares.

### Observer pitfalls

-   **Slow listeners:** If listeners run on the caller's thread, one slow email call slows down every order. Hand slow work to an executor or a queue.
-   **Exceptions:** A listener that throws can stop the others from being notified. Catch and log per listener, as above.
-   **Ordering:** Do not depend on listeners running in a particular order. If one reaction must happen before another, make that an explicit step, not a side effect of subscription order.
-   **Notify after commit:** Fire events only after the change is saved. Otherwise listeners may send "order confirmed" for an order that later rolls back.
-   **Leaks:** Listeners that are never unsubscribed stay in memory forever.

Inside one service this is plain Observer (or Spring's `ApplicationEventPublisher`). Across services the same idea becomes publish/subscribe over a broker such as Kafka, which adds durability and retries.

---

## 4. Command

**Intent:** Wrap a request in an object, so you can store it, queue it, log it, retry it, or undo it.

Look for "undo/redo", "queue of requests", "replay", "macro" or "audit every action". Instead of calling a method directly, you create a command object and hand it to something that runs and remembers it.

### The problem

```java
class TextEditor {
    private final StringBuilder text = new StringBuilder();

    void type(String s) { text.append(s); }

    void deleteLast(int n) { text.setLength(text.length() - n); }

    void undo() {
        // What was the last action? What did it change?
        // We never recorded it, so there is nothing to undo.
    }
}
```

The actions run and vanish. There is no record of what happened, so undo, redo, and an action history are all impossible without bolting on messy tracking code.

### Better design: Command

```java
interface Command {
    void execute();
    void undo();
}

class TypeCommand implements Command {
    private final StringBuilder doc;
    private final String added;
    TypeCommand(StringBuilder doc, String added) { this.doc = doc; this.added = added; }

    public void execute() { doc.append(added); }
    public void undo() { doc.setLength(doc.length() - added.length()); }
}

class CommandHistory {
    private final Deque<Command> undoStack = new ArrayDeque<>();
    private final Deque<Command> redoStack = new ArrayDeque<>();

    void run(Command c) { c.execute(); undoStack.push(c); redoStack.clear(); }

    void undo() {
        if (undoStack.isEmpty()) return;
        Command c = undoStack.pop(); c.undo(); redoStack.push(c);
    }

    void redo() {
        if (redoStack.isEmpty()) return;
        Command c = redoStack.pop(); c.execute(); undoStack.push(c);
    }
}
```

Every action is now an object that knows how to reverse itself, and the history is just two stacks. Note that a new action clears the redo stack, which is how real editors behave.

A command must capture enough information to undo itself. A "move piece" command in chess must remember the captured piece and any special flags (such as castling rights), not just the from and to squares.

**When to use:** You need undo/redo, delayed or queued execution, retries, or a log of who did what.

**Key takeaway:** Command turns "do this now" into "here is a thing to do", which you can then store, replay or reverse.

---

## 5. Combining them

Real designs use several patterns together. An elevator system is a good example:

-   **Command:** each floor request is an object, such as `FloorRequest(floor, direction)`, placed in a queue.
-   **Strategy:** a `SchedulingStrategy` decides which car takes the request (nearest car, least busy, zoning).
-   **State:** each car is `Idle`, `MovingUp`, `MovingDown`, `DoorsOpen` or `Maintenance`, and reacts to events differently in each.
-   **Observer:** floor displays subscribe to car movements and update automatically.

Saying this out loud in an interview shows you see patterns as tools, not as a checklist.

---

## In an LLD interview

-   **Parking Lot:** `PricingStrategy` for fares and `SpotAssignmentStrategy` for picking a spot. Splitwise uses the same idea with `SplitStrategy` (equal, exact, percentage).
-   **Elevator and Vending Machine:** State for the car or machine lifecycle; mention the enum alternative for simple order lifecycles.
-   **Notification System and BookMyShow:** Observer for "booking confirmed" fanning out to email, SMS and analytics; mention async dispatch and notifying after commit.
-   **Chess moves and undo:** Command per move, storing captured pieces so undo can restore the board exactly.
-   **ATM:** State for card-inserted, PIN-verified and transaction phases.

## At a glance

| Pattern | Core idea | Use when |
|---|---|---|
| Strategy | Interchangeable algorithms behind one interface | There are several ways to do the same job and the choice varies |
| State | One class per state; the object switches its own state | Actions behave differently depending on the lifecycle stage |
| Observer | Subject notifies a list of subscribers | One event has several independent reactions |
| Command | A request wrapped as an object | You need undo/redo, queues, retries or an audit log |

## Final memory aid

-   **Strategy:** Which way? (the client chooses)
-   **State:** Where am I now? (the object switches itself)
-   **Observer:** Who should hear about this?
-   **Command:** Can I keep, replay or reverse this action?

Do not force a pattern where a simple `if` is clearer. Reach for these when the variation, lifecycle, or fan-out is real and likely to grow.

=== lld-behavioral-2 | LLD | Behavioral patterns II: Chain of Responsibility, Template Method, Iterator, Mediator, Memento, Visitor ===
These six patterns come up less often than Strategy or State, but when a problem has the right shape they give the cleanest answer. They cover passing a request through a series of handlers, fixing the steps of an algorithm, walking a custom collection, coordinating many objects, saving snapshots, and adding operations to a set of types. Each one below starts with the messy version so you can see exactly what the pattern fixes.

## 1. Chain of Responsibility

**Intent:** Pass a request along a chain of handlers. Each handler either deals with it, passes it on, or does a bit of both.

Look for "approval goes to manager, then director, then CFO", "dispense notes of 2000, then 500, then 100", or "run every request through a series of checks".

### The problem

```java
class ExpenseApprover {
    String approve(double amount) {
        if (amount <= 10_000) {
            return "Approved by Manager";
        } else if (amount <= 100_000) {
            return "Approved by Director";
        } else if (amount <= 1_000_000) {
            return "Approved by CFO";
        }
        return "Rejected";
    }
}
```

All approval levels and limits are hard-coded in one method. Adding a "VP" level or changing the order means editing and retesting this class, and the levels cannot be configured per department.

### Better design: Chain of Responsibility

```java
abstract class Approver {
    private Approver next;

    Approver then(Approver next) { this.next = next; return next; }

    String handle(double amount) {
        if (canApprove(amount)) return name() + " approved";
        if (next == null) return "Rejected: no one can approve " + amount;
        return next.handle(amount);
    }

    abstract boolean canApprove(double amount);
    abstract String name();
}

class Manager extends Approver {
    boolean canApprove(double a) { return a <= 10_000; }
    String name() { return "Manager"; }
}

class Director extends Approver {
    boolean canApprove(double a) { return a <= 100_000; }
    String name() { return "Director"; }
}
```

Usage:

```java
Approver chain = new Manager();
chain.then(new Director()).then(new Cfo());
chain.handle(45_000);   // "Director approved"
```

Each level knows only its own limit and who comes next. Levels can be added, removed or reordered when the chain is built, even from configuration.

There are two common flavours. In a **pure chain**, exactly one handler deals with the request (the approval example). In a **pipeline**, every handler does its part and passes it on, like servlet filters or Spring Security's filter chain.

The ATM cash dispenser is a classic example: a 2000 handler gives as many 2000 notes as it can, then passes the rest to the 500 handler, and so on. Watch out for one trap: a greedy chain can fail when the machine is low on a note type, so check that the full amount can be dispensed before giving out any notes.

**When to use:** A request may be handled by one of several handlers, or must pass through several steps, and the set or order of handlers should be easy to change.

**Key takeaway:** Always decide what happens at the end of the chain. A request that silently falls off the end is a bug.

### Chain of Responsibility vs. Decorator

Both link objects together and pass calls along, so they are easy to mix up.

-   **Chain of Responsibility:** Any handler may stop the request. The goal is to find who should handle it (or to run a series of checks that can reject it).
-   **Decorator:** Every wrapper always calls the wrapped object. The goal is to add behaviour around a call, such as logging, caching or compression, without stopping it.

Quick test: if a link can say "I handled it, stop here", it is a chain.

---

## 2. Template Method

**Intent:** Define the fixed steps of an algorithm in a base class and let subclasses fill in the details of some steps.

Look for "every import follows the same steps but the file formats differ" or "all games share the same turn loop".

### The problem

```java
class CsvImporter {
    void importFile(String path) {
        String raw = readFile(path);
        List<Row> rows = parseCsv(raw);
        validate(rows);
        saveToDb(rows);
    }
}

class JsonImporter {
    void importFile(String path) {
        String raw = readFile(path);
        List<Row> rows = parseJson(raw);
        // forgot to validate
        saveToDb(rows);
    }
}
```

The overall flow is copied into every importer. Over time the copies drift apart, and one of them quietly skips validation.

### Better design: Template Method

```java
abstract class DataImporter {
    public final void importFile(String path) {   // final: the order cannot change
        String raw = readFile(path);
        List<Row> rows = parse(raw);
        validate(rows);
        save(rows);
        afterImport(rows);
    }

    protected abstract List<Row> parse(String raw);   // varies per format

    protected void afterImport(List<Row> rows) { }    // optional hook

    private String readFile(String path) { /* shared */ return ""; }
    private void validate(List<Row> rows) { /* shared */ }
    private void save(List<Row> rows) { /* shared */ }
}

class CsvImporter extends DataImporter {
    protected List<Row> parse(String raw) { /* split lines and commas */ return List.of(); }
}
```

The flow is written once and marked `final`, so no subclass can skip validation. Subclasses only supply what is actually different. Optional steps with an empty default are called **hooks**.

You already use this idea in the JDK and Spring: `AbstractList` asks you only for `get` and `size`, and `JdbcTemplate` handles connections and cleanup while you supply the query and row mapping.

**When to use:** Several variants share the same steps in the same order, and only a few steps differ.

**Key takeaway:** The base class owns the order of steps; subclasses own the details.

### Template Method vs. Strategy

Both let you vary part of an algorithm. The difference is how.

-   **Template Method** uses inheritance. The skeleton lives in a base class and subclasses override steps. The variant is fixed when you pick the subclass.
-   **Strategy** uses composition. The algorithm is a separate object passed in, and it can be swapped at runtime.

Use Template Method when the steps belong together and the variants are few and stable. If different steps vary independently (parsing varies separately from saving), inheritance leads to a subclass for every combination, so inject a strategy for each step instead.

---

## 3. Iterator

**Intent:** Let callers walk through a collection one element at a time without knowing how it is stored inside.

Java already gives you `Iterator` and `Iterable`, which power the enhanced `for` loop. In LLD you write your own when the collection is custom: a playlist, a tree, or results that arrive page by page.

### The problem

```java
class Playlist {
    public List<Song> songs = new ArrayList<>();   // exposed to everyone
}

// Callers loop over the internal list directly
for (int i = 0; i < playlist.songs.size(); i++) {
    play(playlist.songs.get(i));
}
```

Every caller depends on the internal `ArrayList`. If you change storage, or add a "shuffle" mode, every loop in the codebase has to change, and callers can also modify the list behind your back.

### Better design: Iterator

```java
class Playlist implements Iterable<Song> {
    private final List<Song> songs = new ArrayList<>();
    private boolean shuffle;

    void add(Song s) { songs.add(s); }
    void setShuffle(boolean on) { shuffle = on; }

    public Iterator<Song> iterator() {
        List<Song> order = new ArrayList<>(songs);    // snapshot
        if (shuffle) Collections.shuffle(order);
        return Collections.unmodifiableList(order).iterator();
    }
}

// Caller
for (Song s : playlist) {
    play(s);
}
```

Callers just write a `for` loop. The playlist decides the order and protects its internal list, and shuffle mode did not change a single caller.

Common interview follow-ups: a filtering iterator that skips deleted items, an iterator that fetches the next page lazily from an API, or a merged iterator over k sorted lists. If asked about changes during iteration, mention fail-fast iterators (which throw `ConcurrentModificationException`) versus snapshot or weakly consistent iterators (such as those of `CopyOnWriteArrayList` and `ConcurrentHashMap`).

**When to use:** You own a custom collection and want callers to traverse it without depending on its internals.

**Key takeaway:** Hand out an iterator, not your internal data structure.

---

## 4. Mediator

**Intent:** Put a central object in charge of how a group of objects interact, so they talk to the mediator instead of to each other.

Look for many objects that need to coordinate: users in a chat room, aircraft and a control tower, elevator cars and floor buttons.

### The problem

```java
class User {
    private final String name;
    private final List<User> contacts = new ArrayList<>();
    User(String name) { this.name = name; }

    void addContact(User u) { contacts.add(u); }

    void send(String msg) {
        for (User u : contacts) {
            u.receive(name + ": " + msg);
        }
    }
    void receive(String msg) { System.out.println(msg); }
}
```

Every user must hold a reference to every other user. With 50 users that is a tangled web, and rules like "muted users cannot post" have no natural home.

### Better design: Mediator

```java
class ChatRoom {
    private final List<User> members = new ArrayList<>();

    void join(User u) { members.add(u); }

    void broadcast(User from, String msg) {
        if (from.isMuted()) return;                 // room rules live here
        for (User u : members) {
            if (u != from) u.receive(from.name() + ": " + msg);
        }
    }
}

class User {
    private final String name;
    private final ChatRoom room;
    private boolean muted;
    User(String name, ChatRoom room) { this.name = name; this.room = room; }

    void send(String msg) { room.broadcast(this, msg); }
    void receive(String msg) { System.out.println(msg); }
    String name() { return name; }
    boolean isMuted() { return muted; }
}
```

Each user knows only the room. Many-to-many links become many-to-one, and the coordination rules live in one place.

The main risk is that the mediator grows into a "god object" that does everything. Keep it focused on coordination and push real algorithms (such as which elevator car to send) into strategies.

**When to use:** Many objects need to coordinate, and direct references between them would form a tangled mesh.

**Key takeaway:** Mediator replaces "everyone talks to everyone" with "everyone talks to the hub".

---

## 5. Memento

**Intent:** Take a snapshot of an object's state so you can restore it later, without exposing its internals.

Look for "save game", "restore draft", "checkpoint" or "undo by going back to a previous version".

### The problem

```java
class Editor {
    public String text = "";
    public int cursor;
}

// Some outside class saves and restores by reaching inside
String savedText = editor.text;
int savedCursor = editor.cursor;
// ... later
editor.text = savedText;
editor.cursor = savedCursor;
```

The outside code must know every field of `Editor`. Add a "selection" field and every save and restore point is now silently incomplete.

### Better design: Memento

```java
class Editor {
    private String text = "";
    private int cursor;

    void type(String s) { text += s; cursor = text.length(); }

    Snapshot save() { return new Snapshot(text, cursor); }

    void restore(Snapshot s) { text = s.text(); cursor = s.cursor(); }

    record Snapshot(String text, int cursor) { }      // immutable
}

class History {
    private final Deque<Editor.Snapshot> saves = new ArrayDeque<>();
    void push(Editor.Snapshot s) { saves.push(s); }
    Editor.Snapshot pop() { return saves.pop(); }
}
```

Only `Editor` decides what goes into a snapshot. The `History` class stores snapshots without needing to understand them, and new fields are captured by changing one place.

**When to use:** You need save points, drafts, or undo by restoring a whole previous state.

**Key takeaway:** The object saves and restores itself; everyone else just holds the snapshot.

### Memento vs. Command for undo

-   **Command** stores the operation and how to reverse it. It is cheap on memory, but every command must implement `undo` correctly.
-   **Memento** stores the full state. It is simple and hard to get wrong, but heavy for large objects.

Real editors often mix them: commands for everyday edits, plus occasional snapshots as checkpoints, with a limit on history size.

---

## 6. Visitor

**Intent:** Add new operations to a fixed set of classes without changing those classes.

Look for a set of types that rarely changes (shapes, cart item types, expression nodes) but a growing list of things you want to do with them: compute area, export to SVG, calculate tax.

### The problem

```java
interface Shape {
    double area();
    double perimeter();
    String toSvg();
    String toJson();
    // every new feature adds another method here
}
```

Each new operation forces you to edit every shape class. Unrelated concerns such as geometry, file export and serialization all pile up inside the shapes.

### Better design: Visitor (modern Java form)

```java
sealed interface Shape permits Circle, Rect { }
record Circle(double r) implements Shape { }
record Rect(double w, double h) implements Shape { }

class AreaCalculator {
    static double area(Shape s) {
        return switch (s) {
            case Circle c -> Math.PI * c.r() * c.r();
            case Rect r -> r.w() * r.h();
        };
    }
}

class SvgExporter {
    static String export(Shape s) {
        return switch (s) {
            case Circle c -> "<circle r='" + c.r() + "'/>";
            case Rect r -> "<rect width='" + r.w() + "' height='" + r.h() + "'/>";
        };
    }
}
```

Each operation lives in its own class, and the shapes stay small. Because `Shape` is `sealed`, the compiler tells you if a `switch` forgets a shape.

The classic Visitor does the same job with an `accept(ShapeVisitor v)` method on each shape and `visit(Circle)` and `visit(Rect)` methods on each visitor (this is called double dispatch). With sealed types and pattern-matching `switch` in Java 21, you get the same benefit with less code. Mentioning both shows modern Java fluency.

The trade-off is the reverse of normal polymorphism: adding a new operation is easy, but adding a new shape means updating every visitor.

**When to use:** The set of types is stable, but you keep adding new operations over them, such as tax, discount and shipping rules over cart item types.

**Key takeaway:** Visitor keeps operations outside the classes they work on; prefer sealed types plus `switch` in modern Java.

---

## In an LLD interview

-   **ATM:** Chain of Responsibility for the cash dispenser (2000, then 500, then 100), with a feasibility check before giving out notes.
-   **Approval workflows and request filters:** Chain of Responsibility with one handler per level and a clear "rejected" ending; the chain is built from configuration.
-   **Chess or a text editor with undo:** Command for each move or edit, plus Memento snapshots for save points.
-   **Elevator and chat systems:** Mediator as the dispatcher or chat room, with a strategy inside it for choosing the car.
-   **Shopping cart or Splitwise reports:** Visitor (or sealed types with `switch`) for tax, discount or export over a fixed set of item types; Template Method for a shared report or import pipeline.

## At a glance

| Pattern | Core idea | Use when |
|---|---|---|
| Chain of Responsibility | Pass the request along handlers until one deals with it | Approvals, filters, note dispensing, escalation |
| Template Method | Base class fixes the steps; subclasses fill in some | Variants share the same steps in the same order |
| Iterator | Walk a collection without seeing its internals | You own a custom collection or paged data |
| Mediator | A central hub coordinates a group of objects | Many objects would otherwise reference each other |
| Memento | Opaque snapshot of an object's state | Save points, drafts, undo by restoring state |
| Visitor | Operations live outside a fixed set of types | Types are stable but operations keep growing |

## Final memory aid

-   **Chain:** Who handles this? Pass it on.
-   **Template Method:** Same steps, different details.
-   **Iterator:** Give me the next one.
-   **Mediator:** Talk to the hub, not to each other.
-   **Memento:** Save now, restore later.
-   **Visitor:** New operation, no change to the types.

These are tools for specific shapes of problem. Name the shape first, then pick the pattern.
