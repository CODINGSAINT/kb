package kb.shortener;

import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** One-process authority and cache model. No HTTP server, database or Redis adapter. */
public final class Shortener {
    public static final Duration CACHE_LEASE = Duration.ofSeconds(30);
    public static final Duration REQUEST_RETENTION = Duration.ofHours(24);
    private static final int MAX_ATTEMPTS = 8;
    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static final Set<String> RESERVED = Set.of("urls", "health", "metrics", "admin");

    @FunctionalInterface
    public interface CodeSource { String next(); }

    public record Command(String destination, String customAlias, Instant expiresAt) {}
    public record Created(String code, URI destination, Instant expiresAt, boolean replayed) {}
    public enum Outcome { REDIRECT, MISSING, GONE, UNAVAILABLE }
    public record Resolution(Outcome outcome, URI location, String path, long version) {}
    public record CacheCopy(String code, URI destination, Instant expiresAt,
                            boolean revoked, long version, Instant serveUntil) {}
    private record Mapping(String owner, String code, URI destination, Instant expiresAt,
                           boolean revoked, long version) {}
    private record RequestKey(String owner, String key) {}
    private record SavedRequest(String fingerprint, Created result, Instant retainUntil) {}

    public static final class Problem extends RuntimeException {
        private final int status;
        public Problem(int status, String message) { super(message); this.status = status; }
        public int status() { return status; }
    }

    private final Clock clock;
    private final CodeSource codes;
    private final Map<String, Mapping> mappings = new HashMap<>();
    private final Map<RequestKey, SavedRequest> requests = new HashMap<>();
    private final Map<String, CacheCopy> cache = new HashMap<>();

    public Shortener(Clock clock, CodeSource codes) {
        this.clock = Objects.requireNonNull(clock);
        this.codes = Objects.requireNonNull(codes);
    }

    public static CodeSource secureRandomCodes() {
        SecureRandom random = new SecureRandom();
        return () -> {
            StringBuilder result = new StringBuilder(8);
            for (int i = 0; i < 8; i++) result.append(ALPHABET.charAt(random.nextInt(62)));
            return result.toString();
        };
    }

