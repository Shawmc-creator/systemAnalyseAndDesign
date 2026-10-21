'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApplication}=require('../src/v2/server');
let n=0;const cmd=x=>({...x,commandVersion:1,requestKey:'waiting-test-'+(++n)});
function setup(t,walkin=false){
 let clock=new Date('2026-10-19T01:00:00Z');
 const a=createApplication({demo:true,clock:()=>clock});t.after(()=>a.db.close());
 a.login=(username,role=username)=>{const s=a.auth.login({username,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role};};
 a.f=a.login('frontdesk');a.m=a.login('manager');a.d=a.login('dentist');a.other=a.login('manager','dentist');a.c=a.login('cashier');
 a.clock=x=>{clock=new Date(x);};
 a.schedule=(dentistId=4,chairId=1)=>a.reception.schedule(a.m,cmd({action:'publish',dentistId,chairId,businessDate:'2026-10-19',startsAt:'2026-10-19T09:00:00+08:00',endsAt:'2026-10-19T18:00:00+08:00',reason:'核实后的当日接诊安排'}));
 a.s=a.schedule();
 if(!walkin)a.b=a.reception.appointment(a.f,cmd({action:'create',patientId:1,scheduleId:a.s.id,scheduleRevision:1,startsAt:'2026-10-19T09:30:00+08:00',endsAt:'2026-10-19T10:00:00+08:00',equipmentIds:[1],reason:'患者预约检查'}));
 a.clock('2026-10-19T01:35:00Z');
 a.v=a.reception.arrive(a.f,cmd({patientId:1,dentistId:4,scheduleId:a.s.id,scheduleRevision:1,arrivedAt:a.auth.now(),...(walkin?{startsAt:a.auth.now(),endsAt:'2026-10-19T02:00:00Z',equipmentIds:[1]}:{appointmentId:a.b.id,expectedRevision:1,occupancyRevision:1})}));
 a.input=extra=>cmd({visitId:a.v.id,patientId:1,expectedVisitRevision:1,expectedOccupancyRevision:walkin?1:2,scheduleId:a.s.id,scheduleRevision:1,startsAt:'2026-10-19T10:10:00+08:00',endsAt:'2026-10-19T10:40:00+08:00',confirmed:true,reason:'原时段延误，与患者核对新的安排',...extra});
 a.move=(extra={},who=a.f)=>a.reception.recoordinate(who,a.input(extra));
 a.current=()=>a.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id);
 return a;
}
test('late arrived patient keeps identity and arrival, replaces reservations atomically and can actually start in the new slot',t=>{
 const a=setup(t),old=a.current();a.clock('2026-10-19T02:10:00Z');
 assert.throws(()=>a.clinical.record(a.d,cmd({action:'start',visitId:a.v.id,expectedVisitRevision:1,startedAt:a.auth.now()})),e=>e.code==='CONTACT_OUTSIDE_SLOT');
 const input=a.input(),result=a.reception.recoordinate(a.f,input);assert.equal(result.revision,2);assert.equal(a.reception.recoordinate(a.f,input).replayed,true);
 const visit=a.db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id),appointment=a.db.prepare('SELECT * FROM appointment WHERE id=?').get(a.b.id);
 assert.equal(visit.arrived_at,'2026-10-19T01:35:00Z');assert.equal(visit.status,'候诊');assert.equal(visit.started_at,null);
 assert.equal(appointment.status,'已到诊');assert.equal(appointment.planned_start,'2026-10-19T02:10:00Z');assert.equal(appointment.notified_at,null);
 assert.notEqual(a.current().id,old.id);assert.ok(a.db.prepare('SELECT released_at FROM resource_occupancy WHERE id=?').get(old.id).released_at);
 assert.equal(a.db.prepare('SELECT count(*) n FROM visit').get().n,1);assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_record').get().n,1);
 assert.equal(a.db.prepare('SELECT count(*) n FROM appointment_change WHERE appointment_id=?').get(a.b.id).n,1);
 assert.equal(a.db.prepare("SELECT count(*) n FROM equipment_occupancy WHERE visit_id=? AND status='已预留'").get(a.v.id).n,1);
 assert.ok(a.clinical.record(a.d,cmd({action:'start',visitId:a.v.id,expectedVisitRevision:2,startedAt:a.auth.now()})).id);
 const current=a.clinical.detail(a.d,{visitId:a.v.id,patientId:1});assert.equal(current.occupancy.id,a.current().id);assert.equal(current.physicalEnd,null);assert.equal(current.serverNow,a.auth.now());
});
test('moving a waiting patient to another qualified dentist updates the worklist and denies the former dentist access',t=>{
 const a=setup(t),other=a.schedule(1,2);a.clock('2026-10-19T02:10:00Z');
 a.move({scheduleId:other.id});
 assert.equal(a.clinical.queue(a.d,{date:'2026-10-19'}).items.length,0);
 const queue=a.clinical.queue(a.other,{date:'2026-10-19'});assert.equal(queue.items.length,1);assert.equal(queue.items[0].patient_no,a.db.prepare('SELECT record_no FROM patient WHERE id=1').get().record_no);
 assert.throws(()=>a.clinical.detail(a.d,{visitId:a.v.id,patientId:1}),e=>e.code==='CLINICAL_SCOPE');
 assert.ok(a.clinical.record(a.other,cmd({action:'start',visitId:a.v.id,expectedVisitRevision:2,startedAt:a.auth.now()})).id);
 assert.equal(a.reception.waiting(a.f).items[0].dentist_name,'林医生');
});
test('equipment or chair conflicts roll back the original waiting arrangement, appointment history, receipt and visit revision',t=>{
 const a=setup(t),other=a.schedule(1,2);
 a.reception.appointment(a.f,cmd({action:'create',patientId:2,scheduleId:other.id,scheduleRevision:1,startsAt:'2026-10-19T11:00:00+08:00',endsAt:'2026-10-19T11:30:00+08:00',equipmentIds:[1],reason:'另一患者的设备预留'}));
 a.clock('2026-10-19T02:10:00Z');const original=a.current();
 const tables=['resource_occupancy','equipment_occupancy','appointment_change','request_submission'];const counts=()=>tables.map(table=>a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n),before=counts();
 assert.throws(()=>a.move({startsAt:'2026-10-19T11:00:00+08:00',endsAt:'2026-10-19T11:30:00+08:00'}),e=>e.code==='EQUIPMENT_CONFLICT');
 assert.deepEqual(counts(),before);assert.deepEqual(a.current(),original);assert.equal(a.db.prepare('SELECT revision FROM visit WHERE id=?').get(a.v.id).revision,1);
 assert.throws(()=>a.move({scheduleId:other.id,startsAt:'2026-10-19T11:00:00+08:00',endsAt:'2026-10-19T11:30:00+08:00',equipmentIds:[]}),e=>e.code==='RESOURCE_CONFLICT');
 assert.deepEqual(a.current(),original);
});
test('waiting changes require front desk authority, matching patient, confirmation, fresh versions and valid same-day time',t=>{
 const a=setup(t);a.clock('2026-10-19T02:10:00Z');
 for(const who of [a.d,a.c,a.m])assert.throws(()=>a.move({},who),e=>e.code==='FORBIDDEN');
 for(const [extra,code]of [[{patientId:2},'PATIENT_MISMATCH'],[{confirmed:false},'CONFIRM_REQUIRED'],[{expectedVisitRevision:9},'VERSION_CONFLICT'],[{expectedOccupancyRevision:9},'VERSION_CONFLICT'],[{scheduleRevision:9},'VERSION_CONFLICT'],[{startsAt:'2026-10-19T09:00:00+08:00'},'WAITING_INTERVAL'],[{endsAt:'2026-10-19T09:50:00+08:00'},'WAITING_INTERVAL'],[{startsAt:'2026-10-20T09:00:00+08:00',endsAt:'2026-10-20T10:00:00+08:00'},'WAITING_INTERVAL']])assert.throws(()=>a.move(extra),e=>e.code===code);
 assert.equal(a.current().revision,2);
});
test('actual clinical work cannot be reassigned or released as a waiting reservation',t=>{
 const a=setup(t);a.clinical.record(a.d,cmd({action:'start',visitId:a.v.id,expectedVisitRevision:1,startedAt:a.auth.now()}));
 assert.throws(()=>a.move({expectedVisitRevision:2}),e=>e.code==='VISIT_ALREADY_STARTED');
 assert.equal(a.db.prepare('SELECT status FROM equipment_occupancy WHERE visit_id=?').get(a.v.id).status,'使用中');
});
test('walk-in waiting changes preserve a single visit and do not invent an appointment or actual equipment use',t=>{
 const a=setup(t,true),other=a.schedule(1,2),before=a.db.prepare('SELECT count(*) n FROM appointment').get().n;a.clock('2026-10-19T02:10:00Z');a.move({scheduleId:other.id});
 assert.equal(a.db.prepare('SELECT count(*) n FROM appointment').get().n,before);assert.equal(a.db.prepare('SELECT count(*) n FROM appointment_change').get().n,0);
 assert.equal(a.current().appointment_id,null);assert.equal(a.current().visit_id,a.v.id);
 const equipment=a.db.prepare('SELECT * FROM equipment_occupancy WHERE visit_id=? ORDER BY id').all(a.v.id);assert.deepEqual(equipment.map(e=>e.status),['已释放','已预留']);assert.equal(equipment[0].actual_ended_at,null);
});
test('audit failure rolls all waiting and booking updates back',t=>{
 const a=setup(t);a.clock('2026-10-19T02:10:00Z');const old=a.current();
 a.db.exec("CREATE TRIGGER fail_waiting_audit BEFORE INSERT ON operation_audit WHEN NEW.object_kind='visit' BEGIN SELECT RAISE(ABORT,'audit_fault'); END");
 assert.throws(()=>a.move(),/audit_fault/);assert.deepEqual(a.current(),old);assert.equal(a.db.prepare('SELECT count(*) n FROM appointment_change').get().n,0);
 assert.equal(a.db.prepare('SELECT revision FROM visit WHERE id=?').get(a.v.id).revision,1);
});
test('HTTP waiting routes serve clinical assets and enforce CSRF and role restrictions',async t=>{
 const a=setup(t);a.clock('2026-10-19T02:10:00Z');await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));
 const base='http://127.0.0.1:'+a.server.address().port;
 for(const file of ['/clinical.js','/catalog.js'])assert.equal((await fetch(base+file)).status,200);
 const send=(who,body,csrf=who.csrf)=>fetch(base+'/api/v2/visits/recoordinate',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'clinic_v2_session='+who.token,'X-Clinic-Role':who.role,'X-CSRF-Token':csrf},body:JSON.stringify(body)});
 assert.equal((await send(a.f,a.input(),'wrong')).status,403);assert.equal((await send(a.d,a.input())).status,403);
 const input=a.input();assert.equal((await send(a.f,input)).status,200);assert.equal((await (await send(a.f,input)).json()).replayed,true);
 const response=await fetch(base+'/api/v2/visits/waiting',{headers:{Cookie:'clinic_v2_session='+a.f.token,'X-Clinic-Role':'frontdesk'}});const data=await response.json();assert.equal(data.items[0].revision,2);assert.equal(data.items[0].patient_no,a.db.prepare('SELECT record_no FROM patient WHERE id=1').get().record_no);assert.equal(/diagnosis|chief_complaint/.test(JSON.stringify(data)),false);
});
