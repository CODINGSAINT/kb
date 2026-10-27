package kb.splitwise;

import java.math.BigInteger;
import java.util.*;

/** Converts a split rule to exact, nonnegative INR paise. No ledger writes. */
public final class Splits {
    private Splits() {}

    public static Map<String, Long> equal(long total, List<String> members) {
        var weights = new TreeMap<String, Integer>();
        for (String id : members) {
            validId(id);
            if (weights.put(id, 1) != null) throw new IllegalArgumentException("Duplicate participant");
        }
        return weighted(total, weights);
    }

    public static Map<String, Long> exact(long total, Map<String, Long> shares) {
        if (total <= 0 || shares.isEmpty()) throw new IllegalArgumentException("Positive total and participants required");
        BigInteger sum = BigInteger.ZERO;
        var result = new TreeMap<String, Long>();
        for (var e : shares.entrySet()) {
            validId(e.getKey());
            if (e.getValue() == null || e.getValue() < 0) throw new IllegalArgumentException("Negative/null share");
            sum = sum.add(BigInteger.valueOf(e.getValue())); result.put(e.getKey(), e.getValue());
        }
        if (!sum.equals(BigInteger.valueOf(total))) throw new IllegalArgumentException("Shares must equal total");
        return Collections.unmodifiableMap(result);
    }

    public static Map<String, Long> percent(long total, Map<String, Integer> basisPoints) {
        long sum = 0;
        for (Integer value : basisPoints.values()) {
            if (value == null || value < 0 || value > 10_000) throw new IllegalArgumentException("Invalid percentage");
            sum = Math.addExact(sum, value);
        }
        if (sum != 10_000) throw new IllegalArgumentException("Percentages must total 10000 basis points");
        return allocate(total, basisPoints, true);
    }

    public static Map<String, Long> weighted(long total, Map<String, Integer> weights) {
        return allocate(total, weights, false);
    }

    // BEGIN allocation
    private static Map<String, Long> allocate(long total, Map<String, Integer> weights, boolean allowZero) {
        if (total <= 0 || weights.isEmpty()) throw new IllegalArgumentException("Positive total and weights required");
        BigInteger denominator = BigInteger.ZERO;
        for (var e : weights.entrySet()) {
            validId(e.getKey());
            if (e.getValue() == null || e.getValue() < 0 || (!allowZero && e.getValue() == 0))
                throw new IllegalArgumentException("Invalid weight");
            denominator = denominator.add(BigInteger.valueOf(e.getValue()));
        }
        if (denominator.signum() == 0) throw new IllegalArgumentException("Zero total weight");
        var shares = new TreeMap<String, Long>();
        var fractions = new HashMap<String, BigInteger>();
        long used = 0;
        for (var e : weights.entrySet()) {
            BigInteger numerator = BigInteger.valueOf(total).multiply(BigInteger.valueOf(e.getValue()));
            BigInteger[] division = numerator.divideAndRemainder(denominator);
            long floor = division[0].longValueExact();
            shares.put(e.getKey(), floor); fractions.put(e.getKey(), division[1]);
            used = Math.addExact(used, floor);
        }
        var order = new ArrayList<>(shares.keySet());
        order.sort(Comparator.<String, BigInteger>comparing(fractions::get).reversed().thenComparing(id -> id));
        int remaining = Math.toIntExact(total - used); // Less than the number of participants.
        for (int i = 0; i < remaining; i++) shares.compute(order.get(i), (id, amount) -> amount + 1);
        return Collections.unmodifiableMap(shares);
    }
    // END allocation

    static void validId(String id) {
        if (id == null || id.isBlank()) throw new IllegalArgumentException("Blank identity");
    }
}
