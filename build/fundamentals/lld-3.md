=== lld-creational | LLD | Creational patterns: Factory, Builder, Singleton and friends ===
Creational patterns are about how objects get created: which concrete class is chosen, how a complicated object is put together, and how many instances exist. The common goal is to keep the code that uses an object from caring about the code that builds it. When creation lives in one place, adding a new variant means changing one file instead of hunting down every `new`.

## 1. Why creation needs a pattern at all

Every time you write `new CardPayment()`, the calling class becomes tied to that exact class. That is fine once. It becomes a problem when the same choice is repeated in many places and a new option (say, UPI) has to be added to all of them.

### The problem

```java
class CheckoutService {
    void pay(String method, double amount) {
        Payment payment;
        if (method.equals("CARD")) {
            payment = new CardPayment();
        } else if (method.equals("UPI")) {
            payment = new UpiPayment();
        } else {
            throw new IllegalArgumentException(method);
        }
        payment.pay(amount);
    }
}
```

If `RefundService` and `SubscriptionService` contain the same `if` chain, adding a wallet payment means editing all three. Creational patterns move that decision into one place.

**Key takeaway:** The question is not "should I avoid `new`?" but "where should the knowledge of concrete classes live?"

---

## 2. Simple Factory

**Intent:** Put the logic that picks a concrete class behind one method.

This is not one of the original Gang of Four patterns, but it is the one you will use most in interviews. A single method takes some input and returns the right implementation.

### Better design: a factory method in one place

```java
interface Vehicle { String plate(); }
record Bike(String plate) implements Vehicle {}
record Car(String plate) implements Vehicle {}
record Truck(String plate) implements Vehicle {}

final class VehicleFactory {
    private VehicleFactory() {}

    static Vehicle create(VehicleType type, String plate) {
        return switch (type) {
            case BIKE -> new Bike(plate);
            case CAR -> new Car(plate);
            case TRUCK -> new Truck(plate);
        };
    }
}
```

The `switch` still exists, but only here. Callers ask for "a vehicle of this type" and never mention `Car` or `Truck`.

### Going one step further: a registry

If you want to add new types without touching the factory at all, replace the `switch` with a map that is filled at startup.

```java
final class NotifierFactory {
    private final Map<Channel, Supplier<Notifier>> registry = new EnumMap<>(Channel.class);

    void register(Channel channel, Supplier<Notifier> supplier) {
        registry.put(channel, supplier);
    }

    Notifier create(Channel channel) {
        Supplier<Notifier> supplier = registry.get(channel);
        if (supplier == null) {
            throw new IllegalArgumentException("No notifier for " + channel);
        }
        return supplier.get();
    }
}
```

In Spring you get this almost for free: inject a `Map<String, Notifier>` and every `@Component("sms")` bean registers itself.

**When to use:** You choose one implementation out of several based on input or configuration.

**Key takeaway:** A factory decides and constructs. It should not also contain business logic.

---

## 3. Factory Method

**Intent:** Let a base class define a flow, and let subclasses decide which object that flow creates.

The base class calls an abstract "create" method in the middle of its algorithm. Each subclass overrides that method to supply its own product. It is basically the Template Method pattern applied to object creation.

### Example: without the pattern

```java
class ReportExporter {
    byte[] export(Report report, String format) {
        Writer writer = format.equals("CSV") ? new CsvWriter() : new PdfWriter();
        writer.writeHeader(report);
        writer.writeRows(report);
        return writer.bytes();
    }
}
```

The export steps are shared, but the format choice is buried inside them. Adding Excel means editing this method.

### Better design: Factory Method

```java
abstract class ReportExporter {
    final byte[] export(Report report) {
        Writer writer = createWriter();   // the factory method
        writer.writeHeader(report);
        writer.writeRows(report);
        return writer.bytes();
    }

    protected abstract Writer createWriter();
}

class CsvExporter extends ReportExporter {
    protected Writer createWriter() { return new CsvWriter(); }
}

class PdfExporter extends ReportExporter {
    protected Writer createWriter() { return new PdfWriter(); }
}
```

The steps are written once and never change. A new format is a new subclass with one small method.

**When to use:** A shared base flow needs an object whose concrete type depends on the subclass.

**Key takeaway:** Factory Method uses inheritance: the subclass decides what gets created.

---

