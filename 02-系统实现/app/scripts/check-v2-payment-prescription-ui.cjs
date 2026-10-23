'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {setup,command}=require('../tests/helpers/v2-prescriptions');
const {setupFees}=require('../tests/helpers/v2-fees');
const folder=path.resolve(__dirname,'../../../04-测试与验收/测试结果/20261023-v2-payment-prescription'),cleanup=[],fixture={after:fn=>cleanup.push(fn)},errors=[],scenarios=[];
fs.mkdirSync(folder,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function run(a,user,body){await new Promise(r=>a.server.listen(0,'127.0.0.1',r));const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));try{await p.goto('http://127.0.0.1:'+a.server.address().port);await p.locator('[name=username]').fill(user);await p.locator('[name=password]').fill('Clinic123!');await p.locator('#login-form button[type=submit]').click();await p.locator('#workspace').waitFor();await body(p);}finally{await context.close();await new Promise(r=>a.server.close(r));}}
 async function fill(p,fields){for(const[n,v]of Object.entries(fields))await p.locator('#editor [name='+n+']').fill(v);}
 async function submit(p,confirm=true){if(confirm)await p.locator('#editor [name=confirmed]').check();await p.locator('#edit-form button[type=submit]').click();await p.locator('#editor').waitFor({state:'hidden'});}
 try{
  const a=setup(fixture);
  await run(a,'cashier',async p=>{
   await p.locator('[data-page=finance]').click();await p.locator('[data-finance-patient="1"]').click();await p.locator('#receive-electronic-prepayment').click();await fill(p,{amount:'100',evidence:'网页验收：核对该患者的独立预收用途'});await submit(p);
   assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);const order=a.db.prepare('SELECT * FROM payment_order').get();await p.locator('[data-finance-order-result="'+order.id+'"]').click();await p.locator('#editor [name=outcome]').selectOption('unknown');await fill(p,{evidence:'网页验收：官方原单结果尚未明确，继续查原号'});await submit(p);assert.equal(a.billing.fundsSummary(1).availableCents,0);scenarios.push('无账单预收建立独立原单；结果未知不增加可用预付');
   await p.locator('[data-finance-order-result="'+order.id+'"]').click();await p.locator('#editor [name=outcome]').selectOption('success');await fill(p,{reference:'UI-PREPAY-ORIGINAL-1',evidence:'网页验收：官方原单已核实到账100元，患者及收款方一致'});await p.locator('#editor [name=patientMatches]').check();await p.locator('#editor [name=merchantMatches]').check();await submit(p);
   assert.equal(a.billing.fundsSummary(1).availableCents,10000);assert.equal(a.db.prepare('SELECT count(*) n FROM payment_allocation').get().n,0);await p.screenshot({path:path.join(folder,'01-无账单电子预收与到账.png'),fullPage:true});scenarios.push('核实预收成功后仅形成原付款及预付，不虚构账单或用途');
   await p.locator('[data-page=settlements]').click();await p.locator('#content').getByText(order.business_no,{exact:true}).waitFor();scenarios.push('经营核对可查看没有账单的预收原单');
  });
  const cash=setupFees(fixture);
  await run(cash,'cashier',async p=>{await p.locator('[data-page=settlements]').click();await p.locator('[data-cash-check="'+cash.payment.id+'"]').click();await fill(p,{actual:'990',evidence:'网页验收：现金原收据与实盘暂有10元差异'});await submit(p);assert.equal(cash.db.prepare('SELECT patient_payment_id FROM payment_reconciliation').get().patient_payment_id,cash.payment.id);await p.screenshot({path:path.join(folder,'02-现金原款逐笔核对.png'),fullPage:true});scenarios.push('现金逐笔核对关联原付款，差异不修改原现金金额');});
  await run(cash,'manager',async p=>{await p.locator('[data-page=settlements]').click();const check=cash.db.prepare('SELECT id FROM payment_reconciliation').get();await p.locator('[data-check-resolve="'+check.id+'"]').click();await fill(p,{actual:'1000',evidence:'网页验收：负责人回查现金实盘，确认原款1000元'});await submit(p);assert.equal(cash.db.prepare('SELECT count(*) n FROM payment_reconciliation').get().n,2);assert.equal(cash.db.prepare('SELECT net_cents FROM patient_payment').get().net_cents,100000);scenarios.push('负责人另存处理结论，原差异和原营业日期保留');});
  const rx=setup(fixture);rx.review();rx.record();const draft=rx.rxDraft({guidanceNote:null});
  await run(rx,'dentist',async p=>{
   await p.locator('[data-page=prescriptions]').click();await p.locator('[data-open-prescription="'+rx.v.id+'"]').click();await p.locator('[data-rx-issue="'+draft.id+'"]').click();await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('补全实际用药指导'));assert.equal(rx.db.prepare('SELECT status FROM prescription').get().status,'草稿');scenarios.push('处方草稿允许未知指导，但开立前提示补齐实际说明');
   await p.locator('[data-rx-edit="'+draft.id+'"]').click();await fill(p,{guidanceNote:'网页验收：由医师填写并核对的本次实际用药说明',reason:'补全实际指导并核对原草稿'});await submit(p,false);
   await p.locator('[data-rx-issue="'+draft.id+'"]').click();await fill(p,{reason:'网页验收：医师核对诊断、健康资料和完整原方'});await submit(p);
   await p.locator('[data-rx-handover="'+draft.id+'"]').click();await fill(p,{reason:'网页验收：核对接收人，实际交付处方文件及用药指导'});await p.locator('#editor [name=recipientVerified]').check();await submit(p);assert.equal(rx.db.prepare('SELECT handed_over_by FROM prescription').get().handed_over_by,4);assert.equal(rx.db.prepare('SELECT count(*) n FROM dispense_record').get().n,0);await p.screenshot({path:path.join(folder,'03-院外处方文件实际交付.png'),fullPage:true});scenarios.push('明确确认处方文件交付，不表示院外已取药，不产生出库及药费');
   await p.locator('[data-rx-void="'+draft.id+'"]').click();await p.locator('#editor [name=medicationStatus]').selectOption('unknown');await fill(p,{reason:'网页验收：尚未核实院外是否领取药品'});await p.locator('#editor [name=confirmed]').check();await p.locator('#edit-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#form-error').textContent.includes('取药事实不明'));assert.equal(rx.db.prepare('SELECT status FROM prescription').get().status,'已开立');scenarios.push('院外取药事实不明时拒绝作废，原方保持有效');
   await p.locator('#editor [name=medicationStatus]').selectOption('notDispensed');await fill(p,{reason:'网页验收：已回查患者确未取药，牙医确认作废'});await submit(p);const old=rx.db.prepare('SELECT * FROM prescription').get();assert.equal(old.voided_by,4);assert.ok(old.handed_over_at);scenarios.push('有据作废保存实际牙医并保留原文件交付');
   await p.locator('[data-rx-reissue="'+draft.id+'"]').click();await fill(p,{guidanceNote:'网页验收：新方的重新核对与实际指导',quantity:'5',directions:'网页验收：新方由医师重新明确的用法字段，不用于实际治疗',reason:'引用原方按新医嘱重新开立'});await p.locator('#editor [name=materialId]').selectOption(String(rx.drug.id));await submit(p,false);
   const next=rx.db.prepare('SELECT * FROM prescription ORDER BY id DESC LIMIT 1').get();assert.equal(next.original_prescription_id,old.id);await p.locator('[data-rx-issue="'+next.id+'"]').click();await fill(p,{reason:'网页验收：逐项重新核对新方，未沿用原交付状态'});await submit(p);assert.equal(rx.db.prepare('SELECT handed_over_at FROM prescription WHERE id=?').get(next.id).handed_over_at,null);await p.screenshot({path:path.join(folder,'04-引用原方重开与原历史.png'),fullPage:true});scenarios.push('重开明确引用原方，重新填写药品数量及指导，不继承交付事实');
   await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(folder,'05-窄屏处方与交付.png'),fullPage:true});scenarios.push('390像素窄屏处方页无页面横向溢出');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'网页验收.json'),JSON.stringify({date:'2026-10-23',passed:true,isolatedInMemory:true,touchesLiveData:false,consoleErrors:errors,scenarios},null,2));console.log(JSON.stringify({passed:true,scenarios:scenarios.length,evidenceFolder:folder}));
 }finally{await browser.close();for(const fn of cleanup.reverse())await fn();}
})().catch(e=>{console.error(e);process.exitCode=1;});
