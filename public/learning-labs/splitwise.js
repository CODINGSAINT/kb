(() => {
  const $=id=>document.getElementById(id),names={A:'Asha',B:'Ben',C:'Cara'},positions={A:[300,65],B:[105,250],C:[495,250]};
  let theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  try{const saved=localStorage.getItem('kb-theme');if(['light','dark'].includes(saved))theme=saved;}catch{}
  function showTheme(){document.documentElement.dataset.theme=theme;$('theme').textContent=theme==='dark'?'Use light theme':'Use dark theme';$('theme').setAttribute('aria-pressed',String(theme==='dark'));}
  showTheme();$('theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';try{localStorage.setItem('kb-theme',theme);}catch{}showTheme();});
  const money=paise=>(paise<0?'−':'')+'₹'+(Math.abs(paise)/100).toFixed(2);
  function element(tag,text,parent){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
  function svg(tag,attributes,text,parent){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attributes))e.setAttribute(k,v);if(text!=null)e.textContent=text;parent.append(e);return e;}
  let cases=[],selected=0,position=0;
  function render(){
    const scenario=cases[selected],step=scenario.steps[position],prior=position?scenario.steps[position-1]:null;
    $('position').textContent=`Step ${position+1} of ${scenario.steps.length}`;$('title').textContent=step.title;$('note').textContent=step.note;
    $('journal').textContent=`${step.entries} posted journal entries · revision ${step.revision}. Pending reports do not post money.`;
    $('balances').replaceChildren();$('nodes').replaceChildren();$('edges').replaceChildren();$('payments').replaceChildren();
    for(const id of ['A','B','C']){
      const tr=document.createElement('tr');const label=element('th',names[id],tr);label.scope='row';
      for(const n of [prior?prior.balances[id]:null,prior?step.balances[id]-prior.balances[id]:null,step.balances[id]]){const td=element('td',n===null?'—':money(n),tr);if(n<0)td.className='negative';}
      $('balances').append(tr);const [x,y]=positions[id];
      svg('rect',{x:x-89,y:y-42,width:178,height:84,rx:15,class:'node'},null,$('nodes'));
      svg('text',{x,y:y-8,'text-anchor':'middle',class:'name'},names[id],$('nodes'));
      const amount=step.balances[id];svg('text',{x,y:y+22,'text-anchor':'middle',class:'amount'},amount===0?'Settled':(amount<0?'Owes ':'Is owed ')+money(Math.abs(amount)),$('nodes'));
    }
    for(const t of step.transfers){
      const [x1,y1]=positions[t.from],[x2,y2]=positions[t.to],dx=x2-x1,dy=y2-y1,d=Math.hypot(dx,dy),ux=dx/d,uy=dy/d;
      svg('line',{x1:x1+ux*85,y1:y1+uy*65,x2:x2-ux*93,y2:y2-uy*68,class:'edge','marker-end':'url(#arrow)'},null,$('edges'));
      svg('text',{x:(x1+x2)/2-uy*13,y:(y1+y2)/2+ux*13,'text-anchor':'middle',class:'label'},money(t.amount),$('edges'));
    }
    $('suggestions').textContent=step.transfers.length?'Suggestions: '+step.transfers.map(t=>`${names[t.from]} → ${names[t.to]} ${money(t.amount)}`).join('; ')+'.':'No payment is suggested: everyone is settled.';
    for(const p of step.payments)element('li',`${p.id}: ${names[p.from]} → ${names[p.to]} ${money(p.amount)} · ${p.state==='CONFIRMED'?'receiver confirmed':'awaiting receiver confirmation'}`,$('payments'));
    $('graph-desc').textContent=$('suggestions').textContent+' '+['A','B','C'].map(id=>names[id]+' '+money(step.balances[id])).join('; ');
    $('prev').disabled=position===0;$('next').disabled=position===scenario.steps.length-1;$('reset').disabled=false;
  }
  function choose(){selected=Number($('scenario').value);position=0;$('transcript').replaceChildren();for(const s of cases[selected].steps)element('li',s.title+'. '+s.note+' Balances: '+['A','B','C'].map(id=>`${names[id]} ${money(s.balances[id])}`).join('; ')+'.',$('transcript'));render();}
  $('prev').addEventListener('click',()=>{if(position>0){position--;render();}});$('next').addEventListener('click',()=>{if(position<cases[selected].steps.length-1){position++;render();}});$('reset').addEventListener('click',()=>{position=0;render();});$('scenario').addEventListener('change',choose);
  fetch('splitwise-traces.json').then(r=>{if(!r.ok)throw Error('History could not be loaded');return r.json();}).then(data=>{cases=data.scenarios;if(!Array.isArray(cases)||!cases.length||cases.some(c=>!Array.isArray(c.steps)||!c.steps.length))throw Error('No histories');$('scenario').replaceChildren();cases.forEach((c,i)=>{const option=element('option',c.label,$('scenario'));option.value=String(i);});$('scenario').disabled=false;choose();$('fallback').hidden=true;}).catch(error=>{$('fallback').hidden=false;$('error').hidden=false;$('error').textContent=error.message+'. Run the KB from its local server to load recorded data.';});
})();
