package kb.feed;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.LongSupplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Local authority + derived references + bounded ranking sessions; no distributed adapters. */
public final class FeedEngine {
    public enum Visibility { PUBLIC, FOLLOWERS, SELF }
    public record Post(String id,String author,String body,long createdMillis,Visibility visibility,long version,boolean deleted) {}
    public record Item(String id,String author,String body,long version) {}
    public record Page(long sessionId,List<Item> items,String nextCursor,int scanned,int nextIndex) {}
    public record SessionView(long id,List<String> frozenOrder,int pageSize,int initialCandidates,int selectedPullAuthors) {}
    private record Edge(String from,String to) {}
    private record Ref(String id,long createdMillis) {}
    private record Ranked(String id,long score,long createdMillis) {}
    private record Position(long session,int index) {}
    private record Session(String viewer,List<String> ids,int pageSize,long born,int initialCandidates,int selectedPullAuthors) {}
    public static final class Problem extends RuntimeException {
        private final int status;
        public Problem(int status,String message) { super(message);this.status=status; }
        public int status() { return status; }
    }
    private static final Comparator<Ref> NEWEST=Comparator.comparingLong(Ref::createdMillis).reversed().thenComparing(Ref::id);
    private static final Comparator<Ranked> RANK=Comparator.comparingLong(Ranked::score).reversed()
            .thenComparing(Comparator.comparingLong(Ranked::createdMillis).reversed()).thenComparing(Ranked::id);
    private final int maxSessions,maxCandidates,scanBudget;
    private final long ttlNanos;
    private final LongSupplier ticker;
    private final byte[] cursorKey;
    private final byte[] incarnation=new byte[16];
    private final Map<String,Post> posts=new HashMap<>();
    private final Set<Edge> follows=new HashSet<>(),favorites=new HashSet<>(),blocks=new HashSet<>();
    private final Set<String> pullAuthors=new HashSet<>();
    private final Map<String,java.util.TreeSet<Ref>> inboxes=new HashMap<>();
    private final LinkedHashMap<Long,Session> sessions=new LinkedHashMap<>(16,.75f,true);
    private long nextSession;

    public FeedEngine(int maxSessions,int maxCandidates,int scanBudget,Duration ttl,LongSupplier ticker,byte[] cursorKey) {
        if(maxSessions<1||maxCandidates<1||maxCandidates>200||scanBudget<1||scanBudget>200)
            throw new IllegalArgumentException("positive bounded session/candidate/scan capacities");
        if(ttl.isNegative()||ttl.isZero()||ttl.compareTo(Duration.ofHours(1))>0||cursorKey.length<32)
            throw new IllegalArgumentException("positive TTL up to one hour and at least 32 key bytes");
        this.maxSessions=maxSessions;this.maxCandidates=maxCandidates;this.scanBudget=scanBudget;
        this.ttlNanos=ttl.toNanos();this.ticker=Objects.requireNonNull(ticker);this.cursorKey=cursorKey.clone();
        new java.security.SecureRandom().nextBytes(incarnation);
    }
    public synchronized void addPost(String id,String author,String body,long createdMillis,Visibility visibility) {
        text(id);text(author);text(body);Objects.requireNonNull(visibility);
        if(createdMillis<0||createdMillis>9_000_000_000_000L)throw new IllegalArgumentException("supported source timestamp");
        Post post=new Post(id,author,body,createdMillis,visibility,1,false);
        Post old=posts.putIfAbsent(id,post);
        if(old!=null&&!old.equals(post))throw new IllegalArgumentException("post identity reused");
    }
    public synchronized void follow(String viewer,String author,boolean enabled) {
        text(viewer);text(author);Edge edge=new Edge(viewer,author);
        if(enabled)follows.add(edge);else{follows.remove(edge);favorites.remove(edge);}
    }
    public synchronized void favorite(String viewer,String author,boolean enabled) {
        Edge edge=new Edge(viewer,author);
        if(enabled&&!follows.contains(edge))throw new IllegalArgumentException("favorite must be followed");
        if(enabled)favorites.add(edge);else favorites.remove(edge);
    }
    public synchronized void block(String actor,String other,boolean enabled) {
        text(actor);text(other);if(enabled)blocks.add(new Edge(actor,other));else blocks.remove(new Edge(actor,other));
    }
    public synchronized void pullAuthor(String author,boolean enabled) {
        text(author);if(enabled)pullAuthors.add(author);else pullAuthors.remove(author);
    }
    public synchronized void changeVisibility(String actor,String id,Visibility visibility) {
        Post p=owned(actor,id);Objects.requireNonNull(visibility);
        posts.put(id,new Post(id,p.author(),p.body(),p.createdMillis(),visibility,Math.incrementExact(p.version()),p.deleted()));
    }
    public synchronized void delete(String actor,String id) {
        Post p=owned(actor,id);
        if(!p.deleted())posts.put(id,new Post(id,p.author(),p.body(),p.createdMillis(),p.visibility(),Math.incrementExact(p.version()),true));
    }
    /** Internal materializer. The reference is not proof that this viewer may read the post. */
    public synchronized void materialize(String viewer,String postId) {
        text(viewer);Post p=required(postId);
        var refs=inboxes.computeIfAbsent(viewer,ignored->new java.util.TreeSet<>(NEWEST));
        refs.add(new Ref(p.id(),p.createdMillis()));
        while(refs.size()>200)refs.pollLast();
    }

