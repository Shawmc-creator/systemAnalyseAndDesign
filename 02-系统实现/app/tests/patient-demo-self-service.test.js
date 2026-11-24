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
  const input={action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,startsAt:'2026-10-20T06:00:00Z',endsAt:'2026-10-20T06:30:00Z',reason:'口腔检查',requestKey:'test-patient-create'};
  const created=service.command(2,input);
  assert.equal(app.db.prepare('SELECT branch_id FROM appointment WHERE id=?').get(created.id).branch_id,2);
  assert.match(created.recordNo,/^B-1020-\d{3}$/);
  assert.equal(service.command(2,input).replayed,true);
  assert.throws(()=>service.command(2,{...input,reason:'任意文字',requestKey:'invalid-purpose'}),e=>e.code==='INVALID_BOOKING_REASON');
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

test('小程序门店预约联调仅限本机，且前台可查询新增和取消状态',async t=>{
 assert.throws(()=>createChainDemo({miniProgramTrial:true,publicOrigin:'https://example.test'}));
 async function start(miniProgramTrial){
  const demo=createChainDemo({miniProgramTrial,fixedClock:'2026-10-19T03:00:00Z'});
  await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>demo.server.close(()=>{demo.db.close();resolve();})));
  return 'http://127.0.0.1:'+demo.server.address().port;
 }
 const send=(base,path,data,headers={})=>fetch(base+path,{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)
 });
 const prefix='/api/miniprogram-trial';
 const normal=await start(false);
 assert.equal((await send(normal,prefix+'/session',{})).status,404);
 const patientURL='/api/patient-demo';
 const loggedOut=await fetch(normal+patientURL+'/session');
 assert.equal(loggedOut.status,200);
 assert.deepEqual(await loggedOut.json(),{signedIn:false});
 const badCredentials=await send(normal,patientURL+'/session',{username:'patient',password:'wrong'});
 assert.equal(badCredentials.status,403);
 assert.equal(badCredentials.headers.has('www-authenticate'),false);
 const patientLogin=await send(normal,patientURL+'/session',{username:'patient',password:'Patient123'});
 assert.equal(patientLogin.status,200);
 const patientHeaders={cookie:patientLogin.headers.get('set-cookie').split(';')[0]};
 const active=await fetch(normal+patientURL+'/session',{headers:patientHeaders});
 assert.deepEqual(await active.json(),{signedIn:true});
 const calendar=await (await fetch(normal+patientURL+'/options',{headers:patientHeaders})).json();
 assert.ok(calendar.patientName);
 assert.deepEqual([...new Set(calendar.schedules.map(row=>row.branch_id))].sort(),[1,2,3]);
 assert.ok(calendar.schedules.every(row=>row.dentist_name&&row.slots.length));
 assert.ok(calendar.bookings.length>=3);
 assert.ok(calendar.bookings.every(row=>row.patient_name===calendar.patientName&&/^[ABC]-\d{4}-\d{3}$/.test(row.record_no)));
 assert.equal((await send(normal,patientURL+'/logout',{}, {...patientHeaders,'x-patient-csrf':calendar.csrf})).status,200);
 assert.equal((await fetch(normal+patientURL+'/options',{headers:patientHeaders})).status,403);
 const base=await start(true);
 assert.equal((await send(base,prefix+'/session',{}, {forwarded:'for=203.0.113.5'})).status,404);
 const session=await send(base,prefix+'/session',{});
 assert.equal(session.status,200);
 const {token}=await session.json();
 const headers={authorization:'Bearer '+token};
 assert.equal((await fetch(base+'/api/patient-demo/options',{headers:{cookie:'chain_patient_demo='+token}})).status,403);
 const options=async()=>(await (await fetch(base+prefix+'/options',{headers})).json()).schedules;
 const schedule=(await options()).find(entry=>entry.branch_id===2&&entry.slots.length);
 const slot=schedule.slots[0];
 const created=await send(base,prefix+'/appointment',{
  action:'create',requestKey:'wx-create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,
  ...slot,reason:'口腔检查'
 },headers);
 assert.equal(created.status,200,await created.clone().text());
 const booking=await created.json();
 const login=await send(base,'/api/login',{username:'frontdesk',password:'Clinic123'});
 assert.equal(login.status,200);
 const staffHeaders={cookie:login.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk'};
 const front=async()=>(await (await fetch(base+'/api/reception/options?branchId=2',{headers:staffHeaders})).json()).appointments.find(entry=>entry.id===booking.id);
 assert.equal((await front()).status,'已预约');
 assert.ok(!(await options()).find(entry=>entry.id===schedule.id)?.slots.some(entry=>entry.startsAt===slot.startsAt));
 const cancelled=await send(base,prefix+'/appointment',{
  action:'cancel',requestKey:'wx-cancel',branchId:2,appointmentId:booking.id,expectedRevision:booking.revision
 },headers);
 assert.equal(cancelled.status,200,await cancelled.clone().text());
 assert.equal((await front()).status,'已取消');
 assert.ok((await options()).find(entry=>entry.id===schedule.id)?.slots.some(entry=>entry.startsAt===slot.startsAt));
});

