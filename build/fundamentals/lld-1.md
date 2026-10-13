=== lld-approach | LLD | How to approach an LLD interview ===
A low-level design (LLD) round asks you to turn a vague idea, such as "design a parking lot", into a small set of clean, working classes in about 45 minutes. This chapter gives you a nine-step method you can repeat for any problem, and walks one example (a parking lot) through every step so you can see what each step actually produces.

## What interviewers score

Interviewers are not checking whether you remember pattern names. They are watching how you think. Most rubrics look at five things:

-   **Requirements:** Did you ask good questions and write down what is in and out of scope?
-   **Modelling:** Do your classes match real concepts, and does each class have one clear job?
-   **Extensibility:** Can a new vehicle type or payment method be added by writing a new class instead of editing old ones?
-   **Correctness:** Did you handle edge cases and two users acting at the same time?
-   **Communication:** Did you explain your choices, talk through trade-offs, and take hints well?

Keep these five in mind. Every step below is designed to earn points on at least one of them.

---

## 1. Clarify requirements

**What to do:** Ask questions that change the design, then write down what is in scope and what is out.

**Why:** "Parking lot" can mean a single-level mall lot or a ten-floor airport garage with EV chargers. If you guess, you may design the wrong thing for twenty minutes.

### Example: Parking Lot

Good questions to ask:

-   One floor or many? Different spot sizes?
-   Which vehicles: bikes, cars, trucks?
-   How is the fee calculated: hourly, flat, different per vehicle?
-   Pay at exit only? Cash, card, UPI?
-   Do we need a display board showing free spots?

Then write the answer down where the interviewer can see it:

```text
IN:  multiple floors, 3 spot sizes (SMALL, MEDIUM, LARGE),
     bike/car/truck, hourly pricing, pay at exit (cash/card)
OUT: reservations, monthly passes, EV charging
```

**Common mistake:** Asking trivia ("what colour are the tickets?") or asking nothing at all and starting to code.

---

## 2. List use cases

**What to do:** Name the actors (who uses the system) and what each actor can do. Also note one or two non-functional needs, such as "two cars must never get the same spot".

**Why:** Use cases become the public methods of your system. They also give you a checklist to verify your design against later.

### Example: Parking Lot

```text
Driver:    park vehicle, take ticket, pay, exit
Attendant: view free spots, handle lost ticket
Admin:     add floor, add spots, change rates

Non-functional:
- no two vehicles get the same spot (concurrency)
- new vehicle types and pricing rules are easy to add
```

**Common mistake:** Listing twenty use cases. Pick the three or four that matter and say the rest are out of scope.

---

## 3. Find entities and behaviours

**What to do:** Read your requirements and use cases. The **nouns** are candidate classes. The **verbs** are candidate methods.

**Why:** This gives you a starting list quickly, and it keeps your classes named after real things in the problem.

### Example: Parking Lot

```text
Nouns:  ParkingLot, Floor, ParkingSpot, Vehicle, Ticket,
        Gate, Payment, DisplayBoard, licence plate
Verbs:  park, unpark, assign spot, calculate fee, pay, show free spots
```

Now clean the list:

-   "licence plate" is just a field of `Vehicle`, not a class.
-   "Slot" and "Spot" mean the same thing, so keep one name.
-   "calculate fee" belongs to something that knows about pricing, not to `Vehicle`.

**Common mistake:** Making a class for every noun, or making one giant `ParkingLotManager` that does every verb.

---

## 4. Define relationships

**What to do:** For each pair of related classes, decide: is it **is-a** (inheritance) or **has-a** (composition or association)? How many of each (one, many, optional)?

**Why:** Relationships tell the interviewer who owns what. They also tell you which Java fields and collections to use.

### Example: Parking Lot

```text
ParkingLot  has many   Floor         (lot owns its floors)
Floor       has many   ParkingSpot   (floor owns its spots)
ParkingSpot has 0 or 1 Vehicle       (currently parked car)
Ticket      refers to  1 Vehicle and 1 ParkingSpot
Car, Bike, Truck  is-a  Vehicle
```

