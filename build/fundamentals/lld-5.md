=== lld-concurrency | LLD | Concurrency for LLD: races, locks, atomics and holds ===
Booking systems, parking lots, wallets, rate limiters, elevators and schedulers all share one interview question: **what happens when two threads hit the same resource at the same time?** This chapter teaches you to find the race, choose the cheapest correct fix in Java, avoid deadlocks, and explain how the same idea scales beyond one JVM.

## The anatomy of a race condition
A race occurs when correctness depends on the timing of threads accessing **shared mutable state**. The most common shape in LLD is **check-then-act**:
```java
// Two threads can both see the seat as free, and both book it
if (seat.isFree()) {          // check
    seat.book(userId);        // act
}
```
Another is **read-modify-write**:
```java
count++;   // read count, add 1, write back: three steps, not atomic
```
**Interview habit:** say it out loud. "There's a check-then-act race on seat status: two users could both pass the `isFree` check." That sentence earns credit before you've fixed anything.

## Thread-safety strategies, cheapest first
1. **Don't share:** confine state to one thread (an actor or a single dispatcher thread reading a queue).
2. **Don't mutate:** immutable objects (`record`, final fields) are thread-safe by construction.
3. **Use thread-safe building blocks:** `ConcurrentHashMap`, `AtomicInteger`, `BlockingQueue`.
4. **Synchronise:** locks around the critical section, with the smallest correct scope.

## Java tools in depth
### `synchronized`
```java
private final Object lock = new Object();         // private lock object; don't lock on `this`
public boolean book(SeatId id, UserId user) {
    synchronized (lock) {
        Seat s = seats.get(id);
        if (!s.isFree()) return false;
        s.bookFor(user);
        return true;
    }
}
```
- Re-entrant (the same thread can re-acquire), and it also gives **visibility** (happens-before) for changes made inside.
- Simple and safe, but one lock for everything serialises all bookings.

### `ReentrantLock`
Use it when you need **tryLock with timeout**, interruptible locking, fairness, or multiple `Condition`s.
```java
private final ReentrantLock lock = new ReentrantLock();
public boolean tryBook(SeatId id, UserId u) throws InterruptedException {
    if (!lock.tryLock(200, TimeUnit.MILLISECONDS)) return false;    // don't wait forever
    try { /* check-then-act */ return true; }
    finally { lock.unlock(); }                                        // always in finally
}
```

### Read-write locks
`ReentrantReadWriteLock` lets many readers proceed concurrently while writers are exclusive. It's good for read-heavy structures (a configuration map, a seat map that's mostly viewed). `StampedLock` adds optimistic reads for even cheaper read paths.

### Atomics and CAS
`AtomicInteger`, `AtomicLong`, `AtomicReference` and `LongAdder` update one variable atomically using **compare-and-set (CAS)** without blocking.
```java
private final AtomicInteger available = new AtomicInteger(100);
public boolean takeOne() {
    while (true) {
        int current = available.get();
        if (current == 0) return false;
        if (available.compareAndSet(current, current - 1)) return true;   // retry if another thread won
    }
}
```
`LongAdder` beats `AtomicLong` for hot counters (metrics) because it spreads contention across cells.

### `ConcurrentHashMap` atomic operations
Never do `if (!map.containsKey(k)) map.put(k, v)`, which is a race. Use the atomic methods:
```java
ConcurrentHashMap<SeatId, Hold> holds = new ConcurrentHashMap<>();
boolean claimed = holds.putIfAbsent(seatId, hold) == null;        // atomic claim
holds.compute(seatId, (k, existing) -> existing == null || existing.expired(now) ? newHold : existing);
counts.merge(userId, 1, Integer::sum);                            // atomic increment per key
```

### Blocking queues and executors
- `BlockingQueue` (`ArrayBlockingQueue`, `LinkedBlockingQueue`) implements producer–consumer: an elevator request queue, a job scheduler, a notification dispatcher.
- Use `ExecutorService` (bounded pools) or **virtual threads** (`Executors.newVirtualThreadPerTaskExecutor()`, Java 21) rather than `new Thread()`.
- `CompletableFuture` for async fan-out/fan-in (fetch prices from three providers, take the best).
- `ScheduledExecutorService` for periodic tasks (expiring holds, retry timers).

## Lock granularity: the key design decision
| Granularity | Example | Trade-off |
|---|---|---|
| Global lock | One lock for the whole theatre | Simple, but zero parallelism |
| Per aggregate | Lock per show / per floor / per account | Good default: independent things proceed in parallel |
| Per item | Lock per seat | Max parallelism, but multi-seat bookings need ordered locking |
| Lock-free | CAS on per-seat state | Fast, but complex for multi-item operations |