test('患者预约跨北京时间月末滚动，保留既有预约并拒绝过去时段',async t=>{
 let clock=new Date('2026-11-30T15:30:00Z');
 const demo=createChainDemo({fixedClock:'2026-10-19T03:00:00Z',patientClock:()=>clock});
 await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>demo.server.close(()=>{demo.db.close();resolve();})));
 const base='http://127.0.0.1:'+demo.server.address().port+'/api/patient-demo';
 const post=(suffix,data,headers)=>fetch(base+suffix,{method:'POST',
  headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 const login=await post('/session',{username:'patient',password:'Patient123'});
 const {csrf}=await login.json(),headers={cookie:login.headers.get('set-cookie').split(';')[0],'x-patient-csrf':csrf};
 const options=async()=>{
  const response=await fetch(base+'/options',{headers});
  assert.equal(response.status,200);
  return response.json();
 };
 const first=await options();
 assert.equal(first.now,'2026-11-30T15:30:00Z');
 assert.ok(first.bookings.some(row=>row.planned_start.startsWith('2026-10')));
 assert.deepEqual([...new Set(first.schedules.map(row=>row.branch_id))].sort(),[1,2,3]);
 assert.ok(first.schedules.every(row=>row.slots.every(slot=>slot.startsAt>first.now)));
 const schedule=first.schedules.find(row=>row.branch_id===1);
 const made=await post('/appointment',{action:'create',branchId:1,scheduleId:schedule.id,
  scheduleRevision:schedule.revision,...schedule.slots[0],requestKey:'rolling-create',reason:'口腔检查'},headers);
 assert.equal(made.status,200,await made.clone().text());
 const booking=await made.json();
 assert.match(booking.recordNo,/^A-1201-\d{3}$/);
 clock=new Date('2026-12-01T16:01:00Z');
 const next=await options();
 assert.equal(next.now,'2026-12-01T16:01:00Z');
 assert.ok(next.schedules.every(row=>row.slots.every(slot=>slot.startsAt>next.now)));
 assert.ok(next.bookings.some(row=>row.id===booking.id));
 assert.ok(next.schedules.some(row=>row.starts_at.startsWith('2026-12-08')));
 const size=()=>demo.db.prepare("SELECT count(*) n FROM patient_demo_calendar_seed").get().n;
 const count=size();
 await options();
 assert.equal(size(),count);
 const stale=await post('/appointment',{action:'create',branchId:1,scheduleId:schedule.id,
  scheduleRevision:schedule.revision,...schedule.slots[0],requestKey:'rolling-stale',reason:'口腔检查'},headers);
 assert.equal(stale.status,422);
 assert.equal((await stale.json()).code,'PAST_APPOINTMENT');
});