**Common mistake:** Using inheritance for reuse, such as `Ticket extends ParkingSpot`. A ticket is not a kind of spot; it *refers to* a spot.

---

## 5. Pick patterns where things vary

**What to do:** Look for places where the requirements say behaviour will differ or grow: "different pricing", "many payment methods", "different ways to pick a spot". Put an interface there. Use a pattern only when it solves one of these stated needs.

**Why:** Interfaces at the right places make the design extensible. Interfaces everywhere make it hard to read.

### Example: Parking Lot

```text
Pricing varies          -> PricingStrategy        (Strategy)
Payment methods vary    -> PaymentProcessor       (Strategy)
Spot choice may vary    -> SpotAssignmentStrategy (Strategy)
Board must update when spots change -> Observer   (optional)
```

Say it out loud in one sentence: "Pricing varies by vehicle type, so I will make it a strategy. Adding a weekend rate is then a new class."

**Common mistake:** Opening with "I'll use Singleton, Factory and Observer" before you know why. Patterns should be the answer to a requirement, not decoration.

---

## 6. Write the core classes and interfaces

**What to do:** Write the key classes with their important fields and methods. Skip getters, setters, and boilerplate unless asked.

**Why:** This is the part the interviewer will read most closely. Small, clear classes with behaviour (not just data) score well.

### Example: Parking Lot

```java
enum SpotSize { SMALL, MEDIUM, LARGE }

abstract class Vehicle {
    private final String plate;
    protected Vehicle(String plate) { this.plate = plate; }
    public String getPlate() { return plate; }
    public abstract SpotSize requiredSize();
}

class Car extends Vehicle {
    Car(String plate) { super(plate); }
    public SpotSize requiredSize() { return SpotSize.MEDIUM; }
}

interface PricingStrategy {
    long calculateFee(Ticket ticket, Instant exitTime);
}

interface SpotAssignmentStrategy {
    Optional<ParkingSpot> findSpot(List<Floor> floors, SpotSize size);
}

class ParkingService {
    public Ticket park(Vehicle vehicle) { /* ... */ return null; }
    public Receipt unpark(String ticketId, PaymentProcessor payment) { /* ... */ return null; }
}
```

Notice that `ParkingService` does not contain pricing rules or spot-search rules. It asks its strategies.

**Common mistake:** Writing classes that are only fields plus getters and setters, with all the logic in one service class.

---

## 7. Walk through a use case

**What to do:** Pick the main use case and trace it through your classes, call by call.

**Why:** A walkthrough proves the design works. It also reveals missing methods or a class that is doing too much.

### Example: Parking Lot

```text
Car arrives at entry gate
 -> ParkingService.park(car)
 -> assignmentStrategy.findSpot(floors, MEDIUM)  returns spot F2-17
 -> spot.tryPark(car)                            marks it occupied
 -> new Ticket(car, spot, clock.instant())
 -> displayBoard.update()
 -> ticket returned to driver

Car leaves
 -> ParkingService.unpark(ticketId, cardProcessor)
 -> pricingStrategy.calculateFee(ticket, now)    returns 120
 -> cardProcessor.pay(120)
 -> spot.release()
```

**Common mistake:** Skipping the walkthrough. Many designs look fine as boxes and fall apart when you trace a real request.

---

## 8. Concurrency and edge cases

**What to do:** Ask "what if two people do this at the same time?" and "what if something goes wrong halfway?" Find the shared state and protect it.

**Why:** This is where strong candidates separate from average ones. Booking-style problems almost always have a race condition.

### The problem

Two entry gates call `findSpot` at the same moment. Both see spot F2-17 as free. Both send a car there.

### Better design

Make "check and occupy" a single atomic step:

```java
class ParkingSpot {
    private final String id;
    private final SpotSize size;
    private Vehicle vehicle;

    ParkingSpot(String id, SpotSize size) {
        this.id = id;
        this.size = size;
    }

    public synchronized boolean tryPark(Vehicle v) {
        if (vehicle != null) {
            return false;   // someone else got it first
        }
        vehicle = v;
        return true;
    }

    public synchronized void release() {
        vehicle = null;
    }
}
```

If `tryPark` returns false, the service simply tries the next free spot. Then list edge cases briefly: lot is full, lost ticket, paying twice, payment fails after the car has left.

**Common mistake:** Never mentioning concurrency, or saying "I'll make everything synchronized" without naming what is shared.

---

## 9. Discuss extensions

**What to do:** Show how the design handles a new requirement with minimal change. Then summarise your design in two or three sentences.

**Why:** "How would you add X?" is almost always the last question. A good answer points to an existing extension point.

### Example: Parking Lot

-   **Weekend pricing:** add `WeekendPricing implements PricingStrategy`. Nothing else changes.
-   **UPI payment:** add `UpiProcessor implements PaymentProcessor`.
-   **EV charging:** add an `EV` spot type and let the assignment strategy filter for it.
-   **Many servers instead of one:** the `synchronized` lock becomes a database row lock or a distributed lock.

**Common mistake:** Answering "I'd add an else-if in the fee method". That tells the interviewer the design is not open for extension.

---

## A simple time plan

```text
 0-5   min  Clarify requirements, write IN/OUT
 5-10  min  Use cases, entities, relationships
10-15  min  Variation points and interfaces
15-35  min  Core classes, walkthrough
35-45  min  Concurrency, edge cases, extensions, summary
```

You do not need to follow it exactly. The point is to leave time for concurrency and extensions, which is where many candidates run out of time.

---

## In an LLD interview

-   **Parking Lot, Elevator, Vending Machine:** state matters (spot free or occupied, elevator moving or idle, machine waiting for coins or dispensing). Walk through the state changes in step 7.
-   **BookMyShow, Splitwise:** the concurrency step is central. Two users booking the last seat, or two people editing the same expense, is the question the interviewer is waiting for.
-   **Notification System, Rate Limiter:** the variation points are obvious (channels, algorithms). Show one interface and two implementations early.
-   **Chess:** entities and relationships take most of the time. Keep move rules in the pieces, not in one huge `Game` class.
-   In every problem, state each design decision with its reason in one sentence.

## At a glance

| Step | Core idea | Ask yourself |
|---|---|---|
| 1. Clarify | Agree on scope | What is in and what is out? |
| 2. Use cases | Who does what | What are the 3-4 main flows? |
| 3. Entities | Nouns become classes, verbs become methods | Is this a class or just a field? |
| 4. Relationships | Is-a vs. has-a, and how many | Who owns whom? |
| 5. Patterns | Interfaces where behaviour varies | Did a requirement ask for this? |
| 6. Core classes | Small classes with behaviour | Is any class doing too much? |
| 7. Walkthrough | Trace one request | Does every call have a home? |
| 8. Concurrency | Protect shared state | What if two users do this at once? |
| 9. Extensions | Add, don't edit | What changes for a new variant? |

## Final memory aid

-   **Ask** before you design.
-   **Nouns** become classes, **verbs** become methods.
-   **Interfaces** only where things vary.
-   **Walk** one request through the code.
-   **Race:** find it and fix it.
-   **Extend** by adding a class, not an else-if.

=== lld-oop | LLD | OOP in Java: pillars, composition and interfaces ===
Object-oriented programming is the toolkit you use in every LLD answer. Most candidates can name the four pillars; this chapter shows when to use each one, what goes wrong when you misuse it, and how composition, interfaces, equals/hashCode and immutability fit in.

## 1. Encapsulation

**Definition:** An object owns its data and enforces its own rules. Other code asks it to *do* things instead of changing its fields directly.

