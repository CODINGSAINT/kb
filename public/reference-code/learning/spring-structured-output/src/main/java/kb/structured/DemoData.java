package kb.structured;

import static kb.structured.FixtureChatModel.Reply;

/** Entirely fictional source and model responses; no OCR or live model is involved. */
public final class DemoData {
    private DemoData() { }
    public static final String SOURCE = """
            Receipt R17
            Merchant: Desk Supply Co.
            3 notebooks for office use.
            Unit price INR 199.50; total INR 598.50.
            Purchase date: not stated.
            """;
    public static final String VALID = """
            {
              "schemaVersion": 1,
              "sourceId": "R17",
              "merchant": "Desk Supply Co.",
              "quantity": 3,
              "currency": "INR",
              "unitPrice": 199.50,
              "total": 598.50,
              "purchaseDate": null,
              "category": "OFFICE",
              "evidenceQuote": "Unit price INR 199.50; total INR 598.50."
            }
            """;
    public static final String BAD_TOTAL = VALID.replace("\"total\": 598.50", "\"total\": 590.00");
    public static final String MALFORMED = "{\"schemaVersion\": 1,";

    public static FixtureChatModel model(String name) {
        return switch (name) {
            case "valid" -> new FixtureChatModel(Reply.stopped(VALID));
            case "bad-total" -> new FixtureChatModel(Reply.stopped(BAD_TOTAL));
            case "repair" -> new FixtureChatModel(Reply.stopped(MALFORMED), Reply.stopped(VALID));
            case "failed-format" -> new FixtureChatModel(Reply.stopped(MALFORMED), Reply.stopped(MALFORMED));
            case "truncated" -> new FixtureChatModel(new Reply(VALID, "length"));
            default -> throw new IllegalArgumentException("Choose valid, bad-total, repair, failed-format or truncated");
        };
    }
}