## 4. Abstract Factory

**Intent:** Create families of related objects that must be used together, without naming their concrete classes.

Sometimes objects come in matched sets. A dark UI theme needs a dark button and a dark checkbox. An AWS deployment needs S3 storage and an SQS queue, not S3 with a Google queue.

### Example: without the pattern

```java
BlobStore store = new S3Store();
MessageQueue queue = new PubSubQueue();   // oops: GCP queue with AWS storage
```

Nothing stops the caller from mixing parts from different families.

### Better design: Abstract Factory

```java
interface CloudFactory {
    BlobStore blobStore();
    MessageQueue queue();
}

class AwsFactory implements CloudFactory {
    public BlobStore blobStore() { return new S3Store(); }
    public MessageQueue queue() { return new SqsQueue(); }
}

class GcpFactory implements CloudFactory {
    public BlobStore blobStore() { return new GcsStore(); }
    public MessageQueue queue() { return new PubSubQueue(); }
}
```

The application picks one factory at startup and gets a consistent set of parts from it.

**When to use:** You have several products that must match each other, and more than one family of them.

**Key takeaway:** Abstract Factory guarantees consistency across a family. For a single product, it is over-engineering.

### Factory Method vs. Abstract Factory

- **Factory Method:** one method, one product, chosen by a subclass. It is about letting a base flow defer one creation step.
- **Abstract Factory:** one object with several creation methods, producing a matched family. It is about consistency across related products.

A quick test: if you are overriding a single `createX()` inside a larger algorithm, it is Factory Method. If you pass around an object whose only job is to create a set of related things, it is Abstract Factory.

---

## 5. Builder

**Intent:** Construct a complex object step by step, then validate it once when it is complete.

Builder shines when an object has a few required fields and many optional ones. Instead of a constructor with ten arguments, you set what you need by name and call `build()`.

### The problem: telescoping constructors

```java
class Pizza {
    Pizza(Size size) { ... }
    Pizza(Size size, Crust crust) { ... }
    Pizza(Size size, Crust crust, List<String> toppings) { ... }
    Pizza(Size size, Crust crust, List<String> toppings, boolean extraCheese) { ... }
}

Pizza p = new Pizza(Size.LARGE, null, List.of("paneer"), true);
```

Callers must remember argument order, pass `null` for things they do not care about, and nothing checks the combination is valid.

### Better design: Builder

```java
final class Pizza {
    private final Size size;
    private final Crust crust;
    private final List<String> toppings;

    private Pizza(Builder b) {
        size = b.size; crust = b.crust; toppings = List.copyOf(b.toppings);
    }

    static Builder builder(Size size) { return new Builder(size); }

    static final class Builder {
        private final Size size;
        private Crust crust = Crust.REGULAR;
        private final List<String> toppings = new ArrayList<>();

        private Builder(Size size) { this.size = Objects.requireNonNull(size); }
        Builder crust(Crust c) { this.crust = c; return this; }
        Builder topping(String t) { toppings.add(t); return this; }

        Pizza build() {
            if (toppings.size() > 5) throw new IllegalStateException("Max 5 toppings");
            return new Pizza(this);
        }
    }
}
```

Usage reads like a sentence:

```java
Pizza p = Pizza.builder(Size.LARGE).crust(Crust.THIN).topping("paneer").topping("olive").build();
```

Required fields go in the builder's constructor, optional ones are named methods, `build()` validates, and the finished `Pizza` is immutable.

**When to use:** Many optional fields, rules that span several fields, or you want an immutable result. Common examples: search queries, notification requests, HTTP requests, orders.

**Key takeaway:** Lombok's `@Builder` generates this, but be able to write it by hand in an interview.

### Builder vs. telescoping constructors

- **Telescoping constructors:** many overloads, positional arguments, easy to swap two `String`s by mistake, no single place to validate.
- **Builder:** named steps, sensible defaults, one validation point in `build()`.

For two or three required fields, a plain constructor is still the simplest answer. Reach for Builder when the argument list starts to hurt.

### Factory vs. Builder

A factory decides **which** class to create, usually in one call. A builder controls **how** one complex object is assembled.

---

## 6. Singleton

**Intent:** Ensure a class has only one instance and provide a global way to reach it.

