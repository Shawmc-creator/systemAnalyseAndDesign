'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createHmac,randomBytes}=require('node:crypto');
const {PatientVerifiedIdentity}=require('../src/v2/patient-verified-identity');
const {installPatientIdentityTrial,ensurePatientIdentityTrial}=require('../src/v2/patient-identity-schema-trial');
const {PatientIdentitySessionTrial}=require('../src/v2/patient-identity-session-trial');
const {PatientIdentityBindingTrial}=require('../src/v2/patient-identity-binding-trial');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('可信服务未配置或身份未关联时拒绝，成功只返回已核实绑定的患者',async()=>{
 const db=new DatabaseSync(':memory:'),key=randomBytes(32),issuer='fixture-provider',nonce='fixture-nonce';
 try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE patient(id INTEGER PRIMARY KEY); CREATE TABLE staff(id INTEGER PRIMARY KEY); INSERT INTO patient VALUES(42),(43); INSERT INTO staff VALUES(1)');
  await assert.rejects(new PatientVerifiedIdentity({db,verifier:{verify:async()=>{throw Error('must not call');}},issuer,bindingKey:key}).resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_UNAVAILABLE');
  installPatientIdentityTrial(db);
  const subjectHash=createHmac('sha256',key).update(issuer+'\0'+'subject-a').digest('hex');
  const add=db.prepare('INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at) VALUES(?,?,?,?,?,?)');
  add.run(42,issuer,subjectHash,1,'已在虚构演示中人工核对','2026-01-01T00:00:00Z');
  assert.throws(()=>add.run(43,issuer,subjectHash,1,'重复绑定','2026-01-01T00:00:00Z'));
  await assert.rejects(new PatientVerifiedIdentity({db}).resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_UNAVAILABLE');
  const verifier={verify:async()=>({verified:true,issuer,nonce,subject:'subject-a'})},service=new PatientVerifiedIdentity({db,verifier,issuer,bindingKey:key});
  assert.deepEqual(await service.resolve({proof:'signed-proof',nonce}),{patientId:42});
  verifier.verify=async()=>({verified:true,issuer,nonce,subject:'subject-b'});
  await assert.rejects(service.resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_UNBOUND');
  verifier.verify=async()=>({verified:true,issuer,nonce:'other',subject:'subject-a'});
  await assert.rejects(service.resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_INVALID');
  verifier.verify=async()=>{throw Error('provider unavailable');};
  await assert.rejects(service.resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_INVALID');
  db.prepare('UPDATE patient_verified_identity SET revoked_at=?,revoked_by=?,revocation_reason=?').run('2026-01-01T00:00:00Z',1,'示例撤销');
  verifier.verify=async()=>({verified:true,issuer,nonce,subject:'subject-a'});
  await assert.rejects(service.resolve({proof:'x',nonce}),e=>e.code==='PATIENT_IDENTITY_UNBOUND');
 }finally{db.close();}
});
test('前台需具有门店权限并确认身份，关联与撤销均记审计且不记录凭据',async()=>{
 const demo=createChainDemo(),app=demo.app,key=randomBytes(32),issuer='fixture-provider';
 try{
  ensurePatientIdentityTrial(app.db);
  const frontLogin=app.auth.login({username:'frontdesk',password:'Clinic123'}),front={token:frontLogin.token,csrf:frontLogin.csrf,role:'frontdesk'};
  app.db.prepare("DELETE FROM branch_staff_role WHERE staff_id=? AND role_code='frontdesk' AND branch_id<>1").run(frontLogin.user.staffId);
  const verifier={verify:async({nonce})=>({verified:true,issuer,nonce,subject:'fixture-subject'})};
  const identity=new PatientVerifiedIdentity({db:app.db,verifier,issuer,bindingKey:key}),bindings=new PatientIdentityBindingTrial({app,identity});
  assert.throws(()=>bindings.challenge(front,2),e=>e.code==='BRANCH_FORBIDDEN');
  const c=bindings.challenge(front,1);
  await assert.rejects(bindings.bind(front,{branchId:1,patientId:2,proof:'private-proof',nonce:c.nonce,confirmed:false,basis:'虚构核实'}),e=>e.code==='CONFIRM_REQUIRED');
  const result=await bindings.bind(front,{branchId:1,patientId:2,proof:'private-proof',nonce:c.nonce,confirmed:true,basis:'虚构核实'});
  await assert.rejects(bindings.bind(front,{branchId:1,patientId:2,proof:'private-proof',nonce:c.nonce,confirmed:true,basis:'虚构核实'}),e=>e.code==='PATIENT_AUTH_CHALLENGE');
  const sessions=new PatientIdentitySessionTrial({db:app.db,identity}),challenge=sessions.challenge(),login=await sessions.login({proof:'private-proof',nonce:challenge.nonce});
  assert.equal(sessions.authorize(login.token).patientId,2);
  bindings.revoke(front,{branchId:1,bindingId:result.id,reason:'虚构撤销',confirmed:true});
  assert.throws(()=>sessions.authorize(login.token),e=>e.code==='PATIENT_AUTH_REVOKED');
  const audit=app.db.prepare("SELECT outcome_code,authority_snapshot,reason FROM operation_audit WHERE object_kind='patient_verified_identity' ORDER BY id").all();
  assert.deepEqual(audit.map(x=>x.outcome_code),['PATIENT_IDENTITY_BOUND','PATIENT_IDENTITY_REVOKED']);
  assert.ok(!JSON.stringify(audit).includes('private-proof')&&!JSON.stringify(audit).includes('fixture-subject'));
 }finally{demo.db.close();}
});
test('患者登录挑战只使用一次，会话过期或身份撤销后不得继续使用',async()=>{
 const db=new DatabaseSync(':memory:'),key=randomBytes(32),issuer='fixture-provider';let now=1000000;
 try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE patient(id INTEGER PRIMARY KEY); CREATE TABLE staff(id INTEGER PRIMARY KEY); INSERT INTO patient VALUES(42); INSERT INTO staff VALUES(1)');
  installPatientIdentityTrial(db);
  const subjectHash=createHmac('sha256',key).update(issuer+'\0'+'subject-a').digest('hex');
  db.prepare('INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at) VALUES(?,?,?,?,?,?)').run(42,issuer,subjectHash,1,'虚构现场核对','2026-01-01T00:00:00Z');
  const verifier={verify:async ({nonce})=>({verified:true,issuer,nonce,subject:'subject-a'})};
  const identity=new PatientVerifiedIdentity({db,verifier,issuer,bindingKey:key}),sessions=new PatientIdentitySessionTrial({db,identity,clock:()=>now});
  const challenge=sessions.challenge(),login=await sessions.login({proof:'test',nonce:challenge.nonce});
  assert.equal(sessions.authorize(login.token,login.csrf).patientId,42);
  assert.throws(()=>sessions.authorize(login.token,'0'.repeat(64)),e=>e.code==='CSRF_INVALID');
  assert.throws(()=>sessions.logout(login.token),e=>e.code==='CSRF_INVALID');
  await assert.rejects(sessions.login({proof:'test',nonce:challenge.nonce}),e=>e.code==='PATIENT_AUTH_CHALLENGE');
  const expired=sessions.challenge();now+=120001;await assert.rejects(sessions.login({proof:'test',nonce:expired.nonce}),e=>e.code==='PATIENT_AUTH_CHALLENGE');
  const slow=sessions.challenge();verifier.verify=async({nonce})=>{now+=120001;return {verified:true,issuer,nonce,subject:'subject-a'};};
  await assert.rejects(sessions.login({proof:'test',nonce:slow.nonce}),e=>e.code==='PATIENT_AUTH_CHALLENGE');
  db.prepare('UPDATE patient_verified_identity SET revoked_at=?,revoked_by=?,revocation_reason=?').run('2026-01-01T00:00:00Z',1,'撤销示例');
  assert.throws(()=>sessions.authorize(login.token),e=>e.code==='PATIENT_AUTH_REVOKED');
 }finally{db.close();}
});
