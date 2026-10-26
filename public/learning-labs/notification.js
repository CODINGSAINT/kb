"use strict";
(() => {
  const byId=id=>document.getElementById(id);
  let savedTheme;
  try { savedTheme=localStorage.getItem("kb-theme"); } catch (_) { /* Use system preference. */ }
  const systemTheme=window.matchMedia("(prefers-color-scheme: dark)");
  const resolveTheme=()=>savedTheme==="light"||savedTheme==="dark"?savedTheme:systemTheme.matches?"dark":"light";
  const applyTheme=()=>{
    const theme=resolveTheme(); document.documentElement.dataset.theme=theme;
    byId("theme").textContent=theme==="dark"?"Light theme":"Dark theme";
    byId("theme").setAttribute("aria-label",`Switch to ${theme==="dark"?"light":"dark"} theme`);
  };
  applyTheme();
  byId("theme").addEventListener("click",()=>{
    savedTheme=document.documentElement.dataset.theme==="dark"?"light":"dark"; applyTheme();
    try { localStorage.setItem("kb-theme",savedTheme); } catch (_) { /* This tab still changes. */ }
  });
  systemTheme.addEventListener("change",()=>{if(savedTheme!=="light"&&savedTheme!=="dark")applyTheme();});
  window.addEventListener("storage",event=>{if(event.key==="kb-theme"){savedTheme=event.newValue;applyTheme();}});
  let scenarios=[],scenarioIndex=0,stepIndex=0;
  const select=byId("scenario"),previous=byId("previous"),next=byId("next");
  const paragraph=(text,className)=>{const p=document.createElement("p");p.textContent=text;if(className)p.className=className;return p;};
  function render(){
    const scenario=scenarios[scenarioIndex],step=scenario.steps[stepIndex];
    byId("description").textContent=scenario.description;byId("time").textContent=`t=${step.millis} ms`;byId("step-title").textContent=step.title;
    for(const [id,value] of Object.entries({state:step.state,attempts:step.attempts,uncertain:step.uncertain?"Yes":"No",reason:step.reason,calls:step.providerCalls,acceptances:step.providerAcceptances,epoch:step.epoch,lease:`${step.leaseUntil} ms`,"next-at":`${step.nextAt} ms`,facts:step.observedAcceptances,"message-id":step.messageId||"Not recorded"}))byId(id).textContent=String(value);
    byId("note").textContent=`${step.result}. ${step.note}`;byId("progress").textContent=`${stepIndex+1} / ${scenario.steps.length}`;
    previous.disabled=stepIndex===0;next.disabled=stepIndex===scenario.steps.length-1;
    byId("timeline").replaceChildren(...scenario.steps.map((entry,index)=>{
      const li=document.createElement("li");li.textContent=`Step ${index+1}`;const time=document.createElement("span");time.textContent=`${entry.millis} ms`;li.append(time);if(index===stepIndex)li.setAttribute("aria-current","step");return li;
    }));
  }
  function transcript(){byId("transcript").replaceChildren(...scenarios.map(scenario=>{
    const section=document.createElement("section"),heading=document.createElement("h3"),list=document.createElement("ol");heading.textContent=scenario.title;
    for(const step of scenario.steps){const li=document.createElement("li"),title=document.createElement("strong");title.textContent=`${step.millis} ms — ${step.title}`;
      li.append(title,paragraph(`Local state ${step.state}; ${step.attempts} authorized attempts; epoch ${step.epoch}; uncertain=${step.uncertain}; retry due ${step.nextAt} ms; lease ends ${step.leaseUntil} ms.`,"recorded-state"),paragraph(`Fake provider: ${step.providerCalls} calls, ${step.providerAcceptances} acceptances. Local acceptance observations: ${step.observedAcceptances}. Recorded provider ID: ${step.messageId||"none"}.`,"recorded-state"),paragraph(`${step.result}. ${step.note}`));list.append(li);}
    section.append(heading,list);return section;
  }));}
  select.addEventListener("change",()=>{scenarioIndex=select.selectedIndex;stepIndex=0;render();});
  previous.addEventListener("click",()=>{if(stepIndex>0){stepIndex--;render();}});
  next.addEventListener("click",()=>{if(stepIndex<scenarios[scenarioIndex].steps.length-1){stepIndex++;render();}});
  byId("reset").addEventListener("click",()=>{stepIndex=0;render();});
  fetch("notification-traces.json").then(response=>{if(!response.ok)throw new Error("Trace unavailable");return response.json();}).then(data=>{
    if(!Array.isArray(data.scenarios)||data.scenarios.length===0||data.scenarios.some(scenario=>!Array.isArray(scenario.steps)||scenario.steps.length===0))throw new Error("Trace invalid");
    scenarios=data.scenarios;select.replaceChildren(...scenarios.map(scenario=>new Option(scenario.title,scenario.id)));transcript();render();byId("interactive").hidden=false;byId("fallback").hidden=true;
  }).catch(()=>{byId("error").hidden=false;});
})();
