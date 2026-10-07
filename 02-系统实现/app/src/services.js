const { nextNo, audit } = require('./db');

const ACTIVE_APPOINTMENT_STATES = ['confirmed', 'arrived'];
const APPOINTMENT_TRANSITIONS = {
  confirmed: ['arrived', 'cancelled'],
};

function rolesOf(user) {
  return String(user?.roles || '').split(',').filter(Boolean);
}
function hasRole(user, ...roles) {
  return roles.some(r => rolesOf(user).includes(r));
}
function requireRole(user, ...roles) {
  if (!hasRole(user, ...roles)) {
    const err = new Error('当前角色不能执行此操作');
    err.status = 403;
    throw err;
  }
}

function reject(status, message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, { status }, extra);
  throw err;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) reject(400, `${label}无效`);
  return id;
}

function timestamp(value, label) {
  if (typeof value !== 'string' && !(value instanceof Date)) reject(400, `${label}无效`);
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (!match) reject(400, `${label}无效`);
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || (second || 0) > 59) reject(400, `${label}无效`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) reject(400, `${label}无效`);
  return parsed;
}

function patientForAppointment(db, patientId) {
  const patient = db.prepare('SELECT * FROM patients WHERE id=? AND active=1').get(patientId);
  if (!patient) reject(400, '患者不存在或未启用');
  if (!String(patient.full_name || '').trim() || !String(patient.phone || '').trim()) reject(400, '预约患者姓名和联系电话为必填');
  return patient;
}

function assignedDentist(db, dentistId) {
  const dentist = db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND (','||roles||',') LIKE '%,dentist,%'").get(dentistId);
  if (!dentist) reject(400, '所选牙医不存在或未启用');
  return dentist;
}

function checkVersion(appointment, expectedVersion, required = false) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') {
    if (required) reject(400, '必须提交预约当前版本');
    return;
  }
  const version = positiveId(expectedVersion, '预约版本');
  if (version !== appointment.version) reject(409, '预约已被其他操作修改，请重新核对', { appointment });
}

function findConflict(db, { dentistId, chairId, patientId = null, startAt, endAt, excludeId = null }) {
  const states = ACTIVE_APPOINTMENT_STATES.map(() => '?').join(',');
  return db.prepare(`SELECT a.id,a.appointment_no,a.start_at,a.end_at,
      CASE WHEN a.dentist_id=? THEN 'dentist' WHEN a.patient_id=? THEN 'patient' ELSE 'chair' END AS conflict_type
    FROM appointments a
    WHERE a.status IN (${states})
      AND (? IS NULL OR a.id<>?)
      AND (a.dentist_id=? OR a.chair_id=? OR (? IS NOT NULL AND a.patient_id=?))
      AND a.start_at < ? AND a.end_at > ?
    LIMIT 1`).get(dentistId, patientId, ...ACTIVE_APPOINTMENT_STATES, excludeId, excludeId, dentistId, chairId ?? null, patientId, patientId, endAt, startAt);
}

function minutesOf(date) { return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000; }
function minutesOfClock(value) { const [hour,minute] = String(value).split(':').map(Number); return hour * 60 + minute; }
function validateAvailability(db, { dentistId, chairId, serviceId, startAt, endAt }) {
  assignedDentist(db, dentistId);
  if (!db.prepare('SELECT id FROM chairs WHERE id=? AND active=1').get(chairId)) { const e=new Error('所选牙椅不存在或已停用');e.status=400;throw e; }
  if (serviceId && !db.prepare('SELECT id FROM services WHERE id=? AND active=1').get(serviceId)) { const e=new Error('所选服务项目不存在或已停用');e.status=400;throw e; }
  const weekday=startAt.getDay();const clinic=db.prepare('SELECT * FROM clinic_hours WHERE weekday=? AND active=1').get(weekday);
  if(!clinic){const e=new Error('所选日期诊所不营业');e.status=409;throw e;}
  const schedule=db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=? AND active=1').get(dentistId,weekday);
  if(!schedule){const e=new Error('所选牙医当天没有排班');e.status=409;throw e;}
  const startMinute=minutesOf(startAt),endMinute=minutesOf(endAt);
  const allowedStart=Math.max(minutesOfClock(clinic.open_time),minutesOfClock(schedule.start_time));
  const allowedEnd=Math.min(minutesOfClock(clinic.close_time),minutesOfClock(schedule.end_time));
  if(!Number.isFinite(allowedStart)||!Number.isFinite(allowedEnd)||startAt.toDateString()!==endAt.toDateString()||startMinute<allowedStart||endMinute>allowedEnd){const e=new Error('预约时间不在诊所营业时间或牙医班次内');e.status=409;throw e;}
  const leave=db.prepare("SELECT id,reason FROM staff_leaves WHERE user_id=? AND status='approved' AND start_at<? AND end_at>? LIMIT 1").get(dentistId,endAt.toISOString(),startAt.toISOString());
  if(leave){const e=new Error(`所选牙医该时段请假：${leave.reason}`);e.status=409;throw e;}
}

