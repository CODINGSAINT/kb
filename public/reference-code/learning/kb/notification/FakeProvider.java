package kb.notification;

import java.time.Clock;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Local fake only. No messages, sockets, credentials or SDK dependencies. */
public final class FakeProvider {
    public enum Behavior { ACCEPT, TIMEOUT_AFTER_ACCEPT, RETRYABLE_NOT_ACCEPTED, PERMANENT_FAILURE }
    private record Saved(String target,String payload,String template,String messageId,long until) {}
    private final Clock clock;
    private final long replayWindowMillis;
    private final ArrayDeque<Behavior> plan;
    private final Map<String,Saved> accepted=new HashMap<>();
    private int calls,physicalAcceptances;
    public FakeProvider(Clock clock,long replayWindowMillis,Behavior... plan) {
        if (replayWindowMillis<0) throw new IllegalArgumentException("nonnegative replay window");
        this.clock=clock; this.replayWindowMillis=replayWindowMillis; this.plan=new ArrayDeque<>(List.of(plan));
    }
    public synchronized DispatchEngine.Result send(DispatchEngine.Attempt attempt) {
        calls++; long now=clock.millis(); Saved previous=accepted.get(attempt.providerKey());
        if (previous!=null && now<previous.until()) {
            if (!previous.target().equals(attempt.target()) || !previous.payload().equals(attempt.payload())
                    || !previous.template().equals(attempt.templateVersion()))
                throw new IllegalArgumentException("idempotency key reused with different request bytes");
            return DispatchEngine.Result.accepted(previous.messageId());
        }
        // A lookup must never create a new send when the provider forgot the key.
        // Checking a deadline only before network I/O cannot establish this contract.
        if (attempt.lookupOnly()) return DispatchEngine.Result.unknown();
        Behavior behavior=plan.isEmpty()?Behavior.ACCEPT:plan.removeFirst();
        if (behavior==Behavior.RETRYABLE_NOT_ACCEPTED) return DispatchEngine.Result.retryable();
        if (behavior==Behavior.PERMANENT_FAILURE) return DispatchEngine.Result.permanent();
        String messageId="provider-"+(++physicalAcceptances);
        accepted.put(attempt.providerKey(),new Saved(attempt.target(),attempt.payload(),attempt.templateVersion(),
                messageId,Math.addExact(now,replayWindowMillis)));
        return behavior==Behavior.TIMEOUT_AFTER_ACCEPT?DispatchEngine.Result.unknown():DispatchEngine.Result.accepted(messageId);
    }
    public synchronized int calls() { return calls; }
    public synchronized int physicalAcceptances() { return physicalAcceptances; }
}
