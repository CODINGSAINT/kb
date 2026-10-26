package kb.notification;

import java.time.Clock;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.Objects;
import java.util.Optional;
import java.util.function.LongUnaryOperator;

/** One-process dispatch decisions only. Maps/monitor are not a durable database or a broker. */
public final class DispatchEngine {
    public enum State { READY, CLAIMED, SENDING, RETRY_WAIT, PROVIDER_ACCEPTED, SUPPRESSED, DEAD_LETTER }
    public enum Kind { ACCEPTED, RETRYABLE_NOT_ACCEPTED, UNKNOWN, PERMANENT_FAILURE }
    public enum Completion { APPLIED, STALE }
    public record Draft(String eventId,String recipient,String channel,String templateVersion,
                        String target,String payload,long dueAt,long expiresAt,long lookupWindowMillis) {}
    public record Claim(String deliveryId,String worker,long epoch) {}
    public record Attempt(String deliveryId,String providerKey,String target,String payload,
                          String templateVersion,int number,long epoch,boolean lookupOnly) {}
    public record Result(Kind kind,String providerMessageId,String detail) {
        public Result { Objects.requireNonNull(kind); Objects.requireNonNull(detail); }
        public static Result accepted(String id) { return new Result(Kind.ACCEPTED,id,"provider accepted"); }
        public static Result retryable() { return new Result(Kind.RETRYABLE_NOT_ACCEPTED,"","definitively not accepted"); }
        public static Result unknown() { return new Result(Kind.UNKNOWN,"","provider outcome unknown"); }
        public static Result permanent() { return new Result(Kind.PERMANENT_FAILURE,"","permanent target/payload failure"); }
    }
    public record View(String id,State state,int attempts,long epoch,long nextAt,long leaseUntil,
                       boolean uncertain,String providerMessageId,String reason,long observedAcceptances) {}
    private record DeliveryKey(String eventId,String recipient,String channel) {}
    private record PreferenceKey(String recipient,String channel) {}
    private record Preference(boolean enabled,String verifiedTarget) {}
    private record Fact(String deliveryId,String providerMessageId) {}
    private record FactKey(String channel,String providerMessageId) {}
    private static final class Work {
        final String id,providerKey;
        final Draft draft;
        State state=State.READY;
        int attempts;
        long epoch,leaseUntil,nextAt,firstAuthorizedAt=-1;
        String owner="",providerMessageId="",reason="ready";
        boolean uncertain;
        Work(String id,Draft draft) { this.id=id; this.providerKey="notification/"+id; this.draft=draft; nextAt=draft.dueAt(); }
    }
    private static final long LEASE_MILLIS=30_000;
    private static final int MAX_ATTEMPTS=3;
    private final Clock clock;
    private final LongUnaryOperator chooseDelay;
    private final Map<DeliveryKey,String> identities=new HashMap<>();
    private final Map<String,Work> work=new LinkedHashMap<>();
    private final Map<PreferenceKey,Preference> preferences=new HashMap<>();
    private final Map<FactKey,Fact> providerFacts=new HashMap<>();
    private final Set<String> obsoleteEvents=new HashSet<>();
    private long sequence;

    public DispatchEngine(Clock clock,LongUnaryOperator chooseDelay) {
        this.clock=Objects.requireNonNull(clock); this.chooseDelay=Objects.requireNonNull(chooseDelay);
    }
    public synchronized void preference(String recipient,String channel,boolean enabled,String verifiedTarget) {
        text(recipient); text(channel);
        if (enabled) text(verifiedTarget);
        preferences.put(new PreferenceKey(recipient,channel),new Preference(enabled,verifiedTarget));
    }
    /** The trusted business authority marks an older intent obsolete; unrelated new events do not imply cancellation. */
    public synchronized void obsolete(String eventId) { text(eventId);obsoleteEvents.add(eventId); }
    public synchronized String enqueue(Draft draft) {
        Objects.requireNonNull(draft); text(draft.eventId()); text(draft.recipient()); text(draft.channel());
        text(draft.templateVersion()); text(draft.target()); text(draft.payload());
        if (draft.dueAt()<0 || draft.expiresAt()<=draft.dueAt() || draft.lookupWindowMillis()<0)
            throw new IllegalArgumentException("invalid schedule, expiry or replay window");
        DeliveryKey key=new DeliveryKey(draft.eventId(),draft.recipient(),draft.channel());
        String previous=identities.get(key);
        if (previous!=null) {
            if (!work.get(previous).draft.equals(draft)) throw new IllegalArgumentException("delivery identity reused with changed content");
            return previous;
        }
        String id="d"+Math.incrementExact(sequence); sequence++;
        work.put(id,new Work(id,draft)); identities.put(key,id); return id;
    }

    // BEGIN claim
    public synchronized Optional<Claim> claim(String deliveryId,String worker) {
        text(worker); Work item=required(deliveryId); long now=now();
        if (terminal(item)) return Optional.empty();
        boolean leased=item.state==State.CLAIMED || item.state==State.SENDING;
        if (leased && now<item.leaseUntil) return Optional.empty();
        if (now>=item.draft.expiresAt()) { suppress(item,"notification expired"); return Optional.empty(); }
        if (leased && item.state==State.SENDING) item.uncertain=true;
        if (now<item.nextAt) return Optional.empty();
        item.epoch=Math.incrementExact(item.epoch); item.owner=worker;
        item.leaseUntil=Math.addExact(now,LEASE_MILLIS); item.state=State.CLAIMED;
        item.reason="leased to "+worker;
        return Optional.of(new Claim(item.id,worker,item.epoch));
    }

