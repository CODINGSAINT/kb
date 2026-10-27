// BEGIN complete
package kb.springfundamentals;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public final class ExplanationController {
    public record Question(String question) { }
    public record Answer(String answer) { }
    public record Failure(String code, String message) { }
    private final ExplanationService service;

    public ExplanationController(ExplanationService service) {
        this.service = service;
    }

    @PostMapping("/explain")
    public Answer explain(@RequestBody Question request) {
        return new Answer(service.explain(request.question()));
    }

    @ExceptionHandler(ExplanationService.BadQuestion.class)
    public ResponseEntity<Failure> badQuestion() {
        return ResponseEntity.badRequest().body(new Failure("INVALID_QUESTION",
                "Provide a nonblank question of at most 1000 UTF-16 code units."));
    }

    @ExceptionHandler(ExplanationService.ModelFailure.class)
    public ResponseEntity<Failure> modelFailure() {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(new Failure("MODEL_FAILURE",
                "The configured model did not provide an answer. Try again later."));
    }
}
// END complete
