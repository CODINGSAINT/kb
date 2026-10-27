(() => {
  "use strict";
  const get = id => document.getElementById(id);
  let index = 0;
  function steps() {
    const live = get("profile").value === "ollama";
    return [
      ["Read configuration", live
        ? "The explicit ollama profile overrides the default chat selector. The application requires a nonblank OLLAMA_CHAT_MODEL. Embeddings and automatic model pulling remain disabled."
        : "The default disables matching provider chat/embedding auto-configuration. Our own explicit fixture bean remains available.",
        live ? "spring.profiles.active=ollama\nspring.ai.model.chat=ollama\nspring.ai.ollama.chat.options.model=${OLLAMA_CHAT_MODEL}" : "spring.ai.model.chat=none\nspring.ai.model.embedding=none"],
      ["Select one ChatModel", live
        ? "The fixture's !ollama profile condition does not match. Conditional provider auto-configuration supplies OllamaChatModel. An installed backend/model is still a separate prerequisite."
        : "The !ollama condition matches. FundamentalsApplication supplies a fixed FixtureChatModel. This object is not an LLM and makes no provider request.",
        live ? "ChatModel -> OllamaChatModel\npull-model-strategy=never" : "ChatModel -> FixtureChatModel\nfixed labelled answer"],
      ["Inject the builder and service", "Spring AI supplies a prototype ChatClient.Builder around the selected model. Constructor injection gives it to ExplanationService, which builds one client. The controller receives that service. No question has been asked yet.",
        "ChatModel -> ChatClient.Builder -> ExplanationService -> controller"],
      ["Check the HTTP question", "The MVC controller reads the question JSON. The service rejects null, blank or over-1000-UTF-16-code-unit text before model work. This string-size guard is not token accounting.",
        "POST /api/explain\n{\"question\":\"What is dependency injection?\"}"],
      ["Consume a fresh request", live
        ? "A fresh user message accompanies the default system instruction. Consuming call().content() is where the application would invoke the configured adapter and backend. This walkthrough performs no request."
        : "A fresh user message accompanies the default system instruction. Consuming call().content() invokes the fixed fixture in the Java app. This walkthrough itself performs no request.",
        "client.prompt().user(question).call().content()"],
      ["Check and return the result", "The service rejects absent or blank text. The controller returns answer JSON on success, INVALID_QUESTION with HTTP 400 for bad input, or a fixed MODEL_FAILURE body with HTTP 502 for model failure. Successful transport does not establish answer correctness.",
        "success -> {answer: ...}\nbad question -> 400\nmodel failure / no answer -> 502"]
    ];
  }
  function render(rebuildTranscript = false) {
    const path = steps();
    get("model").textContent = get("profile").value === "ollama" ? "OllamaChatModel" : "FixtureChatModel";
    get("stage-title").textContent = path[index][0];
    get("detail").textContent = path[index][1];
    get("config").textContent = path[index][2];
    Array.from(get("journey").children).forEach((item, position) => {
      if (position === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    get("prev").disabled = index === 0;
    get("next").disabled = index === path.length - 1;
    get("reset").disabled = false;
    get("progress").textContent = `Step ${index + 1} of ${path.length}: ${path[index][0]}.`;
    if (rebuildTranscript) {
      get("transcript").replaceChildren();
      path.forEach(step => {
        const item = document.createElement("li");
        item.textContent = `${step[0]}. ${step[1]}`;
        get("transcript").append(item);
      });
    }
  }
  get("profile").disabled = false;
  get("profile").addEventListener("change", () => { index = 0; render(true); });
  get("prev").addEventListener("click", () => { index = Math.max(0, index - 1); render(); });
  get("next").addEventListener("click", () => { index = Math.min(steps().length - 1, index + 1); render(); });
  get("reset").addEventListener("click", () => { index = 0; render(); });
  let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  try { const stored = localStorage.getItem("kb-theme"); if (stored === "light" || stored === "dark") theme = stored; } catch (_) { }
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    get("theme").textContent = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }
  get("theme").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("kb-theme", theme); } catch (_) { }
    applyTheme();
  });
  applyTheme();
  render(true);
})();
