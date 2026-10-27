package kb.library;

import java.time.LocalDate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static kb.library.Library.*;
import static kb.library.LibraryDemo.*;

public final class LibraryChecks {
    private static int checks;
    public static void main(String[] args) throws Exception {
        catalogueAndComposition(); checkoutAndLimit(); fifoAndStaleTokens(); renewal(); datesAndFineOnce(); repairAndEligibility(); concurrentCheckout();
        System.out.printf("PASS: %,d checks; edition/copy ownership, FIFO and stale tokens, limits, renewal, local-date fines, repair and concurrent checkout%n", checks);
    }
    private static void catalogueAndComposition() {
        Fixture f = fixture(); Service s = f.service();
        check(s.search("java").size() == 1 && s.search("EXAMPLE AUTHOR").size() == 1 && s.search("demo-isbn-1").size() == 1,"catalogue fields searchable");
        s.addCopy("C18","E1"); check(s.search("java").size() == 1 && s.copies().size() == 2,"one edition has separate physical copies");
        LoanView loan = s.checkout("plus","C17","C",null);
        check(loan.due().equals(LocalDate.of(2026,10,22)) && loan.terms().equals(PLUS),"member composes plan and loan freezes its terms");
        expect(UnsupportedOperationException.class, () -> s.copies().clear());
    }
    private static void checkoutAndLimit() {
        Fixture f = fixture(); Service s = f.service();
        s.addMember("one",new Plan("One",1,7,1,50));
        s.addEdition(new BookEdition("E2","demo-isbn-2","Data Basics","Other Author")); s.addCopy("D1","E2");
        LoanView first = s.checkout("first","C17","one",null);
        check(s.checkout("first","C17","one",null).equals(first),"checkout retry returns original receipt");
        expect(IllegalArgumentException.class, () -> s.checkout("first","D1","one",null));
        expect(IllegalStateException.class, () -> s.checkout("second","D1","one",null));
        s.returnCopy("C17",first.id(),Condition.GOOD);
        check(s.checkout("second","D1","one",null).copyId().equals("D1"),"return releases member capacity");
        s.setActive("A",false); expect(IllegalStateException.class, () -> s.checkout("inactive","C17","A",null));
    }
    private static void fifoAndStaleTokens() {
        Fixture f = fixture(); Service s = f.service(); LoanView first = s.checkout("A","C17","A",null);
        s.placeHold("B","E1","B"); s.placeHold("C","E1","C");
        check(s.placeHold("B","E1","B").state() == HoldState.WAITING && s.holds().size() == 2,"stable hold ID does not append twice");
        expect(IllegalStateException.class, () -> s.placeHold("B-duplicate","E1","B"));
        f.clock().set("2026-10-18"); ReturnReceipt receipt = s.returnCopy("C17",first.id(),Condition.GOOD);
        Pickup old = s.copy("C17").pickup();
        check(old.memberId().equals("B") && old.pickupBy().equals(LocalDate.of(2026,10,20)),"FIFO B and inclusive pickup deadline");
        expect(IllegalStateException.class, () -> s.checkout("wrong","C17","C",old.token()));
        f.clock().set("2026-10-20"); check(!s.expirePickup("C17",old.token()),"deadline day remains valid");
        f.clock().set("2026-10-21"); check(s.expirePickup("C17",old.token()),"expiry after deadline");
        Pickup current = s.copy("C17").pickup();
        check(current.memberId().equals("C") && !current.token().equals(old.token()),"next reader has fresh assignment token");
        check(!s.expirePickup("C17",old.token()) && s.copy("C17").pickup().equals(current),"old timer cannot release a newer pickup");
        expect(IllegalStateException.class, () -> s.checkout("old-pickup","C17","B",old.token()));
        LoanView second = s.checkout("C","C17","C",current.token());
        check(s.returnCopy("C17",first.id(),Condition.GOOD).equals(receipt),"old return replays saved receipt");
        check(s.copy("C17").state() == CopyState.ON_LOAN && s.copy("C17").loanId().equals(second.id()),"old return cannot close new borrower loan");
        check(!s.expirePickup("C17",current.token()),"consumed pickup token cannot release active loan");
        check(s.returns().size() == 1 && s.pickupNotices().size() == 2,"fine and ready intent recorded only once per identity");
    }
    private static void renewal() {
        Fixture f = fixture(); Service s = f.service(); LoanView loan = s.checkout("A","C17","A",null);
        f.clock().set("2026-10-12"); RenewalReceipt renewal = s.renew("R1",loan.id(),"A");
        check(renewal.due().equals(LocalDate.of(2026,10,29)),"renew from existing due date");
        check(s.renew("R1",loan.id(),"A").equals(renewal) && s.loan(loan.id()).renewals() == 1,"renewal retry does not extend twice");
        expect(IllegalStateException.class, () -> s.renew("R2",loan.id(),"A"));
        Fixture queued = fixture(); LoanView waitingLoan = queued.service().checkout("A","C17","A",null);
        queued.service().placeHold("B","E1","B");
        expect(IllegalStateException.class, () -> queued.service().renew("blocked",waitingLoan.id(),"A"));
        Fixture overdue = fixture(); LoanView late = overdue.service().checkout("A","C17","A",null); overdue.clock().set("2026-10-16");
        expect(IllegalStateException.class, () -> overdue.service().renew("late",late.id(),"A"));
    }
    private static void datesAndFineOnce() {
        String[] returned = {"2026-10-15","2026-10-16","2026-10-18"}; long[] late = {0,1,3};
        for (int i = 0; i < returned.length; i++) {
            Fixture f = fixture(); Service s = f.service(); LoanView loan = s.checkout("A","C17","A",null);
            check(loan.due().equals(LocalDate.of(2026,10,15)),"14 local dates to due date");
            f.clock().set(returned[i]); s.setActive("A",false);
            ReturnReceipt result = s.returnCopy("C17",loan.id(),Condition.GOOD);
            check(result.overdueDays() == late[i] && result.fineCents() == late[i]*50,"calendar fine calculation and inactive return");
            f.clock().set("2026-11-01");
            check(s.returnCopy("C17",loan.id(),Condition.GOOD).equals(result) && s.returns().size() == 1,"return replay cannot reassess fine at later date");
        }
        Fixture year = fixture(); year.clock().set("2026-12-17"); LoanView loan = year.service().checkout("A","C17","A",null);
        year.clock().set("2027-01-02");
        check(year.service().returnCopy("C17",loan.id(),Condition.GOOD).overdueDays() == 2,"calendar arithmetic crosses year boundary");
    }
    private static void repairAndEligibility() {
        Fixture f = fixture(); Service s = f.service(); LoanView loan = s.checkout("A","C17","A",null); s.placeHold("B","E1","B");
        s.returnCopy("C17",loan.id(),Condition.DAMAGED);
        check(s.copy("C17").state() == CopyState.REPAIR && s.hold("B").state() == HoldState.WAITING,"damaged return does not allocate");
        s.finishRepair("C17"); check(s.copy("C17").pickup().memberId().equals("B"),"repair completion serves queue");

        Fixture inactive = fixture(); Service other = inactive.service(); LoanView first = other.checkout("A","C17","A",null);
        other.placeHold("B","E1","B"); other.placeHold("C","E1","C"); other.setActive("B",false);
        other.returnCopy("C17",first.id(),Condition.GOOD);
        check(other.hold("B").state() == HoldState.CANCELLED && other.hold("B").reason().equals("Membership inactive"),"ineligible queue head cancelled explicitly");
        check(other.copy("C17").pickup().memberId().equals("C"),"FIFO among remaining eligible readers");

        Fixture limited = fixture(); Service limitedService = limited.service(); limitedService.addMember("Q",new Plan("One",1,14,1,50));
        limitedService.addEdition(new BookEdition("E2","demo-isbn-2","Data Basics","Other Author")); limitedService.addCopy("D1","E2");
        LoanView a = limitedService.checkout("A","C17","A",null); limitedService.placeHold("Q","E1","Q"); limitedService.placeHold("C","E1","C");
        limitedService.checkout("Q-other","D1","Q",null); limitedService.returnCopy("C17",a.id(),Condition.GOOD);
        check(limitedService.hold("Q").reason().equals("Borrowing limit reached") && limitedService.copy("C17").pickup().memberId().equals("C"),"eligibility checked again when allocating");
    }
    private static void concurrentCheckout() throws Exception {
        Fixture f = fixture(); Service s = f.service(); CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> { start.await(5,TimeUnit.SECONDS); return tryCheckout(s,"race-A","C17","A"); });
            var b = pool.submit(() -> { start.await(5,TimeUnit.SECONDS); return tryCheckout(s,"race-B","C17","B"); }); start.countDown();
            check(a.get(5,TimeUnit.SECONDS) != b.get(5,TimeUnit.SECONDS),"one of two last-copy checkouts wins");
            check(s.loans().stream().filter(l -> l.returned() == null).count() == 1,"one active loan per copy after race");
            Fixture limited = fixture(); Service one = limited.service();
            one.addMember("M",new Plan("One",1,14,1,50));
            one.addEdition(new BookEdition("E2","demo-isbn-2","Data Basics","Other Author")); one.addCopy("D1","E2");
            CountDownLatch memberStart = new CountDownLatch(1);
            var c = pool.submit(() -> { memberStart.await(5,TimeUnit.SECONDS); return tryCheckout(one,"slot-A","C17","M"); });
            var d = pool.submit(() -> { memberStart.await(5,TimeUnit.SECONDS); return tryCheckout(one,"slot-B","D1","M"); }); memberStart.countDown();
            check(c.get(5,TimeUnit.SECONDS) != d.get(5,TimeUnit.SECONDS),"two copies cannot consume one member slot twice");
            check(one.members().stream().filter(m -> m.id().equals("M")).findFirst().orElseThrow().activeLoans() == 1,"member limit survives concurrent checkouts");
        } finally { start.countDown(); }
    }
    private static boolean tryCheckout(Service s, String key, String copy, String member) {
        try { s.checkout(key,copy,member,null); return true; } catch (IllegalStateException expected) { return false; }
    }
    private static void expect(Class<? extends Throwable> type, Runnable action) {
        try { action.run(); } catch (Throwable error) { check(type.isInstance(error),"expected " + type.getSimpleName()); return; }
        throw new AssertionError("Expected " + type.getSimpleName());
    }
    private static void check(boolean condition, String message) { checks++; if (!condition) throw new AssertionError(message); }
}
