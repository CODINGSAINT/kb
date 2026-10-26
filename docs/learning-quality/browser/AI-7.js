async (page) => {
 const out=[],base='http://127.0.0.1:8790';await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(base+'/learning-labs/index.html?topic=chatclient');await page.locator('#scenario option').nth(2).waitFor({state:'attached'});
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('#scenario').selectOption('0');await page.locator('#next').click();if(!await page.locator('#step').innerText().then(t=>t.includes('Model invocations: 0')))throw Error('Construction invoked the model');
  await page.locator('#next').click();await page.locator('#next').click();if(!await page.locator('#step').innerText().then(t=>t.includes('Model invocations: 1')))throw Error('Response reads made extra model calls');
  await page.locator('#scenario').selectOption('1');await page.locator('#next').click();await page.locator('#next').click();if(!await page.locator('#step h2').innerText().then(t=>t.includes('incomplete')))throw Error('Cancellation marked complete');
  await page.locator('#scenario').selectOption('2');await page.locator('#next').click();if(!await page.locator('#step').innerText().then(t=>t.includes('Conversion fails')))throw Error('Malformed conversion did not fail');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Walkthrough overflow');
  await page.locator('summary').click();if(await page.locator('#transcript li').count()!==2)throw Error('Trace incomplete');await page.screenshot({path:`.qa-campaign/chatclient-lab-${theme}-${width}.png`,fullPage:true});await page.locator('summary').click();
  out.push({page:'walkthrough',theme,width,constructedCalls:0,responseCalls:1,cancelledIsIncomplete:true,malformedIsFailure:true,overflow:false});
 }
 await page.goto(base+'/#/t/7/2');await page.locator('#refZone').waitFor();if(await page.locator('#refHide').count())await page.locator('#refHide').click();await page.locator('#refAsk').click();await page.locator('#refYes').click();await page.locator('#writeup table').first().waitFor();
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#themeToggle').click();
  const metrics=await page.evaluate(()=>{
   const w=document.querySelector('#writeup'),bg=e=>{for(let n=e;n;n=n.parentElement){let c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255,255,255)';};
   const lum=c=>{let v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
   return {minContrast:Math.min(...[...w.querySelectorAll('td')].map(e=>{let a=lum(getComputedStyle(e).color),b=lum(bg(e));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);})),brokenImages:[...w.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),overflow:document.documentElement.scrollWidth>innerWidth+1,labLink:!!w.querySelector('a[href="learning-labs/index.html?topic=chatclient"]')};
  });if(metrics.minContrast<4.5||metrics.brokenImages.length||metrics.overflow||!metrics.labLink)throw Error(JSON.stringify(metrics));
  await page.locator('[data-reference-section="4"]').click();await page.waitForFunction(()=>{const t=document.querySelectorAll('#writeup h2')[4].getBoundingClientRect().top;return t>=0&&t<240;});await page.screenshot({path:`.qa-campaign/chatclient-article-${theme}-${width}.png`});out.push({page:'article',theme,width,...metrics});
 }
 return out;
}
