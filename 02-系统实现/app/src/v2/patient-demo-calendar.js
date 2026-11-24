'use strict';

const {day,fact,insert}=require('./common');
const {chainAppointmentNumber}=require('./chain-appointment-number');
const {assertCandidateReservation}=require('./chain-reception-rules');

const PATIENT_DEMO_ACCOUNT=Object.freeze({username:'patient',password:'Patient123',patientId:2});
const PATIENT_BOOKING_REASONS=Object.freeze(['口腔检查','洁牙咨询','复诊咨询','牙痛检查','正畸咨询','修复咨询']);
const slotMilliseconds=30*60*1000;
const upgrade='patient-calendar-v1';

function installPatientDemoCalendar(db,now,booking){
 db.exec('CREATE TABLE IF NOT EXISTS chain_demo_upgrade(name TEXT PRIMARY KEY) STRICT');
 if(db.prepare('SELECT 1 FROM chain_demo_upgrade WHERE name=?').get(upgrade))return false;
 const staff=Object.fromEntries(db.prepare('SELECT login_name,staff_id FROM user_account').all().map(row=>[row.login_name,row.staff_id]));
 const chairs=Object.fromEntries(db.prepare('SELECT branch_id,min(id) id FROM dental_chair GROUP BY branch_id').all().map(row=>[row.branch_id,row.id]));
 const conflict=db.prepare(`SELECT 1 FROM dated_schedule WHERE status='已确认'
  AND (dentist_id=? OR dental_chair_id=?) AND starts_at<? AND ends_at>? LIMIT 1`);
 const formats=(date,time)=>new Date(date+'T'+time+':00+08:00').toISOString().replace('.000Z','Z');

 db.exec('BEGIN IMMEDIATE');
 try{
  // The existing first-chair consultation stays active for the treatment demo.
  // Give self-service a separate chair and a provider with audited demo roles.
  const provider=insert(db,'staff',fact(now,{name:'许医生（演示）',employed_from:day(now),employed_until:null,
   created_by:staff.manager,record_no:'DEMO-SELF-BOOKING-DENTIST'}));
  const role=db.prepare("SELECT id FROM access_role WHERE code='dentist'").get().id;
  insert(db,'staff_role_qualification',{staff_id:provider,role_id:role,valid_from:now,verified_by:staff.manager,
   verification_basis:'虚构演示接诊安排',created_at:now});
  for(const branch of [1,3]){
   insert(db,'branch_staff_role',{branch_id:branch,staff_id:provider,role_code:'dentist',valid_from:now,
    granted_by:staff.manager,granted_at:now,evidence:'虚构演示接诊安排'});
  }
  chairs[1]=insert(db,'dental_chair',fact(now,{name:'一店预约诊椅',available_from:now,available_until:null,
   created_by:staff.manager,record_no:'DEMO-SELF-BOOKING-CHAIR-A',branch_id:1}));
  const blocks=[[1,provider,'09:00','12:00'],[2,staff.manager,'09:00','17:00'],[3,provider,'14:00','17:00']];
  for(let offset=1;offset<=7;offset++){
   const date=day(Date.parse(now)+offset*86400000);
   for(const [branch,dentist,startTime,endTime] of blocks){
    const chair=chairs[branch],start=formats(date,startTime),end=formats(date,endTime);
    if(!chair||conflict.get(dentist,chair,end,start))continue;
    insert(db,'dated_schedule',fact(now,{branch_id:branch,dentist_id:dentist,dental_chair_id:chair,
     business_date:date,starts_at:start,ends_at:end,confirmed_at:now,closure_reason:null,created_by:staff.manager,
     confirmed_by:staff.manager,status:'已确认'}));
   }
  }

  const legacy=db.prepare(`SELECT a.id,a.branch_id,a.planned_start,a.record_no,b.branch_code
   FROM appointment a JOIN clinic_branch b ON b.id=a.branch_id ORDER BY a.id`).all();
  const update=db.prepare('UPDATE appointment SET record_no=? WHERE id=?');
  for(const item of legacy){
   const [code,date,sequence,...extra]=item.record_no.split('-');
   if(code===item.branch_code&&/^\d{4}$/.test(date)&&/^\d{3,}$/.test(sequence)&&!extra.length)continue;
   update.run(chainAppointmentNumber(db,item.branch_id,item.planned_start),item.id);
  }
  const date=day(Date.parse(now)+7*86400000);
  for(const [branch,time,reason] of [[1,'11:30','口腔检查'],[3,'16:30','复诊咨询']]){
   if(db.prepare('SELECT 1 FROM appointment WHERE branch_id=? AND patient_id=?').get(branch,PATIENT_DEMO_ACCOUNT.patientId))continue;
   const schedule=db.prepare("SELECT * FROM dated_schedule WHERE branch_id=? AND business_date=? AND status='已确认' ORDER BY id DESC LIMIT 1").get(branch,date);
   if(!schedule)continue;
   const start=formats(date,time),end=new Date(Date.parse(start)+slotMilliseconds).toISOString().replace('.000Z','Z');
   const app=booking.app,patientId=PATIENT_DEMO_ACCOUNT.patientId;
   try{
    app.reception.checkSchedule(schedule.id,schedule.revision,start,end);
    booking.reception.ensureDentist(schedule,branch,start,end);
    assertCandidateReservation(db,{branchId:branch,patientId,scheduleId:schedule.id,startsAt:start,endsAt:end});
   }catch(error){if(!error.status||error.status>=500)throw error;continue;}
   const actor=booking.actor(now);
   const appointment=insert(db,'appointment',fact(now,{branch_id:branch,patient_id:patientId,planned_start:start,planned_end:end,
    reason,arrangement_revision:1,due_at:end,created_by:actor,status:'已预约',record_no:chainAppointmentNumber(db,branch,start)}));
   app.reception.occupy(schedule,{start,end},{session:{staff_id:actor}},now,appointment);
  }
  booking.app.unit.validateReception();
  db.prepare('INSERT INTO chain_demo_upgrade(name) VALUES(?)').run(upgrade);
  db.exec('COMMIT');
  return true;
 }catch(error){db.exec('ROLLBACK');throw error;}
}

module.exports={PATIENT_DEMO_ACCOUNT,PATIENT_BOOKING_REASONS,slotMilliseconds,installPatientDemoCalendar};