function appointmentInput(db, input) {
  if (input.status !== undefined && input.status !== 'confirmed') reject(400, '预约初始状态只能为已预约');
  const patientId = positiveId(input.patientId, '患者');
  const dentistId = positiveId(input.dentistId, '牙医');
  const chairId = positiveId(input.chairId, '牙椅');
  const serviceId = input.serviceId == null || input.serviceId === '' ? null : positiveId(input.serviceId, '服务项目');
  const startAt = timestamp(input.startAt, '预约开始时间');
  const endAt = timestamp(input.endAt, '预约结束时间');
  if (endAt <= startAt || startAt.getTime() < Date.now()) reject(400, '预约结束必须晚于开始，开始不得早于当前时间');
  patientForAppointment(db, patientId);
  validateAvailability(db, { dentistId, chairId, serviceId, startAt, endAt });
  const confirmedBy = positiveId(input.arrangementConfirmedBy, '安排确认牙医');
  if (confirmedBy !== dentistId) reject(400, '安排确认人必须为本次接诊牙医');
  assignedDentist(db, confirmedBy);
  const confirmedAt = timestamp(input.arrangementConfirmedAt, '安排确认时间');
  if (confirmedAt.getTime() > Date.now()) reject(400, '安排确认时间不得晚于当前时间');
  return { patientId, dentistId, chairId, serviceId, startAt: startAt.toISOString(), endAt: endAt.toISOString(), confirmedBy, confirmedAt: confirmedAt.toISOString() };
}

function checkAppointmentConflict(db, values, excludeId = null) {
  const conflict = findConflict(db, { ...values, excludeId });
  if (conflict) {
    const label = { dentist: '牙医', chair: '牙椅', patient: '患者' }[conflict.conflict_type];
    reject(409, `预约冲突：${label}在${conflict.start_at}至${conflict.end_at}已有有效预约`, { conflict });
  }
}

