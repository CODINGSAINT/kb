package kb.atm;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static kb.atm.Atm.*;
import static kb.atm.DemoPorts.*;

public final class AtmChecks {
    private static int checks;

    public static void main(String[] args) throws Exception {
        notePlannerMatchesBoundedSearch();
        sessionRules();
        completeAndRetry();
        noCashAndDecline();
        unknownCashAndPartialReconciliation();
        bankReplyLoss();
        invalidDeviceEvidence();
        sharedBankHoldRace();
        System.out.printf("PASS: %,d checks; bounded note allocation, session rules, stable IDs, bank/cash uncertainty, partial reconciliation and atomic bank holds%n", checks);
    }

    private static void notePlannerMatchesBoundedSearch() {
        for (int twenties = 0; twenties <= 5; twenties++) {
            for (int fifties = 0; fifties <= 4; fifties++) {
                Notes available = new Notes(twenties, fifties);
                for (int cents = 1_000; cents <= 50_000; cents += 1_000) {
                    int best = Integer.MAX_VALUE;
                    for (int t = 0; t <= twenties; t++)
                        for (int f = 0; f <= fifties; f++)
                            if (2_000 * t + 5_000 * f == cents) best = Math.min(best, t + f);
                    var result = plan(cents, available);
                    check(result.isPresent() == (best != Integer.MAX_VALUE), "planner feasibility");
                    if (result.isPresent()) {
                        Notes selected = result.get();
                        check(selected.valueCents() == cents, "exact amount");
                        check(selected.twenties() <= twenties && selected.fifties() <= fifties, "cassette bounds");
                        check(selected.twenties() + selected.fifties() == best, "fewest notes for chosen denominations");
                    }
                }
            }
        }
        check(plan(6_000, new Notes(3, 1)).orElseThrow().equals(new Notes(3, 0)), "greedy $50 trap is avoided");
        expect(IllegalArgumentException.class, () -> plan(0, new Notes(3, 1)));
        expect(IllegalArgumentException.class, () -> plan(2_001, new Notes(3, 1)));
    }

    private static void sessionRules() {
        MemoryBank bank = new MemoryBank(10_000); MemoryReader reader = new MemoryReader();
        Machine machine = new Machine(bank, new MemoryDispenser(DemoPorts::full), reader, new Notes(3,1));
        expect(IllegalStateException.class, () -> machine.withdraw("unauth", 2_000));
        machine.insertCard("opaque-card-reference");
        bank.authentication = AuthStatus.DENIED;
        machine.enterPin(new PinEvidence("secure-input-handle"));
        machine.enterPin(new PinEvidence("secure-input-handle"));
        bank.authentication = AuthStatus.UNAVAILABLE;
        machine.enterPin(new PinEvidence("secure-input-handle"));
        check(machine.session().failedAttempts() == 2, "unavailable authentication is not a wrong PIN");
        bank.authentication = AuthStatus.DENIED;
        machine.enterPin(new PinEvidence("secure-input-handle"));
        check(machine.session().state() == SessionState.IDLE && reader.ejectCalls == 1, "chosen three-denial policy ejects");
        machine.insertCard("another-opaque-reference");
        reader.ejectSucceeds = false;
        machine.endSession();
        check(machine.session().state() == SessionState.CARD_ERROR, "failed ejection blocks new card");
        expect(IllegalStateException.class, () -> machine.insertCard("third-card"));
    }

    private static void completeAndRetry() {
        MemoryBank bank = new MemoryBank(10_000); MemoryDispenser device = new MemoryDispenser(DemoPorts::full);
        Machine machine = authenticated(bank, device);
        WithdrawalView result = machine.withdraw("W17", 6_000);
        check(result.stage() == Stage.COMPLETED && result.plan().equals(new Notes(3,0)), "completed exact withdrawal");
        check(bank.balance("demo-account").equals(new Funds(4_000,0)), "single completed debit");
        check(machine.inventory().available().equals(new Notes(0,1)), "only requested notes leave inventory");
        check(machine.withdraw("W17",6_000).equals(result), "stable request returns saved result");
        expect(IllegalArgumentException.class, () -> machine.withdraw("W17",2_000));
        check(device.commandCalls == 1 && bank.settlementEffects == 1, "retry cannot repeat effects");
        check(machine.reconcile("W17").equals(result), "terminal reconciliation is harmless");
        check(machine.withdraw("W18",2_000).stage() == Stage.NO_NOTES, "cannot assemble amount from remaining cassette");
        check(bank.reserveCalls == 1, "no bank hold when no exact note plan exists");
    }

    private static void noCashAndDecline() {
        MemoryBank bank = new MemoryBank(10_000); MemoryDispenser device = new MemoryDispenser(DemoPorts::none);
        Machine machine = authenticated(bank,device);
        check(machine.withdraw("none",6_000).stage() == Stage.NO_CASH, "proven zero delivery settles zero");
        check(machine.inventory().available().equals(new Notes(3,1)), "proven reusable notes restored");
        check(bank.balance("demo-account").equals(new Funds(10_000,0)), "hold released without debit");
        MemoryBank poor = new MemoryBank(4_000); MemoryDispenser unused = new MemoryDispenser(DemoPorts::full);
        Machine declined = authenticated(poor,unused);
        check(declined.withdraw("declined",6_000).stage() == Stage.DECLINED, "bank decline");
        check(unused.commandCalls == 0 && declined.inventory().available().equals(new Notes(3,1)), "decline never moves cash");
    }

