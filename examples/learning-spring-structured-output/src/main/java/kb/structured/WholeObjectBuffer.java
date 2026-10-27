// BEGIN complete
package kb.structured;

import java.util.Objects;

/** Text-delta buffer. Only a normal completion may release the complete candidate. */
public final class WholeObjectBuffer {
    private final int limit;
    private final StringBuilder text = new StringBuilder();
    private boolean terminal;

    public WholeObjectBuffer(int limit) {
        if (limit <= 0) throw new IllegalArgumentException("Positive limit required");
        this.limit = limit;
    }

    public void append(String delta) {
        requireOpen();
        Objects.requireNonNull(delta);
        if ((long) text.length() + delta.length() > limit) {
            cancel();
            throw new IllegalStateException("OUTPUT_TOO_LARGE");
        }
        text.append(delta);
    }

    public String complete() {
        requireOpen();
        terminal = true;
        String completed = text.toString();
        text.setLength(0);
        return completed;
    }

    public void cancel() {
        terminal = true;
        text.setLength(0);
    }

    private void requireOpen() {
        if (terminal) throw new IllegalStateException("Buffer already completed or discarded");
    }
}
// END complete
