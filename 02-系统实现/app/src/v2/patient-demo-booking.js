'use strict';
// Local fictitious-patient demonstration. A separate technical actor satisfies
// the legacy staff foreign keys; no staff login or branch privilege is used.
const {fail,id,instant,text,insert,fact,hash,canonical,revision,day}=require('./common');
const {assertCandidateReservation}=require('./chain-reception-rules');
const {chainAppointmentNumber}=require('./chain-appointment-number');
const {PATIENT_BOOKING_REASONS,slotMilliseconds,bookingHorizonMilliseconds}=require('./patient-demo-calendar');
class PatientDemoBooking {
 constructor(app,reception,now=()=>app.auth.now()){this.app=app;this.now=now;this.db=app.db;this.reception=reception;this.db.exec(`CREATE TABLE IF NOT EXISTS patient_demo_receipt(patient_id INTEGER NOT NULL,request_key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(patient_id,request_key)) STRICT`);}
 actor(now){let actor=this.db.prepare("SELECT id FROM staff WHERE record_no='PATIENT-DEMO-SYSTEM-ACTOR'").get();if(!actor){const key=insert(this.db,'staff',fact(now,{name:'患者自助演示系统',employed_from:day(now),employed_until:null,created_by:null,record_no:'PATIENT-DEMO-SYSTEM-ACTOR'}));actor={id:key};}return actor.id;}
 command(patientId,input){const db=this.db,branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),digest=hash(canonical(input)),now=this.now();db.exec('BEGIN IMMEDIATE');try{
 const previous=db.prepare('SELECT digest,result FROM patient_demo_receipt WHERE patient_id=? AND request_key=?').get(patientId,key);
 if(previous){if(previous.digest!==digest)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');db.exec('COMMIT');return {...JSON.parse(previous.result),replayed:true};}
 const actor=this.actor(now),ctx={session:{staff_id:actor}},patient=db.prepare('SELECT id FROM patient WHERE id=?').get(patientId);if(!patient)fail(404,'PATIENT_MISSING','演示患者不存在');
 let result;
 if(input.action==='create'){
  const reason=input.reason;
  if(!PATIENT_BOOKING_REASONS.includes(reason))fail(422,'INVALID_BOOKING_REASON','请选择就诊目的');
  const start=instant(input.startsAt,'预约开始'),end=instant(input.endsAt,'预约结束');if(start<=now)fail(422,'PAST_APPOINTMENT','预约开始必须晚于当前时间');
  if(Date.parse(start)%slotMilliseconds||Date.parse(end)-Date.parse(start)!==slotMilliseconds||Date.parse(end)>Date.parse(now)+bookingHorizonMilliseconds)
   fail(422,'INVALID_BOOKING_SLOT','请选择日历中提供的 30 分钟时段');
  const schedule=this.app.reception.checkSchedule(input.scheduleId,input.scheduleRevision,start,end);
  assertCandidateReservation(db,{branchId:branch,patientId,scheduleId:schedule.id,startsAt:start,endsAt:end});this.reception.ensureDentist(schedule,branch,start,end);
  const recordNo=chainAppointmentNumber(db,branch,start);
  const keyId=insert(db,'appointment',fact(now,{branch_id:branch,patient_id:patientId,planned_start:start,planned_end:end,reason:'患者自助演示：'+reason,due_at:end,arrangement_revision:1,status_reason:null,notified_at:null,created_by:actor,notified_by:null,status:'已预约',record_no:recordNo}));
  this.app.reception.occupy(schedule,{start,end},ctx,now,keyId);result={kind:'appointment',id:keyId,revision:1,recordNo};
 }else if(input.action==='cancel'){
  const old=db.prepare('SELECT * FROM appointment WHERE id=? AND patient_id=? AND branch_id=?').get(id(input.appointmentId,'预约'),patientId,branch);if(!old)fail(403,'PATIENT_SCOPE','预约不属于当前患者');
  revision(old,input.expectedRevision);if(old.status!=='已预约')fail(409,'INVALID_STATE','仅可取消尚未到诊的预约');
  if(db.prepare('SELECT 1 FROM contact_history WHERE appointment_id=? LIMIT 1').get(old.id))fail(409,'FOLLOWUP_LINKED','该预约已关联复诊，请联系门店协调');
  const occupancy=db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(old.id);if(!occupancy||occupancy.visit_id)fail(409,'OCCUPANCY_SOURCE','预约状态已变化，请刷新');
  if(db.prepare("SELECT 1 FROM equipment_occupancy WHERE appointment_id=? AND status='已预留'").get(old.id))fail(409,'EQUIPMENT_RESERVED','预约包含特殊设备，请联系门店协调');
  this.app.reception.release(occupancy,ctx,now,'患者自助取消');
  db.prepare("UPDATE appointment SET status='已取消',status_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run('患者自助取消',now,old.id);
  insert(db,'appointment_change',fact(now,{appointment_id:old.id,old_start:old.planned_start,old_end:old.planned_end,old_revision:old.arrangement_revision,new_start:null,new_end:null,new_revision:old.arrangement_revision,reason:'患者自助取消',occurred_at:now,change_kind:'取消',operator_id:actor,old_schedule_id:occupancy.dated_schedule_id,new_schedule_id:null}));
  result={kind:'appointment',id:old.id,revision:old.revision+1};
 }else fail(422,'INVALID_ACTION','请选择预约或取消');
 this.app.unit.validateReception();db.prepare('INSERT INTO patient_demo_receipt VALUES(?,?,?,?)').run(patientId,key,digest,JSON.stringify(result));db.exec('COMMIT');return result;
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}}
}
module.exports={PatientDemoBooking};
