package kb.aifundamentals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/** Java 21; no model, tokenizer, framework, network or paid account is used. */
public final class AiFundamentals {
    private AiFundamentals() { }

    // BEGIN distribution
    public static double[] probabilities(double[] logits, double temperature) {
        Objects.requireNonNull(logits, "logits");
        if (logits.length == 0 || !Double.isFinite(temperature) || temperature < 0) {
            throw new IllegalArgumentException("Nonempty logits and finite T >= 0 required");
        }
        int best = 0;
        for (int i = 0; i < logits.length; i++) {
            if (!Double.isFinite(logits[i])) {
                throw new IllegalArgumentException("Every logit must be finite");
            }
            if (logits[i] > logits[best]) best = i;
        }
        double[] result = new double[logits.length];
        if (temperature == 0) {
            result[best] = 1; // Toy convention: greedy; first index breaks a tie.
            return result;
        }
        double total = 0;
        for (int i = 0; i < logits.length; i++) {
            result[i] = Math.exp((logits[i] - logits[best]) / temperature);
            total += result[i];
        }
        for (int i = 0; i < result.length; i++) result[i] /= total;
        return result;
    }
    // END distribution

    public static double entropyBits(double[] distribution) {
        validateDistribution(distribution);
        double entropy = 0;
        for (double p : distribution) {
            if (p > 0) entropy -= p * Math.log(p) / Math.log(2);
        }
        return entropy;
    }

    // BEGIN sample
    public static int sample(double[] distribution, double uniform) {
        validateDistribution(distribution);
        if (!Double.isFinite(uniform) || uniform < 0 || uniform >= 1) {
            throw new IllegalArgumentException("Draw must be in [0, 1)");
        }
        double cumulative = 0;
        for (int i = 0; i < distribution.length; i++) {
            cumulative += distribution[i];
            if (uniform < cumulative) return i;
        }
        // Normalized sums can finish microscopically below 1 in floating point.
        for (int i = distribution.length - 1; i >= 0; i--) {
            if (distribution[i] > 0) return i;
        }
        throw new IllegalStateException("Validated distribution has no mass");
    }
    // END sample

    private static void validateDistribution(double[] distribution) {
        Objects.requireNonNull(distribution, "distribution");
        double sum = 0;
        for (double p : distribution) {
            if (!Double.isFinite(p) || p < 0 || p > 1) {
                throw new IllegalArgumentException("Probabilities must be finite in [0, 1]");
            }
            sum += p;
        }
        if (distribution.length == 0 || Math.abs(sum - 1) > 1e-9) {
            throw new IllegalArgumentException("Probabilities must sum to 1");
        }
    }

    /** Token sizes come from an external tokenizer/adapter; main uses toy fixtures. */
    public record Budget(int limit, int fixedInput, int outputReserve, int margin) {
        public Budget {
            if (limit <= 0 || fixedInput < 0 || outputReserve < 0 || margin < 0
                    || (long) fixedInput + outputReserve + margin > limit) {
                throw new IllegalArgumentException("Mandatory request does not fit");
            }
        }

        public int evidenceAllowance() {
            return limit - fixedInput - outputReserve - margin;
        }
    }

    public record Passage(String id, int countedTokens) {
        public Passage {
            if (id == null || id.isBlank() || countedTokens <= 0) {
                throw new IllegalArgumentException("Passage needs an ID and positive size");
            }
        }
    }

    public record Plan(List<Passage> selected, List<Passage> omitted, int inputEstimate) {
        public Plan {
            selected = List.copyOf(selected);
            omitted = List.copyOf(omitted);
        }
    }

    // BEGIN budget
    public static Plan select(Budget budget, List<Passage> rankedPassages) {
        Objects.requireNonNull(budget, "budget");
        Objects.requireNonNull(rankedPassages, "rankedPassages");
        int remaining = budget.evidenceAllowance();
        var selected = new ArrayList<Passage>();
        var omitted = new ArrayList<Passage>();
        var seen = new HashSet<String>();
        for (Passage passage : rankedPassages) {
            Objects.requireNonNull(passage, "passage");
            if (!seen.add(passage.id())) {
                throw new IllegalArgumentException("Duplicate passage ID");
            }
            if (passage.countedTokens() <= remaining) {
                selected.add(passage);
                remaining -= passage.countedTokens();
            } else {
                omitted.add(passage);
            }
        }
        int used = budget.evidenceAllowance() - remaining;
        return new Plan(selected, omitted, budget.fixedInput() + used);
    }

