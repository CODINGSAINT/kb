package kb.structured;

import com.fasterxml.jackson.databind.json.JsonMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import static kb.structured.FixtureChatModel.Reply;
import static kb.structured.ReceiptExtractor.*;

class StructuredOutputTest {
    private static final Source SOURCE = new Source("R17", DemoData.SOURCE);
    private static Result run(FixtureChatModel model) {
        return new ReceiptExtractor(ChatClient.create(model)).extract(SOURCE);
    }

    @Test
    void generatedSchemaSeparatesRequiredKeysFromNullableFacts() throws Exception {
        var schema = new JsonMapper().readTree(new StrictDraftConverter().getJsonSchema());
        assertEquals(10, schema.get("required").size());
        assertFalse(schema.get("additionalProperties").asBoolean());
        assertEquals(1, schema.get("properties").get("schemaVersion").get("const").asInt());
        assertTrue(schema.get("properties").get("purchaseDate").get("type").toString().contains("null"));
        assertEquals("date", schema.get("properties").get("purchaseDate").get("format").asText());
    }

    @Test
    void strictConversionKeepsExactNumbersAndExplicitUnknownDate() {
        ExpenseDraft draft = new StrictDraftConverter().convert(DemoData.VALID);
        assertEquals(new BigDecimal("199.50"), draft.unitPrice());
        assertEquals(new BigDecimal("598.50"), draft.total());
        assertNull(draft.purchaseDate());
        String dated = DemoData.VALID.replace("\"purchaseDate\": null", "\"purchaseDate\": \"2026-10-25\"");
        assertEquals(java.time.LocalDate.of(2026, 10, 25), new StrictDraftConverter().convert(dated).purchaseDate());
    }

    @Test
    void strictShapeRejectsDriftCoercionDuplicateKeysAndTrailingDocuments() {
        List<String> invalid = List.of(
                DemoData.VALID.replace("\"schemaVersion\": 1,", "\"schemaVersion\": 1, \"approved\": true,"),
                DemoData.VALID.replace("\"OFFICE\"", "\"FOOD\""),
                DemoData.VALID.replace("\"currency\": \"INR\"", "\"currency\": 0"),
                DemoData.VALID.replace("\"quantity\": 3", "\"quantity\": \"3\""),
                DemoData.VALID.replace("\"quantity\": 3", "\"quantity\": 3.5"),
                DemoData.VALID.replace("\"merchant\": \"Desk Supply Co.\"", "\"merchant\": 123"),
                DemoData.VALID.replace("\"unitPrice\": 199.50", "\"unitPrice\": \"199.50\""),
                DemoData.VALID.replace("\"total\": 598.50", "\"total\": 598.50, \"total\": 1.00"),
                DemoData.VALID.replace("\"purchaseDate\": null,", ""),
                DemoData.VALID.replace("\"purchaseDate\": null", "\"purchaseDate\": \"2026-02-30\""),
                DemoData.VALID.replace("\"total\": 598.50", "\"total\": NaN"),
                DemoData.VALID + "{}", "```json\n" + DemoData.VALID + "```");
        for (String value : invalid) {
            assertThrows(RuntimeException.class, () -> new StrictDraftConverter().convert(value));
        }
    }

    @Test
    void validDraftHasOneCallAndNoInventedDate() {
        var model = DemoData.model("valid");
        Result result = run(model);
        assertEquals(Status.READY_FOR_REVIEW, result.status());
        assertEquals(1, result.calls()); assertEquals(1, model.calls());
        assertTrue(result.issues().isEmpty());
        assertNull(result.draft().purchaseDate());
        assertEquals(new BigDecimal("598.50"), result.draft().unitPrice()
                .multiply(BigDecimal.valueOf(result.draft().quantity())));
    }

    @Test
    void inconsistentAmountsGoToReviewWithoutAutomaticValueRepair() {
        var model = DemoData.model("bad-total");
        Result result = run(model);
        assertEquals(Status.NEEDS_INFORMATION, result.status());
        assertTrue(result.issues().contains("TOTAL_DOES_NOT_EQUAL_QUANTITY_TIMES_PRICE"));
        assertEquals(new BigDecimal("590.00"), result.draft().total());
        assertEquals(1, model.calls());
    }

    @Test
    void missingFactsAndUnsupportedEvidenceRemainVisible() {
        String missing = DemoData.VALID.replace("\"quantity\": 3", "\"quantity\": null")
                .replace("\"category\": \"OFFICE\"", "\"category\": \"UNKNOWN\"")
                .replace("Unit price INR 199.50; total INR 598.50.", "A quote absent from the source.");
        Result result = run(new FixtureChatModel(Reply.stopped(missing)));
        assertEquals(Status.NEEDS_INFORMATION, result.status());
        assertNull(result.draft().quantity());
        assertTrue(result.issues().containsAll(List.of("QUANTITY_MISSING_OR_OUT_OF_RANGE",
                "CATEGORY_UNKNOWN", "EVIDENCE_QUOTE_NOT_FOUND")));
        assertEquals(1, result.calls());
    }

    @Test
    void oneFormatRetryReusesOriginalSourceWithoutEchoingRejectedOutput() {
        var model = new FixtureChatModel(Reply.stopped("PRIVATE_INVALID_OUTPUT"), Reply.stopped(DemoData.VALID));
        Result result = run(model);
        assertEquals(Status.READY_FOR_REVIEW, result.status()); assertEquals(2, model.calls());
        // StringTemplate renders platform line endings; compare the complete source after CRLF normalization.
        String secondPrompt = model.prompts().get(1).getContents().replace("\r\n", "\n");
        assertTrue(secondPrompt.contains(DemoData.SOURCE.replace("\r\n", "\n")));
        assertFalse(model.prompts().get(1).getContents().contains("PRIVATE_INVALID_OUTPUT"));
    }

