=== lld-creational | LLD | Creational patterns: Factory, Builder, Singleton and friends ===
Creational patterns decide **how objects come into existence**: which concrete class gets instantiated, how a complex object is assembled, and how many instances exist. Used well, they keep callers ignorant of concrete types, which is what makes the rest of the design extensible.

## Why creation needs a pattern at all
`new ConcreteClass()` hard-codes a dependency on that class. Every call site that writes `new CardProcessor()` has to change when you add UPI. Creational patterns concentrate that knowledge in **one place**, so adding a variant touches one file.

## Simple Factory (static factory)
Not a Gang-of-Four pattern, but the most common one in interviews: a method that maps input to a concrete type.
```java
public final class VehicleFactory {
    private VehicleFactory() {}
    public static Vehicle create(VehicleType type, String plate) {
        return switch (type) {
            case BIKE -> new Bike(plate);
            case CAR -> new Car(plate);
            case TRUCK -> new Truck(plate);
            case EV -> new ElectricCar(plate);
        };
    }
}
```
The `switch` still exists, but **only here**. A further step is a **registry** that removes the switch entirely:
```java
public final class NotifierFactory {
    private final Map<Channel, Supplier<Notifier>> registry = new EnumMap<>(Channel.class);
    public void register(Channel c, Supplier<Notifier> s) { registry.put(c, s); }
    public Notifier create(Channel c) {
        Supplier<Notifier> s = registry.get(c);
        if (s == null) throw new IllegalArgumentException("No notifier for " + c);
        return s.get();
    }
}
```
In Spring you get this almost for free: inject `Map<String, Notifier>` and every `@Component("sms")` bean registers itself.

## Factory Method (GoF)
A superclass defines an operation that **calls an abstract creation method**; subclasses decide which product to create. It's useful when a framework or base flow needs objects whose concrete type is decided by subclasses.
```java
abstract class ReportExporter {
    public final byte[] export(Report r) { Writer w = createWriter(); w.writeHeader(r); w.writeRows(r); return w.bytes(); }
    protected abstract Writer createWriter();               // factory method
}
final class CsvExporter extends ReportExporter { protected Writer createWriter() { return new CsvWriter(); } }
final class PdfExporter extends ReportExporter { protected Writer createWriter() { return new PdfWriter(); } }
```
Factory Method is Template Method applied to creation.

## Abstract Factory
Creates **families** of related objects that must be used together, without naming their classes. Examples: a UI toolkit (Light vs Dark: `Button`, `Checkbox`, `Dialog`), or cloud providers (AWS vs GCP: `BlobStore`, `Queue`, `SecretStore`).
```java
interface CloudFactory { BlobStore blobStore(); MessageQueue queue(); }
final class AwsFactory implements CloudFactory { public BlobStore blobStore() { return new S3Store(); } public MessageQueue queue() { return new SqsQueue(); } }
final class GcpFactory implements CloudFactory { public BlobStore blobStore() { return new GcsStore(); } public MessageQueue queue() { return new PubSubQueue(); } }
```
The guarantee is **consistency**: you can't accidentally pair an S3 store with a GCP queue. It's less common in LLD rounds; recognise it and mention it when a design has matched sets of components.

## Builder
Constructs complex objects step by step, especially when there are **many optional parameters** or invariants that should be checked once the object is complete. It avoids "telescoping constructors" (`new Pizza(size, crust, null, null, true, false, …)`).
```java
public final class Pizza {
    private final Size size; private final Crust crust; private final List<String> toppings; private final boolean extraCheese;
    private Pizza(Builder b) { size = b.size; crust = b.crust; toppings = List.copyOf(b.toppings); extraCheese = b.extraCheese; }
    public static Builder builder(Size size) { return new Builder(size); }

    public static final class Builder {
        private final Size size; private Crust crust = Crust.REGULAR; private final List<String> toppings = new ArrayList<>(); private boolean extraCheese;
        private Builder(Size size) { this.size = Objects.requireNonNull(size); }
        public Builder crust(Crust c) { this.crust = c; return this; }
        public Builder topping(String t) { toppings.add(t); return this; }
        public Builder extraCheese() { this.extraCheese = true; return this; }
        public Pizza build() {
            if (toppings.size() > 5) throw new IllegalStateException("max 5 toppings");
            return new Pizza(this);
        }
    }
}
Pizza p = Pizza.builder(Size.LARGE).crust(Crust.THIN).topping("paneer").topping("olive").extraCheese().build();
```
Properties: the result is **immutable**, required parameters go in the builder's constructor, and `build()` validates. Lombok's `@Builder` generates this; know the hand-written version for interviews. Use Builder for search queries, notification requests, HTTP requests and order creation with many optional fields.

