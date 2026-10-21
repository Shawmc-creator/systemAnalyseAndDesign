'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupFollowups,command}=require('./helpers/v2-followups');
test('followup context rejects unpublished front desk access and unrelated clinician scope, then exposes only the responsible contact candidates',t=>{
 const a=setupFollowups(t),f=a.createFollowup();
 assert.throws(()=>a.followups.context(a.f,{followupId:f.id}),e=>e.code==='FOLLOWUP_FRONTDESK_SCOPE');
 assert.throws(()=>a.followups.context(a.other,{followupId:f.id}),e=>e.code==='FOLLOWUP_SCOPE');
 a.signSource();const dto=a.followups.context(a.f,{followupId:f.id});assert.equal(dto.patientId,1);assert.equal(/diagnosis|chief_complaint|result|procedure_note/.test(JSON.stringify(dto)),false);
 for(const who of [a.c,a.m])assert.throws(()=>a.followups.context(who,{followupId:f.id}),e=>e.code==='FORBIDDEN');
});
test('appointment candidates exclude other patients, cancellations, original source and dates outside the target window',t=>{
 const a=setupFollowups(t),f=a.createFollowup();a.signSource();const good=a.book(),wrong=a.book('2026-10-20',{patientId:2,startsAt:'2026-10-20T12:00:00+08:00',endsAt:'2026-10-20T12:30:00+08:00'}),outside=a.book('2026-10-23');
 const canceled=a.book('2026-10-20',{startsAt:'2026-10-20T14:00:00+08:00',endsAt:'2026-10-20T14:30:00+08:00'});a.reception.appointment(a.f,command({action:'cancel',appointmentId:canceled.id,expectedRevision:1,reason:'患者确认取消'}));
 const dto=a.followups.context(a.f,{followupId:f.id}),ids=dto.appointments.map(x=>x.id);assert.ok(ids.includes(good.id));for(const id of [wrong.id,outside.id,canceled.id,a.db.prepare('SELECT appointment_id FROM visit WHERE id=?').get(a.v.id).appointment_id])assert.equal(ids.includes(id),false);
 assert.equal(dto.appointments.find(x=>x.id===good.id).revision,1);assert.equal(a.followups.context(a.f,{followupId:f.id,date:'2026-10-21'}).appointments.length,0);
});
test('assessment candidates require later actual clinical contact and keep the original or waiting visit out of the list',t=>{
 const a=setupFollowups(t),f=a.createFollowup();a.signSource();assert.equal(a.followups.context(a.d,{followupId:f.id}).visits.length,0);
 const b=a.book();a.advance('2026-10-20T03:00:00Z');const actual=a.startFollowupVisit(b.id);
 const dto=a.followups.context(a.d,{followupId:f.id});assert.deepEqual(dto.visits.map(v=>v.id),[actual.id]);assert.equal(dto.visits[0].status,'接诊中');
 assert.equal(/chief_complaint|procedure_note|finding_text/.test(JSON.stringify(dto)),false);
});
test('contact responsibility transfer immediately changes context visibility and HTTP assets/routes enforce the same scope',async t=>{
 const a=setupFollowups(t),f=a.createFollowup();a.signSource();a.enableSecondFrontdesk();
 a.contact(f.id,{action:'transfer',responsibleFrontdeskId:5,reason:'已核对接收人并交接'});
 assert.throws(()=>a.followups.context(a.f,{followupId:f.id}),e=>e.code==='FOLLOWUP_FRONTDESK_SCOPE');assert.equal(a.followups.context(a.frontdesk2,{followupId:f.id}).patientId,1);
 await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port;
 assert.equal((await fetch(base+'/followups.js')).status,200);
 const get=who=>fetch(base+'/api/v2/followups/context?followupId='+f.id,{headers:{Cookie:'clinic_v2_session='+who.token,'X-Clinic-Role':who.role}});
 assert.equal((await get(a.f)).status,403);assert.equal((await get(a.frontdesk2)).status,200);
});
