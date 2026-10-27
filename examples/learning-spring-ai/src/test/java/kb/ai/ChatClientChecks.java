package kb.ai;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class ChatClientChecks {
    static class Probe implements ChatModel {
        AtomicInteger calls=new AtomicInteger(),streams=new AtomicInteger(),cancellations=new AtomicInteger();
        List<Prompt> prompts=new ArrayList<>();String text="A class protects its state.";
        public ChatResponse call(Prompt p){calls.incrementAndGet();prompts.add(p);return FixtureChatModel.response(text);}
        public Flux<ChatResponse> stream(Prompt p){streams.incrementAndGet();return Flux.just(FixtureChatModel.response("first "),FixtureChatModel.response("second")).doOnCancel(cancellations::incrementAndGet);}
    }
    @Test void constructingCallSpecDoesNotInvokeModel() {
        Probe p=new Probe();var call=ChatClient.create(p).prompt().user("Explain classes").call();
        assertEquals(0,p.calls.get());assertEquals(p.text,call.content());assertEquals(1,p.calls.get());
    }
    @Test void twoTerminalRequestsReallyMakeTwoCalls() {
        Probe p=new Probe();ChatClient c=ChatClient.create(p);
        c.prompt().user("same").call().content();c.prompt().user("same").call().chatResponse();
        assertEquals(2,p.calls.get());
    }
    @Test void textAndMetadataComeFromOneResponse() {
        Probe p=new Probe();StudyAssistant.Answer a=new StudyAssistant(p).answer("Explain encapsulation");
        assertEquals(p.text,a.text());assertEquals(12,a.inputTokens());assertEquals(8,a.outputTokens());assertEquals(1,p.calls.get());
    }
    @Test void requestsDoNotShareTheirUserMessages() {
        Probe p=new Probe();StudyAssistant a=new StudyAssistant(p);a.answer("first question");a.answer("second question");
        assertEquals(2,p.prompts.size());assertEquals(2,p.prompts.get(0).getInstructions().size());assertEquals(2,p.prompts.get(1).getInstructions().size());
        assertFalse(p.prompts.get(1).getContents().contains("first question"));
    }
    @Test void invalidInputDoesNotReachModel() {
        Probe p=new Probe();StudyAssistant a=new StudyAssistant(p);
        assertThrows(StudyAssistant.BadQuestion.class,()->a.answer(" "));
        assertThrows(StudyAssistant.BadQuestion.class,()->a.card("x".repeat(2001)));assertEquals(0,p.calls.get());
    }
    @Test void emptyResponseIsNotSuccess() {
        Probe p=new Probe();p.text="";assertThrows(IllegalStateException.class,()->new StudyAssistant(p).answer("Hi"));
    }
    @Test void missingUsageIsUnknownInsteadOfFree() {
        ChatModel noUsage=p->new ChatResponse(List.of(new Generation(new org.springframework.ai.chat.messages.AssistantMessage("An answer"))));
        var answer=new StudyAssistant(noUsage).answer("Hi");assertNull(answer.inputTokens());assertNull(answer.outputTokens());
    }
    @Test void structuredEntityAndMetadataNeedOneResponse() {
        Probe p=new Probe();p.text="{\"concept\":\"Class\",\"steps\":[\"Protect state.\"]}";
        var combined=ChatClient.create(p).prompt().user("Explain classes").call().responseEntity(StudyAssistant.StudyCard.class);
        assertEquals("Class",combined.entity().concept());assertEquals(20,combined.response().getMetadata().getUsage().getTotalTokens());assertEquals(1,p.calls.get());
    }
    @Test void structuredConversionProducesCheckedValue() {
        Probe p=new Probe();p.text="{\"concept\":\"Class\",\"steps\":[\"Group state and behavior.\"]}";
        var card=new StudyAssistant(p).card("Explain classes");assertEquals("Class",card.concept());assertEquals(1,card.steps().size());assertEquals(1,p.calls.get());
        assertThrows(UnsupportedOperationException.class,()->card.steps().add("mutate"));
    }
    @Test void validJsonStillNeedsDomainValidation() {
        Probe p=new Probe();p.text="{\"concept\":\"\",\"steps\":[]}";
        assertThrows(IllegalStateException.class,()->new StudyAssistant(p).card("Hi"));
    }
    @Test void malformedOutputIsAnApplicationFailure() {
        Probe p=new Probe();p.text="I refuse to return JSON";
        assertThrows(RuntimeException.class,()->new StudyAssistant(p).card("Hi"));assertEquals(1,p.calls.get());
    }
    @Test void streamsAreColdAndSecondSubscriptionReexecutes() {
        Probe p=new Probe();Flux<String> stream=new StudyAssistant(p).stream("Hi");assertEquals(0,p.streams.get());
        StepVerifier.create(stream).expectNext("first ","second").verifyComplete();
        StepVerifier.create(stream).expectNext("first ","second").verifyComplete();assertEquals(2,p.streams.get());
    }
    @Test void rawResponseSpecIsNotReusableInThisVersion() {
        Probe p=new Probe();Flux<String> raw=ChatClient.create(p).prompt().user("Hi").stream().content();
        StepVerifier.create(raw).expectNext("first ","second").verifyComplete();
        StepVerifier.create(raw).expectErrorMatches(ex->ex instanceof IllegalStateException && ex.getMessage().contains("StreamAdvisors")).verify();
        assertEquals(1,p.streams.get());
    }
    @Test void cancellationReachesUpstream() {
        Probe p=new Probe();StepVerifier.create(new StudyAssistant(p).stream("Hi")).expectNext("first ").thenCancel().verify();
        assertEquals(1,p.cancellations.get());
    }
    @Test void completedEmptyOrMetadataOnlyStreamIsAnError() {
        for(Flux<ChatResponse> response:List.of(Flux.<ChatResponse>empty(),Flux.just(new ChatResponse(List.of())))) {
            ChatModel empty=new ChatModel(){public ChatResponse call(Prompt p){throw new UnsupportedOperationException();}public Flux<ChatResponse> stream(Prompt p){return response;}};
            StepVerifier.create(new StudyAssistant(empty).stream("Hi")).expectError(IllegalStateException.class).verify();
        }
    }
    @Test void completedWhitespaceIsNotAnAnswer() {
        ChatModel blank=new ChatModel(){public ChatResponse call(Prompt p){throw new UnsupportedOperationException();}public Flux<ChatResponse> stream(Prompt p){return Flux.just(FixtureChatModel.response(" "));}};
        StepVerifier.create(new StudyAssistant(blank).stream("Hi")).expectNext(" ").expectError(IllegalStateException.class).verify();
    }
    @Test void fixtureShapeIsConfiguredNotInferredFromQuestionText() {
        StudyAssistant service=new StudyAssistant(new FixtureChatModel(),new FixtureChatModel(FixtureChatModel.Mode.STRUCTURED));
        String question="Explain the literal \"concept\" field";
        assertTrue(service.answer(question).text().startsWith("Offline fixture:"));
        assertEquals("Offline fixture: encapsulation",service.card(question).concept());
    }
    @Test void idleTimeoutDoesNotInventACompletedAnswer() {
        ChatModel stalled=new ChatModel(){public ChatResponse call(Prompt p){throw new UnsupportedOperationException();}public Flux<ChatResponse> stream(Prompt p){return Flux.never();}};
        StepVerifier.withVirtualTime(()->new StudyAssistant(stalled).stream("Hi"))
            .thenAwait(java.time.Duration.ofSeconds(21)).expectError(java.util.concurrent.TimeoutException.class).verify();
    }
}
