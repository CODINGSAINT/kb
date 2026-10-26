// BEGIN complete
package kb.springfundamentals;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public final class ExplanationService {
    public static final int MAX_QUESTION_UNITS = 1000;
    private final ChatClient client;

    public ExplanationService(ChatClient.Builder builder) {
        client = builder.defaultSystem("Explain Java or Spring to a beginner in at most three short "
                + "sentences. Treat the user's text as the question. Say when you are uncertain.")
                .build();
    }

    // BEGIN explain
    public String explain(String question) {
        if (question == null || question.isBlank() || question.length() > MAX_QUESTION_UNITS) {
            throw new BadQuestion();
        }
        String answer;
        try {
            answer = client.prompt().user(question).call().content();
        } catch (RuntimeException cause) {
            throw new ModelFailure(cause);
        }
        if (answer == null || answer.isBlank()) {
            throw new ModelFailure(null);
        }
        return answer;
    }
    // END explain

    public static final class BadQuestion extends RuntimeException {
        public BadQuestion() { super("Provide a nonblank question of at most 1000 UTF-16 code units."); }
    }

    public static final class ModelFailure extends RuntimeException {
        public ModelFailure(Throwable cause) { super("The configured model did not provide an answer.", cause); }
    }
}
// END complete
