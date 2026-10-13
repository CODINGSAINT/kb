=== lld-uml | LLD | Class relationships and UML diagrams ===
A class diagram is the quickest way to show an interviewer how your classes connect: who owns whom, who just uses whom, and where the extension points are. This chapter explains the seven relationships you need, with a plain-English test, Java code and the matching UML symbol for each, then shows how to draw a clean diagram in an interview.

## Reading a class box

Every class in a UML diagram is a box with three parts: the name, the fields, and the methods.

```text
+-----------------------------+
| Ticket                      |   <- class name
+-----------------------------+
| - id: String                |   <- fields: visibility name: type
| - entryTime: Instant        |
+-----------------------------+
| + close(exitTime): Receipt  |   <- methods
+-----------------------------+
```

Visibility markers: `+` public, `-` private, `#` protected. Interfaces are marked `<<interface>>` above the name. In an interview, show only the fields and methods that explain the design. Nobody wants every getter.

---

## 1. Association

**Definition:** One class holds a reference to another, and both can exist on their own.

**Ask:** "Does A keep a reference to B, and does B live its own life without A?" If yes, it is an association.

### Example in Java

```java
class Car {
    private final String plate;
    Car(String plate) { this.plate = plate; }
}

class Driver {
    private final String name;
    private Car assignedCar;   // Driver knows its Car

    Driver(String name) { this.name = name; }

    public void assign(Car car) {
        this.assignedCar = car;
    }
}
```

The driver knows about the car, but neither owns the other. Removing the driver does not remove the car.

### UML notation

```text
+--------+ 1         0..1 +-----+
| Driver |--------------->| Car |
+--------+                +-----+
solid line; the arrow shows Driver can reach Car
```

**Key takeaway:** Association is a lasting "knows about" link between two independent objects. Prefer one-way links; add the reverse direction only if a use case needs it.

---

## 2. Aggregation

**Definition:** A whole–part association where the parts can exist without the whole, and may even belong to several wholes.

**Ask:** "Is this has-a, and can the part live alone?" If yes, it is aggregation.

### Example in Java

```java
class Player {
    private final String name;
    Player(String name) { this.name = name; }
}

class Team {
    private final List<Player> players = new ArrayList<>();

    public void addPlayer(Player player) {   // created outside, passed in
        players.add(player);
    }
}
```

If the team is disbanded, the players still exist and can join another team.

### UML notation

```text
+------+ 1         0..* +--------+
| Team |<>--------------| Player |
+------+                +--------+
hollow (empty) diamond on the whole's side
```

**Key takeaway:** Aggregation is a loose has-a. The part is created elsewhere and passed in.

---

## 3. Composition

**Definition:** A strong whole–part relationship where the whole creates and owns its parts, and the parts die with the whole.

**Ask:** "Is this has-a, and does the part make no sense without the whole?" If yes, it is composition.

### Example in Java

```java
class OrderLine {
    private final String product;
    private final int quantity;

    OrderLine(String product, int quantity) {
        this.product = product;
        this.quantity = quantity;
    }
}

class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public void addLine(String product, int quantity) {
        lines.add(new OrderLine(product, quantity));   // created inside
    }

    public List<OrderLine> getLines() {
        return List.copyOf(lines);                     // never shared for editing
    }
}
```

An order line belongs to exactly one order. Delete the order and its lines go with it.

### UML notation

```text
+-------+ 1         1..* +-----------+
| Order |<#>-------------| OrderLine |
+-------+                +-----------+
filled (solid black) diamond on the whole's side
```

**Key takeaway:** Composition means ownership. The whole creates the part inside itself and never hands it out to be shared.

### Aggregation vs. Composition

-   **Aggregation asks:** Can the part survive and be shared if the whole goes away? (`Team` and `Player`, `Library` and `Book`)
-   **Composition asks:** Is the part created, owned and destroyed by exactly one whole? (`Order` and `OrderLine`, `Board` and `Cell`)

A quick code check: if the part is passed into the constructor or an `add` method, it is usually aggregation. If the whole calls `new` for the part itself, it is usually composition.

---

## 4. Dependency

**Definition:** A class uses another only temporarily, as a method parameter, local variable or return type, without keeping a reference.

**Ask:** "Does A only touch B inside a method call?" If yes, it is a dependency.

### Example in Java

