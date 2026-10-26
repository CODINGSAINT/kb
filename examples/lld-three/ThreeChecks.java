package lldthree;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Deterministic executable checks for the three published reference implementations. */
public final class ThreeChecks {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    @FunctionalInterface private interface Checked {void run() throws Exception;}
    private static void rejects(Class<? extends Throwable> type,Checked action) {
        try{action.run();throw new AssertionError("Expected "+type.getSimpleName());}
        catch(Throwable failure){if(!type.isInstance(failure))throw new AssertionError("Unexpected failure",failure);checks++;}
    }
    public static void main(String[] args) throws Exception {
        chess();parking();elevators();
        System.out.println("PASS: "+checks+" assertions across chess rules/perft, parking races/payments and elevator scheduling/ownership");
    }
    private static long perft(Chess.StandardRules rules,Chess.Position p,int depth) {
        if(depth==0)return 1;long count=0;
        for(Chess.Move m:rules.legalMoves(p))count+=perft(rules,rules.play(p,m),depth-1);
        return count;
    }
    private static void chess() {
        Chess.StandardRules r=new Chess.StandardRules();Chess.Position initial=Chess.Position.initial();String original=initial.fingerprint();
        check(r.legalMoves(initial).size()==20,"Starting moves");
        check(perft(r,initial,2)==400,"Starting perft(2)");
        check(perft(r,initial,3)==8902,"Starting perft(3)");
        rejects(IllegalArgumentException.class,()->r.play(initial,Chess.Move.of("a1","a4")));
        rejects(IllegalArgumentException.class,()->r.play(initial,Chess.Move.of("e7","e5")));
        Chess.Position e4=r.play(initial,Chess.Move.of("e2","e4"));
        check(e4.enPassant().equals(Chess.Square.at("e3")),"Double step target");
        check(initial.fingerprint().equals(original),"Trial never mutates initial position");
        rejects(UnsupportedOperationException.class,()->r.legalMoves(initial).clear());
        Chess.Position pinned=Chess.Position.fromFen("k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1");
        rejects(IllegalArgumentException.class,()->r.play(pinned,Chess.Move.of("e2","f2")));
        check(r.play(pinned,Chess.Move.of("e2","e8")).at(Chess.Square.at("e8")).kind()==Chess.Kind.ROOK,"Capture pinner");
        Chess.Position knight=Chess.Position.fromFen("4k3/4n3/8/2K5/8/8/8/4R3 w - - 0 1");
        check(r.attacked(knight,Chess.Square.at("d5"),Chess.Side.BLACK),"Pinned knight still attacks");
        rejects(IllegalArgumentException.class,()->r.play(knight,Chess.Move.of("c5","d5")));
        Chess.Position castles=Chess.Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
        Chess.Position castled=r.play(castles,Chess.Move.of("e1","g1"));
        check(castled.at(Chess.Square.at("g1")).kind()==Chess.Kind.KING&&castled.at(Chess.Square.at("f1")).kind()==Chess.Kind.ROOK,"Both castling pieces move");
        check((castled.castlingRights()&3)==0,"White castling rights gone");
        check((r.play(castles,Chess.Move.of("h1","h2")).castlingRights()&1)==0,"Rook move loses right");
        Chess.Position attackedCrossing=Chess.Position.fromFen("k4r2/8/8/8/8/8/8/4K2R w K - 0 1");
        rejects(IllegalArgumentException.class,()->r.play(attackedCrossing,Chess.Move.of("e1","g1")));
        Chess.Position attackedDestination=Chess.Position.fromFen("k5r1/8/8/8/8/8/8/4K2R w K - 0 1");
        rejects(IllegalArgumentException.class,()->r.play(attackedDestination,Chess.Move.of("e1","g1")));
        Chess.Position rookCapture=Chess.Position.fromFen("4k3/8/8/8/8/8/q7/R3K3 b Q - 0 1");
        check((r.play(rookCapture,Chess.Move.of("a2","a1")).castlingRights()&2)==0,"Captured rook loses right");
        Chess.Position ep=Chess.Position.fromFen("k7/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
        Chess.Position epResult=r.play(ep,Chess.Move.of("e5","d6"));
        check(epResult.at(Chess.Square.at("d5"))==null&&epResult.at(Chess.Square.at("d6")).side()==Chess.Side.WHITE,"En passant capture square");
        Chess.Position horizontal=Chess.Position.fromFen("k7/8/8/r4pPK/8/8/8/8 w - f6 0 1");
        rejects(IllegalArgumentException.class,()->r.play(horizontal,Chess.Move.of("g5","f6")));
        Chess.Position late=r.play(r.play(ep,Chess.Move.of("e1","e2")),Chess.Move.of("a8","b8"));
        rejects(IllegalArgumentException.class,()->r.play(late,Chess.Move.of("e5","d6")));
        Chess.Position promotion=Chess.Position.fromFen("7k/2P5/8/8/8/8/8/K7 w - - 0 1");
        rejects(IllegalArgumentException.class,()->r.play(promotion,Chess.Move.of("c7","c8")));
        rejects(IllegalArgumentException.class,()->r.play(promotion,Chess.Move.promote("c7","c8",Chess.Kind.KING)));
        check(r.legalMoves(promotion).stream().filter(m->m.from().equals(Chess.Square.at("c7"))&&m.to().equals(Chess.Square.at("c8"))).count()==4,"Four promotion choices");
        check(r.play(promotion,Chess.Move.promote("c7","c8",Chess.Kind.KNIGHT)).at(Chess.Square.at("c8")).kind()==Chess.Kind.KNIGHT,"Underpromotion");
        Chess.Game g=new Chess.Game();
        g.move(Chess.Side.WHITE,0,Chess.Move.of("f2","f3"));g.move(Chess.Side.BLACK,1,Chess.Move.of("e7","e5"));
        g.move(Chess.Side.WHITE,2,Chess.Move.of("g2","g4"));g.move(Chess.Side.BLACK,3,Chess.Move.of("d8","h4"));
        check(g.view().result()==Chess.Result.BLACK_WINS,"Fool's mate");
        rejects(IllegalStateException.class,()->g.move(Chess.Side.WHITE,4,Chess.Move.of("e2","e3")));
        check(g.undo(4).result()==Chess.Result.ACTIVE&&g.view().version()==5,"Undo terminal move; version monotonic");
        Chess.Game undo=new Chess.Game(castles,r);String before=undo.view().position().fingerprint();
        undo.move(Chess.Side.WHITE,0,Chess.Move.of("e1","c1"));undo.undo(1);
        check(undo.view().position().fingerprint().equals(before),"Undo full castling state");
        rejects(IllegalStateException.class,()->undo.move(Chess.Side.WHITE,0,Chess.Move.of("e1","g1")));
        Chess.Game stale=new Chess.Game();String fp=stale.view().position().fingerprint();
        rejects(IllegalArgumentException.class,()->stale.move(Chess.Side.WHITE,0,Chess.Move.of("a1","a4")));
        check(stale.view().version()==0&&stale.view().position().fingerprint().equals(fp),"Rejected move leaves state unchanged");
        Chess.Game stalemate=new Chess.Game(Chess.Position.fromFen("k7/2Q5/2K5/8/8/8/8/8 b - - 0 1"),r);
        check(stalemate.view().result()==Chess.Result.STALEMATE,"Stalemate differs from mate");
        Chess.Game draw=new Chess.Game();
        rejects(IllegalArgumentException.class,()->draw.agreeDraw(Set.of(Chess.Side.WHITE),0));
        check(draw.agreeDraw(EnumSet.allOf(Chess.Side.class),0).result()==Chess.Result.AGREED_DRAW,"Both draw consents");
        System.out.println("Chess: perft 20/400/8902; legality, special moves, terminal states and exact undo pass");
    }
    private static final class MutableClock extends Clock {
        private volatile Instant now=Instant.parse("2026-10-26T00:00:00Z");
        @Override public ZoneId getZone(){return ZoneOffset.UTC;}
        @Override public Clock withZone(ZoneId zone){return Clock.fixed(now,zone);}
        @Override public Instant instant(){return now;}
        void advance(Duration d){now=now.plus(d);}
    }
    private static final class TestPayments implements Parking.PaymentPort {
        final AtomicInteger charges=new AtomicInteger(),lookups=new AtomicInteger();
        final List<Long> amounts=new CopyOnWriteArrayList<>();
        volatile Parking.ProviderReply chargeReply=new Parking.ProviderReply(Parking.PaymentState.CONFIRMED,"receipt");
        volatile Parking.ProviderReply lookupReply=new Parking.ProviderReply(Parking.PaymentState.CONFIRMED,"receipt");
        CountDownLatch entered,release;
        @Override public Parking.ProviderReply charge(String key,long amount){
            charges.incrementAndGet();amounts.add(amount);
            if(entered!=null){entered.countDown();try{if(!release.await(3,TimeUnit.SECONDS))throw new IllegalStateException("Test release timeout");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}}
            return chargeReply;
        }
        @Override public Parking.ProviderReply lookup(String key){lookups.incrementAndGet();return lookupReply;}
    }
    private static Parking.Lot lot(MutableClock clock,TestPayments port,int spots) {
        AtomicInteger ids=new AtomicInteger();List<Parking.Spot> all=new ArrayList<>();
        for(int i=0;i<spots;i++)all.add(new Parking.Spot("C"+i,0,i,Parking.SpotKind.COMPACT));
        return new Parking.Lot(all,new Parking.HourlyTariff("v1",4000,2000),new Parking.SmallestFit(),port,clock,()->"S"+ids.incrementAndGet(),Duration.ofMinutes(10));
    }
    private static Parking.Vehicle vehicle(int n){return new Parking.Vehicle("CAR-"+n,Parking.VehicleKind.CAR);}
    private static void parking() throws Exception {
        Parking.HourlyTariff tariff=new Parking.HourlyTariff("v1",4000,2000);
        check(tariff.totalMinor(Duration.ZERO)==4000,"Immediate minimum");
        check(tariff.totalMinor(Duration.ofHours(1))==4000,"Exact first hour");
        check(tariff.totalMinor(Duration.ofHours(1).plusNanos(1))==6000,"First excess nanosecond");
        rejects(IllegalArgumentException.class,()->tariff.totalMinor(Duration.ofSeconds(-1)));
        MutableClock clock=new MutableClock();TestPayments port=new TestPayments();Parking.Lot one=lot(clock,port,1);
        ExecutorService pool=Executors.newFixedThreadPool(24);CountDownLatch start=new CountDownLatch(1);List<Future<Boolean>> results=new ArrayList<>();
        try {
            for(int n=0;n<24;n++){int i=n;results.add(pool.submit(()->{start.await();try{one.enter("E"+i,vehicle(i));return true;}catch(IllegalStateException full){return false;}}));}
            start.countDown();int accepted=0;for(Future<Boolean> result:results)if(result.get(3,TimeUnit.SECONDS))accepted++;
            check(accepted==1&&one.occupied()==1,"24 simultaneous gates claim one spot exactly once");
        }finally{pool.shutdownNow();}
        Parking.Lot p=lot(clock,port,2);Parking.SessionView s=p.enter("enter1",vehicle(100));
        check(p.enter("enter1",vehicle(100)).id().equals(s.id())&&p.occupied()==1,"Entry retry stable");
        rejects(IllegalArgumentException.class,()->p.enter("enter1",vehicle(101)));
        rejects(IllegalStateException.class,()->p.enter("another",vehicle(100)));
        port.chargeReply=new Parking.ProviderReply(Parking.PaymentState.DECLINED,"declined");
        check(p.pay(s.id(),"P1",4000).state()==Parking.PaymentState.DECLINED,"Known decline");int charged=port.charges.get();
        p.pay(s.id(),"P1",4000);check(port.charges.get()==charged&&p.occupied()==1,"Decline retry does not recharge or release");
        port.chargeReply=new Parking.ProviderReply(Parking.PaymentState.UNKNOWN,null);
        p.pay(s.id(),"P2",4000);
        check(p.view(s.id()).state()==Parking.SessionState.PAYMENT_UNKNOWN,"Unknown capture stays explicit");
        rejects(IllegalStateException.class,()->p.pay(s.id(),"P3",4000));
        rejects(IllegalStateException.class,()->p.confirmExit(s.id(),"X1"));
        p.reconcile("P2");p.reconcile("P2");
        check(p.view(s.id()).paidMinor()==4000&&port.lookups.get()==1,"Reconcile adds charge once");
        p.confirmExit(s.id(),"X1");check(p.occupied()==0,"Physical exit releases");
        Parking.SessionView newer=p.enter("enter2",vehicle(102));p.confirmExit(s.id(),"oldReplay");
        check(p.occupied()==1&&p.view(newer.id()).state()==Parking.SessionState.PARKED,"Old exit cannot release new occupant");
        MutableClock graceClock=new MutableClock();TestPayments gracePort=new TestPayments();Parking.Lot grace=lot(graceClock,gracePort,1);
        Parking.SessionView gs=grace.enter("g",vehicle(200));graceClock.advance(Duration.ofMinutes(59));grace.pay(gs.id(),"G1",4000);
        graceClock.advance(Duration.ofMinutes(2));check(grace.quote(gs.id()).dueMinor()==0,"Paid grace covers next hour boundary");
        graceClock.advance(Duration.ofMinutes(9));check(grace.quote(gs.id()).dueMinor()==2000,"Grace expired: charge delta only");
        grace.pay(gs.id(),"G1",4000);rejects(IllegalStateException.class,()->grace.confirmExit(gs.id(),"late"));
        grace.pay(gs.id(),"G2",2000);check(gracePort.amounts.equals(List.of(4000L,2000L)),"Top-up is twenty rupees, not sixty");grace.confirmExit(gs.id(),"GExit");
        MutableClock zeroClock=new MutableClock();TestPayments zeroPort=new TestPayments();Parking.Lot zero=lot(zeroClock,zeroPort,1);
        Parking.SessionView zs=zero.enter("zero",vehicle(201));zero.pay(zs.id(),"Z1",4000);zeroClock.advance(Duration.ofMinutes(11));zero.pay(zs.id(),"Z2",0);
        check(zeroPort.charges.get()==1&&zero.view(zs.id()).paidMinor()==4000,"Already-covered zero delta does not call provider");
        Parking.Lot tariffs=lot(new MutableClock(),new TestPayments(),2);Parking.SessionView old=tariffs.enter("old",vehicle(300));
        tariffs.tariff(new Parking.HourlyTariff("v2",10000,5000));Parking.SessionView fresh=tariffs.enter("new",vehicle(301));
        check(tariffs.quote(old.id()).tariffVersion().equals("v1")&&tariffs.quote(fresh.id()).dueMinor()==10000,"Entry tariff is frozen");
        MutableClock changedClock=new MutableClock();TestPayments changedPort=new TestPayments();Parking.Lot changed=lot(changedClock,changedPort,1);
        Parking.SessionView changedSession=changed.enter("quote",vehicle(350));check(changed.quote(changedSession.id()).dueMinor()==4000,"Initial quote");
        changedClock.advance(Duration.ofHours(1).plusNanos(1));
        rejects(IllegalStateException.class,()->changed.pay(changedSession.id(),"changed",4000));
        check(changedPort.charges.get()==0,"Changed quote is not charged without approval");
        changed.pay(changedSession.id(),"changed",6000);
        rejects(IllegalArgumentException.class,()->changed.pay(changedSession.id(),"changed",4000));
        MutableClock blockingClock=new MutableClock();TestPayments blockingPort=new TestPayments();blockingPort.entered=new CountDownLatch(1);blockingPort.release=new CountDownLatch(1);
        Parking.Lot nonBlocking=lot(blockingClock,blockingPort,2);Parking.SessionView bs=nonBlocking.enter("B1",vehicle(400));ExecutorService workers=Executors.newFixedThreadPool(2);
        try {
            Future<Parking.PaymentView> payment=workers.submit(()->nonBlocking.pay(bs.id(),"BP",4000));
            check(blockingPort.entered.await(1,TimeUnit.SECONDS),"Provider started");
            check(workers.submit(()->nonBlocking.enter("B2",vehicle(401))).get(1,TimeUnit.SECONDS)!=null,"Another gate progresses while provider blocks");
            check(nonBlocking.pay(bs.id(),"BP",4000).state()==Parking.PaymentState.PENDING,"Duplicate in-flight attempt returns pending");
            blockingPort.release.countDown();payment.get(2,TimeUnit.SECONDS);check(blockingPort.charges.get()==1,"One provider call");
        }finally{blockingPort.release.countDown();workers.shutdownNow();}
        check(lot(new MutableClock(),new TestPayments(),1).occupied()==0,"Lot instances independent");
        System.out.println("Parking: atomic gates, exact fees, provider-outside-lock, uncertainty, grace credits and stale exit checks pass");
    }
    private static void elevators() {
        Elevators.SystemController e=new Elevators.SystemController(10,new Elevators.EtaPolicy());e.addCar("A",0,8);
        rejects(IllegalArgumentException.class,()->e.hallCall(0,Elevators.Direction.DOWN));
        rejects(IllegalArgumentException.class,()->e.hallCall(9,Elevators.Direction.UP));
        e.cabinCall("A",3);e.cabinCall("A",7);e.cabinCall("A",7);
        check(e.snapshot("A").cabin().equals(List.of(3,7)),"Cabin deduplication");
        Elevators.CallView down=e.hallCall(5,Elevators.Direction.DOWN),up=e.hallCall(2,Elevators.Direction.UP);
        check(e.hallCall(2,Elevators.Direction.UP).id()==up.id(),"Hall button coalesces");
        List<String> stops=new ArrayList<>();
        for(int i=0;i<100&&stops.size()<4;i++)for(Elevators.Tick t:safeTick(e,List.of("A")))if(t.action()==Elevators.Action.OPENED)stops.add(t.to()+":"+t.heading());
        check(stops.equals(List.of("2:UP","3:UP","7:UP","5:DOWN")),"LOOK direction order: "+stops);
        check(e.call(up.id()).state()==Elevators.CallState.SERVED&&e.call(down.id()).state()==Elevators.CallState.SERVED,"Both directions served");
        Elevators.SystemController eta=new Elevators.SystemController(10,new Elevators.EtaPolicy());eta.addCar("A",0,8);eta.addCar("B",3,8);eta.cabinCall("A",3);eta.cabinCall("A",6);eta.cabinCall("B",1);
        Elevators.HallTask probe=new Elevators.HallTask(999,new Elevators.HallKey(2,Elevators.Direction.UP),1);
        int a=Elevators.EtaPolicy.estimate(probe,eta.snapshot("A")),b=Elevators.EtaPolicy.estimate(probe,eta.snapshot("B"));
        check(a<b&&eta.hallCall(2,Elevators.Direction.UP).carId().equals("A"),"Direction-aware ETA beats nearest floor");
        System.out.println("Elevator pickup estimate: A="+a+" model ticks, B="+b+" model ticks");
        Elevators.SystemController opposite=new Elevators.SystemController(10,new Elevators.EtaPolicy());opposite.addCar("A",0,8);opposite.cabinCall("A",7);
        Elevators.CallView u=opposite.hallCall(2,Elevators.Direction.UP),d=opposite.hallCall(2,Elevators.Direction.DOWN);
        while(opposite.call(u.id()).state()!=Elevators.CallState.SERVED)safeTick(opposite,List.of("A"));
        check(opposite.call(d.id()).state()!=Elevators.CallState.SERVED,"Serving Up does not clear Down at same floor");
        opposite.obstruction("A",true);int floor=opposite.snapshot("A").floor();
        for(int i=0;i<3;i++)safeTick(opposite,List.of("A"));check(opposite.snapshot("A").floor()==floor,"Obstruction blocks travel");
        opposite.obstruction("A",false);safeTick(opposite,List.of("A"));check(opposite.snapshot("A").door()==Elevators.Door.CLOSING,"Close after clear");
        opposite.obstruction("A",true);safeTick(opposite,List.of("A"));check(opposite.snapshot("A").door()==Elevators.Door.OPENING,"Closing obstruction reopens");
        Elevators.SystemController full=new Elevators.SystemController(10,new Elevators.EtaPolicy());full.addCar("A",0,2);full.load("A",2);
        Elevators.CallView waiting=full.hallCall(2,Elevators.Direction.UP);check(waiting.state()==Elevators.CallState.WAITING,"Full car is not assigned");
        full.load("A",0);check(full.call(waiting.id()).state()==Elevators.CallState.ASSIGNED,"Capacity recovery assigns waiting call");
        full.load("A",3);safeTick(full,List.of("A"));safeTick(full,List.of("A"));
        check(full.snapshot("A").door()==Elevators.Door.OPEN,"Overload opens at model floor");
        int before=full.snapshot("A").floor();safeTick(full,List.of("A"));check(full.snapshot("A").floor()==before,"Overload never moves");
        Elevators.SystemController fault=new Elevators.SystemController(10,new Elevators.EtaPolicy());fault.addCar("A",0,8);fault.addCar("B",8,8);fault.cabinCall("A",6);
        Elevators.CallView original=fault.hallCall(2,Elevators.Direction.UP);check(original.carId().equals("A"),"Initial assignment A");
        safeTick(fault,List.of("A","B"));fault.outOfService("A");Elevators.CallView reassigned=fault.call(original.id());
        check(reassigned.carId().equals("B")&&reassigned.createdTick()==original.createdTick()&&reassigned.epoch()>original.epoch(),"Fault reassigns preserving age");
        check(!fault.acknowledgePickup(original.id(),"A",original.epoch()),"Stale assignment acknowledgement rejected");
        check(fault.snapshot("A").cabin().contains(6),"Onboard destinations retained for operator recovery");
        for(int i=0;i<150&&fault.call(original.id()).state()!=Elevators.CallState.SERVED;i++)safeTick(fault,List.of("A","B"));
        check(fault.call(original.id()).state()==Elevators.CallState.SERVED,"Replacement serves call");
        Random random=new Random(731);
        for(int scenario=0;scenario<50;scenario++) {
            Elevators.SystemController fleet=new Elevators.SystemController(10,new Elevators.EtaPolicy());fleet.addCar("A",random.nextInt(10),8);fleet.addCar("B",random.nextInt(10),8);
            Set<Long> ids=new HashSet<>();
            for(int j=0;j<16;j++){int f=random.nextInt(10);Elevators.Direction dir=f==0?Elevators.Direction.UP:f==9?Elevators.Direction.DOWN:random.nextBoolean()?Elevators.Direction.UP:Elevators.Direction.DOWN;ids.add(fleet.hallCall(f,dir).id());}
            int steps=0;while(steps++<500&&ids.stream().anyMatch(id->fleet.call(id).state()!=Elevators.CallState.SERVED))safeTick(fleet,List.of("A","B"));
            check(ids.stream().allMatch(id->fleet.call(id).state()==Elevators.CallState.SERVED),"Finite static calls drain in scenario "+scenario);
        }
        System.out.println("Elevators: directional sweeps, coalescing, door/load guards, reassignment epochs and 50 static workloads pass");
    }
    private static List<Elevators.Tick> safeTick(Elevators.SystemController c,List<String> ids) {
        Map<String,Elevators.CarSnapshot> before=new HashMap<>();for(String id:ids)before.put(id,c.snapshot(id));
        List<Elevators.Tick> ticks=c.tick();
        for(Elevators.Tick t:ticks)if(t.action()==Elevators.Action.MOVED) {
            Elevators.CarSnapshot s=before.get(t.carId());
            check(s.door()==Elevators.Door.CLOSED&&s.mode()==Elevators.Mode.NORMAL&&!s.obstructed()&&s.interlock()&&s.load()<=s.capacity(),"Every movement respects model interlocks");
            check(Math.abs(t.to()-t.from())==1,"One floor per travel event");
        }
        return ticks;
    }
}
