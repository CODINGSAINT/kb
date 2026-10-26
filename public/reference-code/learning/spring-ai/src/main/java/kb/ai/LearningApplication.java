package kb.ai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;

/** Local offline demo. Add authentication/rate limits before exposing an AI endpoint to other users. */
@SpringBootApplication
public class LearningApplication {
    public static void main(String[] args) {SpringApplication.run(LearningApplication.class,args);}
    @Bean ChatModel fixtureModel(){return new FixtureChatModel();}
    @Bean StudyAssistant assistant(ChatModel model){return new StudyAssistant(model,new FixtureChatModel(FixtureChatModel.Mode.STRUCTURED));}
    @RestController
    static class Controller {
        record Question(String text) {}
        private final StudyAssistant assistant;
        Controller(StudyAssistant assistant){this.assistant=assistant;}
        // BEGIN endpoint
        @PostMapping("/answer")
        Mono<StudyAssistant.Answer> answer(@RequestBody Question request) {
            return Mono.fromCallable(()->assistant.answer(request.text()))
                .subscribeOn(Schedulers.boundedElastic());
        }
        // END endpoint
        @PostMapping("/card")
        Mono<StudyAssistant.StudyCard> card(@RequestBody Question request) {
            return Mono.fromCallable(()->assistant.card(request.text())).subscribeOn(Schedulers.boundedElastic());
        }
        @PostMapping(value="/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
        Flux<String> stream(@RequestBody Question request) {return assistant.stream(request.text());}
        @ExceptionHandler(StudyAssistant.BadQuestion.class)
        @ResponseStatus(org.springframework.http.HttpStatus.BAD_REQUEST)
        String badQuestion(StudyAssistant.BadQuestion ex){return "Provide a question of 1..2000 characters.";}
    }
}