```java
class Receipt {
    private final double amount;
    Receipt(double amount) { this.amount = amount; }
    public double getAmount() { return amount; }
}

class ReceiptPrinter {
    public void print(Receipt receipt) {   // used only during the call
        System.out.println("Paid: " + receipt.getAmount());
    }
}
```

`ReceiptPrinter` has no `Receipt` field. If `Receipt` changes, the printer might need to change, but there is no lasting link.

### UML notation

```text
+----------------+          +---------+
| ReceiptPrinter |- - - - ->| Receipt |
+----------------+          +---------+
dashed line with an open arrow
```

**Key takeaway:** Dependency is the weakest relationship: "uses for a moment". It is the safest kind of coupling to have.

### Association vs. Dependency

-   **Association asks:** Does A store B in a field, so the link lasts beyond one call?
-   **Dependency asks:** Does A only receive or create B inside a method and then let it go?

In Java the test is simple: a field means association; only a parameter or local variable means dependency.

---

## 5. Inheritance (generalization)

**Definition:** A subclass is a more specific kind of its parent class. In Java this is `extends`.

**Ask:** "Is A truly a kind of B, and can A keep every promise B makes?" If yes, it is inheritance.

### Example in Java

```java
abstract class Vehicle {
    private final String plate;

    protected Vehicle(String plate) { this.plate = plate; }

    public abstract SpotSize requiredSize();
}

class Truck extends Vehicle {
    Truck(String plate) { super(plate); }

    public SpotSize requiredSize() { return SpotSize.LARGE; }
}
```

### UML notation

```text
   +---------+
   | Vehicle |   {abstract}
   +---------+
        ^
        |        solid line, hollow triangle
        |        points to the parent
   +---------+
   |  Truck  |
   +---------+
```

**Key takeaway:** Inheritance is the strongest coupling there is. Draw it only for a real is-a relationship, not to reuse a few methods.

---

## 6. Realization (implements)

**Definition:** A class promises to fulfil the contract of an interface. In Java this is `implements`.

**Ask:** "Does A provide the behaviour that interface B describes?" If yes, it is realization.

### Example in Java

```java
interface PaymentProcessor {
    void pay(double amount);
}

class CardProcessor implements PaymentProcessor {
    public void pay(double amount) {
        System.out.println("Charging card: " + amount);
    }
}

class UpiProcessor implements PaymentProcessor {
    public void pay(double amount) {
        System.out.println("Collecting via UPI: " + amount);
    }
}
```

### UML notation

```text
      +----------------------+
      |    <<interface>>     |
      |   PaymentProcessor   |
      +----------------------+
           ^            ^
           :            :      dashed line, hollow triangle
  +---------------+ +--------------+
  | CardProcessor | | UpiProcessor |
  +---------------+ +--------------+
```

**Key takeaway:** Realization is how you draw extension points. The interface with several implementations underneath is the picture of the open/closed principle.

---

## 7. Multiplicity

**Definition:** Multiplicity says how many objects can be on each end of a relationship.

**Ask:** "For one A, how many B can there be: exactly one, zero or one, or many?"

Common values:

-   `1` exactly one
-   `0..1` optional, at most one
-   `*` or `0..*` zero or more
-   `1..*` at least one
-   `0..5` a range (a business rule, such as "at most 5 books on loan")

### Example in Java

```java
class ParkingSpot {
    private Vehicle vehicle;              // 0..1: may be empty
}

class Floor {
    private final int number;             // 1: always set
    private final List<ParkingSpot> spots; // 1..*: at least one spot

    Floor(int number, List<ParkingSpot> spots) {
        if (spots.isEmpty()) throw new IllegalArgumentException("Floor needs spots");
        this.number = number;
        this.spots = List.copyOf(spots);
    }
}
```

### UML notation

```text
+------------+ 1       1..* +-------+ 1       1..* +-------------+
| ParkingLot |<#>-----------| Floor |<#>-----------| ParkingSpot |
+------------+              +-------+              +-------------+
```

**Key takeaway:** Multiplicity drives your Java types: `1` is a required `final` field, `0..1` is a nullable field (or `Optional` from a getter), and `*` is a `List`, `Set` or `Map` chosen by how you look things up.

---

## Drawing a class diagram in an interview

You have a few minutes and a whiteboard or text box. Aim for clarity, not completeness.

**Include:**

