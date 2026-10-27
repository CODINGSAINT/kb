package kb.splitwise;

import java.util.*;

/** One fixed-membership INR group. Authenticated actor IDs come from the trusted API adapter. */
public final class SplitLedger {
    public record Expense(String id, String recordedBy, long total, Map<String, Long> paid,
                          Map<String, Long> shares) {
        public Expense { paid = Map.copyOf(paid); shares = Map.copyOf(shares); }
    }
    public enum PaymentState { PROPOSED, CONFIRMED }
    public record Payment(String id, String from, String to, long amount, PaymentState state) {}
    public record Entry(String kind, String id, Map<String, Long> deltas) {
        public Entry { deltas = Map.copyOf(deltas); }
    }
    public record Transfer(String from, String to, long amount) {}
    public record Plan(long revision, List<Transfer> transfers) {
        public Plan { transfers = List.copyOf(transfers); }
    }
    public record Reversal(String id, String expenseId, String recordedBy) {}
    public record Snapshot(long revision, Map<String, Long> balances, List<Entry> entries, List<Payment> payments,
                           List<Expense> expenses, List<Reversal> reversals) {
        public Snapshot { balances = Map.copyOf(balances); entries = List.copyOf(entries); payments = List.copyOf(payments);
            expenses = List.copyOf(expenses); reversals = List.copyOf(reversals); }
    }

    private final SortedSet<String> members;
    private final Map<String, Expense> expenses = new HashMap<>();
    private final Map<String, Payment> payments = new TreeMap<>();
    private final Map<String, String> reversals = new HashMap<>(); // original expense -> reversal id
    private final Map<String, Reversal> reversalIds = new TreeMap<>();
    private final List<Entry> entries = new ArrayList<>();
    private Map<String, Long> balances = new TreeMap<>();
    private long revision;

    public SplitLedger(Set<String> members) {
        if (members.size() < 2) throw new IllegalArgumentException("At least two members");
        var copy = new TreeSet<String>();
        for (String id : members) { Splits.validId(id); copy.add(id); balances.put(id, 0L); }
        this.members = Collections.unmodifiableSortedSet(copy);
    }

    // BEGIN expense
    public synchronized Expense addExpense(String id, String actor, long total,
                                            Map<String, Long> paid, Map<String, Long> shares) {
        member(actor); Splits.validId(id);
        Map<String, Long> checkedPaid = Splits.exact(total, paid);
        Map<String, Long> checkedShares = Splits.exact(total, shares);
        checkedPaid.keySet().forEach(this::member); checkedShares.keySet().forEach(this::member);
        Expense input = new Expense(id, actor, total, checkedPaid, checkedShares);
        Expense old = expenses.get(id);
        if (old != null) {
            if (!old.equals(input)) throw new IllegalArgumentException("Expense identity reused with changed data");
            return old;
        }
        var deltas = new TreeMap<String, Long>();
        for (String user : members)
            deltas.put(user, checkedPaid.getOrDefault(user, 0L) - checkedShares.getOrDefault(user, 0L));
        post(new Entry("EXPENSE", id, deltas));
        expenses.put(id, input);
        return input;
    }
    // END expense

    // BEGIN settlement
    public synchronized Payment proposePayment(String id, String actor, String to, long amount) {
        member(actor); member(to); Splits.validId(id);
        if (actor.equals(to) || amount <= 0) throw new IllegalArgumentException("Distinct parties and positive amount required");
        Payment old = payments.get(id);
        if (old != null) {
            if (!old.from().equals(actor) || !old.to().equals(to) || old.amount() != amount)
                throw new IllegalArgumentException("Payment identity reused with changed data");
            return old;
        }
        long next = Math.incrementExact(revision);
        Payment result = new Payment(id, actor, to, amount, PaymentState.PROPOSED);
        payments.put(id, result); revision = next; // Proposal changes no balance.
        return result;
    }