Singleton is legitimate for genuinely shared, mostly stateless infrastructure such as an ID generator. It is also the most misused pattern in interviews, so know both how to write it and why you might not.

### Safe implementations

```java
// 1. Enum: thread-safe, safe against serialization and reflection
enum IdGenerator {
    INSTANCE;
    private final AtomicLong next = new AtomicLong();
    long nextId() { return next.incrementAndGet(); }
}

// 2. Holder idiom: lazy and thread-safe through class loading
final class AppConfig {
    private AppConfig() {}
    private static final class Holder {
        static final AppConfig INSTANCE = new AppConfig();
    }
    static AppConfig get() { return Holder.INSTANCE; }
}
```

Double-checked locking also works, but the field must be `volatile` and it is easy to get wrong. Prefer the two above.

### Why it is often a smell

- **Hidden dependencies:** any class can call `ParkingLot.getInstance()`, so the constructor no longer tells you what a class needs.
- **Hard to test:** state leaks between tests and you cannot easily swap in a fake.
- **Shared mutable state:** every thread sees the same object.
- **Not really "one":** it is one per class loader, and certainly not one across a cluster.

### Better design: one instance, passed in

```java
class ParkingService {
    private final ParkingLot lot;

    ParkingService(ParkingLot lot) {   // injected, not looked up
        this.lot = lot;
    }
}
```

The application creates one `ParkingLot` and hands it to whoever needs it. Spring beans are singletons by default in exactly this sense, without the static access.

**When to use:** Truly one shared, stateless service and no DI container available.

**Key takeaway:** "One instance" is a wiring decision. Make it with dependency injection, not with a static `getInstance()`.

---

## 7. Prototype

**Intent:** Create new objects by copying an existing, already-configured one.

Useful when setting up an object is expensive or done at runtime, and you want many slight variations of it: document templates, notification templates, game units.

### Better design: copy and tweak

```java
record NotificationTemplate(String subject, String body, Set<Channel> channels) {

    NotificationTemplate withBody(String newBody) {
        return new NotificationTemplate(subject, newBody, channels);
    }
}

NotificationTemplate welcome = new NotificationTemplate("Welcome", "Hi!", Set.of(Channel.EMAIL));
NotificationTemplate personal = welcome.withBody("Hi Asha, welcome aboard!");
```

The base template is configured once; each copy changes only what it needs.

**When to use:** You have a configured "template" object and need many near-identical copies.

**Key takeaway:** In modern Java, use copy constructors or record "with" methods. Avoid `Cloneable`; it gives shallow copies and skips constructors.

---

## 8. Two related ideas worth mentioning

### Object Pool

Reuse expensive objects instead of creating one per use: database connections (HikariCP), threads (`ExecutorService`), buffers. A pool needs a maximum size, a timeout when it is empty, and a reset of state before an object is handed to the next user.

### Dependency injection as the creational default

A DI container (Spring, Guice) builds objects, wires their dependencies, and manages scope. In an interview, "constructor injection, wired at startup" replaces most uses of Singleton and keeps the domain easy to test.

---

## In an LLD interview

- **Parking Lot:** a `VehicleFactory` or a spot-type factory; one `ParkingLot` instance created at startup and injected, not a Singleton.
- **Notification System:** a registry-based `NotifierFactory` keyed by channel, and a Builder for `NotificationRequest` (recipient, channel, template, priority, optional attachments).
- **Payment / Wallet:** a factory that returns a `PaymentProcessor` for Card, UPI or Wallet; an Abstract Factory if each provider needs a matched gateway, refund handler and webhook verifier.
- **Coffee machine / Pizza order:** Builder for the order with many optional choices; Prototype for saved "favourite" orders.
- **Logger / ID generator:** an enum Singleton is acceptable here if there is no DI, but mention the testing trade-off.

## At a glance

| Pattern | Core idea | Use when |
|---|---|---|
| Simple Factory | One method maps input to a concrete class | You choose an implementation from input or config |
| Factory Method | Base flow calls an abstract `create`; subclass decides | A shared algorithm needs a subclass-specific object |
| Abstract Factory | One factory produces a matching family | Products must be used together consistently |
| Builder | Step-by-step assembly, validated in `build()` | Many optional fields or cross-field rules |
| Singleton | Exactly one instance | Shared stateless service; prefer DI-managed scope |
| Prototype | Copy a configured instance | Many near-identical objects from a template |

