package kb.notification;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public final class NotificationChecks {
    public static final class Time extends Clock {
        private volatile long millis;
        public void at(long value) { millis=value; }
        @Override public long millis() { return millis; }
        @Override public Instant instant() { return Instant.ofEpochMilli(millis); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(instant(),zone); }
    }
    public static DispatchEngine engine(Time time) {
        DispatchEngine engine=new DispatchEngine(time,window->window);
        engine.preference("U21","email",true,"u21@example.invalid"); return engine;
    }
    public static DispatchEngine.Draft draft(String event,long due,long expiry,long replayWindow) {
        return new DispatchEngine.Draft(event,"U21","email","order-ready/email/v3","u21@example.invalid",
                "Order O847 is ready for pickup.",due,expiry,replayWindow);
    }
    private static void check(boolean condition,String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        Time time=new Time(); DispatchEngine engine=engine(time);
        var draft=draft("OrderReady/O847/v9",0,900_000,60_000);
        String id=engine.enqueue(draft);
        check(engine.enqueue(draft).equals(id),"queue redelivery preserves delivery identity");
        try {
            engine.enqueue(new DispatchEngine.Draft(draft.eventId(),"U21","email",draft.templateVersion(),
                    draft.target(),"changed",0,900_000,60_000));
            throw new AssertionError("changed content should be rejected");
        } catch (IllegalArgumentException expected) { /* Expected fingerprint conflict. */ }
        var provider=new FakeProvider(time,60_000,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        var first=engine.claim(id,"worker-A").orElseThrow();
        var request=engine.authorize(first).orElseThrow();
        engine.complete(first,provider.send(request));
        check(engine.view(id).state()==DispatchEngine.State.RETRY_WAIT && engine.view(id).uncertain(),"timeout is unknown");
        check(provider.physicalAcceptances()==1,"provider may accept before response loss");
        time.at(999); check(engine.claim(id,"worker-B").isEmpty(),"retry respects due time");
        time.at(1000); var second=engine.claim(id,"worker-B").orElseThrow();
        var retry=engine.authorize(second).orElseThrow();
        check(retry.providerKey().equals(request.providerKey()) && retry.payload().equals(request.payload()),"retry keeps key and bytes");
        engine.complete(second,provider.send(retry));
        check(engine.view(id).state()==DispatchEngine.State.PROVIDER_ACCEPTED,"retry records acceptance");
        check(provider.calls()==2 && provider.physicalAcceptances()==1,"fake provider deduplicates inside its stated window");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("optout",0,900_000,60_000));
        var claimed=engine.claim(id,"A").orElseThrow();
        engine.preference("U21","email",false,"u21@example.invalid");
        check(engine.authorize(claimed).isEmpty() && engine.view(id).state()==DispatchEngine.State.SUPPRESSED,"send-time opt-out gate");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("changed-contact",0,900_000,60_000));
        claimed=engine.claim(id,"A").orElseThrow();
        engine.preference("U21","email",true,"new@example.invalid");
        check(engine.authorize(claimed).isEmpty(),"frozen target cannot silently change under the same provider key");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("lease-race",0,900_000,60_000));
        provider=new FakeProvider(time,60_000);
        var old=engine.claim(id,"old").orElseThrow(); var oldRequest=engine.authorize(old).orElseThrow();
        var lateAccepted=provider.send(oldRequest); // External acceptance exists; local completion is delayed.
        time.at(29_999); check(engine.claim(id,"new").isEmpty(),"live lease cannot be stolen");
        time.at(30_000); var current=engine.claim(id,"new").orElseThrow();
        check(current.epoch()>old.epoch(),"reclaim advances epoch at exact expiry");
        check(engine.complete(old,lateAccepted)==DispatchEngine.Completion.STALE,"old owner cannot mutate new claim");
        check(engine.view(id).observedAcceptances()==1 && engine.view(id).state()==DispatchEngine.State.CLAIMED,"late evidence is retained separately");
        engine.complete(current,provider.send(engine.authorize(current).orElseThrow()));
        check(provider.physicalAcceptances()==1,"claim epoch does not change provider identity");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("window",0,900_000,60_000));
        provider=new FakeProvider(time,60_000,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        claimed=engine.claim(id,"A").orElseThrow(); engine.complete(claimed,provider.send(engine.authorize(claimed).orElseThrow()));
        time.at(60_000); claimed=engine.claim(id,"B").orElseThrow();
        check(engine.authorize(claimed).isEmpty() && engine.view(id).state()==DispatchEngine.State.DEAD_LETTER,"replay window equality requires reconciliation");
        check(provider.calls()==1,"unsafe replay does not call provider again");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("no-dedup",0,900_000,0));
        provider=new FakeProvider(time,0,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        claimed=engine.claim(id,"A").orElseThrow(); engine.complete(claimed,provider.send(engine.authorize(claimed).orElseThrow()));
        check(engine.view(id).state()==DispatchEngine.State.DEAD_LETTER,"unknown without safe provider replay is quarantined");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("retries",0,900_000,60_000));
        provider=new FakeProvider(time,60_000,FakeProvider.Behavior.RETRYABLE_NOT_ACCEPTED,
                FakeProvider.Behavior.RETRYABLE_NOT_ACCEPTED,FakeProvider.Behavior.RETRYABLE_NOT_ACCEPTED);
        for (long instant:new long[]{0,1000,3000}) {
            time.at(instant); claimed=engine.claim(id,"A").orElseThrow();
            engine.complete(claimed,provider.send(engine.authorize(claimed).orElseThrow()));
        }
        check(engine.view(id).attempts()==3 && engine.view(id).state()==DispatchEngine.State.DEAD_LETTER,"retry budget is bounded");

        time.at(0); engine=engine(time); id=engine.enqueue(draft("schedule",10_000,20_000,60_000));
        check(engine.claim(id,"A").isEmpty(),"scheduled work is not early");
        time.at(10_000); check(engine.claim(id,"A").isPresent(),"due equality is eligible");
        time.at(20_000); check(engine.view(id).state()==DispatchEngine.State.CLAIMED,"snapshot is not a background sweeper");
        // Even a still-valid lease cannot authorize an expired intent.
        check(engine.authorize(new DispatchEngine.Claim(id,"A",1)).isEmpty()
                && engine.view(id).state()==DispatchEngine.State.SUPPRESSED,"expiry equality stops a send");

        time.at(0); final DispatchEngine race=engine(time); final String raceId=race.enqueue(draft("race",0,900_000,60_000));
        AtomicInteger winners=new AtomicInteger();
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks=new ArrayList<java.util.concurrent.Callable<Void>>();
            for (int i=0;i<32;i++) { String worker="W"+i; tasks.add(()->{if(race.claim(raceId,worker).isPresent())winners.incrementAndGet();return null;}); }
            for (var future:pool.invokeAll(tasks)) future.get();
        }
        check(winners.get()==1,"one live local claim wins");
        time.at(0);engine=engine(time);id=engine.enqueue(draft("late-lookup",0,900_000,60_000));
        provider=new FakeProvider(time,60_000,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        var originalClaim=engine.claim(id,"first").orElseThrow();
        engine.complete(originalClaim,provider.send(engine.authorize(originalClaim).orElseThrow()));
        time.at(59_000);var lateClaim=engine.claim(id,"lookup").orElseThrow();
        var delayed=engine.authorize(lateClaim).orElseThrow();check(delayed.lookupOnly(),"uncertain attempt is read-only lookup");
        time.at(61_000);engine.complete(lateClaim,provider.send(delayed));
        check(provider.physicalAcceptances()==1 && engine.view(id).state()==DispatchEngine.State.DEAD_LETTER,
                "a lookup delayed beyond retention cannot create a second acceptance");
        time.at(0);engine=engine(time);id=engine.enqueue(draft("ready-v9",0,900_000,60_000));
        engine.obsolete("ready-v9");var obsoleteClaim=engine.claim(id,"worker").orElseThrow();
        check(engine.authorize(obsoleteClaim).isEmpty() && engine.view(id).state()==DispatchEngine.State.SUPPRESSED,
                "business obsolescence blocks new send authorization");
        System.out.println("PASS NotificationChecks: identity, read-only uncertain lookup, delayed lookup after retention, business obsolescence, preference/contact gate, claim fencing/evidence, retry budget, schedule/expiry equality, 32 claimants");
    }
}
