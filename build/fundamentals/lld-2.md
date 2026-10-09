=== lld-uml | LLD | Class relationships and UML diagrams ===
A class diagram is the shared language of an LLD round. In two minutes of boxes and arrows you communicate ownership, lifecycles and extension points, and the interviewer can spot problems before you write code. This chapter covers every relationship type precisely, how to choose between them, multiplicity, sequence diagrams and how each relationship maps to Java.

## Anatomy of a class box
```
┌────────────────────────────┐
│ Ticket                     │   ← name (italic or {abstract} if abstract; <<interface>> for interfaces)
├────────────────────────────┤
│ - id: String               │   ← attributes: visibility name: type
│ - entryTime: Instant       │
│ - spot: Spot               │
├────────────────────────────┤
│ + close(clock): Receipt    │   ← operations
│ + isOpen(): boolean        │
└────────────────────────────┘
```
Visibility markers: `+` public, `-` private, `#` protected, `~` package. In interviews, list only the attributes and methods that explain the design. Nobody wants every getter.

## The relationships, from weakest to strongest
### 1. Dependency ("uses temporarily")
A class uses another as a method parameter, local variable or return type, without holding a reference. Drawn as a **dashed arrow**.
```java
class ReceiptPrinter { void print(Receipt r) { /* uses Receipt only during the call */ } }
```
Changing `Receipt` might break `ReceiptPrinter`, but there's no lasting link.

### 2. Association ("knows about")
A structural link where one object holds a reference to another, and both have **independent lifecycles**. Drawn as a **solid line**, with an arrowhead to show navigability.
```java
class Driver { private Car assignedCar; }   // a driver knows their car; neither owns the other
```

### 3. Aggregation ("has-a, parts can exist alone")
A whole–part association where the parts **can outlive** the whole or belong to several wholes. Drawn with a **hollow diamond** on the whole's side.
```java
class Team { private final List<Player> players; Team(List<Player> players) { this.players = List.copyOf(players); } }
```
Disbanding a team doesn't delete players; a player could join another team.

### 4. Composition ("owns, parts die with the whole")
A strong whole–part relationship where the whole **creates, owns and destroys** its parts, and a part belongs to exactly one whole. Drawn with a **filled diamond**.
```java
class Order {
    private final List<OrderLine> lines = new ArrayList<>();
    void addLine(Product p, int qty) { lines.add(new OrderLine(p, qty)); }   // created inside, never shared
}
```
Deleting the order deletes its lines; an order line makes no sense on its own.

### 5. Inheritance (generalisation) and realisation
- **Generalisation** (`extends`): solid line with a **hollow triangle** pointing to the parent.
- **Realisation** (`implements`): dashed line with a hollow triangle pointing to the interface.

## Choosing the right relationship
Ask these questions in order:
1. **Is it only used inside a method?** → Dependency.
2. **Does one hold a reference to the other?** If not, stop.
3. **Is it a whole–part relationship?** If not → Association.
4. **If the whole is deleted, must the parts be deleted too, and can a part belong to only one whole?** Yes → Composition; no → Aggregation.
5. **Is one a more specific kind of the other, honouring its full contract?** → Inheritance (or realisation for interfaces).

| Example | Relationship | Why |
|---|---|---|
| `Library` — `Book` | Aggregation | Books exist without the library's catalogue object and can move between branches |
| `Book` — `BookCopy` | Composition | A physical copy belongs to one book record |
| `Member` — `Loan` | Association | A member has loans, but loans are records with their own lifecycle |
| `Board` — `Cell` | Composition | Cells exist only as part of the board |
| `Car` — `Vehicle` | Inheritance | A car is a vehicle |
| `CardProcessor` — `PaymentProcessor` | Realisation | Implements the interface |
| `FeeCalculator.compute(Ticket)` | Dependency | Uses a ticket only during the call |

## Multiplicity
Write multiplicities at both ends of a line:
- `1` exactly one, `0..1` optional, `*` or `0..*` many, `1..*` at least one, `m..n` a range.

```
ParkingLot 1 ◆──── 1..* Floor 1 ◆──── 1..* Spot
Spot 1 ────── 0..1 Vehicle            (a spot holds at most one vehicle)
Member 1 ───── 0..5 Loan               (business rule: at most 5 active loans)
```
Multiplicity drives the Java types you choose:
| Multiplicity | Java |
|---|---|
| `1` | non-null `final` field, set in the constructor |
| `0..1` | nullable field, or `Optional` from the getter |
| `*` | `List`, `Set` or `Map` (choose by lookup needs) |
| `m..n` | collection plus a validation rule |