function createAppointment(db, input, user) {
  requireRole(user, 'frontdesk');
  db.exec('BEGIN IMMEDIATE');
  try {
    const values = appointmentInput(db, input);
    checkAppointmentConflict(db, values);
    const no = nextNo(db, 'appointments', 'appointment_no', 'A');
    const result = db.prepare(`INSERT INTO appointments(appointment_no,patient_id,dentist_id,chair_id,service_id,start_at,end_at,status,source,patient_note,internal_note,created_by,version,arrangement_confirmed_by,arrangement_confirmed_at)
      VALUES(?,?,?,?,?,?,?,'confirmed','frontdesk',?,?,?,1,?,?)`).run(no, values.patientId, values.dentistId, values.chairId, values.serviceId,
      values.startAt, values.endAt, input.patientNote || null, input.internalNote || null, user.id, values.confirmedBy, values.confirmedAt);
    db.prepare('INSERT INTO appointment_history(appointment_id,from_status,to_status,reason,changed_by) VALUES(?,?,?,?,?)')
      .run(Number(result.lastInsertRowid), null, 'confirmed', '创建预约', user.id);
    audit(db, user.id, 'appointment.create', 'appointment', result.lastInsertRowid, values.patientId, { appointmentNo: no });
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(result.lastInsertRowid));
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function updateAppointment(db, appointmentId, input, user) {
  requireRole(user, 'frontdesk');
  const reason = String(input.reason || '').trim();
  if (!reason) reject(400, '修改预约必须填写原因');
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
    if (!before) reject(404, '预约不存在');
    if (before.status !== 'confirmed' || db.prepare('SELECT id FROM encounters WHERE appointment_id=?').get(appointmentId)) reject(409, '已到诊或已取消预约不能修改');
    checkVersion(before, input.expectedVersion, true);
    const values = appointmentInput(db, {
      patientId: before.patient_id, dentistId: before.dentist_id, chairId: before.chair_id,
      serviceId: before.service_id, startAt: before.start_at, endAt: before.end_at,
      ...input,
    });
    checkAppointmentConflict(db, values, before.id);
    const result = db.prepare(`UPDATE appointments SET patient_id=?,dentist_id=?,chair_id=?,service_id=?,start_at=?,end_at=?,patient_note=?,internal_note=?,
      arrangement_confirmed_by=?,arrangement_confirmed_at=?,version=version+1 WHERE id=? AND version=?`).run(values.patientId, values.dentistId, values.chairId, values.serviceId,
      values.startAt, values.endAt, input.patientNote === undefined ? before.patient_note : input.patientNote || null,
      input.internalNote === undefined ? before.internal_note : input.internalNote || null, values.confirmedBy, values.confirmedAt, appointmentId, before.version);
    if (Number(result.changes) !== 1) reject(409, '预约版本已变化，请重新核对');
    const after = db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
    db.prepare('INSERT INTO appointment_history(appointment_id,from_status,to_status,reason,changed_by) VALUES(?,?,?,?,?)')
      .run(appointmentId, before.status, after.status, reason, user.id);
    audit(db, user.id, 'appointment.update', 'appointment', appointmentId, after.patient_id, { reason, before, after });
    db.exec('COMMIT');
    return after;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function changeAppointmentStatus(db, appointmentId, nextStatus, reason, user, expectedVersion) {
  requireRole(user, 'frontdesk');
  if (!['arrived', 'cancelled'].includes(nextStatus)) reject(409, '预约仅支持登记到诊或取消，不承载诊疗状态');
  const changeReason = String(reason || '').trim();
  if (nextStatus === 'cancelled' && !changeReason) reject(400, '取消预约必须填写原因');
  db.exec('BEGIN IMMEDIATE');
  try {
    const appt = db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
    if (!appt) reject(404, '预约不存在');
    let encounter = db.prepare('SELECT * FROM encounters WHERE appointment_id=?').get(appointmentId);
    if (encounter && (encounter.patient_id !== appt.patient_id || encounter.dentist_id !== appt.dentist_id)) reject(409, '就诊与预约患者或接诊牙医不一致，请核实');
    if (nextStatus === 'arrived' && appt.status === 'arrived') {
      if (!encounter) reject(409, '原到诊登记缺少关联就诊，请核实');
      db.exec('COMMIT');
      return { appointment: appt, encounter, alreadyArrived: true, encounterId: encounter.id, encounterNo: encounter.encounter_no };
    }
    if (!(APPOINTMENT_TRANSITIONS[appt.status] || []).includes(nextStatus)) reject(409, `不能从“${appt.status}”变更为“${nextStatus}”`);
    checkVersion(appt, expectedVersion);
    if (nextStatus === 'cancelled' && encounter) reject(409, '已经到诊的预约不能取消');
    if (nextStatus === 'arrived') {
      if (new Date(appt.start_at).toDateString() !== new Date().toDateString()) reject(409, '只能登记当日预约到诊');
      patientForAppointment(db, appt.patient_id);
      assignedDentist(db, appt.dentist_id);
      if (!encounter) {
        const no = nextNo(db, 'encounters', 'encounter_no', 'E');
        const created = db.prepare(`INSERT INTO encounters(encounter_no,patient_id,appointment_id,dentist_id,status) VALUES(?,?,?,?,'draft')`)
          .run(no, appt.patient_id, appt.id, appt.dentist_id);
        encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(Number(created.lastInsertRowid));
      }
    }
    const updated = db.prepare('UPDATE appointments SET status=?,version=version+1 WHERE id=? AND version=?').run(nextStatus, appointmentId, appt.version);
    if (Number(updated.changes) !== 1) reject(409, '预约版本已变化，请重新核对');
    db.prepare('INSERT INTO appointment_history(appointment_id,from_status,to_status,reason,changed_by) VALUES(?,?,?,?,?)')
      .run(appointmentId, appt.status, nextStatus, changeReason || '登记到诊', user.id);
    audit(db, user.id, 'appointment.status', 'appointment', appointmentId, appt.patient_id, { from: appt.status, to: nextStatus, reason: changeReason, encounterId: encounter?.id });
    const appointment = db.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
    db.exec('COMMIT');
    return { appointment, encounter: encounter || null, alreadyArrived: false, encounterId: encounter?.id || null, encounterNo: encounter?.encounter_no || null };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function signEncounter(db, encounterId, user, expectedVersion) {
  requireRole(user, 'dentist');
  const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
  if (!encounter) { const e = new Error('就诊记录不存在'); e.status = 404; throw e; }
  if (encounter.dentist_id !== user.id) reject(403, '只能签署本人接诊的病历');
  if (encounter.status === 'signed' || encounter.status === 'amended') {
    if(expectedVersion!=null&&Number(expectedVersion)!==encounter.signed_version) reject(409,'病历签署版本不一致，请重新查询');
    return {ok:true,replayed:true,signedAt:encounter.signed_at,signedBy:encounter.signed_by,version:encounter.version};
  }
  if(expectedVersion!=null)require('./workflows').version(encounter,{expectedVersion});
  const missing = [];
  if (!String(encounter.chief_complaint || '').trim()) missing.push('主诉');
  if (!String(encounter.diagnosis || '').trim()) missing.push('诊断');
  if (!db.prepare('SELECT id FROM tooth_findings WHERE encounter_id=? LIMIT 1').get(encounterId)) missing.push('牙位及检查所见');
  if (!String(encounter.clinical_notes||'').trim()) missing.push('诊疗经过');
  if (!String(encounter.instructions || '').trim()) missing.push('医嘱');
  if (missing.length) { const e = new Error(`不能签署，缺少：${missing.join('、')}`); e.status = 400; throw e; }
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE encounters SET status='signed',signed_at=CURRENT_TIMESTAMP,signed_by=?,signed_version=version,version=version+1,ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(user.id, encounterId);
    audit(db, user.id, 'clinical.sign', 'encounter', encounterId, encounter.patient_id, null);
    db.exec('COMMIT');
    const signed=db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
    return {ok:true,replayed:false,signedAt:signed.signed_at,signedBy:signed.signed_by,version:signed.version};
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function amendEncounter(db, encounterId, text, reason, user) {
  requireRole(user, 'dentist');
  const encounter = db.prepare('SELECT * FROM encounters WHERE id=?').get(encounterId);
  if (!encounter) { const e = new Error('就诊记录不存在'); e.status = 404; throw e; }
  if (encounter.dentist_id !== user.id) reject(403, '只能更正本人接诊的病历');
  if (!['signed', 'amended'].includes(encounter.status)) { const e = new Error('只有已签署病历可以补充更正'); e.status = 409; throw e; }
  if (!String(text || '').trim() || !String(reason || '').trim()) { const e = new Error('更正内容和原因均为必填'); e.status = 400; throw e; }
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO record_amendments(encounter_id,amendment_text,reason,signed_by) VALUES(?,?,?,?)').run(encounterId, String(text).trim(), String(reason).trim(), user.id);
    db.prepare("UPDATE encounters SET status='amended',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(encounterId);
    audit(db, user.id, 'clinical.amend', 'encounter', encounterId, encounter.patient_id, { reason });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function recalculateInvoice(db, invoiceId) {
  const line = db.prepare('SELECT COALESCE(SUM(CAST(ROUND(line_amount*100) AS INTEGER)),0) AS cents FROM invoice_lines WHERE invoice_id=?').get(invoiceId);
  const payments = db.prepare('SELECT COALESCE(SUM(CAST(ROUND(amount*100) AS INTEGER)),0) AS cents,COUNT(*) AS count FROM payments WHERE invoice_id=?').get(invoiceId);
  const refunds = db.prepare('SELECT COALESCE(SUM(CAST(ROUND(amount*100) AS INTEGER)),0) AS cents FROM refunds WHERE invoice_id=?').get(invoiceId);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!invoice) reject(404, '账单不存在');
  const dueCents = Math.max(0, Number(line.cents) - Math.round(Number(invoice.discount_amount) * 100) - Math.round(Number(invoice.credited_amount) * 100));
  const paidCents = Number(payments.cents), refundedCents = Number(refunds.cents);
  const balanceCents = Math.max(0, dueCents - paidCents + refundedCents);
  let status = 'pending';
  if (refundedCents > 0 && refundedCents >= paidCents) status = 'refunded';
  else if (refundedCents > 0) status = 'partially_refunded';
  else if (balanceCents === 0 && (dueCents > 0 || payments.count > 0)) status = 'paid';
  else if (paidCents - refundedCents > 0) status = 'partially_paid';
  db.prepare(`UPDATE invoices SET gross_amount=?,paid_amount=?,refunded_amount=?,balance=?,status=? WHERE id=?`)
    .run(Number(line.cents) / 100, paidCents / 100, refundedCents / 100, balanceCents / 100, status, invoiceId);
  return db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
}

module.exports = { rolesOf, hasRole, requireRole, findConflict, validateAvailability, createAppointment, updateAppointment, changeAppointmentStatus, signEncounter, amendEncounter, recalculateInvoice, APPOINTMENT_TRANSITIONS };
