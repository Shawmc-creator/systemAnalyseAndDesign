'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFees, command } = require('./helpers/v2-fees');
const { insert, fact } = require('../src/v2/common');
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
function approved(a) { const request = a.request(); a.approve(request.id); return request; }
test('paid 1000 becomes receivable 800 only through atomic approval; unknown refund holds 200 until actual confirmation', t => {
  const a = setupFees(t), originalPayment = a.db.prepare('SELECT * FROM patient_payment WHERE id=?').get(a.payment.id), originalLine = a.db.prepare('SELECT * FROM bill_item WHERE id=?').get(a.lineId);
  const before = a.bills(), r = a.request(); assert.equal(a.bills().totals.receivableCents, 100000); assert.equal(a.bills().funds.revision, before.funds.revision);
  a.approve(r.id); let q = a.bills(); assert.equal(q.totals.receivableCents, 80000); assert.equal(q.totals.allocatedCents, 80000); assert.equal(q.totals.unpaidCents, 0);
  assert.equal(q.funds.refundedCents, 0); assert.equal(q.funds.availableCents, 20000);
  const refund = a.begin(r.id); assert.equal(a.bills().funds.availableCents, 0); assert.equal(a.bills().funds.refundHeldCents, 20000);
  a.finish(refund.id, { action: 'markUnknown', actualCents: null }); assert.equal(a.bills().funds.refundHeldCents, 20000);
  a.finish(refund.id); q = a.bills(); assert.equal(q.funds.confirmedReceivedCents, 100000); assert.equal(q.funds.refundedCents, 20000); assert.equal(q.funds.refundHeldCents, 0);
  assert.equal(q.funds.availableCents, 0); assert.equal(q.totals.receivableCents, 80000); assert.equal(q.items[0].summary.settled, true);
  assert.deepEqual(a.db.prepare('SELECT * FROM patient_payment WHERE id=?').get(a.payment.id), originalPayment);
  assert.deepEqual(a.db.prepare('SELECT * FROM bill_item WHERE id=?').get(a.lineId), originalLine);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('cashier cannot approve and manager cannot register the cashier refund stage or change clinical data', t => {
  const a = setupFees(t), r = a.request();
  rejects(() => a.approve(r.id, {}, a.c), 'FORBIDDEN'); rejects(() => a.request({}, a.m), 'FORBIDDEN');
  rejects(() => a.fees.query(a.d, { patientId: 1 }), 'FORBIDDEN'); rejects(() => a.fees.query(a.f, { patientId: 1 }), 'FORBIDDEN');
  a.approve(r.id); rejects(() => a.begin(r.id, {}, a.m), 'FORBIDDEN');
  assert.equal(JSON.stringify(a.feeInfo(a.m)).includes('procedure_note'), false);
});
test('duplicate pending source requests are rejected, withdrawal keeps history and prevents approval', t => {
  const a = setupFees(t), r = a.request(); rejects(() => a.request(), 'FEE_REQUEST_PENDING');
  a.request({ action: 'withdraw', requestId: r.id, expectedRevision: 1, reason: '患者暂不继续申请' });
  assert.equal(a.feeInfo().items[0].status, '已撤回'); rejects(() => a.approve(r.id), 'INVALID_STATE');
  assert.equal(a.bills().funds.availableCents, 0); assert.equal(a.bills().totals.receivableCents, 100000);
  assert.notEqual(a.request().id, r.id);
});
test('return and resubmit retain earlier opinion and complete proposal changes in immutable audit history', t => {
  const a = setupFees(t), r = a.request();
  a.approve(r.id, { action: 'return', reviewNote: '请补充核对依据' });
  a.request({ action: 'resubmit', requestId: r.id, expectedRevision: 2, adjustmentCents: -10000, refundCents: 10000, evidence: '补齐后的实际核对依据', reason: '依据补齐后重新申请' });
  let info = a.feeInfo(a.m).items[0]; assert.equal(info.submission_no, 2); assert.equal(info.revision, 3); assert.equal(info.review_note, null);
  assert.equal(info.history.length, 3);
  const saved = JSON.stringify(info.history); assert.match(saved, /请补充核对依据/); assert.match(saved, /补齐后的实际核对依据/);
  a.approve(r.id, { adjustmentCents: -10000, refundCents: 10000,
    items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: -10000, note: '核实后的范围' }],
    releases: [{ kind: 'allocation', id: a.bills().funds.payments[0].allocations[0].id, expectedRevision: 1, amountCents: 10000, reason: '释放核实差额' }] });
  info = a.feeInfo().items[0]; assert.equal(info.status, '已同意'); assert.equal(info.remainingApprovedRefundCents, 10000);
  rejects(() => a.request({ action: 'resubmit', requestId: r.id, expectedRevision: 4 }), 'INVALID_STATE');
});
test('changed original funds require return and resubmission rather than approving a refreshed stale proposal', t => {
  const a = setupFees(t), r = a.request(), q = a.bills();
  a.payments.receive(a.c, command({ action: 'receive', patientId: 1, expectedFundsRevision: q.funds.revision, receivedCents: 10000, changeCents: 0,
    channel: '现金', verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '申请后发生的另一笔预付', keepAsPrepayment: true }));
  rejects(() => a.approve(r.id), 'FEE_SOURCE_STALE');
  assert.equal(a.feeInfo().items[0].status, '待审核'); assert.equal(a.bills().totals.receivableCents, 100000);
  a.approve(r.id, { action: 'return', reviewNote: '原资金已变化，请重新核对' });
  a.request({ action: 'resubmit', requestId: r.id, expectedRevision: 2 }); a.approve(r.id);
  assert.equal(a.feeInfo().items[0].status, '已同意');
});
test('approval requires exact nonzero detail sum and cannot expand the applied amount or reverse its sign', t => {
  const a = setupFees(t), r = a.request();
  rejects(() => a.approve(r.id, { items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: -19999, note: '不一致' }] }), 'ADJUSTMENT_SUM');
  rejects(() => a.approve(r.id, { adjustmentCents: -20001 }), 'APPROVAL_RANGE');
  rejects(() => a.approve(r.id, { adjustmentCents: 20000 }), 'APPROVAL_RANGE');
  rejects(() => a.approve(r.id, { refundCents: 20001 }), 'APPROVAL_RANGE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM fee_adjustment').get().n, 0);
  assert.equal(a.db.prepare('SELECT status FROM fee_request WHERE id=?').get(r.id).status, '待审核');
});
test('missing or overlarge original-purpose release rolls approval back without changing any prior money fact', t => {
  const a = setupFees(t), r = a.request();
  rejects(() => a.approve(r.id, { releases: [] }), 'RELEASE_REQUIRED');
  rejects(() => a.approve(r.id, { releases: [{ kind: 'allocation', id: a.bills().funds.payments[0].allocations[0].id, expectedRevision: 1, amountCents: 20001, reason: '超额释放' }] }), 'RELEASE_BUDGET');
  assert.equal(a.db.prepare('SELECT count(*) n FROM payment_allocation WHERE amount_cents<0').get().n, 0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM fee_adjustment_item').get().n, 0); assert.equal(a.bills().totals.unpaidCents, 0);
});
test('existing prepayment offsets release by their own source and do not rewrite the old offset', t => {
  const a = setupFees(t, { offsetCents: 40000 }), q = a.bills(), original = q.funds.payments[0].offsets[0], r = a.request();
  a.approve(r.id, { releases: [{ kind: 'offset', id: original.id, expectedRevision: 1, amountCents: 20000, reason: '释放原预付抵扣差额' }] });
  const next = a.bills(); assert.equal(next.funds.offsetCents, 20000); assert.equal(next.funds.allocatedCents, 60000); assert.equal(next.funds.availableCents, 20000);
  assert.equal(a.db.prepare('SELECT amount_cents FROM prepayment_offset WHERE id=?').get(original.id).amount_cents, 40000);
});
test('refund of unused prepayment can approve without changing any bill or inventing adjustment rows', t => {
  const a = setupFees(t, { receivedCents: 120000 }), r = a.request({ billId: null, adjustmentCents: 0, refundCents: 20000 });
  a.approve(r.id, { adjustmentCents: 0, refundCents: 20000, items: [], releases: [] });
  const refund = a.begin(r.id, { expectedBillRevision: undefined }); a.finish(refund.id);
  assert.equal(a.db.prepare('SELECT count(*) n FROM fee_adjustment').get().n, 0); assert.equal(a.bills().totals.receivableCents, 100000);
  assert.equal(a.bills().funds.refundedCents, 20000); assert.equal(a.bills().funds.availableCents, 0);
});
test('submitted adjustment scopes and approved heads cannot be extended or separated at commit', t => {
  const a = setupFees(t), r = approved(a), head = a.db.prepare('SELECT * FROM fee_adjustment WHERE fee_request_id=?').get(r.id);
  // A different priced line permits the row-level FK but must not enlarge the sealed aggregate.
  const s = a.service(); a.price(s.id); a.execute(s.id, { independentCheck: true, independentBasis: '第二项检查' });
  const line = a.bills().items[0].items.find(i => i.id !== a.lineId);
  rejects(() => a.unit.command(a.m, 'uc25.approve', command({}), (ctx, now) => {
    insert(a.db, 'fee_adjustment_item', fact(now, { fee_adjustment_id: head.id, bill_item_id: line.id, amount_cents: 1, note: '非法后补' }));
    return { kind: 'fee_request', key: r.id, revision: 2 };
  }), 'ADJUSTMENT_SEALED');
  const next = a.request({ adjustmentCents: 1, refundCents: 0 });
  rejects(() => a.unit.command(a.m, 'uc25.approve', command({}), (ctx, now) => {
    a.db.prepare("UPDATE fee_request SET status='已同意',approved_adjustment_cents=1,approved_refund_cents=0,review_note='遗漏调整',reviewed_at=?,reviewed_by=1 WHERE id=?").run(now, next.id);
    return { kind: 'fee_request', key: next.id, revision: 2 };
  }), 'ADJUSTMENT_MISSING');
});
test('an approval audit fault atomically restores approval, adjustment, purposes and aggregate revisions', t => {
  const a = setupFees(t), r = a.request(), before = a.bills();
  a.db.exec("CREATE TEMP TRIGGER fee_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='fee_request' AND NEW.event_type='变更' AND NEW.after_revision=2 BEGIN SELECT RAISE(ABORT,'fee_audit_fault'); END");
  assert.throws(() => a.approve(r.id), /fee_audit_fault/);
  assert.equal(a.feeInfo().items[0].status, '待审核'); assert.equal(a.db.prepare('SELECT count(*) n FROM fee_adjustment').get().n, 0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM payment_allocation WHERE amount_cents<0').get().n, 0);
  assert.equal(a.bills().funds.revision, before.funds.revision); assert.equal(a.bills().items[0].revision, before.items[0].revision);
});
test('unknown refund cannot be replaced by a second request or silently release its reservation', t => {
  const a = setupFees(t), r = approved(a), refund = a.begin(r.id);
  a.finish(refund.id, { action: 'markUnknown', actualCents: null });
  rejects(() => a.begin(r.id), 'REFUND_IN_PROGRESS');
  assert.equal(a.bills().funds.refundHeldCents, 20000); assert.equal(a.bills().funds.availableCents, 0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_refund').get().n, 1);
});
test('explicit failed refund frees its hold; retry requires the latest failure and preserves terminal rows', t => {
  const a = setupFees(t), r = approved(a), first = a.begin(r.id);
  a.finish(first.id, { outcome: 'failed', actualCents: 0, transactionEvidence: '渠道明确证实本笔未退成功' });
  assert.equal(a.bills().funds.availableCents, 20000); rejects(() => a.begin(r.id), 'REFUND_RETRY_REFERENCE');
  const second = a.begin(r.id, { previousAttemptId: first.id }); assert.notEqual(first.id, second.id);
  rejects(() => a.finish(first.id), 'REFUND_FROZEN'); a.finish(second.id);
  assert.equal(a.bills().funds.refundedCents, 20000); assert.equal(a.feeInfo().items[0].refunds[1].previous_attempt_id, first.id);
});
test('partial actual refund consumes only its real amount and a second part respects remaining authorization', t => {
  const a = setupFees(t), r = approved(a), first = a.begin(r.id); a.finish(first.id, { actualCents: 15000 });
  assert.equal(a.feeInfo().items[0].remainingApprovedRefundCents, 5000); assert.equal(a.bills().funds.availableCents, 5000);
  rejects(() => a.begin(r.id, { amountCents: 5001 }), 'REFUND_BUDGET');
  const second = a.begin(r.id, { amountCents: 5000 }); a.finish(second.id, { actualCents: 5000 });
  assert.equal(a.bills().funds.refundedCents, 20000); assert.equal(a.feeInfo().items[0].remainingApprovedRefundCents, 0);
});
test('mismatched actual amount or recipient is committed as unknown and keeps all reserved funds', t => {
  const a = setupFees(t), r = approved(a), first = a.begin(r.id);
  const mismatch = a.finish(first.id, { actualCents: 20001 }); assert.equal(mismatch.code, 'REFUND_REVIEW_REQUIRED');
  let row = a.feeInfo().items[0].refunds[0]; assert.equal(row.status, '待核实'); assert.equal(row.actual_cents, null);
  const wrongRecipient = a.finish(first.id, { recipientMatches: false }); assert.equal(wrongRecipient.code, 'REFUND_REVIEW_REQUIRED');
  assert.equal(a.bills().funds.refundHeldCents, 20000); assert.equal(a.bills().funds.refundedCents, 0);
  a.finish(first.id); row = a.feeInfo().items[0].refunds[0]; assert.equal(row.status, '已确认退款');
  const observations = a.db.prepare("SELECT authority_snapshot FROM operation_audit WHERE object_kind='patient_refund' AND object_key=? AND event_type='变更'").all(String(first.id));
  assert.ok(observations.some(o => JSON.parse(o.authority_snapshot).observedActualCents === 20001));
});
test('noncash refunds need a stable unique transaction reference before any success is confirmed', t => {
  const a = setupFees(t, { receivedCents: 200000 }), r = approved(a), first = a.begin(r.id, { channel: '微信' });
  assert.equal(a.finish(first.id).code, 'REFUND_REVIEW_REQUIRED');
  a.finish(first.id, { externalReference: 'WX-REFUND-ONE' });
  const next = a.request({ adjustmentCents: 0, refundCents: 10000 }); a.approve(next.id, { adjustmentCents: 0, refundCents: 10000, items: [], releases: [] });
  const second = a.begin(next.id, { amountCents: 10000, channel: '微信' });
  rejects(() => a.finish(second.id, { actualCents: 10000, externalReference: 'WX-REFUND-ONE' }), 'REFUND_DUPLICATE');
  a.finish(second.id, { action: 'markUnknown', actualCents: null, externalReference: 'WX-REFUND-TWO' });
  rejects(() => a.finish(second.id, { actualCents: 10000, externalReference: 'WX-REFUND-THREE' }), 'REFUND_REFERENCE_FROZEN');
  a.finish(second.id, { actualCents: 10000, externalReference: 'WX-REFUND-TWO' });
  assert.equal(a.bills().funds.refundedCents, 30000);
});
test('same stage retries retain original receipts after later refund state changes', t => {
  const a = setupFees(t), r = approved(a), q = a.bills();
  const input = command({ action: 'initiate', patientId: 1, requestId: r.id, expectedApprovalRevision: 2, paymentId: a.payment.id, expectedPaymentRevision: 1,
    expectedBillRevision: q.items[0].revision, expectedFundsRevision: q.funds.revision, amountCents: 20000, channel: '现金', recipientVerification: '核对原付款人' });
  const first = a.fees.refund(a.c, input); a.finish(first.id);
  const replay = a.fees.refund(a.c, input); assert.equal(replay.replayed, true); assert.equal(replay.revision, 1); assert.equal(replay.id, first.id);
  rejects(() => a.fees.refund(a.c, { ...input, amountCents: 10000 }), 'REQUEST_KEY_REUSED');
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_refund').get().n, 1);
});
test('refund confirmation audit failure retains the in-flight hold and no successful cash outflow', t => {
  const a = setupFees(t), r = approved(a), refund = a.begin(r.id), before = a.bills();
  a.db.exec("CREATE TEMP TRIGGER refund_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='patient_refund' AND NEW.event_type='变更' AND NEW.after_revision=2 BEGIN SELECT RAISE(ABORT,'refund_audit_fault'); END");
  assert.throws(() => a.finish(refund.id), /refund_audit_fault/);
  assert.equal(a.feeInfo().items[0].refunds[0].status, '待办理'); assert.equal(a.bills().funds.refundHeldCents, 20000);
  assert.equal(a.bills().funds.refundedCents, 0); assert.equal(a.bills().funds.revision, before.funds.revision);
});
test('positive receivable correction creates unpaid money without inventing receipt or refund facts', t => {
  const a = setupFees(t), r = a.request({ paymentId: null, adjustmentCents: 10000, refundCents: 0 });
  a.approve(r.id, { adjustmentCents: 10000, refundCents: 0, releases: [],
    items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: 10000, note: '核对少计的应收' }] });
  assert.equal(a.bills().totals.receivableCents, 110000); assert.equal(a.bills().totals.unpaidCents, 10000);
  assert.equal(a.bills().funds.confirmedReceivedCents, 100000); assert.equal(a.bills().funds.refundedCents, 0);
});
test('mixed positive and negative line corrections validate final totals independently of requested row order', t => {
  const a = setupFees(t), s = a.service(); a.price(s.id); a.execute(s.id, { independentCheck: true, independentBasis: '第二项独立检查' });
  let q = a.bills(); const second = q.items[0].items.find(i => i.id !== a.lineId);
  a.payments.receive(a.c, command({ action: 'receive', patientId: 1, expectedFundsRevision: q.funds.revision, receivedCents: 20000, changeCents: 0,
    channel: '现金', verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '第二项实际付款',
    allocations: [{ billId: a.billId, expectedRevision: q.items[0].revision, amountCents: 20000, reason: '第二项用途' }] }));
  const r = a.request({ paymentId: null });
  a.approve(r.id, { items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: -30000, note: '第一项减少' },
    { billItemId: second.id, expectedRevision: 1, amountCents: 10000, note: '第二项增加' }] });
  q = a.bills(); assert.equal(q.totals.receivableCents, 100000); assert.equal(q.totals.allocatedCents, 100000); assert.equal(q.totals.unpaidCents, 0);
  assert.equal(q.funds.availableCents, 20000);
});
test('clinical correction references trace to the actual bill root and cannot be replaced by an ordinary execution', t => {
  const a = setupFees(t), original = a.db.prepare('SELECT * FROM treatment_execution WHERE id=?').get(a.execution.id);
  const correction = a.execute(original.service_id, { originalExecutionId: original.id, quantity: 4, reason: '牙医核实后更正实际数量' });
  rejects(() => a.request({ clinicalCorrectionIds: [original.id] }), 'CORRECTION_REFS');
  const r = a.request({ clinicalCorrectionIds: [correction.id] }); a.approve(r.id);
  assert.deepEqual(a.feeInfo(a.m).items[0].history[0].clinicalCorrectionIds, [correction.id]);
  assert.equal(a.db.prepare('SELECT completed_quantity FROM treatment_execution WHERE id=?').get(original.id).completed_quantity, 5);
});
test('source identity and known-price requirements are checked before mutating approval state', t => {
  const a = setupFees(t); const other = a.payments.receive(a.c, command({ action: 'receive', patientId: 2, expectedFundsRevision: null, receivedCents: 10000,
    changeCents: 0, channel: '现金', verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '另一患者的预付', keepAsPrepayment: true }));
  rejects(() => a.request({ patientId: 2, expectedFundsRevision: 2, paymentId: other.id }), 'PAYMENT_PATIENT');
  rejects(() => a.request({ refundCents: 200000 }), 'REFUND_BUDGET');
  const s = a.service(); a.execute(s.id, { independentCheck: true, independentBasis: '缺价检查' });
  const pending = a.bills().items[0].items.find(i => i.pricing_status === '待核价'), r = a.request();
  rejects(() => a.approve(r.id, { action: 'return', patientId: 2 }), 'PAYMENT_PATIENT');
  rejects(() => a.approve(r.id, { items: [{ billItemId: pending.id, expectedRevision: 1, amountCents: -20000, note: '不能为缺价项目编造减价' }] }), 'ADJUSTMENT_SOURCE');
  assert.equal(a.feeInfo().items[0].status, '待审核');
});
test('approval binds the submitted proposal fingerprint as well as its source revisions', t => {
  const a = setupFees(t), r = a.request();
  a.db.prepare("UPDATE fee_request SET evidence='绕过提交入口改变的依据' WHERE id=?").run(r.id);
  rejects(() => a.approve(r.id), 'APPROVAL_BASIS_MISSING');
  assert.equal(a.db.prepare('SELECT count(*) n FROM fee_adjustment').get().n, 0);
});
