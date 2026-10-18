'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, command } = require('./helpers/v2-treatment');
const { insert, fact } = require('../src/v2/common');
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
function consented(a, items) {
  const version = a.draft(items); a.publish(version.id); a.decide(version.id);
  return a.info().plans[0].versions[0];
}
test('plan estimates never charge; actual consented executions atomically form integer-cent bill lines and authority evidence', t => {
  const a = setup(t), version = consented(a), item = version.items[0];
  assert.equal(a.bills().total, 0); assert.equal(a.bills().funds.id, null);
  const service = a.service(), price = a.price(service.id), execution = a.execute(service.id, { planItemId: item.id, toothCode: '46', surfaceCode: 'O', quantity: 2 });
  const bills = a.bills(); assert.equal(bills.total, 1); assert.equal(bills.totals.receivableCents, 40000); assert.equal(bills.totals.unpaidCents, 40000);
  assert.equal(bills.items[0].items[0].service_price_id, price.id); assert.equal(bills.items[0].summary.settled, false);
  assert.equal(a.info().plans[0].versions[0].items[0].effectiveQuantity, 2);
  const audit = a.db.prepare("SELECT * FROM operation_audit WHERE object_kind='treatment_execution' AND object_key=? AND event_type='变更'").get(String(execution.id));
  const authority = JSON.parse(audit.authority_snapshot);
  assert.equal(authority.decisionId, version.decisions[0].id); assert.equal(authority.decisionScope.itemId, item.id); assert.ok(authority.billItemId);
});
test('empty draft cannot publish; published contents and item membership stay frozen', t => {
  const a = setup(t), empty = a.draft([]); rejects(() => a.publish(empty.id), 'PLAN_EMPTY');
  assert.equal(a.db.prepare('SELECT status,revision FROM plan_version WHERE id=?').get(empty.id).status, '草稿');
  const v = a.draft(); a.publish(v.id);
  rejects(() => a.plan({ action: 'save', versionId: v.id, expectedRevision: 2, items: [] }), 'PLAN_FROZEN');
  assert.throws(() => insert(a.db, 'plan_item', fact(a.auth.now(), { plan_version_id: v.id, item_description: '不能后补', tooth_code: null, surface_code: null, planned_quantity: 1, sequence_no: 2, estimated_cents: null })), /plan_scope_frozen/);
});
test('partial consent grants only explicitly selected items, withdrawal stops that scope and refuses stale decisions', t => {
  const a = setup(t), v = a.draft([{ description: '46项目', toothCode: '46', quantity: 2 }, { description: '47项目', toothCode: '47', quantity: 1 }]); a.publish(v.id);
  const [first, second] = a.info().plans[0].versions[0].items;
  a.decide(v.id, 2, { wholeScope: false, itemIds: [first.id] });
  const s = a.service();
  rejects(() => a.execute(s.id, { planItemId: second.id, toothCode: '47' }), 'CONSENT_REQUIRED');
  a.execute(s.id, { planItemId: first.id, toothCode: '46' });
  a.decide(v.id, 3, { decision: '撤回', wholeScope: false, itemIds: [first.id] });
  rejects(() => a.execute(s.id, { planItemId: first.id, toothCode: '46' }), 'CONSENT_REQUIRED');
  rejects(() => a.decide(v.id, 3), 'VERSION_CONFLICT');
  assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n, 1);
});
test('a later recorded consent cannot authorize an earlier actual execution; future facts also fail', t => {
  const a = setup(t), v = a.draft(); a.publish(v.id);
  a.setClock('2026-10-19T01:36:00Z'); a.decide(v.id, 2, { decidedAt: '2026-10-19T01:35:00Z' });
  const item = a.info().plans[0].versions[0].items[0], s = a.service();
  rejects(() => a.execute(s.id, { planItemId: item.id, toothCode: '46', surfaceCode: 'O', completedAt: '2026-10-19T01:35:30Z' }), 'CONSENT_REQUIRED');
  rejects(() => a.execute(s.id, { planItemId: item.id, toothCode: '46', surfaceCode: 'O', completedAt: '2026-10-19T01:37:00Z' }), 'EXECUTION_TIME');
  assert.equal(a.bills().total, 0);
});
test('whole withdrawal preserves actual history and creates an explicit immutable scope', t => {
  const a = setup(t), v = consented(a), s = a.service(); a.execute(s.id, { planItemId: v.items[0].id, toothCode: '46', surfaceCode: 'O' });
  a.decide(v.id, 3, { decision: '撤回' });
  const info = a.info().plans[0].versions[0]; assert.equal(info.status, '停止后续执行'); assert.equal(info.decisions.length, 2);
  assert.deepEqual(info.decisions[1].itemIds, info.items.map(i => i.id));
  rejects(() => a.execute(s.id, { planItemId: v.items[0].id, toothCode: '46', surfaceCode: 'O' }), 'PLAN_NOT_EXECUTABLE');
  assert.equal(a.bills().items[0].items.length, 1);
});
test('revision copies only remaining quantities, stops the old scope and requires fresh version-specific consent', t => {
  const a = setup(t), v = consented(a), s = a.service(); a.execute(s.id, { planItemId: v.items[0].id, toothCode: '46', surfaceCode: 'O', quantity: 2 });
  const next = a.plan({ action: 'revise', versionId: v.id, expectedRevision: 3, expectedPlanRevision: 1,
    diagnosticBasis: '复核原方案和实际执行', plannedSchedule: '仅安排剩余部分', reason: '患者调整后续安排' });
  let info = a.info().plans[0]; assert.equal(info.versions[0].status, '停止后续执行'); assert.equal(info.versions[1].items[0].planned_quantity, 1);
  assert.equal(info.versions[1].items[0].estimated_cents, null); assert.equal(info.revision, 2);
  a.publish(next.id); const newItem = a.info().plans[0].versions[1].items[0];
  rejects(() => a.execute(s.id, { planItemId: newItem.id, toothCode: '46', surfaceCode: 'O' }), 'PLAN_NOT_EXECUTABLE');
  a.decide(next.id); a.execute(s.id, { planItemId: newItem.id, toothCode: '46', surfaceCode: 'O' });
  assert.equal(a.bills().items[0].items.length, 2); info = a.info().plans[0]; assert.notEqual(info.versions[1].decisions[0].id, info.versions[0].decisions[0].id);
});
test('correction chains count only leaves, never branch or overwrite original charges', t => {
  const a = setup(t), v = consented(a), itemId = v.items[0].id, s = a.service(); a.price(s.id);
  const original = a.execute(s.id, { planItemId: itemId, toothCode: '46', surfaceCode: 'O', quantity: 2 });
  const oldBill = a.bills();
  const corrected = a.execute(s.id, { originalExecutionId: original.id, planItemId: itemId, toothCode: '46', surfaceCode: 'O', quantity: 1, reason: '核实后更正实际数量' });
  assert.equal(corrected.code, 'EXECUTION_CORRECTED_FEE_REVIEW'); assert.equal(a.info().plans[0].versions[0].items[0].effectiveQuantity, 1);
  assert.equal(a.bills().totals.receivableCents, oldBill.totals.receivableCents); assert.equal(a.bills().items[0].items.length, 1);
  assert.equal(a.bills().items[0].items[0].has_clinical_correction, 1);
  rejects(() => a.execute(s.id, { originalExecutionId: original.id, planItemId: itemId, toothCode: '46', surfaceCode: 'O', reason: '重复分叉' }), 'CORRECTION_NOT_LEAF');
  rejects(() => a.execute(s.id, { planItemId: itemId, toothCode: '46', surfaceCode: 'O', quantity: 3 }), 'PLAN_QUANTITY_EXCEEDED');
  a.execute(s.id, { planItemId: itemId, toothCode: '46', surfaceCode: 'O', quantity: 2 });
  assert.equal(a.info().plans[0].versions[0].items[0].effectiveQuantity, 3);
});
test('independent check needs a real stated basis; quantity and tooth scope cannot be spoofed', t => {
  const a = setup(t), s = a.service();
  rejects(() => a.execute(s.id), 'INDEPENDENT_BASIS_REQUIRED');
  rejects(() => a.execute(s.id, { independentCheck: true }), 'INVALID_INPUT');
  a.execute(s.id, { independentCheck: true, independentBasis: '本次独立检查，不据此虚构持续治疗方案' });
  const v = consented(a);
  rejects(() => a.execute(s.id, { planItemId: v.items[0].id, toothCode: '47', surfaceCode: 'O' }), 'EXECUTION_SCOPE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n, 1);
});
test('cross-role, cross-patient and unassigned-clinician access is denied', t => {
  const a = setup(t);
  rejects(() => a.plan({ action: 'draft' }, a.f), 'FORBIDDEN');
  rejects(() => a.plan({ action: 'draft' }, a.other), 'CLINICAL_SCOPE');
  rejects(() => a.plan({ action: 'draft', patientId: 2 }), 'PATIENT_MISMATCH');
  rejects(() => a.treatment.detail(a.f, a.context), 'FORBIDDEN');
  rejects(() => a.billing.query(a.d, { patientId: 1 }), 'FORBIDDEN');
  const s = a.service(); rejects(() => a.execute(s.id, { independentCheck: true, independentBasis: '检查' }, a.m), 'FORBIDDEN');
});
test('decision item and file collections cannot be expanded after commit', t => {
  const a = setup(t), v = a.draft([{ description: '46项目', quantity: 1 }, { description: '47项目', quantity: 1 }]); a.publish(v.id);
  const [first, second] = a.info().plans[0].versions[0].items;
  const decision = a.decide(v.id, 2, { wholeScope: false, itemIds: [first.id] });
  rejects(() => a.unit.command(a.d, 'uc22.plan', command({}), (ctx, now) => {
    insert(a.db, 'decision_plan_item', { decision_id: decision.id, plan_item_id: second.id, linked_at: now, linked_by: ctx.session.staff_id });
    return { kind: 'patient_decision', key: decision.id, revision: 1 };
  }), 'DECISION_SEALED');
  assert.deepEqual(a.info().plans[0].versions[0].decisions[0].itemIds, [first.id]);
});
test('guessed, cross-version and unverified decision sources roll back together', t => {
  const a = setup(t), v = a.draft(); a.publish(v.id);
  rejects(() => a.decide(v.id, 2, { wholeScope: false, itemIds: [] }), 'DECISION_SCOPE');
  rejects(() => a.decide(v.id, 2, { documentVersionIds: [999999] }), 'NOT_FOUND');
  const proxy = insert(a.db, 'patient_proxy', fact(a.auth.now(), { patient_id: 1, proxy_name: '实际核验的代理人', relationship: '监护关系', scope: '自由文字并不自动授予方案决定权',
    valid_from: a.auth.now(), valid_until: null, verification_basis: '仅作隔离测试', verified_by: 4 }));
  rejects(() => a.decide(v.id, 2, { proxyId: proxy }), 'PROXY_SCOPE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_decision').get().n, 0);
  assert.equal(a.db.prepare('SELECT status,revision FROM plan_version WHERE id=?').get(v.id).revision, 2);
});
test('execution repeats return the original receipt; changed payload with the same key is refused', t => {
  const a = setup(t), s = a.service(), input = command({ ...a.context, serviceId: s.id, expectedVisitRevision: 2, quantity: 1,
    completedAt: a.auth.now(), procedureNote: '实际检查', independentCheck: true, independentBasis: '实际独立检查依据' });
  const first = a.treatment.execute(a.d, input), repeated = a.treatment.execute(a.d, input);
  assert.equal(first.id, repeated.id); assert.equal(repeated.replayed, true);
  rejects(() => a.treatment.execute(a.d, { ...input, quantity: 2 }), 'REQUEST_KEY_REUSED');
  assert.equal(a.db.prepare('SELECT count(*) n FROM bill_item').get().n, 1);
});
test('audit failure rolls back execution, bill, funds and submission as one unit', t => {
  const a = setup(t), s = a.service();
  a.db.exec("CREATE TEMP TRIGGER execution_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='treatment_execution' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'execution_audit_fault'); END");
  assert.throws(() => a.execute(s.id, { independentCheck: true, independentBasis: '检查' }), /execution_audit_fault/);
  for (const table of ['treatment_execution', 'bill', 'bill_item', 'patient_funds']) assert.equal(a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(a.db.prepare("SELECT count(*) n FROM request_submission WHERE result_kind='treatment_execution'").get().n, 0);
});
test('only fully executed versions and genuinely finished plans can be declared complete', t => {
  const a = setup(t), v = consented(a), s = a.service();
  rejects(() => a.plan({ action: 'completeVersion', versionId: v.id, expectedRevision: 3 }), 'PLAN_INCOMPLETE');
  a.execute(s.id, { planItemId: v.items[0].id, toothCode: '46', surfaceCode: 'O', quantity: 3 });
  a.plan({ action: 'completeVersion', versionId: v.id, expectedRevision: 3 });
  a.plan({ action: 'close', versionId: v.id, expectedRevision: 4, expectedPlanRevision: 1, outcome: 'complete', reason: '牙医核对本方案范围均已完成' });
  assert.equal(a.info().plans[0].status, '已完成');
  rejects(() => a.execute(s.id, { planItemId: v.items[0].id, toothCode: '46', surfaceCode: 'O' }), 'PLAN_NOT_EXECUTABLE');
  assert.equal(a.bills().items[0].summary.settled, false);
});
test('superseded pending versions cannot be revived into a second executable scope', t => {
  const a = setup(t), v = a.draft(); a.publish(v.id);
  const next = a.plan({ action: 'revise', versionId: v.id, expectedRevision: 2, expectedPlanRevision: 1,
    diagnosticBasis: '患者重新选择尚未执行的项目', plannedSchedule: '重新安排', reason: '重新说明后续选择',
    items: [{ description: '重新说明的独立新范围', quantity: 1 }] });
  rejects(() => a.decide(v.id, 2), 'PLAN_SUPERSEDED');
  a.publish(next.id); a.decide(next.id);
  const s = a.service(), newItem = a.info().plans[0].versions[1].items[0]; a.execute(s.id, { planItemId: newItem.id });
  a.plan({ action: 'completeVersion', versionId: next.id, expectedRevision: 3 });
  a.plan({ action: 'close', versionId: next.id, expectedRevision: 4, expectedPlanRevision: 2, outcome: 'complete', reason: '最新范围已完成，旧待确认版本仅保留历史' });
  assert.equal(a.info().plans[0].status, '已完成');
});
test('late historical withdrawal does not override a more recent actual consent', t => {
  const a = setup(t), v = a.draft(); a.publish(v.id);
  a.setClock('2026-10-19T01:37:00Z'); a.decide(v.id);
  a.setClock('2026-10-19T01:38:00Z'); a.decide(v.id, 3, { decision: '撤回', decidedAt: '2026-10-19T01:36:00Z' });
  assert.equal(a.info().plans[0].versions[0].status, '已确认');
  const s = a.service(); a.execute(s.id, { planItemId: a.info().plans[0].versions[0].items[0].id, toothCode: '46', surfaceCode: 'O' });
});
test('verified proxy scope and exact confirmed document versions are linked and sealed with the decision', t => {
  const a = setup(t), v = a.draft(); a.publish(v.id); const now = a.auth.now();
  const proxy = insert(a.db, 'patient_proxy', fact(now, { patient_id: 1, proxy_name: '已核实代理人', relationship: '实际监护关系',
    scope: JSON.stringify({ planVersionIds: [v.id], operations: ['decide'] }), valid_from: now, valid_until: null, verification_basis: '隔离验证所需的既有资格', verified_by: 4 }));
  const doc = insert(a.db, 'clinical_document', fact(now, { patient_id: 1, visit_id: a.v.id, plan_version_id: v.id,
    document_type: '同意文书', source: '文书模块已存储原件的模拟夹具', ownership_note: '当前患者和版本', created_by: 4, record_no: 'TEST-DOC' }));
  const file = insert(a.db, 'document_version', fact(now, { clinical_document_id: doc, original_name: 'confirmed.pdf', size_bytes: 1, sha256: 'a'.repeat(64),
    captured_at: now, confirmed_at: null, change_reason: '首次归档', version_no: 1, storage_key: 'isolated-test', media_type: 'application/pdf',
    verification_note: null, uploaded_by: 4, confirmed_by: null, previous_version_id: null, status: '原件待确认' }));
  rejects(() => a.decide(v.id, 2, { proxyId: proxy, documentVersionIds: [file] }), 'DOCUMENT_UNCONFIRMED');
  a.db.prepare("UPDATE document_version SET status='原件已确认',confirmed_at=?,confirmed_by=4 WHERE id=?").run(now, file);
  const d = a.decide(v.id, 2, { proxyId: proxy, documentVersionIds: [file] });
  assert.deepEqual(a.info().plans[0].versions[0].decisions[0].documentVersionIds, [file]);
  const second = insert(a.db, 'document_version', fact(now, { clinical_document_id: doc, original_name: 'v2.pdf', size_bytes: 1, sha256: 'b'.repeat(64),
    captured_at: now, confirmed_at: null, change_reason: '后续归档', version_no: 2, storage_key: 'isolated-test-v2', media_type: 'application/pdf',
    verification_note: null, uploaded_by: 4, confirmed_by: null, previous_version_id: file, status: '原件待确认' }));
  rejects(() => a.unit.command(a.d, 'uc22.plan', command({}), (ctx, at) => {
    insert(a.db, 'decision_file_version', { decision_id: d.id, document_version_id: second, linked_at: at, linked_by: ctx.session.staff_id });
    return { kind: 'patient_decision', key: d.id, revision: 1 };
  }), 'DECISION_SEALED');
});