-   The 6–12 classes that carry the design (for a parking lot: `ParkingLot`, `Floor`, `ParkingSpot`, `Vehicle`, `Ticket`, `ParkingService`, and the strategy interfaces).
-   Interfaces at variation points, with two implementations shown under each.
-   Composition vs. aggregation where ownership matters.
-   Multiplicity on the important links.
-   Only the key fields and methods.

**Skip:**

-   Getters, setters, constructors and `toString`.
-   Every exception class and helper.
-   Arrows in both directions unless a use case needs them.
-   Perfect notation. A clear label like "owns" or "uses" is better than a wrong symbol.

A good order is: draw the main entities first, then connect them, then add the interfaces, then write multiplicities. Talk while you draw.

---

## In an LLD interview

-   **Parking Lot, Elevator:** composition from building to floor to spot (or to elevator car); association from ticket to vehicle; inheritance for vehicle types.
-   **BookMyShow:** `Show` aggregates `Screen` (screens outlive shows); a `Booking` is associated with seats and a user; payment is a realized interface.
-   **Splitwise:** `Group` aggregates `User` (users exist outside a group); an `Expense` composes its `Split` lines.
-   **Chess, Vending Machine:** `Board` composes `Cell`s; `Piece` uses inheritance; the machine's states can be drawn as realizations of a `State` interface.
-   **Notification System, Rate Limiter:** the key picture is one interface (`Channel`, `RateLimiter`) with several implementations underneath.

## At a glance

| Relationship | Core idea | Ask yourself |
|---|---|---|
| Association | Holds a reference, both independent | Is B stored in a field, and does B live alone? |
| Aggregation | Has-a, part can live alone | If the whole goes, does the part survive? |
| Composition | Has-a, part dies with whole | Does the whole create and own the part? |
| Dependency | Uses briefly | Is B only a parameter or local variable? |
| Inheritance | Is-a (`extends`) | Can the child keep every promise of the parent? |
| Realization | Implements a contract | Is this an interface with several implementations? |
| Multiplicity | How many on each end | One, optional, or many? |

## Final memory aid

-   **Association:** knows
-   **Aggregation:** has, can leave (hollow diamond)
-   **Composition:** owns, dies together (filled diamond)
-   **Dependency:** uses for a moment (dashed arrow)
-   **Inheritance:** is-a (solid line, hollow triangle)
-   **Realization:** implements (dashed line, hollow triangle)
-   **Multiplicity:** how many, which drives the Java type

=== lld-solid | LLD | SOLID principles with Java examples ===
SOLID is a set of five object-oriented design principles that help make software easier to maintain, extend, test, and understand. This chapter explains each principle with a violation, a better design and a key takeaway, then shows how to use SOLID to justify your decisions in an LLD interview.

## 1. S: Single Responsibility

**Definition:** A class should have only one reason to change.

This does not mean a class should have only one method. It means its methods should belong to one cohesive responsibility.

### Example: Violating SRP

```java
class Employee {
    private String name;
    private double salary;

    public double calculateAnnualSalary() {
        return salary * 12;
    }

    public void saveEmployee() {
        // Save employee to database
    }

    public void generatePayslip() {
        // Generate a PDF payslip
    }
}
```

This class mixes salary calculation, persistence, and document generation. Each can change for a different reason: HR changes pay rules, the database team changes the schema, and design changes the payslip layout.

### Better design

```java
class SalaryCalculator {
    public double calculateAnnualSalary(Employee employee) {
        return employee.getSalary() * 12;
    }
}

class EmployeeRepository {
    public void save(Employee employee) {
        // Save employee
    }
}

class PayslipGenerator {
    public void generate(Employee employee) {
        // Generate payslip
    }
}
```

Each class now changes for one reason only, and a change to the payslip cannot break salary calculation.

**Key takeaway:** Group functionality by cohesive responsibility, not by method count.

---

## 2. O: Open/Closed

**Definition:** Software entities should be open for extension but closed for modification.

In practice, this means adding a new variation of behaviour should not require repeatedly changing stable, existing code.

### Example: Violating OCP

```java
class BonusCalculator {
    public double calculateBonus(String employeeType, double salary) {
        if (employeeType.equals("PERMANENT")) {
            return salary * 0.20;
        } else if (employeeType.equals("CONTRACT")) {
            return salary * 0.10;
        }

        return 0;
    }
}
```