Encapsulation is not just "make fields private and add getters and setters". A public setter that lets anyone write any value protects nothing.

### Example: Weak encapsulation

```java
class BankAccount {
    private double balance;

    public double getBalance() {
        return balance;
    }

    public void setBalance(double balance) {
        this.balance = balance;
    }
}

// Somewhere else:
account.setBalance(account.getBalance() - 5000);   // can go negative
```

The rule "balance must never go negative" has to be checked by every caller. One forgetful caller breaks it.

### Better design

```java
class BankAccount {
    private double balance;

    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");
        balance += amount;
    }

    public void withdraw(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");
        if (amount > balance) throw new IllegalStateException("Insufficient funds");
        balance -= amount;
    }

    public double getBalance() {
        return balance;
    }
}
```

The rule now lives in one place. Callers cannot put the account into an invalid state. (Real code would hold money as `BigDecimal` or `long` paise, not `double`; see the Modelling chapter. `double` just keeps this example short.)

**Key takeaway:** Expose actions named after the domain (`withdraw`, `cancel`, `park`), not raw setters. This is often called "tell, don't ask".

---

## 2. Abstraction

**Definition:** Show callers *what* an object can do and hide *how* it does it.

Callers depend on a simple, stable contract. The details behind it can change without affecting them.

### Example: No abstraction

```java
class CheckoutService {
    public void checkout(Order order) {
        RazorpayClient client = new RazorpayClient("api-key");
        client.createOrder(order.getTotal());
        client.capturePayment();
    }
}
```

`CheckoutService` knows the exact steps of one payment provider. Switching providers means rewriting checkout.

### Better design

```java
interface PaymentProcessor {
    void pay(double amount);
}

class RazorpayProcessor implements PaymentProcessor {
    public void pay(double amount) {
        // create order, capture payment
    }
}

class CheckoutService {
    private final PaymentProcessor processor;

    CheckoutService(PaymentProcessor processor) {
        this.processor = processor;
    }

    public void checkout(Order order) {
        processor.pay(order.getTotal());
    }
}
```

Checkout only knows "something can take a payment". The how is hidden behind `pay`.

**Key takeaway:** A good abstraction is small and stable. If its method signature changes every time a new implementation arrives, it is leaking details.

### Encapsulation vs. Abstraction

-   **Encapsulation asks:** Is this object's data protected so its rules cannot be broken?
-   **Abstraction asks:** Do callers see only what they need, without the implementation details?

Encapsulation is about guarding the inside. Abstraction is about the view from the outside.

---

## 3. Inheritance

**Definition:** A subclass reuses and extends a parent class. It models an **is-a** relationship.

Inheritance is useful, but it couples the child tightly to the parent. A change in the parent can silently break every child.

### Example: Inheritance for the wrong reason

```java
class Bird {
    public void fly() {
        System.out.println("Flying");
    }
}

class Penguin extends Bird {
    @Override
    public void fly() {
        throw new UnsupportedOperationException("Penguins can't fly");
    }
}
```

Code that loops over a `List<Bird>` and calls `fly()` will crash on a penguin. "A penguin is a bird" is true in biology, but not true for this contract.

### Better design

```java
abstract class Bird {
    public abstract void eat();
}

interface Flyable {
    void fly();
}

class Sparrow extends Bird implements Flyable {
    public void eat() { System.out.println("Eating seeds"); }
    public void fly() { System.out.println("Flying"); }
}

class Penguin extends Bird {
    public void eat() { System.out.println("Eating fish"); }
}
```

Only birds that can fly promise to fly.

**Key takeaway:** Use inheritance only when the child can honour everything the parent promises. Keep hierarchies shallow (two levels is plenty in an interview).

---

## 4. Polymorphism

**Definition:** One method call behaves differently depending on the actual object it is called on.

Polymorphism is the main tool for removing long `if/else` or `switch` chains on type.

### Example: Type checks everywhere

