/* A deterministic step player. All visible text uses textContent; no remote or model calls. */
(()=>{'use strict';
const $=s=>document.querySelector(s),root=document.documentElement;
let theme;try{theme=localStorage.getItem('kb-theme')||localStorage.getItem('kb-lab-theme');}catch{}
root.dataset.theme=theme|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
$('#theme').onclick=()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('kb-theme',root.dataset.theme);localStorage.setItem('kb-lab-theme',root.dataset.theme);}catch{}};
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
let lesson,selected=0,index=0;
function render(){
 const scenario=lesson.scenarios[selected],step=scenario.steps[index];$('#visual').replaceChildren();$('#step').replaceChildren();
 if(step.seats){
  $('#visual').append(element('div','SCREEN','screen'));const grid=element('div',null,'seats');
  for(const seat of step.seats){const tile=element('div',null,'seat');tile.dataset.state=seat.state;tile.append(element('b',seat.number),element('small',seat.state),element('small',seat.owner?'Customer '+seat.owner:'No owner'));grid.append(tile);}
  $('#visual').append(grid,element('p','AVAILABLE → HELD → CONFIRMED. State and owner are written on each seat.','legend'));
 }
 if(step.tokens!=null){
  const box=element('div',null,'bucket');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 150');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${step.tokens} of ${step.capacity} tokens available`);
  for(let n=0;n<step.capacity;n++){
   const fraction=Math.max(0,Math.min(1,step.tokens-n));
   const gradient=document.createElementNS(svg.namespaceURI,'linearGradient');gradient.id='token-'+n;
   for(const [offset,color] of [[0,'var(--accent)'],[fraction,'var(--accent)'],[fraction,'var(--available)'],[1,'var(--available)']]){const stop=document.createElementNS(svg.namespaceURI,'stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);gradient.append(stop);}
   const defs=document.createElementNS(svg.namespaceURI,'defs');defs.append(gradient);svg.append(defs);
   const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',40+n*64);circle.setAttribute('cy',75);circle.setAttribute('r',25);circle.setAttribute('fill',`url(#token-${n})`);circle.setAttribute('stroke','var(--line)');svg.append(circle);
  }
  box.append(svg,element('p',`${step.tokens} / ${step.capacity} tokens available`,'value'));$('#visual').append(box);
 }
 if(step.nodes){const flow=element('div',null,'flow');for(const node of step.nodes){const box=element('div',null,'node'+(node.active?' active':''));box.append(element('b',node.label),element('span',node.detail));flow.append(box);}$('#visual').append(flow);}
 if(step.clock)$('#step').append(element('p',step.clock,'clock'));
 $('#step').append(element('h2',step.title),element('p',step.note));
 if(step.facts?.length){const ul=element('ul',null,'facts');step.facts.forEach(f=>ul.append(element('li',f)));$('#step').append(ul);}
 $('#progress').textContent=`Step ${index+1} of ${scenario.steps.length}`;$('#prev').disabled=index===0;$('#next').disabled=index===scenario.steps.length-1;
}
$('#prev').onclick=()=>{if(index>0){index--;render();}};$('#next').onclick=()=>{if(index<lesson.scenarios[selected].steps.length-1){index++;render();}};
$('#reset').onclick=()=>{index=0;render();};
function trace(){const ol=$('#transcript');ol.replaceChildren();lesson.scenarios[selected].steps.forEach(s=>{const li=element('li');li.append(element('b',s.title),element('p',s.note));if(s.seats)li.append(element('p',s.seats.map(v=>`${v.number}: ${v.state}${v.owner?' / '+v.owner:''}`).join('; ')));if(s.tokens!=null)li.append(element('p',`${s.tokens} of ${s.capacity} tokens`));if(s.nodes)li.append(element('p',s.nodes.map(n=>n.label+': '+n.detail).join('; ')));ol.append(li);});}
$('#scenario').onchange=e=>{selected=Number(e.target.value);index=0;trace();render();};
const id=new URLSearchParams(location.search).get('topic')||'booking';
if(!/^[a-z0-9-]+$/.test(id))return;
fetch(`${id}.json`).then(r=>{if(!r.ok)throw Error('Walkthrough could not be loaded.');return r.json();}).then(data=>{
 lesson=data;document.title=data.title+' · CodingSaint KB';$('#title').textContent=data.title;$('#intro').textContent=data.description;$('#back').href=data.back;
 data.scenarios.forEach((s,i)=>{const o=element('option',s.title);o.value=i;$('#scenario').append(o);});trace();render();
}).catch(e=>{$('#error').hidden=false;$('#error').textContent=e.message;$('#title').textContent='Walkthrough unavailable';});
})();
