package kb.notification;

import java.util.ArrayList;
import java.util.List;

/** Recorded local dispatch/fake-provider operations; never sends a real notification. */
public final class NotificationTrace {
    private record Step(String title,long millis,DispatchEngine.View delivery,int calls,int acceptances,String result,String note) {}
    private record Scenario(String id,String title,String description,List<Step> steps) {}
    public static void main(String[] args) {
        List<Scenario> cases=List.of(timeout(),optout(),lease(),unsafe());
        StringBuilder json=new StringBuilder("{\n  \"source\":\"kb.notification.NotificationTrace (local fake providers only)\",\n  \"scenarios\":[\n");
        for (int i=0;i<cases.size();i++) {
            if (i>0) json.append(",\n"); var scenario=cases.get(i);
            json.append("    {\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title()))
                    .append(",\"description\":").append(q(scenario.description())).append(",\"steps\":[\n");
            for (int j=0;j<scenario.steps().size();j++) {
                if (j>0) json.append(",\n"); var step=scenario.steps().get(j); var d=step.delivery();
                json.append("      {\"title\":").append(q(step.title())).append(",\"millis\":").append(step.millis())
                        .append(",\"state\":").append(q(d.state().name())).append(",\"attempts\":").append(d.attempts())
                        .append(",\"epoch\":").append(d.epoch()).append(",\"nextAt\":").append(d.nextAt())
                        .append(",\"leaseUntil\":").append(d.leaseUntil()).append(",\"uncertain\":").append(d.uncertain())
                        .append(",\"messageId\":").append(q(d.providerMessageId()))
                        .append(",\"reason\":").append(q(d.reason())).append(",\"observedAcceptances\":").append(d.observedAcceptances())
                        .append(",\"providerCalls\":").append(step.calls()).append(",\"providerAcceptances\":").append(step.acceptances())
                        .append(",\"result\":").append(q(step.result())).append(",\"note\":").append(q(step.note())).append('}');
            }
            json.append("\n    ]}");
        }
        System.out.println(json.append("\n  ]\n}"));
    }

    private static Scenario timeout() {
        var time=new NotificationChecks.Time(); var engine=NotificationChecks.engine(time);
        String id=engine.enqueue(NotificationChecks.draft("timeout",0,900_000,60_000));
        var provider=new FakeProvider(time,60_000,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        List<Step> steps=new ArrayList<>();
        steps.add(step("One delivery identity is ready",time,engine,id,provider,"READY",
                "The example starts after ingestion. Repeated queue work refers to this same delivery; it is not another email request identity."));
        var a=engine.claim(id,"A").orElseThrow(); var request=engine.authorize(a).orElseThrow();
        steps.add(step("A claims and passes the current preference gate",time,engine,id,provider,"SEND AUTHORIZED",
                "The provider key and request bytes are frozen. No provider call runs inside the engine's monitor."));
        engine.complete(a,provider.send(request));
        steps.add(step("Provider accepts, but the response is lost",time,engine,id,provider,"UNKNOWN → RETRY_WAIT",
                "The fake provider ledger has one accepted message. The service only knows an uncertain outcome and schedules a bounded retry for t=1000 ms."));
        time.at(999); boolean early=engine.claim(id,"B").isPresent();
        steps.add(step("The retry is not due yet",time,engine,id,provider,early?"CLAIMED":"NOT DUE",
                "At t=999 the original retry time has not arrived. No additional provider request is made."));
        time.at(1000); var b=engine.claim(id,"B").orElseThrow();
        engine.complete(b,provider.send(engine.authorize(b).orElseThrow()));
        steps.add(step("The same key returns the original provider ID",time,engine,id,provider,"PROVIDER_ACCEPTED",
                "A read-only lookup recovers the original ID while retained; it can never create a second send. This does not prove mailbox delivery or user read."));
        return new Scenario("timeout","A timeout after provider acceptance",
                "Watch internal uncertainty differ from the external fake ledger. A stable key can help only when the provider actually supports its read-only lookup contract.",steps);
    }

    private static Scenario optout() {
        var time=new NotificationChecks.Time(); var engine=NotificationChecks.engine(time);
        String id=engine.enqueue(NotificationChecks.draft("optout",0,900_000,60_000));
        var provider=new FakeProvider(time,60_000); List<Step> steps=new ArrayList<>();
        var claim=engine.claim(id,"A").orElseThrow();
        steps.add(step("A claims queued work",time,engine,id,provider,"CLAIMED",
                "Claiming is not permission to skip current preferences. No external attempt has been authorized."));
        time.at(500); engine.preference("U21","email",false,"u21@example.invalid");
        steps.add(step("The customer disables the channel",time,engine,id,provider,"PREFERENCE COMMITTED",
                "The delivery is still claimed, but the authoritative preference changed before its final authorization gate."));
        boolean allowed=engine.authorize(claim).isPresent();
        steps.add(step("The fresh gate suppresses the attempt",time,engine,id,provider,allowed?"AUTHORIZED":"SUPPRESSED",
                "There are zero provider calls. A request already authorized or in flight would have a different boundary and could not be recalled."));
        return new Scenario("optout","Opt-out arrives while work waits",
                "Preferences are checked before each send authorization, rather than only when an event enters the queue.",steps);
    }

    private static Scenario lease() {
        var time=new NotificationChecks.Time(); var engine=NotificationChecks.engine(time);
        String id=engine.enqueue(NotificationChecks.draft("lease",0,900_000,60_000));
        var provider=new FakeProvider(time,60_000); List<Step> steps=new ArrayList<>();
        var a=engine.claim(id,"old-A").orElseThrow();
        var heldResponse=provider.send(engine.authorize(a).orElseThrow());
        steps.add(step("A's external call accepted; completion is delayed",time,engine,id,provider,"SENDING / EPOCH 1",
                "The provider ledger has one acceptance, but the local row is still SENDING. Simulate a paused worker before it records the response."));
        time.at(29_999); boolean claimed=engine.claim(id,"B").isPresent();
        steps.add(step("The live lease cannot be taken",time,engine,id,provider,claimed?"CLAIMED":"LEASE STILL LIVE",
                "At t=29999 another worker cannot own this row. Provider latency does not turn queue redelivery into new permission."));
        time.at(30_000); var b=engine.claim(id,"B").orElseThrow();
        steps.add(step("At lease equality B becomes the owner",time,engine,id,provider,"CLAIMED / NEW EPOCH",
                "Reclaiming a SENDING row advances the claim epoch and preserves uncertainty about its external side effect."));
        var late=engine.complete(a,heldResponse);
        steps.add(step("A's late update is fenced; its evidence is retained",time,engine,id,provider,late.name(),
                "The dispatch state stays owned by B. A deduplicated acceptance observation is still retained; fencing state is not permission to erase an external fact."));
        engine.complete(b,provider.send(engine.authorize(b).orElseThrow()));
        steps.add(step("B resolves with the same immutable provider key",time,engine,id,provider,"PROVIDER_ACCEPTED",
                "The old epoch does not create a new provider identity. The read-only lookup returns its original ID, leaving one physical acceptance."));
        return new Scenario("lease","A stale worker cannot overwrite its replacement",
                "A 30-second lease and claim epoch control local ownership. They do not undo an external call that already happened.",steps);
    }

    private static Scenario unsafe() {
        var time=new NotificationChecks.Time(); var engine=NotificationChecks.engine(time);
        String id=engine.enqueue(NotificationChecks.draft("unsafe",0,900_000,0));
        var provider=new FakeProvider(time,0,FakeProvider.Behavior.TIMEOUT_AFTER_ACCEPT);
        List<Step> steps=new ArrayList<>();
        var claim=engine.claim(id,"A").orElseThrow(); var request=engine.authorize(claim).orElseThrow();
        steps.add(step("This adapter has no safe replay window",time,engine,id,provider,"SEND AUTHORIZED",
                "The delivery records zero lookup-history milliseconds. A stable local key alone does not make the external provider deduplicate."));
        engine.complete(claim,provider.send(request));
        steps.add(step("An unknown outcome becomes reconciliation work",time,engine,id,provider,"DEAD_LETTER",
                "The fake accepted one message before the timeout. The service cannot safely guess whether another call would duplicate it, so it quarantines rather than blindly resends."));
        time.at(1000); boolean again=engine.claim(id,"B").isPresent();
        steps.add(step("Automatic queue redelivery does not resend",time,engine,id,provider,again?"CLAIMED":"TERMINAL DISPOSITION",
                "Provider calls remain one. A real reconciler needs lookup/callback evidence or a recorded operator decision; a new key is not a safe generic repair."));
        return new Scenario("unsafe","No safe replay contract means no blind retry",
                "The chosen policy favors a visible unresolved reminder over inventing exactly-once behavior for an uncertain provider.",steps);
    }
    private static Step step(String title,NotificationChecks.Time time,DispatchEngine engine,String id,
                             FakeProvider provider,String result,String note) {
        return new Step(title,time.millis(),engine.view(id),provider.calls(),provider.physicalAcceptances(),result,note);
    }
    private static String q(String value) {
        return "\""+value.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")
                .replace("\r","\\r").replace("\t","\\t")+"\"";
    }
}
