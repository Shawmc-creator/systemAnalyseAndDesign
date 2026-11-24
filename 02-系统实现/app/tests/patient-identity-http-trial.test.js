'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('隔离身份接口：前台关联、患者登录预约、撤销后拒绝访问',async()=>{
 const issuer='fixture-provider',verifier={verify:async({proof,nonce})=>{if(proof!=='fixture-proof')throw Error('invalid');return {verified:true,issuer,subject:'fixture-subject',nonce};}};
 const demo=createChainDemo({identityTrialConfig:{verifier,issuer,bindingKey:randomBytes(32)}});
 await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+demo.server.address().port;
 const send=(url,data,headers={})=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  const page=await fetch(base+'/identity-trial');assert.equal(page.status,200);assert.match(await page.text(),/虚构身份模拟核验/);
  assert.equal((await fetch(base+'/identity-trial.js')).status,200);
  const sign=await send('/api/login',{username:'frontdesk',password:'Clinic123'});assert.equal(sign.status,200);const staff=await sign.json(),head={cookie:sign.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk','x-csrf-token':staff.csrf};
  const bchallenge=await (await send('/api/patient-identity-binding/challenge',{branchId:2},head)).json();
  const bind=await send('/api/patient-identity-binding/bind',{branchId:2,patientId:2,proof:'fixture-proof',nonce:bchallenge.nonce,confirmed:true,basis:'虚构现场核实'},head);assert.equal(bind.status,200,await bind.clone().text());const binding=await bind.json();
  const listResponse=await fetch(base+'/api/patient-identity-binding/list?branchId=2&patientId=2',{headers:head});assert.equal(listResponse.status,200);const list=await listResponse.json();assert.equal(list.items[0].id,binding.id);assert.ok(!JSON.stringify(list).includes('subject_hash')&&!JSON.stringify(list).includes('fixture-subject'));
  assert.equal((await fetch(base+'/api/patient-identity-binding/list?branchId=2&patientId=2',{headers:{...head,'x-clinic-role':'cashier'}})).status,403);
  const challenge=await (await send('/api/patient-identity/challenge',{})).json(),login=await send('/api/patient-identity/login',{proof:'fixture-proof',nonce:challenge.nonce});
  assert.equal(login.status,200,await login.clone().text());const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],patientHeaders={cookie,'x-patient-csrf':session.csrf};
  assert.equal((await send('/api/patient-identity/login',{proof:'fixture-proof',nonce:challenge.nonce})).status,401);
  const options=await (await fetch(base+'/api/patient-identity/options',{headers:{cookie}})).json(),schedule=options.schedules.find(s=>s.branch_id===2&&s.slots.length);assert.ok(schedule);
  const booked=await send('/api/patient-identity/appointment',{action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,...schedule.slots[0],reason:'口腔检查',requestKey:'identity-http-1',patientId:1},patientHeaders);assert.equal(booked.status,200,await booked.clone().text());const appointment=await booked.json();
  assert.equal(demo.db.prepare('SELECT patient_id FROM appointment WHERE id=?').get(appointment.id).patient_id,2);
  assert.equal((await send('/api/patient-identity/appointment',{action:'cancel',branchId:2,appointmentId:appointment.id,expectedRevision:1,requestKey:'identity-http-2'},{cookie})).status,403);
  const cancelled=await send('/api/patient-identity/appointment',{action:'cancel',branchId:2,appointmentId:appointment.id,expectedRevision:1,requestKey:'identity-http-2'},patientHeaders);assert.equal(cancelled.status,200,await cancelled.clone().text());
  const revoke=await send('/api/patient-identity-binding/revoke',{branchId:2,bindingId:binding.id,reason:'虚构撤销',confirmed:true},head);assert.equal(revoke.status,200,await revoke.clone().text());
  assert.equal((await fetch(base+'/api/patient-identity/options',{headers:{cookie}})).status,401);
 }finally{await new Promise(r=>demo.server.close(r));demo.db.close();}
});
test('普通演示未配置身份服务时拒绝真实身份接口',async()=>{
 const demo=createChainDemo();await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 try{const base='http://127.0.0.1:'+demo.server.address().port;const response=await fetch(base+'/api/patient-identity/challenge',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,503);assert.equal((await fetch(base+'/identity-trial')).status,503);}
 finally{await new Promise(r=>demo.server.close(r));demo.db.close();}
});
test('身份服务未配置时获授权前台仍可查询并撤销既有关联',async()=>{
 const demo=createChainDemo();await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+demo.server.address().port;
 try{
  const id=Number(demo.db.prepare("INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at) VALUES(2,'fictional-provider',?,1,'虚构核实','2026-10-19T01:00:00Z')").run('a'.repeat(64)).lastInsertRowid);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})}),user=await login.json();
  demo.db.prepare("DELETE FROM branch_staff_role WHERE branch_id=2 AND role_code='frontdesk' AND staff_id=?").run(user.user.staffId);
  const headers={'content-type':'application/json',cookie:login.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk','x-csrf-token':user.csrf};
  const list=await fetch(base+'/api/patient-identity-binding/list?branchId=1&patientId=2',{headers});assert.equal(list.status,200);assert.equal((await list.json()).items[0].id,id);
  assert.equal((await fetch(base+'/api/patient-identity-binding/list?branchId=2&patientId=2',{headers})).status,403);
  const post=(path,data)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
  assert.equal((await post('/api/patient-identity-binding/challenge',{branchId:1})).status,503);
  const revoke=await post('/api/patient-identity-binding/revoke',{branchId:1,bindingId:id,reason:'虚构关联撤销',confirmed:true});assert.equal(revoke.status,200,await revoke.clone().text());
  assert.ok(demo.db.prepare('SELECT revoked_at FROM patient_verified_identity WHERE id=?').get(id).revoked_at);
  assert.ok(demo.db.prepare("SELECT 1 FROM operation_audit WHERE object_kind='patient_verified_identity' AND object_key=? AND outcome_code='PATIENT_IDENTITY_REVOKED'").get(String(id)));
 }finally{await new Promise(r=>demo.server.close(r));demo.db.close();}
});