Lookup needs matter: if you constantly ask "find free spot of size M", a `Map<SpotSize, Deque<Spot>>` beats scanning a `List<Spot>`.

## Navigability: keep links one-way
A bidirectional link (`Order ↔ Customer`) doubles the bookkeeping: both sides must be updated consistently. Default to **one direction**, chosen by which side needs to navigate in your use cases. Add the reverse only if a requirement demands it, and then update both sides in one method.

## Interfaces, abstract classes and enums in diagrams
```
<<interface>>             {abstract}            <<enumeration>>
PricingStrategy           Piece                 SpotSize
+ price(t): Money         # color: Color        SMALL
                          + canMove(...)        MEDIUM
                                                LARGE
```
Show which classes **depend on the interface** (the client) and which **realise** it (implementations). That picture *is* the dependency inversion principle.

## Sequence diagrams: one critical flow
A class diagram shows structure; a sequence diagram shows **interaction over time**. Draw one for the trickiest flow (booking, checkout) to show call order, validation and where locks are taken.
```
User      BookingService     SeatLockManager      PaymentGateway     BookingRepo
 │  book(show, seats) │              │                    │                │
 │───────────────────▶│ lock(seats)  │                    │                │
 │                    │─────────────▶│ ok / fail          │                │
 │                    │◀─────────────│                    │                │
 │                    │ charge(amount, idempotencyKey)    │                │
 │                    │──────────────────────────────────▶│                │
 │                    │◀──────────────────────────────────│ success        │
 │                    │ save(booking CONFIRMED)                            │
 │                    │───────────────────────────────────────────────────▶│
 │                    │ unlock(seats)│                    │                │
 │◀───────────────────│ booking      │                    │                │
```
This one picture answers "what if payment fails?" (unlock and leave the booking unconfirmed) and "where's the race?" (`lock(seats)`).

## Other diagrams worth knowing
- **State diagram:** states and transitions for an order, ATM, vending machine or elevator. Draw this when the problem says "can be in states…".
- **Use-case diagram:** actors and what they can do. Handy for summarising requirements in 30 seconds.
- **Activity diagram:** a flowchart of a process. Rarely needed in interviews.

## Mapping relationships to Java
```java
// Composition: the part is created inside and never exposed for reuse
final class Board { private final Cell[][] cells = new Cell[8][8]; }

// Aggregation: parts injected, shared references allowed
final class Playlist { private final List<Song> songs = new ArrayList<>(); void add(Song s) { songs.add(s); } }

// Association: reference to an independently managed object
final class Loan { private final Member member; private final BookCopy copy; }

// Dependency: only a parameter
final class FineCalculator { Money fineFor(Loan loan, Instant now) { /* … */ return Money.ZERO; } }
```

## Common mistakes
- Drawing every relationship as inheritance.
- Composition where the part is clearly shared (a `Book` "composed" in two libraries).
- 25-class diagrams. Show the 8–12 classes that carry the design and mention the rest.
- Missing multiplicities: "how many spots per floor?" should be obvious from the diagram.
- Bidirectional arrows everywhere.
- Classes named after verbs (`BookingHandler`) instead of concepts (`Booking`, `SeatHold`).

## Interview questions
1. **Aggregation vs composition, with an example?** Composition means the part's lifecycle is bound to the whole and the part isn't shared (`Order`–`OrderLine`). Aggregation means the parts are independent and possibly shared (`Team`–`Player`).
2. **How would you represent "a member can borrow at most 5 books"?** Multiplicity `0..5` on `Member–Loan`, enforced in `Member.borrow()` or a policy object, because diagrams don't enforce rules by themselves.
3. **Why prefer one-directional associations?** Less coupling and no risk of the two sides disagreeing.

## Cheat sheet
```
Dependency    - - - ->   uses in a method
Association   ───────>   holds a reference, independent lifecycles
Aggregation   ◇──────    whole-part, parts can live alone / be shared
Composition   ◆──────    whole owns parts, parts die with it
Inheritance   ──────▷    is-a (extends)
Realisation   - - - -▷   implements interface
Multiplicity: 1, 0..1, *, 1..*, m..n → choose Java types and lookups accordingly
```

=== lld-solid | LLD | SOLID principles with Java examples ===
SOLID is a set of five design principles for code that stays easy to change. In LLD interviews, each principle maps to a question you'll be asked, such as "what happens when we add a new payment method?" This chapter explains each principle with a violation, a fix and the interview angle, then covers the related principles interviewers expect you to know.

