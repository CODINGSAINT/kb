package kb.chat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;

public final class ChatChecks {
    public static ConversationLog fixture(){ConversationLog log=new ConversationLog("C42","A");log.addMember("A","B");return log;}
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void problem(int status,Runnable action){try{action.run();throw new AssertionError("expected "+status);}catch(ConversationLog.Problem p){check(p.status()==status,p.getMessage());}}
    public static void main(String[] args)throws Exception{
        var log=fixture();var accepted=log.send("A","phone-1","Meet at six?");
        var replay=log.send("A","phone-1","Meet at six?");
        check(accepted.sequence()==1&&replay.sequence()==1&&replay.replayed()&&log.lastSequence()==1,"lost-ack retry returns one source identity");
        problem(409,()->log.send("A","phone-1","Changed body"));
        problem(403,()->log.send("stranger","x","Hello"));
        log.send("A","phone-2","North entrance");log.send("B","reply-1","Yes");
        var history=log.sync("B",0,100).messages();
        check(history.stream().map(ConversationLog.Message::sequence).toList().equals(List.of(1L,2L,3L)),"committed conversation order");
        ClientCursor phone=new ClientCursor("C42",8),laptop=new ClientCursor("C42",8);
        phone.receive(history.get(0));
        check(phone.receive(history.get(2))==ClientCursor.Receive.BUFFERED&&phone.view().deliveredThrough()==1,"a later live event cannot jump the contiguous cursor");
        try{phone.markRead(3);throw new AssertionError("unreceived read");}catch(IllegalArgumentException expected){}
        for(var message:log.sync("B",phone.view().deliveredThrough(),100).messages())phone.receive(message);
        check(phone.view().deliveredThrough()==3&&phone.view().buffered().isEmpty(),"history fills the missing range");
        check(phone.view().readThrough()==0&&laptop.view().deliveredThrough()==0,"received, read and other device are separate");
        phone.markRead(3);phone.markRead(1);check(phone.view().readThrough()==3,"read high-water mark is monotonic within its window");
        check(phone.receive(history.get(2))==ClientCursor.Receive.DUPLICATE,"duplicate live/replay event is ignored");

        log.removeMember("A","B");problem(403,()->log.sync("B",0,100));problem(403,()->log.send("B","reply-1","Yes"));
        log.addMember("A","B");var join=log.sync("B",0,100);
        check(join.gap()==ConversationLog.Gap.JOIN_BOUNDARY&&join.earliestAvailable()==4,"rejoin has an explicit new history floor");
        var rejoined=new ClientCursor("C42",8);rejoined.acknowledgeHistoryGap(join);
        log.send("A","phone-3","We are inside");
        for(var message:log.sync("B",rejoined.view().deliveredThrough(),100).messages())rejoined.receive(message);
        check(rejoined.view().historyFrom()==4&&rejoined.view().deliveredThrough()==4&&rejoined.view().readThrough()==3,"baseline below window is not an old-history read claim");

        var retained=fixture();for(int i=1;i<=5;i++)retained.send("A","m"+i,"Message "+i);
        retained.pruneBefore("A",4);var gap=retained.sync("B",1,100);
        check(gap.gap()==ConversationLog.Gap.RETENTION&&gap.messages().isEmpty()&&gap.nextAfter()==3,"retention is explicit rather than pretending a full replay");
        var offline=new ClientCursor("C42",8);offline.acknowledgeHistoryGap(gap);
        for(var message:retained.sync("B",offline.view().deliveredThrough(),100).messages())offline.receive(message);
        check(offline.view().historyFrom()==4&&offline.view().deliveredThrough()==5,"available range resumes after an acknowledged gap");
        check(retained.send("A","m1","Message 1").sequence()==1&&retained.lastSequence()==5,"dedup receipt does not restore removed payload");
        problem(400,()->retained.sync("B",99,10));
        check(new ClientCursor("C42",2).receive(new ConversationLog.Message(9,"C42/9","A","far"))==ClientCursor.Receive.RESYNC_REQUIRED,"live gap buffer is bounded");

        final var race=fixture();
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()){
            var jobs=new ArrayList<java.util.concurrent.Callable<ConversationLog.Accepted>>();
            for(int i=0;i<32;i++)jobs.add(()->race.send("A","same","one logical message"));
            for(var result:pool.invokeAll(jobs))check(result.get().sequence()==1,"duplicate send race");
        }
        check(race.lastSequence()==1,"one committed local append under32 retries");
        System.out.println("PASS ChatChecks: stable accept/retry, sequence order, bounded gap repair/dedup, device/read separation, membership/rejoin floor, retention gap, no payload revival, 32 duplicate senders");
    }
}
