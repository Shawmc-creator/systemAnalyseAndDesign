const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { createAppointment, updateAppointment, changeAppointmentStatus, signEncounter, amendEncounter, recalculateInvoice } = require('../src/services');

function setup(t) {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const front = db.prepare("SELECT * FROM users WHERE username='frontdesk'").get();
  const dentist = db.prepare("SELECT * FROM users WHERE username='dentist'").get();
  const manager = db.prepare("SELECT * FROM users WHERE username='manager'").get();
  const assistant = db.prepare("SELECT * FROM users WHERE username='assistant'").get();
  const inserted = db.prepare("INSERT INTO users(username,display_name,password_hash,roles,active) VALUES('requirements.dentist','第二牙医',?,'dentist',1)").run(dentist.password_hash);
  const otherDentist = db.prepare('SELECT * FROM users WHERE id=?').get(Number(inserted.lastInsertRowid));
  db.prepare(`INSERT INTO dentist_schedules(dentist_id,weekday,start_time,end_time,active)
    SELECT ?,weekday,start_time,end_time,active FROM dentist_schedules WHERE dentist_id=?`).run(otherDentist.id, dentist.id);
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(10, 0, 0, 0);
  while (!db.prepare('SELECT 1 FROM clinic_hours WHERE weekday=? AND active=1').get(date.getDay()) ||
    !db.prepare('SELECT 1 FROM dentist_schedules WHERE dentist_id=? AND weekday=? AND active=1').get(dentist.id, date.getDay())) date.setDate(date.getDate() + 1);
  const input = {
    patientId: 1, dentistId: dentist.id, chairId: 1, serviceId: 1,
    startAt: date.toISOString(), endAt: new Date(date.getTime() + 30 * 60000).toISOString(),
    arrangementConfirmedBy: dentist.id, arrangementConfirmedAt: new Date().toISOString(),
  };
  return { db, front, dentist, manager, assistant, otherDentist, input };
}

function todayAppointment(context) {
  const appointment = createAppointment(context.db, context.input, context.front);
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  context.db.prepare('UPDATE appointments SET start_at=?,end_at=? WHERE id=?')
    .run(today.toISOString(), new Date(today.getTime() + 30 * 60000).toISOString(), appointment.id);
  return context.db.prepare('SELECT * FROM appointments WHERE id=?').get(appointment.id);
}

test('UC01同一患者不能在不同牙医、不同牙椅预约重叠时段', t => {
  const c = setup(t);
  createAppointment(c.db, c.input, c.front);
  assert.throws(() => createAppointment(c.db, {
    ...c.input, dentistId: c.otherDentist.id, chairId: 2, arrangementConfirmedBy: c.otherDentist.id,
  }, c.front), err => err.status === 409 && err.conflict.conflict_type === 'patient');
});

test('UC01负责人兼任前台也不能用加号原因绕过冲突', t => {
  const c = setup(t);
  createAppointment(c.db, c.input, c.front);
  const before = c.db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
  assert.throws(() => createAppointment(c.db, { ...c.input, patientId: 2, exceptionReason: '负责人特批' },
    { ...c.front, roles: 'frontdesk,manager' }), err => err.status === 409);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n, before);
});

test('UC01创建只能由前台办理且初始状态只能已预约', t => {
  const c = setup(t);
  assert.throws(() => createAppointment(c.db, c.input, { ...c.manager, roles: 'manager' }), err => err.status === 403);
  for (const status of ['arrived', 'cancelled', 'pending', 'completed', 'anything']) {
    assert.throws(() => createAppointment(c.db, { ...c.input, status }, c.front), err => err.status === 400);
  }
});

test('UC01拒绝过去时间、无效日历日期与未来安排确认时间', t => {
  const c = setup(t);
  const past = Date.now() - 86400000;
  assert.throws(() => createAppointment(c.db, { ...c.input, startAt: new Date(past).toISOString(), endAt: new Date(past + 1800000).toISOString() }, c.front), err => err.status === 400);
  assert.throws(() => createAppointment(c.db, { ...c.input, startAt: '2031-02-30T10:00:00.000Z' }, c.front), err => err.status === 400);
  assert.throws(() => createAppointment(c.db, { ...c.input, arrangementConfirmedAt: new Date(Date.now() + 60000).toISOString() }, c.front), err => err.status === 400);
});

test('UC01必须有有效患者及本次接诊牙医的安排确认事实', t => {
  const c = setup(t);
  assert.throws(() => createAppointment(c.db, { ...c.input, patientId: 999999 }, c.front), err => err.status === 400);
  assert.throws(() => createAppointment(c.db, { ...c.input, arrangementConfirmedBy: c.otherDentist.id }, c.front), err => err.status === 400);
  assert.throws(() => createAppointment(c.db, { ...c.input, arrangementConfirmedAt: undefined }, c.front), err => err.status === 400);
  c.db.prepare('UPDATE patients SET phone=NULL WHERE id=1').run();
  assert.throws(() => createAppointment(c.db, c.input, c.front), err => err.status === 400 && /联系电话/.test(err.message));
});

