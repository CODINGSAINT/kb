package kb.rental;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static kb.rental.Rental.*;
import static kb.rental.RentalDemo.*;

public final class RentalChecks {
    private static int checks;
    public static void main(String[] args)throws Exception {
        intervalsAndQuote(); priceBoundaries(); lifecycleAndReplay(); cancellationAndUnreadiness(); race();
        System.out.printf("PASS: %d checks; interval/preparation, quotes, exact price boundaries, owner-bound handover/return, cancellation and concurrent allocation%n",checks);
    }
    private static void intervalsAndQuote() {
        Fixture f=fixture(); Service s=f.service(); Window first=window("2026-10-28T09:00:00Z","2026-10-28T11:00:00Z");
        var q=s.quote("A","CAR17",first); var r=s.reserve("create","A",q.id());
        check(first.overlaps(window("2026-10-28T11:00:00Z","2026-10-28T12:00:00Z")),"preparation blocks touching rental end");
        check(!first.overlaps(window("2026-10-28T12:00:00Z","2026-10-28T13:00:00Z")),"touching blocked interval end is free");
        check(s.search(Category.ECONOMY,window("2026-10-28T10:00:00Z","2026-10-28T10:30:00Z")).isEmpty(),"nested interval cannot escape overlap check");
        f.time().at("2026-10-28T08:06:00Z"); check(s.reserve("create","A",q.id()).id().equals(r.id()),"same request replays after quote expiry");
        expect(IllegalStateException.class,()->s.reserve("new","A",q.id()));
        Fixture rates=fixture(); var quote=rates.service().quote("A","CAR17",first); rates.service().changeTariff(new Tariff(200_000,30_000,60_000));
        check(rates.service().reserve("frozen","A",quote.id()).quote().basePaise()==180_000,"quote rate frozen");
        expect(IllegalArgumentException.class,()->rates.service().reserve("theft","B",quote.id()));
    }
    private static void priceBoundaries() {
        check(startedUnits(Duration.ofHours(24),Duration.ofDays(1))==1,"exact 24h is one period");
        check(startedUnits(Duration.ofHours(24).plusNanos(1),Duration.ofDays(1))==2,"one nanosecond beyond 24h starts second period");
        check(startedUnits(Duration.ofHours(49),Duration.ofDays(1))*180_000==540_000,"49h quote is Rs 5400");
        check(startedUnits(Duration.ZERO,Duration.ofHours(1))==0,"no lateness is zero fee");
        check(startedUnits(Duration.ofHours(1),Duration.ofHours(1))==1 && startedUnits(Duration.ofHours(1).plusNanos(1),Duration.ofHours(1))==2,"late-hour boundary exact");
        Fixture f=fixture(); var r=book(f.service(),"A","A",window("2026-10-28T09:00:00Z","2026-10-30T10:00:00Z"));
        f.time().at("2026-10-28T09:00:00Z"); f.service().pickup(r.id(),"A",new Reading(100,80,false));
        f.time().at("2026-10-28T10:00:00Z");
        check(f.service().returnVehicle(r.id(),"A",new Reading(110,70,false)).totalPaise()==540_000,"early return keeps booked base, not actual elapsed billing");
    }
    private static void lifecycleAndReplay() {
        Fixture f=fixture(); Service s=f.service(); var a=book(s,"A","A",window("2026-10-28T09:00:00Z","2026-10-28T10:00:00Z"));
        var b=book(s,"B","B",window("2026-10-28T11:00:00Z","2026-10-28T12:00:00Z")); Reading pickup=new Reading(100,80,false),returned=new Reading(120,70,false);
        check(s.pickup(a.id(),"A",pickup).decision()==Handover.TOO_EARLY,"no early pickup");
        f.time().at("2026-10-28T09:00:00Z"); check(s.pickup(a.id(),"A",pickup).decision()==Handover.STARTED,"start handover");
        check(s.pickup(a.id(),"A",pickup).decision()==Handover.REPLAYED,"pickup replay doesn't hand over twice");
        check(!s.expireNoShow(a.id()),"no-show job cannot cancel active rental");
        expect(IllegalStateException.class,()->s.cancel(a.id(),"A"));
        expect(IllegalArgumentException.class,()->s.returnVehicle(a.id(),"A",new Reading(90,70,false)));
        f.time().at("2026-10-28T10:00:00Z"); var invoice=s.returnVehicle(a.id(),"A",returned);
        f.time().at("2026-10-28T11:00:00Z"); check(s.pickup(b.id(),"B",returned).decision()==Handover.STARTED,"next handover at preparation equality");
        check(s.returnVehicle(a.id(),"A",returned).equals(invoice) && s.vehicle("CAR17").activeReservationId().equals(b.id()),"old return cannot release new rental");
        check(!s.expireNoShow(a.id()),"old no-show cannot affect later booking");
    }
    private static void cancellationAndUnreadiness() {
        Fixture f=fixture(); var s=f.service(); var r=book(s,"cancel","A",window("2026-10-28T09:00:00Z","2026-10-28T10:00:00Z"));
        check(s.cancel(r.id(),"A").totalPaise()==0 && s.cancel(r.id(),"A").totalPaise()==0,"early cancellation free and idempotent");
        Fixture late=fixture(); var a=book(late.service(),"A","A",window("2026-10-28T09:00:00Z","2026-10-28T10:00:00Z"));
        late.time().at("2026-10-28T09:30:00Z"); check(late.service().expireNoShow(a.id()) && late.service().reservation(a.id()).invoice().totalPaise()==50_000,"no-show at equality charges chosen fee once");
        check(!late.service().expireNoShow(a.id()),"repeated no-show no effect");
        Fixture conflict=fixture(); Service c=conflict.service(); var first=book(c,"A","A",window("2026-10-28T09:00:00Z","2026-10-28T11:00:00Z"));
        var next=book(c,"B","B",window("2026-10-28T12:00:00Z","2026-10-28T13:00:00Z"));
        conflict.time().at("2026-10-28T09:00:00Z"); c.pickup(first.id(),"A",new Reading(100,80,false));
        conflict.time().at("2026-10-28T12:00:00Z"); check(c.pickup(next.id(),"B",new Reading(120,70,false)).decision()==Handover.NOT_READY,"late car cannot be handed over again");
        conflict.time().at("2026-10-28T12:10:00Z"); var bill=c.returnVehicle(first.id(),"A",new Reading(120,50,false));
        check(bill.totalPaise()==220_000 && c.reservation(next.id()).readinessIssue()!=null,"late fee and physical readiness conflict");
        conflict.time().at("2026-10-28T12:30:00Z"); check(!c.expireNoShow(next.id()) && c.cancel(next.id(),"B").totalPaise()==0,"operator unreadiness cannot become customer no-show fee");
    }
    private static void race()throws Exception {
        Fixture f=fixture(); Service s=f.service(); Window w=window("2026-10-28T09:00:00Z","2026-10-28T10:00:00Z");
        var a=s.quote("A","CAR17",w); var b=s.quote("B","CAR17",w); CountDownLatch start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) { var x=pool.submit(()->{start.await(5,TimeUnit.SECONDS);return reserve(s,"A",a.id());}); var y=pool.submit(()->{start.await(5,TimeUnit.SECONDS);return reserve(s,"B",b.id());}); start.countDown();
            check(x.get(5,TimeUnit.SECONDS)!=y.get(5,TimeUnit.SECONDS) && s.reservations().size()==1,"one concurrent vehicle interval allocation wins");
        } finally {start.countDown();}
    }
    private static boolean reserve(Service s,String customer,String quote) {try{s.reserve("race",customer,quote);return true;}catch(IllegalStateException expected){return false;}}
    private static void expect(Class<? extends Throwable> type,Runnable action){try{action.run();}catch(Throwable ex){check(type.isInstance(ex),"expected "+type.getSimpleName());return;}throw new AssertionError("Expected "+type.getSimpleName());}
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
}
