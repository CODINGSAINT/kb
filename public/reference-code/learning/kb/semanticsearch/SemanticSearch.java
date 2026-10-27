package kb.semanticsearch;

import java.util.*;
import java.util.regex.Pattern;

/** JDK21 exact retrieval over hand-assigned vectors, not a text encoder or quality benchmark. */
public final class SemanticSearch {
    private SemanticSearch() { }
    public enum Role { STUDENT, STAFF }
    public record Actor(String tenant, Set<Role> roles) {
        public Actor { Objects.requireNonNull(tenant); roles = Set.copyOf(roles); }
    }
    public record Space(String encoderBundleVersion, String preprocessingVersion, int dimensions) {
        public Space {
            if (encoderBundleVersion == null || encoderBundleVersion.isBlank()
                    || preprocessingVersion == null || preprocessingVersion.isBlank() || dimensions < 1)
                throw new IllegalArgumentException("Explicit embedding space required");
        }
    }
    public record Embedding(Space space, double[] unit) {
        public Embedding {
            Objects.requireNonNull(space);
            if (unit == null || unit.length != space.dimensions()) throw new IllegalArgumentException("Dimension mismatch");
            unit = normalize(unit);
        }
        @Override public double[] unit() { return unit.clone(); }
    }
    public record DocumentKey(String tenant, String documentId) { }
    public record Policy(int currentRevision, Set<Role> readers) {
        public Policy {
            if (currentRevision < 1) throw new IllegalArgumentException("Positive revision required");
            readers = Set.copyOf(readers);
        }
    }
    public record Chunk(String id, DocumentKey document, int revision, String text, Embedding embedding) {
        public Chunk {
            if (id == null || id.isBlank() || revision < 1 || text == null || text.isBlank())
                throw new IllegalArgumentException("Identified nonblank chunk required");
            Objects.requireNonNull(document); Objects.requireNonNull(embedding);
        }
    }
    public record Hit(String chunkId, String documentId, int revision, String text, double score) { }
    private static final Comparator<Hit> ORDER = Comparator.comparingDouble(Hit::score).reversed().thenComparing(Hit::chunkId);

    // BEGIN geometry
    public static double[] normalize(double[] values) {
        if (values.length == 0) throw new IllegalArgumentException("Empty vector");
        double scale = 0;
        for (double value : values) {
            if (!Double.isFinite(value)) throw new IllegalArgumentException("Nonfinite coordinate");
            scale = Math.max(scale, Math.abs(value));
        }
        if (scale == 0) throw new IllegalArgumentException("Zero vector has no cosine direction");
        double squared = 0;
        for (double value : values) squared += (value / scale) * (value / scale);
        double norm = Math.sqrt(squared);
        double[] unit = new double[values.length];
        for (int i = 0; i < values.length; i++) unit[i] = (values[i] / scale) / norm;
        return unit;
    }

    public static double cosine(Embedding a, Embedding b) {
        if (!a.space.equals(b.space)) throw new IllegalArgumentException("Incompatible embedding spaces");
        double dot = 0;
        for (int i = 0; i < a.unit.length; i++) dot += a.unit[i] * b.unit[i];
        return Math.max(-1, Math.min(1, dot)); // Clamp tiny floating-point boundary error.
    }
    // END geometry

    public static final class Index {
        private final Space space;
        private final List<Chunk> chunks;
        private final Map<DocumentKey, Policy> policies;

        public Index(Space space, List<Chunk> chunks, Map<DocumentKey, Policy> policies) {
            this.space = Objects.requireNonNull(space);
            this.chunks = List.copyOf(chunks); this.policies = Map.copyOf(policies);
            var ids = new HashSet<String>();
            for (Chunk chunk : chunks) {
                if (!space.equals(chunk.embedding.space) || !ids.add(chunk.id))
                    throw new IllegalArgumentException("Mixed spaces or duplicate chunk IDs");
            }
        }

