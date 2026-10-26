package kb.cache;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.function.LongSupplier;

public final class CacheChecks {
    public static final class Ticker implements LongSupplier {
        private volatile long nanos;
        public void atMillis(long millis) { nanos=Math.multiplyExact(millis,1_000_000L); }
        public void raw(long value) { nanos=value; }
        @Override public long getAsLong() { return nanos; }
    }
    private static void check(boolean value,String message) {
        if (!value) throw new AssertionError(message);
    }
    private static BoundedCache cache(int slots,long bytes,Ticker ticker) {
        return new BoundedCache(slots,bytes,Duration.ofSeconds(10),ticker);
    }
    public static void main(String[] args) throws Exception {
        Ticker time=new Ticker(); BoundedCache cache=cache(2,100,time);
        var old=cache.beginLoad("card:7");
        time.atMillis(1000); cache.invalidate("card:7",2);
        check(cache.fill(old,BoundedCache.Value.text(1,"old"))==BoundedCache.Fill.INVALIDATED,
                "invalidation retires an old generation");
        var fresh=cache.beginLoad("card:7");
        check(cache.fill(fresh,BoundedCache.Value.text(1,"old"))==BoundedCache.Fill.OLDER_VERSION,
                "new tickets still respect the retained source floor");
        check(cache.fill(fresh,BoundedCache.Value.text(2,"new"))==BoundedCache.Fill.STORED,"new version fills");
        cache.invalidate("card:7",1); cache.invalidate("card:7",2);
        check(cache.get("card:7").orElseThrow().value().version()==2,"old/duplicate events preserve a newer copy");
        check(cache.fill(fresh,BoundedCache.Value.text(2,"different"))==BoundedCache.Fill.CONFLICTING_VALUE,
                "one version cannot describe conflicting values in the same slot");
        byte[] exposed=cache.get("card:7").orElseThrow().value().payload(); exposed[0]=0;
        check(cache.get("card:7").orElseThrow().value().payload()[0]=='n',"returned bytes are immutable copies");

        time.atMillis(0); BoundedCache expiry=cache(2,100,time);
        var delayed=expiry.beginLoad("card:7"); time.atMillis(9000);
        check(expiry.fill(delayed,BoundedCache.Value.text(1,"old"))==BoundedCache.Fill.STORED,"fill may arrive before deadline");
        check(expiry.get("card:7").orElseThrow().remainingNanos()==1_000_000_000L,"age starts before source read, not fill");
        time.atMillis(10_000);
        check(expiry.get("card:7").isEmpty(),"equality expires");
        check(expiry.fill(delayed,BoundedCache.Value.text(1,"old"))==BoundedCache.Fill.TOO_OLD,"late ticket cannot renew");

        time.atMillis(0); BoundedCache capacity=cache(2,6,time);
        var retired=capacity.beginLoad("A"); capacity.fill(retired,BoundedCache.Value.text(1,"aaa"));
        var b=capacity.beginLoad("B"); capacity.fill(b,BoundedCache.Value.text(1,"bbb"));
        capacity.get("A"); // A is most recent, so B must leave first.
        var c=capacity.beginLoad("C"); capacity.fill(c,BoundedCache.Value.text(1,"ccc"));
        check(capacity.snapshot().stream().map(BoundedCache.SlotView::key).toList().equals(List.of("A","C")),"LRU slot bound");
        var a=capacity.beginLoad("A"); capacity.fill(a,BoundedCache.Value.text(2,"aaaa"));
        check(capacity.stats().slots()==1 && capacity.stats().payloadBytes()==4,"byte pressure evicts another entire slot");
        capacity.evict("A"); var replacement=capacity.beginLoad("A");
        check(replacement.slotId()!=retired.slotId(),"recreated key has a new slot incarnation");
        check(capacity.fill(retired,BoundedCache.Value.text(1,"aaa"))==BoundedCache.Fill.RETIRED_SLOT,"no ABA after metadata eviction");
        check(capacity.fill(replacement,BoundedCache.Value.text(2,"1234567"))==BoundedCache.Fill.TOO_LARGE,"oversize fill does not exceed payload budget");
        check(capacity.stats().payloadBytes()==0,"rejected fills retain no payload");
        for (int i=0;i<100;i++) capacity.invalidate("missing:"+i,1);
        check(capacity.stats().slots()<=2,"tombstones and absent-key invalidations are bounded too");

        time.atMillis(0); BoundedCache versions=cache(2,100,time);
        var slow=versions.beginLoad("card:7"); var fast=versions.beginLoad("card:7");
        versions.fill(fast,BoundedCache.Value.text(3,"v3"));
        check(versions.fill(slow,BoundedCache.Value.text(2,"v2"))==BoundedCache.Fill.OLDER_VERSION,"concurrent fills cannot regress a retained slot");
        versions.clear(); versions.beginLoad("card:7");
        check(versions.fill(fast,BoundedCache.Value.text(3,"v3"))==BoundedCache.Fill.RETIRED_SLOT,"clear retires old tickets");

        Ticker wrapped=new Ticker(); wrapped.raw(Long.MAX_VALUE-5_000_000L);
        BoundedCache wrapCache=cache(1,100,wrapped); var wrap=wrapCache.beginLoad("wrap");
        wrapCache.fill(wrap,BoundedCache.Value.text(1,"ok"));
        wrapped.raw(Long.MIN_VALUE+4_999_999L);
        check(wrapCache.get("wrap").isPresent(),"elapsed subtraction works across nanoTime wrap for short intervals");

        time.atMillis(0); BoundedCache shared=cache(1,100,time); var ticket=shared.beginLoad("race");
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var jobs=new java.util.ArrayList<java.util.concurrent.Callable<Void>>();
            for (int i=1;i<=32;i++) { final int version=i; jobs.add(()->{ shared.invalidate("race",version); return null; }); }
            for (var job:pool.invokeAll(jobs)) job.get();
        }
        check(shared.fill(ticket,BoundedCache.Value.text(1,"old"))==BoundedCache.Fill.INVALIDATED,"old ticket loses after concurrent invalidations");
        check(shared.snapshot().getFirst().minimumVersion()==32,"out-of-order invalidations retain the maximum version");
        System.out.println("PASS CacheChecks: generation/version fences, delayed fill, TTL equality, byte/slot bounds, LRU, ABA retirement, defensive copies, nanoTime wrap, 32 invalidations");
    }
}