**Booking several seats atomically:** acquire per-seat locks in a **consistent global order** (sorted by seat ID) to avoid deadlocks, or lock the whole show for the short critical section, or use a single CAS/`compute` on a per-show structure.

## Deadlocks
A deadlock needs four conditions at once (Coffman): mutual exclusion, hold-and-wait, no preemption and circular wait. Break any one of them:
- **Lock ordering** (break circular wait): always lock accounts in ascending ID order when transferring.
```java
void transfer(Account a, Account b, long amount) {
    Account first = a.id() < b.id() ? a : b, second = first == a ? b : a;
    synchronized (first) { synchronized (second) { a.withdraw(amount); b.deposit(amount); } }
}
```
- **tryLock with timeout and back-off** (break hold-and-wait).
- **One coarser lock** for operations that touch several items.
Also know **livelock** (threads keep retrying and yielding forever; add jitter) and **starvation** (unfair locks, so consider fairness for long waits).

## Optimistic vs pessimistic concurrency
- **Pessimistic:** lock before acting (`synchronized`, `SELECT … FOR UPDATE`). Best when conflicts are frequent (hot seats in the first minute of a blockbuster's sales).
- **Optimistic:** act on a version, and commit only if nothing changed (CAS, a JPA `@Version` column, `UPDATE … WHERE version = ?`). On conflict, retry or report. Best when conflicts are rare.
```sql
UPDATE seat SET status = 'HELD', held_by = ?, held_until = ?, version = version + 1
WHERE id = ? AND status = 'FREE' AND version = ?;     -- 1 row updated = success, 0 = someone else won
```

## Temporary holds with expiry
Booking flows separate **selection** from **payment**. Locking a row during a 5-minute payment is unacceptable, so use a **hold**:
1. Atomically change the seat from FREE to HELD, with `heldBy` and `heldUntil = now + 10 min`.
2. The user pays. On success, HELD becomes BOOKED (verify the hold still belongs to this user and hasn't expired).
3. On failure or timeout, HELD becomes FREE.
4. Treat expired holds as free on read, and have a scheduled job clean them up.
This pattern appears in BookMyShow, train reservations, flash sales and cab assignment ("driver offered the ride for 15 seconds").

## Visibility, `volatile` and the memory model
Without synchronisation, a thread may never see another thread's write (CPU caches, compiler reordering).
- `volatile` guarantees **visibility and ordering** for a single variable. It does **not** make `count++` atomic.
- `synchronized`, locks, atomics and concurrent collections all establish **happens-before** edges.
- Safe publication: initialise objects fully before sharing them (final fields help).

## Patterns for concurrent LLD designs
- **Single-writer / actor:** one thread owns the elevator controller state and consumes requests from a queue. No locks are needed inside.
- **Producer–consumer:** gates produce parking events; a worker updates the display board.
- **Striped locks:** a fixed array of locks indexed by `hash(key) % N`, a middle ground between global and per-item locks.
- **Idempotent operations:** a double-clicked "Pay" button must not charge twice. Use an idempotency key per request.

## Scaling beyond one JVM (bridge to HLD)
In-memory locks only protect one process. With multiple app instances:
- **Database row locks or optimistic versions** (the most common and simplest correct answer).
- **Distributed locks** (Redis `SET key value NX PX 30000`, ZooKeeper/etcd leases) with **fencing tokens** for correctness.
- **Partition ownership:** route all requests for a show to one node (consistent hashing), then lock locally.

## Interview questions
1. **Two users try to book the last seat simultaneously. Walk me through your design.** Identify the check-then-act race; use an atomic conditional update (DB `UPDATE … WHERE status='FREE'`, or `ConcurrentHashMap.putIfAbsent` in memory); the loser gets "seat unavailable"; holds expire.
2. **`synchronized` vs `ReentrantLock`?** Same mutual exclusion and visibility. ReentrantLock adds `tryLock`, timeouts, interruptibility, fairness and multiple conditions, but you must unlock in `finally`.
3. **Is `volatile int count; count++` thread-safe?** No. It's visible but not atomic; use `AtomicInteger` or `LongAdder`.
4. **How do you avoid deadlock when transferring between accounts?** Lock ordering by account ID, or tryLock with back-off.
5. **How would your rate limiter be thread-safe?** A per-key bucket in a `ConcurrentHashMap`, updated with `compute` (atomic per key), or a per-bucket lock; avoid a global lock.

## Pitfalls
- Locking on `this` or on a public object (outside code can deadlock you).
- Holding locks while doing I/O or calling external services (payment!).
- Forgetting `unlock()` in `finally`.
- Using `Collections.synchronizedMap` and then iterating without holding its lock.
- Assuming `HashMap` is "mostly fine" under concurrency. It can corrupt itself.

## Cheat sheet
```
Find it    check-then-act / read-modify-write on shared state → say it aloud
Avoid it   confinement (single writer) · immutability
Tools      synchronized · ReentrantLock(tryLock) · RW/Stamped locks · Atomic*/LongAdder
           ConcurrentHashMap.putIfAbsent/compute/merge · BlockingQueue · executors/virtual threads
Scope      lock per aggregate (show/floor/account); ordered locks for multi-item ops
Styles     pessimistic (lock first) vs optimistic (version/CAS + retry)
Holds      FREE→HELD(until)→BOOKED/FREE; expire on read + cleanup job
Deadlock   order locks · tryLock+backoff · coarser lock
Beyond JVM DB conditional updates · distributed lock + fencing · partition ownership
```

=== lld-modelling | LLD | Modelling details interviewers notice: money, time, IDs, enums, errors ===
Small modelling choices separate a toy design from production-ready code: how you represent money, time, identity, state and errors, and how testable the result is. Each takes seconds to get right in an interview and signals real-world experience.

## Money
### Never use floating point
```java
System.out.println(0.1 + 0.2);   // 0.30000000000000004
```
Binary floating point can't represent most decimal fractions exactly. Rounding errors accumulate across thousands of transactions and break reconciliation.
### Options
| Representation | Pros | Cons |
|---|---|---|
| `long` minor units (paise, cents) | Exact, fast, simple | Must know the currency's minor-unit exponent; division needs a rounding policy |
| `BigDecimal` with an explicit scale | Exact decimals, arbitrary precision | Verbose; `equals` considers scale (`2.0` ≠ `2.00`), so use `compareTo` |

### A Money value type
```java
public record Money(long minor, Currency currency) implements Comparable<Money> {
    public Money { Objects.requireNonNull(currency); }
    public static Money of(String amount, String code) {
        Currency c = Currency.getInstance(code);
        return new Money(new BigDecimal(amount).movePointRight(c.getDefaultFractionDigits()).longValueExact(), c);
    }
    public Money plus(Money o) { requireSame(o); return new Money(Math.addExact(minor, o.minor), currency); }
    public Money minus(Money o) { requireSame(o); return new Money(Math.subtractExact(minor, o.minor), currency); }
    public Money times(long n) { return new Money(Math.multiplyExact(minor, n), currency); }
    public boolean isNegative() { return minor < 0; }
    public int compareTo(Money o) { requireSame(o); return Long.compare(minor, o.minor); }
    private void requireSame(Money o) { if (!currency.equals(o.currency)) throw new IllegalArgumentException("Currency mismatch"); }
}
```
`Math.addExact` throws on overflow instead of silently wrapping.

### Allocating without losing money
Splitting ₹100.00 three ways: 3333 + 3333 + 3333 = 9999 paise, so one paisa is lost. Allocate the remainder deterministically:
```java
static List<Money> split(Money total, int parts) {
    long base = total.minor() / parts, remainder = total.minor() % parts;
    List<Money> out = new ArrayList<>();
    for (int i = 0; i < parts; i++) out.add(new Money(base + (i < remainder ? 1 : 0), total.currency()));
    return out;   // 3334, 3333, 3333
}
```
Splitwise-style questions also need percentage splits that sum to 100%, and exact splits that sum to the total. Validate both.

### Taxes, discounts and rounding
Define **where** rounding happens (per line vs on the total) and **how** (`RoundingMode.HALF_EVEN`, also called banker's rounding, is common in finance). Write it down as a rule; interviewers like explicit policies.

## Time
### Instants vs local times
| Type | Meaning | Use for |
|---|---|---|
| `Instant` | A point on the UTC timeline | Event timestamps, entry/exit times, expiries |
| `LocalDate` / `LocalTime` / `LocalDateTime` | Calendar date/time without a zone | Birthdays, "store opens at 09:00" |
| `ZonedDateTime` | Local time plus zone rules | Scheduling a meeting at 10:00 in Asia/Kolkata |
| `Duration` / `Period` | Machine time span / calendar span | Parking duration / "1 month subscription" |

Store timestamps as `Instant` (UTC); convert to zones only at the edges (display, user input).

### Inject the clock
```java
public final class ParkingTicketService {
    private final Clock clock;
    public ParkingTicketService(Clock clock) { this.clock = clock; }
    public Ticket issue(Vehicle v, Spot s) { return new Ticket(UUID.randomUUID().toString(), v, s, clock.instant()); }
}
// test: new ParkingTicketService(Clock.fixed(Instant.parse("2026-01-01T10:00:00Z"), ZoneOffset.UTC))
```
Fines, parking fees, hold expiry and rate-limit windows all become deterministic in tests.

### Intervals and calendars
- Use **half-open intervals** `[start, end)`: meetings 10:00–11:00 and 11:00–12:00 don't overlap. The overlap test is `a.start < b.end && b.start < a.end`.
- Recurring events need zone rules: "every Monday 10:00 IST" stays 10:00 local even across DST changes in other zones.
- Daylight saving: some local times happen twice, and some never happen. `ZonedDateTime` resolves these explicitly.

## Identity: entities vs value objects
| | Entity | Value object |
|---|---|---|
| Identity | Has an ID that persists across changes | Defined entirely by its values |
| Mutability | State changes over its lifecycle | Immutable |
| Equality | By ID | By all fields |
| Examples | `Order#123`, `User`, `Ticket` | `Money`, `Address`, `TimeSlot`, `Coordinates` |

Records are ideal value objects. Entities should implement `equals`/`hashCode` on their ID only (or not override them at all), never on mutable fields, or they'll break inside `HashSet`s.

### ID generation
Generate IDs in **one place** behind an interface (`IdGenerator`): UUIDs (random, unguessable), database sequences, or time-ordered IDs (UUIDv7, Snowflake-style). Don't let callers invent IDs, and don't expose sequential IDs where guessing them is a security issue (order numbers in URLs).

## Enums and lifecycles
Use enums for **closed sets** (`SpotSize`, `PaymentStatus`, `Direction`). Give them behaviour when it belongs to the value:
```java
enum SpotSize {
    SMALL, MEDIUM, LARGE;
    boolean fits(VehicleType v) {
        return switch (v) { case BIKE -> true; case CAR -> this != SMALL; case TRUCK -> this == LARGE; };
    }
}
```
Model lifecycles explicitly, and reject illegal transitions in one place (see the State pattern chapter). Keep a **history** of transitions with timestamps when audits matter (orders, payments).

## Immutability and defensive copying
- Make classes `final` and fields `final` by default; prefer records for data.
- Return unmodifiable views or copies: `return List.copyOf(items);`
- Copy mutable inputs in constructors: `this.items = List.copyOf(items);`
- Immutable objects are thread-safe and can be cached and shared freely.

## Errors and validation
- **Validate in constructors and factories**, so invalid objects can't exist (`new Money(-5, INR)` throws).
- Use **specific domain exceptions** for rule violations: `SeatUnavailableException`, `InsufficientFundsException`, `IllegalStateTransitionException`. Include context in the message.
- For **expected outcomes** that aren't errors, return values: `Optional<Spot>` for "no free spot", or a result type (`sealed interface BookingResult permits Booked, SoldOut, HoldExpired`).
- Don't swallow exceptions; don't use exceptions for normal control flow in hot paths.

## Layering inside an LLD answer
```
controller / CLI     → parses input, calls services
service              → orchestrates use cases (BookingService), transactions, locking
domain model         → entities + value objects + rules (Show, Seat, Booking, Money)
repository interfaces→ persistence abstractions (InMemory for the interview)
infrastructure       → adapters: payment gateway, notifier, clock
```
Domain classes shouldn't import infrastructure; services depend on repository and gateway **interfaces**.

## Testability checklist
- Clock, randomness, ID generation and external gateways are injected.
- No static mutable state, and no Singletons holding data.
- Each rule (pricing, fines, matching, splitting) can be unit-tested in isolation.
- Deterministic tie-breaking (sorted collections, not `HashMap` iteration order).

## Interview questions
1. **How do you store money?** Long minor units or `BigDecimal` with a scale, in a `Money` value type with currency, explicit rounding and remainder allocation.
2. **How would you test fines that depend on the current date?** Inject a `Clock` and use `Clock.fixed` or `Clock.offset` in tests.
3. **Why shouldn't entity `equals` use mutable fields?** The hash code changes while the object sits in a `HashSet`/`HashMap`, so it can't be found again.
4. **How do you prevent invalid state transitions?** Centralise them in a transition table or State classes; the entity's methods (`ship()`, `cancel()`) enforce them.

## Cheat sheet
```
Money   long minor units or BigDecimal; Money(record) with currency; exact ops; allocate remainders
Time    Instant (UTC) stored; Zoned at edges; inject Clock; half-open intervals [start, end)
Identity entities by ID (mutable), value objects by value (immutable records)
IDs     one generator; UUID/sequence/UUIDv7; never caller-invented
Enums   closed sets, with behaviour; explicit lifecycle + history
Errors  validate in constructors; domain exceptions; Optional/sealed results for expected outcomes
Layers  service → domain → repository interfaces → infrastructure adapters
```
