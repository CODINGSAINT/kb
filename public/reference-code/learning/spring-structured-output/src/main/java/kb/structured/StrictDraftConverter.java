// BEGIN complete
package kb.structured;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.type.LogicalType;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.util.Map;
import org.springframework.ai.converter.BeanOutputConverter;

/** Strict application policy, rather than the default converter's lenient cleanup. */
public final class StrictDraftConverter extends BeanOutputConverter<ExpenseDraft> {
    public StrictDraftConverter() {
        super(ExpenseDraft.class, mapper(), text -> text);
    }

    private static ObjectMapper mapper() {
        var factory = JsonFactory.builder()
                .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(8)
                        .maxNumberLength(32).maxStringLength(1024).build())
                .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
        var mapper = JsonMapper.builder(factory).addModule(new JavaTimeModule())
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                        DeserializationFeature.FAIL_ON_TRAILING_TOKENS,
                        DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
                        DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS).build();
        for (var shape : new CoercionInputShape[]{CoercionInputShape.Integer,
                CoercionInputShape.Float, CoercionInputShape.Boolean}) {
            mapper.coercionConfigFor(LogicalType.Textual).setCoercion(shape, CoercionAction.Fail);
        }
        return mapper;
    }

    @Override
    protected void postProcessSchema(JsonNode schema) {
        var properties = (ObjectNode) schema.get("properties");
        // Required key and nullable value are separate choices.
        var nullable = Map.of("merchant", "string", "quantity", "integer", "unitPrice", "number",
                "total", "number", "purchaseDate", "string", "evidenceQuote", "string");
        nullable.forEach((name, type) -> ((ObjectNode) properties.get(name))
                .putArray("type").add(type).add("null"));
        ((ObjectNode) properties.get("purchaseDate")).put("format", "date");
        ((ObjectNode) properties.get("schemaVersion")).put("const", 1);
    }
}
// END complete