## Final memory aid

- **Simple Factory:** which class?
- **Factory Method:** which class, decided by a subclass?
- **Abstract Factory:** which family?
- **Builder:** how is it assembled?
- **Singleton:** how many? (answer with DI)
- **Prototype:** copy, then tweak.

Patterns are tools, not goals. Use a creational pattern when it removes repeated construction logic or makes invalid objects impossible, not just to add a class.

=== lld-structural | LLD | Structural patterns: Adapter, Decorator, Facade, Composite, Proxy, Bridge ===
Structural patterns are about how classes and objects are combined into bigger structures without becoming rigid. They cover wrapping an object to add behaviour, translating one interface into another, hiding a complicated subsystem behind a simple entry point, and treating a group of things like a single thing. Most clean integrations in an LLD answer use at least one of them.

## 1. Adapter

**Intent:** Make a class with an incompatible interface work with the interface your code expects.

You usually meet this with third-party SDKs or legacy code. Your domain speaks one language; the external class speaks another. An adapter sits in between and translates.

### Example: without the pattern

```java
class PaymentService {
    private final RazorpayClient client = new RazorpayClient();

    void charge(Order order) {
        Map<String, Object> params = Map.of("amount", order.totalPaise(), "currency", "INR");
        RzpPayment p = client.createPayment(params);
        if (!"captured".equals(p.status())) throw new PaymentFailedException();
    }
}
```

Vendor types and vendor quirks leak straight into business code. Switching provider means rewriting `PaymentService`.

### Better design: Adapter

```java
interface PaymentGateway {
    PaymentResult charge(Money amount, String orderId);
}

class RazorpayAdapter implements PaymentGateway {
    private final RazorpayClient client;

    RazorpayAdapter(RazorpayClient client) { this.client = client; }

    public PaymentResult charge(Money amount, String orderId) {
        RzpPayment p = client.createPayment(Map.of(
                "amount", amount.minorUnits(),
                "currency", amount.currencyCode(),
                "receipt", orderId));
        return new PaymentResult(p.id(), "captured".equals(p.status()));
    }
}
```

Business code depends only on `PaymentGateway`. A `StripeAdapter` or a fake for tests can be swapped in without touching it.

**When to use:** An external or legacy class does what you need but has the wrong shape.

**Key takeaway:** Don't let adaptee types (SDK DTOs, SDK exceptions) leak through the adapter. Prefer composition (object adapter) over inheritance (class adapter).

---

## 2. Decorator

**Intent:** Add responsibilities to an object at runtime by wrapping it in another object with the same interface.

Each decorator holds a reference to the object it wraps, delegates to it, and adds a little behaviour before or after. Because they share an interface, decorators can be stacked in any combination.

### Example: without the pattern

```java
class Espresso { }
class EspressoWithMilk extends Espresso { }
class EspressoWithCaramel extends Espresso { }
class EspressoWithMilkAndCaramel extends Espresso { }
// ... one class for every combination
```

With n add-ons you get up to 2^n subclasses. That does not scale.

### Better design: Decorator

```java
interface Beverage {
    String description();
    int cost();
}

class Espresso implements Beverage {
    public String description() { return "Espresso"; }
    public int cost() { return 120; }
}

class Milk implements Beverage {
    private final Beverage inner;
    Milk(Beverage inner) { this.inner = inner; }
    public String description() { return inner.description() + ", milk"; }
    public int cost() { return inner.cost() + 30; }
}

class Caramel implements Beverage {
    private final Beverage inner;
    Caramel(Beverage inner) { this.inner = inner; }
    public String description() { return inner.description() + ", caramel"; }
    public int cost() { return inner.cost() + 40; }
}

Beverage order = new Caramel(new Milk(new Espresso()));   // 190, "Espresso, milk, caramel"
```

n add-ons need only n classes, and any combination is built at runtime.

### Decorators for cross-cutting behaviour

The same idea works for service concerns like retries, logging and metrics:

```java
class RetryingNotifier implements Notifier {
    private final Notifier inner;
    private final int maxAttempts;

    RetryingNotifier(Notifier inner, int maxAttempts) {
        this.inner = inner;
        this.maxAttempts = maxAttempts;
    }

    public void send(Message m) {
        for (int attempt = 1; ; attempt++) {
            try { inner.send(m); return; }
            catch (TransientFailure e) { if (attempt == maxAttempts) throw e; }
        }
    }
}

Notifier notifier = new LoggingNotifier(new RetryingNotifier(new SmsNotifier(), 3));
```

