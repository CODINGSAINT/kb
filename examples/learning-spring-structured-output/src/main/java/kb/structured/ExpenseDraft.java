// BEGIN complete
package kb.structured;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.LocalDate;

/** All keys are required; unknown source facts may have explicitly nullable values. */
public record ExpenseDraft(
        @JsonProperty(required = true) Integer schemaVersion,
        @JsonProperty(required = true) String sourceId,
        @JsonProperty(required = true) String merchant,
        @JsonProperty(required = true) Integer quantity,
        @JsonProperty(required = true) Currency currency,
        @JsonProperty(required = true) BigDecimal unitPrice,
        @JsonProperty(required = true) BigDecimal total,
        @JsonProperty(required = true) LocalDate purchaseDate,
        @JsonProperty(required = true) Category category,
        @JsonProperty(required = true) String evidenceQuote) {
    public enum Currency { INR, USD, UNKNOWN }
    public enum Category { OFFICE, TRAVEL, SOFTWARE, UNKNOWN }
}
// END complete
