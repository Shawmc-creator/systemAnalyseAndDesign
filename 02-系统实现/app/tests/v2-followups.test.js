'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFollowups, command } = require('./helpers/v2-followups');
const { insert, fact } = require('../src/v2/common');
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
function published(a, extra) { const f = a.createFollowup(extra); a.signSource(); return f; }
test('draft followup is hidden from front desk and publishes with signed source and a separate atomic audit', t => {
  const a = setupFollowups(t), f = a.createFollowup(); assert.equal(a.followup(f.id).status, '待发布'); assert.equal(a.queue().total, 0);
  assert.equal(a.queue(a.d).items[0].status, '待发布');
  rejects(() => a.followups.propose(a.d, command({ action: 'publish', patientId: 1, followupId: f.id, expectedRevision: 1 })), 'FOLLOWUP_SOURCE_NOT_READY');
  a.signSource(); assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.followup(f.id).revision, 2); assert.equal(a.queue().total, 1);
  const audit = a.db.prepare("SELECT * FROM operation_audit WHERE object_kind='followup_requirement' AND object_key=? AND outcome_code='FOLLOWUP_PUBLISHED'").get(String(f.id));
  assert.ok(audit); assert.equal(audit.before_revision, 1); assert.equal(audit.after_revision, 2); assert.ok(audit.submission_id);
});
test('a plan-only source publishes only after its own explicit consent and remains independent of payment', t => {
  const a = setupFollowups(t), version = a.draft(); a.publish(version.id);
  const f = a.createFollowup({ sourceVisitId: null, sourcePlanVersionId: version.id }); assert.equal(a.followup(f.id).status, '待发布');
  a.decide(version.id); assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.bills().total, 0);
});
test('when both source references are selected each must be ready before automatic publication', t => {
  const a = setupFollowups(t), version = a.draft(); a.publish(version.id);
  const f = a.createFollowup({ sourcePlanVersionId: version.id }); a.signSource(); assert.equal(a.followup(f.id).status, '待发布');
  a.decide(version.id); assert.equal(a.followup(f.id).status, '待联系');
});
test('overlapping duplicate requirements and invalid responsibility, dates and source identity are rejected', t => {
  const a = setupFollowups(t); a.createFollowup();
  rejects(() => a.createFollowup(), 'FOLLOWUP_DUPLICATE'); rejects(() => a.createFollowup({ responsibleFrontdeskId: 4 }), 'FRONTDESK_UNAVAILABLE');
  rejects(() => a.createFollowup({ targetEnd: '2026-10-19' }), 'FOLLOWUP_WINDOW'); rejects(() => a.createFollowup({ patientId: 2 }), 'PATIENT_MISMATCH');
  rejects(() => a.createFollowup({ sourceVisitId: null }), 'FOLLOWUP_SOURCE'); rejects(() => a.createFollowup({}, a.other), 'FOLLOWUP_SCOPE');
  rejects(() => a.createFollowup({}, a.f), 'FORBIDDEN');
});
test('inactive designated front desk does not block clinical signing; dentist can reassign and explicitly publish', t => {
  const a = setupFollowups(t); a.enableSecondFrontdesk(); const f = a.createFollowup();
  a.db.prepare("UPDATE user_account SET status='停用',disabled_at=?,disabled_reason='测试离岗',revision=revision+1 WHERE id=2").run(a.auth.now());
  a.signSource(); assert.equal(a.followup(f.id).status, '待发布');
  const original = a.followup(f.id);
  a.followups.propose(a.d, command({ action: 'update', patientId: 1, followupId: f.id, expectedRevision: original.revision,
    purpose: original.purpose, type: original.followup_type, targetStart: original.target_start, targetEnd: original.target_end,
    requiresAssessment: true, responsibleFrontdeskId: 5, reason: '原前台离岗，指定新的有效责任' }));
  a.followups.propose(a.d, command({ action: 'publish', patientId: 1, followupId: f.id, expectedRevision: 2 }));
  assert.equal(a.queue(a.frontdesk2).total, 1);
});
test('unreached and refused contacts append immutable attempts with a next date and never finish clinical work', t => {
  const a = setupFollowups(t), f = published(a);
  rejects(() => a.contact(f.id, { result: '未联系上', nextStep: 'continue' }), 'INVALID_INPUT');
  a.contact(f.id, { result: '未联系上', nextStep: 'continue', nextContactDate: '2026-10-20' });
  a.contact(f.id, { result: '拒绝', nextStep: 'continue', nextContactDate: '2026-10-21', note: '患者原述暂缓，交牙医核对后续' });
  assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.queue().items[0].contacts.length, 2);
  rejects(() => a.contact(f.id, { result: '拒绝', nextStep: 'complete', goalAchieved: true, completionBasis: '不能用拒绝冒充完成' }), 'FOLLOWUP_CONTACT_RESULT');
  assert.throws(() => a.db.prepare("UPDATE contact_history SET result='已联系' WHERE id=1").run(), /immutable_fact/);
});
test('front desk cannot finish a clinical goal and escalated clinical questions cannot be completed as an ordinary call', t => {
  const a = setupFollowups(t), f = published(a);
  rejects(() => a.contact(f.id, { nextStep: 'complete', goalAchieved: true, completionBasis: '电话联系不能替代临床评估' }), 'FOLLOWUP_ASSESSMENT_REQUIRED');
  a.contact(f.id); assert.equal(a.followup(f.id).requires_assessment, 1); assert.equal(a.followup(f.id).status, '待到诊或评估');
  rejects(() => a.assess(f.id, {}, a.f), 'FORBIDDEN');
});
test('only a doctor-designated nonclinical goal can be explicitly completed by its responsible front desk', t => {
  const a = setupFollowups(t), f = published(a, { type: '随访', requiresAssessment: false, purpose: '仅核对下次联系资料' });
  a.contact(f.id, { nextStep: 'complete', goalAchieved: true, completionBasis: '当面核对要求中的联系资料目标已达成' });
  assert.equal(a.followup(f.id).status, '已完成'); assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_assessment').get().n, 0);
  rejects(() => a.contact(f.id), 'FOLLOWUP_CLOSED'); rejects(() => a.assess(f.id), 'FOLLOWUP_CLOSED');
});
test('responsibility transfer is scoped, qualified, audited and removes the old front desk access', t => {
  const a = setupFollowups(t); a.enableSecondFrontdesk(); const f = published(a);
  rejects(() => a.contact(f.id, {}, a.frontdesk2), 'FOLLOWUP_FRONTDESK_SCOPE');
  a.contact(f.id, { action: 'transfer', responsibleFrontdeskId: 5, reason: '真实交班转交待办' });
  assert.equal(a.queue().total, 0); assert.equal(a.queue(a.frontdesk2).total, 1);
  rejects(() => a.contact(f.id), 'FOLLOWUP_FRONTDESK_SCOPE');
  const changes = a.db.prepare("SELECT c.* FROM audit_change c JOIN operation_audit a ON a.id=c.audit_id WHERE a.object_kind='followup_requirement' AND c.field_name='responsible_frontdesk_id'").all();
  assert.ok(changes.some(c => c.before_value === '2' && c.after_value === '5'));
});
test('linking an actual valid appointment never consumes a new resource and reminders retain its association', t => {
  const a = setupFollowups(t), f = published(a); a.advance('2026-10-20T01:00:00Z'); const booking = a.book();
  const before = a.db.prepare('SELECT count(*) n FROM resource_occupancy').get().n;
  a.contact(f.id, { nextStep: 'arrange', appointmentId: booking.id, expectedAppointmentRevision: 1 });
  a.contact(f.id, { result: '未联系上', nextStep: 'continue', nextContactDate: '2026-10-20' });
  assert.equal(a.followup(f.id).status, '待到诊或评估'); assert.equal(a.queue().items[0].contacts.at(-1).appointment_id, booking.id);
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy').get().n, before);
});
test('appointment cancellation restores pending contact and its own audit without deleting any contact evidence', t => {
  const a = setupFollowups(t), f = published(a); a.advance('2026-10-20T01:00:00Z'); const booking = a.book();
  a.contact(f.id, { nextStep: 'arrange', appointmentId: booking.id, expectedAppointmentRevision: 1 });
  a.reception.appointment(a.f, command({ action: 'cancel', appointmentId: booking.id, expectedRevision: 1, reason: '患者实际取消复诊' }));
  assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.followup(f.id).next_contact_date, '2026-10-20');
  assert.equal(a.queue().items[0].contacts[0].appointment_id, booking.id);
  assert.ok(a.db.prepare("SELECT id FROM operation_audit WHERE object_kind='followup_requirement' AND outcome_code='FOLLOWUP_CONTACT_RESTORED'").get());
});
test('a no-show restores followup only after the actual appointment cutoff', t => {
  const a = setupFollowups(t), f = published(a); a.advance('2026-10-20T01:00:00Z'); const booking = a.book();
  a.contact(f.id, { nextStep: 'arrange', appointmentId: booking.id, expectedAppointmentRevision: 1 });
  rejects(() => a.reception.appointment(a.f, command({ action: 'noShow', appointmentId: booking.id, expectedRevision: 1, reason: '尚未到截止' })), 'NOT_DUE');
  a.advance('2026-10-20T04:00:00Z'); a.reception.appointment(a.f, command({ action: 'noShow', appointmentId: booking.id, expectedRevision: 1, reason: '超过截止后核实未到' }));
  assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.queue().items[0].contacts[0].appointment_status, '未到');
});
test('wrong-patient, expired and out-of-window appointments cannot become valid followup links', t => {
  const a = setupFollowups(t), f = published(a); a.advance('2026-10-20T01:00:00Z');
  const other = a.book('2026-10-20', { patientId: 2 });
  rejects(() => a.contact(f.id, { nextStep: 'arrange', appointmentId: other.id, expectedAppointmentRevision: 1 }), 'PATIENT_MISMATCH');
  const late = a.book('2026-10-23');
  rejects(() => a.contact(f.id, { nextStep: 'arrange', appointmentId: late.id, expectedAppointmentRevision: 1 }), 'FOLLOWUP_APPOINTMENT_WINDOW');
  a.advance('2026-10-24T01:00:00Z');
  rejects(() => a.contact(f.id, { nextStep: 'arrange', appointmentId: late.id, expectedAppointmentRevision: 1 }), 'FOLLOWUP_APPOINTMENT');
});
test('remote clinical assessment is distinct from a physical visit and front desk cannot read clinical conclusions', t => {
  const a = setupFollowups(t), f = published(a); a.contact(f.id);
  rejects(() => a.assess(f.id, { visitId: a.v.id }), 'FOLLOWUP_REMOTE_VISIT');
  a.assess(f.id, { result: '仅牙医可见的临床评估正文' });
  assert.equal(a.followup(f.id).status, '已完成'); assert.equal(a.db.prepare('SELECT visit_id FROM clinical_assessment').get().visit_id, null);
  assert.equal(JSON.stringify(a.queue()).includes('仅牙医可见'), false); assert.equal(JSON.stringify(a.queue(a.d)).includes('仅牙医可见'), true);
});
test('physical followup assessment requires a later actual clinical contact, not the original visit or a waiting registration', t => {
  const a = setupFollowups(t), f = published(a);
  rejects(() => a.assess(f.id, { method: '到诊检查', visitId: a.v.id }), 'FOLLOWUP_VISIT_NOT_ACTUAL');
  a.advance('2026-10-20T01:00:00Z'); const booking = a.book(); a.contact(f.id, { nextStep: 'arrange', appointmentId: booking.id, expectedAppointmentRevision: 1 });
  a.advance('2026-10-20T03:05:00Z'); const v = a.startFollowupVisit(booking.id);
  a.assess(f.id, { method: '到诊检查', visitId: v.id }); assert.equal(a.followup(f.id).status, '已完成');
  assert.equal(a.db.prepare('SELECT visit_id FROM clinical_assessment').get().visit_id, v.id);
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(v.id).status, '接诊中');
});
test('continued assessment retains next date and contact responsibility; clinical assignment does not grant unrelated chart access', t => {
  const a = setupFollowups(t), f = published(a); a.contact(f.id);
  rejects(() => a.assess(f.id, { advice: '继续跟进', assessmentCompleted: false }), 'INVALID_INPUT');
  a.assess(f.id, { advice: '继续跟进', nextDate: '2026-10-21', responsibleStaffId: 1 });
  assert.equal(a.followup(f.id).status, '待联系'); assert.equal(a.followup(f.id).responsible_frontdesk_id, 2);
  assert.equal(a.queue(a.other).total, 1);
  rejects(() => a.clinical.detail(a.other, { patientId: 1, visitId: a.v.id }), 'CLINICAL_SCOPE');
});
test('doctor cancellation keeps appointments and historical facts; a closed requirement cannot reopen', t => {
  const a = setupFollowups(t), f = published(a); a.advance('2026-10-20T01:00:00Z'); const booking = a.book();
  a.contact(f.id, { nextStep: 'arrange', appointmentId: booking.id, expectedAppointmentRevision: 1 });
  a.followups.propose(a.d, command({ action: 'cancel', followupId: f.id, patientId: 1, expectedRevision: a.followup(f.id).revision, reason: '牙医核对后撤销本要求' }));
  assert.equal(a.followup(f.id).status, '已撤销'); assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(booking.id).status, '已预约');
  assert.equal(a.queue().items[0].contacts.length, 1); rejects(() => a.assess(f.id), 'FOLLOWUP_CLOSED');
});
test('contact retries and stale revisions never append duplicate attempts', t => {
  const a = setupFollowups(t), f = published(a), input = command({ action: 'record', patientId: 1, followupId: f.id, expectedRevision: 2,
    contactedAt: a.auth.now(), method: '电话', result: '未联系上', nextStep: 'continue', nextContactDate: '2026-10-20', note: '真实未接通' });
  const first = a.followups.contact(a.f, input), replay = a.followups.contact(a.f, input); assert.equal(first.id, replay.id); assert.equal(replay.replayed, true);
  rejects(() => a.followups.contact(a.f, { ...input, note: '同号变更正文' }), 'REQUEST_KEY_REUSED');
  rejects(() => a.contact(f.id, { expectedRevision: 2 }), 'VERSION_CONFLICT');
  assert.equal(a.db.prepare('SELECT count(*) n FROM contact_history').get().n, 1);
});
test('a clinical sign publication audit failure rolls signing, visit end, occupancy release and followup publication back together', t => {
  const a = setupFollowups(t), f = a.createFollowup();
  a.db.exec("CREATE TEMP TRIGGER followup_publish_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='followup_requirement' AND NEW.outcome_code='FOLLOWUP_PUBLISHED' BEGIN SELECT RAISE(ABORT,'followup_publish_fault'); END");
  assert.throws(a.signSource, /followup_publish_fault/);
  assert.equal(a.followup(f.id).status, '待发布'); assert.equal(a.db.prepare('SELECT status FROM clinical_record WHERE visit_id=?').get(a.v.id).status, '草稿');
  assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(a.v.id).status, '接诊中');
  assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id).n, 1);
});
test('a contact audit failure leaves no contact attempt or changed followup state', t => {
  const a = setupFollowups(t), f = published(a), before = a.followup(f.id);
  a.db.exec("CREATE TEMP TRIGGER contact_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='contact_history' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'contact_audit_fault'); END");
  assert.throws(() => a.contact(f.id), /contact_audit_fault/);
  assert.deepEqual(a.followup(f.id), before); assert.equal(a.db.prepare('SELECT count(*) n FROM contact_history').get().n, 0);
});
test('completed work requires actual evidence and terminal collections cannot receive new contact facts', t => {
  const a = setupFollowups(t), f = published(a, { requiresAssessment: false });
  rejects(() => a.unit.command(a.f, 'uc13.contact', command({}), (ctx, now) => {
    a.db.prepare("UPDATE followup_requirement SET status='已完成',closed_at=?,closed_by=2,closure_basis='没有实际联系' WHERE id=?").run(now, f.id);
    return { kind: 'followup_requirement', key: f.id, revision: 3 };
  }), 'FOLLOWUP_COMPLETION_BASIS');
  a.contact(f.id, { nextStep: 'complete', goalAchieved: true, completionBasis: '明确达成无需临床评估的目标' });
  rejects(() => a.unit.command(a.f, 'uc13.contact', command({}), (ctx, now) => {
    const key = insert(a.db, 'contact_history', fact(now, { followup_requirement_id: f.id, appointment_id: null, method: '电话', contacted_at: now, result: '已联系', next_contact_date: null, note: '终态后非法追加', operator_id: 2 }));
    return { kind: 'contact_history', key, revision: 1 };
  }), 'FOLLOWUP_CLOSED');
});
test('work queues filter overdue duties and date windows without exposing unpublished or other clinical tasks', t => {
  const a = setupFollowups(t), f = published(a, { nextContactDate: '2026-10-19' });
  assert.equal(a.queue(a.f, { overdueOnly: 'true' }).total, 0); a.advance('2026-10-20T01:00:00Z');
  assert.equal(a.queue(a.f, { overdueOnly: 'true' }).items[0].id, f.id); assert.equal(a.queue(a.other).total, 0);
  assert.equal(a.queue(a.f, { from: '2026-10-21' }).total, 0); assert.equal(a.queue(a.f, { page: 2, pageSize: 1 }).items.length, 0);
  rejects(() => a.queue(a.f, { overdueOnly: 'yes' }), 'INVALID_FILTER'); rejects(() => a.queue(a.f, { pageSize: 101 }), 'INVALID_PAGE');
});
