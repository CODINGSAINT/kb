package kb.atmstate;

import java.util.*;

// region:card
record Card(String number) {}
// endregion:card

// region:bank
/** The bank owns PINs and balances. The ATM only asks questions. */
interface BankService {
    boolean authenticate(Card card, String pin);
    long getBalance(Card card);
    boolean debit(Card card, int amount, String txnId);   // false if the balance is too low
    void reverse(String txnId);                          // undo a debit
}
// endregion:bank

// region:state
interface ATMState {
    void insertCard(ATM atm, Card card);
    void enterPin(ATM atm, String pin);
    void checkBalance(ATM atm);
    void withdraw(ATM atm, int amount);
    void ejectCard(ATM atm);
}
// endregion:state

// region:atm
class ATM {
    private ATMState state = new IdleState();
    private Card currentCard;
    private int wrongPins;
    private String lastMessage = "";
    final BankService bank;
    final CashDispenser dispenser;

    ATM(BankService bank, CashDispenser dispenser) {
        this.bank = bank;
        this.dispenser = dispenser;
    }

    // Every user action is forwarded to the current state.
    void insertCard(Card card) { state.insertCard(this, card); }
    void enterPin(String pin)  { state.enterPin(this, pin); }
    void checkBalance()        { state.checkBalance(this); }
    void withdraw(int amount)  { state.withdraw(this, amount); }
    void ejectCard()           { state.ejectCard(this); }

    void setState(ATMState next) { state = next; }
    ATMState getState()          { return state; }
    Card getCard()               { return currentCard; }
    void setCard(Card card)      { currentCard = card; }
    int addWrongPin()            { return ++wrongPins; }
    void resetWrongPins()        { wrongPins = 0; }
    void show(String message)    { lastMessage = message; }
    String lastMessage()         { return lastMessage; }
}
// endregion:atm

// region:idle
class IdleState implements ATMState {
    public void insertCard(ATM atm, Card card) {
        atm.setCard(card);
        atm.setState(new HasCardState());
        atm.show("Enter your PIN");
    }
    public void enterPin(ATM atm, String pin)  { atm.show("Insert your card first"); }
    public void checkBalance(ATM atm)          { atm.show("Insert your card first"); }
    public void withdraw(ATM atm, int amount)  { atm.show("Insert your card first"); }
    public void ejectCard(ATM atm)             { atm.show("No card inserted"); }
}
// endregion:idle

// region:hascard
class HasCardState implements ATMState {
    private static final int MAX_ATTEMPTS = 3;

    public void enterPin(ATM atm, String pin) {
        if (atm.bank.authenticate(atm.getCard(), pin)) {
            atm.resetWrongPins();
            atm.setState(new AuthenticatedState());
            atm.show("Choose an operation");
        } else if (atm.addWrongPin() >= MAX_ATTEMPTS) {
            ejectCard(atm);
            atm.show("Too many wrong PINs. Card returned");
        } else {
            atm.show("Wrong PIN, try again");
        }
    }
    public void ejectCard(ATM atm) {
        atm.setCard(null);
        atm.resetWrongPins();
        atm.setState(new IdleState());
    }
    public void insertCard(ATM atm, Card card) { atm.show("A card is already inserted"); }
    public void checkBalance(ATM atm)          { atm.show("Enter your PIN first"); }
    public void withdraw(ATM atm, int amount)  { atm.show("Enter your PIN first"); }
}
// endregion:hascard

// region:authenticated
class AuthenticatedState implements ATMState {
    private static final int MAX_WITHDRAWAL = 20_000;
    private int nextTxn = 1;

