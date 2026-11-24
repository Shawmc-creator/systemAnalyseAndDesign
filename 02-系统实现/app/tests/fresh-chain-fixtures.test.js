'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {examples}=require('../src/v2/chain-patient-demo-fixtures');
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
  const patient=demo.db.prepare("SELECT id FROM patient WHERE name=?").get(examples.followup.name);assert.ok(patient);
  assert.ok(demo.db.prepare("SELECT c.id FROM clinical_record c JOIN visit v ON c.visit_id=v.id WHERE v.patient_id=? AND c.status='已签署'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM prescription WHERE patient_id=? AND status='草稿'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM followup_requirement WHERE patient_id=? AND status='待联系'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM clinical_document WHERE patient_id=? AND source='课程虚构案例附件'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT a.id FROM appointment a JOIN patient p ON p.id=a.patient_id WHERE p.name=? AND a.branch_id=2 AND a.status='已预约'").get(examples.booking.name));
  assert.ok(demo.db.prepare("SELECT v.id FROM visit v JOIN patient p ON p.id=v.patient_id WHERE p.name=? AND v.branch_id=2 AND v.status='候诊'").get(examples.waiting.name));
  const billingPatient=demo.db.prepare("SELECT id FROM patient WHERE name=?").get(examples.billing.name).id;
  assert.ok(demo.db.prepare("SELECT id FROM treatment_quote WHERE patient_id=? AND branch_id=2").get(billingPatient));
  assert.ok(demo.db.prepare("SELECT id FROM bill WHERE patient_id=? AND branch_id=2").get(billingPatient));
  assert.ok(!demo.db.prepare("SELECT p.id FROM patient_payment p JOIN patient_funds f ON f.id=p.patient_funds_id WHERE f.patient_id=?").get(billingPatient));
  assert.ok(demo.db.prepare("SELECT id FROM purchase_order WHERE branch_id=2 AND status='待确认'").get());
  const tables=['patient','appointment','visit','followup_requirement','clinical_document','bill','treatment_quote','purchase_order'];
  const counts=()=>tables.map(table=>demo.db.prepare('SELECT count(*) AS rows FROM '+table).get().rows);
  const before=counts();
  const patientTable=()=>demo.db.prepare('SELECT id,phone,name,record_no FROM patient ORDER BY id').all();
  const references=()=>['appointment','visit','clinical_record','bill','followup_requirement'].map(table=>
   demo.db.prepare('SELECT * FROM '+table+' ORDER BY id').all());
  const beforeMigration=references(),ids=patientTable().map(row=>row.id);
  for(const fixture of Object.values(examples)){
   demo.db.prepare('UPDATE patient SET name=?,record_no=? WHERE phone=?')
    .run(fixture.oldName,'P-'+require('node:crypto').randomUUID(),fixture.phone);
  }
  // Persist the simulated previous-version rows before startup migration.
  await fetch('http://127.0.0.1:'+demo.server.address().port+'/api/status');
  await stop();
  await start();
  assert.deepEqual(counts(),before);
  assert.deepEqual(references(),beforeMigration);
  const migrated=patientTable();
  assert.deepEqual(migrated.map(row=>row.id),ids);
  assert.ok(migrated.every(row=>/^P-\d{4,}$/.test(row.record_no)));
  assert.equal(new Set(migrated.map(row=>row.record_no)).size,migrated.length);
  assert.ok(Object.values(examples).every(fixture=>migrated.some(row=>row.phone===fixture.phone&&row.name===fixture.name)));
  await seed();
  assert.deepEqual(patientTable(),migrated);
  assert.deepEqual(counts(),before);
  assert.deepEqual(demo.db.prepare('PRAGMA foreign_key_check').all(),[]);
  const base='http://127.0.0.1:'+demo.server.address().port;
  const page=await fetch(base+'/');
  assert.equal(page.status,200);
  assert.match(await page.text(),/chain-demo\.js/);
  const session=await fetch(base+'/api/patient-demo/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'patient',password:'Patient123'})});
  const cookie=session.headers.get('set-cookie').split(';')[0],data=await session.json();
  const options=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  const schedule=options.schedules.find(s=>s.branch_id===2&&s.slots.length);assert.ok(schedule,'二店应该有患者可选择的时段');
  const slot=schedule.slots[0],req={action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,...slot,reason:'口腔检查',requestKey:'fixture-patient-book'};
  const createdResponse=await fetch(base+'/api/patient-demo/appointment',{method:'POST',headers:{cookie,'content-type':'application/json','x-patient-csrf':data.csrf},body:JSON.stringify(req)});assert.equal(createdResponse.status,200,await createdResponse.clone().text());const created=await createdResponse.json();
  const occupied=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  assert.ok(!occupied.schedules.find(s=>s.id===schedule.id)?.slots.some(s=>s.startsAt===slot.startsAt));
  const cancelResponse=await fetch(base+'/api/patient-demo/appointment',{method:'POST',headers:{cookie,'content-type':'application/json','x-patient-csrf':data.csrf},body:JSON.stringify({action:'cancel',branchId:2,appointmentId:created.id,expectedRevision:created.revision,requestKey:'fixture-patient-cancel'})});assert.equal(cancelResponse.status,200,await cancelResponse.clone().text());
  const restored=await (await fetch(base+'/api/patient-demo/options',{headers:{cookie}})).json();
  assert.ok(restored.schedules.find(s=>s.id===schedule.id)?.slots.some(s=>s.startsAt===slot.startsAt),'取消后应恢复可选时段');
 }finally{await stop();}
});