test('UC01修改保留同一预约编号，排除自身冲突并保存新版本及原安排', t => {
  const c = setup(t);
  const original = createAppointment(c.db, c.input, c.front);
  const updated = updateAppointment(c.db, original.id, {
    ...c.input, expectedVersion: original.version, reason: '补充候诊说明', internalNote: '请提前十分钟到诊',
  }, c.front);
  assert.equal(updated.id, original.id);
  assert.equal(updated.appointment_no, original.appointment_no);
  assert.equal(updated.version, original.version + 1);
  const event = c.db.prepare("SELECT details FROM audit_events WHERE action='appointment.update' ORDER BY id DESC LIMIT 1").get();
  const details = JSON.parse(event.details);
  assert.equal(details.before.start_at, original.start_at);
  assert.equal(details.after.internal_note, '请提前十分钟到诊');
});

test('UC01过期版本与缺少变更原因不能覆盖当前有效安排', t => {
  const c = setup(t);
  const original = createAppointment(c.db, c.input, c.front);
  assert.throws(() => updateAppointment(c.db, original.id, { ...c.input, expectedVersion: original.version }, c.front), err => err.status === 400);
  assert.throws(() => updateAppointment(c.db, original.id, { ...c.input, reason: '调整' }, c.front), err => err.status === 400);
  updateAppointment(c.db, original.id, { ...c.input, expectedVersion: original.version, reason: '调整说明', internalNote: '当前内容' }, c.front);
  assert.throws(() => updateAppointment(c.db, original.id, { ...c.input, expectedVersion: original.version, reason: '旧页面覆盖', internalNote: '旧内容' }, c.front), err => err.status === 409);
  assert.equal(c.db.prepare('SELECT internal_note FROM appointments WHERE id=?').get(original.id).internal_note, '当前内容');
});

test('UC01修改成另一有效预约的时段时拒绝且保留原安排', t => {
  const c = setup(t);
  const first = createAppointment(c.db, c.input, c.front);
  const later = { ...c.input, patientId: 2, startAt: new Date(new Date(c.input.startAt).getTime() + 3600000).toISOString(), endAt: new Date(new Date(c.input.endAt).getTime() + 3600000).toISOString() };
  createAppointment(c.db, later, c.front);
  assert.throws(() => updateAppointment(c.db, first.id, { ...later, patientId: 1, expectedVersion: first.version, reason: '换到已占用时段' }, c.front), err => err.status === 409);
  assert.equal(c.db.prepare('SELECT start_at FROM appointments WHERE id=?').get(first.id).start_at, first.start_at);
});

test('UC01取消须原因并释放时段，已取消预约不能修改或到诊', t => {
  const c = setup(t);
  const original = createAppointment(c.db, c.input, c.front);
  assert.throws(() => changeAppointmentStatus(c.db, original.id, 'cancelled', '', c.front), err => err.status === 400);
  changeAppointmentStatus(c.db, original.id, 'cancelled', '患者取消', c.front, original.version);
  const replacement = createAppointment(c.db, c.input, c.front);
  assert.notEqual(replacement.id, original.id);
  assert.throws(() => updateAppointment(c.db, original.id, { ...c.input, expectedVersion: original.version, reason: '恢复' }, c.front), err => err.status === 409);
  assert.throws(() => changeAppointmentStatus(c.db, original.id, 'arrived', '', c.front), err => err.status === 409);
});

test('UC03到诊须前台与当地当日预约，不允许未来预约到诊', t => {
  const c = setup(t);
  const future = createAppointment(c.db, c.input, c.front);
  assert.throws(() => changeAppointmentStatus(c.db, future.id, 'arrived', '', c.dentist), err => err.status === 403);
  assert.throws(() => changeAppointmentStatus(c.db, future.id, 'arrived', '', c.front), err => err.status === 409 && /当日/.test(err.message));
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM encounters WHERE appointment_id=?').get(future.id).n, 0);
  assert.equal(c.db.prepare('SELECT status FROM appointments WHERE id=?').get(future.id).status, 'confirmed');
});

test('UC03到诊一次生成唯一草稿就诊，重复返回原编号且不开始治疗', t => {
  const c = setup(t);
  const appointment = todayAppointment(c);
  const first = changeAppointmentStatus(c.db, appointment.id, 'arrived', '', c.front, appointment.version);
  const again = changeAppointmentStatus(c.db, appointment.id, 'arrived', '', c.front, appointment.version);
  assert.equal(first.appointment.status, 'arrived');
  assert.equal(first.encounter.status, 'draft');
  assert.equal(first.encounter.patient_id, appointment.patient_id);
  assert.equal(first.encounter.dentist_id, appointment.dentist_id);
  assert.equal(first.encounter.chief_complaint, null);
  assert.equal(again.alreadyArrived, true);
  assert.equal(again.encounterId, first.encounterId);
  assert.equal(again.encounterNo, first.encounterNo);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM encounters WHERE appointment_id=?').get(appointment.id).n, 1);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM appointment_history WHERE appointment_id=? AND to_status='arrived'").get(appointment.id).n, 1);
  assert.throws(() => changeAppointmentStatus(c.db, appointment.id, 'cancelled', '已到诊后取消', c.front), err => err.status === 409);
  assert.throws(() => updateAppointment(c.db, appointment.id, { ...c.input, expectedVersion: first.appointment.version, reason: '已到诊后修改' }, c.front), err => err.status === 409);
});

