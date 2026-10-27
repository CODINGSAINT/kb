"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const themeButton = byId("theme");
  let savedTheme;
  try { savedTheme = localStorage.getItem("kb-theme"); } catch (_) { /* System preference remains available. */ }
  const preferred = window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = theme => {
    document.documentElement.dataset.theme = theme;
    themeButton.textContent = theme === "dark" ? "Light theme" : "Dark theme";
    themeButton.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
  };
  applyTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : preferred.matches ? "dark" : "light");
  themeButton.addEventListener("click", () => {
    savedTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(savedTheme);
    try { localStorage.setItem("kb-theme", savedTheme); } catch (_) { /* This tab still changes theme. */ }
  });
  preferred.addEventListener("change", () => {
    if (savedTheme !== "light" && savedTheme !== "dark") applyTheme(preferred.matches ? "dark" : "light");
  });
  window.addEventListener("storage", event => {
    if (event.key === "kb-theme") {
      savedTheme = event.newValue;
      applyTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : preferred.matches ? "dark" : "light");
    }
  });

  let scenarios = [];
  let scenarioIndex = 0;
  let stepIndex = 0;
  const select = byId("scenario");
  const previous = byId("previous");
  const next = byId("next");
  const reset = byId("reset");
  const paragraph = (text, className) => {
    const p = document.createElement("p");
    p.textContent = text;
    if (className) p.className = className;
    return p;
  };
  function render() {
    const scenario = scenarios[scenarioIndex];
    const step = scenario.steps[stepIndex];
    byId("summary").textContent = scenario.summary;
    byId("time").textContent = step.time;
    byId("step-title").textContent = step.title;
    for (const key of ["authority", "cache", "response"]) {
      byId(key).textContent = step[key];
      byId(`${key}-card`).dataset.focused = String(step.focus === key);
    }
    byId("explanation").textContent = step.explanation;
    byId("progress").textContent = `${stepIndex + 1} / ${scenario.steps.length}`;
    previous.disabled = stepIndex === 0;
    next.disabled = stepIndex === scenario.steps.length - 1;
    byId("timeline").replaceChildren(...scenario.steps.map((entry, index) => {
      const li = document.createElement("li");
      li.textContent = `Step ${index + 1}`;
      const span = document.createElement("span");
      span.textContent = entry.time;
      li.append(span);
      if (index === stepIndex) li.setAttribute("aria-current", "step");
      return li;
    }));
  }
  function buildTranscript() {
    const sections = scenarios.map(scenario => {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = scenario.title;
      const list = document.createElement("ol");
      for (const step of scenario.steps) {
        const item = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = `${step.time} — ${step.title}`;
        item.append(strong,
          paragraph(`Authority: ${step.authority}. Cache: ${step.cache}. Decision: ${step.response}.`, "recorded-state"),
          paragraph(step.explanation));
        list.append(item);
      }
      section.append(heading, list);
      return section;
    });
    byId("transcript").replaceChildren(...sections);
  }
  select.addEventListener("change", () => { scenarioIndex = select.selectedIndex; stepIndex = 0; render(); });
  previous.addEventListener("click", () => { if (stepIndex > 0) { stepIndex--; render(); } });
  next.addEventListener("click", () => { if (stepIndex < scenarios[scenarioIndex].steps.length - 1) { stepIndex++; render(); } });
  reset.addEventListener("click", () => { stepIndex = 0; render(); });

  fetch("shortener-traces.json")
    .then(response => { if (!response.ok) throw new Error("Trace unavailable"); return response.json(); })
    .then(data => {
      if (!Array.isArray(data.scenarios) || data.scenarios.length === 0 ||
          data.scenarios.some(scenario => !Array.isArray(scenario.steps) || scenario.steps.length === 0))
        throw new Error("Trace invalid");
      scenarios = data.scenarios;
      select.replaceChildren(...scenarios.map(scenario => new Option(scenario.title, scenario.id)));
      buildTranscript();
      render();
      byId("interactive").hidden = false;
      byId("fallback").hidden = true;
    })
    .catch(() => { byId("error").hidden = false; });
})();