    public synchronized Payment confirmPayment(String id, String actor) {
        member(actor);
        Payment old = payments.get(id);
        if (old == null) throw new IllegalArgumentException("Unknown payment");
        if (!old.to().equals(actor)) throw new IllegalArgumentException("Only the receiver confirms receipt");
        if (old.state() == PaymentState.CONFIRMED) return old;
        // Record the confirmed real-world payment, even if a newer expense changed today's debt.
        post(new Entry("PAYMENT", id, Map.of(old.from(), old.amount(), old.to(), -old.amount())));
        Payment result = new Payment(id, old.from(), old.to(), old.amount(), PaymentState.CONFIRMED);
        payments.put(id, result);
        return result;
    }
    // END settlement

    public synchronized void reverseExpense(String reversalId, String expenseId, String actor) {
        member(actor); Splits.validId(reversalId);
        Expense old = expenses.get(expenseId);
        if (old == null) throw new IllegalArgumentException("Unknown expense");
        if (!old.recordedBy().equals(actor)) throw new IllegalArgumentException("Only the original recorder corrects it");
        Reversal existing = reversalIds.get(reversalId);
        if (existing != null) {
            if (!existing.expenseId().equals(expenseId)) throw new IllegalArgumentException("Reversal identity conflict");
            return;
        }
        if (reversals.containsKey(expenseId)) throw new IllegalArgumentException("Expense already reversed");
        var deltas = new TreeMap<String, Long>();
        for (String user : members)
            deltas.put(user, old.shares().getOrDefault(user, 0L) - old.paid().getOrDefault(user, 0L));
        post(new Entry("REVERSAL", reversalId, deltas));
        reversals.put(expenseId, reversalId); reversalIds.put(reversalId, new Reversal(reversalId, expenseId, actor));
    }

    // BEGIN posting
    private void post(Entry entry) {
        var candidate = new TreeMap<>(balances);
        for (String user : members) {
            long value = Math.addExact(candidate.get(user), entry.deltas().getOrDefault(user, 0L));
            Math.negateExact(value); // Every committed balance must have a representable magnitude.
            candidate.put(user, value);
        }
        long next = Math.incrementExact(revision);
        // All fallible arithmetic is complete before either journal or projection changes.
        entries.add(entry); balances = candidate; revision = next;
    }
    // END posting

    // BEGIN plan
    public synchronized Plan plan(String actor) {
        member(actor);
        var debtors = new TreeMap<String, Long>(); var creditors = new TreeMap<String, Long>();
        for (var e : balances.entrySet()) {
            if (e.getValue() < 0) debtors.put(e.getKey(), -e.getValue());
            if (e.getValue() > 0) creditors.put(e.getKey(), e.getValue());
        }
        var result = new ArrayList<Transfer>();
        while (!debtors.isEmpty() && !creditors.isEmpty()) {
            String from = debtors.firstKey(), to = creditors.firstKey();
            long amount = Math.min(debtors.get(from), creditors.get(to));
            result.add(new Transfer(from, to, amount));
            long debt = debtors.get(from) - amount, credit = creditors.get(to) - amount;
            if (debt == 0) debtors.remove(from); else debtors.put(from, debt);
            if (credit == 0) creditors.remove(to); else creditors.put(to, credit);
        }
        return new Plan(revision, result); // Advice only. No transfers or ledger writes.
    }
    // END plan

    public synchronized Snapshot snapshot(String actor) {
        member(actor); return new Snapshot(revision, balances, entries, new ArrayList<>(payments.values()),
                expenses.values().stream().sorted(Comparator.comparing(Expense::id)).toList(), new ArrayList<>(reversalIds.values()));
    }

    public synchronized Map<String, Long> rebuild(String actor) {
        member(actor); var result = new TreeMap<String, Long>(); members.forEach(id -> result.put(id, 0L));
        for (Entry e : entries)
            for (String user : members) result.put(user, Math.addExact(result.get(user), e.deltas().getOrDefault(user, 0L)));
        return Collections.unmodifiableMap(result);
    }

    private void member(String actor) {
        if (actor == null || actor.isBlank() || !members.contains(actor)) throw new IllegalArgumentException("Not a group member");
    }
}
