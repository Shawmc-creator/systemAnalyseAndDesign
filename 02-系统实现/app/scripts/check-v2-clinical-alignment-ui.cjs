'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.resolve(root,'../../04-测试与验收/测试结果/20261023-v2-clinical-alignment');
const {setup,command}=require('../tests/helpers/v2-treatment');
const cleanup=[],a=setup({after:fn=>cleanup.push(fn)}),errors=[];
fs.mkdirSync(folder,{recursive:true});
const service=a.service();a.price(service.id);
(async()=>{
 await new Promise(r=>a.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+a.server.address().port,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  async function login(user){const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),p=await context.newPage();
   p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('[name=username]').fill(user);await p.locator('[name=password]').fill('Clinic123!');
   await p.locator('#login-form button[type=submit]').click();await p.locator('#workspace').waitFor();return p;}
  async function fill(p,values){for(const [n,v]of Object.entries(values))await p.locator('#editor [name='+n+']').fill(v);}
  async function submit(p,expectedError=null){await p.locator('#edit-form button[type=submit]').click();await p.waitForFunction(()=>!document.querySelector('#edit-form button[type=submit]').disabled);
   const error=await p.locator('#form-error').textContent();if(expectedError){assert.match(error,expectedError);return;}assert.equal(error,'');await p.locator('#editor').waitFor({state:'hidden'});}
  async function confirm(p){await p.locator('#editor [name=confirmed]').check();await submit(p);}
  const p=await login('dentist');await p.locator('[data-page=clinical]').click();await p.locator('[data-open-clinical]').click();
  await p.locator('#create-plan').click();await fill(p,{goal:'隔离验收的分次服务',diagnosticBasis:'虚构软件验收场景，非医疗建议',plannedSchedule:'按实际确认数量分次办理',reason:'核对新版患者决定范围'});
  await p.locator('#plan-item-rows [name=description]').fill('本次需记录明确数量的项目');await p.locator('#plan-item-rows [name=quantity]').fill('4');
  await p.locator('#add-plan-item').click();await p.locator('#plan-item-rows .plan-item-row').nth(1).locator('[name=description]').fill('本次尚未决定的另一个项目');
  await p.locator('#plan-item-rows .plan-item-row').nth(1).locator('[name=quantity]').fill('2');await submit(p);
  await p.locator('[data-plan-action=publish]').click();await confirm(p);
  const version=a.db.prepare('SELECT * FROM plan_version').get(),item=a.db.prepare('SELECT * FROM plan_item ORDER BY id').get();
  async function decision(kind,quantity){await p.locator('[data-plan-action=decide]').click();const chosen=p.locator('.decision-scope').first();
   await chosen.locator('[name=decisionItem]').check();await chosen.locator('[name=scopeMode]').selectOption('limited');await chosen.locator('[name=scopeQuantity]').fill(String(quantity));
   await p.locator('#editor [name=decision]').selectOption(kind);await fill(p,{explanationBasis:'已向虚构患者说明范围及数量，按本次真实选择记录',scopeNote:kind==='同意'?'累计同意上限3，其他项目未决定':'仅撤回1个尚未执行数量'});await confirm(p);}
  await decision('同意',3);assert.equal(a.db.prepare('SELECT scope_quantity FROM decision_plan_item').get().scope_quantity,3);
  async function execution(quantity){await p.locator('#create-execution').click();await p.locator('#editor [name=planItemId]').selectOption(String(item.id));
   await fill(p,{quantity:String(quantity),procedureNote:'隔离验收中登记的实际执行事实'});await p.locator('#editor [name=confirmed]').check();}
  await execution(1);await submit(p);await decision('撤回',1);
  await execution(2);await submit(p,/同意数量/);await p.screenshot({path:path.join(folder,'01-超出同意数量被拒绝.png'),fullPage:true});
  assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,1);
  await p.locator('#editor [name=quantity]').fill('1');await submit(p);
  const current=a.treatment.detail(a.d,a.context).plans[0].versions[0].items[0];assert.equal(current.effectiveQuantity,2);assert.equal(current.remainingConsentQuantity,0);
  await p.locator('#edit-record').click();await fill(p,{chiefComplaint:'先暂存已知主诉，其他内容稍后补全'});await submit(p);
  assert.equal(a.db.prepare('SELECT diagnosis FROM clinical_record').get().diagnosis,null);
  a.setClock('2026-10-19T01:40:00Z');await p.locator('#end-physical').click();await fill(p,{endedAt:'2026-10-19T09:40',reason:'虚构场景牙医确认实际结束并交接清洁'});await confirm(p);
  assert.equal(a.db.prepare('SELECT status FROM visit').get().status,'诊疗结束');assert.equal(a.db.prepare('SELECT status FROM clinical_record').get().status,'草稿');
  assert.equal(await p.locator('#edit-record').count(),1);assert.equal(await p.locator('#create-execution').count(),0);
  await p.screenshot({path:path.join(folder,'02-实际结束但草稿仍可补全.png'),fullPage:true});
  await p.locator('#edit-health').click();for(let i=0;i<3;i++)await fill(p,{['content'+i]:'本次未取得明确报告，保留未知'});
  await fill(p,{conclusion:'逐项核对后保留未知事项',reason:'虚构场景补全当次健康复核'});await confirm(p);
  await p.locator('#edit-record').click();await fill(p,{diagnosis:'未确定事项如实保留',treatmentAdvice:'记录实际处理及后续安排',findingText:'虚构验收检查所见'});await submit(p);
  a.setClock('2026-10-19T01:45:00Z');await p.locator('#sign-record').click();await confirm(p);
  const detail=a.clinical.detail(a.d,a.context);assert.equal(detail.signedIntegrity,true);assert.equal(detail.record.signed_health_review_id,1);
  assert.equal(detail.visit.ended_at,'2026-10-19T01:40:00Z');assert.equal(detail.record.signed_at,'2026-10-19T01:45:00Z');
  assert.equal(await p.locator('#edit-record').count(),0);assert.equal(await p.locator('#record-addendum').count(),1);
  await p.screenshot({path:path.join(folder,'03-独立签署与冻结复核.png'),fullPage:true});
  const assistant=await login('assistant');await assistant.locator('[data-page=resources]').click();
  await assistant.locator('[data-restore]').click();await fill(assistant,{verificationNote:'隔离验收中助理完成真实清洁核查，确认准备合格'});await confirm(assistant);
  assert.equal(a.db.prepare("SELECT count(*) n FROM resource_block WHERE status='生效中'").get().n,0);
  await assistant.screenshot({path:path.join(folder,'04-助理清洁核验后恢复.png'),fullPage:true});
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:path.join(folder,'05-窄屏诊疗记录.png'),fullPage:true});assert.deepEqual(errors,[]);
  const result={date:'2026-10-23',passed:true,isolatedInMemory:true,touchesLiveData:false,githubSynced:false,browser:'Chrome headless',consoleErrors:errors,
   scenarios:['前端逐项目明确限定数量，未选项目不阻塞提交','患者仅同意3个累计数量，未决定另一项目','实际完成1后仅撤回1个未执行量，仍可执行余下1','超出剩余同意的执行被拒绝，不生成执行或费用','修改失败输入后可补正重提','未完成诊断及所见可暂存草稿','实际结束更新就诊、释放占用并衔接清洁限制','实际结束后的草稿仍可补全健康复核及正文','实际结束后不再显示新增执行入口','签署采用确切健康复核并冻结，结束时间不改成签署时间','签后只提供独立补充','助理核验清洁后资源恢复','390像素窄屏无页面横向溢出']};
  fs.writeFileSync(path.join(folder,'网页验收.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,scenarios:result.scenarios.length,evidenceFolder:folder}));
 }finally{await browser.close();await new Promise(r=>a.server.close(r));for(const fn of cleanup.reverse())await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