## Singleton
Ensures **one instance** and provides a global access point. It's legitimate for stateless shared infrastructure (an ID generator, a configuration snapshot), and the **most misused pattern in interviews**.

Implementations, from best to worst:
```java
// 1. Enum singleton: thread-safe, serialisation-safe, reflection-safe
public enum IdGenerator {
    INSTANCE;
    private final AtomicLong next = new AtomicLong();
    public long nextId() { return next.incrementAndGet(); }
}

// 2. Initialisation-on-demand holder: lazy and thread-safe via class loading
public final class Config {
    private Config() {}
    private static final class Holder { static final Config INSTANCE = new Config(); }
    public static Config get() { return Holder.INSTANCE; }
}

// 3. Double-checked locking: needs volatile, easy to get wrong
public final class Registry {
    private static volatile Registry instance;
    public static Registry get() {
        Registry r = instance;
        if (r == null) { synchronized (Registry.class) { r = instance; if (r == null) instance = r = new Registry(); } }
        return r;
    }
}
```
Why interviewers distrust Singletons:
- **Hidden global state:** any code can reach it, so dependencies aren't visible in constructors.
- **Testing pain:** state leaks between tests, and it's hard to substitute a fake.
- **Concurrency:** a mutable singleton is shared by every thread.
- **Not really one:** it's one per classloader, and not one across a cluster.

The better answer: "the application creates one `ParkingLot` and injects it where needed". Spring beans are singletons by scope without the static access problem.

## Prototype
Create new objects by **copying** a configured instance, useful when construction is expensive or objects are configured at runtime (document templates, game units, pre-configured requests).
```java
record NotificationTemplate(String subject, String body, Set<Channel> channels) {
    NotificationTemplate withBody(String newBody) { return new NotificationTemplate(subject, newBody, channels); }
}
```
In modern Java, prefer copy constructors or record "withers" over `Cloneable`, which is widely considered broken (shallow copies, checked exceptions, no constructor call).

## Object Pool
Reuse expensive objects instead of creating them per use: database connections (HikariCP), threads (`ExecutorService`), buffers. Pools need a maximum size, timeouts when exhausted, validation of returned objects, and reset of state between users. Mention it whenever an LLD involves costly resources (printers, elevator cars as a pool of workers, connection handling).

## Dependency injection as a creational strategy
DI containers (Spring, Guice) centralise object creation for the whole application: they build objects, resolve dependencies and manage scope (singleton, prototype, request). In an interview, saying "constructor injection, wired by the application/DI container" replaces most Singleton and Service Locator usage and keeps the domain testable.

## Choosing a creational approach
| Situation | Use |
|---|---|
| Pick an implementation based on input or config | Simple Factory / registry |
| Base class flow needs subclass-specific products | Factory Method |
| Families of objects that must match | Abstract Factory |
| Many optional fields, validation, immutability | Builder |
| Exactly one shared stateless service | DI-managed single instance (enum Singleton if no DI) |
| Expensive-to-create, reusable resources | Object Pool |
| Copy and tweak a configured template | Prototype (copy constructor or record) |

## Interview questions
1. **Factory vs Builder?** A factory decides *which* class to create, usually in one call. A builder controls *how* one complex object is assembled, step by step.
2. **How do you make a Singleton thread-safe?** Use an enum or the holder idiom. With double-checked locking, the field must be `volatile`.
3. **Why might a Singleton be a bad idea for `ParkingLot`?** Hidden global state, hard testing, and it assumes one lot forever. Multi-lot support then needs a rewrite.
4. **Where does the factory get new types from without editing it?** A registry populated at startup: DI collections, `ServiceLoader`, or explicit `register` calls.

## Pitfalls
- A factory that also contains business logic (it should only decide and construct).
- Builders that allow building invalid objects (validate in `build()`).
- Singletons holding per-user or per-request state.
- Abstract Factory introduced for a single product family. That's over-engineering.

## Cheat sheet
```
Simple Factory  input → concrete class (one switch, or a registry map)
Factory Method  base flow calls abstract create(); subclasses choose
Abstract Factory families that must match (AWS vs GCP set)
Builder         many optional params → validated, immutable object
Singleton       enum/holder; prefer DI-managed single instance
Prototype       copy a configured instance (copy ctor / record withers)
Object Pool     reuse expensive resources with bounds and timeouts
```

=== lld-structural | LLD | Structural patterns: Adapter, Decorator, Facade, Composite, Proxy, Bridge ===
Structural patterns describe how classes and objects are **composed into larger structures** while keeping them flexible: wrapping objects to add behaviour, translating interfaces, hiding complexity, or treating groups like individuals. They're the backbone of clean integrations in LLD answers.

