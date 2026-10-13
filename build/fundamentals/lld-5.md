=== lld-concurrency | LLD | Concurrency for LLD: races, locks, atomics and holds ===
Almost every LLD problem has one moment where two users reach for the same thing at the same time: the last seat, the last parking spot, the same wallet balance. This chapter shows how to spot that moment, which Java tool fixes it most simply, and how to explain the choice in plain words. Each idea comes with a small "what goes wrong" example and a better version.

## 1. Race conditions and check-then-act

**Definition:** A race condition happens when the result depends on which thread runs first while they share mutable state.

The most common shape in LLD is **check-then-act**: you check a condition, then act on it, but another thread changes things in between. The second common shape is **read-modify-write**, such as `count++`, which is really three steps: read, add, write.

### Example: the problem

```java
class SeatInventory {
    private final Map<String, String> bookedBy = new HashMap<>();

    public boolean book(String seatId, String userId) {
        if (!bookedBy.containsKey(seatId)) {   // check
            bookedBy.put(seatId, userId);      // act
            return true;
        }
        return false;
    }
}
```

Two users click seat A7 at the same moment. Both see "not booked", both call `put`, and both get `true`. One of them will turn up at the cinema without a seat.

### Better design

```java
class SeatInventory {
    private final ConcurrentHashMap<String, String> bookedBy = new ConcurrentHashMap<>();

    public boolean book(String seatId, String userId) {
        // check and act happen as ONE atomic step
        return bookedBy.putIfAbsent(seatId, userId) == null;
    }
}
```

`putIfAbsent` does the check and the write together, so only one caller can win. The loser gets `false` and can show "seat unavailable".

**Key takeaway:** Say the race out loud in the interview ("two users can both pass the free check") before fixing it. Naming it earns credit on its own.

---

## 2. synchronized

**Definition:** `synchronized` lets only one thread at a time run a block of code guarded by the same lock object.

It also makes changes made inside the block visible to the next thread that takes the same lock. It is the simplest correct tool, and the right default when the critical section is small.

### Example: the problem

```java
class Wallet {
    private long balancePaise;

    public boolean debit(long amountPaise) {
        if (balancePaise >= amountPaise) {      // check
            balancePaise -= amountPaise;        // read-modify-write
            return true;
        }
        return false;
    }
}
```

Two payments of 600 paise against a balance of 1000 can both pass the check, leaving the balance at -200.

### Better design

```java
class Wallet {
    private final Object lock = new Object();   // private, so no outside code can grab it
    private long balancePaise;

    public boolean debit(long amountPaise) {
        synchronized (lock) {
            if (balancePaise < amountPaise) return false;
            balancePaise -= amountPaise;
            return true;
        }
    }

    public long balance() {
        synchronized (lock) {                   // reads need the lock too, for visibility
            return balancePaise;
        }
    }
}
```

The check and the update now happen as one unit. Locking on a private object, rather than `this`, stops other code from accidentally holding your lock.

**Key takeaway:** Lock the smallest block that keeps the rule true, and lock per aggregate (one wallet, one show, one floor), not one global lock for everything.

---

## 3. ReentrantLock and tryLock with timeout

**Definition:** `ReentrantLock` is an explicit lock object that gives the same safety as `synchronized`, plus extra controls such as `tryLock` with a timeout.

The most useful extra in LLD is "don't wait forever". If a lock is busy, a caller can give up and try something else.

### Example: the problem

```java
class ParkingFloor {
    private final Deque<String> freeSpots = new ArrayDeque<>();

    public synchronized String allocate() {
        // if another gate holds this floor's lock for a long time,
        // every car at every gate just waits here
        return freeSpots.pollFirst();
    }
}
```

With `synchronized` there is no way to say "if floor 2 is busy, try floor 3 instead". A slow caller blocks everyone.

### Better design

```java
class ParkingFloor {
    private final ReentrantLock lock = new ReentrantLock();
    private final Deque<String> freeSpots = new ArrayDeque<>();

    public Optional<String> allocate(Duration maxWait) throws InterruptedException {
        if (!lock.tryLock(maxWait.toMillis(), TimeUnit.MILLISECONDS)) {
            return Optional.empty();            // busy: caller tries another floor
        }
        try {
            return Optional.ofNullable(freeSpots.pollFirst());
        } finally {
            lock.unlock();                      // always unlock in finally
        }
    }
}
```