```java
class FeeCalculator {
    public double hourlyRate(Vehicle vehicle) {
        if (vehicle instanceof Bike) {
            return 10;
        } else if (vehicle instanceof Car) {
            return 20;
        } else if (vehicle instanceof Truck) {
            return 50;
        }
        throw new IllegalArgumentException("Unknown vehicle");
    }
}
```

Every new vehicle type means editing this method, and every similar method elsewhere.

### Better design

```java
abstract class Vehicle {
    public abstract double hourlyRate();
}

class Bike extends Vehicle {
    public double hourlyRate() { return 10; }
}

class Car extends Vehicle {
    public double hourlyRate() { return 20; }
}

class FeeCalculator {
    public double fee(Vehicle vehicle, int hours) {
        return vehicle.hourlyRate() * hours;
    }
}
```

A new `Truck` class brings its own rate. `FeeCalculator` never changes.

**Key takeaway:** When you see `instanceof` or a `switch` on type, ask whether polymorphism should replace it.

### Runtime vs. compile-time polymorphism

-   **Runtime polymorphism (overriding):** a subclass provides its own version of a parent method with the same signature. Java picks the method by the object's real class while the program runs. This is what interviewers usually mean.
-   **Compile-time polymorphism (overloading):** several methods share a name but take different parameters. The compiler picks one based on the argument types.

```java
class NotificationSender {
    void send(String message) { /* default channel */ }
    void send(String message, String phone) { /* SMS */ }   // overloading
}
```

---

## 5. Composition over inheritance

**Definition:** Build behaviour by holding other objects (has-a) instead of extending a class (is-a).

Composition lets you choose and swap behaviour at runtime, and combine behaviours freely.

### The problem

```java
class Notification { }
class EmailNotification extends Notification { }
class SmsNotification extends Notification { }
class UrgentEmailNotification extends EmailNotification { }
class UrgentSmsNotification extends SmsNotification { }
// add "scheduled" and the class count doubles again
```

Every new combination of features needs a new subclass. This is called class explosion.

### Better design

```java
interface Channel {
    void deliver(String to, String message);
}

class EmailChannel implements Channel {
    public void deliver(String to, String message) { /* send email */ }
}

class SmsChannel implements Channel {
    public void deliver(String to, String message) { /* send SMS */ }
}

class Notification {
    private final Channel channel;
    private final boolean urgent;

    Notification(Channel channel, boolean urgent) {
        this.channel = channel;
        this.urgent = urgent;
    }

    public void send(String to, String message) {
        channel.deliver(to, urgent ? "[URGENT] " + message : message);
    }
}
```

Channels and options combine freely, and tests can pass in a fake `Channel`.

**Key takeaway:** Inherit interfaces, compose implementations. In LLD answers, strategies (pricing, payment, matching) are almost always composed into the class that uses them.

---

## 6. Interface vs. abstract class

**Definition:** An **interface** describes a capability a class promises to provide. An **abstract class** is a partly built class that subclasses complete.

-   A class can implement **many** interfaces but extend **only one** class.
-   An abstract class can have **fields and constructors**; an interface cannot hold instance state.
-   Interfaces can have `default` methods, but use them for small conveniences, not core logic.

### Example: Choosing each one

```java
// Capability: many unrelated classes can be payable
interface Payable {
    double amountDue();
}

// Shared state + shared logic: every piece has a colour
abstract class ChessPiece {
    protected final Color color;

    protected ChessPiece(Color color) {
        this.color = color;
    }

    public abstract boolean canMove(Square from, Square to);

    public boolean isEnemy(ChessPiece other) {
        return other != null && other.color != this.color;
    }
}
```

`Payable` is a role any class can take on. `ChessPiece` shares real state (`color`) and logic (`isEnemy`) across one family of classes.

**Key takeaway:** Default to an interface. Choose an abstract class when subclasses genuinely share state or a fixed algorithm.

---

## 7. equals and hashCode