Java I/O is the textbook example: `new BufferedReader(new InputStreamReader(in))`.

**When to use:** Optional features that combine freely, or cross-cutting behaviour around an interface you don't want to edit.

**Key takeaway:** Order matters. Logging outside the retry logs one send; logging inside logs every attempt.

---

## 3. Facade

**Intent:** Provide one simple entry point to a complex subsystem.

When a client has to call five services in the right order to get one job done, that orchestration ends up copied everywhere. A facade owns the sequence.

### Example: without the pattern

Every controller that places an order has to reserve stock, compute price, charge payment, release stock on failure, save the order, and send a confirmation, in that order. Forget one step in one place and you have a bug.

### Better design: Facade

```java
class CheckoutFacade {
    private final InventoryService inventory;
    private final PricingService pricing;
    private final PaymentGateway payments;
    private final OrderRepository orders;
    private final NotificationService notifications;

    // constructor omitted

    Order placeOrder(Cart cart) {
        inventory.reserve(cart.items());
        Money total = pricing.total(cart);
        PaymentResult result = payments.charge(total, cart.id());
        if (!result.success()) {
            inventory.release(cart.items());
            throw new PaymentFailedException();
        }
        Order order = orders.save(Order.confirmed(cart, total));
        notifications.orderConfirmed(order);
        return order;
    }
}
```

Clients call `placeOrder(cart)` and nothing else. The subsystems stay available for anyone who needs finer control.

**When to use:** Clients repeatedly coordinate several subsystem classes to do one logical task.

**Key takeaway:** A facade coordinates; it should not absorb business rules, or it turns into a god class. At system level, an API gateway or BFF plays the same role.

---

## 4. Composite

**Intent:** Treat individual objects and groups of objects the same way, using a tree.

Leaves and containers implement the same interface. A container's operation simply delegates to its children, so the caller never has to ask "is this one item or many?"

### Example: without the pattern

```java
long totalSize(Object node) {
    if (node instanceof File f) return f.size();
    if (node instanceof Folder d) {
        long sum = 0;
        for (Object child : d.children()) sum += totalSize(child);
        return sum;
    }
    throw new IllegalArgumentException();
}
```

Every operation needs its own `instanceof` checks, repeated across the codebase.

### Better design: Composite

```java
interface FileSystemNode {
    String name();
    long size();
}

record FileNode(String name, long size) implements FileSystemNode {}

class Directory implements FileSystemNode {
    private final String name;
    private final List<FileSystemNode> children = new ArrayList<>();

    Directory(String name) { this.name = name; }

    void add(FileSystemNode node) { children.add(node); }

    public String name() { return name; }

    public long size() {
        return children.stream().mapToLong(FileSystemNode::size).sum();
    }
}
```

`size()` works the same whether you call it on a file or a whole folder tree.

**When to use:** Part-whole hierarchies: file systems, menus and submenus, org charts, product bundles priced like single items, groups containing users and other groups.

**Key takeaway:** Put child-management methods like `add` only on the container. A file should not have an `add` method that throws.

---

## 5. Proxy

**Intent:** Provide a stand-in object with the same interface that controls access to the real one.

The proxy decides when, whether, or how the real object is called. Common kinds: virtual (lazy creation), protection (permission checks), remote (hide a network call), and caching.

### Example: without the pattern

Every caller of `ExchangeRateProvider` adds its own "did I fetch this recently?" check, or worse, hits the remote API on every request.

### Better design: caching Proxy

```java
class CachingRateProvider implements ExchangeRateProvider {
    private final ExchangeRateProvider real;
    private final Map<String, Rate> cache = new ConcurrentHashMap<>();
    private final Map<String, Instant> fetchedAt = new ConcurrentHashMap<>();

    CachingRateProvider(ExchangeRateProvider real) { this.real = real; }

    public Rate rate(String from, String to) {
        String key = from + "-" + to;
        Instant last = fetchedAt.getOrDefault(key, Instant.EPOCH);
        if (Duration.between(last, Instant.now()).toSeconds() > 60) {
            cache.put(key, real.rate(from, to));
            fetchedAt.put(key, Instant.now());
        }
        return cache.get(key);
    }
}
```

