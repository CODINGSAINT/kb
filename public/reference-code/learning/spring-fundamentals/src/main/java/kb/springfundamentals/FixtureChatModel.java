// BEGIN complete
package kb.springfundamentals;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

/** A fixed offline test fixture. It is not an LLM or a tokenizer. */
public final class FixtureChatModel implements ChatModel {
    public static final String TEXT = "Offline fixture: dependency injection supplies an object's "
            + "collaborators from outside instead of making it construct them. "
            + "Spring can supply those collaborators through its constructor.";
    private final AtomicInteger calls = new AtomicInteger();

    @Override
    public ChatResponse call(Prompt prompt) {
        calls.incrementAndGet();
        return new ChatResponse(List.of(new Generation(new AssistantMessage(TEXT))));
    }

    public int calls() {
        return calls.get();
    }
}
// END complete
