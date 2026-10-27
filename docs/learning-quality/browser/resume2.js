async (page) => {
 const base='http://127.0.0.1:8790',out=[];
 await page.emulateMedia({reducedMotion:'reduce'});
 const articles=[['HLD-5',5,1],['LLD-7',7,0],['AI-4',4,2],['LLD-10',10,0]];
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


 for(const [topic,name,previous] of [['HLD-5','news-feed','previous'],['LLD-7','cab','prev'],['LLD-10','splitwise','prev']]){
  await page.goto(`${base}/learning-labs/${name}.html`);await page.locator('#scenario option').first().waitFor({state:'attached'});if(name==='news-feed')await page.locator('#interactive').waitFor();else await page.locator('#scenario:not([disabled])').waitFor();
  const cases=await page.locator('#scenario option').evaluateAll(opts=>opts.map(o=>o.value));if(cases.length!==3)throw Error(name+' expected three cases');
  for(const theme of ['light','dark'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await labTheme(theme);let emptyContinuing=false;
   for(const value of cases){await page.locator('#scenario').selectOption(value);let n=0;
    if(name==='splitwise'&&await page.locator('#balances tr td').first().innerText()!=='—')throw Error('First frame invents a previous balance');
    while(!await page.locator('#next').isDisabled()){if(++n>30)throw Error('Unbounded history');await page.locator('#next').click();
     if(name==='news-feed'&&await page.locator('#returned').innerText()==='No items returned in this step'&&await page.locator('#more').innerText()==='Continuation available')emptyContinuing=true;
    }
    if(await page.locator('#error').isVisible())throw Error(name+' trace error');
    if(name==='splitwise'&&value==='2'&&!await page.locator('#suggestions').innerText().then(s=>s.includes('Asha → Ben ₹45.00')))throw Error('Correction erased cash history');
    await page.locator('#reset').click();if(!await page.locator('#'+previous).isDisabled())throw Error('Reset failed');
   }
   if(name==='news-feed'&&!emptyContinuing)throw Error('Empty continuing page not demonstrated');
   const m=await verify('main');await page.screenshot({path:`.qa-campaign/${topic}-lab-${theme}-${width}.png`,fullPage:true});out.push({topic,page:'walkthrough',theme,width,cases:3,controls:true,...m});
  }
 }
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.goto(base+'/learning-labs/semantic-search.html');await page.setViewportSize({width,height:900});await labTheme(theme);
  await page.locator('#actor').selectOption('student-a');await page.locator('#query').selectOption('recovery');await page.locator('#mode').selectOption('dense');
  let text=await page.locator('#hits').innerText();if(!text.includes('reset-2')||text.includes('staff-1')||text.includes('other-1'))throw Error('Scoped dense hits');
  await page.locator('#retire').check();if(await page.locator('#hits').innerText().then(s=>s.includes('reset-2')))throw Error('Retired revision returned');await page.locator('#retire').uncheck();
  await page.locator('#query').selectOption('code');await page.locator('#mode').selectOption('hybrid');if(!await page.locator('#hits tr').first().innerText().then(s=>s.includes('error-1')&&s.includes('0.032522')))throw Error('Hybrid normalization');
  await page.locator('#mismatch').check();if(await page.locator('#hits tr').count()!==0||!await page.locator('#status').innerText().then(s=>s.includes('Rejected')))throw Error('Incompatible embedding accepted');
  await page.locator('#mode').selectOption('lexical');if(!await page.locator('#hits').innerText().then(s=>s.includes('error-1')))throw Error('Lexical wrongly depends on query embedding');await page.locator('#mismatch').uncheck();
  await page.locator('#actor').selectOption('student-b');await page.locator('#query').selectOption('recovery');await page.locator('#mode').selectOption('dense');text=await page.locator('#hits').innerText();if(!text.includes('other-1')||text.includes('reset-2'))throw Error('Tenant boundary');
  await page.locator('#actor').selectOption('student-a');await page.locator('#query').selectOption('unmatched');if(await page.locator('#hits tr').count()!==0)throw Error('Unmatched fixture invented evidence');
  const m=await verify('main');await page.screenshot({path:`.qa-campaign/AI-4-lab-${theme}-${width}.png`,fullPage:true});out.push({topic:'AI-4',page:'walkthrough',theme,width,policyAndGeometry:true,controls:true,...m});
 }
 const fallback=await page.context().newPage();await fallback.setViewportSize({width:390,height:900});
 try{
  await fallback.route('**/splitwise.js',route=>route.abort());await fallback.goto(base+'/learning-labs/splitwise.html');
  if(!await fallback.locator('#fallback').isVisible()||await fallback.locator('#fallback li').count()!==19)throw Error('Static no-script fallback absent');
  await fallback.unroute('**/splitwise.js');await fallback.route('**/splitwise-traces.json',route=>route.abort());await fallback.reload();await fallback.locator('#error').waitFor();
  if(!await fallback.locator('#fallback').isVisible())throw Error('Fetch failure hid fallback');
  await fallback.unroute('**/splitwise-traces.json');await fallback.route('**/splitwise-traces.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({scenarios:[{label:'Broken',steps:[]}]})}));await fallback.reload();await fallback.locator('#error').waitFor();
  if(!await fallback.locator('#fallback').isVisible()||await fallback.locator('#fallback li').count()!==19)throw Error('Malformed trace hid fallback');
  out.find(r=>r.topic==='LLD-10'&&r.page==='walkthrough').fallbackCheck={scriptBlocked:true,fetchRejected:true,malformedSteps:true,staticFrames:19};
 }finally{await fallback.close();}
 return out;
}