    private static void unknownCashAndPartialReconciliation() {
        MemoryBank bank = new MemoryBank(10_000); MemoryDispenser device = new MemoryDispenser(plan -> Report.unknown());
        Machine machine = authenticated(bank,device);
        WithdrawalView unknown = machine.withdraw("uncertain",6_000);
        check(unknown.stage() == Stage.CASH_UNKNOWN && unknown.deliveredCents() == -1, "unknown is not zero delivery");
        check(bank.balance("demo-account").equals(new Funds(10_000,6_000)), "unknown preserves full funds hold");
        check(machine.inventory().reserved().equals(new Notes(3,0)), "unknown preserves all reserved notes");
        machine.withdraw("uncertain",6_000); machine.reconcile("uncertain");
        check(device.commandCalls == 1 && bank.settlementEffects == 0, "retry and lookup do not repeat cash or refund");
        expect(IllegalStateException.class, () -> machine.withdraw("another",2_000));
        machine.endSession();
        check(machine.session().state() == SessionState.IDLE && machine.cashBlocked(), "card session can end while withdrawal survives");
        device.resolve("uncertain",twoTwentiesWithOneQuarantined());
        WithdrawalView partial = machine.reconcile("uncertain");
        check(partial.stage() == Stage.PARTIAL && partial.deliveredCents() == 4_000, "partial amount follows final delivery evidence");
        check(bank.balance("demo-account").equals(new Funds(6_000,0)), "debit delivered $40 and release remaining $20 hold");
        check(machine.inventory().reserved().equals(Notes.NONE), "reservation accounted once");
        check(machine.inventory().quarantined().equals(new Notes(1,0)), "jammed note stays unavailable");
        check(machine.cashBlocked(), "quarantine requires service under chosen policy");
        machine.reconcile("uncertain");
        check(device.commandCalls == 1 && bank.settlementEffects == 1, "reconciliation does not repeat effects");
    }

    private static void bankReplyLoss() {
        MemoryBank bank = new MemoryBank(10_000); bank.loseReserveReply = true;
        MemoryDispenser device = new MemoryDispenser(DemoPorts::full); Machine machine = authenticated(bank,device);
        check(machine.withdraw("hold-lost",6_000).stage() == Stage.FUNDS_UNKNOWN, "authorization timeout has its own phase");
        check(device.commandCalls == 0, "no cash before confirmed hold");
        check(machine.reconcile("hold-lost").stage() == Stage.COMPLETED && device.commandCalls == 1, "query confirms hold then issues first command");

        MemoryBank settlementBank = new MemoryBank(10_000); settlementBank.loseSettlementReply = true;
        MemoryDispenser settlementDevice = new MemoryDispenser(DemoPorts::full);
        Machine settlement = authenticated(settlementBank,settlementDevice);
        check(settlement.withdraw("settle-lost",6_000).stage() == Stage.SETTLEMENT_UNKNOWN, "lost settlement reply stays unresolved");
        check(settlement.cashBlocked(), "new cash waits for settlement");
        check(settlement.reconcile("settle-lost").stage() == Stage.COMPLETED, "same bank settlement ID resolves lost reply");
        check(settlementBank.settlementEffects == 1 && settlementDevice.commandCalls == 1, "idempotent settlement does not repeat cash or debit");
    }

    private static void invalidDeviceEvidence() {
        MemoryBank bank = new MemoryBank(10_000);
        MemoryDispenser device = new MemoryDispenser(plan -> new Report(true,new Notes(1,0),Notes.NONE,Notes.NONE));
        Machine machine = authenticated(bank,device);
        check(machine.withdraw("bad-counts",6_000).stage() == Stage.CASH_UNKNOWN, "unaccounted notes make even final-looking evidence uncertain");
        check(machine.inventory().reserved().equals(new Notes(3,0)) && bank.settlementEffects == 0, "inconsistent evidence cannot free cash or funds");
    }

    private static void sharedBankHoldRace() throws Exception {
        MemoryBank bank = new MemoryBank(10_000); CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> { start.await(5,TimeUnit.SECONDS); return bank.reserve("bank-A","demo-account",6_000); });
            var second = pool.submit(() -> { start.await(5,TimeUnit.SECONDS); return bank.reserve("bank-B","demo-account",6_000); });
            start.countDown();
            HoldStatus a = first.get(5,TimeUnit.SECONDS), b = second.get(5,TimeUnit.SECONDS);
            check((a == HoldStatus.HELD && b == HoldStatus.DECLINED) || (b == HoldStatus.HELD && a == HoldStatus.DECLINED), "shared bank atomically admits one of two competing holds");
            check(bank.balance("demo-account").heldCents() == 6_000, "no double reservation of account funds");
        } finally { start.countDown(); }
    }

    private static Machine authenticated(MemoryBank bank, MemoryDispenser device) {
        Machine machine = new Machine(bank,device,new MemoryReader(),new Notes(3,1));
        machine.insertCard("opaque-card-reference");
        check(machine.enterPin(new PinEvidence("secure-input-handle")) == AuthStatus.AUTHORIZED, "fake bank authorizes fixture session");
        return machine;
    }
    private static void expect(Class<? extends Throwable> type, Runnable work) {
        try { work.run(); } catch (Throwable error) { check(type.isInstance(error),"expected " + type.getSimpleName()); return; }
        throw new AssertionError("Expected " + type.getSimpleName());
    }
    private static void check(boolean condition, String explanation) {
        checks++; if (!condition) throw new AssertionError(explanation);
    }
}
