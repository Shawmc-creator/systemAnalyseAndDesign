'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {ChainReceptionTrial}=require('../src/v2/chain-reception-trial');
const {PatientDemoBooking}=require('../src/v2/patient-demo-booking');
const {ChainAuth}=require('../src/v2/chain-auth');
test('患者自助预约不依赖前台账号并限制本人和门店',()=>{
 const demo=createChainDemo(),app=demo.app;
 try{
  const service=new PatientDemoBooking(app,new ChainReceptionTrial(app));
  app.db.prepare("UPDATE user_account SET password_hash='演示中不可登录' WHERE login_name='frontdesk'").run();
  const schedule=app.db.prepare("SELECT * FROM dated_schedule WHERE branch_id=2 AND business_date='2026-10-20'").get();
  const input={action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,startsAt:'2026-10-20T06:00:00Z',endsAt:'2026-10-20T06:30:00Z',reason:'演示检查',requestKey:'test-patient-create'};
  const created=service.command(2,input);
  assert.equal(app.db.prepare('SELECT branch_id FROM appointment WHERE id=?').get(created.id).branch_id,2);
  assert.equal(service.command(2,input).replayed,true);
  assert.throws(()=>service.command(1,{action:'cancel',branchId:2,appointmentId:created.id,expectedRevision:1,reason:'取消',requestKey:'other'}));
  assert.throws(()=>service.command(2,{action:'cancel',branchId:1,appointmentId:created.id,expectedRevision:1,reason:'取消',requestKey:'wrong-branch'}));
  const cancelled=service.command(2,{action:'cancel',branchId:2,appointmentId:created.id,expectedRevision:1,reason:'取消',requestKey:'cancel'});
  assert.equal(cancelled.revision,2);
 }finally{app.db.close();}
});
test('门店岗位隔离，牙医只可选择已授权门店',()=>{
 const demo=createChainDemo(),app=demo.app;
 try {
  const auth=new ChainAuth(app.auth),login=app.auth.login({username:'frontdesk',password:'Clinic123'});
  const front={token:login.token,csrf:login.csrf,role:'frontdesk'};
  app.db.prepare("DELETE FROM branch_staff_role WHERE staff_id=? AND role_code='frontdesk' AND branch_id<>1").run(login.user.staffId);
  assert.doesNotThrow(()=>auth.authorizeBranch(front,'uc01.maintain',1));
  assert.throws(()=>auth.authorizeBranch(front,'uc01.maintain',2),e=>e.code==='BRANCH_FORBIDDEN');
  const d=app.auth.login({username:'dentist',password:'Clinic123'}),dentist={token:d.token,csrf:d.csrf,role:'dentist'};
  assert.doesNotThrow(()=>auth.authorizeBranch(dentist,'uc09.query',1));
  assert.doesNotThrow(()=>auth.authorizeBranch(dentist,'uc09.query',3));
  assert.throws(()=>auth.authorizeBranch(dentist,'uc09.query',2),e=>e.code==='BRANCH_FORBIDDEN');
 }finally{demo.db.close();}
});