    // BEGIN create
    public synchronized Created create(String owner, String requestId, Command command) {
        requireToken(owner, "owner");
        requireToken(requestId, "request ID");
        Objects.requireNonNull(command);
        URI destination = validateDestination(command.destination());
        String alias = command.customAlias();
        if (alias != null && (!alias.matches("[A-Za-z0-9]{4,16}") || RESERVED.contains(alias)))
            throw new Problem(400, "Invalid or reserved alias");
        String fingerprint = fingerprint(command);
        RequestKey key = new RequestKey(owner, requestId);
        Instant now = clock.instant();
        SavedRequest saved = requests.get(key);
        if (saved != null && now.isBefore(saved.retainUntil())) {
            if (!saved.fingerprint().equals(fingerprint))
                throw new Problem(409, "Request ID reused with a different payload");
            Created result = saved.result();
            return new Created(result.code(), result.destination(), result.expiresAt(), true);
        }
        // Check expiry after replay: a lost response must still be replayable after link expiry.
        if (command.expiresAt() != null && !command.expiresAt().isAfter(now))
            throw new Problem(400, "Expiry must be in the future for a new link");
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            String code = alias == null ? codes.next() : alias;
            if (alias == null && (code == null || !code.matches("[A-Za-z0-9]{8}")))
                throw new IllegalStateException("Code source must return eight Base62 characters");
            if (mappings.containsKey(code)) {
                if (alias != null) throw new Problem(409, "Alias already reserved");
                continue;
            }
            Mapping mapping = new Mapping(owner, code, destination, command.expiresAt(), false, 1);
            Created result = new Created(code, destination, command.expiresAt(), false);
            // The lock is the transaction ONLY in this model. A database adapter must commit both.
            mappings.put(code, mapping);
            requests.put(key, new SavedRequest(fingerprint, result, now.plus(REQUEST_RETENTION)));
            return result;
        }
        throw new Problem(503, "Code allocation attempts exhausted; retry with the same request ID");
    }
    // END create

    public synchronized void revoke(String owner, String code) {
        Mapping mapping = mappings.get(code);
        if (mapping == null || !mapping.owner().equals(owner))
            throw new Problem(404, "Owned link not found");
        if (!mapping.revoked()) {
            mappings.put(code, new Mapping(owner, code, mapping.destination(), mapping.expiresAt(),
                    true, mapping.version() + 1));
        }
        cache.remove(code); // Helpful invalidation; a previously started fill can still arrive.
    }

    // BEGIN lease
    public synchronized CacheCopy readAuthority(String code) {
        // This instant represents the start of the authority read, never the later cache PUT.
        Instant readStarted = clock.instant();
        Mapping mapping = mappings.get(code);
        if (mapping == null) return null;
        Instant serveUntil = readStarted.plus(CACHE_LEASE);
        if (mapping.expiresAt() != null && mapping.expiresAt().isBefore(serveUntil))
            serveUntil = mapping.expiresAt();
        return new CacheCopy(code, mapping.destination(), mapping.expiresAt(), mapping.revoked(),
                mapping.version(), serveUntil);
    }

    public synchronized boolean install(CacheCopy copy) {
        if (copy == null || copy.revoked() || !clock.instant().isBefore(copy.serveUntil())) return false;
        CacheCopy existing = cache.get(copy.code());
        if (existing != null && existing.version() > copy.version()) return false;
        cache.put(copy.code(), copy); // Preserve serveUntil; do not grant a fresh 30 seconds here.
        return true;
    }

    public synchronized Resolution resolve(String code) {
        CacheCopy copy = cache.get(code);
        if (copy != null && clock.instant().isBefore(copy.serveUntil()))
            return decide(copy, "cache");
        cache.remove(code);
        copy = readAuthority(code); // Primary/consistent read in a real adapter.
        if (copy == null) return new Resolution(Outcome.MISSING, null, "authority", 0);
        install(copy);
        return decide(copy, "authority");
    }

    private Resolution decide(CacheCopy copy, String path) {
        Instant now = clock.instant();
        if (copy.revoked() || (copy.expiresAt() != null && !now.isBefore(copy.expiresAt())))
            return new Resolution(Outcome.GONE, null, path, copy.version());
        if (!now.isBefore(copy.serveUntil()))
            return new Resolution(Outcome.UNAVAILABLE, null, path, copy.version());
        return new Resolution(Outcome.REDIRECT, copy.destination(), path, copy.version());
    }
    // END lease

    public synchronized CacheCopy cached(String code) { return cache.get(code); }
    public synchronized int mappingCount() { return mappings.size(); }

    private static void requireToken(String token, String name) {
        if (token == null || token.isBlank() || token.length() > 128)
            throw new Problem(400, "Invalid " + name);
    }

    private static URI validateDestination(String value) {
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 4096 ||
                value.chars().anyMatch(c -> Character.isISOControl(c)))
            throw new Problem(400, "Invalid destination length or control character");
        try {
            URI uri = URI.create(value);
            if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) ||
                    uri.getHost() == null || uri.getUserInfo() != null)
                throw new Problem(400, "Expected an HTTP(S) host without credentials");
            return uri;
        } catch (IllegalArgumentException ex) {
            throw new Problem(400, "Malformed destination");
        }
    }

    private static String fingerprint(Command command) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String[] fields = {command.destination(), command.customAlias(),
                    command.expiresAt() == null ? null : command.expiresAt().toString()};
            for (String field : fields) {
                byte[] bytes = field == null ? new byte[0] : field.getBytes(StandardCharsets.UTF_8);
                digest.update(ByteBuffer.allocate(4).putInt(field == null ? -1 : bytes.length).array());
                digest.update(bytes);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("Java must provide SHA-256", ex);
        }
    }
}
