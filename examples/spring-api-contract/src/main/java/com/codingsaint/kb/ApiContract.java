package com.codingsaint.kb;

import java.util.List;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.annotation.Tool;
import reactor.core.publisher.Flux;

/** Compile-only API contract. No provider, credentials, HTTP endpoint or paid calls. */
public final class ApiContract {
    private final ChatClient client;
    public ApiContract(ChatClient.Builder builder) { this.client = builder.build(); }
    public String explain(String question) {
        return client.prompt().system("Answer only from the supplied authorized evidence.")
                .user(question).call().content();
    }
    public Flux<String> stream(String question) {
        return client.prompt().user(question).stream().content();
    }
    public Extraction extract(String question) {
        return client.prompt().user(question).call().entity(Extraction.class);
    }
    public Object usage(String question) {
        var response = client.prompt().user(question).call().chatResponse();
        if (response == null) throw new IllegalStateException("No response");
        return response.getMetadata().getUsage();
    }
    public String withTools(String question, AuthorizedOrders orders) {
        return client.prompt().user(question).tools(new OrderTools(orders)).call().content();
    }
    public record Extraction(String summary, List<String> sourceIds) {}
    public interface AuthorizedOrders { String statusForCurrentPrincipal(String orderId); }
    static final class OrderTools {
        private final AuthorizedOrders orders;
        OrderTools(AuthorizedOrders orders) { this.orders = orders; }
        @Tool(description="Read the status of one order authorized for the current principal")
        public String status(String orderId) { return orders.statusForCurrentPrincipal(orderId); }
    }
}
