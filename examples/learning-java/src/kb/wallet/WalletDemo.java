package kb.wallet;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

// region:wallet
class Wallet {
    private final String id, owner;
    private final long maxBalancePaise;
    private long balancePaise;

    Wallet(String id, String owner, long maxBalancePaise) {
        this.id = id; this.owner = owner; this.maxBalancePaise = maxBalancePaise;
    }
    String getId()        { return id; }
    String getOwner()     { return owner; }
    long getBalance()     { return balancePaise; }

    void credit(long amount) {
        if (balancePaise + amount > maxBalancePaise)
            throw new WalletException("Wallet limit exceeded for " + owner);
        balancePaise += amount;
    }
    void debit(long amount) {
        if (balancePaise < amount) throw new WalletException("Insufficient balance");
        balancePaise -= amount;
    }
}

class WalletException extends RuntimeException {
    WalletException(String msg) { super(msg); }
}
// endregion:wallet

// region:ledger
enum TxType { TOP_UP, PAYMENT, TRANSFER }

/** One money movement, recorded once and never edited. */
record Transaction(String id, String idempotencyKey, TxType type,
                   String fromWallet, String toWallet, long amountPaise, Instant at) {}
// endregion:ledger

// region:service
class WalletService {
    private final Map<String, Wallet> wallets = new ConcurrentHashMap<>();
    private final Map<String, Transaction> byKey = new ConcurrentHashMap<>();
    private final List<Transaction> ledger = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, Object> keyLocks = new ConcurrentHashMap<>();
    private final AtomicLong nextTx = new AtomicLong(1);

    Wallet open(String id, String owner, long maxBalancePaise) {
        Wallet w = new Wallet(id, owner, maxBalancePaise);
        wallets.put(id, w);
        return w;
    }

    Transaction topUp(String key, String walletId, long amount) {
        return once(key, () -> {
            Wallet w = wallet(walletId);
            synchronized (w) { w.credit(amount); }
            return record(key, TxType.TOP_UP, "BANK", walletId, amount);
        });
    }

    /** Move money between two wallets: both change, or neither does. */
    Transaction transfer(String key, String fromId, String toId, long amount) {
        if (amount <= 0) throw new WalletException("Amount must be positive");
        if (fromId.equals(toId)) throw new WalletException("Same wallet");
        return once(key, () -> {
            Wallet from = wallet(fromId), to = wallet(toId);
            Wallet first = fromId.compareTo(toId) < 0 ? from : to;   // fixed lock order
            Wallet second = first == from ? to : from;
            synchronized (first) {
                synchronized (second) {
                    from.debit(amount);                 // throws before anything changes
                    try { to.credit(amount); }
                    catch (WalletException e) { from.credit(amount); throw e; }   // undo
                }
            }
            return record(key, TxType.TRANSFER, fromId, toId, amount);
        });
    }

    /** The same idempotency key always returns the first result. */
    private Transaction once(String key, Callable<Transaction> work) {
        synchronized (keyLocks.computeIfAbsent(key, k -> new Object())) {   // per key only
            Transaction done = byKey.get(key);
            if (done != null) return done;
            try { return work.call(); }
            catch (WalletException e) { throw e; }
            catch (Exception e) { throw new IllegalStateException(e); }
        }
    }

    private Transaction record(String key, TxType type, String from, String to, long amt) {
        Transaction t = new Transaction("TX-" + nextTx.getAndIncrement(), key, type,
                from, to, amt, Instant.now());
        ledger.add(t);
        byKey.put(key, t);
        return t;
    }

    Wallet wallet(String id) {
        Wallet w = wallets.get(id);
        if (w == null) throw new WalletException("No wallet " + id);
        return w;
    }
    List<Transaction> ledger() { return List.copyOf(ledger); }
}
// endregion:service

public class WalletDemo {
    public static void main(String[] args) throws Exception {
        WalletService svc = new WalletService();
        Wallet asha = svc.open("W-ASHA", "Asha", 1_000_000);      // limit Rs 10,000
        Wallet bilal = svc.open("W-BILAL", "Bilal", 1_000_000);

        svc.topUp("upi-ref-771", "W-ASHA", 200_000);                  // Rs 2,000
        Transaction t1 = svc.transfer("asha-pay-1", "W-ASHA", "W-BILAL", 50_000);
        Transaction t2 = svc.transfer("asha-pay-1", "W-ASHA", "W-BILAL", 50_000);  // retry
        check(t1 == t2, "retry returns the first transfer");
        check(asha.getBalance() == 150_000 && bilal.getBalance() == 50_000, "moved once");

        try { svc.transfer("asha-pay-2", "W-ASHA", "W-BILAL", 900_000); check(false, "short"); }
        catch (WalletException e) { check(asha.getBalance() == 150_000, "nothing changed"); }

        svc.topUp("upi-ref-772", "W-BILAL", 940_000);                 // Bilal at Rs 9,900
        try { svc.transfer("asha-pay-3", "W-ASHA", "W-BILAL", 20_000); check(false, "limit"); }
        catch (WalletException e) {
            check(asha.getBalance() == 150_000 && bilal.getBalance() == 990_000, "undone");
        }

        // 200 transfers in opposite directions at once: no deadlock, money conserved
        long before = asha.getBalance() + bilal.getBalance();
        try (ExecutorService pool = Executors.newFixedThreadPool(8)) {
            for (int i = 0; i < 100; i++) {
                int n = i;
                pool.submit(() -> svc.transfer("a" + n, "W-ASHA", "W-BILAL", 100));
                pool.submit(() -> svc.transfer("b" + n, "W-BILAL", "W-ASHA", 100));
            }
        }
        check(asha.getBalance() + bilal.getBalance() == before, "money conserved");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