## Adapter
**Problem:** you have a class whose interface doesn't match what your code expects, typically a third-party SDK or legacy component.
**Solution:** a wrapper that implements your interface and translates calls to the adaptee.
```java
// Your domain interface
public interface PaymentGateway { PaymentResult charge(Money amount, Card card, String idempotencyKey); }

// Third-party SDK with a different shape
final class RazorpayClient { RzpPayment createPayment(Map<String, Object> params) { /* … */ return null; } }

final class RazorpayAdapter implements PaymentGateway {
    private final RazorpayClient client;
    RazorpayAdapter(RazorpayClient client) { this.client = client; }
    @Override public PaymentResult charge(Money amount, Card card, String key) {
        RzpPayment p = client.createPayment(Map.of("amount", amount.minor(), "currency", amount.currency().getCurrencyCode(),
                                                   "token", card.token(), "receipt", key));
        return new PaymentResult(p.id(), "captured".equals(p.status()) ? Status.SUCCESS : Status.FAILED);
    }
}
```
Benefits: vendor types never leak into the domain, providers can be switched, and tests can use a fake gateway. Adapters are also how you integrate legacy code (`LegacyInventoryAdapter`).
**Object adapter** (composition, shown above) is preferred over **class adapter** (inheritance), which Java supports poorly anyway.

## Decorator
**Problem:** you need to add responsibilities to individual objects dynamically, in combinations, without a subclass for every combination.
**Solution:** wrappers that implement the same interface and delegate to the wrapped object, adding behaviour before or after.
```java
interface Beverage { String description(); Money cost(); }
final class Espresso implements Beverage { public String description() { return "Espresso"; } public Money cost() { return Money.rupees(120); } }

abstract class AddOn implements Beverage {
    protected final Beverage inner;
    AddOn(Beverage inner) { this.inner = inner; }
}
final class Milk extends AddOn {
    Milk(Beverage b) { super(b); }
    public String description() { return inner.description() + ", milk"; }
    public Money cost() { return inner.cost().plus(Money.rupees(30)); }
}
final class Caramel extends AddOn {
    Caramel(Beverage b) { super(b); }
    public String description() { return inner.description() + ", caramel"; }
    public Money cost() { return inner.cost().plus(Money.rupees(40)); }
}
Beverage order = new Caramel(new Milk(new Espresso()));   // ₹190, "Espresso, milk, caramel"
```
Decorators shine for **cross-cutting behaviour** around a service interface:
```java
final class RetryingNotifier implements Notifier {
    private final Notifier inner; private final int maxAttempts;
    RetryingNotifier(Notifier inner, int maxAttempts) { this.inner = inner; this.maxAttempts = maxAttempts; }
    public void send(Message m) {
        for (int attempt = 1; ; attempt++) {
            try { inner.send(m); return; }
            catch (TransientFailure e) { if (attempt == maxAttempts) throw e; sleepBackoff(attempt); }
        }
    }
}
Notifier n = new MetricsNotifier(new RetryingNotifier(new SmsNotifier(gateway), 3));
```
Java's I/O streams are the textbook example (`new BufferedReader(new InputStreamReader(in))`).
**Watch out:** order matters (metrics outside retry counts one logical send; inside, it counts every attempt), and deep stacks can obscure identity and equality.

## Facade
**Problem:** clients must orchestrate many subsystem classes in the right order.
**Solution:** one simplified entry point that coordinates the subsystem.
```java
public final class CheckoutFacade {
    private final InventoryService inventory; private final PricingEngine pricing;
    private final PaymentGateway payments; private final OrderRepository orders; private final NotificationService notifications;
    public Order placeOrder(Cart cart, PaymentMethod method) {
        inventory.reserve(cart.items());
        Money total = pricing.total(cart);
        PaymentResult result = payments.charge(total, method, cart.id());
        if (!result.ok()) { inventory.release(cart.items()); throw new PaymentFailedException(result); }
        Order order = orders.save(Order.confirmed(cart, total, result.id()));
        notifications.orderConfirmed(order);
        return order;
    }
}
```
A facade simplifies use; it doesn't prevent direct access to subsystems when needed. The risk is that it gradually absorbs business rules and becomes a god object. Keep rules in the subsystems and use the facade for coordination. In service architectures, an **API gateway** or **BFF** is a facade at the system level.

