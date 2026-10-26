package kb.atm;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/** Teaching mechanism: one machine, one currency, bounded adapter calls, memory-only records. */
public final class Atm {
    private Atm() {}

    // BEGIN contracts
    public enum SessionState { IDLE, CARD_INSERTED, AUTHENTICATED, CARD_ERROR }
    public enum AuthStatus { AUTHORIZED, DENIED, UNAVAILABLE }
    public enum HoldStatus { HELD, DECLINED, UNKNOWN }
    public enum Settlement { APPLIED, UNKNOWN }
    public enum Stage {
        NO_NOTES, DECLINED, FUNDS_UNKNOWN, DISPENSING, CASH_UNKNOWN,
        SETTLING, SETTLEMENT_UNKNOWN, COMPLETED, PARTIAL, NO_CASH
    }
    public record PinEvidence(String secureInputReference) {
        public PinEvidence { requireKey(secureInputReference); }
    }
    public record AuthReply(AuthStatus status, String accountReference) {
        public AuthReply {
            Objects.requireNonNull(status);
            if (status == AuthStatus.AUTHORIZED) requireKey(accountReference);
        }
    }
    public record Funds(long ledgerCents, long heldCents) {
        public long availableCents() { return ledgerCents - heldCents; }
    }
    public interface Bank {
        AuthReply authenticate(String cardReference, PinEvidence evidence);
        Funds balance(String accountReference);
        HoldStatus reserve(String id, String accountReference, int requestedCents);
        HoldStatus lookupHold(String id);
        Settlement settle(String id, int deliveredCents);
    }
    public interface Dispenser {
        Report dispense(String commandId, Notes plan);
        Report lookup(String commandId);
    }
    public interface CardReader { boolean eject(); }

    /** The port must distinguish final customer delivery from notes merely presented. */
    public record Report(boolean finalEvidence, Notes delivered, Notes reusable, Notes quarantined) {
        public Report {
            Objects.requireNonNull(delivered);
            Objects.requireNonNull(reusable);
            Objects.requireNonNull(quarantined);
        }
        public static Report unknown() { return new Report(false, Notes.NONE, Notes.NONE, Notes.NONE); }
        private boolean accountsFor(Notes plan) {
            return finalEvidence
                && (long) delivered.twenties() + reusable.twenties() + quarantined.twenties() == plan.twenties()
                && (long) delivered.fifties() + reusable.fifties() + quarantined.fifties() == plan.fifties();
        }
    }
    public record WithdrawalView(String id, Stage stage, int requestedCents,
                                 Notes plan, long deliveredCents) {}
    public record InventoryView(Notes available, Notes reserved, Notes quarantined) {}
    public record SessionView(SessionState state, String id, int failedAttempts) {}
    // END contracts

    // BEGIN notes
    public record Notes(int twenties, int fifties) {
        public static final Notes NONE = new Notes(0, 0);
        public Notes {
            if (twenties < 0 || fifties < 0) throw new IllegalArgumentException("Negative note count");
        }
        public long valueCents() { return 2_000L * twenties + 5_000L * fifties; }
        public Notes plus(Notes other) {
            return new Notes(Math.addExact(twenties, other.twenties), Math.addExact(fifties, other.fifties));
        }
        public Notes minus(Notes other) { return new Notes(twenties - other.twenties, fifties - other.fifties); }
    }

    /** Try every feasible $50 count, largest first; the remaining amount must be $20 notes. */
    public static Optional<Notes> plan(int amountCents, Notes available) {
        if (amountCents <= 0 || amountCents > 50_000 || amountCents % 1_000 != 0)
            throw new IllegalArgumentException("Amount must be $10 increments, greater than 0, at most $500");
        for (int fifties = Math.min(available.fifties(), amountCents / 5_000); fifties >= 0; fifties--) {
            int rest = amountCents - 5_000 * fifties;
            if (rest % 2_000 == 0 && rest / 2_000 <= available.twenties())
                return Optional.of(new Notes(rest / 2_000, fifties));
        }
        return Optional.empty();
    }
    // END notes

    private static final class CashInventory {
        private Notes available;
        private Notes quarantined = Notes.NONE;
        private final Map<String, Notes> reservations = new HashMap<>();
        private CashInventory(Notes initial) { available = Objects.requireNonNull(initial); }
        private Optional<Notes> reserve(String id, int cents) {
            Optional<Notes> selected = plan(cents, available);
            selected.ifPresent(notes -> {
                available = available.minus(notes);
                reservations.put(id, notes);
            });
            return selected;
        }
        private void release(String id) { available = available.plus(reservations.remove(id)); }
        private void accountFor(String id, Report report) {
            reservations.remove(id);
            available = available.plus(report.reusable());
            quarantined = quarantined.plus(report.quarantined());
        }
        private InventoryView view() {
            Notes reserved = Notes.NONE;
            for (Notes notes : reservations.values()) reserved = reserved.plus(notes);
            return new InventoryView(available, reserved, quarantined);
        }
    }

    private static final class Withdrawal {
        private final String id, sessionId, account;
        private final int requestedCents;
        private final Notes plan;
        private Stage stage;
        private Report evidence;
        private Withdrawal(String id, String sessionId, String account, int cents, Notes plan) {
            this.id = id; this.sessionId = sessionId; this.account = account;
            requestedCents = cents; this.plan = plan;
            stage = plan == null ? Stage.NO_NOTES : Stage.FUNDS_UNKNOWN;
        }
        private WithdrawalView view() {
            long delivered = evidence != null ? evidence.delivered().valueCents()
                : stage == Stage.NO_NOTES || stage == Stage.DECLINED || stage == Stage.FUNDS_UNKNOWN ? 0 : -1;
            return new WithdrawalView(id, stage, requestedCents, plan == null ? Notes.NONE : plan,
                delivered);
        }
        private boolean terminal() {
            return switch (stage) {
                case NO_NOTES, DECLINED, COMPLETED, PARTIAL, NO_CASH -> true;
                default -> false;
            };
        }
    }

