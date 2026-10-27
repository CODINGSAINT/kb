package kb.expensesplit;

import java.util.*;

// region:model
record User(String name) {}
record Split(User user, long paise) {}
record Expense(String description, User paidBy, long amountPaise, List<Split> splits) {}
// endregion:model

// region:strategies
interface SplitStrategy {
    List<Split> split(long amountPaise, List<User> users, List<Long> inputs);
}

class EqualSplit implements SplitStrategy {
    public List<Split> split(long amount, List<User> users, List<Long> ignored) {
        long base = amount / users.size();
        long leftover = amount % users.size();                  // e.g. 2 paise
        List<Split> result = new ArrayList<>();
        for (int i = 0; i < users.size(); i++) {
            result.add(new Split(users.get(i), base + (i < leftover ? 1 : 0)));
        }
        return result;
    }
}

class ExactSplit implements SplitStrategy {
    public List<Split> split(long amount, List<User> users, List<Long> exact) {
        if (exact.stream().mapToLong(Long::longValue).sum() != amount) {
            throw new IllegalArgumentException("Exact shares must add up to the total");
        }
        List<Split> result = new ArrayList<>();
        for (int i = 0; i < users.size(); i++) {
            result.add(new Split(users.get(i), exact.get(i)));
        }
        return result;
    }
}

/** Inputs are percentages in basis points: 100% = 10,000. */
class PercentSplit implements SplitStrategy {
    public List<Split> split(long amount, List<User> users, List<Long> basisPoints) {
        if (basisPoints.stream().mapToLong(Long::longValue).sum() != 10_000) {
            throw new IllegalArgumentException("Percentages must add up to 100");
        }
        long[] shares = new long[users.size()];
        long used = 0;
        for (int i = 0; i < shares.length; i++) {
            shares[i] = amount * basisPoints.get(i) / 10_000;    // rounds down
            used += shares[i];
        }
        for (int i = 0; used < amount; i++, used++) shares[i]++;   // leftover paise
        List<Split> result = new ArrayList<>();
        for (int i = 0; i < shares.length; i++) {
            result.add(new Split(users.get(i), shares[i]));
        }
        return result;
    }
}
// endregion:strategies

// region:balances
class BalanceSheet {
    // owes.get(a).get(b) > 0 means b owes a that many paise
    private final Map<User, Map<User, Long>> owes = new HashMap<>();

    void add(User creditor, User debtor, long paise) {
        if (creditor.equals(debtor) || paise == 0) return;       // you never owe yourself
        owes.computeIfAbsent(creditor, k -> new HashMap<>())
            .merge(debtor, paise, Long::sum);
        owes.computeIfAbsent(debtor, k -> new HashMap<>())
            .merge(creditor, -paise, Long::sum);
    }

    /** Positive: is owed money. Negative: owes money. */
    long net(User user) {
        return owes.getOrDefault(user, Map.of()).values().stream()
                   .mapToLong(Long::longValue).sum();
    }
}
// endregion:balances

// region:service
class ExpenseService {
    private final BalanceSheet sheet = new BalanceSheet();
    private final List<Expense> expenses = new ArrayList<>();

    synchronized Expense addExpense(String description, User paidBy, long amountPaise,
            List<User> users, SplitStrategy strategy, List<Long> inputs) {
        if (amountPaise <= 0) throw new IllegalArgumentException("Amount must be positive");
        List<Split> splits = strategy.split(amountPaise, users, inputs);
        for (Split s : splits) sheet.add(paidBy, s.user(), s.paise());
        var expense = new Expense(description, paidBy, amountPaise, List.copyOf(splits));
        expenses.add(expense);
        return expense;
    }

    /** "from" paid "to" back: their debt goes down. */
    synchronized void settle(User from, User to, long paise) {
        sheet.add(from, to, paise);
    }

    synchronized long net(User user) { return sheet.net(user); }
}
// endregion:service

// region:simplify
record Payment(User from, User to, long paise) {}

class DebtSimplifier {
    /** Greedy: biggest debtor pays biggest creditor, repeat. At most n - 1 payments. */
    List<Payment> simplify(Map<User, Long> net) {
        Comparator<Map.Entry<User, Long>> byAmount = Map.Entry.comparingByValue();
        var creditors = new PriorityQueue<>(byAmount.reversed());   // largest credit first
        var debtors = new PriorityQueue<>(byAmount);                // most negative first
        net.forEach((user, amount) -> {
            if (amount > 0) creditors.add(Map.entry(user, amount));
            if (amount < 0) debtors.add(Map.entry(user, amount));
        });
        List<Payment> payments = new ArrayList<>();
        while (!creditors.isEmpty() && !debtors.isEmpty()) {
            var c = creditors.poll();
            var d = debtors.poll();
            long amount = Math.min(c.getValue(), -d.getValue());
            payments.add(new Payment(d.getKey(), c.getKey(), amount));
            if (c.getValue() > amount) {
                creditors.add(Map.entry(c.getKey(), c.getValue() - amount));
            }
            if (-d.getValue() > amount) {
                debtors.add(Map.entry(d.getKey(), d.getValue() + amount));
            }
        }
        return payments;
    }
}
// endregion:simplify

public class SplitwiseDemo {
    public static void main(String[] args) {
        User asha = new User("Asha"), ben = new User("Ben"), cara = new User("Cara");
        ExpenseService service = new ExpenseService();

        Expense taxi = service.addExpense("Taxi", asha, 10_001, List.of(asha, ben, cara),
                new EqualSplit(), List.of());
        check(taxi.splits().get(0).paise() == 3_334 && taxi.splits().get(2).paise() == 3_333, "3334/3334/3333");
        check(service.net(asha) == 6_667 && service.net(ben) == -3_334 && service.net(cara) == -3_333, "nets");
        service.addExpense("Snacks", ben, 3_000, List.of(ben, cara), new ExactSplit(), List.of(1_500L, 1_500L));
        check(service.net(ben) == -1_834 && service.net(cara) == -4_833, "after snacks");
        check(service.net(asha) + service.net(ben) + service.net(cara) == 0, "sums to zero");
        List<Split> pct = new PercentSplit().split(101, List.of(asha, ben, cara), List.of(5_000L, 3_000L, 2_000L));
        check(pct.get(0).paise() == 51 && pct.get(1).paise() == 30 && pct.get(2).paise() == 20, "51/30/20");

        List<Payment> plan = new DebtSimplifier().simplify(
                Map.of(asha, 7_000L, ben, -3_000L, cara, -4_000L));
        check(plan.size() == 2 && plan.get(0).from().equals(cara) && plan.get(0).paise() == 4_000, "Cara pays 40");
        service.settle(ben, asha, 1_834);
        check(service.net(ben) == 0, "Ben settled");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