## S: Single Responsibility Principle
> A class should have one, and only one, reason to change.

"Reason to change" means a **stakeholder or axis of change**: business rules, presentation, persistence, notifications. When two of those live in one class, a change for one can break the other.

**Violation**
```java
class Invoice {
    Money total() { /* pricing rules */ return null; }
    byte[] toPdf() { /* layout, fonts */ return null; }
    void save(Connection c) { /* SQL */ }
    void emailTo(String address) { /* SMTP */ }
}
```
The finance team changes tax rules, design changes the PDF layout, the DBA changes the schema and marketing changes the email template. Four reasons to change one class.

**Fix**
```java
record Invoice(List<Line> lines, TaxRule tax) { Money total() { /* rules only */ return null; } }
class InvoicePdfRenderer { byte[] render(Invoice i) { /* … */ return null; } }
interface InvoiceRepository { void save(Invoice i); }
class InvoiceMailer { void send(Invoice i, String to) { /* … */ } }
```
**Smells:** class names containing *Manager*, *Handler* or *And*; methods from unrelated domains in one class; huge constructors with ten dependencies.
**Caution:** SRP doesn't mean one method per class. A class can have many methods if they serve one cohesive purpose.

## O: Open/Closed Principle
> Software entities should be open for extension but closed for modification.

Add behaviour by **adding code** (a new class), not by editing working code. The classic violation is a type switch that grows with every new variant.

**Violation**
```java
Money discount(Cart cart, String promoType) {
    switch (promoType) {
        case "PERCENT": /* … */ break;
        case "FLAT": /* … */ break;
        case "BOGO": /* … */ break;        // every new promo edits this method
    }
    return Money.ZERO;
}
```
**Fix:** Strategy plus registration.
```java
interface DiscountRule { boolean applies(Cart c); Money discount(Cart c); }
final class PercentOff implements DiscountRule { /* … */ }
final class BuyXGetY implements DiscountRule { /* … */ }

final class PricingEngine {
    private final List<DiscountRule> rules;                   // injected (Spring collects all beans)
    PricingEngine(List<DiscountRule> rules) { this.rules = List.copyOf(rules); }
    Money totalDiscount(Cart c) {
        return rules.stream().filter(r -> r.applies(c)).map(r -> r.discount(c)).reduce(Money.ZERO, Money::plus);
    }
}
```
Adding a promotion is now a new class. **Interview phrasing:** "Adding a UPI processor means one new class implementing `PaymentProcessor`, registered in the factory; existing processors and the checkout flow don't change."
**Caution:** don't pre-build extension points for variations nobody asked for (YAGNI). Apply OCP where change is likely, which is exactly what the requirements told you.

## L: Liskov Substitution Principle
> Objects of a subtype must be usable wherever the supertype is expected, without breaking correctness.