    public static final class Machine {
        private final Bank bank;
        private final Dispenser dispenser;
        private final CardReader reader;
        private final CashInventory cash;
        private final Map<String, Withdrawal> withdrawals = new HashMap<>();
        private SessionState sessionState = SessionState.IDLE;
        private String sessionId, cardReference, account, activeId;
        private int sessionSequence, failedAttempts;
        private boolean needsService;

        public Machine(Bank bank, Dispenser dispenser, CardReader reader, Notes initialCash) {
            this.bank = Objects.requireNonNull(bank); this.dispenser = Objects.requireNonNull(dispenser);
            this.reader = Objects.requireNonNull(reader); cash = new CashInventory(initialCash);
        }

        // BEGIN session
        public synchronized void insertCard(String opaqueCardReference) {
            if (sessionState != SessionState.IDLE) throw new IllegalStateException("Card already present");
            requireKey(opaqueCardReference);
            sessionId = "S" + ++sessionSequence; cardReference = opaqueCardReference;
            failedAttempts = 0; sessionState = SessionState.CARD_INSERTED;
        }
        public synchronized AuthStatus enterPin(PinEvidence evidence) {
            if (sessionState != SessionState.CARD_INSERTED) throw new IllegalStateException("Insert card first");
            AuthReply reply = bank.authenticate(cardReference, Objects.requireNonNull(evidence));
            if (reply.status() == AuthStatus.AUTHORIZED) {
                account = reply.accountReference(); sessionState = SessionState.AUTHENTICATED;
            } else if (reply.status() == AuthStatus.DENIED && ++failedAttempts == 3) {
                endSession();
            }
            return reply.status();
        }
        public synchronized void endSession() {
            if (sessionState == SessionState.IDLE) return;
            account = null;
            if (reader.eject()) {
                sessionState = SessionState.IDLE; sessionId = null; cardReference = null;
            } else sessionState = SessionState.CARD_ERROR;
        }
        public synchronized Funds balance() { requireAuthenticated(); return bank.balance(account); }
        public synchronized SessionView session() { return new SessionView(sessionState, sessionId, failedAttempts); }
        public synchronized InventoryView inventory() { return cash.view(); }
        public synchronized boolean cashBlocked() { return activeId != null || needsService; }
        // END session

        // BEGIN withdraw
        public synchronized WithdrawalView withdraw(String id, int amountCents) {
            requireAuthenticated(); requireKey(id);
            Withdrawal old = withdrawals.get(id);
            if (old != null) {
                if (!old.sessionId.equals(sessionId) || old.requestedCents != amountCents)
                    throw new IllegalArgumentException("Withdrawal ID payload conflict");
                return old.view();
            }
            if (cashBlocked()) throw new IllegalStateException("Cash operation unresolved or machine needs service");
            Optional<Notes> selected = cash.reserve(id, amountCents);
            Withdrawal op = new Withdrawal(id, sessionId, account, amountCents, selected.orElse(null));
            withdrawals.put(id, op);
            if (selected.isEmpty()) return op.view();
            activeId = id;
            handleHold(op, bank.reserve(id, account, amountCents));
            return op.view();
        }

        /** Trusted maintenance operation; a customer UI must not expose this as an unrestricted endpoint. */
        public synchronized WithdrawalView reconcile(String id) {
            Withdrawal op = Objects.requireNonNull(withdrawals.get(id), "Unknown withdrawal");
            if (op.terminal()) return op.view();
            switch (op.stage) {
                case FUNDS_UNKNOWN -> handleHold(op, bank.lookupHold(id));
                case DISPENSING, CASH_UNKNOWN -> handleReport(op, dispenser.lookup(id));
                case SETTLING, SETTLEMENT_UNKNOWN -> settle(op);
                default -> throw new IllegalStateException("Unexpected phase");
            }
            return op.view();
        }
        // END withdraw

        // BEGIN resolve
        private void handleHold(Withdrawal op, HoldStatus result) {
            if (result == null || result == HoldStatus.UNKNOWN) { op.stage = Stage.FUNDS_UNKNOWN; return; }
            if (result == HoldStatus.DECLINED) {
                cash.release(op.id); op.stage = Stage.DECLINED; activeId = null; return;
            }
            op.stage = Stage.DISPENSING; // Record intent before the first external cash command.
            handleReport(op, dispenser.dispense(op.id, op.plan));
        }

        private void handleReport(Withdrawal op, Report report) {
            if (report == null || !report.accountsFor(op.plan)) {
                op.stage = Stage.CASH_UNKNOWN; // Do not refund, free notes or issue a new cash command.
                return;
            }
            op.evidence = report;
            cash.accountFor(op.id, report);
            needsService |= report.quarantined().valueCents() > 0;
            op.stage = Stage.SETTLING;
            settle(op);
        }

        private void settle(Withdrawal op) {
            int deliveredCents = Math.toIntExact(op.evidence.delivered().valueCents());
            if (bank.settle(op.id, deliveredCents) != Settlement.APPLIED) {
                op.stage = Stage.SETTLEMENT_UNKNOWN;
                return;
            }
            op.stage = deliveredCents == op.requestedCents ? Stage.COMPLETED
                : deliveredCents == 0 ? Stage.NO_CASH : Stage.PARTIAL;
            activeId = null;
        }
        // END resolve

        private void requireAuthenticated() {
            if (sessionState != SessionState.AUTHENTICATED) throw new IllegalStateException("Authentication required");
        }
    }

    private static void requireKey(String key) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("Missing reference");
    }
}
