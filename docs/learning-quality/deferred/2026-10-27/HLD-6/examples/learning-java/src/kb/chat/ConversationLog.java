package kb.chat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** One-process committed-log model. A database transaction/owner replaces this monitor. */
public final class ConversationLog {
    public record Accepted(long sequence,String messageId,boolean replayed) {}
    public record Message(long sequence,String id,String sender,String body) {}
    public enum Gap { NONE, JOIN_BOUNDARY, RETENTION }
    public record Page(List<Message> messages,Gap gap,long earliestAvailable,long lastSequence,long nextAfter,boolean more) {}
    public record LogView(long lastSequence,long retainedFrom,List<Long> retained) {}
    private record Member(boolean active,long fromSequence) {}
    private record Request(String sender,String clientId) {}
    private record Prior(String hash,Accepted receipt) {}
    public static final class Problem extends RuntimeException {
        private final int status;
        public Problem(int status,String message){super(message);this.status=status;}
        public int status(){return status;}
    }
    private final String id,admin;
    private final Map<String,Member> members=new HashMap<>();
    private final Map<Request,Prior> dedup=new HashMap<>();
    private final TreeMap<Long,Message> log=new TreeMap<>();
    private long lastSequence,retainedFrom=1;
    public ConversationLog(String id,String admin){text(id);text(admin);this.id=id;this.admin=admin;members.put(admin,new Member(true,1));}
    public synchronized void addMember(String actor,String user){
        administer(actor);text(user);Member existing=members.get(user);
        if(existing!=null&&existing.active())return;
        if(members.values().stream().filter(Member::active).count()>=500)throw new Problem(409,"group limit");
        members.put(user,new Member(true,Math.incrementExact(lastSequence)));
    }
    public synchronized void removeMember(String actor,String user){
        administer(actor);if(admin.equals(user))throw new Problem(409,"transfer admin before leaving");
        Member existing=members.get(user);if(existing!=null)members.put(user,new Member(false,existing.fromSequence()));
    }
    // BEGIN send
    public synchronized Accepted send(String sender,String clientMessageId,String body){
        member(sender);text(clientMessageId);text(body);
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        if(bytes.length>4096)throw new Problem(400,"text body exceeds4096 UTF-8 bytes");
        Request request=new Request(sender,clientMessageId);String hash=hash(bytes);Prior prior=dedup.get(request);
        if(prior!=null){
            if(!prior.hash().equals(hash))throw new Problem(409,"client ID reused with different payload");
            return new Accepted(prior.receipt().sequence(),prior.receipt().messageId(),true);
        }
        long sequence=Math.incrementExact(lastSequence);
        Message message=new Message(sequence,id+"/"+sequence,sender,body);
        Accepted receipt=new Accepted(sequence,message.id(),false);
        log.put(sequence,message);dedup.put(request,new Prior(hash,receipt));lastSequence=sequence;
        // A real adapter commits message, counter, dedup and delivery outbox before returning.
        return receipt;
    }
    // END send
    // BEGIN sync
    public synchronized Page sync(String user,long after,int limit){
        Member membership=member(user);
        if(after<0||after>lastSequence||limit<1||limit>100)throw new Problem(400,"invalid history cursor/limit");
        long earliest=Math.max(retainedFrom,membership.fromSequence());
        if(after<earliest-1){
            Gap reason=retainedFrom>membership.fromSequence()?Gap.RETENTION:Gap.JOIN_BOUNDARY;
            return new Page(List.of(),reason,earliest,lastSequence,earliest-1,lastSequence>=earliest);
        }
        List<Message> messages=log.tailMap(after,false).values().stream().limit(limit).toList();
        long next=messages.isEmpty()?after:messages.getLast().sequence();
        return new Page(messages,Gap.NONE,earliest,lastSequence,next,next<lastSequence);
    }
    // END sync
    public synchronized void pruneBefore(String actor,long earliest){
        administer(actor);
        if(earliest<retainedFrom||earliest>lastSequence+1)throw new Problem(400,"invalid retention floor");
        log.headMap(earliest,false).clear();retainedFrom=earliest;
    }
    public synchronized long lastSequence(){return lastSequence;}
    public synchronized LogView view(){return new LogView(lastSequence,retainedFrom,List.copyOf(log.keySet()));} // Synthetic trace diagnostic only.
    private Member member(String user){Member member=members.get(user);if(member==null||!member.active())throw new Problem(403,"not a current member");return member;}
    private void administer(String actor){if(!admin.equals(actor))throw new Problem(403,"admin required");member(actor);}
    private static void text(String value){if(value==null||value.isBlank()||value.length()>4096)throw new Problem(400,"bounded nonblank value required");}
    private static String hash(byte[] value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));}catch(NoSuchAlgorithmException error){throw new IllegalStateException(error);}}
}
