package kb.chat;

import java.util.ArrayList;
import java.util.List;

/** Source-derived synthetic conversation/device states; no sockets or real messages. */
public final class ChatTrace {
    private record Step(String title,ConversationLog.LogView log,ClientCursor.View phone,ClientCursor.View laptop,String result,String note) {}
    private record Scenario(String id,String title,String description,List<Step> steps) {}
    public static void main(String[] args){
        List<Scenario> cases=List.of(retry(),gap(),access());StringBuilder json=new StringBuilder("{\"source\":\"kb.chat.ChatTrace (local synthetic log and devices)\",\"scenarios\":[");
        for(int i=0;i<cases.size();i++){if(i>0)json.append(',');var scenario=cases.get(i);
            json.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title())).append(",\"description\":").append(q(scenario.description())).append(",\"steps\":[");
            for(int j=0;j<scenario.steps().size();j++){if(j>0)json.append(',');var step=scenario.steps().get(j);var phone=step.phone();
                json.append("{\"title\":").append(q(step.title())).append(",\"serverLast\":").append(step.log().lastSequence()).append(",\"retainedFrom\":").append(step.log().retainedFrom())
                        .append(",\"retained\":").append(numbers(step.log().retained())).append(",\"historyFrom\":").append(phone.historyFrom())
                        .append(",\"delivered\":").append(phone.deliveredThrough()).append(",\"read\":").append(phone.readThrough())
                        .append(",\"buffered\":").append(numbers(phone.buffered())).append(",\"laptopDelivered\":").append(step.laptop().deliveredThrough())
                        .append(",\"result\":").append(q(step.result())).append(",\"note\":").append(q(step.note())).append('}');}
            json.append("]}");}
        System.out.println(json.append("]}"));
    }
    private static Scenario retry(){
        var log=ChatChecks.fixture();var phone=new ClientCursor("C42",8);var laptop=new ClientCursor("C42",8);List<Step> steps=new ArrayList<>();
        log.send("A","phone-uuid-7","Meet at six?");
        steps.add(step("Server commits, but sender ACK is lost",log,phone,laptop,"NO ACK RECEIVED",
                "The local model has one committed message. Asha cannot infer rejection from losing the response; neither recipient device has reported receipt."));
        var replay=log.send("A","phone-uuid-7","Meet at six?");
        steps.add(step("Retry returns the original accepted identity",log,phone,laptop,"ACCEPTED "+replay.messageId()+" / replayed="+replay.replayed(),
                "The same conversation/sender/client ID and bytes resolve to sequence1. The log does not append another logical message."));
        phone.receive(log.sync("B",0,100).messages().getFirst());
        steps.add(step("Phone receives the committed message",log,phone,laptop,"PHONE DELIVERED THROUGH1",
                "Phone delivery advances. Phone read remains0 and the laptop still has no content. A server ACK was not this device receipt."));
        phone.markRead(1);
        steps.add(step("A separate user action marks it read",log,phone,laptop,"PHONE READ THROUGH1",
                "Only the explicit read action advances read state. This is reported application evidence, not proof of human attention."));
        for(var message:log.sync("B",0,100).messages())laptop.receive(message);
        steps.add(step("The laptop catches up independently",log,phone,laptop,"LAPTOP DELIVERED THROUGH1",
                "It fetches its own history range; it did not inherit the phone's delivered cursor. Its own read state remains separate."));
        return new Scenario("retry","Lost acceptance ACK and two devices","A source identity, a device receipt and a user-read signal establish different facts.",steps);
    }
    private static Scenario gap(){
        var log=ChatChecks.fixture();for(int i=1;i<=3;i++)log.send("A","m"+i,"Message "+i);
        var history=log.sync("B",0,100).messages();var phone=new ClientCursor("C42",8);var laptop=new ClientCursor("C42",8);List<Step> steps=new ArrayList<>();
        phone.receive(history.get(0));steps.add(step("Phone receives1",log,phone,laptop,"ADVANCED","The complete received prefix is1; the server already retains1,2,3."));
        var result=phone.receive(history.get(2));steps.add(step("Live3 arrives before2",log,phone,laptop,result.name(),"Buffer3 and keep delivered-through1. The largest observed sequence is not a contiguous receipt."));
        try{phone.markRead(3);throw new AssertionError("read crossed a gap");}catch(IllegalArgumentException expected){}
        steps.add(step("Read cannot jump beyond received content",log,phone,laptop,"READ REJECTED","The local cursor refuses read-through3 while delivered-through is still1."));
        for(var message:log.sync("B",phone.view().deliveredThrough(),100).messages())phone.receive(message);
        steps.add(step("Replay after1 supplies2 and3",log,phone,laptop,"CONTIGUOUS THROUGH3","Receiving2 drains buffered3. Replayed3 is a duplicate. Buffer is empty, but read is still0."));
        phone.markRead(3);steps.add(step("Now an explicit read can reach3",log,phone,laptop,"READ THROUGH3","The laptop remains independent. Live and replay paths use the same immutable identity."));
        return new Scenario("gap","Repair a gap before advancing receipts","A bounded receiver buffer plus durable range replay handles duplicate or reordered delivery work.",steps);
    }
    private static Scenario access(){
        var log=ChatChecks.fixture();for(int i=1;i<=5;i++)log.send("A","m"+i,"Message "+i);
        var phone=new ClientCursor("C42",8);var laptop=new ClientCursor("C42",8);List<Step> steps=new ArrayList<>();
        log.pruneBefore("A",4);var gap=log.sync("B",0,100);
        steps.add(step("Retention removed messages1 through3",log,phone,laptop,gap.gap().name()+" / earliest="+gap.earliestAvailable(),"Sync does not pretend to supply a complete old history. It returns no messages and an explicit boundary."));
        phone.acknowledgeHistoryGap(gap);
        steps.add(step("Client acknowledges the unavailable boundary",log,phone,laptop,"HISTORY WINDOW FROM4","The baseline3 is below the available window; it is not proof that1,2,3 were delivered/read. Show the boundary before continuing."));
        for(var message:log.sync("B",phone.view().deliveredThrough(),100).messages())phone.receive(message);
        steps.add(step("Available history4 and5 is received",log,phone,laptop,"DELIVERED THROUGH5 IN WINDOW4+","The retained range can now be read normally. No old payload was recreated."));
        log.removeMember("A","B");String result;
        try{log.sync("B",5,100);throw new AssertionError("removed member allowed");}catch(ConversationLog.Problem problem){result=Integer.toString(problem.status());}
        steps.add(step("Removed membership blocks the next history gate",log,phone,laptop,result+" NOT A CURRENT MEMBER","Previously received bytes remain on the device; new API access is denied. An old delivery reference is not permission."));
        log.addMember("A","B");var join=log.sync("B",0,100);phone.acknowledgeHistoryGap(join);
        steps.add(step("Rejoin starts after the current log tail",log,phone,laptop,join.gap().name()+" / earliest="+join.earliestAvailable(),"The new available window begins at6. The baseline5 is outside it, not a new read of old content."));
        log.send("A","m6","New after rejoin");for(var message:log.sync("B",phone.view().deliveredThrough(),100).messages())phone.receive(message);
        steps.add(step("Message6 belongs to the new window",log,phone,laptop,"DELIVERED6 / READ BASELINE5","Current permission allows the new message. Read state still needs a user action."));
        return new Scenario("access","Retention and membership define available history","A temporary delivery gap, permanent retention gap and join boundary have different meanings.",steps);
    }
    private static Step step(String title,ConversationLog log,ClientCursor phone,ClientCursor laptop,String result,String note){return new Step(title,log.view(),phone.view(),laptop.view(),result,note);}
    private static String numbers(List<Long> numbers){return numbers.toString();}
    private static String q(String value){return "\""+value.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
}
