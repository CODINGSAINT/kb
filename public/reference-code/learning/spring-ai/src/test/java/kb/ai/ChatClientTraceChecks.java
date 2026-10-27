package kb.ai;

import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.ai.chat.client.ChatClient;

/** Recorded walkthroughs from the actual pinned API. Saved under target, exported after successful checks. */
class ChatClientTraceChecks {
    static Map<String,Object> node(String label,String detail,boolean active){return Map.of("label",label,"detail",detail,"active",active);}
    static Map<String,Object> step(String title,String note,String active,int calls,int chunks) {
        return Map.of("title",title,"note",note,"nodes",List.of(
            node("Application","validates input and consumes output",active.equals("app")),
            node("ChatClient","builds prompt and invokes advisor chain",active.equals("client")),
            node("Offline ChatModel","fixture; no provider or network",active.equals("model"))),
            "facts",List.of("Model invocations: "+calls,"Visible stream chunks: "+chunks));
    }
    @Test void emitCheckedTraces() throws Exception {
        var p=new ChatClientChecks.Probe();ChatClient client=ChatClient.create(p);List<Map<String,Object>> one=new ArrayList<>();
        one.add(step("A question enters the application","Input validation happens before requesting model work.","app",p.calls.get(),0));
        var spec=client.prompt().user("Explain encapsulation").call();assertEquals(0,p.calls.get());
        one.add(step("The call specification is ready","In Spring AI 1.1.8 this construction has not invoked the model. The consuming terminal operation performs the work.","client",p.calls.get(),0));
        var response=spec.chatResponse();assertEquals(1,p.calls.get());
        one.add(step("Consume one ChatResponse","The advisor chain invokes the fixture model once. A real provider adapter would perform remote I/O here.","model",p.calls.get(),0));
        String text=response.getResult().getOutput().getText();int tokens=response.getMetadata().getUsage().getTotalTokens();assertEquals(20,tokens);
        one.add(step("Read text and usage from that same response","Text: "+text+" The fixture reports 20 tokens. Reading this object again does not invoke the model.","app",p.calls.get(),0));
        var streamProbe=new ChatClientChecks.Probe();var assistant=new StudyAssistant(streamProbe);List<Map<String,Object>> stream=new ArrayList<>();
        var flux=assistant.stream("Explain encapsulation");assertEquals(0,streamProbe.streams.get());
        stream.add(step("Construct a stream","The application has a publisher, but no one has subscribed. No model stream has started.","client",0,0));
        var chunks=flux.take(1).collectList().block();assertEquals(List.of("first "),chunks);assertEquals(1,streamProbe.cancellations.get());
        stream.add(step("Subscribe, receive one chunk, then cancel","The fixture stream started once. Its first chunk reached the caller. The caller then cancelled; cancellation reached the fixture.","model",streamProbe.streams.get(),chunks.size()));
        stream.add(step("Keep the answer incomplete","Partial text is not a completed answer. Local cancellation does not prove a remote provider stopped billing or generating.","app",streamProbe.streams.get(),chunks.size()));
        var bad=new ChatClientChecks.Probe();bad.text="not JSON";List<Map<String,Object>> malformed=new ArrayList<>();
        malformed.add(step("Ask for a study-card record","The application requests structured output. A format request is not a guarantee that a model will follow it.","client",0,0));
        assertThrows(RuntimeException.class,()->new StudyAssistant(bad).card("Explain classes"));
        malformed.add(step("The fixture returns invalid JSON","Conversion fails after one model invocation. The application must report a failed extraction rather than invent fields.","app",bad.calls.get(),0));
        Map<String,Object> lesson=Map.of("id","chatclient","kind","flow","title","Where does a ChatClient request actually run?","back","../#/t/7/2","description","Recorded Spring AI 1.1.8 executions with an offline fixture: one response, a cancelled stream and malformed structured output. No model credentials or paid calls.","scenarios",List.of(
            Map.of("id","one-response","title","One response, text and token usage","steps",one),Map.of("id","cancel","title","A stream that is cancelled","steps",stream),Map.of("id","malformed","title","Structured output fails","steps",malformed)));
        Path out=Path.of("target/chatclient-trace.json");Files.createDirectories(out.getParent());new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(out.toFile(),lesson);
    }
}
