package kb.cache;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.LongSupplier;

/** One-node mechanism: no network, origin reader, replication or membership implementation. */
public final class BoundedCache {
    public record Value(long version, byte[] payload) {
        public Value {
            if (version < 1) throw new IllegalArgumentException("positive source version");
            payload = Objects.requireNonNull(payload).clone();
        }
        @Override public byte[] payload() { return payload.clone(); }
        public static Value text(long version, String text) {
            return new Value(version, text.getBytes(StandardCharsets.UTF_8));
        }
    }
    public record Hit(Value value, long remainingNanos) {}
    public enum Fill { STORED, RETIRED_SLOT, INVALIDATED, TOO_OLD, OLDER_VERSION, CONFLICTING_VALUE, TOO_LARGE }
    public record Stats(int slots, long payloadBytes, long evictions) {}
    public record SlotView(String key, long slotId, long generation, long minimumVersion,
                           long cachedVersion, long remainingMillis) {}
    private static final class Slot {
        final long id;
        long generation, minimumVersion, loadedAt;
        Value value;
        Slot(long id) { this.id = id; }
    }
    public static final class Ticket {
        private final BoundedCache issuer;
        private final String key;
        private final Slot slot;
        private final long generation, startedAt;
        private Ticket(BoundedCache issuer, String key, Slot slot, long startedAt) {
            this.issuer=issuer; this.key=key; this.slot=slot;
            this.generation=slot.generation; this.startedAt=startedAt;
        }
        public String key() { return key; }
        public long slotId() { return slot.id; }
        public long generation() { return generation; }
    }

    private static final int MAX_VALUE_BYTES = 16 * 1024;
    private final int maxSlots;
    private final long maxPayloadBytes, ttlNanos;
    private final LongSupplier ticker;
    private final LinkedHashMap<String, Slot> slots = new LinkedHashMap<>(16, .75f, true);
    private long payloadBytes, nextSlotId, evictions;

    public BoundedCache(int maxSlots, long maxPayloadBytes, Duration ttl, LongSupplier ticker) {
        if (maxSlots < 1 || maxPayloadBytes < 1) throw new IllegalArgumentException("positive capacity");
        Objects.requireNonNull(ttl);
        if (ttl.isNegative() || ttl.isZero() || ttl.compareTo(Duration.ofHours(1)) > 0)
            throw new IllegalArgumentException("TTL must be positive and at most one hour");
        this.maxSlots=maxSlots; this.maxPayloadBytes=maxPayloadBytes;
        this.ttlNanos=ttl.toNanos(); this.ticker=Objects.requireNonNull(ticker);
    }

    // BEGIN read
    public synchronized Optional<Hit> get(String key) {
        validateKey(key);
        Slot slot=slots.get(key);
        if (slot==null || slot.value==null) return Optional.empty();
        long age=ticker.getAsLong()-slot.loadedAt;
        if (age<0 || age>=ttlNanos) { removeValue(slot); return Optional.empty(); }
        return Optional.of(new Hit(slot.value,ttlNanos-age));
    }

    public synchronized Ticket beginLoad(String key) {
        validateKey(key);
        Slot slot=ensureSlot(key);
        return new Ticket(this,key,slot,ticker.getAsLong());
    }
    // END read

    // BEGIN fill
    public synchronized Fill fill(Ticket ticket, Value value) {
        Objects.requireNonNull(ticket); Objects.requireNonNull(value);
        Slot slot=slots.get(ticket.key);
        if (ticket.issuer!=this || slot!=ticket.slot) return Fill.RETIRED_SLOT;
        if (slot.generation!=ticket.generation) return Fill.INVALIDATED;
        long age=ticker.getAsLong()-ticket.startedAt;
        if (age<0 || age>=ttlNanos) return Fill.TOO_OLD;
        if (value.version()<slot.minimumVersion) return Fill.OLDER_VERSION;
        if (slot.value!=null && slot.value.version()==value.version()
                && !Arrays.equals(slot.value.payload,value.payload)) return Fill.CONFLICTING_VALUE;
        int size=value.payload.length;
        if (size>MAX_VALUE_BYTES || size>maxPayloadBytes) return Fill.TOO_LARGE;
        long previous=slot.value==null?0:slot.value.payload.length;
        while (payloadBytes-previous+size>maxPayloadBytes) evictOldestExcept(slot);
        removeValue(slot);
        slot.value=value;
        slot.loadedAt=ticket.startedAt; // A late fill never receives a fresh lifetime.
        slot.minimumVersion=Math.max(slot.minimumVersion,value.version());
        payloadBytes+=size;
        return Fill.STORED;
    }

    public synchronized void invalidate(String key, long minimumVersion) {
        validateKey(key);
        if (minimumVersion<1) throw new IllegalArgumentException("positive source version");
        Slot slot=ensureSlot(key);
        if (minimumVersion<=slot.minimumVersion) return; // Duplicate/older event is harmless.
        long nextGeneration=Math.incrementExact(slot.generation);
        removeValue(slot);
        slot.minimumVersion=minimumVersion;
        slot.generation=nextGeneration;
    }
    // END fill

    public synchronized boolean evict(String key) {
        validateKey(key);
        Slot slot=slots.remove(key);
        if (slot==null) return false;
        removeValue(slot); evictions++; return true;
    }

    public synchronized void clear() { slots.clear(); payloadBytes=0; }
    public synchronized Stats stats() { return new Stats(slots.size(),payloadBytes,evictions); }
    public synchronized List<SlotView> snapshot() {
        long now=ticker.getAsLong();
        List<SlotView> result=new ArrayList<>();
        for (Map.Entry<String,Slot> entry:slots.entrySet()) {
            Slot slot=entry.getValue(); long age=now-slot.loadedAt;
            long remaining=slot.value==null || age<0 ? 0 : Math.max(0,ttlNanos-age);
            result.add(new SlotView(entry.getKey(),slot.id,slot.generation,slot.minimumVersion,
                    slot.value==null?0:slot.value.version(),remaining/1_000_000));
        }
        return List.copyOf(result); // LRU first. Diagnostic only; does not refresh recency/TTL.
    }

    private Slot ensureSlot(String key) {
        Slot slot=slots.get(key);
        if (slot!=null) return slot;
        if (slots.size()==maxSlots) evictOldestExcept(null);
        slot=new Slot(Math.incrementExact(nextSlotId));
        nextSlotId=slot.id; slots.put(key,slot); return slot;
    }

    private void evictOldestExcept(Slot protectedSlot) {
        var iterator=slots.entrySet().iterator();
        while (iterator.hasNext()) {
            Slot candidate=iterator.next().getValue();
            if (candidate!=protectedSlot) {
                removeValue(candidate); iterator.remove(); evictions++; return;
            }
        }
        throw new IllegalStateException("incoming payload should fit without evicting its own slot");
    }
    private void removeValue(Slot slot) {
        if (slot.value!=null) { payloadBytes-=slot.value.payload.length; slot.value=null; }
    }
    private static void validateKey(String key) {
        if (key==null || key.isBlank() || key.length()>160)
            throw new IllegalArgumentException("key must contain 1..160 characters");
    }
}
