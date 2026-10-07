const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function createDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      roles TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_no TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      sex TEXT,
      birth_date TEXT,
      phone TEXT,
      emergency_contact TEXT,
      contact_preference TEXT NOT NULL DEFAULT '电话',
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE TABLE IF NOT EXISTS health_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      alert_type TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      default_duration INTEGER NOT NULL CHECK(default_duration > 0),
      current_price REAL NOT NULL CHECK(current_price >= 0),
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS service_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      price REAL NOT NULL CHECK(price >= 0),
      effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      changed_by INTEGER REFERENCES users(id),
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS clinic_hours (
      weekday INTEGER PRIMARY KEY CHECK(weekday BETWEEN 0 AND 6),
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      CHECK(close_time > open_time)
    );
    CREATE TABLE IF NOT EXISTS dentist_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dentist_id INTEGER NOT NULL REFERENCES users(id),
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      CHECK(end_time > start_time),
      UNIQUE(dentist_id,weekday)
    );
    CREATE TABLE IF NOT EXISTS staff_leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(end_at > start_at)
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_no TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      dentist_id INTEGER NOT NULL REFERENCES users(id),
      chair_id INTEGER NOT NULL REFERENCES chairs(id),
      service_id INTEGER REFERENCES services(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      source TEXT NOT NULL DEFAULT 'frontdesk',
      patient_note TEXT,
      internal_note TEXT,
      exception_reason TEXT,
      rescheduled_from_id INTEGER REFERENCES appointments(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(end_at > start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);
    CREATE INDEX IF NOT EXISTS idx_appt_dentist ON appointments(dentist_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_appt_chair ON appointments(chair_id, start_at);
    CREATE TABLE IF NOT EXISTS appointment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      reason TEXT,
      changed_by INTEGER NOT NULL REFERENCES users(id),
      changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS encounters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_no TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      appointment_id INTEGER UNIQUE REFERENCES appointments(id),
      dentist_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft',
      chief_complaint TEXT,
      relevant_history TEXT,
      diagnosis TEXT,
      clinical_notes TEXT,
      instructions TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      signed_at TEXT,
      signed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tooth_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      tooth_code TEXT NOT NULL,
      finding TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS record_amendments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      amendment_text TEXT NOT NULL,
      reason TEXT NOT NULL,
      signed_by INTEGER NOT NULL REFERENCES users(id),
      signed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clinical_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      encounter_id INTEGER REFERENCES encounters(id),
      category TEXT NOT NULL CHECK(category IN ('xray','photo','consent','report','other')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      file_data BLOB NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_patient ON clinical_attachments(patient_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_attachment_encounter ON clinical_attachments(encounter_id,created_at);
    CREATE TABLE IF NOT EXISTS treatment_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_no TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      encounter_id INTEGER REFERENCES encounters(id),
      version_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      summary TEXT,
      explained_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES treatment_plans(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      tooth_code TEXT,
      planned_quantity REAL NOT NULL DEFAULT 1 CHECK(planned_quantity > 0),
      estimated_price REAL NOT NULL CHECK(estimated_price >= 0),
      decision TEXT NOT NULL DEFAULT 'pending',
      completed_quantity REAL NOT NULL DEFAULT 0 CHECK(completed_quantity >= 0)
    );
    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_id INTEGER NOT NULL REFERENCES encounters(id),
      plan_item_id INTEGER REFERENCES plan_items(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      tooth_code TEXT,
      quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
      unit_price_snapshot REAL NOT NULL CHECK(unit_price_snapshot >= 0),
      performed_by INTEGER NOT NULL REFERENCES users(id),
      outcome TEXT,
      outside_plan_reason TEXT,
      performed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'confirmed'
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      encounter_id INTEGER REFERENCES encounters(id),
      status TEXT NOT NULL DEFAULT 'pending',
      gross_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      credited_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      refunded_amount REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      treatment_id INTEGER REFERENCES treatments(id),
      service_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      line_amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount REAL NOT NULL CHECK(amount > 0),
      method TEXT NOT NULL,
      reference_no TEXT,
      received_by INTEGER NOT NULL REFERENCES users(id),
      paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      payment_id INTEGER REFERENCES payments(id),
      amount REAL NOT NULL CHECK(amount > 0),
      reason TEXT NOT NULL,
      approved_by INTEGER NOT NULL REFERENCES users(id),
      processed_by INTEGER NOT NULL REFERENCES users(id),
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      request_type TEXT NOT NULL CHECK(request_type IN ('discount','refund')),
      amount REAL NOT NULL CHECK(amount > 0),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      applied_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_approval ON approval_requests(invoice_id,request_type)
      WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status,created_at);
    CREATE TABLE IF NOT EXISTS followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      encounter_id INTEGER REFERENCES encounters(id),
      reason TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      notification_type TEXT NOT NULL CHECK(notification_type IN ('appointment','followup','balance','manual')),
      reference_type TEXT,
      reference_id INTEGER,
      channel TEXT NOT NULL CHECK(channel IN ('电话','短信','微信')),
      recipient TEXT,
      content TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_source ON notifications(notification_type,reference_type,reference_id)
      WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_notification_queue ON notifications(status,scheduled_at);
    CREATE TABLE IF NOT EXISTS patient_accounts (
      patient_id INTEGER PRIMARY KEY REFERENCES patients(id),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS patient_sessions (
      token_hash TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS appointment_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      preferred_date TEXT NOT NULL,
      preferred_period TEXT NOT NULL CHECK(preferred_period IN ('上午','下午','不限')),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      staff_note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      new_appointment_id INTEGER REFERENCES appointments(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_change_request ON appointment_change_requests(appointment_id)
      WHERE status='pending';
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      patient_id INTEGER REFERENCES patients(id),
      result TEXT NOT NULL DEFAULT 'success',
      details TEXT,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const requirements = require('./requirements');
  requirements.initializeRequirementsSchema(db);
  seed(db);
  requirements.seedRequirements(db);
  require('./materials').initializeMaterials(db);
  require('./workflows').initialize(db);
  return db;
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count === 0) {
    const addUser = db.prepare('INSERT INTO users(username,password_hash,display_name,roles) VALUES(?,?,?,?)');
    const password = hashPassword('Clinic123!');
    addUser.run('manager', password, '周主任', 'manager,dentist');
    addUser.run('frontdesk', password, '林前台', 'frontdesk');
    addUser.run('dentist', password, '陈医生', 'dentist');
    addUser.run('assistant', password, '王助理', 'assistant');
  }
  // Keep the original four staff IDs and add the two separate documented posts.
  if (db.prepare("SELECT id FROM users WHERE username='manager'").get()) {
    const password = hashPassword('Clinic123!');
    db.prepare('INSERT OR IGNORE INTO users(username,password_hash,display_name,roles) VALUES(?,?,?,?)').run('cashier', password, '赵收费', 'cashier');
    db.prepare('INSERT OR IGNORE INTO users(username,password_hash,display_name,roles) VALUES(?,?,?,?)').run('assistant2', password, '刘助理', 'assistant');
    db.prepare("UPDATE users SET roles='frontdesk' WHERE username='frontdesk' AND roles='frontdesk,cashier'").run();
    db.prepare("UPDATE users SET display_name='王助理' WHERE username='assistant' AND display_name='王助手'").run();
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM chairs').get().count === 0) {
    db.exec("INSERT INTO chairs(code,name) VALUES('CH-01','1号牙椅'),('CH-02','2号牙椅')");
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM services').get().count === 0) {
    const stmt = db.prepare('INSERT INTO services(code,name,default_duration,current_price) VALUES(?,?,?,?)');
    [['EXAM','初诊检查',30,100],['CLEAN','洁治',45,300],['FILL','树脂充填',60,500],['ROOT','根管治疗',90,900],['EXTRACT','拔牙',60,450]].forEach(x=>stmt.run(...x));
  }
  const manager = db.prepare("SELECT id FROM users WHERE username='manager'").get();
  db.prepare(`INSERT INTO service_price_history(service_id,price,changed_by,reason)
    SELECT s.id,s.current_price,?,'初始价格' FROM services s
    WHERE NOT EXISTS(SELECT 1 FROM service_price_history h WHERE h.service_id=s.id)`).run(manager?.id || null);
  if (db.prepare('SELECT COUNT(*) count FROM clinic_hours').get().count === 0) {
    const addHour = db.prepare('INSERT INTO clinic_hours(weekday,open_time,close_time,active) VALUES(?,?,?,?)');
    addHour.run(0,'08:30','18:00',0);
    for (let weekday=1; weekday<=6; weekday++) addHour.run(weekday,'08:30','18:00',1);
  }
  if (db.prepare('SELECT COUNT(*) count FROM dentist_schedules').get().count === 0) {
    const addSchedule = db.prepare('INSERT INTO dentist_schedules(dentist_id,weekday,start_time,end_time,active,created_by) VALUES(?,?,?,?,1,?)');
    const dentists = db.prepare("SELECT id,username FROM users WHERE (','||roles||',') LIKE '%,dentist,%'").all();
    for (const dentist of dentists) for (let weekday=1; weekday<=6; weekday++) {
      addSchedule.run(dentist.id,weekday,dentist.username==='manager'?'08:30':'09:00',dentist.username==='manager'?'17:00':'18:00',manager?.id||null);
    }
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM patients').get().count === 0) {
    const p = db.prepare('INSERT INTO patients(patient_no,full_name,sex,birth_date,phone,emergency_contact,contact_preference,notes) VALUES(?,?,?,?,?,?,?,?)');
    p.run('P000001','张晨','男','2003-05-12','13800001001','张女士 13800002001','微信','学校附近，首次就诊');
    p.run('P000002','李雨桐','女','2001-11-03','13800001002','李先生 13800002002','电话','复诊患者');
    db.prepare('INSERT INTO health_alerts(patient_id,alert_type,description,severity) VALUES(?,?,?,?)').run(2,'过敏','青霉素过敏','high');
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count === 0) {
    const dentist = db.prepare("SELECT id FROM users WHERE username='dentist'").get().id;
    const frontdesk = db.prepare("SELECT id FROM users WHERE username='frontdesk'").get().id;
    const service = db.prepare("SELECT id FROM services WHERE code='EXAM'").get().id;
    const date = new Date();
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 30);
    const end = new Date(start.getTime() + 30 * 60000);
    db.prepare(`INSERT INTO appointments(appointment_no,patient_id,dentist_id,chair_id,service_id,start_at,end_at,status,created_by)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('A000001',1,dentist,1,service,start.toISOString(),end.toISOString(),'confirmed',frontdesk);
    db.prepare('INSERT INTO appointment_history(appointment_id,from_status,to_status,reason,changed_by) VALUES(1,NULL,?,?,?)').run('confirmed','演示预约',frontdesk);
  }
  const portalPassword = hashPassword('Patient123!');
  db.prepare(`INSERT INTO patient_accounts(patient_id,password_hash)
    SELECT p.id,? FROM patients p WHERE p.patient_no IN ('P000001','P000009')
    AND NOT EXISTS(SELECT 1 FROM patient_accounts a WHERE a.patient_id=p.id)`).run(portalPassword);
}

function nextNo(db, table, column, prefix, width = 6) {
  const row = db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`);
  const n = row ? Number(String(row.value).slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(width, '0');
}

function audit(db, userId, action, targetType, targetId, patientId, details, result = 'success') {
  db.prepare(`INSERT INTO audit_events(user_id,action,target_type,target_id,patient_id,details,result)
    VALUES(?,?,?,?,?,?,?)`).run(userId || null, action, targetType, targetId == null ? null : String(targetId), patientId || null, details ? JSON.stringify(details) : null, result);
}

module.exports = { createDatabase, hashPassword, verifyPassword, nextNo, audit };
