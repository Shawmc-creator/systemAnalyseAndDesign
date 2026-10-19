'use strict';
const { encodePassword } = require('./auth');
const { insert, fact, day, utc } = require('./common');
function seedDemo(db, auth, reception) {
  if (db.prepare('SELECT count(*) n FROM user_account').get().n) return false;
  const now = auth.now();
  const people = [['manager', '林医生', ['manager', 'dentist']], ['frontdesk', '陈前台', ['frontdesk']], ['cashier', '赵收费', ['cashier']],
    ['dentist', '周医生', ['dentist']], ['assistant', '李助理', ['assistant']], ['assistant2', '王助理', ['assistant']]];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [login, name] of people) {
      const staff = insert(db, 'staff', fact(now, { name, employed_from: day(now), employed_until: null, created_by: null, record_no: `DEMO-STAFF-${login}` }));
      insert(db, 'user_account', { staff_id: staff, login_name: login, password_hash: encodePassword('Clinic123!'), status: '启用', auth_version: 1,
        password_changed_at: now, created_at: now, updated_at: now, disabled_at: null, disabled_reason: null, revision: 1 });
    }
    const manager = db.prepare("SELECT * FROM user_account WHERE login_name='manager'").get();
    for (const [login, , roles] of people) {
      const account = db.prepare('SELECT * FROM user_account WHERE login_name=?').get(login);
      for (const code of roles) {
        const role = db.prepare('SELECT id FROM access_role WHERE code=?').get(code);
        const q = insert(db, 'staff_role_qualification', { staff_id: account.staff_id, role_id: role.id, valid_from: now, valid_until: null,
          verified_by: manager.staff_id, verification_basis: '隔离演示人员；不作为真实人员资格证明', revoked_at: null, revoked_by: null, revocation_reason: null, created_at: now });
        insert(db, 'account_role', { account_id: account.id, role_id: role.id, qualification_id: q, granted_by: manager.id, granted_at: now,
          valid_until: null, grant_reason: '演示数据初始化', revoked_by: null, revoked_at: null, revocation_reason: null });
      }
    }
    insert(db, 'dental_chair', fact(now, { name: '一号诊椅', available_from: now, available_until: null, created_by: manager.staff_id, record_no: 'DEMO-CHAIR-01' }));
    insert(db, 'dental_chair', fact(now, { name: '二号诊椅', available_from: now, available_until: null, created_by: manager.staff_id, record_no: 'DEMO-CHAIR-02' }));
    insert(db,'clinical_equipment',fact(now,{name:'共享检查设备（演示）',equipment_type:'共享设备',dental_chair_id:null,status:'可用',status_reason:'演示设备，按本次实际需要选择'}));
    insert(db, 'operation_audit', { account_id: null, staff_id: manager.staff_id, session_id: null, submission_id: null, permission_id: null,
      actor_kind: '初始化', event_type: '运行事件', occurred_at: now, object_kind: 'user_account', object_key: 'demo-bootstrap', before_revision: null,
      after_revision: null, reason: '六名演示工作人员和两张诊椅；未导入旧运行数据', outcome_code: 'DEMO_INITIALIZED', correlation_id: 'demo-bootstrap', authority_snapshot: '{}' });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const frontdesk = auth.login({ username: 'frontdesk', password: 'Clinic123!' });
  const manager = auth.login({ username: 'manager', password: 'Clinic123!' });
  const f = { token: frontdesk.token, csrf: frontdesk.csrf, role: 'frontdesk' }, m = { token: manager.token, csrf: manager.csrf, role: 'manager' };
  const command = (key, fields) => ({ requestKey: key, commandVersion: 1, ...fields });
  const patient = reception.patient(f, command('demo-patient-1', { reason: '演示新患者建档', fields: { name: '陈晨（演示）', phone: '13800000001', phone_owner: '本人' } }));
  reception.patient(f, command('demo-patient-2', { reason: '演示同名身份候选', fields: { name: '陈晨（演示）', phone: '13800000002', phone_owner: '本人' } }));
  const tomorrow = day(Date.parse(now) + 86400_000);
  const dentist = db.prepare("SELECT staff_id FROM user_account WHERE login_name='dentist'").get().staff_id;
  const schedule = reception.schedule(m, command('demo-schedule-1', { action: 'publish', dentistId: dentist, chairId: 1, businessDate: tomorrow,
    startsAt: tomorrow + 'T09:00:00+08:00', endsAt: tomorrow + 'T18:00:00+08:00', reason: '演示日期接诊安排' }));
  reception.appointment(f, command('demo-appointment-1', { action: 'create', patientId: patient.id, scheduleId: schedule.id, scheduleRevision: schedule.revision,
    startsAt: tomorrow + 'T09:30:00+08:00', endsAt: tomorrow + 'T10:00:00+08:00', reason: '初诊口腔检查（演示）' }));
  auth.logout(frontdesk.token); auth.logout(manager.token);
  return true;
}
module.exports = { seedDemo };
