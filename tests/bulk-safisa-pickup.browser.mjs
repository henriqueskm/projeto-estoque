// Function expression accepted by the pinned playwright-cli run-code --filename.
// Only localhost sanitized fixtures may be used; confirmations are mocked here.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- CLI consumes the function expression.
async page => {
  const failures=[];
  page.on('pageerror',error=>failures.push(error.message));
  page.on('console',message=>{if(message.type()==='error')failures.push(message.text());});
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).origin !== 'http://127.0.0.1:3084') return route.abort();
    return route.continue();
  });
  const dialog=page.getByRole('dialog');
  const settle=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const closed=async stage=>{try{await dialog.waitFor({state:'hidden',timeout:3000});await settle();}catch{throw new Error(`${stage}: dialog did not close at ${page.url()}`);}};
  const open=async()=>{await page.getByRole('button',{name:'Retirar todos os prontos'}).click();await page.getByText('79.992 unidades entrarão no estoque.').waitFor();};
  const reset=async()=>{await page.goto('http://127.0.0.1:3084/interactive');await page.getByRole('button',{name:'Retirar todos os prontos'}).waitFor();};
  const results=[];
  for(const [width,height] of [[320,800],[375,812],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});await reset();await open();
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
    const measured=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:document.querySelector('[role="dialog"]').scrollWidth>document.querySelector('[role="dialog"]').clientWidth,
      lines:document.querySelectorAll('[role="dialog"] li li').length,focus:document.activeElement.textContent}));
    if(measured.overflow||measured.dialogOverflow||measured.lines!==8||measured.focus!=='Cancelar')throw new Error(JSON.stringify(measured));
    await page.keyboard.press('Tab');
    if(await page.evaluate(()=>document.activeElement.textContent)!=='Confirmar retirada + entrada')throw new Error('Focus trap next');
    await page.keyboard.press('Tab');
    if(await page.evaluate(()=>document.activeElement.textContent)!=='Cancelar')throw new Error('Focus trap wrap');
    await page.keyboard.press('Shift+Tab');
    if(await page.evaluate(()=>document.activeElement.textContent)!=='Confirmar retirada + entrada')throw new Error('Focus trap reverse');
    await page.keyboard.press('Escape');await closed('Escape '+width);
    await page.waitForFunction(()=>history.state?.__nkSemanticBack?.kind==='ROUTE');
    if(await page.evaluate(()=>window.__writes)!==0)throw new Error('Preview mutated');
    await open();await page.goBack();await closed('Back '+width);await page.goForward();await settle();
    if(await dialog.count())throw new Error('Forward restored mutation preview');
    await open();await page.getByRole('button',{name:'Alternar Activity (fixture)'}).evaluate(el=>el.click());await closed('Activity '+width);
    await page.getByRole('button',{name:'Alternar Activity (fixture)'}).click();
    if(await dialog.count())throw new Error('Activity restored old modal');
    results.push({...measured,backForward:'pass',activity:'pass',focus:'pass',previewWrites:0});
  }
  await reset();await open();await page.evaluate(()=>{window.__mode='uncertain';});
  await page.getByRole('button',{name:'Confirmar retirada + entrada'}).click();await page.getByRole('button',{name:'Tentar novamente'}).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Verificar retirada pendente'}).click();
  await page.getByRole('button',{name:'Tentar novamente'}).click();await page.getByRole('heading',{name:'Retirada concluída'}).waitFor();
  const retry=await page.evaluate(()=>({writes:window.__writes,sameKey:window.__requests[0].idempotencyKey===window.__requests[1].idempotencyKey,refreshes:window.__refreshes}));
  if(retry.writes!==2||!retry.sameKey||retry.refreshes<1)throw new Error(JSON.stringify(retry));
  if(await page.getByRole('button',{name:'Confirmar retirada + entrada'}).count())throw new Error('Success is confirmable');
  await page.goBack();await closed('Success Back');await page.goForward();await settle();if(await dialog.count())throw new Error('Forward resurrected receipt/preview');
  await reset();await open();await page.evaluate(()=>{window.__mode='stale';});
  await page.getByRole('button',{name:'Confirmar retirada + entrada'}).click();await page.getByRole('button',{name:'Atualizar prévia'}).waitFor();
  if(await page.getByRole('button',{name:'Confirmar retirada + entrada'}).count())throw new Error('Stale remains confirmable');
  await page.evaluate(()=>{window.__mode='success';});await page.getByRole('button',{name:'Atualizar prévia'}).click();
  await page.getByRole('button',{name:'Confirmar retirada + entrada'}).click();await page.getByRole('heading',{name:'Retirada concluída'}).waitFor();
  if(!await page.evaluate(()=>window.__requests[0].idempotencyKey!==window.__requests[1].idempotencyKey))throw new Error('Fresh preview reused stale key');
  await reset();await open();await page.evaluate(()=>{window.__mode='pending';});
  await page.getByRole('button',{name:'Confirmar retirada + entrada'}).click();await page.getByRole('button',{name:'Confirmando…'}).waitFor();
  await page.goBack();await page.keyboard.press('Escape');
  if(await dialog.count()!==1)throw new Error('Pending Back/Escape closed dialog');
  await page.keyboard.press('Tab');
  if(!await page.evaluate(()=>document.activeElement.getAttribute('role')==='dialog'))throw new Error('Pending focus escaped');
  await page.getByRole('button',{name:'Confirmando…'}).evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  if(await page.evaluate(()=>window.__writes)!==1)throw new Error('Pending duplicate submit');
  await page.evaluate(()=>{window.__mode='success';window.__resolve();});
  await page.waitForFunction(()=>window.__refreshes>0);
  await page.emulateMedia({reducedMotion:'reduce'});await reset();await open();await page.keyboard.press('Escape');
  await closed('Reduced motion Escape');
  if(failures.length)throw new Error(JSON.stringify(failures));
  return {results,retry,stale:'pass',pendingBackEscapeDoubleSubmit:'pass',reducedMotion:'pass',consoleErrors:0,remoteRequests:0,scope:'Real React UI/Activity/Semantic Back with mocked local server boundaries; not authenticated Preview'};
}