        // BEGIN dense
        public List<Hit> dense(Actor actor, Embedding query, int k, double minimumCosine) {
            if (!space.equals(query.space)) throw new IllegalArgumentException("Query/index space mismatch");
            if (k < 1 || k > 20 || !Double.isFinite(minimumCosine) || minimumCosine < -1 || minimumCosine > 1)
                throw new IllegalArgumentException("Invalid search limit");
            var hits = new ArrayList<Hit>();
            for (Chunk chunk : chunks) {
                if (!permitted(actor, chunk)) continue; // Before scoring and returning any text/ID.
                double score = cosine(query, chunk.embedding);
                if (score >= minimumCosine) hits.add(hit(chunk, score));
            }
            return hits.stream().sorted(ORDER).limit(k).toList();
        }

        private boolean permitted(Actor actor, Chunk chunk) {
            Policy policy = policies.get(chunk.document);
            return chunk.document.tenant.equals(actor.tenant) && policy != null
                    && policy.currentRevision == chunk.revision
                    && !Collections.disjoint(actor.roles, policy.readers);
        }
        // END dense

        public List<Hit> lexical(Actor actor, String query, int k) {
            if (k < 1 || k > 20) throw new IllegalArgumentException("Invalid search limit");
            Set<String> wanted = terms(query);
            var hits = new ArrayList<Hit>();
            for (Chunk chunk : chunks) {
                if (!permitted(actor, chunk)) continue;
                Set<String> present = terms(chunk.text);
                long overlap = wanted.stream().filter(present::contains).count();
                if (overlap > 0) hits.add(hit(chunk, overlap));
            }
            return hits.stream().sorted(ORDER).limit(k).toList();
        }

        // BEGIN hybrid
        public List<Hit> hybrid(Actor actor, Embedding query, String text, int k, double minimumCosine) {
            if (k < 1 || k > 20) throw new IllegalArgumentException("Invalid search limit");
            List<Hit> dense = dense(actor, query, 20, minimumCosine);
            List<Hit> lexical = lexical(actor, text, 20);
            var scores = new HashMap<String, Double>();
            var candidates = new HashMap<String, Hit>();
            for (List<Hit> ranking : List.of(dense, lexical)) {
                for (int i = 0; i < ranking.size(); i++) {
                    Hit hit = ranking.get(i);
                    scores.merge(hit.chunkId, 1.0 / (60 + i + 1), Double::sum);
                    candidates.put(hit.chunkId, hit);
                }
            }
            return candidates.values().stream().map(hit -> new Hit(hit.chunkId, hit.documentId,
                    hit.revision, hit.text, scores.get(hit.chunkId))).sorted(ORDER).limit(k).toList();
        }
        // END hybrid

        private static Hit hit(Chunk chunk, double score) {
            return new Hit(chunk.id, chunk.document.documentId, chunk.revision, chunk.text, score);
        }
    }

    private static Set<String> terms(String text) {
        if (text == null || text.isBlank()) throw new IllegalArgumentException("Nonblank text required");
        var result = new HashSet<String>();
        Pattern.compile("[\\p{L}\\p{N}]+").matcher(text.toLowerCase(Locale.ROOT))
                .results().forEach(match -> result.add(match.group()));
        return Set.copyOf(result);
    }

    public static OptionalDouble recallAtK(List<Hit> hits, Set<String> relevant, int k) {
        if (k < 1) throw new IllegalArgumentException("Positive k required");
        if (relevant.isEmpty()) return OptionalDouble.empty();
        long found = hits.stream().limit(k).map(Hit::chunkId).distinct().filter(relevant::contains).count();
        return OptionalDouble.of((double) found / relevant.size());
    }

