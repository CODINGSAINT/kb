package kb.llmparameters;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Optional;
import java.util.Set;

/** JDK21 toy sampling and request-policy arithmetic; no provider or tokenizer. */
public final class RequestControls {
    private RequestControls() { }
    public enum Knob { TEMPERATURE, TOP_P }
    public record Capabilities(int totalWindow, int maximumOutput, Set<Knob> supported) {
        public Capabilities {
            if (totalWindow <= 0 || maximumOutput <= 0 || maximumOutput > totalWindow)
                throw new IllegalArgumentException("Invalid declared limits");
            supported = Set.copyOf(supported);
        }
    }

    // BEGIN distribution
    public static double[] distribution(double[] logits, double temperature, double topP) {
        if (logits == null || logits.length == 0 || !Double.isFinite(temperature) || temperature < 0
                || !Double.isFinite(topP) || topP <= 0 || topP > 1)
            throw new IllegalArgumentException("Nonempty finite logits, T >= 0 and 0 < p <= 1 required");
        int best = 0;
        for (int i = 0; i < logits.length; i++) {
            if (!Double.isFinite(logits[i])) throw new IllegalArgumentException("Nonfinite score");
            if (logits[i] > logits[best]) best = i;
        }
        double[] probabilities = new double[logits.length];
        if (temperature == 0) { probabilities[best] = 1; return probabilities; }
        double sum = 0;
        for (int i = 0; i < logits.length; i++) {
            probabilities[i] = Math.exp((logits[i] - logits[best]) / temperature);
            sum += probabilities[i];
        }
        for (int i = 0; i < probabilities.length; i++) probabilities[i] /= sum;
        Integer[] order = new Integer[logits.length];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, Comparator.<Integer>comparingDouble(i -> probabilities[i]).reversed()
                .thenComparingInt(Integer::intValue));
        double kept = 0;
        double[] filtered = new double[logits.length];
        for (int index : order) {
            filtered[index] = probabilities[index];
            kept += probabilities[index];
            if (kept >= topP) break;
        }
        for (int i = 0; i < filtered.length; i++) filtered[i] /= kept;
        return filtered;
    }
    // END distribution

    // BEGIN admission
    public static void admit(Capabilities model, int inputTokens, int outputReserve, int margin,
            Double temperature, Double topP) {
        if (inputTokens < 0 || outputReserve <= 0 || margin < 0 || outputReserve > model.maximumOutput()
                || (long) inputTokens + outputReserve + margin > model.totalWindow())
            throw new IllegalArgumentException("Token request does not fit the declared model contract");
        if (temperature != null && (!model.supported().contains(Knob.TEMPERATURE)
                || !Double.isFinite(temperature) || temperature < 0))
            throw new IllegalArgumentException("Unsupported/invalid temperature");
        if (topP != null && (!model.supported().contains(Knob.TOP_P)
                || !Double.isFinite(topP) || topP <= 0 || topP > 1))
            throw new IllegalArgumentException("Unsupported/invalid top-p");
    }
    // END admission

    // BEGIN cost
    public static Optional<BigDecimal> cost(Long inputTokens, Long outputTokens,
            BigDecimal inputRatePerMillion, BigDecimal outputRatePerMillion) {
        if (inputTokens == null || outputTokens == null) return Optional.empty();
        if (inputTokens < 0 || outputTokens < 0 || inputRatePerMillion.signum() < 0 || outputRatePerMillion.signum() < 0)
            throw new IllegalArgumentException("Negative usage/rate");
        return Optional.of(BigDecimal.valueOf(inputTokens).multiply(inputRatePerMillion)
                .add(BigDecimal.valueOf(outputTokens).multiply(outputRatePerMillion))
                .divide(new BigDecimal("1000000")));
    }
    // END cost

    public enum ErrorKind { RATE_LIMIT, TRANSIENT_TRANSPORT, BAD_REQUEST, UNKNOWN_SIDE_EFFECT }

    // BEGIN retry
    public static boolean mayRetry(ErrorKind error, int attemptsUsed, int maxAttempts,
            long elapsedMillis, long totalMillis, long delayMillis, long minimumAttemptMillis) {
        if (attemptsUsed < 1 || maxAttempts < 1 || elapsedMillis < 0 || totalMillis <= 0
                || delayMillis < 0 || minimumAttemptMillis <= 0)
            throw new IllegalArgumentException("Invalid retry budget");
        if (error != ErrorKind.RATE_LIMIT && error != ErrorKind.TRANSIENT_TRANSPORT) return false;
        if (attemptsUsed >= maxAttempts || elapsedMillis >= totalMillis) return false;
        long remaining = totalMillis - elapsedMillis;
        return delayMillis < remaining && minimumAttemptMillis <= remaining - delayMillis;
    }
    // END retry

    public static void main(String[] args) {
        double[] logits = {Math.log(.5), Math.log(.25), Math.log(.15), Math.log(.10)};
        double[] nucleus = distribution(logits, 1, .7);
        close(nucleus[0], 2.0 / 3); close(nucleus[1], 1.0 / 3);
        close(nucleus[2], 0); close(nucleus[3], 0);
        double[] sharp = distribution(logits, .5, .7);
        close(sharp[0], 1); close(Arrays.stream(sharp).sum(), 1);
        close(distribution(logits, 0, 1)[0], 1);
        double[] shifted = Arrays.stream(logits).map(value -> value + 500).toArray();
        for (int i = 0; i < 4; i++) close(distribution(shifted, 1, 1)[i], distribution(logits, 1, 1)[i]);
        rejects(() -> distribution(logits, 1, 0));
        rejects(() -> distribution(new double[]{Double.NaN}, 1, 1));
        var model = new Capabilities(8192, 1024, Set.of(Knob.TEMPERATURE, Knob.TOP_P));
        admit(model, 2000, 500, 200, .2, null);
        rejects(() -> admit(model, 8000, 500, 0, .2, null));
        rejects(() -> admit(new Capabilities(8192, 1024, Set.of()), 2000, 500, 200, .2, null));
        var charge = cost(2000L, 500L, new BigDecimal("2"), new BigDecimal("8")).orElseThrow();
        check(charge.compareTo(new BigDecimal("0.008")) == 0, "made-up per-million charge");
        check(cost(null, 500L, BigDecimal.TEN, BigDecimal.TEN).isEmpty(), "unknown is not zero");
        check(mayRetry(ErrorKind.RATE_LIMIT, 1, 2, 600, 1000, 100, 100), "fits original deadline");
        check(!mayRetry(ErrorKind.RATE_LIMIT, 1, 2, 800, 1000, 200, 100), "delay consumes deadline");
        check(!mayRetry(ErrorKind.UNKNOWN_SIDE_EFFECT, 1, 2, 0, 1000, 0, 100), "reconcile side effects");
        check(!mayRetry(ErrorKind.TRANSIENT_TRANSPORT, 2, 2, 0, 1000, 0, 100), "attempt ceiling");
        System.out.printf(java.util.Locale.ROOT, "T=1, top-p=.7: [%.6f, %.6f, %.6f, %.6f]%n", nucleus[0], nucleus[1], nucleus[2], nucleus[3]);
        System.out.println("T=.5, top-p=.7: [1, 0, 0, 0]; made-up charge = " + charge.toPlainString() + " credits.");
        System.out.println("PASS: normalized nucleus, shift invariance, invalid input, capabilities, context, unknown usage and retry budgets.");
    }
    private static void close(double a, double b) { check(Math.abs(a - b) < 1e-10, "probability mismatch"); }
    private static void check(boolean value, String detail) { if (!value) throw new AssertionError(detail); }
    private static void rejects(Runnable task) {
        try { task.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid request rejection");
    }
}
