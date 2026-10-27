package kb.springfundamentals;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.model.ollama.autoconfigure.OllamaChatProperties;
import org.springframework.ai.ollama.OllamaChatModel;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

class FundamentalsTest {
    private static final class Probe implements ChatModel {
        final List<Prompt> prompts = new ArrayList<>();
        String text = "A checked fixture response.";

        @Override
        public ChatResponse call(Prompt prompt) {
            prompts.add(prompt);
            return new ChatResponse(List.of(new Generation(new AssistantMessage(text))));
        }
    }

    private static ConfigurableApplicationContext start(String... args) {
        return new SpringApplicationBuilder(FundamentalsApplication.class)
                .web(WebApplicationType.NONE).logStartupInfo(false)
                .properties("logging.level.root=ERROR", "spring.main.banner-mode=off")
                .run(args);
    }

    @Test
    void defaultBootContextWiresOneFixtureAndPrototypeBuilders() {
        try (var context = start()) {
            var models = context.getBeansOfType(ChatModel.class);
            assertEquals(1, models.size());
            assertInstanceOf(FixtureChatModel.class, models.values().iterator().next());
            assertTrue(context.getBeansOfType(EmbeddingModel.class).isEmpty());
            assertNotSame(context.getBean(ChatClient.Builder.class), context.getBean(ChatClient.Builder.class));
            var fixture = context.getBean(FixtureChatModel.class);
            assertEquals(0, fixture.calls());
            assertEquals(FixtureChatModel.TEXT,
                    context.getBean(ExplanationService.class).explain("What is dependency injection?"));
            assertEquals(1, fixture.calls());
            assertEquals("none", context.getEnvironment().getProperty("spring.ai.model.chat"));
        }
    }

    @Test
    void freshRequestsKeepRolesAndQuestionsSeparate() {
        Probe model = new Probe();
        var service = new ExplanationService(ChatClient.builder(model));
        service.explain("First question");
        service.explain("Second question");
        assertEquals(2, model.prompts.size());
        for (Prompt prompt : model.prompts) {
            assertEquals(2, prompt.getInstructions().size());
            assertEquals(MessageType.SYSTEM, prompt.getInstructions().get(0).getMessageType());
            assertEquals(MessageType.USER, prompt.getInstructions().get(1).getMessageType());
        }
        assertEquals("Second question", model.prompts.get(1).getInstructions().get(1).getText());
        assertFalse(model.prompts.get(1).getContents().contains("First question"));
    }

    @Test
    void invalidQuestionsStopBeforeModelAndBoundaryIsExplicit() {
        Probe model = new Probe();
        var service = new ExplanationService(ChatClient.builder(model));
        assertThrows(ExplanationService.BadQuestion.class, () -> service.explain(null));
        assertThrows(ExplanationService.BadQuestion.class, () -> service.explain(" \n"));
        assertThrows(ExplanationService.BadQuestion.class, () -> service.explain("x".repeat(1001)));
        assertTrue(model.prompts.isEmpty());
        assertEquals(model.text, service.explain("x".repeat(1000)));
        assertEquals(1, model.prompts.size());
    }

    @Test
    void emptyTextAndProviderErrorsDoNotBecomeSuccessfulAnswers() {
        Probe model = new Probe();
        model.text = " ";
        assertThrows(ExplanationService.ModelFailure.class,
                () -> new ExplanationService(ChatClient.builder(model)).explain("A question"));
        ChatModel failing = prompt -> { throw new IllegalStateException("private backend diagnostic"); };
        var service = new ExplanationService(ChatClient.builder(failing));
        var failure = assertThrows(ExplanationService.ModelFailure.class, () -> service.explain("A question"));
        assertEquals("The configured model did not provide an answer.", failure.getMessage());
        var controller = new ExplanationController(service);
        assertEquals(400, controller.badQuestion().getStatusCode().value());
        var response = controller.modelFailure();
        assertEquals(502, response.getStatusCode().value());
        assertEquals("MODEL_FAILURE", response.getBody().code());
        assertFalse(response.getBody().message().contains("private backend"));
    }

    @Test
    void ollamaProfileBindsAdapterWithoutMakingAModelRequest() {
        try (var context = start("--spring.profiles.active=ollama",
                "--OLLAMA_CHAT_MODEL=contract-test-name-not-a-real-model",
                "--spring.ai.ollama.base-url=http://127.0.0.1:1")) {
            assertTrue(context.getBeansOfType(FixtureChatModel.class).isEmpty());
            var models = context.getBeansOfType(ChatModel.class);
            assertEquals(1, models.size());
            var model = assertInstanceOf(OllamaChatModel.class, models.values().iterator().next());
            assertEquals("contract-test-name-not-a-real-model", model.getDefaultOptions().getModel());
            assertEquals(0.2, model.getDefaultOptions().getTemperature());
            assertEquals(128, context.getBean(OllamaChatProperties.class).getOptions().getNumPredict());
            assertTrue(context.getBeansOfType(EmbeddingModel.class).isEmpty());
            assertEquals("never", context.getEnvironment().getProperty("spring.ai.ollama.init.pull-model-strategy"));
            // Deliberately do not invoke the model or the application service here.
        }
    }

    @Test
    void blankLiveModelSelectionFailsStartupInsteadOfChoosingADefault() {
        assertThrows(RuntimeException.class, () -> {
            try (var ignored = start("--spring.profiles.active=ollama", "--OLLAMA_CHAT_MODEL= ",
                    "--spring.ai.ollama.base-url=http://127.0.0.1:1")) {
                fail("Blank model selection must not start");
            }
        });
    }
}
