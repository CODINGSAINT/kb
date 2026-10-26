package kb.booking;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static kb.booking.BookingService.*;

public final class BookingChecks {
    static int checks;
    static void ok(boolean value, String why) { checks++; if(!value) throw new AssertionError(why); }
    static void fails(Class<? extends Throwable> type, Runnable r) {
        checks++; try {r.run();} catch(Throwable t) {if(type.isInstance(t))return; throw new AssertionError(t);} throw new AssertionError("expected "+type);
    }
    static final class Time extends Clock {
        Instant now=Instant.parse("2026-10-01T10:00:00Z");
        public ZoneId getZone(){return ZoneOffset.UTC;} public Clock withZone(ZoneId z){return this;} public Instant instant(){return now;}
        void advance(long seconds){now=now.plusSeconds(seconds);}
    }
    static BookingService service(Time time) {
        return new BookingService(Map.of(new Seat("evening","A7"),25000L,new Seat("evening","A8"),25000L,new Seat("evening","A9"),30000L,new Seat("matinee","A7"),20000L),time,Duration.ofSeconds(120));
    }
    static Receipt receipt(Attempt a, Payment p, String charge) {return new Receipt(a.key(),p,charge,a.amountPaise());}
    public static void main(String[] args) throws Exception {
        Time time=new Time(); BookingService s=service(time);
        Reservation a=s.hold("A","cart-1","evening",List.of("A8","A7"));
        ok(a.totalPaise()==50000,"two ₹250 seats freeze a ₹500 quote");
        ok(a.id().equals(s.hold("A","cart-1","evening",List.of("A7","A8")).id()),"reordered retry is same request");
        fails(IllegalArgumentException.class,()->s.hold("A","cart-1","evening",List.of("A9")));
        fails(IllegalStateException.class,()->s.hold("B","try","evening",List.of("A9","A8")));
        ok(s.seats("evening").get(2).state().equals("AVAILABLE"),"failed cart does not reserve A9");
        fails(IllegalArgumentException.class,()->s.hold("B","duplicate","evening",List.of("A9","A9")));
        fails(SecurityException.class,()->s.beginPayment("B",a.id()));
        Attempt attempt=s.beginPayment("A",a.id());
        ok(attempt.equals(s.beginPayment("A",a.id())),"payment retries keep stable intent key");
        s.acceptReceipt(a.id(),receipt(attempt,Payment.UNKNOWN,""));
        ok(s.get("A",a.id()).state()==State.HELD,"uncertain payment does not free seats early");
        time.advance(120);
        ok(s.get("A",a.id()).state()==State.EXPIRED,"exact expiry is expired");
        Reservation b=s.hold("B","cart-2","evening",List.of("A7","A8"));
        s.acceptReceipt(a.id(),receipt(attempt,Payment.CAPTURED,"old-charge"));
        s.acceptReceipt(a.id(),receipt(attempt,Payment.CAPTURED,"old-charge"));
        ok(s.get("A",a.id()).state()==State.EXPIRED,"late capture cannot resurrect expired reservation");
        ok(s.seats("evening").stream().filter(v->v.owner().equals("B")).count()==2,"late capture preserves new owner");
        ok(s.pendingRefunds().size()==1,"late duplicate creates one refund intent");
        ok(s.get("A",a.id()).refundState()==RefundState.PENDING && s.get("A",a.id()).refundAmountPaise()==50000,"owner can see pending late-capture refund");
        Attempt ba=s.beginPayment("B",b.id()); s.acceptReceipt(b.id(),receipt(ba,Payment.CAPTURED,"new-charge"));
        ok(s.get("B",b.id()).state()==State.CONFIRMED,"captured payment confirms live hold");
        time.advance(500);ok(s.get("B",b.id()).state()==State.CONFIRMED,"confirmed seats do not expire");
        s.acceptReceipt(b.id(),receipt(ba,Payment.DECLINED,""));
        ok(s.get("B",b.id()).payment()==Payment.CAPTURED,"stale decline cannot downgrade captured receipt");
        Reservation cancelled=s.cancel("B",b.id());Reservation retryCancel=s.cancel("B",b.id());s.acceptReceipt(b.id(),receipt(ba,Payment.CAPTURED,"new-charge"));
        ok(cancelled.equals(retryCancel) && cancelled.refundState()==RefundState.PENDING && cancelled.refundAmountPaise()==50000,"repeated cancellation exposes same refund state and actual amount");
        ok(s.pendingRefunds().size()==2,"cancellation and duplicate callback do not duplicate refund");
        ok(s.seats("evening").stream().allMatch(v->v.state().equals("AVAILABLE")),"cancel releases owned seats");
        ok(s.hold("A","cart-1","evening",List.of("A7","A8")).state()==State.EXPIRED,"expired retry is not a new hold");
        Reservation m=s.hold("A","matinee","matinee",List.of("A7"));
        ok(m.totalPaise()==20000,"seat identity includes show");
        Attempt ma=s.beginPayment("A",m.id());
        s.acceptReceipt(m.id(),new Receipt(ma.key(),Payment.CAPTURED,"wrong-amount",100L));
        ok(s.get("A",m.id()).state()==State.CANCELLED,"wrong amount cannot buy ticket");
        ok(s.pendingRefunds().stream().anyMatch(r->r.chargeId().equals("wrong-amount")&&r.amountPaise()==100),"refund actual capture not quote");
        fails(IllegalArgumentException.class,()->s.acceptReceipt(m.id(),new Receipt("forged",Payment.CAPTURED,"x",20000)));
        Reservation d=s.hold("D","decline","evening",List.of("A9")); Attempt da=s.beginPayment("D",d.id());
        s.acceptReceipt(d.id(),receipt(da,Payment.DECLINED,""));
        ok(s.get("D",d.id()).state()==State.CANCELLED,"definitive decline ends hold");
        Receipt contradiction=receipt(da,Payment.CAPTURED,"contradictory-charge");
        fails(ReceiptConflict.class,()->s.acceptReceipt(d.id(),contradiction));
        fails(ReceiptConflict.class,()->s.acceptReceipt(d.id(),contradiction));
        ok(s.pendingReconciliations().size()==1 && s.pendingReconciliations().getFirst().chargeId().equals("contradictory-charge"),"contradictory provider evidence creates one owned reconciliation record");
        ok(s.pendingRefunds().stream().noneMatch(r->r.chargeId().equals("contradictory-charge")),"conflicting provider evidence is reconciled before a financial action");
        Reservation c=s.hold("C","cancel-before-callback","evening",List.of("A9")); Attempt ca=s.beginPayment("C",c.id());
        s.cancel("C",c.id());s.acceptReceipt(c.id(),receipt(ca,Payment.CAPTURED,"cancelled-charge"));
        ok(s.pendingRefunds().stream().anyMatch(r->r.chargeId().equals("cancelled-charge")),"capture racing cancellation refunded");
        // 40 genuinely contending callers per round. Exactly one entire cart wins.
        for(int round=0;round<40;round++) {
            BookingService race=service(new Time()); CountDownLatch start=new CountDownLatch(1); AtomicInteger wins=new AtomicInteger();
            try(ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor()) {
                List<Future<?>> jobs=new ArrayList<>();
                for(int i=0;i<40;i++) {String user="U"+i;jobs.add(pool.submit(()->{try{start.await();race.hold(user,"one","evening",List.of("A7","A8"));wins.incrementAndGet();}catch(IllegalStateException expected){}catch(InterruptedException ex){Thread.currentThread().interrupt();throw new RuntimeException(ex);}}));}
                start.countDown();for(Future<?> f:jobs) f.get();
            }
            ok(wins.get()==1,"one cart wins under contention");
            ok(race.seats("evening").stream().map(SeatView::owner).filter(x->!x.isEmpty()).distinct().count()==1,"no split ownership");
        }
        System.out.println("PASS BookingChecks: "+checks+" checks, 40 rounds × 40 contending callers");
    }
}
