'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApplication}=require('../src/v2/server');
let n=0;const cmd=v=>({...v,commandVersion:1,requestKey:'schedule-draft-'+(++n)});
function setup(t){
 const a=createApplication({demo:true,clock:()=>new Date('2026-10-19T01:00:00Z')});t.after(()=>a.db.close());
 for(const [key,user] of [['m','manager'],['f','frontdesk']]){const s=a.auth.login({username:user,password:'Clinic123!'});a[key]={token:s.token,csrf:s.csrf,role:user};}
 a.fields={businessDate:'2026-10-19',dentistId:4,chairId:1,startsAt:'2026-10-19T10:00:00+08:00',endsAt:'2026-10-19T11:00:00+08:00',reason:'负责人核对日期安排'};return a;
}
test('drafts can be revised and published, but cannot be used for appointments beforehand',t=>{
 const a=setup(t),draft=a.reception.schedule(a.m,cmd({action:'draft',...a.fields}));let row=a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(draft.id);
 assert.equal(row.status,'草稿');assert.equal(row.confirmed_at,null);assert.equal(row.confirmed_by,null);
 assert.ok(a.calendar.query(a.m,{from:'2026-10-19'}).schedules.some(s=>s.id===draft.id));assert.ok(!a.calendar.query(a.f,{from:'2026-10-19'}).schedules.some(s=>s.id===draft.id));
 assert.throws(()=>a.reception.appointment(a.f,cmd({action:'create',patientId:1,scheduleId:draft.id,scheduleRevision:1,startsAt:'2026-10-19T10:15:00+08:00',endsAt:'2026-10-19T10:30:00+08:00',reason:'尚不可预约'})),e=>e.code==='SCHEDULE_CHANGED');
 assert.throws(()=>a.reception.schedule(a.f,cmd({action:'draft',...a.fields})),e=>e.code==='FORBIDDEN');
 a.reception.schedule(a.m,cmd({action:'draft',scheduleId:draft.id,expectedRevision:1,...a.fields,endsAt:'2026-10-19T11:30:00+08:00'}));
 assert.throws(()=>a.reception.schedule(a.m,cmd({action:'publish',scheduleId:draft.id,expectedRevision:1,...a.fields})),e=>e.code==='VERSION_CONFLICT');
 const issued=a.reception.schedule(a.m,cmd({action:'publish',scheduleId:draft.id,expectedRevision:2,...a.fields,endsAt:'2026-10-19T11:30:00+08:00'}));
 row=a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(draft.id);assert.equal(issued.id,draft.id);assert.equal(row.revision,3);assert.equal(row.status,'已确认');assert.equal(row.confirmed_by,1);assert.ok(row.confirmed_at);
 assert.ok(a.reception.appointment(a.f,cmd({action:'create',patientId:1,scheduleId:draft.id,scheduleRevision:3,startsAt:'2026-10-19T10:15:00+08:00',endsAt:'2026-10-19T10:30:00+08:00',reason:'实际预约'})).id);
});
test('conflicting publication leaves the original draft and confirmed schedule intact',t=>{
 const a=setup(t),confirmed=a.reception.schedule(a.m,cmd({action:'publish',...a.fields})),draft=a.reception.schedule(a.m,cmd({action:'draft',...a.fields}));
 assert.throws(()=>a.reception.schedule(a.m,cmd({action:'publish',scheduleId:draft.id,expectedRevision:1,...a.fields})),e=>e.code==='SCHEDULE_CONFLICT');
 assert.equal(a.db.prepare('SELECT status FROM dated_schedule WHERE id=?').get(confirmed.id).status,'已确认');const original=a.db.prepare('SELECT status,revision,confirmed_at FROM dated_schedule WHERE id=?').get(draft.id);assert.deepEqual({...original},{status:'草稿',revision:1,confirmed_at:null});
 assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE dated_schedule_id=?').get(draft.id).n,0);
});
test('only the manager receives draft options; publishing always rechecks current qualifications',async t=>{
 const a=setup(t),draft=a.reception.schedule(a.m,cmd({action:'draft',...a.fields}));await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>a.server.close(resolve)));
 const base='http://127.0.0.1:'+a.server.address().port+'/api/v2/reception/options?date=2026-10-19',read=async c=>(await (await fetch(base,{headers:{Cookie:'clinic_v2_session='+c.token,'X-Clinic-Role':c.role}})).json()).schedules;
 assert.ok((await read(a.m)).some(s=>s.id===draft.id));assert.ok(!(await read(a.f)).some(s=>s.id===draft.id));
 a.db.prepare("UPDATE staff_role_qualification SET revoked_at=?,revoked_by=1,revocation_reason='隔离核对' WHERE staff_id=4").run(a.auth.now());
 assert.throws(()=>a.reception.schedule(a.m,cmd({action:'publish',scheduleId:draft.id,expectedRevision:1,...a.fields})),e=>e.code==='DENTIST_UNAVAILABLE');
 assert.equal(a.db.prepare('SELECT status FROM dated_schedule WHERE id=?').get(draft.id).status,'草稿');
});
