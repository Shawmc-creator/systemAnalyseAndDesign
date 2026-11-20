'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('各岗位样例重启后保留，重复导入不会新增重复单据',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-fixtures-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let demo;
 async function start(){
  demo=createChainDemo({snapshotPath:path.join(directory,'chain-demo.snapshot.sqlite'),fixedClock:'2026-10-19T03:00:00Z'});
  await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 }
 async function stop(){
  if(!demo)return;
  if(demo.server.listening)await new Promise(r=>demo.server.close(r));
  demo.db.close();
  demo=null;
 }
 try{
  await start();
  const seed=async()=>{
   const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/seed-chain-cases.cjs'],{env:{...process.env,CHAIN_DEMO_SEED_PORT:String(demo.server.address().port)},cwd:process.cwd(),windowsHide:true});let output='';p.stdout.on('data',c=>output+=c);p.stderr.on('data',c=>output+=c);p.on('error',reject);p.on('close',code=>resolve({code,output}));});
   assert.equal(result.code,0,result.output);
  };
  await seed();
  for(const name of ['frontdesk1','frontdesk2'])assert.ok(demo.db.prepare('SELECT id FROM user_account WHERE login_name=?').get(name));
  const patient=demo.db.prepare("SELECT id FROM patient WHERE name='虚构示例复诊患者'").get();assert.ok(patient);
  assert.ok(demo.db.prepare("SELECT c.id FROM clinical_record c JOIN visit v ON c.visit_id=v.id WHERE v.patient_id=? AND c.status='已签署'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM prescription WHERE patient_id=? AND status='草稿'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM followup_requirement WHERE patient_id=? AND status='待联系'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM clinical_document WHERE patient_id=? AND source='课程虚构案例附件'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT a.id FROM appointment a JOIN patient p ON p.id=a.patient_id WHERE p.name='虚构示例预约患者' AND a.branch_id=2 AND a.status='已预约'").get());
  assert.ok(demo.db.prepare("SELECT v.id FROM visit v JOIN patient p ON p.id=v.patient_id WHERE p.name='虚构示例候诊患者' AND v.branch_id=2 AND v.status='候诊'").get());
  const billingPatient=demo.db.prepare("SELECT id FROM patient WHERE name='虚构示例待收费患者'").get().id;
  assert.ok(demo.db.prepare("SELECT id FROM treatment_quote WHERE patient_id=? AND branch_id=2").get(billingPatient));
  assert.ok(demo.db.prepare("SELECT id FROM bill WHERE patient_id=? AND branch_id=2").get(billingPatient));
  assert.ok(!demo.db.prepare("SELECT p.id FROM patient_payment p JOIN patient_funds f ON f.id=p.patient_funds_id WHERE f.patient_id=?").get(billingPatient));
  assert.ok(demo.db.prepare("SELECT id FROM purchase_order WHERE branch_id=2 AND status='待确认'").get());
  const tables=['patient','appointment','visit','followup_requirement','clinical_document','bill','treatment_quote','purchase_order'];
  const counts=()=>tables.map(table=>demo.db.prepare('SELECT count(*) AS rows FROM '+table).get().rows);
  const before=counts();
  await stop();
  await start();
  assert.deepEqual(counts(),before);
  await seed();
  assert.deepEqual(counts(),before);
  assert.deepEqual(demo.db.prepare('PRAGMA foreign_key_check').all(),[]);
  const base='http://127.0.0.1:'+demo.server.address().port;
  const page=await fetch(base+'/');
  assert.equal(page.status,200);
  assert.match(await page.text(),/chain-demo\.js/);
  const session=await fetch(base+'/api/patient-demo/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const cookie=session.headers.get('set-cookie').split(';')[0],data=await session.json();
  const options=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  const schedule=options.schedules.find(s=>s.branch_id===2&&s.slots.length);assert.ok(schedule,'二店应该有患者可选择的时段');
  const slot=schedule.slots[0],req={action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,...slot,reason:'虚构预约',requestKey:'fixture-patient-book'};
  const createdResponse=await fetch(base+'/api/patient-demo/appointment',{method:'POST',headers:{cookie,'content-type':'application/json','x-patient-csrf':data.csrf},body:JSON.stringify(req)});assert.equal(createdResponse.status,200,await createdResponse.clone().text());const created=await createdResponse.json();
  const occupied=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  assert.ok(!occupied.schedules.find(s=>s.id===schedule.id)?.slots.some(s=>s.startsAt===slot.startsAt));
  const cancelResponse=await fetch(base+'/api/patient-demo/appointment',{method:'POST',headers:{cookie,'content-type':'application/json','x-patient-csrf':data.csrf},body:JSON.stringify({action:'cancel',branchId:2,appointmentId:created.id,expectedRevision:created.revision,requestKey:'fixture-patient-cancel'})});assert.equal(cancelResponse.status,200,await cancelResponse.clone().text());
  const restored=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  assert.ok(restored.schedules.find(s=>s.id===schedule.id)?.slots.some(s=>s.startsAt===slot.startsAt),'取消后应恢复可选时段');
 }finally{await stop();}
});
