'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/ROG STRIX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('虚构身份网页：前台关联、患者登录预约及撤销',async()=>{
 const issuer='fictional-local-demo',verifier={async verify({proof,nonce}){if(!['fictional-patient-1','fictional-patient-2'].includes(proof))throw Error('invalid');return {verified:true,issuer,subject:proof,nonce};}};
 const demo=createChainDemo({identityTrialConfig:{issuer,verifier,bindingKey:crypto.randomBytes(32)}});
 await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 let browser;try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1024,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+demo.server.address().port+'/identity-trial');
  await page.locator('#staff-login button').click();await page.locator('#staff-area:not([hidden])').waitFor();
  await page.locator('#patient-select').selectOption('2');await page.locator('#bind').click();await page.getByText('虚构身份已关联。').waitFor();
  await page.locator('#patient-login select').selectOption('2');await page.locator('#patient-login button').click();await page.locator('#patient-area:not([hidden])').waitFor();
  await page.locator('#booking [name=branch]').selectOption('2');assert.ok(await page.locator('#booking [name=slot] option').count());
  await page.locator('#booking button').click();await page.getByText('虚构预约已创建。').waitFor();
  await page.locator('#bookings button').first().click();await page.getByText('预约已取消。').waitFor();
  await page.locator('#bindings button').click();await page.getByText('关联已撤销，该患者登录将失效。').waitFor();
  await page.setViewportSize({width:390,height:850});
  const layout=await page.evaluate(()=>{const controls=[...document.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());let overlaps=0;for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps++;}return {overlaps,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};});
  assert.equal(layout.overlaps,0,'手机宽度下控件不应重叠');assert.ok(layout.scrollWidth<=layout.width,'手机宽度下不应横向溢出');
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>demo.server.close(r));demo.db.close();}
});
