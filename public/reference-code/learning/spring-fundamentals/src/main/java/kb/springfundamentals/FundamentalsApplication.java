// BEGIN complete
package kb.springfundamentals;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.util.Assert;

@SpringBootApplication
public class FundamentalsApplication {
    public static void main(String[] args) {
        SpringApplication.run(FundamentalsApplication.class, args);
    }

    @Bean
    @Profile("!ollama")
    FixtureChatModel offlineModel() {
        return new FixtureChatModel();
    }

    @Configuration(proxyBeanMethods = false)
    @Profile("ollama")
    static class RequiredOllamaModel {
        RequiredOllamaModel(@Value("${OLLAMA_CHAT_MODEL}") String modelName) {
            Assert.hasText(modelName, "Set OLLAMA_CHAT_MODEL to an installed chat model name");
        }
    }
}
// END complete
