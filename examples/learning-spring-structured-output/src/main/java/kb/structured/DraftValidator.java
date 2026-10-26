// BEGIN complete
package kb.structured;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import static kb.structured.ExpenseDraft.*;

/** Local business/evidence checks. Passing these is not proof of extraction truth. */
public final class DraftValidator {
    private static final BigDecimal MONEY_LIMIT = new BigDecimal("1000000.00");
    private DraftValidator() { }

    public static List<String> issues(ExpenseDraft draft, String sourceText) {
        var issues = new ArrayList<String>();
        if (draft.merchant() == null || draft.merchant().isBlank() || draft.merchant().length() > 80
                || !sourceText.contains(draft.merchant())) issues.add("MERCHANT_MISSING_OR_UNSUPPORTED");
        boolean quantityOk = draft.quantity() != null && draft.quantity() >= 1 && draft.quantity() <= 100;
        if (!quantityOk) issues.add("QUANTITY_MISSING_OR_OUT_OF_RANGE");
        if (draft.currency() != Currency.INR) issues.add("CURRENCY_NOT_SUPPORTED_FOR_THIS_TASK");
        if (draft.category() == null || draft.category() == Category.UNKNOWN) issues.add("CATEGORY_UNKNOWN");
        boolean unitOk = money(draft.unitPrice());
        boolean totalOk = money(draft.total());
        if (!unitOk) issues.add("UNIT_PRICE_MISSING_OR_INVALID");
        if (!totalOk) issues.add("TOTAL_MISSING_OR_INVALID");
        if (quantityOk && unitOk && totalOk && draft.unitPrice()
                .multiply(BigDecimal.valueOf(draft.quantity())).compareTo(draft.total()) != 0) {
            issues.add("TOTAL_DOES_NOT_EQUAL_QUANTITY_TIMES_PRICE");
        }
        if (draft.evidenceQuote() == null || draft.evidenceQuote().isBlank()
                || draft.evidenceQuote().length() > 160 || !sourceText.contains(draft.evidenceQuote())) {
            issues.add("EVIDENCE_QUOTE_NOT_FOUND");
        }
        return List.copyOf(issues);
    }

    private static boolean money(BigDecimal value) {
        // Bound scale before multiplication/normalization; huge exponents are not money here.
        return value != null && value.scale() >= 0 && value.scale() <= 2 && value.precision() <= 9
                && value.signum() >= 0 && value.compareTo(MONEY_LIMIT) <= 0;
    }

    public static ExpenseDraft normalized(ExpenseDraft draft) {
        return new ExpenseDraft(draft.schemaVersion(), draft.sourceId(), draft.merchant(), draft.quantity(),
                draft.currency(), draft.unitPrice().setScale(2), draft.total().setScale(2),
                draft.purchaseDate(), draft.category(), draft.evidenceQuote());
    }
}
// END complete
