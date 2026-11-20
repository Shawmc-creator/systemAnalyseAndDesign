'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('C:/Users/ROG STRIX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('负责人网页查询并保存本店渠道核对',async()=>{
 const demo=createChainDemo();await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+demo.server.address().port);
  await page.locator('#login-form [name=username]').fill('manager');await page.locator('#login-form [name=password]').fill('Clinic123');await page.locator('#login-form button').click();
  await page.locator('#workspace-home').waitFor();await page.locator('.workspace-sidebar [data-page=followup-management]').click();
  await page.getByText('本店暂无待交接的复诊事项。').waitFor();await page.locator('.workspace-sidebar [data-page=analytics]').click();
  await page.locator('#day-close-preview').click();await page.locator('#day-close-submit:not([disabled])').waitFor();
  await page.locator('#day-close-form [name=actual]').fill('0');await page.locator('#day-close-form [name=evidence]').fill('虚构演示核对');await page.locator('#day-close-form [name=confirmed]').check();await page.locator('#day-close-submit').click();
  await page.getByText(/核对结果已保存/).waitFor();assert.equal(await page.locator('#day-close-submit').isDisabled(),true);
  assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM chain_day_close WHERE branch_id=1').get().n,1);
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>demo.server.close(r));demo.db.close();}
});
