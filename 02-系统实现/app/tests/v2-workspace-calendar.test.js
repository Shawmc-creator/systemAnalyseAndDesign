'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
const {insert,fact}=require('../src/v2/common');
const {BUILD}=require('../src/v2/release');
const tables=a=>a.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
function booking(a,{patientId=2,dentistId=1,chairId=2,date='2026-10-19',start='10:15',end='10:40'}={}){
 let s=a.db.prepare("SELECT * FROM dated_schedule WHERE dentist_id=? AND dental_chair_id=? AND business_date=? AND status='已确认'").get(dentistId,chairId,date);
 if(!s){const created=a.reception.schedule(a.m,command({action:'publish',businessDate:date,dentistId,chairId,startsAt:date+'T09:00:00+08:00',endsAt:date+'T18:00:00+08:00',reason:'隔离日历安排'}));s=a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(created.id);}
 return a.reception.appointment(a.f,command({action:'create',patientId,scheduleId:s.id,scheduleRevision:s.revision,startsAt:date+'T'+start+':00+08:00',endsAt:date+'T'+end+':00+08:00',reason:'隔离患者明确预约'}));
}
test('workspace keeps stable patient and selected visit; read views create no business tables or copied clinical facts',t=>{
 const a=setup(t),before=tables(a),d=a.workspace.query(a.d,{patientId:1,visitId:a.v.id});assert.equal(d.patient.id,1);assert.equal(d.selectedVisit.id,a.v.id);assert.ok(d.tabs.includes('clinical'));assert.ok(d.tabs.includes('quotes'));assert.deepEqual(tables(a),before);assert.equal(before.length,112);assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_finding').get().n,0);assert.equal(a.db.prepare('PRAGMA user_version').get().user_version,2026102602);
});
test('same-name candidate patients retain distinct patient identifiers; dentist sees only patients with a permitted visit',t=>{
 const a=setup(t);const f=a.workspace.candidates(a.f,{q:'陈晨'});assert.equal(f.items.length,2);assert.notEqual(f.items[0].record_no,f.items[1].record_no);const d=a.workspace.candidates(a.d,{q:''});assert.deepEqual(d.items.map(p=>p.id),[1]);assert.equal(a.workspace.candidates(a.other).items.length,0);assert.equal(a.workspace.candidates(a.f,{q:'%'}).items.length,0);
});
test('front desk workspace includes contact and appointments without clinical body, signing facts, health or financial ledger',t=>{
 const a=setup(t);a.clinical.record(a.d,command({...a.context,action:'save',recordId:a.clinical.recordFor(a.v.id).id,expectedRevision:1,chiefComplaint:'仅牙医可读主诉',diagnosis:'仅牙医可读诊断',treatmentAdvice:'核实后处理',findings:[]}));
 const d=a.workspace.query(a.f,{patientId:1});assert.equal(d.canEditPatient,true);assert.ok(d.tabs.includes('appointments'));assert.ok(!d.tabs.includes('clinical'));assert.ok(!d.tabs.includes('finance'));assert.equal('record_status'in d.visits[0],false);assert.deepEqual(d.feeSources,[]);assert.equal(JSON.stringify(d).includes('仅牙医可读'),false);
});
test('cashier workspace has its own fee and quote tabs without clinical or patient-edit authority',t=>{
 const a=setup(t),d=a.workspace.query(a.c,{patientId:1});assert.ok(d.tabs.includes('finance'));assert.ok(d.tabs.includes('quotes'));assert.equal(d.canEditPatient,false);assert.ok(!d.tabs.includes('clinical'));assert.equal('address'in d.patient,false);assert.equal('revision'in d.patient,false);assert.deepEqual(d.patientChanges,[]);
});
test('patient and visit mismatches, unassigned dentists and managerial clinical shortcuts are rejected',t=>{
 const a=setup(t);assert.throws(()=>a.workspace.query(a.d,{patientId:2,visitId:a.v.id}),e=>e.code==='WORKSPACE_SCOPE');assert.throws(()=>a.workspace.query(a.other,{patientId:1}),e=>e.code==='WORKSPACE_SCOPE');assert.throws(()=>a.workspace.query(a.m,{patientId:1}),e=>e.code==='FORBIDDEN');assert.throws(()=>a.workspace.query(a.d,{patientId:'x'}),e=>e.code==='INVALID_INPUT');
});
test('front desk may open a new patient without inventing a visit; dentist may not bypass arrival and clinical scope',t=>{
 const a=setup(t),d=a.workspace.query(a.f,{patientId:2});assert.equal(d.selectedVisit,null);assert.deepEqual(d.visits,[]);assert.throws(()=>a.workspace.query(a.d,{patientId:2}),e=>e.code==='WORKSPACE_SCOPE');
});
test('calendar derives exact duration and actual state from original records, including onsite arrivals without double-counting',t=>{
 const a=setup(t);booking(a);const d=a.calendar.query(a.f,{from:'2026-10-19'});assert.equal(d.entries.length,2);const own=d.entries.find(e=>e.patientId===1);assert.equal(own.status,'接诊中');assert.equal(own.durationMinutes,30);assert.equal(d.entries.find(e=>e.patientId===2).durationMinutes,25);assert.equal(d.actualUse.length,1);assert.equal(d.chairs.find(c=>c.id===1).actualBusy,true);
});
test('doctor calendar returns only own appointments and rejects an explicit other dentist while chair restrictions remain visible',t=>{
 const a=setup(t);booking(a);const d=a.calendar.query(a.d,{from:'2026-10-19'});assert.equal(d.entries.length,1);assert.equal(d.entries[0].dentistId,4);assert.equal(d.dentists.length,1);assert.throws(()=>a.calendar.query(a.d,{from:'2026-10-19',dentistId:1}),e=>e.code==='CALENDAR_SCOPE');assert.throws(()=>a.calendar.query(a.c,{from:'2026-10-19'}),e=>e.code==='FORBIDDEN');
});
test('calendar combines day/week, dentist, chair, patient and state filters without guessing status from money',t=>{
 const a=setup(t);booking(a);const d=a.calendar.query(a.m,{from:'2026-10-19',to:'2026-10-25',chairId:2,dentistId:1,status:'已预约',patientId:2});assert.equal(d.entries.length,1);assert.equal(d.entries[0].patientId,2);assert.equal(d.canManageSchedules,true);assert.equal(d.canBook,false);assert.equal(a.calendar.query(a.f,{from:'2026-10-19',status:'候诊'}).entries.length,0);
});
test('cancelled appointment retains its original doctor, chair and history instead of vanishing from calendar',t=>{
 const a=setup(t),b=booking(a);a.reception.appointment(a.f,command({action:'cancel',appointmentId:b.id,expectedRevision:b.revision,reason:'患者明确取消'}));const d=a.calendar.query(a.f,{from:'2026-10-19'}),e=d.entries.find(e=>e.appointmentId===b.id);assert.equal(e.status,'已取消');assert.equal(e.dentistId,1);assert.equal(e.chairId,2);assert.equal(d.appointments.find(x=>x.id===b.id).history.at(-1).change_kind,'取消');
});
test('planned end passing never releases actual use, including when viewing another date',t=>{
 const a=setup(t);a.setClock('2026-10-19T03:00:00Z');const login=a.auth.login({username:'frontdesk',password:'Clinic123!'}),f={token:login.token,csrf:login.csrf,role:'frontdesk'};const d=a.calendar.query(f,{from:'2026-10-20'});assert.equal(d.actualUse.length,1);assert.equal(d.chairs.find(c=>c.id===1).actualBusy,true);assert.ok(d.actualUse[0].ends_at<d.now);
});
test('an elapsed predicted resource restoration remains an active restriction; actual restore is separate',t=>{
 const a=setup(t);const b=a.resources.block(a.m,command({action:'block',chairId:2,startsAt:'2026-10-19T01:00:00Z',endsAt:'2026-10-19T01:20:00Z',reason:'故障待核验'}));const d=a.calendar.query(a.f,{from:'2026-10-19'});assert.equal(d.blocks.find(x=>x.id===b.id).status,'生效中');assert.equal(d.chairs.find(c=>c.id===2).blockedNow,true);
});
test('historical calendar query still reports a current resource block separately from historical time bands',t=>{
 const a=setup(t);a.resources.block(a.m,command({action:'block',chairId:2,startsAt:a.auth.now(),endsAt:null,reason:'当前故障待核验'}));const d=a.calendar.query(a.f,{from:'2026-10-18'});assert.equal(d.chairs.find(c=>c.id===2).blockedNow,true);assert.equal(d.entries.length,0);
});
test('calendar resource warnings do not expose another dentists clinical body or patient identity to the doctor',t=>{
 const a=setup(t);booking(a);const d=a.calendar.query(a.d,{from:'2026-10-19'});for(const r of d.actualUse){assert.equal('patient_id'in r,false);assert.equal('patientName'in r,false);assert.equal('diagnosis'in r,false);}assert.equal(JSON.stringify(d.entries).includes('13800000002'),false);
});
test('invalid calendar intervals, dates, roles and filters are rejected rather than silently broadening scope',t=>{
 const a=setup(t);for(const filter of [{from:'2026-10-19',to:'2026-10-26'},{from:'2026-10-20',to:'2026-10-19'},{from:'2026-02-30'},{chairId:'bad'},{status:'已支付'}])assert.throws(()=>a.calendar.query(a.f,filter),e=>e.status===422);assert.throws(()=>a.workspace.candidates(a.f,{q:'x'.repeat(81)}),e=>e.status===422);
});
test('new read endpoints and UI scripts are served; session and role are enforced and schema/build identities are distinct',async t=>{
 const a=setup(t);await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>a.server.close(resolve)));const base='http://127.0.0.1:'+a.server.address().port;
 assert.equal((await fetch(base+'/api/v2/workspace/query?patientId=1')).status,401);assert.equal((await fetch(base+'/api/v2/appointments/calendar')).status,401);
 const headers={Cookie:'clinic_v2_session='+a.d.token,'X-Clinic-Role':'dentist'};assert.equal((await fetch(base+'/api/v2/workspace/query?patientId=1&visitId='+a.v.id,{headers})).status,200);assert.equal((await fetch(base+'/api/v2/appointments/calendar?from=2026-10-19',{headers})).status,200);for(const p of ['/workspace.js','/calendar.js'])assert.equal((await fetch(base+p)).status,200);
 const s=await (await fetch(base+'/api/v2/status')).json();assert.equal(s.buildVersion,BUILD);assert.equal(s.schemaVersion,2026102602);
});
test('explicit live visit/read handover is visible in workspace and expires without broadening access to all patient records',t=>{
 const a=setup(t);insert(a.db,'clinical_handover',fact(a.auth.now(),{patient_id:1,receiving_dentist_id:1,handover_by:4,scope:JSON.stringify({visitIds:[a.v.id],operations:['read']}),valid_from:a.auth.now(),valid_until:'2026-10-19T02:00:00Z',reason:'隔离检查确切就诊只读交接'}));
 assert.equal(a.workspace.candidates(a.other).items[0].id,1);assert.equal(a.workspace.query(a.other,{patientId:1}).selectedVisit.id,a.v.id);a.setClock('2026-10-19T02:01:00Z');assert.equal(a.workspace.candidates(a.other).items.length,0);assert.throws(()=>a.workspace.query(a.other,{patientId:1}),e=>e.code==='WORKSPACE_SCOPE');
});
test('free-text handover or a different operation never grants workspace clinical read access',t=>{
 const a=setup(t);for(const scope of ['口头交接，请查看全部',JSON.stringify({visitIds:[a.v.id],operations:['record']})])insert(a.db,'clinical_handover',fact(a.auth.now(),{patient_id:1,receiving_dentist_id:1,handover_by:4,scope,valid_from:a.auth.now(),valid_until:null,reason:'隔离未获只读范围'}));assert.equal(a.workspace.candidates(a.other).items.length,0);assert.throws(()=>a.workspace.query(a.other,{patientId:1}),e=>e.code==='WORKSPACE_SCOPE');
});
test('multiple visits remain distinct and explicit history selection does not silently switch to the latest visit',t=>{
 const a=setup(t);a.setClock('2026-10-20T01:35:00Z');const login=name=>{const s=a.auth.login({username:name,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:name};};const f=login('frontdesk'),d=login('dentist'),b=a.db.prepare("SELECT * FROM appointment WHERE planned_start='2026-10-20T01:30:00Z'").get(),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(b.id),s=a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(o.dated_schedule_id);
 const next=a.reception.arrive(f,command({patientId:1,dentistId:4,appointmentId:b.id,expectedRevision:b.revision,occupancyRevision:o.revision,scheduleRevision:s.revision,arrivedAt:a.auth.now()}));const current=a.workspace.query(d,{patientId:1});assert.equal(current.visits.length,2);assert.equal(current.selectedVisit.id,next.id);assert.equal(a.workspace.query(d,{patientId:1,visitId:a.v.id}).selectedVisit.id,a.v.id);
});
test('onsite arrival appears once as waiting alongside booked visits, with duration from its actual chosen schedule',t=>{
 const a=setup(t);booking(a);const s=a.db.prepare("SELECT * FROM dated_schedule WHERE dentist_id=1 AND business_date='2026-10-19'").get(),v=a.reception.arrive(a.f,command({patientId:2,dentistId:1,scheduleId:s.id,scheduleRevision:s.revision,arrivedAt:a.auth.now(),startsAt:a.auth.now(),endsAt:'2026-10-19T02:00:00Z'}));const entries=a.calendar.query(a.f,{from:'2026-10-19'}).entries;assert.equal(entries.length,3);assert.equal(entries.filter(e=>e.visitId===v.id).length,1);assert.equal(entries.find(e=>e.visitId===v.id).status,'候诊');assert.equal(entries.find(e=>e.visitId===v.id).durationMinutes,25);
});
test('signing a clinical record and original fee amount do not move an active visit into the ended calendar column',t=>{
 const a=require('./helpers/v2-settlements').setup(t),e=a.calendar.query(a.f,{from:'2026-10-19'}).entries.find(e=>e.visitId===a.v.id);assert.equal(a.clinical.recordFor(a.v.id).status,'已签署');assert.equal(e.status,'接诊中');assert.equal(a.bill().summary.receivableCents,60000);assert.equal(a.calendar.query(a.f,{from:'2026-10-19'}).chairs.find(c=>c.id===1).actualBusy,true);
});
test('workspace and tooth-source DTOs retain the actual project billing unit instead of interpreting every quantity as times',t=>{
 const a=setup(t),s=a.billing.draft(a.c,command({action:'service',name:'按牙位核实的检查（隔离示例）',billingUnit:'牙',reason:'明确原项目计价单位'}));a.price(s.id);a.execute(s.id,{independentCheck:true,independentBasis:'核对该牙位的实际检查',toothCode:'46'});
 assert.equal(a.workspace.query(a.d,{patientId:1}).feeSources[0].billing_unit,'牙');assert.equal(a.treatment.detail(a.d,a.context).executions[0].billing_unit,'牙');
});