    public synchronized Optional<Attempt> authorize(Claim claim) {
        Work item=required(claim.deliveryId()); long now=now();
        if (!owns(item,claim,now) || item.state!=State.CLAIMED) return Optional.empty();
        if (now>=item.draft.expiresAt()) { suppress(item,"notification expired"); return Optional.empty(); }
        if (obsoleteEvents.contains(item.draft.eventId())) { suppress(item,"business event is obsolete"); return Optional.empty(); }
        Preference pref=preferences.get(new PreferenceKey(item.draft.recipient(),item.draft.channel()));
        if (pref==null || !pref.enabled()) { suppress(item,"channel is not currently enabled"); return Optional.empty(); }
        if (!item.draft.target().equals(pref.verifiedTarget())) { suppress(item,"verified target changed"); return Optional.empty(); }
        if (item.attempts>=MAX_ATTEMPTS) { dead(item,"attempt budget exhausted"); return Optional.empty(); }
        if (item.uncertain && !safeLookup(item,now)) { dead(item,"uncertain outcome requires reconciliation"); return Optional.empty(); }
        if (item.firstAuthorizedAt<0) item.firstAuthorizedAt=now;
        item.attempts++; item.state=State.SENDING; item.reason="send authorized";
        return Optional.of(new Attempt(item.id,item.providerKey,item.draft.target(),item.draft.payload(),
                item.draft.templateVersion(),item.attempts,item.epoch,item.uncertain));
    }
    // END claim

    // BEGIN completion
    public synchronized Completion complete(Claim claim,Result result) {
        Objects.requireNonNull(result); Work item=required(claim.deliveryId()); long now=now();
        // External acceptance is evidence even when this worker no longer owns the state update.
        if (result.kind()==Kind.ACCEPTED) {
            text(result.providerMessageId());
            Fact fact=new Fact(item.id,result.providerMessageId());
            Fact previous=providerFacts.putIfAbsent(new FactKey(item.draft.channel(),result.providerMessageId()),fact);
            if (previous!=null && !previous.equals(fact)) throw new IllegalArgumentException("provider ID bound to another delivery");
        }
        if (!owns(item,claim,now) || item.state!=State.SENDING) return Completion.STALE;
        if (result.kind()==Kind.ACCEPTED) {
            item.state=State.PROVIDER_ACCEPTED; item.providerMessageId=result.providerMessageId();
            item.uncertain=false; item.reason="provider accepted; not proof of delivery or read";
        } else if (result.kind()==Kind.PERMANENT_FAILURE) {
            dead(item,result.detail());
        } else {
            item.uncertain|=result.kind()==Kind.UNKNOWN;
            if (item.attempts>=MAX_ATTEMPTS || (item.uncertain && !safeLookup(item,now))) {
                dead(item,item.uncertain?"uncertain outcome requires reconciliation":"attempt budget exhausted");
            } else {
                long window=Math.min(60_000L,1_000L<<(item.attempts-1));
                long delay=chooseDelay.applyAsLong(window);
                if (delay<0 || delay>window) throw new IllegalStateException("jitter must stay within its window");
                item.nextAt=Math.addExact(now,delay); item.state=State.RETRY_WAIT; item.reason=result.detail();
            }
        }
        return Completion.APPLIED;
    }
    // END completion

    public synchronized View view(String deliveryId) {
        Work item=required(deliveryId);
        long facts=providerFacts.values().stream().filter(f->f.deliveryId().equals(deliveryId)).count();
        return new View(item.id,item.state,item.attempts,item.epoch,item.nextAt,item.leaseUntil,
                item.uncertain,item.providerMessageId,item.reason,facts);
    }
    private boolean safeLookup(Work item,long now) {
        return item.firstAuthorizedAt>=0 && item.draft.lookupWindowMillis()>0
                && now-item.firstAuthorizedAt<item.draft.lookupWindowMillis();
    }
    private static boolean owns(Work item,Claim claim,long now) {
        return item.id.equals(claim.deliveryId()) && item.owner.equals(claim.worker())
                && item.epoch==claim.epoch() && now<item.leaseUntil;
    }
    private static boolean terminal(Work item) {
        return item.state==State.PROVIDER_ACCEPTED || item.state==State.SUPPRESSED || item.state==State.DEAD_LETTER;
    }
    private static void suppress(Work item,String reason) { item.state=State.SUPPRESSED; item.reason=reason; }
    private static void dead(Work item,String reason) { item.state=State.DEAD_LETTER; item.reason=reason; }
    private Work required(String id) {
        Work item=work.get(id); if (item==null) throw new IllegalArgumentException("unknown delivery"); return item;
    }
    private long now() {
        long now=clock.millis();
        if (now<0 || now>9_000_000_000_000L) throw new IllegalStateException("clock outside supported epoch-millisecond range");
        return now;
    }
    private static void text(String value) {
        if (value==null || value.isBlank()) throw new IllegalArgumentException("nonblank value required");
    }
}