The gate waits at most `maxWait` and then moves on. The `try/finally` guarantees the lock is released even if something throws.

**Key takeaway:** Reach for `ReentrantLock` when you need a timeout, an interruptible wait or a fair queue. Otherwise `synchronized` is simpler.

### synchronized vs. ReentrantLock

- **Both** give mutual exclusion and visibility, and both are re-entrant (the same thread can lock again).
- **synchronized** releases automatically when the block ends. You cannot forget to unlock.
- **ReentrantLock** adds `tryLock`, timeouts, `lockInterruptibly`, fairness and multiple `Condition`s, but you must call `unlock()` in `finally` yourself.

---

## 4. Atomics and compareAndSet

**Definition:** Atomic classes (`AtomicInteger`, `AtomicLong`, `AtomicReference`) update a single variable safely without a lock, using compare-and-set (CAS).

CAS means: "set the value to X, but only if it is still Y". If another thread changed it first, the call returns `false` and you retry with the fresh value.

### Example: the problem

```java
class FixedWindowCounter {
    private final int limit;
    private volatile int used;                 // volatile = visible, NOT atomic

    FixedWindowCounter(int limit) { this.limit = limit; }

    boolean tryAcquire() {
        if (used >= limit) return false;
        used++;                                // two threads can both read 99 and write 100
        return true;
    }
}
```

Under load, the rate limiter lets through more requests than the limit, because the check and the increment are separate steps.

### Better design

```java
class FixedWindowCounter {
    private final int limit;
    private final AtomicInteger used = new AtomicInteger();

    FixedWindowCounter(int limit) { this.limit = limit; }

    boolean tryAcquire() {
        while (true) {
            int current = used.get();
            if (current >= limit) return false;
            if (used.compareAndSet(current, current + 1)) return true;
            // someone else changed it first: loop, re-read, re-check
        }
    }
}
```

Each increment only succeeds if nobody else got in between, so the counter never goes past the limit. For simple sequences, such as order IDs, `AtomicLong.incrementAndGet()` is enough on its own.

**Key takeaway:** Atomics are perfect for one variable. Once a rule spans two or more variables, use a lock or a single atomic map operation.

### volatile vs. atomic

- **volatile** only guarantees that other threads see the latest value. `count++` on a volatile field is still a race.
- **Atomic classes** guarantee visibility and that the update itself happens as one step.

---

## 5. Concurrent collections

**Definition:** `java.util.concurrent` collections are safe to share between threads and offer atomic "check and update" methods.

The trap is using them like a normal map: calling `get` and then `put` as two separate steps brings the race straight back.

### Example: the problem

```java
Map<String, FixedWindowCounter> counters = new HashMap<>();

boolean allow(String userId) {
    FixedWindowCounter c = counters.get(userId);
    if (c == null) {                           // two threads create two counters
        c = new FixedWindowCounter(100);
        counters.put(userId, c);               // one overwrites the other
    }
    return c.tryAcquire();
}
```

A plain `HashMap` can corrupt itself under concurrent writes, and even with a safe map, two counters can be created for the same user.

### Better design

```java
private final ConcurrentHashMap<String, FixedWindowCounter> counters = new ConcurrentHashMap<>();
private final ConcurrentHashMap<String, Integer> bookingsPerUser = new ConcurrentHashMap<>();

boolean allow(String userId) {
    return counters
            .computeIfAbsent(userId, id -> new FixedWindowCounter(100))
            .tryAcquire();
}

void recordBooking(String userId) {
    bookingsPerUser.merge(userId, 1, Integer::sum);   // atomic per-key increment
}
```

`computeIfAbsent` creates the counter exactly once per user, and `merge` performs the per-key read-modify-write atomically.

### Atomic hand-off with ConcurrentLinkedDeque

When several threads take items from a shared pool, such as free parking spots, "check if empty, then remove" is another check-then-act race.

```java
class SpotPool {
    private final ConcurrentLinkedDeque<String> freeSpots = new ConcurrentLinkedDeque<>();

    Optional<String> take() {
        // pollFirst removes and returns in one step, or returns null if empty
        return Optional.ofNullable(freeSpots.pollFirst());
    }

    void release(String spotId) {
        freeSpots.addFirst(spotId);
    }
}
```

Each spot is handed to exactly one gate. Never call `isEmpty()` or `size()` first and then remove; just `poll` and handle `null`.

