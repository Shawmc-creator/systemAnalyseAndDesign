'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {setupFollowups,command}=require('../tests/helpers/v2-followups');
const {setupInventory}=require('../tests/helpers/v2-inventory');
const {setup:setupPharmacy}=require('../tests/helpers/v2-pharmacy');
const {setup:setupInsurance}=require('../tests/helpers/v2-settlements');
const {setup}=require('../tests/helpers/v2-treatment');
const folder=path.resolve(__dirname,'../../../04-测试与验收/测试结果/20261023-v2-workflow-closeout'),cleanup=[],fixture={after:fn=>cleanup.push(fn)},errors=[],scenarios=[];
fs.mkdirSync(folder,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function run(a,user,role,body){
  await new Promise(r=>a.server.listen(0,'127.0.0.1',r));const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  try{await p.goto('http://127.0.0.1:'+a.server.address().port);await p.locator('[name=username]').fill(user);await p.locator('[name=password]').fill('Clinic123!');await p.locator('#login-form button[type=submit]').click();await p.locator('#workspace').waitFor();if(await p.locator('#role').inputValue()!==role){await p.locator('#role').selectOption(role);}await body(p);}
  finally{await context.close();await new Promise(r=>a.server.close(r));}
 }
 async function history(p,title,expected){const h=p.locator('.workflow-history').filter({has:p.locator('summary',{hasText:title})});await h.locator('summary').click();assert.equal(await h.locator('tbody tr').count(),expected);return h;}
 async function confirm(p){await p.locator('#editor [name=confirmed]').check();await p.locator('#edit-form button[type=submit]').click();await p.locator('#editor').waitFor({state:'hidden'});}
 try{
  const f=setupFollowups(fixture),req=f.createFollowup();f.signSource();f.contact(req.id);f.assess(req.id);
  await run(f,'dentist','dentist',async p=>{await p.locator('[data-page=followups]').click();const h=await history(p,'诊后要求变更历史',3);assert.match(await h.innerText(),/发布[\s\S]*联系更新[\s\S]*完成/);await p.screenshot({path:path.join(folder,'01-诊后要求历史.png'),fullPage:true});scenarios.push('来源签署、实际联系与完成历史可展开且顺序正确');});
  const i=setupInventory(fixture,{receive:false}),r=i.receive({items:[i.line({acceptedQuantityScaled:40,pendingQuantityScaled:60})]});i.inspect(r.id,{newAcceptedQuantityScaled:30,newRejectedQuantityScaled:10});i.release();const count=i.count(65);
  await run(i,'manager','manager',async p=>{await p.locator('[data-page=inventory]').click();await p.locator('[data-count-review="'+count.id+'"][data-approve=yes]').click();await p.locator('#editor [name=reviewNote]').fill('网页验收：核对原盘点后确认实际差异');await confirm(p);await history(p,'盘点与审核历史',2);await p.screenshot({path:path.join(folder,'02-盘点审核历史.png'),fullPage:true});scenarios.push('负责人实际确认盘点，原快照与审核结果共同展示');await p.locator('[data-inventory-tab=purchases]').click();const h=await history(p,'验收历次结论',2);assert.match(await h.innerText(),/首次确认[\s\S]*待检后确认/);await p.screenshot({path:path.join(folder,'03-分次验收及实际入库.png'),fullPage:true});scenarios.push('首次验收与待检后确认分别展示合格增量');await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);scenarios.push('390像素窄屏历史表在容器内滚动，无页面横向溢出');});
  const ph=setupPharmacy(fixture),rx=ph.inDraft();ph.rxIssue(rx);ph.approveRx({action:'return',reviewNote:'首次审方需医师核实'});ph.rx({action:'respond',prescriptionId:rx.id,expectedRevision:3,confirmed:true,reason:'实际医师核实原方后回复'});ph.approveRx({reviewNote:'再次核实后审方通过'});
  await run(ph,'assistant2','pharmacist',async p=>{await p.locator('[data-page=pharmacy]').click();await p.locator('[data-pharmacy-open="'+rx.id+'"]').click();const h=await history(p,'逐次审方记录',2);assert.match(await h.innerText(),/首次审方需医师核实[\s\S]*再次核实后审方通过/);await p.screenshot({path:path.join(folder,'04-逐次审方记录.png'),fullPage:true});scenarios.push('医师回复后重新审方，首次退回意见仍可查看');});
  const ins=setupInsurance(fixture);ins.ready();
  await run(ins,'cashier','cashier',async p=>{await p.locator('[data-page=insurance]').click();const h=await history(p,'预结算与患者选择历史',3);assert.match(await h.innerText(),/提交[\s\S]*结果[\s\S]*患者选择/);await p.screenshot({path:path.join(folder,'05-医保原提交与患者选择.png'),fullPage:true});scenarios.push('医保原提交、成功结果、患者选择分别显示，正式结算未伪造');});
  const d=setup(fixture),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),doc=d.documents.upload(d.d,command({...d.context,documentType:'诊疗附件',source:'隔离文书',ownershipNote:'首次归档核对',reason:'归档原件',originalName:'归属核对示例.png',contentBase64:bytes.toString('base64')}));d.documents.verify(d.d,command({action:'confirm',versionId:doc.id,expectedRevision:1,verificationNote:'原牙医确认意见',confirmed:true}));
  const schedule=d.db.prepare('SELECT dated_schedule_id FROM resource_occupancy WHERE visit_id=?').get(d.v.id).dated_schedule_id,ap=d.reception.appointment(d.f,command({action:'create',patientId:2,scheduleId:schedule,scheduleRevision:1,startsAt:'2026-10-19T10:30:00+08:00',endsAt:'2026-10-19T11:00:00+08:00',reason:'正确归属患者的独立预约'})),target=d.reception.arrive(d.f,command({patientId:2,dentistId:4,appointmentId:ap.id,expectedRevision:1,occupancyRevision:1,scheduleRevision:1,arrivedAt:d.auth.now()}));
  await run(d,'dentist','dentist',async p=>{await p.locator('[data-page=documents]').click();await p.locator('[data-open-document="'+d.v.id+'"]').click();await p.locator('[data-doc-correct="'+doc.id+'"]').click();await p.locator('#editor [name=visitId]').selectOption(String(target.id));await p.locator('#editor [name=reason]').fill('网页验收：牙医重新核对后更正患者归属');await confirm(p);await history(p,'归属更正记录',1);assert.equal(d.db.prepare('SELECT status FROM document_version WHERE id=?').get(doc.id).status,'退回核对');await p.screenshot({path:path.join(folder,'06-原件归属更正保留记录.png'),fullPage:true});scenarios.push('已确认原件通过页面更正归属，原索引与原确认留存');});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'网页验收.json'),JSON.stringify({date:'2026-10-23',passed:true,isolatedInMemory:true,touchesLiveData:false,consoleErrors:errors,scenarios},null,2));console.log(JSON.stringify({passed:true,scenarios:scenarios.length,evidenceFolder:folder}));
 }finally{await browser.close();for(const fn of cleanup.reverse())await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
