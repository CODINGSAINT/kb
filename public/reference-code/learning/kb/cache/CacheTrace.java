package kb.cache;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Executes local cache operations and emits the standalone walkthrough's recorded states. */
public final class CacheTrace {
    private record Step(String title, long millis, List<BoundedCache.SlotView> slots,
                        BoundedCache.Stats stats, String result, String note, String focus) {}
    private record Scenario(String id, String title, String description,
                            int maxSlots, long maxPayloadBytes, List<Step> steps) {}
    private static final String CARD="card:v1:tenant:23:product:784";
    private static final BoundedCache.Value V41=BoundedCache.Value.text(41,"Travel mug / INR 499.00");
    private static final BoundedCache.Value V42=BoundedCache.Value.text(42,"Travel mug / INR 549.00");

    public static void main(String[] args) {
        List<Scenario> scenarios=List.of(invalidation(),delayed(),capacity());
        StringBuilder json=new StringBuilder("{\n  \"source\":\"kb.cache.CacheTrace (Java 21 one-node mechanism)\",\n  \"scenarios\":[\n");
        for (int i=0;i<scenarios.size();i++) {
            if (i>0) json.append(",\n");
            Scenario scenario=scenarios.get(i);
            json.append("    {\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title()))
                    .append(",\"description\":").append(q(scenario.description()))
                    .append(",\"maxSlots\":").append(scenario.maxSlots())
                    .append(",\"maxPayloadBytes\":").append(scenario.maxPayloadBytes()).append(",\"steps\":[\n");
            for (int j=0;j<scenario.steps().size();j++) {
                if (j>0) json.append(",\n");
                Step step=scenario.steps().get(j);
                json.append("      {\"title\":").append(q(step.title())).append(",\"millis\":").append(step.millis())
                        .append(",\"result\":").append(q(step.result())).append(",\"note\":").append(q(step.note()))
                        .append(",\"focus\":").append(q(step.focus()))
                        .append(",\"payloadBytes\":").append(step.stats().payloadBytes())
                        .append(",\"evictions\":").append(step.stats().evictions()).append(",\"slots\":[");
                for (int k=0;k<step.slots().size();k++) {
                    if (k>0) json.append(',');
                    var slot=step.slots().get(k);
                    json.append("{\"key\":").append(q(slot.key())).append(",\"slotId\":").append(slot.slotId())
                            .append(",\"generation\":").append(slot.generation())
                            .append(",\"minimumVersion\":").append(slot.minimumVersion())
                            .append(",\"cachedVersion\":").append(slot.cachedVersion())
                            .append(",\"remainingMillis\":").append(slot.remainingMillis()).append('}');
                }
                json.append("]}");
            }
            json.append("\n    ]}");
        }
        System.out.println(json.append("\n  ]\n}"));
    }

    private static Scenario invalidation() {
        var ticker=new CacheChecks.Ticker();
        var cache=new BoundedCache(2,128,Duration.ofSeconds(10),ticker);
        List<Step> steps=new ArrayList<>();
        var old=cache.beginLoad(CARD);
        steps.add(step("Reader A gets a ticket before reading v41",0,cache,"Ticket: slot "+old.slotId()+" / generation "+old.generation(),
                "The origin fixture supplies v41 at INR 499.00. The cache has no value yet, but it has a bounded metadata slot and a ticket issued at t=0.","slots"));
        ticker.atMillis(1000); cache.invalidate(CARD,42);
        steps.add(step("The committed v42 invalidation arrives",1000,cache,"INVALIDATE minimumVersion 42",
                "The slot's generation advances and its version floor becomes 42. An invalidation retires pending work as well as removing old bytes.","slots"));
        ticker.atMillis(2000); var rejected=cache.fill(old,V41);
        steps.add(step("The delayed v41 fill is rejected",2000,cache,rejected.name(),
                "Reader A's ticket names generation 0 while the slot now has generation 1. The cache stays empty; the old price cannot refill it with this ticket.","decision"));
        var current=cache.beginLoad(CARD); var accepted=cache.fill(current,V42);
        steps.add(step("A new ticket fills the current version",2000,cache,accepted.name(),
                "A fresh authoritative fixture supplies v42 at INR 549.00. It meets the retained floor and generation. This ticket starts its own ten-second budget at t=2.","slots"));
        ticker.atMillis(2100); cache.invalidate(CARD,41);
        steps.add(step("An older invalidation is harmless",2100,cache,"Older event already covered",
                "Version 41 is below the retained floor 42, so the event cannot lower the floor or delete the newer value.","slots"));
        return new Scenario("invalidation","An invalidation retires the old reader",
                "One product changes from v41 / INR 499.00 to v42 / INR 549.00. Watch the ticket generation, source floor and fill result.",2,128,steps);
    }

    private static Scenario delayed() {
        var ticker=new CacheChecks.Ticker();
        var cache=new BoundedCache(2,128,Duration.ofSeconds(10),ticker);
        List<Step> steps=new ArrayList<>();
        var old=cache.beginLoad(CARD);
        steps.add(step("The load starts at t=0",0,cache,"Ticket issued",
                "No invalidation arrives in this case. The separate age budget must stop a delayed origin snapshot from being renewed indefinitely.","decision"));
        ticker.atMillis(9000); var filled=cache.fill(old,V41);
        steps.add(step("At t=9, a late fill has one second left",9000,cache,filled.name(),
                "The cache stores the original ticket start, not the fill time. remainingMillis is 1000, so this cannot become a new ten-second copy.","slots"));
        ticker.atMillis(9999); boolean hit=cache.get(CARD).isPresent();
        steps.add(step("Just before the deadline",9999,cache,hit?"HIT":"MISS",
                "The original permission has one millisecond left in this controlled ticker scenario. A read does not reset it.","slots"));
        ticker.atMillis(10000); boolean exact=cache.get(CARD).isPresent();
        steps.add(step("Equality ends the permission",10000,cache,exact?"HIT":"MISS",
                "At t=10, age equals the ten-second limit. get removes the value and returns a miss. Retained metadata still carries its version floor.","decision"));
        var result=cache.fill(old,V41);
        steps.add(step("The same old ticket cannot renew it",10000,cache,result.name(),
                "fill rejects the exhausted ticket. A new ticket and a new authoritative read are needed; reinserting the old bytes is insufficient.","decision"));
        return new Scenario("age","A delayed fill does not get a new TTL",
                "The hard age starts before reading the origin and survives the fill. This is independent of invalidation delivery.",2,128,steps);
    }

    private static Scenario capacity() {
        var ticker=new CacheChecks.Ticker();
        var cache=new BoundedCache(2,6,Duration.ofSeconds(10),ticker);
        List<Step> steps=new ArrayList<>();
        var oldA=cache.beginLoad("A"); cache.fill(oldA,BoundedCache.Value.text(1,"aaa"));
        cache.fill(cache.beginLoad("B"),BoundedCache.Value.text(1,"bbb"));
        steps.add(step("Two slots and six payload bytes are full",0,cache,"A=3 bytes; B=3 bytes",
                "Slot order is least-recent to most-recent. Tickets can remain in flight, but cache-owned metadata itself is bounded.","capacity"));
        ticker.atMillis(1); cache.get("A");
        steps.add(step("Reading A changes recency, not age",1,cache,"HIT A",
                "B is now least recent. A's remaining budget still comes from its original ticket; a hit does not refresh its TTL.","slots"));
        ticker.atMillis(2); cache.fill(cache.beginLoad("C"),BoundedCache.Value.text(1,"ccc"));
        steps.add(step("Loading C evicts B's entire slot",2,cache,"A and C retained",
                "The slot count stays at two and payload stays at six bytes. B's old slot identity is retired, including its generation history.","capacity"));
        ticker.atMillis(3); cache.fill(cache.beginLoad("A"),BoundedCache.Value.text(2,"aaaa"));
        steps.add(step("Four bytes for A require C to leave",3,cache,"A=4 bytes; one slot retained",
                "Slot capacity alone is insufficient when values grow. The encoded-payload budget evicts C before accepting the larger A.","capacity"));
        ticker.atMillis(4); cache.evict("A"); var newA=cache.beginLoad("A");
        var result=cache.fill(oldA,BoundedCache.Value.text(1,"aaa"));
        steps.add(step("Recreating A does not revive its old ticket",4,cache,result.name(),
                "A is now slot "+newA.slotId()+", while the old ticket still names slot "+oldA.slotId()+". Matching key text and generation zero do not restore old permission.","decision"));
        return new Scenario("capacity","Eviction retires both data and old permission",
                "Use tiny capacities to see exact LRU, the separate byte bound, and why a recreated key needs a new slot incarnation.",2,6,steps);
    }

    private static Step step(String title,long millis,BoundedCache cache,String result,String note,String focus) {
        return new Step(title,millis,cache.snapshot(),cache.stats(),result,note,focus);
    }
    private static String q(String value) {
        return "\""+value.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")
                .replace("\r","\\r").replace("\t","\\t")+"\"";
    }
}
