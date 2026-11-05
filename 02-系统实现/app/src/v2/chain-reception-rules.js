'use strict';
const { fail, id, instant } = require('./common');

function assertCandidateSchedule(db, input) {
  if (!db.isTransaction) throw new Error('排班冲突校验须在写事务内进行');
  const branch=id(input.branchId,'门店'), dentist=id(input.dentistId,'牙医'), chair=id(input.chairId,'诊椅');
  const start=instant(input.startsAt,'排班开始'), end=instant(input.endsAt,'排班结束');
  if(end<=start) fail(422,'INVALID_INPUT','排班结束必须晚于开始');
  const resource=db.prepare(`SELECT c.branch_id,b.status FROM dental_chair c JOIN clinic_branch b ON b.id=c.branch_id WHERE c.id=?`).get(chair);
  if(!resource || resource.branch_id!==branch || resource.status!=='active') fail(409,'CHAIR_UNAVAILABLE','诊椅不属于当前启用门店');
  const excluded=input.scheduleId == null ? 0 : id(input.scheduleId,'原排班');
  if(excluded && !db.prepare('SELECT 1 FROM dated_schedule WHERE id=? AND branch_id=?').get(excluded,branch))
    fail(409,'SCHEDULE_CHANGED','原排班不属于当前门店');
  const conflict=db.prepare(`SELECT 1 FROM dated_schedule WHERE id<>? AND status='已确认'
    AND starts_at<? AND ?<ends_at AND (dentist_id=? OR dental_chair_id=?) LIMIT 1`).get(excluded,end,start,dentist,chair);
  if(conflict) fail(409,'SCHEDULE_CONFLICT','牙医或诊椅在该时段已有排班');
  return {branchId:branch,dentistId:dentist,chairId:chair,startsAt:start,endsAt:end};
}
// Candidate guard, not connected to production. The caller must authorize the
// current branch and hold an IMMEDIATE write transaction through reservation.
function assertCandidateReservation(db, input) {
  if (!db.isTransaction) throw new Error('预约冲突校验须在写事务内进行');
  const branch=id(input.branchId,'门店'), patient=id(input.patientId,'患者'), schedule=id(input.scheduleId,'排班');
  const start=instant(input.startsAt,'预约开始'), end=instant(input.endsAt,'预约结束');
  if (end<=start) fail(422,'INVALID_INPUT','预约结束必须晚于开始');
  const s=db.prepare(`SELECT s.id,s.branch_id,s.dentist_id,s.dental_chair_id,s.starts_at,s.ends_at,s.status,
    c.branch_id chair_branch,b.status branch_status FROM dated_schedule s
    JOIN dental_chair c ON c.id=s.dental_chair_id JOIN clinic_branch b ON b.id=s.branch_id WHERE s.id=?`).get(schedule);
  if (!s || s.branch_id!==branch || s.chair_branch!==branch || s.branch_status!=='active' || s.status!=='已确认' || start<s.starts_at || end>s.ends_at)
    fail(409,'SCHEDULE_CHANGED','门店、诊椅或已确认排班不适用于该时段');
  const excluded=input.excludedOccupancyId == null ? 0 : id(input.excludedOccupancyId,'原占用');
  // Exclusion is valid only for an active reservation belonging to the same
  // patient and branch. Actual use cannot be released by rescheduling.
  if(excluded) {
    const originalAppointment=id(input.originalAppointmentId,'原预约');
    const old=db.prepare(`SELECT o.visit_id, v.started_at, a.id appointment_id, a.patient_id, a.branch_id
      FROM resource_occupancy o JOIN appointment a ON a.id=o.appointment_id
      LEFT JOIN visit v ON v.id=o.visit_id WHERE o.id=? AND o.released_at IS NULL`).get(excluded);
    if(!old || old.appointment_id!==originalAppointment || old.patient_id!==patient || old.branch_id!==branch || old.started_at)
      fail(409,'OCCUPANCY_SOURCE','原预留不属于当前患者与门店或已经实际使用');
  }
  const overlapping=db.prepare(`SELECT s.dentist_id,s.dental_chair_id,
    COALESCE(a.patient_id,v.patient_id) patient_id
    FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id
    LEFT JOIN appointment a ON a.id=o.appointment_id LEFT JOIN visit v ON v.id=o.visit_id
    WHERE o.released_at IS NULL AND o.id<>? AND
      ((o.starts_at<? AND ?<o.ends_at) OR v.started_at IS NOT NULL)`).all(excluded,end,start);
  if(overlapping.some(o=>o.patient_id==null))
    fail(409,'OCCUPANCY_UNVERIFIED','重叠占用来源不明，请先核对原记录');
  if(overlapping.some(o=>o.dentist_id===s.dentist_id || o.dental_chair_id===s.dental_chair_id || o.patient_id===patient))
    fail(409,'RESOURCE_CONFLICT','患者、牙医或诊椅在该时段已有占用');
  return {branchId:branch,patientId:patient,scheduleId:schedule,startsAt:start,endsAt:end};
}
module.exports={assertCandidateReservation,assertCandidateSchedule};