Subtypes must honour the **contract** of the parent:
- No stronger **preconditions** (can't demand more of callers).
- No weaker **postconditions** (must deliver at least what the parent promised).
- Preserve **invariants** of the parent.
- Don't throw new, unexpected exceptions for operations the parent supports.

**Classic violation**
```java
class Rectangle { protected int w, h; void setWidth(int w) { this.w = w; } void setHeight(int h) { this.h = h; } int area() { return w * h; } }
class Square extends Rectangle {
    @Override void setWidth(int w) { this.w = w; this.h = w; }   // surprises callers
    @Override void setHeight(int h) { this.w = h; this.h = h; }
}
// Caller expects area 20 after setWidth(4); setHeight(5) → a Square returns 25.
```
**Real-world violations:** a `ReadOnlyRepository` subclass whose `save()` throws `UnsupportedOperationException`; a `FreeShipping` order type whose `shippingCost()` throws instead of returning zero.
**Fix:** model capabilities with separate interfaces (`ReadableRepository`, `WritableRepository`), or make values immutable so "set width" isn't part of the contract.
**Interview angle:** LSP is why "`Penguin extends Bird` with `fly()` throwing" is wrong. Split `Bird` and `FlyingBird`, or compose a `FlyBehavior`.

## I: Interface Segregation Principle
> Clients should not be forced to depend on methods they do not use.

Fat interfaces force implementers to stub methods and couple clients to changes they don't care about.

**Violation**
```java
interface Machine { void print(Doc d); void scan(Doc d); void fax(Doc d); }
class BasicPrinter implements Machine {
    public void print(Doc d) { /* ok */ }
    public void scan(Doc d) { throw new UnsupportedOperationException(); }   // also an LSP smell
    public void fax(Doc d) { throw new UnsupportedOperationException(); }
}
```
**Fix**
```java
interface Printer { void print(Doc d); }
interface Scanner { void scan(Doc d); }
interface Fax { void fax(Doc d); }
class MultiFunctionDevice implements Printer, Scanner, Fax { /* … */ }
class BasicPrinter implements Printer { /* … */ }
```
In LLD problems, ISP often appears as **role interfaces**: `Notifiable`, `Chargeable`, `Schedulable`. A parking `Gate` might implement `EntryGate` and `ExitGate` separately.

## D: Dependency Inversion Principle
> High-level modules should not depend on low-level modules; both should depend on abstractions.

Business policy (checkout, booking) shouldn't import concrete infrastructure (a Stripe SDK, a JDBC class, the system clock). Define the abstraction in the **domain's terms**, and let infrastructure implement it.

```java
// Domain layer owns the abstraction
public interface PaymentGateway { PaymentResult charge(Money amount, PaymentMethod method, String idempotencyKey); }

// High-level policy depends only on abstractions
public final class CheckoutService {
    private final PaymentGateway gateway; private final OrderRepository orders; private final Clock clock;
    public CheckoutService(PaymentGateway gateway, OrderRepository orders, Clock clock) {
        this.gateway = gateway; this.orders = orders; this.clock = clock;
    }
}

// Infrastructure implements it
final class StripePaymentGateway implements PaymentGateway { /* adapts Stripe SDK */ }
```
Benefits: testability (inject fakes), swappability (change providers), and a domain that compiles without infrastructure. **DIP is not the same as dependency injection**: DI (constructor injection, Spring) is the mechanism that supplies the implementations, and DIP is the design rule about which way dependencies point.

## Related principles interviewers expect
| Principle | Meaning | Example |
|---|---|---|
| **DRY** | Each piece of knowledge has one authoritative representation | Fee rules in one `PricingStrategy`, not copied into the UI and the reports |
| **KISS** | Prefer the simplest design that meets requirements | An `enum` state machine before a full State pattern, if the states are trivial |
| **YAGNI** | Don't build for hypothetical needs | No plugin system for one payment method |
| **Law of Demeter** | Talk only to immediate collaborators | `order.shippingCity()` instead of `order.getCustomer().getAddress().getCity()` |
| **Tell, don't ask** | Ask objects to act, rather than pulling their data out to decide for them | `account.withdraw(x)` instead of a balance check plus setter outside |
| **Composition over inheritance** | Prefer has-a for varying behaviour | Strategies injected rather than subclasses per variant |
| **Program to an interface** | Declare dependencies by interface type | `List<T>` not `ArrayList<T>`; `PaymentGateway` not `StripeClient` |

DRY has a trap: two pieces of code that look alike but change for **different reasons** shouldn't be merged. Accidental duplication is fine; duplicated knowledge isn't.

## Using SOLID in an interview answer
Don't recite definitions. Use the principles to **justify decisions** in one sentence each:
- "Pricing is a Strategy so new pricing rules don't modify the parking service (open/closed)."
- "Notifications are a separate `NotificationService`; the booking class shouldn't change when we add WhatsApp (single responsibility)."
- "The booking service depends on a `SeatLockProvider` interface, so we can swap an in-memory lock for Redis later (dependency inversion)."

## Interview questions
1. **Give an LSP violation you've seen in real code.** Read-only collections or adapters throwing `UnsupportedOperationException` (Java's `List.of(...).add()` is a famous trade-off in the JDK itself).
2. **How do SRP and ISP differ?** SRP is about why a *class* changes; ISP is about what *clients* are forced to depend on.
3. **Can over-applying SOLID hurt?** Yes: dozens of one-method interfaces and indirection with no variation. Apply it where requirements predict change.

## Cheat sheet
```
S  one reason to change            → split by stakeholder/axis (rules, persistence, presentation)
O  extend by adding classes         → Strategy/Factory registration instead of switch
L  subtypes honour the contract     → no surprise exceptions, no stronger preconditions
I  small role interfaces            → Printer/Scanner rather than Machine
D  depend on abstractions you own   → domain interfaces, infrastructure implements, DI wires
+  DRY (knowledge), KISS, YAGNI, Demeter, tell-don't-ask
```
