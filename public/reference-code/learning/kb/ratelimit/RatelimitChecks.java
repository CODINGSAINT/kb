package kb.ratelimit;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class RatelimitChecks {
    static int checks;
    static void ok(boolean b,String message){checks++;if(!b)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        TokenBucket b=new TokenBucket(5,2,0);
        for(int i=0;i<5;i++)ok(b.allow(0,1).allowed(),"initial burst");
        var deny=b.allow(0,1);ok(!deny.allowed()&&deny.retryAfterMillis()==500,"empty bucket waits half second");
        var half=b.allow(250,1);ok(!half.allowed()&&half.tokens()==.5&&half.retryAfterMillis()==250,"fractional refill preserved");
        ok(b.allow(500,1).allowed(),"one token at boundary");
        ok(b.allow(500,1).retryAfterMillis()==500,"same timestamp cannot refill twice");
        ok(b.allow(3000,5).allowed(),"idle refill caps at five");
        TokenBucket back=new TokenBucket(2,1,1000);back.allow(1000,2);
        var regressed=back.allow(500,1);ok(!regressed.allowed()&&regressed.retryAfterMillis()==1500,"backwards clock delays refill");
        ok(back.allow(1000,1).tokens()==0,"returning to old timestamp does not double refill");
        ok(back.allow(2000,1).allowed(),"clock catches up then earns one token");
        TokenBucket slow=new TokenBucket(1000,1,0);slow.allow(0,1000);
        ok(slow.allow(0,1).idleTtlMillis()==1_000_001,"TTL exceeds time to full, not fixed 60 seconds");
        var boundary=new TokenBucket(1_000_000,1_000_000,0).allow(9_000_000_000_000L,1);
        ok(boundary.tokens()==999999,"large elapsed time cannot overflow refill");
        TokenBucket sampled=new TokenBucket(1,1000,0);
        ok(sampled.allow(0,1).allowed() && sampled.allow(1,1).allowed(),"envelope is defined over sampled milliseconds; a boundary can grant a full millisecond of credit");
        // Verify the traffic envelope over every subinterval of deterministic random arrival histories.
        Random random=new Random(42);
        for(int trial=0;trial<40;trial++) {
            TokenBucket bucket=new TokenBucket(7,3,0);List<Long> times=new ArrayList<>();List<Integer> costs=new ArrayList<>();long t=0;
            for(int i=0;i<70;i++){t+=random.nextInt(200);int cost=1+random.nextInt(3);if(bucket.allow(t,cost).allowed()){times.add(t);costs.add(cost);}}
            for(int i=0;i<times.size();i++){long accepted=0;for(int j=i;j<times.size();j++){accepted+=costs.get(j);ok(accepted*1000<=7000+(times.get(j)-times.get(i))*3,"admitted cost respects burst + refill envelope");}}
        }
        TokenBucket shared=new TokenBucket(5,1,0);AtomicInteger winners=new AtomicInteger();CountDownLatch go=new CountDownLatch(1);
        try(ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> jobs=new ArrayList<>();for(int i=0;i<100;i++)jobs.add(pool.submit(()->{try{go.await();if(shared.allow(0,1).allowed())winners.incrementAndGet();}catch(InterruptedException e){throw new RuntimeException(e);}}));
            go.countDown();for(Future<?> f:jobs)f.get();
        }
        ok(winners.get()==5,"100 callers cannot spend more than five tokens");
        System.out.println("PASS RatelimitChecks: "+checks+" checks; fractional refill, clock regression, envelope and 100-caller race");
    }
}
