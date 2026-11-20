'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('新演示可创建门店账号、病历、处方和复诊案例',async()=>{
 const demo=createChainDemo({fixedClock:'2026-10-19T03:00:00Z'});
 await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 try{
  const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/seed-chain-cases.cjs'],{env:{...process.env,CHAIN_DEMO_SEED_PORT:String(demo.server.address().port)},cwd:process.cwd(),windowsHide:true});let output='';p.stdout.on('data',c=>output+=c);p.stderr.on('data',c=>output+=c);p.on('error',reject);p.on('close',code=>resolve({code,output}));});
  assert.equal(result.code,0,result.output);
  for(const name of ['frontdesk1','frontdesk2'])assert.ok(demo.db.prepare('SELECT id FROM user_account WHERE login_name=?').get(name));
  const patient=demo.db.prepare("SELECT id FROM patient WHERE name='虚构示例复诊患者'").get();assert.ok(patient);
  assert.ok(demo.db.prepare("SELECT c.id FROM clinical_record c JOIN visit v ON c.visit_id=v.id WHERE v.patient_id=? AND c.status='已签署'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM prescription WHERE patient_id=? AND status='草稿'").get(patient.id));
  assert.ok(demo.db.prepare("SELECT id FROM followup_requirement WHERE patient_id=? AND status='待联系'").get(patient.id));
  const base='http://127.0.0.1:'+demo.server.address().port;
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
 }finally{await new Promise(r=>demo.server.close(r));demo.db.close();}
});
