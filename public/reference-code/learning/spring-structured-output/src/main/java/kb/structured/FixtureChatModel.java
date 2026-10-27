package kb.structured;

import java.util.ArrayList;
import java.util.List;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.metadata.ChatGenerationMetadata;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

/** Single-threaded scripted fixture; retained prompts are synthetic test data only. */
public final class FixtureChatModel implements ChatModel {
    public record Reply(String text, String finishReason) {
        public static Reply stopped(String text) { return new Reply(text, "stop"); }
    }
    private final List<Reply> replies;
    private final List<Prompt> prompts = new ArrayList<>();

    public FixtureChatModel(Reply... replies) { this.replies = List.of(replies); }

    @Override
    public ChatResponse call(Prompt prompt) {
        int index = prompts.size();
        prompts.add(prompt);
        if (index >= replies.size()) throw new IllegalStateException("Scripted fixture exhausted");
        Reply reply = replies.get(index);
        return new ChatResponse(List.of(new Generation(new AssistantMessage(reply.text()),
                ChatGenerationMetadata.builder().finishReason(reply.finishReason()).build())));
    }

    public int calls() { return prompts.size(); }
    public List<Prompt> prompts() { return List.copyOf(prompts); }
}