**Key takeaway:** Use the collection's single atomic method (`putIfAbsent`, `computeIfAbsent`, `compute`, `merge`, `poll`) instead of two separate calls.

---

## 6. Temporary holds with expiry

**Definition:** A hold reserves an item for a short time (say 10 minutes) while the user pays, then either becomes a confirmed booking or expires.

Payment is slow and can fail, so you cannot keep a lock while it happens. Instead, you record a claim with an expiry time and treat expired claims as free.

### Example: the problem

```java
synchronized (show) {
    if (seat.isFree()) {
        paymentGateway.charge(userId, price);   // can take two minutes
        seat.markBooked(userId);
    }
}
```

The whole show is locked while an external payment runs. Every other user waits, and if the gateway hangs, so does the cinema.

### Better design

```java
enum ClaimStatus { HELD, BOOKED }

record SeatClaim(ClaimStatus status, String userId, Instant expiresAt) {
    boolean blocks(Instant now) {
        return status == ClaimStatus.BOOKED || now.isBefore(expiresAt);
    }
}
```

```java
class SeatHoldService {
    private final ConcurrentHashMap<String, SeatClaim> claims = new ConcurrentHashMap<>();
    private final Duration holdFor = Duration.ofMinutes(10);
    private final Clock clock;

    SeatHoldService(Clock clock) { this.clock = clock; }

    boolean hold(String seatId, String userId) {
        Instant now = clock.instant();
        SeatClaim mine = new SeatClaim(ClaimStatus.HELD, userId, now.plus(holdFor));
        return claims.compute(seatId, (id, cur) ->
                cur == null || !cur.blocks(now) ? mine : cur) == mine;
    }

    boolean confirm(String seatId, String userId) {      // call after payment succeeds
        Instant now = clock.instant();
        SeatClaim after = claims.computeIfPresent(seatId, (id, cur) ->
                cur.status() == ClaimStatus.HELD && cur.userId().equals(userId) && cur.blocks(now)
                        ? new SeatClaim(ClaimStatus.BOOKED, userId, null) : cur);
        return after != null && after.status() == ClaimStatus.BOOKED && after.userId().equals(userId);
    }
}
```

Holding and confirming are each one short atomic step, and payment happens between them with no lock held. If the hold has expired by the time payment returns, `confirm` fails and you refund. A scheduled job can tidy up with `claims.values().removeIf(c -> !c.blocks(clock.instant()))`, but correctness does not depend on it, because expired holds already count as free.

**Key takeaway:** Lock briefly to claim, never during payment. Free, held until a time, then booked or free again: that flow covers BookMyShow, train seats, flash sales and cab offers.

---

## 7. Deadlock and lock ordering

**Definition:** A deadlock happens when two threads each hold a lock the other needs, so both wait forever.

It needs a circular wait: thread 1 holds A and wants B, thread 2 holds B and wants A. Remove the circle and the deadlock cannot happen.

### Example: the problem

```java
void transfer(Wallet from, Wallet to, long amountPaise) {
    synchronized (from) {
        synchronized (to) {
            from.debit(amountPaise);
            to.credit(amountPaise);
        }
    }
}
```

Alice pays Bob while Bob pays Alice. Thread 1 locks Alice's wallet, thread 2 locks Bob's, and each waits for the other.

### Better design

```java
void transfer(Wallet from, Wallet to, long amountPaise) {
    // always lock in the same global order: smaller id first
    Wallet first  = from.id().compareTo(to.id()) < 0 ? from : to;
    Wallet second = (first == from) ? to : from;

    synchronized (first) {
        synchronized (second) {
            if (!from.debit(amountPaise)) {
                throw new InsufficientFundsException(from.id(), amountPaise);
            }
            to.credit(amountPaise);
        }
    }
}
```

Both threads now lock the lower ID first, so neither can hold the "second" lock while waiting for the "first". The same trick works for booking several seats: sort seat IDs, then lock in that order.

**Key takeaway:** When one operation needs several locks, take them in a fixed order. Other escape routes are `tryLock` with a timeout and back-off, or one coarser lock (for example, per show) for the short critical section.

---

## 8. Optimistic vs. pessimistic locking

**Definition:** Pessimistic locking locks first and then works. Optimistic locking works without a lock and only commits if nothing changed in the meantime.

- **Pessimistic:** `synchronized`, `ReentrantLock`, or `SELECT ... FOR UPDATE` in a database. Best when conflicts are frequent, such as hot seats in the first minute of a blockbuster sale.
- **Optimistic:** CAS on an atomic, or a version column in the database. Best when conflicts are rare, such as editing a user profile.

