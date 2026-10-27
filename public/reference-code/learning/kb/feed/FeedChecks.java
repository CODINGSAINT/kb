package kb.feed;

import java.time.Duration;
import java.util.List;
import java.util.function.LongSupplier;

public final class FeedChecks {
    public static final class Time implements LongSupplier {
        private long nanos;
        public void atMillis(long millis){nanos=Math.multiplyExact(millis,1_000_000L);}
        @Override public long getAsLong(){return nanos;}
    }
    public static FeedEngine fixture(Time time,int sessions,int scanBudget){
        byte[] key=new byte[32];java.util.Arrays.fill(key,(byte)7); // Public test key only.
        FeedEngine engine=new FeedEngine(sessions,200,scanBudget,Duration.ofMinutes(5),time,key);
        engine.follow("V","A",true);engine.follow("V","B",true);engine.pullAuthor("B",true);
        for(int i=1;i<=5;i++){
            String author=i==3||i==5?"B":"A";
            engine.addPost("p"+i,author,"Post "+i,i*60_000L,FeedEngine.Visibility.FOLLOWERS);
            if(author.equals("A")||i==3)engine.materialize("V","p"+i);
        }
        engine.materialize("V","p3"); // Duplicate and hybrid overlap must not duplicate the post.
        return engine;
    }
    public static List<String> ids(FeedEngine.Page page){return page.items().stream().map(FeedEngine.Item::id).toList();}
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void problem(int status,Runnable action){
        try{action.run();throw new AssertionError("expected "+status);}catch(FeedEngine.Problem p){check(p.status()==status,p.getMessage());}
    }
    public static void main(String[] args){
        Time time=new Time();FeedEngine engine=fixture(time,8,2);
        byte[] publicKey=new byte[32];java.util.Arrays.fill(publicKey,(byte)9);
        FeedEngine capped=new FeedEngine(4,200,200,Duration.ofMinutes(5),time,publicKey);
        for(int i=0;i<51;i++){String author=String.format(java.util.Locale.ROOT,"a%02d",i);capped.follow("V",author,true);capped.pullAuthor(author,true);capped.addPost("p"+i,author,"post",i,FeedEngine.Visibility.FOLLOWERS);}
        capped.favorite("V","a00",true);
        var limited=capped.open("V",20);var limitedView=capped.session(limited.sessionId());
        check(limitedView.selectedPullAuthors()==50&&limitedView.frozenOrder().size()==50,"author cap applies before 200-ID session cap");
        check(limitedView.frozenOrder().contains("p0")&&!limitedView.frozenOrder().contains("p1"),"favorites first, then recent activity");
        FeedEngine maximum=new FeedEngine(4,200,200,Duration.ofMinutes(5),time,publicKey);
        for(int i=0;i<51;i++){String author="pull"+i;maximum.follow("V",author,true);maximum.pullAuthor(author,true);for(int j=0;j<10;j++)maximum.addPost(author+"-"+j,author,"post",i*100+j,FeedEngine.Visibility.FOLLOWERS);}
        maximum.follow("V","ordinary",true);
        for(int i=0;i<200;i++){String id="inbox"+i;maximum.addPost(id,"ordinary","post",20_000+i,FeedEngine.Visibility.FOLLOWERS);maximum.materialize("V",id);}
        for(int i=0;i<20;i++)maximum.addPost("own"+i,"V","post",30_000+i,FeedEngine.Visibility.SELF);
        var full=maximum.open("V",20);var fullView=maximum.session(full.sessionId());
        check(fullView.initialCandidates()==720&&fullView.selectedPullAuthors()==50,"initial candidate fan-in bounded before dedup/rank/session retention");
        var first=engine.open("V",1);check(ids(first).equals(List.of("p5")),"pull author joins materialized candidates");
        check(engine.session(first.sessionId()).frozenOrder().equals(List.of("p5","p4","p3","p2","p1")),"overlap deduplicates and sort is total");
        var retry=engine.page("V",first.nextCursor());check(ids(retry).equals(List.of("p4")),"forward continuation");
        check(ids(engine.page("V",first.nextCursor())).equals(ids(retry)),"replayed read cursor repeats the same eligible page");
        engine.addPost("p6","B","New post",360_000,FeedEngine.Visibility.PUBLIC);
        check(!engine.session(first.sessionId()).frozenOrder().contains("p6"),"new post cannot shift old session");
        check(ids(engine.open("V",1)).equals(List.of("p6")),"refresh sees a new pull-author post");
        engine.favorite("V","A",true);check(ids(engine.open("V",1)).equals(List.of("p4")),"defined favorite boost is evaluated at session creation");

        time.atMillis(0);engine=fixture(time,8,2);first=engine.open("V",1);
        engine.changeVisibility("A","p4",FeedEngine.Visibility.SELF);engine.delete("B","p3");
        var empty=engine.page("V",first.nextCursor());
        check(empty.items().isEmpty()&&empty.nextCursor()!=null&&empty.scanned()==2&&empty.nextIndex()==3,"empty filtered page still advances by scanned candidates");
        engine.follow("V","A",false);
        check(engine.page("V",empty.nextCursor()).items().isEmpty(),"unfollow blocks old materialized references");
        FeedEngine blockEngine=fixture(time,8,2);blockEngine.addPost("p6","B","New post",360_000,FeedEngine.Visibility.PUBLIC);
        var beforeBlock=blockEngine.open("V",1);blockEngine.block("B","V",true);
        check(ids(blockEngine.page("V",beforeBlock.nextCursor())).equals(List.of("p4")),"author block skips the next B candidate before returning A");
        try{engine.delete("V","p1");throw new AssertionError("non-owner delete");}catch(SecurityException expected){}

        time.atMillis(0);final FeedEngine cursorEngine=fixture(time,8,2);var page=cursorEngine.open("V",1);String cursor=page.nextCursor();
        problem(400,()->cursorEngine.page("another-viewer",cursor));
        String tampered=(cursor.charAt(0)=='A'?"B":"A")+cursor.substring(1);
        problem(400,()->cursorEngine.page("V",tampered));
        FeedEngine otherProcess=fixture(time,8,2);otherProcess.open("V",1);
        problem(400,()->otherProcess.page("V",cursor));
        time.atMillis(300_000);problem(410,()->cursorEngine.page("V",cursor));

        time.atMillis(0);final FeedEngine bounded=fixture(time,1,2);var old=bounded.open("V",1);
        bounded.open("another-viewer",1);problem(410,()->bounded.page("V",old.nextCursor()));
        System.out.println("PASS FeedChecks: 50-author/720-candidate fan-in, hybrid merge/dedup, frozen ranking, current visibility/delete/unfollow/block, scan cursor progress, tamper/viewer/incarnation binding, TTL equality, bounded sessions");
    }
}
