// BEGIN complete
package kb.structured;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.ResponseEntity;
import org.springframework.ai.chat.model.ChatResponse;

/** API demonstrations only. These candidates still require application checks. */
public final class ConvenienceApis {
    private ConvenienceApis() { }

    // BEGIN entity
    public static ExpenseDraft entity(ChatClient client, ReceiptExtractor.Source source) {
        return client.prompt().system(ReceiptExtractor.TASK)
                .user(u -> u.text("Source ID: {id}\nReceipt data:\n{source}")
                        .param("id", source.id()).param("source", source.text()))
                .call().entity(new StrictDraftConverter());
    }
    // END entity

    // BEGIN combined
    public static ResponseEntity<ChatResponse, ExpenseDraft> combined(
            ChatClient client, ReceiptExtractor.Source source) {
        return client.prompt().system(ReceiptExtractor.TASK)
                .user(u -> u.text("Source ID: {id}\nReceipt data:\n{source}")
                        .param("id", source.id()).param("source", source.text()))
                .call().responseEntity(new StrictDraftConverter());
    }
    // END combined
}
// END complete