    // BEGIN session
    public synchronized Page open(String viewer,int pageSize) {
        text(viewer);if(pageSize<1||pageSize>20)throw new Problem(400,"page size must be 1..20");
        Set<String> ids=new LinkedHashSet<>();
        for(Ref ref:inboxes.getOrDefault(viewer,new java.util.TreeSet<>(NEWEST)))ids.add(ref.id());
        // This toy scans maps to derive activity; production uses a viewer activity index.
        Map<String,Long> recent=new HashMap<>();
        for(Post post:posts.values())if(pullAuthors.contains(post.author())
                &&follows.contains(new Edge(viewer,post.author()))&&eligible(viewer,post))
            recent.merge(post.author(),post.createdMillis(),Math::max);
        List<String> selected=recent.keySet().stream()
                .sorted(Comparator.<String>comparingInt(author->favorites.contains(new Edge(viewer,author))?0:1)
                    .thenComparing(Comparator.<String>comparingLong(recent::get).reversed()).thenComparing(author->author))
                .limit(50).toList();
        for(String author:selected)
            posts.values().stream().filter(p->p.author().equals(author)).sorted(Comparator.comparingLong(Post::createdMillis).reversed().thenComparing(Post::id))
                    .limit(10).forEach(p->ids.add(p.id()));
        posts.values().stream().filter(p->p.author().equals(viewer)).sorted(Comparator.comparingLong(Post::createdMillis).reversed().thenComparing(Post::id))
                .limit(20).forEach(p->ids.add(p.id()));
        if(ids.size()>720)throw new IllegalStateException("candidate plan exceeded 200 + 50*10 + 20");
        List<Ranked> ranked=new ArrayList<>();
        for(String id:ids){Post p=posts.get(id);if(eligible(viewer,p)){
            long boost=favorites.contains(new Edge(viewer,p.author()))?Duration.ofMinutes(30).toMillis():0;
            ranked.add(new Ranked(id,Math.addExact(p.createdMillis(),boost),p.createdMillis()));
        }}
        List<String> frozen=ranked.stream().sorted(RANK).limit(maxCandidates).map(Ranked::id).toList();
        long born=ticker.getAsLong();sessions.entrySet().removeIf(entry->expired(entry.getValue(),born));
        if(sessions.size()==maxSessions)sessions.remove(sessions.keySet().iterator().next());
        long id=Math.incrementExact(nextSession);nextSession=id;
        sessions.put(id,new Session(viewer,frozen,pageSize,born,ids.size(),selected.size()));
        return page(viewer,cursor(viewer,id,0));
    }
    // END session