Adding a new employee type requires modifying `BonusCalculator` again.

### Better design: use an abstraction

```java
interface BonusPolicy {
    double calculateBonus(double salary);
}

class PermanentBonus implements BonusPolicy {
    public double calculateBonus(double salary) {
        return salary * 0.20;
    }
}

class ContractBonus implements BonusPolicy {
    public double calculateBonus(double salary) {
        return salary * 0.10;
    }
}

class InternBonus implements BonusPolicy {
    public double calculateBonus(double salary) {
        return salary * 0.05;
    }
}

class BonusCalculator {
    public double calculate(BonusPolicy policy, double salary) {
        return policy.calculateBonus(salary);
    }
}
```

A new policy can be added by implementing `BonusPolicy`; the calculator does not need a new conditional branch.

**Key takeaway:** Add new behaviour through extension points rather than repeatedly editing stable logic. Avoid adding abstractions for variations that are unlikely to exist.

---

## 3. L: Liskov Substitution

**Definition:** Objects of a subtype should be replaceable for objects of their base type without breaking the program's expected behaviour.

Inheritance must preserve the behavioural contract of the parent abstraction, not merely satisfy the compiler.

### Example: Rectangle and Square

```java
class Rectangle {
    protected int width;
    protected int height;

    public void setWidth(int width) {
        this.width = width;
    }

    public void setHeight(int height) {
        this.height = height;
    }

    public int getArea() {
        return width * height;
    }
}

class Square extends Rectangle {
    @Override
    public void setWidth(int width) {
        this.width = width;
        this.height = width;
    }

    @Override
    public void setHeight(int height) {
        this.width = height;
        this.height = height;
    }
}
```

A caller may expect width and height to be independently configurable. Set width to 4 and height to 5 and the caller expects an area of 20; with `Square`, setting the height also changes the width, and the area is 25.

### Better design

Use a shared abstraction that represents what both shapes can reliably do:

```java
interface Shape {
    int getArea();
}

class Rectangle implements Shape {
    private final int width;
    private final int height;

    Rectangle(int width, int height) {
        this.width = width;
        this.height = height;
    }

    public int getArea() {
        return width * height;
    }
}

class Square implements Shape {
    private final int side;

    Square(int side) {
        this.side = side;
    }

    public int getArea() {
        return side * side;
    }
}
```

Neither shape promises independent setters any more, so neither can break that promise.

**Key takeaway:** A subtype must honour the behaviour callers expect from its abstraction. Throwing an exception does not automatically violate LSP; it depends on whether the exception breaks the promised contract.

---

## 4. I: Interface Segregation

**Definition:** Clients should not be forced to depend on interfaces they do not use.

Avoid large interfaces that require implementations to provide irrelevant operations.

### Example: Violating ISP

```java
interface Machine {
    void print();
    void scan();
    void fax();
}

class BasicPrinter implements Machine {
    public void print() {
        System.out.println("Printing");
    }

    public void scan() {
        throw new UnsupportedOperationException();
    }

    public void fax() {
        throw new UnsupportedOperationException();
    }
}
```

A basic printer is forced to implement scanning and faxing even though it cannot support those operations.

### Better design: split the interface

```java
interface Printable {
    void print();
}

interface Scannable {
    void scan();
}

interface Faxable {
    void fax();
}

class BasicPrinter implements Printable {
    public void print() {
        System.out.println("Printing");
    }
}

class MultiFunctionPrinter implements Printable, Scannable, Faxable {
    public void print() { System.out.println("Printing"); }
    public void scan()  { System.out.println("Scanning"); }
    public void fax()   { System.out.println("Faxing"); }
}
```

Each implementation now supports only the capabilities it actually provides.

**Key takeaway:** Keep interfaces small and cohesive around the needs of their clients.

### ISP vs. LSP

-   **ISP asks:** Is a client forced to depend on methods it does not need?
-   **LSP asks:** Can an implementation replace its abstraction without breaking expected behaviour?

The same design can reveal both problems. For example, forcing a printer to implement `scan()` is an ISP issue; its `scan()` method failing can also break LSP if callers expect every `Machine` to scan.

---

## 5. D: Dependency Inversion

**Definition:**

1.  High-level modules should not depend directly on low-level modules. Both should depend on abstractions.
2.  Abstractions should not depend on details. Details should depend on abstractions.

