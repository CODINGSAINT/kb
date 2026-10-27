package kb.structured;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class StructuredApplication {
    public static void main(String[] args) { SpringApplication.run(StructuredApplication.class, args); }

    @Bean
    CommandLineRunner demo(@Value("${demo.case:valid}") String example) {
        return args -> {
            var fixture = DemoData.model(example);
            var extractor = new ReceiptExtractor(ChatClient.create(fixture));
            var result = extractor.extract(new ReceiptExtractor.Source("R17", DemoData.SOURCE));
            System.out.println("OFFLINE SCRIPTED FIXTURE — not an LLM or an extraction-quality test");
            System.out.printf("status=%s, calls=%d, issues=%s%n", result.status(), result.calls(), result.issues());
            if (result.draft() != null) System.out.println(result.draft());
        };
    }
}
