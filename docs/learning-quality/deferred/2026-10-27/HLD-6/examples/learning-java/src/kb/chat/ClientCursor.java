package kb.chat;

import java.util.List;
import java.util.TreeMap;

/** Bounded receiver-side contiguous cursor; not a server claim that a human read a message. */
public final class ClientCursor {
    public enum Receive { ADVANCED, BUFFERED, DUPLICATE, RESYNC_REQUIRED }
    public record View(long historyFrom,long deliveredThrough,long readThrough,List<Long> buffered) {}
    private final String conversation;
    private final int maxBuffered;
    private final TreeMap<Long,ConversationLog.Message> pending=new TreeMap<>();
    private long historyFrom=1,delivered,read;
    public ClientCursor(String conversation,int maxBuffered){if(maxBuffered<1)throw new IllegalArgumentException("positive bound");this.conversation=conversation;this.maxBuffered=maxBuffered;}
    // BEGIN receive
    public synchronized Receive receive(ConversationLog.Message message){
        if(message.sequence()<1||!message.id().equals(conversation+"/"+message.sequence()))throw new IllegalArgumentException("wrong conversation/message identity");
        if(message.sequence()<=delivered)return Receive.DUPLICATE;
        if(message.sequence()-delivered>maxBuffered)return Receive.RESYNC_REQUIRED;
        ConversationLog.Message old=pending.get(message.sequence());
        if(old!=null&&!old.equals(message))throw new IllegalArgumentException("conflicting immutable message");
        if(old==null&&pending.size()==maxBuffered)return Receive.RESYNC_REQUIRED;
        pending.put(message.sequence(),message);long before=delivered;
        while(pending.remove(delivered+1)!=null)delivered++;
        return delivered>before?Receive.ADVANCED:Receive.BUFFERED;
    }
    public synchronized void markRead(long through){
        if(through<historyFrom-1||through>delivered)throw new IllegalArgumentException("read must stay in the received window");
        read=Math.max(read,through);
    }
    public synchronized void acknowledgeHistoryGap(ConversationLog.Page gap){
        if(gap.gap()==ConversationLog.Gap.NONE||gap.earliestAvailable()<1)throw new IllegalArgumentException("explicit server history boundary required");
        if(gap.earliestAvailable()<=delivered+1)return;
        historyFrom=gap.earliestAvailable();delivered=historyFrom-1;read=historyFrom-1;pending.clear();
        // Baseline is outside the available window; it is not proof old messages were delivered/read.
    }
    // END receive
    public synchronized View view(){return new View(historyFrom,delivered,read,List.copyOf(pending.keySet()));}
}