**Definition:** `equals` decides whether two objects mean the same thing. `hashCode` must return the same number for any two objects that are equal.

`HashMap` and `HashSet` use `hashCode` first to find the bucket, then `equals` to compare. If you override one without the other, lookups break.

### Example: Only equals overridden

```java
class ParkingSpotId {
    private final int floor;
    private final int number;

    ParkingSpotId(int floor, int number) {
        this.floor = floor;
        this.number = number;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ParkingSpotId)) return false;
        ParkingSpotId other = (ParkingSpotId) o;
        return floor == other.floor && number == other.number;
    }
    // hashCode missing
}
```

Two equal ids land in different buckets, so `map.get(new ParkingSpotId(2, 17))` usually returns `null`.

### Better design

```java
record ParkingSpotId(int floor, int number) { }
```

A `record` generates correct `equals`, `hashCode` and `toString`. If you write a normal class, override both together, for example with `Objects.hash(floor, number)`.

**Key takeaway:** Equal objects must have equal hash codes. Use records for value types.

---

## 8. Immutability

**Definition:** An immutable object cannot change after it is created.

Immutable objects are thread-safe without locks, safe to share, and safe to use as map keys.

### Example: Mutable value

```java
class Money {
    public double amount;
    public String currency;
}
```

Anyone holding a reference can change the amount, even after it has been stored in a ticket or receipt.

### Better design

```java
final class Money {
    private final double amount;
    private final String currency;

    Money(double amount, String currency) {
        if (amount < 0) throw new IllegalArgumentException("Negative amount");
        this.amount = amount;
        this.currency = currency;
    }

    public Money add(Money other) {
        return new Money(this.amount + other.amount, currency);
    }

    public double getAmount() { return amount; }
}
```

The class is `final`, the fields are `final`, validation runs once in the constructor, and "changes" return a new object. For collections, return `List.copyOf(items)` rather than your internal list.

**Key takeaway:** Make value objects (money, ids, coordinates) immutable by default. Allow change only where the domain needs it.

---

## In an LLD interview

-   **Parking Lot, Vending Machine:** use polymorphism for vehicle types or product types instead of `instanceof` chains. Encapsulate state changes in methods like `spot.tryPark(vehicle)` and `machine.insertCoin(coin)`.
-   **Chess:** an abstract `Piece` with `canMove` overridden per piece is a textbook case where inheritance fits.
-   **Notification System, Rate Limiter:** compose a `Channel` or `RateLimitAlgorithm` interface into the service rather than subclassing the service.
-   **Splitwise, BookMyShow:** use immutable value objects (`Money`, `SeatId`) and records as map keys. Interviewers notice broken `equals`/`hashCode`.
-   When asked "why not inheritance here?", answer with composition's benefits: swappable at runtime, lower coupling, easier to test.

## At a glance

| Concept | Core idea | Ask yourself |
|---|---|---|
| Encapsulation | Object guards its own rules | Can a caller put this object into an invalid state? |
| Abstraction | Show what, hide how | Does the caller need to know these details? |
| Inheritance | Is-a, reuse from a parent | Can the child honour every promise of the parent? |
| Polymorphism | Same call, different behaviour | Am I switching on type? |
| Composition | Has-a, swappable parts | Would a held object be more flexible than a subclass? |
| Interface vs. abstract class | Capability vs. shared skeleton | Do subclasses share real state? |
| equals/hashCode | Equal objects, equal hash | Will this be a map key or set element? |
| Immutability | Cannot change after creation | Does anything really need to change this object? |

## Final memory aid

-   **Encapsulation:** protect
-   **Abstraction:** hide
-   **Inheritance:** is-a, only when it is truly true
-   **Polymorphism:** replace the switch
-   **Composition:** has-a, swap at runtime
-   **equals/hashCode:** always together
-   **Immutable:** by default for values

The goal is not to use every tool in every answer. Pick the one that makes the design easier to change, and say why.