    public void withdraw(ATM atm, int amount) {
        if (amount <= 0 || amount % 100 != 0 || amount > MAX_WITHDRAWAL) {
            atm.show("Enter a multiple of Rs 100, up to Rs " + MAX_WITHDRAWAL);
            return;
        }
        // 1. Can the machine make this amount from the notes it has?
        Optional<Map<Integer, Integer>> plan = atm.dispenser.plan(amount);
        if (plan.isEmpty()) {
            atm.show("This ATM cannot dispense that amount");
            return;
        }
        String txnId = "txn-" + nextTxn++;
        // 2. The bank checks the balance and debits in one step.
        if (!atm.bank.debit(atm.getCard(), amount, txnId)) {
            atm.show("Insufficient balance");
            return;
        }
        try {
            atm.dispenser.dispense(plan.get());                // 3. give the cash
            atm.show("Please take your cash");
        } catch (IllegalStateException jammed) {
            atm.bank.reverse(txnId);                           // 4. undo the debit
            atm.show("Could not dispense. Your account was not charged");
        }
    }
    public void checkBalance(ATM atm) {
        atm.show("Balance: Rs " + atm.bank.getBalance(atm.getCard()));
    }
    public void ejectCard(ATM atm) {
        atm.setCard(null);
        atm.setState(new IdleState());
        atm.show("Thank you");
    }
    public void insertCard(ATM atm, Card card) { atm.show("A card is already inserted"); }
    public void enterPin(ATM atm, String pin)  { atm.show("Already authenticated"); }
}
// endregion:authenticated

// region:dispenser
class CashDispenser {
    // Largest note first: {500 -> count, 200 -> count, 100 -> count}
    private final TreeMap<Integer, Integer> notes = new TreeMap<>(Comparator.reverseOrder());
    private boolean jammed;

    CashDispenser(Map<Integer, Integer> loaded) { notes.putAll(loaded); }

    /** Greedy: take as many of the largest note as possible, then the next. */
    Optional<Map<Integer, Integer>> plan(int amount) {
        Map<Integer, Integer> plan = new LinkedHashMap<>();
        int remaining = amount;
        for (Map.Entry<Integer, Integer> e : notes.entrySet()) {
            int use = Math.min(remaining / e.getKey(), e.getValue());
            if (use > 0) { plan.put(e.getKey(), use); remaining -= use * e.getKey(); }
        }
        return remaining == 0 ? Optional.of(plan) : Optional.empty();
    }

    void dispense(Map<Integer, Integer> plan) {
        if (jammed) throw new IllegalStateException("Dispenser jammed");
        plan.forEach((note, count) -> notes.merge(note, -count, Integer::sum));
    }
    void jam() { jammed = true; }
}
// endregion:dispenser

public class AtmDemo {
    public static void main(String[] args) {
        Map<String, Long> balances = new HashMap<>(Map.of("4111", 10_000L));
        Map<String, Integer> debits = new HashMap<>();
        BankService bank = new BankService() {
            public boolean authenticate(Card c, String pin) { return pin.equals("1234"); }
            public long getBalance(Card c) { return balances.get(c.number()); }
            public boolean debit(Card c, int amount, String txn) {
                if (balances.get(c.number()) < amount) return false;
                balances.merge(c.number(), -(long) amount, Long::sum); debits.put(txn, amount); return true;
            }
            public void reverse(String txn) { balances.merge("4111", (long) debits.remove(txn), Long::sum); }
        };
        CashDispenser dispenser = new CashDispenser(Map.of(500, 10, 200, 10, 100, 0));
        ATM atm = new ATM(bank, dispenser);
        Card card = new Card("4111");

        atm.withdraw(500);  check(atm.lastMessage().contains("Insert your card"), "no card");
        atm.insertCard(card); atm.withdraw(500); check(atm.lastMessage().contains("PIN first"), "no PIN");
        atm.enterPin("0000"); check(atm.getState() instanceof HasCardState, "still has card");
        atm.enterPin("1234"); check(atm.getState() instanceof AuthenticatedState, "authenticated");
        atm.withdraw(2_700); check(balances.get("4111") == 7_300, "2,700 = 5x500 + 1x200");
        atm.withdraw(600);   check(atm.lastMessage().contains("cannot dispense"), "greedy fails for 600 without 100s");
        dispenser.jam(); atm.withdraw(1_000);
        check(balances.get("4111") == 7_300 && atm.lastMessage().contains("not charged"), "reversed");
        atm.ejectCard(); check(atm.getState() instanceof IdleState, "idle");
        atm.insertCard(card); atm.enterPin("1"); atm.enterPin("2"); atm.enterPin("3");
        check(atm.getState() instanceof IdleState, "three wrong PINs end the session");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
