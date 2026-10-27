package kb.ratelimit;

/** Integer-millisecond model of one bucket. Redis executes the same decision atomically across gateways. */
public final class TokenBucket {
    public record Decision(boolean allowed, double tokens, long retryAfterMillis, long idleTtlMillis) {}
    private final long capacityUnits, refillPerMillis;
    private long units, lastMillis;
    public TokenBucket(int capacity, int tokensPerSecond, long nowMillis) {
        if(capacity<1 || capacity>1_000_000 || tokensPerSecond<1 || tokensPerSecond>1_000_000)
            throw new IllegalArgumentException("capacity and refill must be integers in 1..1000000");
        timestamp(nowMillis);capacityUnits=capacity*1000L;units=capacityUnits;refillPerMillis=tokensPerSecond;lastMillis=nowMillis;
    }
    // BEGIN decision
    public synchronized Decision allow(long nowMillis, int cost) {
        timestamp(nowMillis);
        if(cost<1 || cost*1000L>capacityUnits) throw new IllegalArgumentException("cost must fit in the bucket");
        long horizon=ceilDiv(capacityUnits,refillPerMillis);
        long elapsed=Math.max(0,nowMillis-lastMillis);
        units=Math.min(capacityUnits,units+Math.min(elapsed,horizon)*refillPerMillis);
        lastMillis=Math.max(lastMillis,nowMillis); // Never move the refill watermark backwards.
        long need=cost*1000L;
        boolean allowed=units>=need;
        if(allowed) units-=need;
        long clockDebt=lastMillis-nowMillis;
        long retry=allowed?0:clockDebt+ceilDiv(need-units,refillPerMillis);
        long ttl=clockDebt+ceilDiv(capacityUnits-units,refillPerMillis)+1;
        return new Decision(allowed,units/1000.0,retry,ttl);
    }
    // END decision
    private static long ceilDiv(long n,long d){return n/d+(n%d==0?0:1);}
    private static void timestamp(long n){if(n<0 || n>9_000_000_000_000L)throw new IllegalArgumentException("timestamp outside supported millisecond range");}
}
