package kb.ratelimit;

import java.util.*;

public final class RatelimitTrace {
    static String q(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
    public static void main(String[] args) {
        TokenBucket bucket=new TokenBucket(5,2,0);List<String> steps=new ArrayList<>();int backend=0;
        long[] times={0,0,0,0,0,0,250,500,3000};
        String[] titles={"Request 1 spends a token","Request 2 spends a token","Request 3 spends a token","Request 4 spends a token","Request 5 uses the last token","Request 6 is rejected","A quarter-second earns half a token","At half a second, one request can enter","An idle bucket fills, but never beyond five"};
        for(int i=0;i<times.length;i++) {
            var d=bucket.allow(times[i],1);if(d.allowed())backend++;
            String note=d.allowed()?"The gateway forwards this request. Only an admission spends a token.":"The gateway returns 429 and does not call the backend. Waiting changes the balance; rejection does not reset it.";
            steps.add("{\"title\":"+q(titles[i])+",\"clock\":"+q("Time: "+times[i]+" ms")+",\"note\":"+q(note)+",\"tokens\":"+d.tokens()+",\"capacity\":5,\"facts\":["+q("Backend invocations so far: "+backend)+","+q("Retry delay: "+d.retryAfterMillis()+" ms")+"]}");
        }
        System.out.println("{\"id\":\"ratelimit\",\"kind\":\"bucket\",\"title\":\"Watch a token bucket make the decision\",\"back\":\"../#/t/2/1\",\"description\":\"Capacity five, refill two tokens per second, cost one per request. These recorded states come from the Java mechanism; the distributed Redis script is tested separately.\",\"scenarios\":[{\"id\":\"burst\",\"title\":\"Burst, fractional refill and recovery\",\"steps\":["+String.join(",",steps)+"]}]}");
    }
}
