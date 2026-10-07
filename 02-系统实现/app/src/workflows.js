// UC-08..20: versions, original facts and safe retries of staff submissions.
const { createHash } = require('node:crypto');
const r = require('./requirements');
const has = (u, role) => String(u?.roles || '').split(',').includes(role);
function column(db, table, name, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function initialize(db) {
  for (const table of ['patients', 'encounters', 'followups', 'dentist_schedules', 'materials']) column(db, table, 'version', 'INTEGER NOT NULL DEFAULT 1');
  column(db,'treatments','patient_confirmed','INTEGER');
  column(db, 'encounters', 'signed_version', 'INTEGER');
  column(db,'followup_history','contacted_at','TEXT');
  column(db, 'followups', 'type', "TEXT NOT NULL DEFAULT 'followup'");
  for (const name of ['recovery', 'conclusion', 'opinion']) column(db, 'followups', name, 'TEXT');
  for (const table of ['dentist_schedules', 'daily_reconciliations']) {
    column(db, table, 'confirmed_by', 'INTEGER REFERENCES users(id)');
    column(db, table, 'confirmed_at', 'TEXT');
    column(db, table, 'confirmation_note', 'TEXT');
  }
  column(db, 'material_movements', 'confirmation_note', 'TEXT');
  column(db, 'daily_reconciliations', 'basis_json', 'TEXT');
  column(db, 'daily_reconciliations', 'basis_hash', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mutation_requests (
      scope TEXT NOT NULL, actor INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
      input_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(scope,actor,request_id));
    CREATE TABLE IF NOT EXISTS patient_changes (
      id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
      old_json TEXT NOT NULL, new_json TEXT NOT NULL, reason TEXT NOT NULL,
      changed_by INTEGER NOT NULL REFERENCES users(id), changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS schedule_changes (
      id INTEGER PRIMARY KEY, dentist_id INTEGER NOT NULL REFERENCES users(id), weekday INTEGER NOT NULL,
      old_json TEXT, new_json TEXT NOT NULL, reason TEXT NOT NULL, changed_by INTEGER NOT NULL REFERENCES users(id),
      changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  for (const table of ['patient_changes', 'schedule_changes', 'daily_reconciliations', 'mutation_requests', 'followup_history', 'record_amendments']) {
    for (const action of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'原始办理记录不能覆盖或删除'); END`);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function submission(db, scope, input, user, operation) {
  const key = String(input.requestId || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) r.fail(400, '缺少有效提交编号，请重新打开办理窗口');
  return r.transaction(db, () => {
    const hash = digest(input);
    const old = db.prepare('SELECT * FROM mutation_requests WHERE scope=? AND actor=? AND request_id=?').get(scope, user.id, key);
    if (old) {
      if (old.input_hash !== hash) r.fail(409, '此提交已成功保存且内容不同，请查询原结果后重新办理');
      return { ...JSON.parse(old.result_json), replayed: true };
    }
    const result = operation();
    db.prepare('INSERT INTO mutation_requests(scope,actor,request_id,input_hash,result_json) VALUES(?,?,?,?,?)').run(scope, user.id, key, hash, JSON.stringify(result));
    return result;
  });
}
function version(row, input) {
  if (input.expectedVersion == null) r.fail(400, '须提交查询时的资料版本');
  if (!Number.isInteger(Number(input.expectedVersion)) || Number(input.expectedVersion) !== row.version) r.fail(409, '资料已变化，请重新查询，不能覆盖新版本');
}
function text(value, label) {
  const result = String(value || '').trim();
  if (!result || result.length > 5000) r.fail(400, `${label}为必填，且不能超过5000字`);
  return result;
}
function fact(db, input, role = 'manager', idField = 'confirmedBy') {
  const by = Number(input[idField]);
  const person = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(by);
  if (!person || !has(person, role)) r.fail(400, role === 'dentist' ? '须记录有效接诊牙医的确认' : '须记录有效负责人的确认');
  const at = r.time(input.confirmedAt, '确认时间');
  r.day(at.slice(0,10));
  const calendar = String(input.confirmedAt).slice(0,10); r.day(calendar);
  if (Date.parse(at) > Date.now()) r.fail(400, '确认时间不能在未来');
  return { by, at, note: text(input.confirmationNote, '确认意见') };
}
function clinicalAccess(db, id, user, currentEncounterId) {
  r.role(user, 'dentist');
  const target = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
  if (!target) r.fail(404, '就诊记录不存在');
  if (target.dentist_id === user.id) return target;
  const current = db.prepare('SELECT * FROM encounters WHERE id=? AND dentist_id=?').get(Number(currentEncounterId) || 0, user.id);
  if (!current || current.patient_id !== target.patient_id) r.fail(403, '只能查询本人接诊病历或本次患者的既往病历');
  if (target.started_at > current.started_at) r.fail(403, '仅可查询本次就诊之前的病历');
  return target;
}
function patientValues(input) {
  const fullName = text(input.fullName, '患者姓名'), phone = text(input.phone, '联系电话');
  if (fullName.length > 100 || phone.length > 40 || !/^[+\d()\s-]{5,40}$/.test(phone)) r.fail(400, '姓名或联系电话格式无效');
  const birthDate = input.birthDate ? r.day(input.birthDate) : null;
  if (birthDate && birthDate > new Date().toLocaleDateString('en-CA')) r.fail(400, '出生日期不能在未来');
  if (input.sex && !['男', '女', '其他'].includes(input.sex)) r.fail(400, '性别无效');
  return [fullName, input.sex || null, birthDate, phone, input.emergencyContact || null, input.contactPreference || '电话', input.notes || null];
}
function savePatient(db, id, input, user) {
  r.role(user, 'frontdesk');
  const values = patientValues(input);
  return submission(db, `patient:${id || 'new'}`, input, user, () => {
    const old = id ? db.prepare('SELECT * FROM patients WHERE id=? AND active=1').get(id) : null;
    if (id && !old) r.fail(404, '患者不存在');
    if (old) version(old, input);
    const duplicates = db.prepare('SELECT id,patient_no,full_name,phone FROM patients WHERE active=1 AND id!=? AND (phone=? OR (full_name=? AND birth_date=?))').all(id || 0, values[3], values[0], values[2]);
    if (duplicates.length && input.confirmDuplicate !== true) {
      const e = new Error('发现疑似重复患者，请核对后确认单独建档'); e.status = 409; e.duplicates = duplicates; throw e;
    }
    if (old) {
      const reason = text(input.reason, '资料变更原因');
      db.prepare('UPDATE patients SET full_name=?,sex=?,birth_date=?,phone=?,emergency_contact=?,contact_preference=?,notes=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values, id);
      const updated = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
      db.prepare('INSERT INTO patient_changes(patient_id,old_json,new_json,reason,changed_by) VALUES(?,?,?,?,?)').run(id, JSON.stringify(old), JSON.stringify(updated), reason, user.id);
    } else {
      const no = require('./db').nextNo(db, 'patients', 'patient_no', 'P');
      id = Number(db.prepare('INSERT INTO patients(patient_no,full_name,sex,birth_date,phone,emergency_contact,contact_preference,notes) VALUES(?,?,?,?,?,?,?,?)').run(no, ...values).lastInsertRowid);
      if (input.alert) db.prepare('INSERT INTO health_alerts(patient_id,alert_type,description,severity) VALUES(?,?,?,?)').run(id,'风险提示',input.alert,input.alertSeverity || 'medium');
    }
    require('./db').audit(db, user.id, old ? 'patient.update' : 'patient.create', 'patient', id, id, { reason: input.reason || null, original: old });
    return { patient: db.prepare('SELECT * FROM patients WHERE id=?').get(id) };
  });
}
function saveSchedule(db, input, user) {
  r.role(user, 'manager');
  return submission(db, 'schedule', input, user, () => {
    const dentistId = Number(input.dentistId), weekday = Number(input.weekday);
    const start = String(input.startTime || ''), end = String(input.endTime || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) r.fail(400, '星期或接诊时段无效');
    const proof = fact(db, input, 'dentist');
    if (proof.by !== dentistId) r.fail(400, '确认牙医须与本次接诊安排一致');
    const old = db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=?').get(dentistId, weekday);
    if (old) version(old,input); else if (Number(input.expectedVersion) !== 0) r.fail(409,'安排已变化，请重新查询');
    const active = [false,0,'0'].includes(input.active) ? 0 : 1;
    const clinic = db.prepare('SELECT * FROM clinic_hours WHERE weekday=? AND active=1').get(weekday);
    if (active && (!clinic || start < clinic.open_time || end > clinic.close_time)) r.fail(409, '接诊安排须在诊所营业时间内');
    const conflict = db.prepare(`SELECT appointment_no FROM appointments WHERE dentist_id=? AND status IN ('confirmed','arrived') AND julianday(end_at)>julianday('now') AND CAST(strftime('%w',start_at,'localtime') AS INTEGER)=? AND (?=0 OR substr(time(start_at,'localtime'),1,5)<? OR substr(time(end_at,'localtime'),1,5)>?) LIMIT 1`).get(dentistId,weekday,active,start,end);
    if (conflict) r.fail(409, `仍有有效预约${conflict.appointment_no}，请先处理预约`);
    const reason = text(input.reason, '安排及变更原因');
    db.prepare(`INSERT INTO dentist_schedules(dentist_id,weekday,start_time,end_time,active,created_by,confirmed_by,confirmed_at,confirmation_note) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(dentist_id,weekday) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,active=excluded.active,created_by=excluded.created_by,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,confirmation_note=excluded.confirmation_note,version=version+1`).run(dentistId,weekday,start,end,active,user.id,proof.by,proof.at,proof.note);
    const schedule = db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=?').get(dentistId,weekday);
    db.prepare('INSERT INTO schedule_changes(dentist_id,weekday,old_json,new_json,reason,changed_by) VALUES(?,?,?,?,?,?)').run(dentistId,weekday,old ? JSON.stringify(old) : null,JSON.stringify(schedule),reason,user.id);
    require('./db').audit(db,user.id,'admin.schedule.update','dentist_schedule',schedule.id,null,{original:old,reason});
    return { schedule };
  });
}
function cashBasis(db, date) {
  r.day(date);
  const receipts = db.prepare("SELECT id,invoice_id,receipt_no,due_amount,tendered_amount,change_amount,paid_at FROM cash_receipts WHERE date(paid_at,'localtime')=? ORDER BY id").all(date);
  const legacyPayments = db.prepare("SELECT p.id,p.invoice_id,p.amount,p.paid_at FROM payments p WHERE p.method IN ('cash','现金') AND date(p.paid_at,'localtime')=? AND NOT EXISTS(SELECT 1 FROM cash_receipts r WHERE r.invoice_id=p.invoice_id AND r.receipt_no=p.reference_no) ORDER BY p.id").all(date);
  const refunds = db.prepare("SELECT r.id,r.payment_id,r.amount,r.processed_at FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.method IN ('cash','现金') AND date(r.processed_at,'localtime')=? ORDER BY r.id").all(date);
  const total = receipts.reduce((n,x) => n+r.cents(x.tendered_amount)-r.cents(x.change_amount),0) + legacyPayments.reduce((n,x)=>n+r.cents(x.amount),0) - refunds.reduce((n,x)=>n+r.cents(x.amount),0);
  const basis = { date, receipts, legacyPayments, refunds };
  return { basis, basisHash: digest(basis), expectedCash: total/100 };
}
module.exports = { initialize, has, submission, version, text, fact, clinicalAccess, savePatient, saveSchedule, cashBasis };
