async (page) => {
 const results=[];
 await page.emulateMedia({reducedMotion:'reduce'});
 const base='http://127.0.0.1:8790';
 await page.goto(base+'/learning-labs/index.html?topic=booking');
 await page.locator('#scenario option').nth(2).waitFor({state:'attached'});
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.locator('#scenario').selectOption('2');
  for(let i=0;i<5;i++)await page.locator('#next').click();
  const state=await page.locator('.seat').allTextContents();
  if(!state[0].includes('HELD')||!state[0].includes('Customer B')||!state[1].includes('Customer B'))throw Error('late payment changed new owner');
  if(!await page.locator('#next').isDisabled())throw Error('end control not disabled');
  if(!await page.locator('#step').innerText().then(t=>t.includes('Pending refund intents: 1')))throw Error('refund count missing');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow)throw Error(`walkthrough overflow at ${width}`);
  await page.locator('summary').click();
  if(await page.locator('#transcript li').count()!==6)throw Error('text trace incomplete');
  await page.screenshot({path:`.qa-campaign/booking-lab-${theme}-${width}.png`,fullPage:true});
  await page.locator('summary').click();
  await page.locator('#reset').click();
  if(!await page.locator('#prev').isDisabled())throw Error('reset failed');
  results.push({page:'walkthrough',theme,width,latePaymentOwner:'B',refundIntents:1,overflow:false});
 }
 await page.goto(base+'/#/t/4/0');
 await page.locator('#refZone').waitFor();if(await page.locator('#refHide').count())await page.locator('#refHide').click();await page.locator('#refAsk').click();await page.locator('#refYes').click();
 await page.locator('#writeup table').first().waitFor();
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  const current=await page.locator('html').getAttribute('data-theme');if(current!==theme)await page.locator('#themeToggle').click();
  const metrics=await page.evaluate(()=>{
   const writeup=document.querySelector('#writeup');
   const bg=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255,255,255)';};
   const lum=c=>{let rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
   const contrast=e=>{const a=lum(getComputedStyle(e).color),b=lum(bg(e));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
   return {tables:writeup.querySelectorAll('table').length,minContrast:Math.min(...[...writeup.querySelectorAll('td')].map(contrast)),brokenImages:[...writeup.querySelectorAll('img')].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src),overflow:document.documentElement.scrollWidth>innerWidth+1,codeBlocks:writeup.querySelectorAll('pre code').length,labLink:!!writeup.querySelector('a[href="learning-labs/index.html?topic=booking"]')};
  });
  if(metrics.minContrast<4.5||metrics.brokenImages.length||metrics.overflow||!metrics.labLink)throw Error(JSON.stringify(metrics));
  const toc=page.locator('[data-reference-section="3"]');await toc.click();
  await page.waitForFunction(()=>{const top=document.querySelectorAll('#writeup h2')[3].getBoundingClientRect().top;return top>=0&&top<240;});
  if(!page.url().endsWith('/#/t/4/0'))throw Error('contents changed route');
  await page.screenshot({path:`.qa-campaign/booking-article-${theme}-${width}.png`,fullPage:false});
  results.push({page:'article',theme,width,...metrics});
 }
 return results;
}