    public static void main(String[] args) {
        var space = new Space("toy-encoder-bundle-v1", "fixture-pipeline-v1", 2);
        var resetKey = new DocumentKey("course-a", "account-guide");
        var errorKey = new DocumentKey("course-a", "error-guide");
        var billingKey = new DocumentKey("course-a", "billing-guide");
        var staffKey = new DocumentKey("course-a", "staff-notes");
        var otherKey = new DocumentKey("course-b", "private-guide");
        var chunks = List.of(
                new Chunk("reset-2", resetKey, 2, "Reset credentials with the recovery form.", new Embedding(space, new double[]{1,0})),
                new Chunk("error-1", errorKey, 1, "E1042 means the one-time code expired; request a new code.", new Embedding(space, new double[]{1,1})),
                new Chunk("billing-1", billingKey, 1, "Update the invoice address.", new Embedding(space, new double[]{0,1})),
                new Chunk("staff-1", staffKey, 1, "Internal credential reset notes.", new Embedding(space, new double[]{1,0})),
                new Chunk("other-1", otherKey, 1, "Other tenant account recovery.", new Embedding(space, new double[]{1,0})));
        var policies = new HashMap<DocumentKey, Policy>();
        for (DocumentKey key : List.of(resetKey, errorKey, billingKey, otherKey)) policies.put(key, new Policy(key.equals(resetKey) ? 2 : 1, Set.of(Role.STUDENT, Role.STAFF)));
        policies.put(staffKey, new Policy(1, Set.of(Role.STAFF)));
        var index = new Index(space, chunks, policies);
        var actor = new Actor("course-a", Set.of(Role.STUDENT));
        var query = new Embedding(space, new double[]{1,0});
        var hits = index.dense(actor, query, 3, .2);
        check(hits.stream().map(Hit::chunkId).toList().equals(List.of("reset-2", "error-1")), "filtered dense ranking");
        close(hits.get(1).score, 1 / Math.sqrt(2));
        check(index.lexical(actor, "forgot login", 3).isEmpty(), "paraphrase has no literal terms");
        check(index.lexical(actor, "E1042", 3).getFirst().chunkId.equals("error-1"), "exact identifier");
        var hybrid = index.hybrid(actor, new Embedding(space, new double[]{0,1}), "E1042", 3, .2);
        check(hybrid.getFirst().chunkId.equals("error-1"), "fusion rescues identifier");
        close(hybrid.getFirst().score, 1.0 / 61 + 1.0 / 62);
        double[] mutable = {1,0}; Embedding detached = new Embedding(space, mutable); mutable[0] = 0;
        double[] copy = detached.unit(); copy[0] = 0; close(detached.unit()[0], 1);
        close(normalize(new double[]{Double.MAX_VALUE, Double.MAX_VALUE})[0], 1 / Math.sqrt(2));
        rejects(() -> new Embedding(space, new double[]{0,0}));
        rejects(() -> new Embedding(space, new double[]{Double.NaN,1}));
        rejects(() -> new Embedding(space, new double[]{1}));
        rejects(() -> index.dense(actor, new Embedding(new Space("other-v1", "fixture-pipeline-v1", 2), new double[]{1,0}), 1, .2));
        var revoked = new HashMap<>(policies); revoked.remove(resetKey);
        check(new Index(space, chunks, revoked).dense(actor, query, 3, .2).stream().noneMatch(hit -> hit.chunkId.equals("reset-2")), "tombstone/revocation before results");
        var revised = new HashMap<>(policies); revised.put(resetKey, new Policy(3, Set.of(Role.STUDENT)));
        check(new Index(space, chunks, revised).dense(actor, query, 3, .2).stream().noneMatch(hit -> hit.chunkId.equals("reset-2")), "stale revision excluded");
        close(recallAtK(hits, Set.of("reset-2", "error-1"), 1).orElseThrow(), .5);
        check(recallAtK(hits, Set.of(), 2).isEmpty(), "unanswerable labels separate");
        System.out.printf(Locale.ROOT, "cosine(reset,error)=%.6f; hybrid E1042 score=%.6f%n", hits.get(1).score, hybrid.getFirst().score);
        System.out.println("Student dense hits: " + hits.stream().map(Hit::chunkId).toList());
        System.out.println("PASS: geometry, space/dimension/finite guards, detached vectors, scoped revision filtering, lexical/fusion and metric arithmetic.");
        System.out.println("LIMIT: hand-assigned vectors test retrieval mechanics, not learned semantic relevance or production ACL enforcement.");
    }
    private static void close(double a, double b) { check(Math.abs(a - b) < 1e-10, "numeric mismatch"); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void rejects(Runnable task) {
        try { task.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Invalid input was accepted");
    }
}