    // BEGIN page
    public synchronized Page page(String viewer,String cursor) {
        text(viewer);Position position=decode(viewer,cursor);Session session=sessions.get(position.session());
        if(session==null||expired(session,ticker.getAsLong())){
            sessions.remove(position.session());throw new Problem(410,"feed session expired or evicted; refresh");
        }
        if(!session.viewer().equals(viewer))throw new Problem(403,"cursor belongs to another viewer");
        int index=position.index();
        if(index<0||index>session.ids().size())throw new Problem(400,"invalid cursor position");
        int scanned=0;List<Item> items=new ArrayList<>();
        while(index<session.ids().size()&&items.size()<session.pageSize()&&scanned<scanBudget){
            Post post=posts.get(session.ids().get(index++));scanned++;
            if(eligible(viewer,post))items.add(new Item(post.id(),post.author(),post.body(),post.version()));
        }
        String next=index<session.ids().size()?cursor(viewer,position.session(),index):null;
        return new Page(position.session(),List.copyOf(items),next,scanned,index);
    }

    private boolean eligible(String viewer,Post post) {
        if(post==null||post.deleted())return false;
        if(viewer.equals(post.author()))return true;
        Edge edge=new Edge(viewer,post.author());
        if(!follows.contains(edge)||blocks.contains(edge)||blocks.contains(new Edge(post.author(),viewer)))return false;
        return post.visibility()==Visibility.PUBLIC||post.visibility()==Visibility.FOLLOWERS;
    }
    // END page

    public synchronized SessionView session(long id) {
        Session s=sessions.get(id);if(s==null)throw new Problem(410,"session absent");
        return new SessionView(id,s.ids(),s.pageSize(),s.initialCandidates(),s.selectedPullAuthors()); // Internal trace diagnostic, not public feed data.
    }
    private boolean expired(Session session,long now) {long age=now-session.born();return age<0||age>=ttlNanos;}
    private String cursor(String viewer,long session,int index) {
        byte[] data=ByteBuffer.allocate(12).putLong(session).putInt(index).array();
        return Base64.getUrlEncoder().withoutPadding().encodeToString(ByteBuffer.allocate(44).put(data).put(mac(viewer,data)).array());
    }
    private Position decode(String viewer,String token) {
        try {
            if(token==null||token.length()>128)throw new Problem(400,"invalid cursor");
            byte[] decoded=Base64.getUrlDecoder().decode(token);
            if(decoded.length!=44)throw new Problem(400,"invalid cursor");
            byte[] data=java.util.Arrays.copyOfRange(decoded,0,12),tag=java.util.Arrays.copyOfRange(decoded,12,44);
            if(!MessageDigest.isEqual(tag,mac(viewer,data)))throw new Problem(400,"invalid or foreign cursor");
            ByteBuffer fields=ByteBuffer.wrap(data);return new Position(fields.getLong(),fields.getInt());
        }catch(IllegalArgumentException error){throw new Problem(400,"malformed cursor");}
    }
    private byte[] mac(String viewer,byte[] data) {
        try {Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(cursorKey,"HmacSHA256"));
            mac.update(incarnation);byte[] user=viewer.getBytes(StandardCharsets.UTF_8);mac.update(ByteBuffer.allocate(4).putInt(user.length).array());mac.update(user);return mac.doFinal(data);
        }catch(GeneralSecurityException error){throw new IllegalStateException(error);}
    }
    private Post owned(String actor,String id){Post p=required(id);if(!p.author().equals(actor))throw new SecurityException("not your post");return p;}
    private Post required(String id){Post p=posts.get(id);if(p==null)throw new IllegalArgumentException("unknown post");return p;}
    private static void text(String value){if(value==null||value.isBlank()||value.length()>4096)throw new IllegalArgumentException("bounded nonblank value required");}
}
