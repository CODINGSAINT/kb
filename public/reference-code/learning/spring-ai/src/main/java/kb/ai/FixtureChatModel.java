package kb.ai;

import java.util.List;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.DefaultUsage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

/** Offline fixture, not an LLM. It deliberately gives a fixed response to test the application path. */
public final class FixtureChatModel implements ChatModel {
    public enum Mode { TEXT, STRUCTURED }
    private final Mode mode;
    public FixtureChatModel(){this(Mode.TEXT);}
    public FixtureChatModel(Mode mode){this.mode=java.util.Objects.requireNonNull(mode);}
    public static ChatResponse response(String text) {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(text))),
            ChatResponseMetadata.builder().model("offline-fixture").usage(new DefaultUsage(12,8)).build());
    }
    @Override public ChatResponse call(Prompt prompt) {
        if(mode==Mode.TEXT) return response("Offline fixture: encapsulation keeps state private and changes it through methods that preserve its rules.");
        return response("{\"concept\":\"Offline fixture: encapsulation\",\"steps\":[\"Keep state private.\",\"Change it through methods that preserve its rules.\"]}");
    }
    @Override public Flux<ChatResponse> stream(Prompt prompt) {
        return Flux.just(response("Keep state private. "),response("Use methods to preserve its rules."));
    }
}
