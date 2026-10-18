'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/v2/server');
const { canonical, hash, insert, fact } = require('../src/v2/common');
const { signaturePayload } = require('../src/v2/clinical-gates');
let serial = 0;
const command = fields => ({ ...fields, requestKey: 'clinical-' + (++serial), commandVersion: 1 });
function setup(t) {
  let clock = new Date('2026-10-19T01:00:00Z');
  const a = createApplication({ demo: true, clock: () => clock }); t.after(() => a.db.close());
  const login = (name, role = name) => { const s = a.auth.login({ username: name, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role }; };
  a.f = login('frontdesk'); a.m = login('manager'); a.d = login('dentist'); a.other = login('manager', 'dentist');
  const schedule = a.reception.schedule(a.m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1, startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '当日接诊安排' }));
  const appointment = a.reception.appointment(a.f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1, startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '检查' }));
  clock = new Date('2026-10-19T01:35:00Z');
  a.v = a.reception.arrive(a.f, command({ patientId: 1, dentistId: 4, appointmentId: appointment.id, expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() }));
  a.appointment = appointment; a.recordId = a.db.prepare('SELECT id FROM clinical_record WHERE visit_id=?').get(a.v.id).id;
  a.setClock = at => { clock = new Date(at); };
  a.start = () => a.clinical.record(a.d, command({ action: 'start', visitId: a.v.id, expectedVisitRevision: 1, startedAt: a.auth.now() }));
  a.health = (extra = {}) => a.clinical.health(a.d, command({ action: 'record', visitId: a.v.id, patientId: 1, expectedHealthVersionId: null, conclusion: '当次已询问，未知事项明确保留', reason: '首次核实',
    items: ['病史', '过敏', '用药'].map(category => ({ category, certainty: '未知', content: '患者暂未能确认', source: '患者当面报告', reportedAt: a.auth.now() })), ...extra }));
  a.save = (extra = {}) => a.clinical.record(a.d, command({ action: 'save', visitId: a.v.id, recordId: a.recordId, expectedRevision: 1, chiefComplaint: '患者主诉右下后牙不适', diagnosis: '由接诊牙医记录实际诊断', treatmentAdvice: '向患者说明检查结果及后续安排', findings: [{ toothCode: '46', surfaceCode: 'O', text: '当次检查所见（隔离演示）' }], ...extra }));
  a.sign = (extra = {}) => a.clinical.sign(a.d, command({ action: 'sign', recordId: a.recordId, expectedRevision: 2, confirmed: true, ...extra }));
  return a;
}
test('clinical flow starts actual contact, retains unknown health facts, signs canonical content and ends visit atomically', t => {
  const a = setup(t); a.start(); a.health(); a.save();
  const signed = a.sign(), record = a.db.prepare('SELECT * FROM clinical_record WHERE id=?').get(a.recordId);
  assert.equal(record.status, '已签署'); assert.equal(record.signed_revision, 2); assert.equal(record.revision, 3);
  assert.equal(record.content_hash, hash(canonical(signaturePayload(a.db, record))));
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(a.v.id).status, '诊疗结束');
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id).n, 0);
  assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(a.appointment.id).status, '已到诊');
  assert.equal(a.clinical.detail(a.d, { visitId: a.v.id, patientId: 1 }).signedIntegrity, true);
  assert.equal(a.db.prepare("SELECT count(*) n FROM health_item WHERE certainty='未知'").get().n, 3);
  assert.equal(signed.kind, 'clinical_record');
});
test('front desk and unassigned dentists cannot read or write clinical data by guessing identifiers', t => {
  const a = setup(t);
  assert.throws(() => a.clinical.detail(a.f, { visitId: a.v.id, patientId: 1 }), e => e.code === 'FORBIDDEN');
  assert.throws(() => a.clinical.detail(a.other, { visitId: a.v.id, patientId: 1 }), e => e.code === 'CLINICAL_SCOPE');
  assert.throws(() => a.clinical.record(a.other, command({ action: 'start', visitId: a.v.id, expectedVisitRevision: 1, startedAt: a.auth.now() })), e => e.code === 'CLINICAL_SCOPE');
  assert.equal(a.clinical.queue(a.other, {}).items.length, 0);
});
test('starting outside the reserved slot or from an outdated visit version is rejected', t => {
  const a = setup(t); a.setClock('2026-10-19T02:05:00Z');
  assert.throws(a.start, e => e.code === 'CONTACT_OUTSIDE_SLOT');
  a.setClock('2026-10-19T01:35:00Z'); a.start(); assert.throws(a.start, e => e.code === 'VERSION_CONFLICT');
});
test('health recording requires all three explicit categories and rolls back partial versions', t => {
  const a = setup(t); a.start();
  assert.throws(() => a.health({ items: [{ category: '过敏', certainty: '无', content: '患者报告无过敏' }] }), e => e.code === 'HEALTH_INCOMPLETE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM health_version').get().n, 0);
  assert.throws(() => a.health({ patientId: 2 }), e => e.code === 'PATIENT_MISMATCH');
});
test('reviewing unchanged health data creates a new review without manufacturing a new version', t => {
  const a = setup(t); a.start(); a.health(); const version = a.db.prepare('SELECT id FROM health_version').get().id;
  a.health({ expectedHealthVersionId: version });
  assert.equal(a.db.prepare('SELECT count(*) n FROM health_version').get().n, 1);
  assert.equal(a.db.prepare('SELECT count(*) n FROM health_review').get().n, 2);
  assert.throws(() => a.health(), e => e.code === 'HEALTH_VERSION_CONFLICT');
});
test('existing health member collections cannot be extended through another command', t => {
  const a = setup(t); a.start(); a.health(); const version = a.db.prepare('SELECT id FROM health_version').get().id;
  assert.throws(() => a.unit.command(a.d, 'uc21.health', command({}), (ctx, now) => {
    insert(a.db, 'health_item', fact(now, { health_version_id: version, category: '病史', certainty: '未知', content: '非法追加', reported_at: now, source: '测试', occurred_at: null }));
    return { kind: 'health_review', key: 1, revision: 1 };
  }), e => e.code === 'HEALTH_VERSION_SEALED' || e.code === 'DATA_CONFLICT');
  assert.equal(a.db.prepare('SELECT count(*) n FROM health_item').get().n, 3);
});
test('signing requires health review, real findings, confirmation and the current draft revision', t => {
  const a = setup(t); a.start(); a.save();
  assert.throws(a.sign, e => e.code === 'SIGNING_INCOMPLETE'); a.health();
  assert.throws(() => a.sign({ confirmed: false }), e => e.code === 'CONFIRMATION_REQUIRED');
  assert.throws(() => a.sign({ expectedRevision: 1 }), e => e.code === 'VERSION_CONFLICT');
});
test('signed records remain frozen, addenda are independent and duplicate requests do not add twice', t => {
  const a = setup(t); a.start(); a.health(); a.save(); a.sign();
  const old = a.db.prepare('SELECT * FROM clinical_record WHERE id=?').get(a.recordId);
  const input = command({ action: 'addendum', recordId: a.recordId, expectedRevision: 3, confirmed: true, content: '独立补充：已向患者再次说明复查事项', reason: '补充沟通记录' });
  const first = a.clinical.sign(a.d, input), repeat = a.clinical.sign(a.d, input);
  assert.equal(first.id, repeat.id); assert.equal(repeat.replayed, true);
  assert.deepEqual(a.db.prepare('SELECT * FROM clinical_record WHERE id=?').get(a.recordId), old);
  assert.throws(() => a.save({ expectedRevision: 3 }), e => e.code === 'VISIT_NOT_ACTIVE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM record_addendum').get().n, 1);
});
test('signed health references cannot be expanded after signing', t => {
  const a = setup(t); a.start(); a.health(); a.save(); a.sign();
  const version = a.db.prepare('SELECT id FROM health_version').get().id;
  assert.throws(() => a.unit.command(a.d, 'uc21.health', command({}), (ctx, now) => {
    const key = insert(a.db, 'health_review', fact(now, { visit_id: a.v.id, health_version_id: version, reviewed_at: now, conclusion: '签后附加复核', reviewed_by: 4 }));
    return { kind: 'health_review', key, revision: 1 };
  }), e => e.code === 'SIGNED_CONTENT_CHANGED');
  assert.equal(a.db.prepare('SELECT count(*) n FROM health_review').get().n, 1);
});
test('a signing audit fault rolls back signature, visit termination and occupancy release together', t => {
  const a = setup(t); a.start(); a.health(); a.save();
  a.db.exec("CREATE TEMP TRIGGER signing_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='clinical_record' AND NEW.after_revision=3 AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'signing_audit_fault'); END");
  assert.throws(a.sign, /signing_audit_fault/);
  assert.equal(a.db.prepare('SELECT status FROM clinical_record WHERE id=?').get(a.recordId).status, '草稿');
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(a.v.id).status, '接诊中');
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id).n, 1);
});