    public static boolean finalInputFits(Budget budget, int actualInputTokens) {
        if (actualInputTokens < 0) throw new IllegalArgumentException("Negative input size");
        return (long) actualInputTokens + budget.outputReserve() + budget.margin()
                <= budget.limit();
    }
    // END budget

    public static void main(String[] args) {
        double[] logits = { Math.log(0.6), Math.log(0.3), Math.log(0.1) };
        double[] p = probabilities(logits, 1);
        close(p[0], 0.6); close(p[1], 0.3); close(p[2], 0.1);
        double[] sharp = probabilities(logits, 0.5);
        close(sharp[0], 18.0 / 23); close(sharp[1], 9.0 / 46);
        close(sharp[2], 1.0 / 46);
        close(Arrays.stream(sharp).sum(), 1);
        close(entropyBits(p), 1.295461844238322);
        close(entropyBits(probabilities(logits, 0)), 0);
        check(Arrays.equals(probabilities(new double[]{4, 4, 1}, 0),
                new double[]{1, 0, 0}), "Greedy tie rule");
        double[] shifted = probabilities(Arrays.stream(logits).map(z -> z + 1000).toArray(), 1);
        for (int i = 0; i < p.length; i++) close(p[i], shifted[i]);
        double[] wrongLeader = probabilities(new double[]{Math.log(0.3),
                Math.log(0.6), Math.log(0.1)}, 0.5);
        close(wrongLeader[1], 18.0 / 23);
        check(sample(p, 0) == 0 && sample(p, 0.7) == 1
                && sample(p, 0.999999) == 2, "Cumulative sampling intervals");
        rejects(() -> probabilities(new double[]{Double.NaN}, 1));
        rejects(() -> probabilities(logits, -1));
        rejects(() -> sample(new double[]{0.6, 0.6}, 0.5));
        rejects(() -> sample(p, 1));

        var budget = new Budget(4096, 1024, 512, 256);
        var passages = List.of(new Passage("S1", 1200), new Passage("S2", 1000),
                new Passage("S3", 900));
        Plan plan = select(budget, passages);
        check(budget.evidenceAllowance() == 2304, "Evidence allowance");
        check(plan.selected().equals(passages.subList(0, 2))
                && plan.omitted().equals(passages.subList(2, 3)), "Whole passages fit");
        check(plan.inputEstimate() == 3224, "Input estimate excludes output reserve");
        Plan narrow = select(new Budget(3072, 1024, 512, 256), passages);
        check(narrow.selected().equals(List.of(passages.get(0))), "Narrow budget omits S2");
        Plan skipLarge = select(new Budget(100, 0, 0, 0),
                List.of(new Passage("large", 101), new Passage("small", 80)));
        check(skipLarge.selected().getFirst().id().equals("small"), "Continue after omission");
        check(finalInputFits(budget, 3328) && !finalInputFits(budget, 3329),
                "Final assembled-request boundary");
        rejects(() -> new Budget(100, 90, 10, 1));
        rejects(() -> select(budget, List.of(passages.getFirst(), passages.getFirst())));

        System.out.printf(Locale.ROOT, "T=1 [%.6f, %.6f, %.6f]; entropy=%.6f bits%n",
                p[0], p[1], p[2], entropyBits(p));
        System.out.printf(Locale.ROOT, "T=0.5 [%.6f, %.6f, %.6f]%n",
                sharp[0], sharp[1], sharp[2]);
        System.out.println("Context selected=" + plan.selected().stream().map(Passage::id).toList()
                + ", omitted=" + plan.omitted().stream().map(Passage::id).toList()
                + ", allowance=" + budget.evidenceAllowance());
        System.out.println("Mechanism checks passed: normalization, temperature, sampling "
                + "intervals, invalid input, context planning and final admission.");
    }

    private static void close(double actual, double expected) {
        check(Math.abs(actual - expected) < 1e-10, "Expected " + expected + ", got " + actual);
    }

    private static void check(boolean passed, String message) {
        if (!passed) throw new AssertionError(message);
    }

    private static void rejects(Runnable action) {
        try {
            action.run();
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("Expected an invalid input to be rejected");
    }
}