Callers still see an `ExchangeRateProvider`; they don't know or care that results are cached.

A protection proxy looks the same, except it checks a role before delegating to, say, `deleteAccount()`.

**When to use:** You need laziness, access control, caching, or a local stand-in for a remote object.

**Key takeaway:** Spring's `@Transactional`, `@Cacheable` and `@Async` are proxies. That is why calling such a method from inside the same class (`this.method()`) skips the behaviour.

---

## 6. Bridge

**Intent:** Split two independent dimensions of variation into two hierarchies and connect them by composition.

When a class varies in two ways at once, inheritance multiplies them. Bridge keeps each dimension in its own hierarchy.

### Example: without the pattern

```java
class EmailAlert { }
class SmsAlert { }
class PushAlert { }
class EmailReminder { }
class SmsReminder { }
class PushReminder { }
// adding WhatsApp means three more classes
```

Three message kinds times three channels is nine classes, and it grows with every addition.

### Better design: Bridge

```java
interface Channel {                          // how it is delivered
    void deliver(String to, String text);
}

abstract class Notification {                // what is being sent
    protected final Channel channel;
    Notification(Channel channel) { this.channel = channel; }
    abstract void send(User user);
}

class Reminder extends Notification {
    Reminder(Channel channel) { super(channel); }
    void send(User user) {
        channel.deliver(user.contact(), "Reminder: " + user.nextEvent());
    }
}

new Reminder(new SmsChannel()).send(user);
```

M message kinds and N channels now need M + N classes instead of M times N.

**When to use:** Two axes of change that should vary independently.

**Key takeaway:** If your class names look like a grid (`EmailAlert`, `SmsAlert`, `EmailReminder`...), you probably want a Bridge.

---

## 7. Decorator vs. Proxy vs. Adapter

All three wrap another object, so they look alike in code. The difference is intent.

- **Adapter** changes the interface. The wrapped object has the wrong shape; the adapter makes it fit yours.
- **Decorator** keeps the same interface and adds behaviour. It is usually stacked by the client, and several can be combined.
- **Proxy** keeps the same interface and controls access. There is usually one, and it is often created by a framework.

A quick test: if the interface changes, it is an Adapter. If the interface stays the same, ask whether you are adding features (Decorator) or guarding the real object (Proxy).

### Adapter vs. Facade

An adapter makes one existing class match an expected interface. A facade invents a new, simpler interface over a whole subsystem.

### A pattern to recognise: Flyweight

Flyweight shares immutable state across many objects to save memory, such as chess piece types shared by every board or glyphs in a text editor. Java's `Integer.valueOf` cache is one. You rarely build it in an LLD round, but you should recognise it.

---

## In an LLD interview

- **Payment / Wallet:** an Adapter per payment provider behind a `PaymentGateway` interface; a Facade for checkout orchestration.
- **Notification System:** Bridge to separate message type from channel; Decorators for retry, logging and rate limiting around `Notifier`.
- **Coffee machine / Pizza order:** Decorator for add-ons and their prices.
- **File system / Menu:** Composite so files and folders (or items and submenus) share `size()` or `price()`.
- **Logger / Rate limiter / Cache:** Proxy for caching or access control in front of a slow or sensitive service; Decorator to add logging without changing the core class.

## At a glance

| Pattern | Core idea | Ask yourself |
|---|---|---|
| Adapter | Translate a foreign interface to yours | Does this class do the job but have the wrong shape? |
| Decorator | Same interface, wrap and add behaviour | Do I need optional features in any combination? |
| Facade | One simple entry over a complex subsystem | Are clients repeating the same multi-step orchestration? |
| Composite | Leaves and containers share an interface | Do I need to treat one item and a group the same way? |
| Proxy | Same interface, control access to the real object | Do I need laziness, caching, permissions or a remote stand-in? |
| Bridge | Separate two axes of variation | Are my class names forming a grid? |

## Final memory aid

- **Adapter:** fit
- **Decorator:** add
- **Facade:** simplify
- **Composite:** tree
- **Proxy:** guard
- **Bridge:** split

Structural patterns are about composition over inheritance. Use them when wrapping or combining objects keeps the design smaller and easier to change, not to add layers for their own sake.
