async (page) => {
 const base='http://127.0.0.1:8790',out=[];
 await page.emulateMedia({reducedMotion:'reduce'});
 const articles=[['LLD-6',6,0],['LLD-10',10,0],['AI-2',2,2],['AI-3',3,2]];
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

 for(const [topic,name] of [['LLD-6','rental'],['LLD-10','splitwise']]){
  await page.goto(`${base}/learning-labs/${name}.html`);await page.locator('#scenario:not([disabled])').waitFor();
  const cases=await page.locator('#scenario option').evaluateAll(opts=>opts.map(o=>o.value));
  if(cases.length!==3)throw Error(name+' expected three histories');
  for(const theme of ['light','dark'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await labTheme(theme);
   for(const value of cases){await page.locator('#scenario').selectOption(value);let steps=0;
    if(name==='splitwise'&&value==='0'){
     await page.locator('#next').click();if(!await page.locator('#balances tr').first().innerText().then(s=>s.includes('66.67')))throw Error('Taxi rounding');
     await page.locator('#next').click();const before=await page.locator('#balances tr td:last-child').allTextContents();await page.locator('#next').click();
     if(JSON.stringify(before)!==JSON.stringify(await page.locator('#balances tr td:last-child').allTextContents()))throw Error('Proposal changed balances');
     if(!await page.locator('#payments').innerText().then(s=>s.includes('awaiting receiver')))throw Error('Proposal state missing');steps=3;
    }
    while(!await page.locator('#next').isDisabled()){if(++steps>25)throw Error(name+' unbounded history');await page.locator('#next').click();}
    if(await page.locator('#error').isVisible())throw Error(name+' trace load failed');
    if(name==='splitwise'&&value==='2'&&!await page.locator('#suggestions').innerText().then(s=>s.includes('Asha → Ben ₹45.00')))throw Error('Correction erased the received payment');
    await page.locator('#reset').click();if(!await page.locator('#prev').isDisabled())throw Error(name+' reset failed');
   }
   const m=await verify('main');await page.screenshot({path:`.qa-campaign/${topic}-lab-${theme}-${width}.png`,fullPage:true});out.push({topic,page:'walkthrough',theme,width,cases:3,controls:true,...m});
  }
 }
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.goto(base+'/learning-labs/prompt-engineering.html');await page.setViewportSize({width,height:900});await labTheme(theme);
  for(const report of ['ordinary','hostile'])for(const example of [false,true]){
   await page.locator('#report').selectOption(report);await page.locator('#example').setChecked(example);
   const messages=JSON.parse(await page.locator('#messages').innerText()),card=JSON.parse(await page.locator('#card').innerText());
   if(messages.length!==(example?4:2)||messages[0].role!=='SYSTEM'||messages.at(-1).role!=='USER')throw Error('Message roles changed');
   if(card.cause!==null||card.prevention!==null)throw Error('Unknown fact invented');
   if(report==='hostile'&&!messages.at(-1).text.includes('reveal credentials'))throw Error('Hostile data absent');
  }
  const p=await verify('main');await page.screenshot({path:`.qa-campaign/AI-2-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-2',page:'walkthrough',theme,width,cases:4,controls:true,...p});
  await page.goto(base+'/learning-labs/llm-parameters.html');await labTheme(theme);await page.locator('#reset').click();
  if(!await page.locator('#rows tr').first().innerText().then(s=>s.includes('66.667%')))throw Error('Default nucleus normalization');
  await page.locator('#temperature').focus();await page.locator('#temperature').press('Home');for(let i=0;i<5;i++)await page.locator('#temperature').press('ArrowRight');
  if(!await page.locator('#rows tr').first().innerText().then(s=>s.includes('100.000%')))throw Error('Sharpened nucleus');
  await page.locator('#top-p').focus();await page.locator('#top-p').press('End');
  if(!await page.locator('#status').innerText().then(s=>s.includes('Retain 4')))throw Error('Full nucleus did not retain all candidates');
  await page.locator('#reset').click();const m=await verify('main');await page.screenshot({path:`.qa-campaign/AI-3-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-3',page:'walkthrough',theme,width,arithmetic:true,keyboardSliders:true,...m});
 }
 return out;
}