    @Test
    void failedFormatStopsAfterTwoCalls() {
        var model = new FixtureChatModel(Reply.stopped(DemoData.MALFORMED),
                Reply.stopped(DemoData.MALFORMED), Reply.stopped(DemoData.VALID));
        Result result = run(model);
        assertEquals(Status.FAILED, result.status()); assertEquals(2, model.calls());
        assertEquals(List.of("FORMAT_ERROR"), result.issues()); assertNull(result.draft());
    }

    @Test
    void outputLimitsAndKnownTruncationFailWithoutFormatRetry() {
        for (var pair : List.of(
                new Object[]{new FixtureChatModel(Reply.stopped("x".repeat(MAX_OUTPUT_UNITS + 1))), "OUTPUT_TOO_LARGE"},
                new Object[]{new FixtureChatModel(Reply.stopped("")), "EMPTY_OUTPUT"},
                new Object[]{DemoData.model("truncated"), "TRUNCATED_OUTPUT"},
                new Object[]{new FixtureChatModel(Reply.stopped("null")), "NOT_AN_OBJECT"})) {
            var model = (FixtureChatModel) pair[0];
            Result result = run(model);
            assertEquals(Status.FAILED, result.status());
            assertEquals(List.of(pair[1]), result.issues()); assertEquals(1, model.calls());
        }
        var model = DemoData.model("valid");
        Result input = new ReceiptExtractor(ChatClient.create(model))
                .extract(new Source("R17", "x".repeat(MAX_SOURCE_UNITS + 1)));
        assertEquals(List.of("SOURCE_TOO_LARGE"), input.issues()); assertEquals(0, model.calls());
    }

    @Test
    void versionAndSourceIdentityAreNotSilentlyChanged() {
        Result version = run(new FixtureChatModel(Reply.stopped(DemoData.VALID.replace("\"schemaVersion\": 1", "\"schemaVersion\": 2"))));
        assertEquals(List.of("UNSUPPORTED_SCHEMA_VERSION"), version.issues());
        Result source = run(new FixtureChatModel(Reply.stopped(DemoData.VALID.replace("\"R17\"", "\"R18\""))));
        assertEquals(List.of("SOURCE_ID_MISMATCH"), source.issues());
        assertEquals(1, version.calls()); assertEquals(1, source.calls());
    }

    @Test
    void extremeExponentIsRejectedBeforeMoneyArithmetic() {
        Result result = run(new FixtureChatModel(Reply.stopped(
                DemoData.VALID.replace("\"unitPrice\": 199.50", "\"unitPrice\": 1e100000000"))));
        assertEquals(Status.NEEDS_INFORMATION, result.status());
        assertTrue(result.issues().contains("UNIT_PRICE_MISSING_OR_INVALID"));
    }

    @Test
    void readyForReviewDoesNotClaimSourceTruth() {
        String wrongButConsistent = DemoData.VALID.replace("\"unitPrice\": 199.50", "\"unitPrice\": 1.00")
                .replace("\"total\": 598.50", "\"total\": 3.00");
        Result result = run(new FixtureChatModel(Reply.stopped(wrongButConsistent)));
        assertEquals(Status.READY_FOR_REVIEW, result.status());
        assertEquals(new BigDecimal("3.00"), result.draft().total());
        // The quote exists, but the extracted numeric fields contradict it. Human/source evaluation remains necessary.
    }

    @Test
    void entityAndResponseEntityUseTheActualPinnedConverterApis() {
        var model = new FixtureChatModel(Reply.stopped(DemoData.VALID), Reply.stopped(DemoData.VALID));
        var client = ChatClient.create(model);
        assertEquals(new BigDecimal("598.50"), ConvenienceApis.entity(client, SOURCE).total());
        var combined = ConvenienceApis.combined(client, SOURCE);
        assertEquals(new BigDecimal("598.50"), combined.entity().total());
        assertEquals("stop", combined.response().getResult().getMetadata().getFinishReason());
        assertEquals(2, model.calls()); // One invocation for each separate API demonstration.
    }

    @Test
    void wholeObjectBufferAcceptsOnlyNormalCompletionAndHonoursItsCap() {
        var buffer = new WholeObjectBuffer(MAX_OUTPUT_UNITS);
        int split = DemoData.VALID.length() / 2;
        buffer.append(DemoData.VALID.substring(0, split));
        buffer.append(DemoData.VALID.substring(split));
        assertEquals(new BigDecimal("598.50"), new StrictDraftConverter().convert(buffer.complete()).total());
        assertThrows(IllegalStateException.class, buffer::complete);
        var cancelled = new WholeObjectBuffer(MAX_OUTPUT_UNITS);
        cancelled.append(DemoData.VALID); cancelled.cancel();
        assertThrows(IllegalStateException.class, cancelled::complete);
        var limited = new WholeObjectBuffer(2); limited.append("{");
        assertThrows(IllegalStateException.class, () -> limited.append("123"));
        assertThrows(IllegalStateException.class, limited::complete);
    }

    @Test
    void bootConsoleExampleRunsWithOnlyTheScriptedFixture() {
        try (var context = new SpringApplicationBuilder(StructuredApplication.class)
                .web(WebApplicationType.NONE).run("--demo.case=repair")) {
            assertTrue(context.isActive());
        }
    }
}
