async (page) => {
 const base='http://127.0.0.1:8790',out=[];
 await page.emulateMedia({reducedMotion:'reduce'});
 const articles=[['LLD-4',4,0],['LLD-5',5,0],['LLD-9',9,0],['LLD-16',16,0],['HLD-1',1,1],['HLD-2',2,1],['HLD-3',3,1],['HLD-4',4,1],['AI-1',1,2],['AI-6',6,2],['AI-7',7,2],['AI-8',8,2]];
 async function closeMobileMenu(){
  const covered=await page.evaluate(()=>{const s=document.querySelector('#sidebar');return innerWidth<800&&s&&getComputedStyle(s).position==='fixed'&&s.getBoundingClientRect().right>10;});
  if(covered){await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<2);}
 }
 async function layout(scope){return page.evaluate(selector=>{
  const w=document.querySelector(selector);const bg=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255,255,255)';};
  const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
  const cells=[...w.querySelectorAll('td,th')];return {minTableContrast:cells.length?Math.min(...cells.map(e=>{const a=lum(getComputedStyle(e).color),b=lum(bg(e));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);})):null,brokenImages:[...w.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),overflow:document.documentElement.scrollWidth>innerWidth+1};
 },scope);}
 async function verify(scope){const m=await layout(scope);if(m.overflow||m.brokenImages.length||(m.minTableContrast!=null&&m.minTableContrast<4.5))throw Error(JSON.stringify(m));return m;}
 async function labTheme(theme){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme').click();
  if(await page.locator('html').getAttribute('data-theme')!==theme)throw Error('Theme control did not change the walkthrough');
 }
 for(const [topic,day,index] of articles){
  await page.setViewportSize({width:1280,height:900});
  await page.goto(`${base}/#/t/${day}/${index}`);await page.locator('#refZone').waitFor();
  if(await page.locator('#refAsk').count()){await page.locator('#refAsk').click();await page.locator('#refYes').click();}
  await page.locator('#writeup h2').first().waitFor();await page.locator('#writeup img').evaluateAll(async imgs=>{await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));});
  for(const theme of ['light','dark'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await closeMobileMenu();if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#themeToggle').click();
   const metrics=await verify('#writeup');await page.locator('[data-reference-section="2"]').click();
   await page.waitForFunction(()=>{const r=document.querySelectorAll('#writeup h2')[2].getBoundingClientRect();return r.top>=0&&r.top<240;});
   if(!page.url().endsWith(`/#/t/${day}/${index}`))throw Error(topic+' contents changed route');
   await page.screenshot({path:`.qa-campaign/${topic}-article-${theme}-${width}.png`});out.push({topic,page:'article',theme,width,contentsJump:true,...metrics});
  }
 }
 const traces=[
  ['LLD-5','atm','prev','state'],['LLD-9','library','prev','copy-state'],['LLD-16','tictactoe','prev','decision'],
  ['HLD-1','shortener','previous','response'],['HLD-3','distributed-cache','previous','result'],['HLD-4','notification','previous',null]
 ];
 for(const [topic,name,previous,state] of traces){
  await page.goto(`${base}/learning-labs/${name}.html`);await page.locator('#scenario:not([disabled])').waitFor();
  const cases=await page.locator('#scenario option').evaluateAll(opts=>opts.map(o=>o.value).filter(v=>v!=='free'));
  for(const theme of ['light','dark'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await labTheme(theme);
   for(const value of cases){await page.locator('#scenario').selectOption(value);let steps=0;while(!await page.locator('#next').isDisabled()){if(++steps>30)throw Error(name+' did not finish');await page.locator('#next').click();}
    if(await page.locator('#error:visible').count())throw Error(name+' trace error');
    if(state&&!await page.locator('#'+state).innerText())throw Error(name+' empty result');
    if(name==='tictactoe'&&await page.locator('#decision').innerText()!=='GAME_OVER')throw Error('Terminal game changed');
    if(name==='shortener'&&!await page.locator('#response').innerText().then(t=>t.includes('410')))throw Error('Revoked/expired URL redirected past deadline');
    await page.locator('#reset').click();if(!await page.locator('#'+previous).isDisabled())throw Error(name+' reset failed');
   }
   if(name==='tictactoe'){
    await page.locator('#scenario').selectOption('free');await page.locator('#board button').nth(0).click();await page.locator('#board button').nth(0).click();
    if(await page.locator('#decision').innerText()!=='OCCUPIED'||await page.locator('#version').innerText()!=='1')throw Error('Invalid click lost a turn');
    await page.locator('#stale').check();await page.locator('#board button').nth(1).click();if(await page.locator('#decision').innerText()!=='STALE_VERSION')throw Error('Stale move accepted');
    await page.locator('#stale').uncheck();await page.locator('#scenario').selectOption(cases[0]);
   }
   const metrics=await verify('main');await page.screenshot({path:`.qa-campaign/${topic}-lab-${theme}-${width}.png`,fullPage:true});out.push({topic,page:'walkthrough',theme,width,cases:cases.length,controls:true,...metrics});
  }
 }
 for(const [topic,name] of [['LLD-4','booking'],['HLD-2','ratelimit'],['AI-7','chatclient']]){
  await page.goto(`${base}/learning-labs/index.html?topic=${name}`);await page.locator('#scenario option').first().waitFor({state:'attached'});const cases=await page.locator('#scenario option').count();
  for(const theme of ['light','dark'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await labTheme(theme);
   for(let i=0;i<cases;i++){await page.locator('#scenario').selectOption(String(i));let n=0;while(!await page.locator('#next').isDisabled()){if(++n>30)throw Error('Unbounded trace');await page.locator('#next').click();}}
   if(name==='booking'&&!await page.locator('#step').innerText().then(t=>t.includes('Pending refund intents: 1')))throw Error('Late capture refund missing');
   if(name==='ratelimit'&&!await page.locator('.value').innerText().then(t=>t.includes('4 / 5')))throw Error('Bucket balance incorrect');
   if(name==='chatclient'&&!await page.locator('#step').innerText().then(t=>t.includes('Conversion fails')))throw Error('Malformed output accepted');
   const metrics=await verify('main');await page.screenshot({path:`.qa-campaign/${topic}-lab-${theme}-${width}.png`,fullPage:true});out.push({topic,page:'walkthrough',theme,width,cases,controls:true,...metrics});
  }
 }
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.goto(base+'/learning-labs/ai-fundamentals.html');await page.setViewportSize({width,height:900});await labTheme(theme);
  await page.locator('#temperature').evaluate(e=>{e.value='0.5';e.dispatchEvent(new Event('input',{bubbles:true}));});if(!await page.locator('#prob-no').innerText().then(t=>t.includes('78.261')))throw Error('Toy softmax arithmetic');
  await page.locator('#fixture').selectOption('yes-leads');await page.locator('#temperature').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});if(!await page.locator('#leader').innerText().then(t=>t.includes('YES')))throw Error('Toy wrong leader not shown');
  await page.locator('#draw-one').click();await page.locator('#clear').click();const m=await verify('main');await page.screenshot({path:`.qa-campaign/AI-1-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-1',page:'walkthrough',theme,width,arithmetic:true,...m});
  await page.goto(base+'/learning-labs/spring-fundamentals.html');await labTheme(theme);
  for(const profile of ['offline','ollama']){await page.locator('#profile').selectOption(profile);for(let i=0;i<5;i++)await page.locator('#next').click();if(!await page.locator('#next').isDisabled())throw Error('Wiring sequence incomplete');await page.locator('#reset').click();}
  const s=await verify('main');await page.screenshot({path:`.qa-campaign/AI-6-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-6',page:'walkthrough',theme,width,profiles:2,...s});
 }
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.goto(base+'/learning-labs/structured-output.html');await page.locator('#scenario:not([disabled])').waitFor();await page.setViewportSize({width,height:900});await labTheme(theme);
  for(const value of ['good','bad-total','extra','repair','wrong-facts']){await page.locator('#scenario').selectOption(value);let n=0;while(!await page.locator('#next').isDisabled()){if(++n>12)throw Error('Structured pipeline unbounded');await page.locator('#next').click();}if(!await page.locator('#note').innerText())throw Error('Missing pipeline outcome');await page.locator('#reset').click();}
  const m=await verify('main');await page.screenshot({path:`.qa-campaign/AI-8-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-8',page:'walkthrough',theme,width,cases:5,...m});
 }
 return out;
}