test('UC03预约写入失败时同时回滚新就诊、状态和历史', t => {
  const c = setup(t);
  const appointment = todayAppointment(c);
  c.db.exec(`CREATE TEMP TRIGGER reject_arrival BEFORE UPDATE ON appointments
    WHEN NEW.status='arrived' BEGIN SELECT RAISE(ABORT,'模拟到诊保存失败'); END;`);
  assert.throws(() => changeAppointmentStatus(c.db, appointment.id, 'arrived', '', c.front), /模拟到诊保存失败/);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM encounters WHERE appointment_id=?').get(appointment.id).n, 0);
  assert.equal(c.db.prepare('SELECT status FROM appointments WHERE id=?').get(appointment.id).status, 'confirmed');
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM appointment_history WHERE appointment_id=? AND to_status='arrived'").get(appointment.id).n, 0);
});

test('UC03已有错误患者或牙医关联不被静默改绑', t => {
  const c = setup(t);
  const appointment = todayAppointment(c);
  c.db.prepare("INSERT INTO encounters(encounter_no,patient_id,appointment_id,dentist_id,status) VALUES('E-WRONG',2,?,?,'draft')").run(appointment.id, c.otherDentist.id);
  assert.throws(() => changeAppointmentStatus(c.db, appointment.id, 'arrived', '', c.front), err => err.status === 409 && /不一致/.test(err.message));
  assert.equal(c.db.prepare('SELECT status FROM appointments WHERE id=?').get(appointment.id).status, 'confirmed');
});

test('预约不承载候诊、治疗和完成状态', t => {
  const c = setup(t);
  const appointment = todayAppointment(c);
  for (const status of ['waiting', 'in_treatment', 'completed', 'no_show', 'rescheduled', 'anything']) {
    assert.throws(() => changeAppointmentStatus(c.db, appointment.id, status, '测试', c.front), err => err.status === 409);
  }
});

test('仅本次接诊牙医签署与更正病历，签署不改变已到诊预约', t => {
  const c = setup(t);
  const appointment = todayAppointment(c);
  const arrival = changeAppointmentStatus(c.db, appointment.id, 'arrived', '', c.front);
  c.db.prepare("UPDATE encounters SET chief_complaint='牙痛',diagnosis='龋病',clinical_notes='完成检查及处置',instructions='复查' WHERE id=?").run(arrival.encounterId);
  for (const actor of [c.otherDentist, c.assistant, { ...c.manager, roles: 'manager' }]) {
    assert.throws(() => signEncounter(c.db, arrival.encounterId, actor), err => err.status === 403);
  }
  c.db.prepare("INSERT INTO tooth_findings(encounter_id,tooth_code,finding,created_by) VALUES(?,'11','已检查',?)").run(arrival.encounterId,c.dentist.id);
  signEncounter(c.db, arrival.encounterId, c.dentist);
  assert.equal(c.db.prepare('SELECT status FROM appointments WHERE id=?').get(appointment.id).status, 'arrived');
  assert.throws(() => amendEncounter(c.db, arrival.encounterId, '更正', '核实', c.otherDentist), err => err.status === 403);
  amendEncounter(c.db, arrival.encounterId, '补充复查要求', '完善诊后要求', c.dentist);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM record_amendments WHERE encounter_id=?').get(arrival.encounterId).n, 1);
});

test('历史金额按分汇总，不因0.1乘3的浮点尾差产生部分支付', t => {
  const c = setup(t);
  const created = c.db.prepare("INSERT INTO invoices(invoice_no,patient_id,created_by) VALUES('I-CENTS',1,?)").run(c.front.id);
  const id = Number(created.lastInsertRowid);
  c.db.prepare("INSERT INTO invoice_lines(invoice_id,service_name,unit_price,quantity,line_amount) VALUES(?,'精度核对',0.1,3,?)").run(id, 0.1 * 3);
  c.db.prepare("INSERT INTO payments(invoice_id,amount,method,received_by) VALUES(?,0.3,'现金',?)").run(id, c.front.id);
  const invoice = recalculateInvoice(c.db, id);
  assert.equal(invoice.gross_amount, 0.3);
  assert.equal(invoice.balance, 0);
  assert.equal(invoice.status, 'paid');
});