### Example: optimistic update with a version column

```java
boolean bookSeat(String seatId, String userId, long versionSeen) {
    int rows = jdbcTemplate.update(
        "UPDATE seat SET status = 'BOOKED', booked_by = ?, version = version + 1 " +
        "WHERE id = ? AND status = 'FREE' AND version = ?",
        userId, seatId, versionSeen);
    return rows == 1;     // 0 rows means another user changed the seat first
}
```

The database applies the condition and the update as one statement, so this works across many app servers, which in-memory locks cannot do. On failure, re-read and retry, or tell the user the seat is gone.

**Key takeaway:** High contention favours pessimistic locks; low contention favours optimistic versioning. Either way, mention that in-memory locks only protect one JVM.

---

## 9. Thread pools and ExecutorService

**Definition:** An `ExecutorService` runs tasks on a managed pool of threads, so you don't create a new thread for every piece of work.

Thread pools limit how many threads exist, reuse them, and give you a clean way to shut down.

### Example: the problem

```java
void onBookingConfirmed(Booking booking) {
    new Thread(() -> notifier.sendEmail(booking)).start();   // one new thread per booking
}
```

A sale with 50,000 bookings in a minute creates 50,000 threads, with no limit and no way to stop them cleanly.

### Better design

```java
class NotificationDispatcher implements AutoCloseable {
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Notifier notifier;

    NotificationDispatcher(Notifier notifier) { this.notifier = notifier; }

    Future<?> sendAsync(Booking booking) {
        return pool.submit(() -> notifier.sendEmail(booking));
    }

    @Override
    public void close() throws InterruptedException {
        pool.shutdown();
        if (!pool.awaitTermination(5, TimeUnit.SECONDS)) pool.shutdownNow();
    }
}
```

Work queues up behind four reusable threads, and shutdown is controlled. Related tools: `ScheduledExecutorService` for periodic jobs such as hold cleanup, a single-thread executor fed by a `BlockingQueue` for an elevator controller (one owner, no locks needed), and virtual threads (`Executors.newVirtualThreadPerTaskExecutor()`, Java 21) for many blocking I/O tasks.

**Key takeaway:** Submit tasks to a pool you own and shut it down; never scatter `new Thread()` through the design.

---

## In an LLD interview

- **BookMyShow / seat booking:** name the check-then-act race, claim seats with `putIfAbsent` or `compute`, use holds with expiry, and lock multiple seats in sorted order.
- **Parking Lot:** hand out spots with `ConcurrentLinkedDeque.pollFirst()` per spot size, or a per-floor `ReentrantLock` with `tryLock` so gates can fall through to another floor.
- **Wallet / Payment / Splitwise:** synchronize per wallet, order locks by wallet ID for transfers, and never hold a lock while calling the payment gateway.
- **Rate Limiter:** `ConcurrentHashMap.computeIfAbsent` for the per-user bucket, `AtomicInteger.compareAndSet` (or a per-bucket lock) inside it; avoid one global lock.
- **Elevator / Train reservation:** a single scheduler thread consuming a `BlockingQueue` for the elevator; optimistic version checks for train berths shared across servers.

## At a glance

| Topic | Core idea | Ask yourself |
|---|---|---|
| Race condition | Timing decides the result | Is there a check-then-act on shared state? |
| synchronized | One thread at a time in a block | What is the smallest block that keeps the rule true? |
| ReentrantLock | Lock with timeouts and controls | Do callers need to give up instead of waiting? |
| Atomics | Lock-free update of one variable | Is the rule about a single value? |
| Concurrent collections | Atomic per-key operations | Am I using one atomic call, not get-then-put? |
| Holds with expiry | Claim briefly, confirm later | Am I holding a lock during payment? |
| Deadlock | Circular wait between locks | Do I always take locks in the same order? |
| Optimistic vs. pessimistic | Lock first, or verify on commit | How often do conflicts really happen? |
| Thread pools | Managed, bounded worker threads | Who owns and shuts down these threads? |

## Final memory aid

- **Find:** check-then-act and read-modify-write
- **Fix small:** one atomic call or one atomic variable
- **Fix bigger:** a lock per aggregate, released in `finally`
- **Slow work:** hold, pay, then confirm
- **Many locks:** always the same order
- **Many servers:** database version check

