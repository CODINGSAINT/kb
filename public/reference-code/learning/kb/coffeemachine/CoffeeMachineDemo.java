package kb.coffeemachine;

import java.util.*;

// region:recipe
enum Ingredient { COFFEE_G, MILK_ML, WATER_ML, SUGAR_G }

record Drink(String name, int priceRupees, Map<Ingredient, Integer> recipe) {
    static final Drink ESPRESSO = new Drink("Espresso", 30,
            Map.of(Ingredient.COFFEE_G, 8, Ingredient.WATER_ML, 30));
    static final Drink CAPPUCCINO = new Drink("Cappuccino", 60,
            Map.of(Ingredient.COFFEE_G, 8, Ingredient.WATER_ML, 30, Ingredient.MILK_ML, 120));
    static final Drink LATTE = new Drink("Latte", 70,
            Map.of(Ingredient.COFFEE_G, 8, Ingredient.WATER_ML, 30, Ingredient.MILK_ML, 200));
}
// endregion:recipe

// region:inventory
class Inventory {
    private final Map<Ingredient, Integer> stock = new EnumMap<>(Ingredient.class);

    void refill(Ingredient i, int amount) { stock.merge(i, amount, Integer::sum); }
    int level(Ingredient i)               { return stock.getOrDefault(i, 0); }

    boolean canMake(Drink d) {
        return d.recipe().entrySet().stream().allMatch(e -> level(e.getKey()) >= e.getValue());
    }
    void consume(Drink d) {
        if (!canMake(d)) throw new IllegalStateException("Not enough for " + d.name());
        d.recipe().forEach((i, amt) -> stock.merge(i, -amt, Integer::sum));
    }
}
// endregion:inventory

// region:coins
/** Coins the machine holds, largest first. */
class CoinBox {
    private final TreeMap<Integer, Integer> coins = new TreeMap<>(Comparator.reverseOrder());

    void add(int coin, int count) { coins.merge(coin, count, Integer::sum); }
    int count(int coin)           { return coins.getOrDefault(coin, 0); }

    /** Plan change without touching the box; empty if exact change is impossible. */
    Optional<Map<Integer, Integer>> planChange(int amount) {
        Map<Integer, Integer> plan = new LinkedHashMap<>();
        for (var e : coins.entrySet()) {
            int use = Math.min(amount / e.getKey(), e.getValue());
            if (use > 0) { plan.put(e.getKey(), use); amount -= use * e.getKey(); }
        }
        return amount == 0 ? Optional.of(plan) : Optional.empty();
    }
    void pay(Map<Integer, Integer> plan) {
        plan.forEach((c, n) -> coins.merge(c, -n, Integer::sum));
    }
}
// endregion:coins

// region:machine
enum State { IDLE, DRINK_SELECTED }

record Result(boolean served, String drink, Map<Integer, Integer> coinsBack, String msg) {}

class CoffeeMachine {
    private final Inventory inventory;
    private final CoinBox coinBox;
    private State state = State.IDLE;
    private Drink selected;
    private final Map<Integer, Integer> inserted = new LinkedHashMap<>();

    CoffeeMachine(Inventory inventory, CoinBox coinBox) {
        this.inventory = inventory; this.coinBox = coinBox;
    }

    void select(Drink d) {
        if (state != State.IDLE) throw new IllegalStateException("Finish or cancel first");
        if (!inventory.canMake(d)) throw new IllegalStateException(d.name() + " unavailable");
        selected = d; state = State.DRINK_SELECTED;
    }

    void insert(int coin) {
        requireSelected();
        if (!Set.of(1, 2, 5, 10, 20).contains(coin)) throw new IllegalArgumentException(
                "Unknown coin: " + coin);
        inserted.merge(coin, 1, Integer::sum);
    }

    int paid() {
        return inserted.entrySet().stream().mapToInt(e -> e.getKey() * e.getValue()).sum();
    }

    /** Check everything first; only then take the money and brew. */
    Result brew() {
        requireSelected();
        int changeDue = paid() - selected.priceRupees();
        if (changeDue < 0) return new Result(false, null, Map.of(), "Insert ₹" + -changeDue);

        inserted.forEach(coinBox::add);              // their coins can be used for change
        Optional<Map<Integer, Integer>> change = coinBox.planChange(changeDue);
        if (change.isEmpty() || !inventory.canMake(selected)) {
            coinBox.pay(inserted);                   // give back exactly what they put in
            return reset(new Result(false, null, Map.copyOf(inserted), "Refunded"));
        }
        coinBox.pay(change.get());
        inventory.consume(selected);
        return reset(new Result(true, selected.name(), change.get(), "Enjoy!"));
    }

    Result cancel() {
        requireSelected();
        return reset(new Result(false, null, Map.copyOf(inserted), "Cancelled"));
    }

    private void requireSelected() {
        if (state != State.DRINK_SELECTED) throw new IllegalStateException("Select a drink");
    }

    private Result reset(Result r) {
        inserted.clear(); selected = null; state = State.IDLE;
        return r;
    }
    State getState() { return state; }
}
// endregion:machine

public class CoffeeMachineDemo {
    public static void main(String[] args) {
        Inventory inv = new Inventory();
        inv.refill(Ingredient.COFFEE_G, 100);
        inv.refill(Ingredient.WATER_ML, 500);
        inv.refill(Ingredient.MILK_ML, 300);
        CoffeeMachine m = new CoffeeMachine(inv, new CoinBox());   // starts with no coins

        m.select(Drink.CAPPUCCINO);                                   // Asha, ₹60
        m.insert(20); m.insert(20); m.insert(20); m.insert(10);
        Result asha = m.brew();
        check(asha.served() && asha.coinsBack().equals(Map.of(10, 1)), "₹70 paid, ₹10 back");
        check(inv.level(Ingredient.MILK_ML) == 180, "300 - 120 ml milk");

        try { m.select(Drink.LATTE); check(false, "latte needs 200 ml"); }
        catch (IllegalStateException expected) { }

        m.select(Drink.ESPRESSO);                                     // Bilal, ₹30
        m.insert(20); m.insert(20);
        Result bilal = m.brew();                         // needs ₹10 change, box has none
        check(!bilal.served() && bilal.coinsBack().equals(Map.of(20, 2)), "refund both coins");
        check(inv.level(Ingredient.COFFEE_G) == 92, "no coffee used");

        m.select(Drink.ESPRESSO);
        m.insert(20); m.insert(10);                                   // exact money
        check(m.brew().served(), "exact money works");

        m.select(Drink.ESPRESSO);                        // Chetan changes his mind
        m.insert(10);
        check(m.cancel().coinsBack().equals(Map.of(10, 1)), "cancel refunds");
        check(m.getState() == State.IDLE, "back to idle");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
