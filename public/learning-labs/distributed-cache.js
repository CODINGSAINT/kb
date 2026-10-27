"use strict";

(() => {
  const byId=id => document.getElementById(id);
  const themeButton=byId("theme");
  let savedTheme;
  try { savedTheme=localStorage.getItem("kb-theme"); } catch (_) { /* Use system preference. */ }
  const preferred=window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme=theme => {
    document.documentElement.dataset.theme=theme;
    themeButton.textContent=theme === "dark" ? "Light theme" : "Dark theme";
    themeButton.setAttribute("aria-label",`Switch to ${theme === "dark" ? "light" : "dark"} theme`);
  };
  const resolveTheme=() => savedTheme === "light" || savedTheme === "dark" ? savedTheme : preferred.matches ? "dark" : "light";
  applyTheme(resolveTheme());
  themeButton.addEventListener("click",() => {
    savedTheme=document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(savedTheme);
    try { localStorage.setItem("kb-theme",savedTheme); } catch (_) { /* The current tab still changes. */ }
  });
  preferred.addEventListener("change",() => {
    if (savedTheme !== "light" && savedTheme !== "dark") applyTheme(resolveTheme());
  });
  window.addEventListener("storage",event => {
    if (event.key === "kb-theme") { savedTheme=event.newValue; applyTheme(resolveTheme()); }
  });

  let scenarios=[];
  let scenarioIndex=0;
  let stepIndex=0;
  const select=byId("scenario");
  const previous=byId("previous");
  const next=byId("next");
  const p=(text,className) => {
    const result=document.createElement("p"); result.textContent=text;
    if (className) result.className=className;
    return result;
  };
  const slotText=slot => `${slot.key}: slot ${slot.slotId}, generation ${slot.generation}, minimum version ${slot.minimumVersion}, ${slot.cachedVersion ? `cached version ${slot.cachedVersion}, ${slot.remainingMillis} ms remaining` : "no cached value"}`;
  function renderSlots(slots) {
    if (slots.length === 0) { byId("slots").replaceChildren(p("No slots retained.")); return; }
    const list=document.createElement("ol"); list.className="slot-list";
    for (const slot of slots) {
      const item=document.createElement("li");
      const key=document.createElement("code"); key.textContent=slot.key;
      item.append(key,p(`Slot ${slot.slotId} · generation ${slot.generation} · floor v${slot.minimumVersion}`),
        p(slot.cachedVersion ? `Cached v${slot.cachedVersion} · ${slot.remainingMillis} ms remaining` : "Metadata only · no cached value"));
      list.append(item);
    }
    byId("slots").replaceChildren(list);
  }
  function render() {
    const scenario=scenarios[scenarioIndex];
    const step=scenario.steps[stepIndex];
    byId("description").textContent=scenario.description;
    byId("time").textContent=`t=${step.millis} ms`;
    byId("step-title").textContent=step.title;
    renderSlots(step.slots);
    byId("slot-count").textContent=`${step.slots.length} / ${scenario.maxSlots} metadata slots`;
    byId("slot-meter").max=scenario.maxSlots; byId("slot-meter").value=step.slots.length;
    byId("byte-count").textContent=`${step.payloadBytes} / ${scenario.maxPayloadBytes} payload bytes`;
    byId("byte-meter").max=scenario.maxPayloadBytes; byId("byte-meter").value=step.payloadBytes;
    byId("evictions").textContent=`Retired by eviction: ${step.evictions}`;
    byId("result").textContent=step.result;
    byId("note").textContent=step.note;
    for (const key of ["slots","capacity","decision"])
      byId(`${key}-card`).dataset.focused=String(step.focus === key);
    byId("progress").textContent=`${stepIndex+1} / ${scenario.steps.length}`;
    previous.disabled=stepIndex === 0;
    next.disabled=stepIndex === scenario.steps.length-1;
    byId("timeline").replaceChildren(...scenario.steps.map((entry,index) => {
      const item=document.createElement("li"); item.textContent=`Step ${index+1}`;
      const time=document.createElement("span"); time.textContent=`${entry.millis} ms`; item.append(time);
      if (index === stepIndex) item.setAttribute("aria-current","step");
      return item;
    }));
  }
  function transcript() {
    byId("transcript").replaceChildren(...scenarios.map(scenario => {
      const section=document.createElement("section");
      const heading=document.createElement("h3"); heading.textContent=scenario.title;
      const list=document.createElement("ol");
      for (const step of scenario.steps) {
        const item=document.createElement("li");
        const title=document.createElement("strong"); title.textContent=`${step.millis} ms — ${step.title}`;
        item.append(title,p(`Result: ${step.result}. Slots: ${step.slots.length}/${scenario.maxSlots}. Payload: ${step.payloadBytes}/${scenario.maxPayloadBytes} B.`,"recorded-state"),
          p(step.slots.map(slotText).join("; ") || "No retained slots.","recorded-state"),p(step.note));
        list.append(item);
      }
      section.append(heading,list); return section;
    }));
  }
  select.addEventListener("change",() => { scenarioIndex=select.selectedIndex; stepIndex=0; render(); });
  previous.addEventListener("click",() => { if (stepIndex>0) { stepIndex--; render(); } });
  next.addEventListener("click",() => { if (stepIndex<scenarios[scenarioIndex].steps.length-1) { stepIndex++; render(); } });
  byId("reset").addEventListener("click",() => { stepIndex=0; render(); });

  fetch("distributed-cache-traces.json")
    .then(response => { if (!response.ok) throw new Error("Trace unavailable"); return response.json(); })
    .then(data => {
      if (!Array.isArray(data.scenarios) || data.scenarios.length === 0 ||
          data.scenarios.some(scenario => !Array.isArray(scenario.steps) || scenario.steps.length === 0))
        throw new Error("Trace invalid");
      scenarios=data.scenarios;
      select.replaceChildren(...scenarios.map(scenario => new Option(scenario.title,scenario.id)));
      transcript(); render();
      byId("interactive").hidden=false; byId("fallback").hidden=true;
    })
    .catch(() => { byId("error").hidden=false; });
})();