Start with the simplest tool that is correct, and explain why it is enough.

=== lld-modelling | LLD | Modelling details interviewers notice: money, time, IDs, enums, errors ===
Interviewers often judge an LLD answer by small details: how you store money, which time type you pick, what an ID looks like, and what happens when something goes wrong. Each of these takes only seconds to get right, and each one signals that you have shipped real systems. This chapter walks through them with small examples of the problem and a better design.

## 1. Money: never use double

**The rule:** Never store or calculate money with `double` or `float`.

Binary floating point cannot represent most decimal fractions exactly, so tiny errors appear and add up across thousands of transactions. Use `long` minor units (paise, cents) or `BigDecimal` with an explicit scale and rounding mode.

### Example: the problem

```java
double balance = 0.0;
for (int i = 0; i < 10; i++) {
    balance += 0.10;               // add 10 paise, expressed in rupees
}
System.out.println(balance);        // 0.9999999999999999
System.out.println(balance == 1.0); // false
```

A wallet that should hold exactly one rupee does not, and an equality check on a refund amount quietly fails.

### Better design

```java
// Option A: long minor units (paise). Exact and fast.
long balancePaise = 0;
for (int i = 0; i < 10; i++) balancePaise += 10;   // 100 paise, exactly

// Option B: BigDecimal with an explicit scale and rounding rule.
BigDecimal price = new BigDecimal("199.99");        // from a String, never from a double
BigDecimal gst = price.multiply(new BigDecimal("0.18"))
                      .setScale(2, RoundingMode.HALF_EVEN);   // 35.9982 -> 36.00
```

Both are exact. With `BigDecimal`, always decide where rounding happens (per line or on the total) and state the rounding mode out loud.

**Key takeaway:** Money is exact. Pick `long` minor units or `BigDecimal`, and make the rounding policy an explicit rule.

### long minor units vs. BigDecimal

- **long minor units:** simple, fast, exact. You must know each currency's number of decimal places, and division still needs a rounding rule.
- **BigDecimal:** handles any precision, such as tax rates or FX. Watch out: `new BigDecimal("2.0").equals(new BigDecimal("2.00"))` is `false` because scale counts; compare with `compareTo`.

---

## 2. A Money value object

**Definition:** A value object is a small immutable type defined only by its values, such as an amount plus a currency.

Wrapping money in its own type stops you from adding rupees to dollars and keeps all money rules in one place.

### Example: the problem

```java
class Expense {
    long amount;          // paise? rupees? which currency?
    String currency;

    void addShare(long share, String shareCurrency) {
        amount += share;  // nothing stops INR + USD
    }
}
```

Nothing tells the reader what unit `amount` is in, and mixing currencies compiles fine.

### Better design

```java
public record Money(long minorUnits, Currency currency) {
    public Money {
        Objects.requireNonNull(currency, "currency");
    }

    public static Money of(String amount, String currencyCode) {
        Currency c = Currency.getInstance(currencyCode);
        int digits = c.getDefaultFractionDigits();
        long minor = new BigDecimal(amount)
                .setScale(digits, RoundingMode.UNNECESSARY)   // reject "10.005" for INR
                .movePointRight(digits)
                .longValueExact();
        return new Money(minor, c);
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(minorUnits, other.minorUnits), currency);
    }

    public Money times(long n) {
        return new Money(Math.multiplyExact(minorUnits, n), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch: " + currency + " vs " + other.currency);
        }
    }
}
```

The unit and currency travel together, mixing currencies fails loudly, and `Math.addExact` throws on overflow instead of silently wrapping.

### Splitting without losing a paisa

Splitting ₹100.00 three ways as 3333 paise each loses one paisa. Hand out the remainder deterministically:

```java
static List<Money> splitEqually(Money total, int people) {
    long base = total.minorUnits() / people;
    long remainder = total.minorUnits() % people;
    List<Money> shares = new ArrayList<>();
    for (int i = 0; i < people; i++) {
        long extra = i < remainder ? 1 : 0;
        shares.add(new Money(base + extra, total.currency()));
    }
    return shares;   // 10000 paise / 3 -> 3334, 3333, 3333
}
```

**Key takeaway:** A `Money` type with currency, exact operations and a remainder rule is a quick win in any Wallet, Payment or Splitwise problem.

---

## 3. Time: Instant vs. LocalDateTime vs. ZonedDateTime

**The rule:** Store moments as `Instant`; use local or zoned types only when a human calendar is involved.

