package kb.feed;

import java.util.ArrayList;
import java.util.List;

/** Synthetic authority inputs; all returned pages/order come from FeedEngine. */
public final class FeedTrace {
    private record Step(String title,long millis,List<String> order,List<String> returned,int index,int scanned,
                        boolean more,String result,String note) {}
    private record Scenario(String id,String title,String description,List<Step> steps) {}
    public static void main(String[] args){
        List<Scenario> cases=List.of(stable(),privacy(),expiry());
        StringBuilder json=new StringBuilder("{\"source\":\"kb.feed.FeedTrace (Java21 local mechanism)\",\"scenarios\":[");
        for(int i=0;i<cases.size();i++){
            if(i>0)json.append(',');Scenario scenario=cases.get(i);
            json.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title()))
                    .append(",\"description\":").append(q(scenario.description())).append(",\"steps\":[");
            for(int j=0;j<scenario.steps().size();j++){
                if(j>0)json.append(',');Step step=scenario.steps().get(j);
                json.append("{\"title\":").append(q(step.title())).append(",\"millis\":").append(step.millis())
                        .append(",\"order\":").append(array(step.order())).append(",\"returned\":").append(array(step.returned()))
                        .append(",\"index\":").append(step.index()).append(",\"scanned\":").append(step.scanned())
                        .append(",\"more\":").append(step.more()).append(",\"result\":").append(q(step.result()))
                        .append(",\"note\":").append(q(step.note())).append('}');
            }
            json.append("]}");
        }
        System.out.println(json.append("]}"));
    }
    private static Scenario stable(){
        var time=new FeedChecks.Time();var engine=FeedChecks.fixture(time,8,2);List<Step> steps=new ArrayList<>();
        var first=engine.open("V",2);
        steps.add(step("Merge overlap once and freeze the order",0,engine,first,true,"200 PAGE",
                "Pushed references overlap B's pull timeline at p3. The snapshot contains each ID once; page one returns p5 and p4."));
        time.atMillis(1000);engine.addPost("p6","B","New post",360_000,FeedEngine.Visibility.PUBLIC);
        steps.add(step("p6 arrives after session creation",1000,engine,first,false,"NEW SOURCE POST",
                "The authoritative post and pull timeline now contain p6, but the existing session's order and cursor position are unchanged."));
        var second=engine.page("V",first.nextCursor());
        steps.add(step("Continue the original session",1000,engine,second,true,"200 PAGE",
                "The original cursor returns p3 and p2. A changing global offset would have moved underneath the reader; this snapshot does not."));
        var refreshed=engine.open("V",2);
        steps.add(step("Refresh chooses a new candidate snapshot",1000,engine,refreshed,true,"200 NEW SESSION",
                "Refresh is a new traversal. It can include p6 and repeat p5 intentionally; response/session identities remain distinct."));
        engine.favorite("V","A",true);var favorite=engine.open("V",2);
        steps.add(step("A favorite changes only a new ranking",1000,engine,favorite,true,"200 NEW RANKING",
                "The defined 30-minute favorite boost places A's p4 and p2 first. Earlier snapshots keep their already-frozen order."));
        return new Scenario("stable","New posts and favorites do not shift old pages",
                "Viewer V follows ordinary author A and pull author B. The v1 ranking is deterministic; refreshing starts a different session.",steps);
    }
    private static Scenario privacy(){
        var time=new FeedChecks.Time();var engine=FeedChecks.fixture(time,8,2);List<Step> steps=new ArrayList<>();
        var first=engine.open("V",1);
        steps.add(step("Page one returns p5",0,engine,first,true,"200 PAGE",
                "The session retains p5,p4,p3,p2,p1. It freezes order, not permanent permission."));
        time.atMillis(100);engine.changeVisibility("A","p4",FeedEngine.Visibility.SELF);engine.delete("B","p3");
        steps.add(step("p4 becomes author-only; p3 is deleted",100,engine,first,false,"AUTHORITY CHANGED",
                "Old references and session IDs remain, but they are not permission to expose either body."));
        var empty=engine.page("V",first.nextCursor());
        steps.add(step("A filtered empty page still advances",100,engine,empty,true,"200 EMPTY / MORE",
                "The budget scans p4 and p3, filters both, and advances to index3. The continuation is not null, so this empty page does not mean exhaustion."));
        engine.follow("V","A",false);
        steps.add(step("Unfollow changes the next gate",100,engine,empty,false,"FOLLOW REMOVED",
                "p2 and p1 remain materialized candidates but no longer belong to this home feed."));
        var end=engine.page("V",empty.nextCursor());
        steps.add(step("The final hidden candidates are consumed",100,engine,end,true,"200 EMPTY / END",
                "The cursor advances to index5 and becomes null. No private/deleted/unfollowed body was returned by these pages."));
        return new Scenario("privacy","A stored reference does not grant permission",
                "Use page size1 and scan budget2 to see why the cursor tracks examined candidates, including newly hidden ones.",steps);
    }
    private static Scenario expiry(){
        var time=new FeedChecks.Time();var engine=FeedChecks.fixture(time,8,2);List<Step> steps=new ArrayList<>();
        var first=engine.open("V",1);
        steps.add(step("The cursor belongs to V and this session",0,engine,first,true,"200 PAGE",
                "The signed cursor authenticates the viewer, session position and local instance. It is not just a base64 index."));
        String result;
        try{engine.page("another-viewer",first.nextCursor());throw new AssertionError("foreign cursor accepted");}
        catch(FeedEngine.Problem problem){result=Integer.toString(problem.status());}
        steps.add(step("A different viewer cannot reuse it",0,engine,first,false,result+" INVALID CURSOR",
                "No page content is returned to the other viewer and V's legitimate cursor is not consumed."));
        time.atMillis(300_000);
        try{engine.page("V",first.nextCursor());throw new AssertionError("expired cursor accepted");}
        catch(FeedEngine.Problem problem){result=Integer.toString(problem.status());}
        steps.add(step("At five minutes, expiry is exact",300_000,engine,first,false,result+" REFRESH REQUIRED",
                "The expired session is removed. The server does not silently replace it with a different ordering under the old token."));
        var refreshed=engine.open("V",1);
        steps.add(step("Explicit refresh creates usable state",300_000,engine,refreshed,true,"200 NEW SESSION",
                "The new session gets its own lifetime and ordering. The previous cursor remains invalid for its old session."));
        return new Scenario("expiry","A cursor has an owner and a lifetime",
                "Authentication and session retention are separate from ranking. Capacity eviction also produces refresh-required, rather than silent continuation.",steps);
    }
    private static Step step(String title,long millis,FeedEngine engine,FeedEngine.Page page,boolean response,String result,String note){
        List<String> order;boolean retained=true;
        try{order=engine.session(page.sessionId()).frozenOrder();}catch(FeedEngine.Problem error){order=List.of();retained=false;}
        return new Step(title,millis,order,response?FeedChecks.ids(page):List.of(),page.nextIndex(),response?page.scanned():0,
                retained&&page.nextCursor()!=null,result,note);
    }
    private static String array(List<String> values){return "["+values.stream().map(FeedTrace::q).reduce((a,b)->a+","+b).orElse("")+"]";}
    private static String q(String value){return "\""+value.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
}
