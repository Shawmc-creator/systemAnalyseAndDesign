'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/ROG STRIX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('前台从患者档案查询并撤销既有关联',async()=>{
 const demo=createChainDemo();await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));let browser;
 try{
  const id=Number(demo.db.prepare("INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at) VALUES(2,'fictional-provider',?,1,'虚构核实','2026-10-19T01:00:00Z')").run('b'.repeat(64)).lastInsertRowid);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+demo.server.address().port);
  await page.locator('#login-form [name=username]').fill('frontdesk');await page.locator('#login-form [name=password]').fill('Clinic123');await page.locator('#login-form button').click();
  await page.locator('#workspace-home').waitFor();await page.locator('.workspace-sidebar [data-page=patients]').click();
  await page.locator('#patient-edit-drawer summary').click();await page.locator('#patient-edit-form [name=patient]').selectOption('2');
  await page.getByText('患者身份关联管理',{exact:true}).click();await page.locator('#identity-binding-query').click();
  await page.locator('#identity-binding-list').getByText('fictional-provider',{exact:false}).waitFor();await page.locator('#identity-binding-list button').click();
  await page.locator('#reason-form [name=reason]').fill('虚构核对后撤销');await page.locator('#reason-form button[type=submit]').click();
  await page.locator('#identity-binding-list').getByText('已撤销',{exact:false}).waitFor();assert.ok(demo.db.prepare('SELECT revoked_at FROM patient_verified_identity WHERE id=?').get(id).revoked_at);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>demo.server.close(r));demo.db.close();}
});