- **Instant:** a single point on the global timeline (UTC). Use it for entry times, payment timestamps and hold expiries.
- **LocalDateTime / LocalDate / LocalTime:** a calendar date or clock time with no zone. Use it for "store opens at 09:00" or a date of birth.
- **ZonedDateTime:** a local time plus zone rules. Use it for "show starts 19:30 in Asia/Kolkata" or recurring meetings.
- **Duration / Period:** a length of time in seconds (parking time) or in calendar units ("1 month subscription").

### Example: the problem

```java
class SeatHold {
    LocalDateTime expiresAt = LocalDateTime.now().plusMinutes(10);

    boolean isExpired() {
        return LocalDateTime.now().isAfter(expiresAt);
    }
}
```

`LocalDateTime.now()` uses the server's default zone. Two servers in different zones, or a daylight-saving change, will disagree about whether the hold has expired.

### Better design

```java
record SeatHold(String seatId, String userId, Instant expiresAt) {
    boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }
}

// Convert to a zone only at the edge, for display:
ZonedDateTime shown = hold.expiresAt().atZone(ZoneId.of("Asia/Kolkata"));
```

An `Instant` means the same moment everywhere, so every server agrees. Zones appear only when showing times to people.

**Key takeaway:** `Instant` inside the system, zones at the edges. For time ranges, use half-open intervals `[start, end)`, so a 10:00 to 11:00 slot does not overlap 11:00 to 12:00.

---

## 4. Inject a Clock

**Definition:** Pass a `java.time.Clock` into classes that need the current time, instead of calling `Instant.now()` directly.

Code that reads the system clock is hard to test: you cannot easily check "what is the fee after 3 hours and 5 minutes?" without waiting.

### Example: the problem

```java
class ParkingFeeCalculator {
    private final Money ratePerHour;

    ParkingFeeCalculator(Money ratePerHour) { this.ratePerHour = ratePerHour; }

    Money fee(Instant entryTime) {
        Duration parked = Duration.between(entryTime, Instant.now());   // hidden dependency
        long hours = Math.max(1, (parked.toMinutes() + 59) / 60);       // round up
        return ratePerHour.times(hours);
    }
}
```

The result changes every time you run the test, so you end up with no test or a flaky one.

### Better design

```java
class ParkingFeeCalculator {
    private final Money ratePerHour;
    private final Clock clock;

    ParkingFeeCalculator(Money ratePerHour, Clock clock) {
        this.ratePerHour = ratePerHour;
        this.clock = clock;
    }

    Money fee(Instant entryTime) {
        Duration parked = Duration.between(entryTime, clock.instant());
        long hours = Math.max(1, (parked.toMinutes() + 59) / 60);
        return ratePerHour.times(hours);
    }
}

// In a test:
Clock fixed = Clock.fixed(Instant.parse("2026-01-01T13:05:00Z"), ZoneOffset.UTC);
```

With a fixed clock, an entry at 10:00 always gives four billable hours. Production code passes `Clock.systemUTC()`.

**Key takeaway:** Time is a dependency. Inject it, just like a repository or payment gateway.

---

## 5. IDs: UUID, sequence or readable code

**Definition:** An ID gives an entity a stable identity that never changes, even when everything else about it does.

Choose the ID style based on who sees it and whether guessing it is a risk, and generate IDs in one place.

- **UUID:** unguessable and needs no coordination. Good for booking or payment IDs in URLs.
- **Sequence (AtomicLong or a database sequence):** short and ordered, but guessable. Good for internal IDs.
- **Readable code:** short and easy to say aloud, like a PNR or a Splitwise group invite code. Needs a collision check.

### Example: the problem

```java
void cancel(String userId, String bookingId) { /* ... */ }

// caller swaps the arguments, and it still compiles
bookingService.cancel(booking.getId(), user.getId());
```

When every ID is a `String`, the compiler cannot catch swapped arguments, and the bug appears in production as "booking not found".

### Better design

```java
public record BookingId(String value) {
    public BookingId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) throw new IllegalArgumentException("blank booking id");
    }
    public static BookingId random() {
        return new BookingId(UUID.randomUUID().toString());
    }
}

public record UserId(String value) { }

interface OrderIdGenerator { String next(); }

class SequentialOrderIds implements OrderIdGenerator {
    private final AtomicLong seq = new AtomicLong(100_000);
    public String next() { return "ORD-" + seq.incrementAndGet(); }
}
```

