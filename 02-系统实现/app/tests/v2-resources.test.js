'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApplication}=require('../src/v2/server');
const {openDatabase,DESIGN_DIR,VERSION}=require('../src/v2/database');
let serial=0;
const cmd=value=>({...value,commandVersion:1,requestKey:'resource-test-'+(++serial)});
function setup(t) {
  let clock=new Date('2026-10-19T01:00:00Z');
  const a=createApplication({demo:true,clock:()=>clock});t.after(()=>a.db.close());
  a.login=(username,role=username)=>{const s=a.auth.login({username,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role};};
  a.f=a.login('frontdesk');a.m=a.login('manager');a.d=a.login('dentist');a.s=a.login('assistant');a.c=a.login('cashier');
  a.clock=time=>{clock=new Date(time);};
  a.schedule=(dentistId=4,chairId=1)=>a.reception.schedule(a.m,cmd({action:'publish',dentistId,chairId,businessDate:'2026-10-19',startsAt:'2026-10-19T09:00:00+08:00',endsAt:'2026-10-19T18:00:00+08:00',reason:'资源流程测试排班'}));
  a.book=(s,extra={})=>a.reception.appointment(a.f,cmd({action:'create',patientId:1,scheduleId:s.id,scheduleRevision:s.revision,startsAt:'2026-10-19T09:30:00+08:00',endsAt:'2026-10-19T10:00:00+08:00',reason:'患者实际提出的就诊需求',equipmentIds:[1],...extra}));
  a.arrive=(b,dentistId=4)=>{
    const o=a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(b.id);
    return a.reception.arrive(a.f,cmd({appointmentId:b.id,patientId:a.db.prepare('SELECT patient_id FROM appointment WHERE id=?').get(b.id).patient_id,dentistId,expectedRevision:b.revision,occupancyRevision:o.revision,scheduleRevision:1,arrivedAt:a.auth.now()}));
  };
  a.start=(v,who=a.d)=>a.clinical.record(who,cmd({action:'start',visitId:v.id,expectedVisitRevision:1,startedAt:a.auth.now()}));
  a.finish=(v,extra={},who=a.d)=>{
    const visit=a.db.prepare('SELECT * FROM visit WHERE id=?').get(v.id),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(v.id);
    return a.resources.finish(who,cmd({visitId:v.id,expectedVisitRevision:visit.revision,expectedOccupancyRevision:o?.revision||1,endedAt:a.auth.now(),confirmed:true,reason:'牙医确认实际操作结束并交接清洁',...extra}));
  };
  a.restore=b=>a.resources.block(a.s,cmd({action:'restore',blockId:b.id,expectedRevision:b.revision,confirmed:true,verificationNote:'助理已完成诊椅清洁与准备核验'}));
  a.sign=v=>{
    const record=a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(v.id);
    a.clinical.health(a.d,cmd({action:'record',visitId:v.id,patientId:1,expectedHealthVersionId:null,conclusion:'当次已核实，未知项保留',reason:'患者首次提供资料',items:['病史','过敏','用药'].map(category=>({category,certainty:'未知',content:'患者暂未能确认',source:'患者当面报告',reportedAt:a.auth.now()}))}));
    a.clinical.record(a.d,cmd({action:'save',visitId:v.id,recordId:record.id,expectedRevision:record.revision,chiefComplaint:'隔离软件演示的主诉',diagnosis:'测试用诊断记录',treatmentAdvice:'已说明后续安排',findings:[{text:'测试用当次所见'}]}));
    return a.clinical.sign(a.d,cmd({action:'sign',recordId:record.id,expectedRevision:record.revision+1,confirmed:true}));
  };
  return a;
}
test('resource permissions distinguish query, management, dentist physical end and equipment maintenance',t=>{
  const a=setup(t);
  assert.throws(()=>a.resources.query(a.c),e=>e.code==='FORBIDDEN');
  for(const who of [a.f,a.d])assert.throws(()=>a.resources.block(who,cmd({action:'block',chairId:1,reason:'非授权停用'})),e=>e.code==='FORBIDDEN');
  assert.throws(()=>a.resources.equipment(a.s,cmd({name:'检查设备',equipmentType:'共享',reason:'建档'})),e=>e.code==='FORBIDDEN');
  assert.equal(a.resources.query(a.f).equipment.length,1);
  assert.equal(/chief_complaint|diagnosis|treatment_advice|phone/.test(JSON.stringify(a.resources.query(a.s))),false);
});
test('shared equipment conflicts across dentists and chairs roll all new booking facts back',t=>{
  const a=setup(t),s=a.schedule(),other=a.schedule(1,2);a.book(s);
  const counts=()=>['appointment','resource_occupancy','equipment_occupancy','request_submission'].map(t=>a.db.prepare(`SELECT count(*) n FROM ${t}`).get().n),before=counts();
  assert.throws(()=>a.book(other,{patientId:2}),e=>e.code==='EQUIPMENT_CONFLICT');assert.deepEqual(counts(),before);
  assert.ok(a.book(other,{patientId:2,startsAt:'2026-10-19T10:00:00+08:00',endsAt:'2026-10-19T10:30:00+08:00'}).id);
});
test('cancelled equipment reservation is retained without inventing an actual use or end time',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s),input=cmd({action:'cancel',appointmentId:b.id,expectedRevision:b.revision,reason:'患者确认取消'});
  a.reception.appointment(a.f,input);assert.equal(a.reception.appointment(a.f,input).replayed,true);
  const e=a.db.prepare('SELECT * FROM equipment_occupancy WHERE appointment_id=?').get(b.id);
  assert.equal(e.status,'已释放');assert.equal(e.actual_ended_at,null);
  assert.ok(a.book(s,{patientId:2}).id);
  assert.throws(()=>a.db.prepare("UPDATE equipment_occupancy SET release_reason='改写历史' WHERE id=?").run(e.id),/resource_history_frozen/);
});
test('failed equipment reschedule restores original chair and equipment reservations together',t=>{
  const a=setup(t),s=a.schedule(),other=a.schedule(1,2),b=a.book(s);
  a.book(other,{patientId:2,startsAt:'2026-10-19T11:00:00+08:00',endsAt:'2026-10-19T11:30:00+08:00'});
  assert.throws(()=>a.reception.appointment(a.f,cmd({action:'reschedule',appointmentId:b.id,expectedRevision:1,scheduleId:s.id,scheduleRevision:1,startsAt:'2026-10-19T11:00:00+08:00',endsAt:'2026-10-19T11:30:00+08:00',reason:'患者提出改约'})),e=>e.code==='EQUIPMENT_CONFLICT');
  assert.equal(a.db.prepare("SELECT count(*) n FROM equipment_occupancy WHERE appointment_id=? AND status='已预留'").get(b.id).n,1);
  assert.equal(a.db.prepare('SELECT planned_start FROM appointment WHERE id=?').get(b.id).planned_start,'2026-10-19T01:30:00Z');
});
test('fixed equipment cannot be reserved on another chair or reassigned while a reservation exists',t=>{
  const a=setup(t),s=a.schedule(),other=a.schedule(1,2);
  const e=a.resources.equipment(a.m,cmd({name:'固定检查设备',equipmentType:'固定设备',chairId:1,reason:'核对设备归属'}));
  assert.throws(()=>a.book(other,{patientId:2,equipmentIds:[e.id]}),x=>x.code==='EQUIPMENT_CHAIR');
  a.book(s,{equipmentIds:[e.id]});
  assert.throws(()=>a.resources.equipment(a.m,cmd({equipmentId:e.id,expectedRevision:1,name:'固定检查设备',equipmentType:'固定设备',chairId:2,reason:'调整固定归属'})),x=>x.code==='EQUIPMENT_RESERVED');
});
test('expected maintenance end does not restore a chair without actual verification',t=>{
  const a=setup(t),s=a.schedule();
  const b=a.resources.block(a.s,cmd({action:'block',chairId:1,startsAt:a.auth.now(),endsAt:'2026-10-19T09:05:00+08:00',reason:'清洁准备待核验'}));
  a.clock('2026-10-19T01:10:00Z');assert.throws(()=>a.book(s),e=>e.code==='RESOURCE_BLOCKED');
  assert.throws(()=>a.resources.block(a.s,cmd({action:'restore',blockId:b.id,expectedRevision:1,confirmed:true,verificationNote:''})),e=>e.code==='INVALID_INPUT');
  a.restore(b);assert.ok(a.book(s).id);
  assert.throws(()=>a.restore(b),e=>e.code==='VERSION_CONFLICT');
});
test('new fault after booking allows actual arrival but prevents start until verified restoration',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s);
  const blocked=a.resources.block(a.s,cmd({action:'block',equipmentId:1,reason:'设备故障待检查'}));
  a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);
  assert.throws(()=>a.start(v),e=>e.code==='RESOURCE_BLOCKED');
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(v.id).status,'候诊');
  a.restore(blocked);assert.ok(a.start(v).id);
});
test('overrun and signed record keep chair busy; physical end creates cleaning block; verified cleaning enables next patient',t=>{
  const a=setup(t),s=a.schedule(),first=a.book(s),next=a.book(s,{patientId:2,startsAt:'2026-10-19T10:00:00+08:00',endsAt:'2026-10-19T11:00:00+08:00'});
  a.clock('2026-10-19T01:35:00Z');const v=a.arrive(first);a.start(v);
  a.clock('2026-10-19T02:05:00Z');const waiting=a.arrive(next);
  assert.throws(()=>a.start(waiting),e=>e.code==='RESOURCE_STILL_IN_USE');
  a.sign(v);assert.throws(()=>a.start(waiting),e=>e.code==='RESOURCE_STILL_IN_USE');
  const block=a.finish(v);assert.equal(a.resources.query(a.s).chairs[0].blocked,true);
  assert.throws(()=>a.start(waiting),e=>e.code==='RESOURCE_BLOCKED');
  assert.equal(a.db.prepare("SELECT actual_ended_at FROM equipment_occupancy WHERE visit_id=?").get(v.id).actual_ended_at,a.auth.now());
  a.restore(block);assert.ok(a.start(waiting).id);
});
test('actual shared equipment use cannot be restarted on a different chair just because its planned end passed',t=>{
  const a=setup(t),s=a.schedule(),s2=a.schedule(1,2),b=a.book(s),b2=a.book(s2,{patientId:2,startsAt:'2026-10-19T10:00:00+08:00',endsAt:'2026-10-19T11:00:00+08:00'});
  a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);a.start(v);
  a.clock('2026-10-19T02:05:00Z');const v2=a.arrive(b2,1);
  assert.throws(()=>a.start(v2,a.login('manager','dentist')),e=>e.code==='EQUIPMENT_STILL_IN_USE');
});
test('physical end before signing preserves unsigned clinical work and cannot be mistaken for record signing',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s);a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);a.start(v);
  const block=a.finish(v);
  assert.equal(a.db.prepare('SELECT status FROM clinical_record WHERE visit_id=?').get(v.id).status,'草稿');
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(v.id).status,'接诊中');
  a.restore(block);a.sign(v);
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(v.id).status,'诊疗结束');
});
test('actual-end authority, versions, time and replay protect physical resources',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s);a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);a.start(v);
  assert.throws(()=>a.finish(v,{},a.login('manager','dentist')),e=>e.code==='CLINICAL_SCOPE');
  assert.throws(()=>a.finish(v,{expectedOccupancyRevision:1}),e=>e.code==='VERSION_CONFLICT');
  assert.throws(()=>a.finish(v,{endedAt:'2026-10-19T03:00:00Z'}),e=>e.code==='INVALID_END_TIME');
  const input=cmd({visitId:v.id,expectedVisitRevision:2,expectedOccupancyRevision:2,endedAt:a.auth.now(),confirmed:true,reason:'实际操作结束'});
  const result=a.resources.finish(a.d,input);assert.equal(a.resources.finish(a.d,input).replayed,true);
  assert.throws(()=>a.finish(v),e=>e.code==='OPERATION_ALREADY_FINISHED');
  assert.equal(a.db.prepare("SELECT count(*) n FROM resource_block WHERE status='生效中'").get().n,1);assert.ok(result.id);
});
test('a fault or preparation block cannot be restored while actual work is ongoing',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s);a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);a.start(v);
  const block=a.resources.block(a.s,cmd({action:'block',chairId:1,reason:'使用中发现准备问题'}));
  assert.throws(()=>a.restore(block),e=>e.code==='RESOURCE_STILL_IN_USE');
});
test('audit failure rolls physical release, device end, cleaning block and receipt back together',t=>{
  const a=setup(t),s=a.schedule(),b=a.book(s);a.clock('2026-10-19T01:35:00Z');const v=a.arrive(b);a.start(v);
  a.db.exec("CREATE TEMP TRIGGER resource_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.event_type='变更' AND NEW.object_kind='resource_block' BEGIN SELECT RAISE(ABORT,'resource_audit_fault'); END");
  assert.throws(()=>a.finish(v),/resource_audit_fault/);
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_block').get().n,0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(v.id).n,1);
  assert.equal(a.db.prepare("SELECT status FROM equipment_occupancy WHERE visit_id=?").get(v.id).status,'使用中');
});
function oldDatabase(folder) {
  const file=path.join(folder,'known-v2.db'),db=new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(DESIGN_DIR,'SQLite-建表设计.sql'),'utf8'));db.exec('PRAGMA application_id=0x51484432');
  db.prepare('INSERT INTO staff(name,employed_from,created_by,record_no,created_at,updated_at,revision) VALUES(?,?,NULL,?,?,?,1)')
    .run('升级前保留的工作人员','2026-10-19','MIGRATION-STAFF','2026-10-19T01:00:00Z','2026-10-19T01:00:00Z');
  db.close();return file;
}
test('recognized 85-table database upgrades once with a readable consistent backup and preserved business data',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dental-resource-upgrade-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=oldDatabase(folder),db=openDatabase(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);assert.equal(db.prepare('SELECT name FROM staff').get().name,'升级前保留的工作人员');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
  const backups=fs.readdirSync(path.join(folder,'backups'));assert.equal(backups.length,1);
  const snapshot=new DatabaseSync(path.join(folder,'backups',backups[0]));
  assert.equal(snapshot.prepare('PRAGMA user_version').get().user_version,20261018);assert.equal(snapshot.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,85);snapshot.close();
  openDatabase(file).close();assert.equal(fs.readdirSync(path.join(folder,'backups')).length,1);
});
test('migration failure leaves the old schema and its data intact instead of a half-upgraded database',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dental-resource-fault-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=oldDatabase(folder),db=new DatabaseSync(file);
  db.prepare("INSERT INTO access_permission(code,name,operation_kind,object_rule,config_version) VALUES('resources.query','已有配置','查询','测试重复配置',1)").run();db.close();
  assert.throws(()=>openDatabase(file),/UNIQUE/);
  const check=new DatabaseSync(file);assert.equal(check.prepare('PRAGMA user_version').get().user_version,20261018);
  assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='clinical_equipment'").get().n,0);
  assert.equal(check.prepare('SELECT count(*) n FROM staff').get().n,1);check.close();
});
test('HTTP resource routes enforce roles and CSRF, persist real changes and replay one command',async t=>{
  const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));
  const base='http://127.0.0.1:'+a.server.address().port;
  async function login(username){const res=await fetch(base+'/api/v2/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});const data=await res.json();return {Cookie:res.headers.get('set-cookie').split(';')[0],'X-Clinic-Role':username,'X-CSRF-Token':data.csrf};}
  const assistant=await login('assistant'),front=await login('frontdesk');
  const input=cmd({action:'block',chairId:1,reason:'HTTP核对故障'}),post=async headers=>{const r=await fetch(base+'/api/v2/resources/blocks',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  assert.equal((await post(front)).status,403);assert.equal((await post({...assistant,'X-CSRF-Token':''})).status,403);
  const first=await post(assistant),second=await post(assistant);assert.equal(first.status,200);assert.equal(second.body.id,first.body.id);assert.equal(second.body.replayed,true);
  const query=await fetch(base+'/api/v2/resources/query',{headers:front});assert.equal(query.status,200);assert.equal((await query.json()).chairs[0].blocked,true);
});
module.exports={setup,cmd};
