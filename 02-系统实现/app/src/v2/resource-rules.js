'use strict';
const { fail, id, row, insert, fact } = require('./common');
const PHYSICAL_END = '实际操作结束，转清洁核验';
function equipmentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length>20) fail(422,'INVALID_EQUIPMENT','必要设备应为最多20项的编号列表');
  const ids=value.map(v=>id(v,'设备'));
  if (new Set(ids).size!==ids.length) fail(422,'INVALID_EQUIPMENT','必要设备不能重复选择');
  return ids;
}
function assertReady(db, chairId, ids, before) {
  const chair=row(db,'dental_chair',chairId);
  if (chair.available_from>=before || (chair.available_until && chair.available_until<before)) fail(409,'CHAIR_UNAVAILABLE','诊椅当前不可用');
  const blocks=db.prepare(`SELECT * FROM resource_block WHERE status='生效中' AND dental_chair_id=? AND starts_at<?`).all(chairId,before);
  if (blocks.length) fail(409,'RESOURCE_BLOCKED','诊椅仍在清洁、准备或停用中，须核验恢复后再安排',{blocks});
  for (const eqId of ids) {
    const e=row(db,'clinical_equipment',eqId);
    if (e.status!=='可用') fail(409,'EQUIPMENT_UNAVAILABLE','所需设备已停用',{equipmentId:e.id});
    if (e.dental_chair_id && e.dental_chair_id!==chairId) fail(409,'EQUIPMENT_CHAIR','固定设备不属于当前诊椅');
    const blocked=db.prepare(`SELECT * FROM resource_block WHERE equipment_id=? AND status='生效中' AND starts_at<?`).all(e.id,before);
    if (blocked.length) fail(409,'RESOURCE_BLOCKED','必要设备仍在准备或停用中',{blocks:blocked});
  }
}
function reserveEquipment(db, chairId, ids, start, end, now, appointmentId, visitId=null) {
  assertReady(db,chairId,ids,end);
  for (const equipmentId of ids) insert(db,'equipment_occupancy',fact(now,{
    equipment_id:equipmentId,appointment_id:appointmentId,visit_id:visitId,starts_at:start,ends_at:end,
    actual_ended_at:null,status:'已预留',release_reason:null
  }));
}
function releaseReservations(db, appointmentId, now, reason) {
  if (db.prepare("SELECT id FROM equipment_occupancy WHERE appointment_id=? AND status='使用中'").get(appointmentId)) fail(409,'EQUIPMENT_IN_USE','实际使用中的设备不能按预约取消释放');
  db.prepare(`UPDATE equipment_occupancy SET status='已释放',release_reason=?,updated_at=?,revision=revision+1 WHERE appointment_id=? AND status='已预留'`).run(reason,now,appointmentId);
}
function startResources(db, visit, occupancy, now) {
  const schedule=row(db,'dated_schedule',occupancy.dated_schedule_id);
  const eq=db.prepare("SELECT * FROM equipment_occupancy WHERE visit_id=? AND status='已预留'").all(visit.id);
  assertReady(db,schedule.dental_chair_id,eq.map(x=>x.equipment_id),new Date(Date.parse(now)+1000).toISOString().replace('.000Z','Z'));
  const busy=db.prepare(`SELECT o.id,o.visit_id,s.dental_chair_id,s.dentist_id FROM resource_occupancy o
    JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN visit v ON v.id=o.visit_id
    WHERE o.released_at IS NULL AND v.started_at IS NOT NULL AND v.id<>?
    AND (s.dental_chair_id=? OR s.dentist_id=? OR v.patient_id=?)`).all(visit.id,schedule.dental_chair_id,visit.dentist_id,visit.patient_id);
  if (busy.length) fail(409,'RESOURCE_STILL_IN_USE','前次实际操作尚未确认结束，预计结束时间和病历签署均不释放使用中的资源',{occupancies:busy});
  for (const e of eq) if (db.prepare("SELECT id FROM equipment_occupancy WHERE equipment_id=? AND status='使用中' AND id<>?").get(e.equipment_id,e.id)) fail(409,'EQUIPMENT_STILL_IN_USE','设备前次实际使用尚未结束');
  db.prepare("UPDATE equipment_occupancy SET status='使用中',updated_at=?,revision=revision+1 WHERE visit_id=? AND status='已预留'").run(now,visit.id);
}
module.exports = { PHYSICAL_END, equipmentIds, assertReady, reserveEquipment, releaseReservations, startResources };