Now `cancel(UserId, BookingId)` cannot be called with the arguments swapped. Putting generation behind an interface means tests can use predictable IDs.

**Key takeaway:** Wrap IDs in small types, generate them in one place, and avoid sequential IDs wherever guessing them would expose other users' data.

---

## 6. Enums instead of strings and booleans

**Definition:** Use an `enum` for any closed set of values, such as statuses, sizes or directions, and put behaviour that belongs to the value inside the enum.

Strings allow typos, and several booleans allow combinations that make no sense.

### Example: the problem

```java
class Booking {
    String status = "HELD";
    boolean isPaid;
    boolean isCancelled;
    boolean isRefunded;
}

if (booking.status.equals("Confirmed")) { /* never true: stored as "CONFIRMED" */ }
// and what does isPaid = false, isRefunded = true mean?
```

Three booleans allow eight combinations, most of them impossible, and nothing stops `"Confrimed"`.

### Better design

```java
enum BookingStatus {
    HELD, CONFIRMED, CANCELLED, EXPIRED;

    boolean canMoveTo(BookingStatus next) {
        return switch (this) {
            case HELD -> next == CONFIRMED || next == CANCELLED || next == EXPIRED;
            case CONFIRMED -> next == CANCELLED;
            case CANCELLED, EXPIRED -> false;
        };
    }
}

class Booking {
    private BookingStatus status = BookingStatus.HELD;

    void moveTo(BookingStatus next) {
        if (!status.canMoveTo(next)) {
            throw new IllegalStateTransitionException(status, next);
        }
        status = next;
    }
}
```

There is one field with only legal values, and every transition rule lives in one place. Because the `switch` covers every constant, adding a new status forces you to decide its transitions.

**Key takeaway:** An enum with a small transition rule replaces a tangle of strings and flags. For complex behaviour per state, move up to the State pattern.

---

## 7. Errors: exceptions, Optional and validation at the boundary

**The rule:** Throw a specific domain exception when a business rule is broken; return `Optional` or a result type when "nothing found" is a normal outcome.

Validate input once, when it enters the system or when an object is built, so invalid objects can never exist.

### Example: the problem

```java
Spot findSpot(VehicleType type) {
    // ...
    return null;                              // caller forgets to check, NPE later
}

boolean withdraw(long amount) {
    if (amount > balance) return false;       // why did it fail? caller cannot tell
    // ...
}

throw new RuntimeException("error");          // no context at all
```

Callers get nulls, silent `false`s and messages that say nothing, so failures surface far from their cause.

### Better design

```java
Optional<Spot> findFreeSpot(VehicleType type) { /* empty when the lot is full */ }

class InsufficientFundsException extends RuntimeException {
    InsufficientFundsException(WalletId wallet, Money balance, Money requested) {
        super("Wallet " + wallet.value() + " has " + balance + ", requested " + requested);
    }
}

sealed interface BookingResult permits Booked, SeatTaken, HoldExpired { }
record Booked(BookingId id) implements BookingResult { }
record SeatTaken(String seatId) implements BookingResult { }
record HoldExpired() implements BookingResult { }
```

"Lot full" is expected, so it is an empty `Optional`. "Not enough money" breaks a rule, so it is a named exception with context. A sealed result type lists every possible outcome so the caller can handle each one.

**Key takeaway:** Name your failures. Use exceptions for broken rules, `Optional` or sealed results for expected outcomes, and validation in constructors so bad data stops at the door.

### Exception vs. Optional

- **Exception:** something that should not happen in a correct flow, like an illegal state transition or insufficient funds.
- **Optional or result type:** an ordinary answer the caller must handle, like "no free spot" or "seat already taken".

---

## 8. Immutability and value objects with records

**Definition:** An immutable object cannot change after it is created. Java `record`s are the easiest way to build immutable value objects.

Immutable objects are safe to share between threads, safe to use as map keys, and cannot be changed behind your back.

### Example: the problem

```java
class Expense {
    private List<UserId> participants;

    Expense(List<UserId> participants) { this.participants = participants; }

    public List<UserId> getParticipants() { return participants; }   // caller can modify it
}

expense.getParticipants().clear();   // the expense now has nobody to split with
```

Both the caller's original list and the returned list are the object's internal state, so anyone can change it.

### Better design

