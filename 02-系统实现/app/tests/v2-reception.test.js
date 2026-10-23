'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/v2/server');
const { openDatabase } = require('../src/v2/database');
const { Auth } = require('../src/v2/auth');
let key = 0;
const cmd = fields => ({ requestKey: 'test-' + (++key), commandVersion: 1, ...fields });
function setup(t) {
  let clock = new Date('2026-10-19T02:00:00Z');
  const a = createApplication({ demo: true, clock: () => clock });
  t.after(() => a.db.close());
  function login(username, role = username) { const s = a.auth.login({ username, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role }; }
  return { ...a, f: login('frontdesk'), m: login('manager'), d: login('dentist'), setClock: x => { clock = new Date(x); } };
}
function schedule(a, overrides = {}) {
  return a.reception.schedule(a.m, cmd({ action: 'publish', businessDate: '2026-10-19', startsAt: '2026-10-19T10:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', dentistId: 4, chairId: 1, reason: '负责人核对当日接诊安排', ...overrides }));
}
function book(a, s, overrides = {}) {
  return cmd({ action: 'create', patientId: 1, scheduleId: s.id, scheduleRevision: s.revision,
    startsAt: '2026-10-19T10:30:00+08:00', endsAt: '2026-10-19T11:00:00+08:00', reason: '口腔检查', ...overrides });
}
test('v2 retains implementation data and adds resources, dispensing, settlements and financial histories; refuses an unrecognized legacy database', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-v2-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'legacy.db'), old = new DatabaseSync(file); old.exec('CREATE TABLE users(id INTEGER); INSERT INTO users VALUES(42)'); old.close();
  const before = fs.readFileSync(file);
  assert.throws(() => openDatabase(file), /拒绝/); assert.deepEqual(fs.readFileSync(file), before);
  const a = setup(t);
  assert.equal(a.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n, 108);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('one request yields one receipt; changed payload with same key is refused; revoked privilege prevents replay', t => {
  const a = setup(t), s = schedule(a), input = book(a, s);
  const first = a.reception.appointment(a.f, input), repeat = a.reception.appointment(a.f, input);
  assert.equal(repeat.id, first.id); assert.equal(repeat.replayed, true);
  assert.throws(() => a.reception.appointment(a.f, { ...input, reason: '新内容' }), e => e.code === 'REQUEST_KEY_REUSED');
  a.db.prepare('UPDATE staff_role_qualification SET revoked_at=?,revoked_by=1,revocation_reason=? WHERE staff_id=2').run(a.auth.now(), '撤销前台资格');
  assert.throws(() => a.reception.appointment(a.f, input), e => e.status === 401 || e.status === 403);
});
test('active role, qualification, session epoch, CSRF and authorization version are enforced', t => {
  const a = setup(t), s = schedule(a);
  assert.throws(() => a.reception.appointment(a.m, book(a, s)), e => e.code === 'FORBIDDEN');
  assert.throws(() => a.reception.appointment({ ...a.f, csrf: 'wrong' }, book(a, s)), e => e.code === 'CSRF_INVALID');
  assert.throws(() => new Auth(a.db, () => new Date(a.auth.now())).session(a.f.token), e => e.code === 'SESSION_INVALID');
  a.db.prepare('UPDATE user_account SET auth_version=auth_version+1 WHERE login_name=?').run('frontdesk');
  assert.throws(() => a.auth.session(a.f.token), e => e.code === 'SESSION_INVALID');
  assert.ok(a.db.prepare("SELECT count(*) n FROM operation_audit WHERE event_type='拒绝'").get().n >= 2);
});
test('conflicting booking leaves no orphan appointment, receipt or occupancy', t => {
  const a = setup(t), s = schedule(a);
  a.reception.appointment(a.f, book(a, s));
  const counts = () => ['appointment', 'resource_occupancy', 'request_submission'].map(table => a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n);
  const before = counts();
  assert.throws(() => a.reception.appointment(a.f, book(a, s, { patientId: 2 })), e => e.code === 'RESOURCE_CONFLICT');
  assert.deepEqual(counts(), before); assert.equal(a.db.isTransaction, false);
});
test('failed reschedule restores old slot; optimistic revisions reject stale actions', t => {
  const a = setup(t), s = schedule(a), first = a.reception.appointment(a.f, book(a, s));
  a.reception.appointment(a.f, book(a, s, { patientId: 2, startsAt: '2026-10-19T11:00:00+08:00', endsAt: '2026-10-19T11:30:00+08:00' }));
  assert.throws(() => a.reception.appointment(a.f, cmd({ action: 'reschedule', appointmentId: first.id, expectedRevision: 1, scheduleId: s.id, scheduleRevision: 1,
    startsAt: '2026-10-19T11:00:00+08:00', endsAt: '2026-10-19T11:30:00+08:00', reason: '改约' })), e => e.code === 'RESOURCE_CONFLICT');
  const old = a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(first.id);
  assert.equal(old.starts_at, '2026-10-19T02:30:00Z');
  const notify = cmd({ action: 'notify', appointmentId: first.id, expectedRevision: 1, reason: '电话通知患者已确认' });
  a.reception.appointment(a.f, notify);
  assert.throws(() => a.reception.appointment(a.f, cmd({ action: 'cancel', appointmentId: first.id, expectedRevision: 1, reason: '患者取消' })), e => e.code === 'VERSION_CONFLICT');
});
test('same patient cannot occupy different dentists simultaneously; interval boundaries may touch', t => {
  const a = setup(t), s1 = schedule(a), s2 = schedule(a, { dentistId: 1, chairId: 2 });
  a.reception.appointment(a.f, book(a, s1));
  assert.throws(() => a.reception.appointment(a.f, book(a, s2)), e => e.code === 'RESOURCE_CONFLICT');
  assert.ok(a.reception.appointment(a.f, book(a, s2, { startsAt: '2026-10-19T11:00:00+08:00', endsAt: '2026-10-19T11:30:00+08:00' })).id);
});
test('arrival atomically links appointment, visit, occupancy and clinical draft; different key cannot duplicate arrival', t => {
  const a = setup(t), s = schedule(a), b = a.reception.appointment(a.f, book(a, s));
  const input = cmd({ patientId: 1, dentistId: 4, appointmentId: b.id, expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() });
  const visit = a.reception.arrive(a.f, input);
  assert.equal(a.reception.arrive(a.f, input).replayed, true);
  assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(b.id).status, '已到诊');
  assert.equal(a.db.prepare('SELECT visit_id FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(b.id).visit_id, visit.id);
  assert.equal(a.db.prepare('SELECT status FROM clinical_record WHERE visit_id=?').get(visit.id).status, '草稿');
  assert.throws(() => a.reception.arrive(a.f, { ...input, requestKey: 'different-arrival' }), e => e.code === 'ALREADY_ARRIVED');
});
test('arrival refuses different patient, future date and wrong dentist without leaving a visit', t => {
  const a = setup(t), s = schedule(a), b = a.reception.appointment(a.f, book(a, s));
  const input = { patientId: 1, dentistId: 4, appointmentId: b.id, expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() };
  for (const change of [{ patientId: 2 }, { dentistId: 1 }, { arrivedAt: '2026-10-20T02:00:00Z' }]) assert.throws(() => a.reception.arrive(a.f, cmd({ ...input, ...change })), e => e.status >= 400);
  assert.equal(a.db.prepare('SELECT count(*) n FROM visit').get().n, 0);
});
test('walk-in shares resource conflicts with appointments and creates a clinical draft', t => {
  const a = setup(t), s = schedule(a); a.reception.appointment(a.f, book(a, s));
  const base = { patientId: 2, dentistId: 4, scheduleId: s.id, scheduleRevision: 1, arrivedAt: a.auth.now(), startsAt: '2026-10-19T10:00:00+08:00', endsAt: '2026-10-19T10:30:00+08:00' };
  const visit = a.reception.arrive(a.f, cmd(base)); assert.ok(visit.id);
  assert.throws(() => a.reception.arrive(a.f, cmd({ ...base, startsAt: '2026-10-19T10:20:00+08:00', endsAt: '2026-10-19T10:50:00+08:00' })), e => e.code === 'RESOURCE_CONFLICT');
});
test('same names remain separate; profile changes have original values and cannot change clinical fields', t => {
  const a = setup(t);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient WHERE name=?').get('陈晨（演示）').n, 2);
  const change = cmd({ patientId: 1, expectedRevision: 1, reason: '患者核实新电话', fields: { phone: '13900000001' } });
  a.reception.patient(a.f, change);
  const log = a.db.prepare('SELECT * FROM patient_change WHERE patient_id=1').get(); assert.equal(log.old_value, '13800000001');
  assert.throws(() => a.reception.patient(a.f, cmd({ patientId: 1, expectedRevision: 2, reason: '禁止维护临床字段', fields: { diagnosis: '禁止前台修改' } })), e => e.code === 'INVALID_FIELDS');
});
test('schedule closure rejects existing occupancy; cancel releases slot and allows explicit closure', t => {
  const a = setup(t), s = schedule(a), b = a.reception.appointment(a.f, book(a, s));
  const close = () => a.reception.schedule(a.m, cmd({ action: 'close', scheduleId: s.id, expectedRevision: 1, reason: '牙医临时停诊' }));
  assert.throws(close, e => e.code === 'ACTIVE_OCCUPANCY' && e.details.affected.length === 1);
  a.reception.appointment(a.f, cmd({ action: 'cancel', appointmentId: b.id, expectedRevision: 1, reason: '前台已电话协调取消' }));
  assert.ok(close().id);
});
test('queries use Shanghai day boundaries and never mark overdue appointments absent', t => {
  const a = setup(t), s = schedule(a), b = a.reception.appointment(a.f, book(a, s));
  a.setClock('2026-10-19T04:00:00Z');
  assert.equal(a.reception.list(a.f, { from: '2026-10-19', to: '2026-10-19' }).items.length, 1);
  assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(b.id).status, '已预约');
  a.reception.appointment(a.f, cmd({ action: 'noShow', appointmentId: b.id, expectedRevision: 1, reason: '前台电话核实患者未到院' }));
  assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(b.id).status, '未到');
});
test('audit persistence failure rolls back business facts and does not reserve the request key', t => {
  const a = setup(t), s = schedule(a), input = book(a, s);
  a.db.exec("CREATE TEMP TRIGGER simulate_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'simulated_audit_failure'); END");
  const before = a.db.prepare('SELECT count(*) n FROM appointment').get().n;
  assert.throws(() => a.reception.appointment(a.f, input), /simulated_audit_failure/);
  assert.equal(a.db.prepare('SELECT count(*) n FROM appointment').get().n, before);
  assert.equal(a.db.prepare('SELECT count(*) n FROM request_submission WHERE request_key=?').get(input.requestKey).n, 0);
  a.db.exec('DROP TRIGGER simulate_audit_fault');
  assert.equal(a.reception.appointment(a.f, input).replayed, false);
});
test('a local early-morning booking is included only in its Shanghai business day', t => {
  const a = createApplication({demo:true,clock:()=>new Date('2026-10-18T02:00:00Z')}); t.after(()=>a.db.close());
  const login = username => { const s=a.auth.login({username,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:username}; };
  const f=login('frontdesk'),m=login('manager');
  const s=a.reception.schedule(m,cmd({action:'publish',businessDate:'2026-10-19',startsAt:'2026-10-19T00:00:00+08:00',endsAt:'2026-10-19T01:00:00+08:00',dentistId:4,chairId:1,reason:'独立时区边界测试'}));
  a.reception.appointment(f,cmd({action:'create',patientId:1,scheduleId:s.id,scheduleRevision:1,startsAt:'2026-10-19T00:10:00+08:00',endsAt:'2026-10-19T00:30:00+08:00',reason:'边界案例'}));
  assert.equal(a.reception.list(f,{from:'2026-10-18',to:'2026-10-18'}).items.length,0);
  assert.equal(a.reception.list(f,{from:'2026-10-19',to:'2026-10-19'}).items.length,2);
});
