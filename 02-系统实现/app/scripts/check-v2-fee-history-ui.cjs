'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const {setupFees}=require('../tests/helpers/v2-fees');
const folder=path.resolve(__dirname,'../../../04-测试与验收/测试结果/20261023-v2-fee-history'),cleanup=[],a=setupFees({after:fn=>cleanup.push(fn)}),errors=[];
fs.mkdirSync(folder,{recursive:true});
(async()=>{
 await new Promise(r=>a.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+a.server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  async function login(user){const p=await(await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'})).newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('[name=username]').fill(user);await p.locator('[name=password]').fill('Clinic123!');await p.locator('#login-form button[type=submit]').click();await p.locator('#workspace').waitFor();return p;}
  async function fill(p,values){for(const[n,v]of Object.entries(values))await p.locator('#editor [name='+n+']').fill(v);}
  async function submit(p){await p.locator('#edit-form button[type=submit]').click();await p.waitForFunction(()=>!document.querySelector('#edit-form button[type=submit]').disabled);assert.equal(await p.locator('#form-error').textContent(),'');await p.locator('#editor').waitFor({state:'hidden'});}
  async function confirm(p){await p.locator('#editor [name=confirmed]').check();await submit(p);}
  const cashier=await login('cashier'),manager=await login('manager');
  await cashier.locator('[data-page=finance]').click();await cashier.locator('[data-finance-patient="1"]').click();await cashier.locator('#apply-fee').click();
  await cashier.locator('#editor [name=billId]').selectOption(String(a.billId));await cashier.locator('#editor [name=paymentId]').selectOption(String(a.payment.id));
  await fill(cashier,{adjustmentYuan:'-200',refundYuan:'200',reason:'第一轮核实后申请更正',evidence:'第一轮原账及原款证据'});await confirm(cashier);
  const request=a.db.prepare('SELECT * FROM fee_request').get();
  await manager.locator('[data-page=finance]').click();await manager.locator('[data-finance-patient="1"]').click();await manager.locator('[data-review-action=return]').click();
  await fill(manager,{reviewNote:'请补充实际数量与费用核对依据'});await confirm(manager);
  await cashier.locator('#refresh-finance').click();await cashier.locator('[data-fee-resubmit]').click();await fill(cashier,{adjustmentYuan:'-150',refundYuan:'150',reason:'第二轮修订申请范围',evidence:'第二轮补齐原项目及原款核对证据'});await confirm(cashier);
  await manager.locator('#refresh-finance').click();await manager.locator('[data-review-action=approve]').click();
  await fill(manager,{adjustmentYuan:'-150',refundYuan:'150',reviewNote:'第二轮证据核实，按实际减少150元'});
  await manager.locator('#editor [name="line'+a.lineId+'"]').fill('-150');await manager.locator('#editor [name="lineNote'+a.lineId+'"]').fill('实际项目有据更正');
  await manager.locator('#editor [name^=releaseallocation]').fill('150');await confirm(manager);
  const history=a.feeInfo().items[0].history;assert.deepEqual(history.map(h=>h.event_type),['提交','退回','提交','同意']);assert.equal(history[0].proposed_refund_cents,20000);assert.equal(history[2].proposed_refund_cents,15000);
  assert.equal(a.bills().funds.refundedCents,0);await manager.locator('[data-fee-history] summary').click();
  assert.match(await manager.locator('[data-fee-history]').innerText(),/第一轮原账及原款证据/);assert.match(await manager.locator('[data-fee-history]').innerText(),/第二轮补齐/);
  await manager.screenshot({path:path.join(folder,'01-申请重提与审核完整历史.png'),fullPage:true});
  await cashier.locator('#refresh-finance').click();await cashier.locator('[data-initiate-refund]').click();await cashier.locator('#editor [name=paymentId]').selectOption(String(a.payment.id));
  assert.equal(await cashier.locator('#editor [name=channel] option').count(),1);assert.equal(await cashier.locator('#editor [name=channel]').inputValue(),'现金');
  await fill(cashier,{amountYuan:'150',recipientVerification:'核对原现金付款人与实际接收人'});await confirm(cashier);
  await cashier.locator('[data-verify-refund]').click();await cashier.locator('#editor [name=outcome]').selectOption('unknown');await fill(cashier,{transactionEvidence:'原办理结果未明，继续核实',verificationNote:'不另行重复退款'});await confirm(cashier);
  assert.equal(a.bills().funds.refundHeldCents,15000);assert.equal(await cashier.locator('[data-initiate-refund]').count(),0);
  await cashier.locator('[data-verify-refund]').click();await cashier.locator('#editor [name=outcome]').selectOption('success');await fill(cashier,{actualYuan:'100',transactionEvidence:'核实实际交付100元，剩余50元尚未交付',verificationNote:'按实际金额确认本笔'});await cashier.locator('[name=recipientMatches]').check();await confirm(cashier);
  assert.equal(a.bills().funds.refundedCents,10000);assert.equal(a.feeInfo().items[0].remainingApprovedRefundCents,5000);
  assert.equal(a.feeInfo().items[0].history.length,4);await cashier.screenshot({path:path.join(folder,'02-实际退款与未完成额度.png'),fullPage:true});
  await cashier.locator('[data-page=catalog]').click();await cashier.locator('#create-service').click();await fill(cashier,{name:'新版价目历史验收项目',billingUnit:'次',reason:'虚构软件验收目录'});await submit(cashier);
  const service=a.db.prepare('SELECT id FROM service ORDER BY id DESC LIMIT 1').get();await cashier.locator('#create-price').click();await cashier.locator('#editor [name=serviceId]').selectOption(String(service.id));await fill(cashier,{priceYuan:'100',reason:'第一轮拟用价目及期间'});await submit(cashier);
  const price=a.db.prepare('SELECT id FROM service_price ORDER BY id DESC LIMIT 1').get();await cashier.locator('[data-submit-price="'+price.id+'"]').click();await confirm(cashier);
  await manager.locator('[data-page=catalog]').click();await manager.locator('[data-return-price="'+price.id+'"]').click();await fill(manager,{reviewNote:'核对依据后请修订为120元'});await confirm(manager);
  await cashier.locator('#refresh-catalog').click();await cashier.locator('[data-edit-price="'+price.id+'"]').click();await fill(cashier,{priceYuan:'120',reason:'第二轮核实后的拟用价目'});await submit(cashier);await cashier.locator('[data-submit-price="'+price.id+'"]').click();await confirm(cashier);
  await manager.locator('#refresh-catalog').click();await manager.locator('[data-approve-price="'+price.id+'"]').click();await fill(manager,{reviewNote:'第二轮依据完整，确认适用'});await confirm(manager);
  await manager.locator('[data-stop-price="'+price.id+'"]').click();await fill(manager,{reviewNote:'停止新计费，历史原价保留'});await confirm(manager);
  await manager.locator('[data-price-history="'+price.id+'"] summary').click();const prices=a.unit.financialHistory.list('service_price',price.id);
  assert.deepEqual(prices.map(h=>h.unit_price_cents),[10000,10000,12000,12000,12000]);await manager.screenshot({path:path.join(folder,'03-价目退回修订与停用历史.png'),fullPage:true});
  await manager.setViewportSize({width:390,height:844});assert.equal(await manager.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await manager.screenshot({path:path.join(folder,'04-窄屏价目历史.png'),fullPage:true});
  assert.deepEqual(errors,[]);const scenarios=['收费员提交原账原款更正申请','负责人退回并保留意见','收费员重提不同金额和证据，原快照不覆盖','批准调整及必要用途释放，尚无实际退款','岗位可查询每次申请、审核及办理人快照','退款渠道仅为所选原付款渠道','未知退款占额且不提供重复新办入口','部分实际成功100元、尚可办50元分别显示','实际退款不伪造第二次申请批准','价目100元被退回并改为120元重提','确认与停止适用均保留当时单价及期间','390像素窄屏无页面横向溢出'];
  fs.writeFileSync(path.join(folder,'网页验收.json'),JSON.stringify({date:'2026-10-23',passed:true,isolatedInMemory:true,touchesLiveData:false,consoleErrors:errors,scenarios},null,2));console.log(JSON.stringify({passed:true,scenarios:scenarios.length,evidenceFolder:folder}));
 }finally{await browser.close();await new Promise(r=>a.server.close(r));for(const fn of cleanup.reverse())await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