```java
record Expense(String description, Money amount, List<UserId> participants) {
    Expense {
        Objects.requireNonNull(amount, "amount");
        if (participants.isEmpty()) throw new IllegalArgumentException("no participants");
        participants = List.copyOf(participants);   // defensive, unmodifiable copy
    }
}

record TimeSlot(Instant start, Instant end) {
    TimeSlot {
        if (!start.isBefore(end)) throw new IllegalArgumentException("start must be before end");
    }
    boolean overlaps(TimeSlot other) {
        return start.isBefore(other.end) && other.start.isBefore(end);
    }
}
```

The record validates itself, copies its list, and offers no setters. `TimeSlot` uses half-open intervals, so back-to-back meetings do not overlap.

**Key takeaway:** Default to `final` fields and records for data. Copy mutable inputs in, and never hand mutable internals out.

---

## 9. equals and hashCode: entities vs. values

**The rule:** Entities are equal when their IDs are equal. Value objects are equal when all their fields are equal.

An entity, such as a ticket, booking or user, changes over its life but keeps its identity. A value, such as `Money` or `TimeSlot`, is just its data.

### Example: the problem

```java
class ParkingTicket {
    TicketId id;
    TicketStatus status;
    // equals and hashCode generated from BOTH id and status
}

Set<ParkingTicket> open = new HashSet<>();
open.add(ticket);
ticket.status = TicketStatus.PAID;   // hashCode changes while it sits in the set
open.remove(ticket);                 // returns false: the ticket is "lost"
```

Changing a field used in `hashCode` puts the object in the wrong bucket, so the set can no longer find it.

### Better design

```java
class ParkingTicket {
    private final TicketId id;
    private TicketStatus status;

    ParkingTicket(TicketId id) { this.id = id; this.status = TicketStatus.ACTIVE; }

    @Override
    public boolean equals(Object o) {
        return o instanceof ParkingTicket other && id.equals(other.id);
    }

    @Override
    public int hashCode() { return id.hashCode(); }
}
```

Equality depends only on the final ID, so status changes never break sets or maps. Records already give value objects correct field-based `equals` and `hashCode`.

**Key takeaway:** Entities compare by identity, values by content. Never base `hashCode` on a field that can change.

### Entity vs. value object

- **Entity:** has an ID, is mutable over its lifecycle, compared by ID. Examples: `Booking`, `Wallet`, `ParkingTicket`.
- **Value object:** no ID, immutable, compared by all fields. Examples: `Money`, `TimeSlot`, `Address`.

---

## In an LLD interview

- **Wallet / Payment / Splitwise:** a `Money` record with currency and exact operations, a remainder rule for splits, and `InsufficientFundsException` with context.
- **Parking Lot:** an injected `Clock` for fee calculation, `Instant` for entry and exit, `Optional<Spot>` when full, and an enum for spot size with a `fits(vehicle)` method.
- **BookMyShow / seat booking:** a `BookingStatus` enum with legal transitions, holds expiring at an `Instant`, and a sealed `BookingResult`.
- **Train reservation:** readable PNR codes behind an ID generator, and `ZonedDateTime` for departure times shown to passengers.
- **Rate Limiter / Elevator:** an injected `Clock` makes time windows testable; enums for `Direction` and elevator state.

## At a glance

| Topic | Core idea | Ask yourself |
|---|---|---|
| Money | Exact amounts, never double | Is the amount in minor units or BigDecimal, with a currency? |
| Money value object | Amount and currency together | Can I accidentally add two currencies? |
| Time types | Instant inside, zones at the edges | Is this a moment or a calendar time? |
| Clock | Time is an injected dependency | Can I test this without waiting? |
| IDs | Stable, typed, generated in one place | Could a caller swap or guess these IDs? |
| Enums | Closed sets with behaviour | Are strings or booleans hiding illegal states? |
| Errors | Named failures, validated inputs | Is this a broken rule or an expected outcome? |
| Immutability | Records and defensive copies | Can someone change this object behind my back? |
| equals/hashCode | Entities by ID, values by fields | Does hashCode use a field that can change? |

## Final memory aid

- **Money:** long or BigDecimal, never double
- **Time:** Instant plus an injected Clock
- **IDs:** typed wrappers, one generator
- **State:** enums with legal transitions
- **Errors:** exceptions for rules, Optional for "not found"
- **Data:** records, copied in, never leaked out
- **Equality:** entities by ID, values by content

Mention these details briefly while you design; you do not need to dwell on them, but leaving them out is noticed.