-   **High-level module:** Business logic, such as placing an order.
-   **Low-level module:** An implementation detail, such as sending an email.
-   **Abstraction:** A contract describing the capability the business logic needs.

### Example: Violating DIP

```java
class EmailService {
    public void sendEmail(String message) {
        System.out.println("Sending email: " + message);
    }
}

class OrderService {
    private EmailService emailService = new EmailService();

    public void placeOrder() {
        // Place order
        emailService.sendEmail("Order placed!");
    }
}
```

`OrderService` directly constructs and depends on `EmailService`. Switching notification mechanisms requires changing the business class, and testing it sends real emails.

### Better design: depend on an abstraction

```java
interface Notification {
    void send(String message);
}

class EmailService implements Notification {
    public void send(String message) {
        System.out.println("Sending email: " + message);
    }
}

class SmsService implements Notification {
    public void send(String message) {
        System.out.println("Sending SMS: " + message);
    }
}

class OrderService {
    private final Notification notification;

    public OrderService(Notification notification) {
        this.notification = notification;
    }

    public void placeOrder() {
        // Place order
        notification.send("Order placed!");
    }
}
```

Usage:

```java
OrderService emailOrder = new OrderService(new EmailService());
emailOrder.placeOrder();

OrderService smsOrder = new OrderService(new SmsService());
smsOrder.placeOrder();
```

`OrderService` depends on the `Notification` contract rather than a concrete notification mechanism. A test can pass in a fake `Notification` that just records messages.

**Key takeaway:** Business logic should depend on abstractions, not directly on implementation details.

### DIP vs. Dependency Injection (DI)

-   **DIP** is a design principle about the direction of dependencies.
-   **DI** is a technique for supplying an object's dependencies, for example through the constructor.

You can apply DIP in plain Java without a framework or dependency injection container. Spring is one way to do DI; it is not required for DIP.

---

## Related principles

Interviewers often mention a few shorter principles alongside SOLID:

-   **DRY (Don't Repeat Yourself):** keep each rule in one place. Fee rules live in one `PricingStrategy`, not copied into three services.
-   **KISS (Keep It Simple):** prefer the simplest design that meets the requirements. An `enum` may be enough before a full State pattern.
-   **YAGNI (You Aren't Gonna Need It):** do not build extension points for needs nobody asked for.
-   **Law of Demeter:** talk to your direct collaborators only. Prefer `order.getShippingCity()` over `order.getCustomer().getAddress().getCity()`.

---

## In an LLD interview

-   **Do not recite definitions.** Use each principle to justify a decision in one sentence: "Pricing is a strategy, so a new rate does not modify `ParkingService` (open/closed)."
-   **Parking Lot, Vending Machine:** OCP shows up as `PricingStrategy` or `PaymentProcessor`; SRP shows up as separate classes for spot assignment, pricing and ticketing instead of one `ParkingLotManager`.
-   **Notification System, BookMyShow:** DIP shows up as the service depending on a `Channel` or `PaymentGateway` interface, so email, SMS, or a new payment provider can be swapped in.
-   **Chess, Elevator:** LSP shows up in hierarchies (`Piece`, `Elevator` types); ISP shows up as small role interfaces, such as separate `EntryGate` and `ExitGate`.
-   **Rate Limiter, Splitwise:** if asked "how would you add a new algorithm or split type?", the answer should be "a new class implementing the interface; nothing else changes".

## SOLID at a glance

| Principle | Core idea | Ask yourself |
|---|---|---|
| **S: Single Responsibility** | One cohesive responsibility per class | Does this class have multiple independent reasons to change? |
| **O: Open/Closed** | Extend behaviour without repeatedly modifying stable code | Can I add a new variation without editing the existing core logic? |
| **L: Liskov Substitution** | Subtypes preserve behavioural expectations | Can this implementation safely replace its abstraction? |
| **I: Interface Segregation** | Focused interfaces for client needs | Is a client forced to depend on methods it does not use? |
| **D: Dependency Inversion** | Depend on abstractions rather than concrete details | Does business logic depend directly on a specific implementation? |

## Final memory aid

-   **S:** Responsibility
-   **O:** Extension
-   **L:** Behaviour
-   **I:** Interfaces
-   **D:** Dependency direction

The goal is not to add interfaces and classes everywhere. Apply these principles where they make the design easier to understand, change, and test.
