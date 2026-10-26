package kb.atm;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;
import static kb.atm.Atm.*;

/** Deterministic in-memory fixtures, not banking, PIN or hardware implementations. */
public final class DemoPorts {
    private DemoPorts() {}

    public static final class MemoryBank implements Bank {
        private static final class Hold {
            private final String account;
            private final int requested;
            private final boolean admitted;
            private Integer delivered;
            private Hold(String account, int requested, boolean admitted) {
                this.account = account; this.requested = requested; this.admitted = admitted;
            }
        }
        private final Map<String, Hold> holds = new HashMap<>();
        private long ledger;
        public AuthStatus authentication = AuthStatus.AUTHORIZED;
        public boolean loseReserveReply, loseSettlementReply;
        public int reserveCalls, settlementEffects;

        public MemoryBank(long initialCents) {
            if (initialCents < 0) throw new IllegalArgumentException("Negative balance");
            ledger = initialCents;
        }
        public synchronized AuthReply authenticate(String cardReference, PinEvidence evidence) {
            return new AuthReply(authentication, authentication == AuthStatus.AUTHORIZED ? "demo-account" : null);
        }
        public synchronized Funds balance(String account) {
            if (!"demo-account".equals(account)) throw new IllegalArgumentException("Unknown account");
            long reserved = holds.values().stream().filter(h -> h.admitted && h.delivered == null)
                .mapToLong(h -> h.requested).sum();
            return new Funds(ledger, reserved);
        }
        public synchronized HoldStatus reserve(String id, String account, int requested) {
            reserveCalls++;
            Hold old = holds.get(id);
            if (old != null) {
                if (!old.account.equals(account) || old.requested != requested)
                    throw new IllegalArgumentException("Bank ID payload conflict");
                return old.admitted ? HoldStatus.HELD : HoldStatus.DECLINED;
            }
            boolean admitted = requested > 0 && balance(account).availableCents() >= requested;
            holds.put(id, new Hold(account, requested, admitted));
            if (loseReserveReply) { loseReserveReply = false; return HoldStatus.UNKNOWN; }
            return admitted ? HoldStatus.HELD : HoldStatus.DECLINED;
        }
        public synchronized HoldStatus lookupHold(String id) {
            Hold hold = holds.get(id);
            return hold == null ? HoldStatus.UNKNOWN : hold.admitted ? HoldStatus.HELD : HoldStatus.DECLINED;
        }
        public synchronized Settlement settle(String id, int delivered) {
            Hold hold = holds.get(id);
            if (hold == null || !hold.admitted || delivered < 0 || delivered > hold.requested)
                throw new IllegalArgumentException("Invalid settlement");
            if (hold.delivered != null) {
                if (hold.delivered != delivered) throw new IllegalArgumentException("Settlement payload conflict");
                return Settlement.APPLIED;
            }
            ledger -= delivered;
            hold.delivered = delivered;
            settlementEffects++;
            if (loseSettlementReply) { loseSettlementReply = false; return Settlement.UNKNOWN; }
            return Settlement.APPLIED;
        }
    }

    public static final class MemoryDispenser implements Dispenser {
        private final Function<Notes, Report> behavior;
        private final Map<String, Notes> commands = new HashMap<>();
        private final Map<String, Report> reports = new HashMap<>();
        public int commandCalls;

        public MemoryDispenser(Function<Notes, Report> behavior) { this.behavior = behavior; }
        public synchronized Report dispense(String id, Notes plan) {
            commandCalls++;
            if (commands.putIfAbsent(id, plan) != null)
                throw new IllegalStateException("Teaching fixture detected a repeated physical command");
            Report result = behavior.apply(plan);
            reports.put(id, result);
            return result;
        }
        public synchronized Report lookup(String id) { return reports.getOrDefault(id, Report.unknown()); }
        public synchronized void resolve(String id, Report report) {
            if (!commands.containsKey(id)) throw new IllegalArgumentException("Unknown command");
            Report old = reports.get(id);
            if (old != null && old.finalEvidence() && !old.equals(report))
                throw new IllegalArgumentException("Final device evidence cannot silently change");
            reports.put(id, report);
        }
    }

    public static final class MemoryReader implements CardReader {
        public boolean ejectSucceeds = true;
        public int ejectCalls;
        public boolean eject() { ejectCalls++; return ejectSucceeds; }
    }

    public static Report full(Notes plan) { return new Report(true, plan, Notes.NONE, Notes.NONE); }
    public static Report none(Notes plan) { return new Report(true, Notes.NONE, plan, Notes.NONE); }
    public static Report twoTwentiesWithOneQuarantined() {
        return new Report(true, new Notes(2, 0), Notes.NONE, new Notes(1, 0));
    }
}