## Composite
**Problem:** you need to treat individual objects and groups of objects uniformly in a tree.
**Solution:** a common interface implemented by both leaves and containers; containers delegate to their children.
```java
interface FileSystemNode { String name(); long size(); }
record FileNode(String name, long size) implements FileSystemNode {}
final class Directory implements FileSystemNode {
    private final String name; private final List<FileSystemNode> children = new ArrayList<>();
    Directory(String name) { this.name = name; }
    void add(FileSystemNode n) { children.add(n); }
    public String name() { return name; }
    public long size() { return children.stream().mapToLong(FileSystemNode::size).sum(); }
}
```
Typical uses: file systems, menus and submenus, org charts, UI component trees, **product bundles priced like single items**, and permission groups containing users and other groups.

## Proxy
**Problem:** you need to control access to an object: delay its creation, check permissions, add caching, or represent a remote object.
**Solution:** an object with the same interface that stands in for the real one.
| Kind | Purpose | Example |
|---|---|---|
| Virtual | Lazy creation of expensive objects | Load a high-resolution image only when displayed |
| Protection | Access control | Check the caller's role before `deleteAccount()` |
| Remote | Hide network calls | gRPC/REST client stubs |
| Caching | Reuse results | Cache exchange rates for 60 seconds |
| Smart reference | Bookkeeping | Reference counting, audit logging |

```java
final class CachingRateProvider implements ExchangeRateProvider {
    private final ExchangeRateProvider real; private final Clock clock;
    private volatile Rate cached; private volatile Instant fetchedAt = Instant.EPOCH;
    public Rate rate(Currency from, Currency to) {
        if (Duration.between(fetchedAt, clock.instant()).toSeconds() > 60) { cached = real.rate(from, to); fetchedAt = clock.instant(); }
        return cached;
    }
}
```
(That example caches one pair only. A real one keys by currency pair; the shape is what matters.)
Spring's `@Transactional`, `@Cacheable` and `@Async` work through generated proxies, which is why calling such a method from inside the same class bypasses the behaviour.
**Proxy vs Decorator:** the structure is identical. Proxy is about **controlling access** to one subject and is often created by the framework; Decorator is about **adding features** and is usually stacked by the client.

## Bridge
**Problem:** two independent dimensions of variation would produce a class explosion (`EmailAlert`, `SmsAlert`, `EmailReminder`, `SmsReminder`…).
**Solution:** separate the abstraction hierarchy from the implementation hierarchy and connect them by composition.
```java
interface Channel { void deliver(String to, String text); }          // implementation side: Email, SMS, Push
abstract class Notification {                                       // abstraction side: Alert, Reminder, Digest
    protected final Channel channel;
    Notification(Channel channel) { this.channel = channel; }
    abstract void send(User u);
}
final class Reminder extends Notification {
    Reminder(Channel c) { super(c); }
    void send(User u) { channel.deliver(u.contact(), "Reminder: " + u.nextEvent()); }
}
```
M kinds × N channels become M + N classes.

## Flyweight (recognise it)
Share immutable intrinsic state across many objects to save memory: chess piece *types* shared across boards, glyphs in a text editor, map tile images. Java's `Integer.valueOf` cache and string interning are flyweights.

## Choosing a structural pattern
| Symptom | Pattern |
|---|---|
| External API shape doesn't fit your interface | Adapter |
| Optional add-ons in combinations, or cross-cutting wrappers | Decorator |
| Clients orchestrate many subsystem calls | Facade |
| Part–whole hierarchies treated uniformly | Composite |
| Need laziness, access checks, caching or remote stand-ins | Proxy |
| Two independent axes of variation | Bridge |
| Huge numbers of similar objects | Flyweight |

## Interview questions
1. **Decorator vs inheritance for coffee add-ons?** Inheritance needs a class per combination (2ⁿ classes for n add-ons); decorators combine at runtime with n classes.
2. **Adapter vs Facade?** An adapter changes an interface to match an expected one (usually one class). A facade simplifies a whole subsystem behind a new interface.
3. **Why does `@Transactional` not work on a self-call?** The behaviour lives in a proxy; calling `this.method()` bypasses the proxy.
4. **How would you add retries and logging to a notifier without modifying it?** Decorators around the `Notifier` interface, composed at wiring time.

## Pitfalls
- Leaking adaptee types (SDK exceptions, DTOs) through an adapter.
- Facades that accumulate business logic.
- Decorator stacks with order-dependent bugs (caching outside vs inside authorization).
- Composite operations that don't make sense for leaves (adding a child to a file). Put `add` only on the container type.

## Cheat sheet
```
Adapter    translate a foreign interface to yours (vendor SDKs, legacy)
Decorator  same interface, wraps and adds behaviour; stackable at runtime
Facade     one simple entry over a complex subsystem (coordination only)
Composite  tree of leaves/containers with a uniform interface
Proxy      stand-in controlling access: lazy, protection, remote, caching
Bridge     split two axes of variation; compose instead of M×N classes
Flyweight  share immutable state across many objects
```
