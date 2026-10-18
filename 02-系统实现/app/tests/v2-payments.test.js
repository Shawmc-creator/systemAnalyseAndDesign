'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, command } = require('./helpers/v2-treatment');
const { insert, fact } = require('../src/v2/common');
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
function bill(a) {
  const s = a.service(); a.price(s.id); a.execute(s.id, { independentCheck: true, independentBasis: '隔离检查依据', quantity: 5 });
  return a.bills().items[0];
}
function receive(a, extra = {}, credentials = a.c) {
  return a.payments.receive(credentials, command({ action: 'receive', patientId: 1, expectedFundsRevision: a.bills().funds.revision,
    receivedCents: 50000, changeCents: 0, channel: '现金', verification: 'confirmed', receivedAt: a.auth.now(),
    transactionEvidence: '收费人员核对实际到账', keepAsPrepayment: true, ...extra }));
}
function use(a, paymentId, billId, cents, extra = {}) {
  const q = a.bills(), p = q.funds.payments.find(p => p.id === paymentId), b = q.items.find(b => b.id === billId);
  return a.payments.allocate(a.c, command({ action: 'allocate', patientId: 1, paymentId, expectedPaymentRevision: p.revision,
    expectedFundsRevision: q.funds.revision, allocations: [{ billId, expectedRevision: b.revision, amountCents: cents, reason: '实际用途核对' }], ...extra }));
}
test('cash receipt and change form net actual funds; allocation and prepayment share one immutable source', t => {
  const a = setup(t), b = bill(a);
  const p = receive(a, { receivedCents: 60000, changeCents: 10000, allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 20000, reason: '本次付款用途' }] });
  let q = a.bills(); assert.equal(q.funds.confirmedReceivedCents, 50000); assert.equal(q.totals.unpaidCents, 80000); assert.equal(q.funds.availableCents, 30000);
  const original = a.db.prepare('SELECT * FROM patient_payment WHERE id=?').get(p.id);
  use(a, p.id, b.id, 10000, { action: 'offset' });
  q = a.bills(); assert.equal(q.funds.confirmedReceivedCents, 50000); assert.equal(q.funds.offsetCents, 10000); assert.equal(q.funds.availableCents, 20000);
  assert.deepEqual(a.db.prepare('SELECT * FROM patient_payment WHERE id=?').get(p.id), original);
  assert.equal(q.funds.payments[0].allocations.length, 1); assert.equal(q.funds.payments[0].offsets.length, 1);
});
test('prepayment without a bill is allowed only with explicit patient balance confirmation', t => {
  const a = setup(t);
  rejects(() => receive(a, { keepAsPrepayment: false }), 'PREPAYMENT_CONFIRMATION');
  assert.equal(a.bills().funds.id, null); assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 0);
  receive(a); assert.equal(a.bills().funds.availableCents, 50000); assert.equal(a.bills().total, 0);
});
test('pending money changes neither unpaid amount nor available funds; verification and purpose commit together', t => {
  const a = setup(t), b = bill(a), p = receive(a, { channel: '微信', verification: 'pending', receivedAt: undefined });
  let q = a.bills(); assert.equal(q.funds.availableCents, 0); assert.equal(q.funds.pendingPaymentCents, 50000); assert.equal(q.totals.unpaidCents, 100000);
  rejects(() => use(a, p.id, b.id, 10000), 'PAYMENT_NOT_CONFIRMED');
  const verified = a.payments.receive(a.c, command({ action: 'verify', patientId: 1, paymentId: p.id, expectedPaymentRevision: 1,
    expectedFundsRevision: q.funds.revision, outcome: 'received', receivedAt: a.auth.now(), externalReference: 'WX-VERIFIED-001', transactionEvidence: '已核对渠道实付原记录',
    allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 50000, reason: '核实后分配到该账目' }] }));
  q = a.bills(); assert.equal(verified.revision, 2); assert.equal(q.funds.pendingPaymentCents, 0); assert.equal(q.totals.unpaidCents, 50000); assert.equal(q.funds.availableCents, 0);
  rejects(() => a.payments.receive(a.c, command({ action: 'verify', patientId: 1, paymentId: p.id, expectedPaymentRevision: 2,
    expectedFundsRevision: q.funds.revision, outcome: 'notReceived', transactionEvidence: '试图覆盖核实结果' })), 'PAYMENT_FROZEN');
});
test('verified nonarrival remains a terminal zero-available source', t => {
  const a = setup(t), b = bill(a), p = receive(a, { verification: 'pending' }), q = a.bills();
  a.payments.receive(a.c, command({ action: 'verify', patientId: 1, paymentId: p.id, expectedPaymentRevision: 1, expectedFundsRevision: q.funds.revision,
    outcome: 'notReceived', transactionEvidence: '实际核对未到账' }));
  assert.equal(a.bills().funds.payments[0].status, '未到账已核实'); assert.equal(a.bills().funds.availableCents, 0);
  rejects(() => use(a, p.id, b.id, 1), 'PAYMENT_NOT_CONFIRMED');
});
test('noncash reference is required and unique under the write lock; cash change rules and future receipts are enforced', t => {
  const a = setup(t); bill(a);
  rejects(() => receive(a, { channel: '微信' }), 'PAYMENT_REFERENCE');
  rejects(() => receive(a, { channel: '微信', externalReference: 'WX-001', changeCents: 1 }), 'PAYMENT_AMOUNT_CHANNEL');
  rejects(() => receive(a, { changeCents: 50000 }), 'PAYMENT_AMOUNT_CHANNEL');
  rejects(() => receive(a, { receivedAt: '2026-10-19T01:36:00Z' }), 'PAYMENT_TIME');
  receive(a, { channel: '微信', externalReference: 'WX-001' });
  rejects(() => receive(a, { channel: '微信', externalReference: 'WX-001' }), 'PAYMENT_DUPLICATE');
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 1);
});
test('same receipt retry returns the original stage, changed key payload and stale aggregate revisions are rejected', t => {
  const a = setup(t), b = bill(a), input = command({ action: 'receive', patientId: 1, expectedFundsRevision: 1, receivedCents: 50000,
    changeCents: 0, channel: '现金', verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '实收', keepAsPrepayment: true });
  const first = a.payments.receive(a.c, input); const repeated = a.payments.receive(a.c, input);
  assert.equal(first.id, repeated.id); assert.equal(repeated.replayed, true);
  rejects(() => a.payments.receive(a.c, { ...input, receivedCents: 60000 }), 'REQUEST_KEY_REUSED');
  rejects(() => receive(a, { expectedFundsRevision: 1 }), 'VERSION_CONFLICT');
  use(a, first.id, b.id, 20000);
  rejects(() => use(a, first.id, b.id, 10000, { expectedFundsRevision: 2 }), 'VERSION_CONFLICT');
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 1);
});
test('over-allocation, overpayment and wrong patient references never consume money', t => {
  const a = setup(t), b = bill(a), p = receive(a);
  rejects(() => use(a, p.id, b.id, 50001), 'PAYMENT_BUDGET');
  rejects(() => use(a, p.id, b.id, 100001), 'BILL_BUDGET');
  const q = a.bills();
  rejects(() => a.payments.allocate(a.c, command({ action: 'allocate', patientId: 2, expectedFundsRevision: null, paymentId: p.id, expectedPaymentRevision: 1,
    allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 10000, reason: '错误患者' }] })), 'PAYMENT_PATIENT');
  assert.equal(a.bills().funds.availableCents, q.funds.availableCents); assert.equal(a.bills().funds.allocatedCents, 0);
});
test('pending refund reservations reduce the same source balance available to both allocation and offset', t => {
  const a = setup(t), b = bill(a), p = receive(a), now = a.auth.now();
  const request = insert(a.db, 'fee_request', fact(now, { patient_funds_id: b.patient_funds_id, bill_id: null, patient_payment_id: p.id,
    reason: '已同意退回未分配原款的隔离夹具', proposed_adjustment_cents: 0, proposed_refund_cents: 20000, evidence: '退款原款依据', submitted_at: now,
    review_note: null, submission_no: 1, approved_adjustment_cents: null, approved_refund_cents: null, reviewed_at: null, created_by: 3, reviewed_by: null,
    status: '待审核', record_no: 'REFUND-REQUEST-TEST' }));
  a.db.prepare("UPDATE fee_request SET status='已同意',approved_adjustment_cents=0,approved_refund_cents=20000,reviewed_at=?,reviewed_by=1,review_note='已核对' WHERE id=?").run(now, request);
  const refund = insert(a.db, 'patient_refund', fact(now, { fee_request_id: request, patient_payment_id: p.id, patient_funds_id: b.patient_funds_id,
    requested_cents: 20000, actual_cents: null, initiated_at: now, channel: '现金', transaction_evidence: null, verification_note: null, external_reference: null,
    verified_at: null, recipient_verification: '核对原付款人', operator_id: 3, verified_by: null, previous_attempt_id: null, status: '待办理', record_no: 'REFUND-TEST' }));
  a.db.prepare("UPDATE patient_refund SET status='待核实' WHERE id=?").run(refund);
  assert.equal(a.bills().funds.refundHeldCents, 20000); assert.equal(a.bills().funds.availableCents, 30000);
  rejects(() => use(a, p.id, b.id, 30001, { action: 'offset' }), 'PAYMENT_BUDGET');
  use(a, p.id, b.id, 30000, { action: 'offset' });
  assert.equal(a.bills().funds.availableCents, 0); assert.equal(a.bills().funds.refundHeldCents, 20000);
  assert.equal(a.bills().funds.refundedCents, 0); assert.equal(a.bills().totals.unpaidCents, 70000);
});
test('verification failure during purpose allocation restores the pending receipt and every balance', t => {
  const a = setup(t), b = bill(a), p = receive(a, { verification: 'pending' }), q = a.bills();
  rejects(() => a.payments.receive(a.c, command({ action: 'verify', patientId: 1, paymentId: p.id, expectedPaymentRevision: 1,
    expectedFundsRevision: q.funds.revision, outcome: 'received', receivedAt: a.auth.now(), transactionEvidence: '到账核实',
    allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 50001, reason: '超出原款' }] })), 'PAYMENT_BUDGET');
  assert.equal(a.bills().funds.payments[0].status, '待核实'); assert.equal(a.bills().funds.revision, q.funds.revision);
  assert.equal(a.bills().funds.allocatedCents, 0); assert.equal(a.bills().totals.unpaidCents, 100000);
});
test('payment audit failure rolls back receipt, purposes, bill revision and funds revision', t => {
  const a = setup(t), b = bill(a), old = a.bills();
  a.db.exec("CREATE TEMP TRIGGER payment_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='patient_payment' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'payment_audit_fault'); END");
  assert.throws(() => receive(a, { allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 20000, reason: '付款用途' }] }), /payment_audit_fault/);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 0); assert.equal(a.db.prepare('SELECT count(*) n FROM payment_allocation').get().n, 0);
  assert.equal(a.bills().funds.revision, old.funds.revision); assert.equal(a.bills().items[0].revision, b.revision);
});
test('receipt-plus-allocation requires both permissions and ordinary clinic roles cannot write financial facts', t => {
  const a = setup(t), b = bill(a);
  rejects(() => receive(a, {}, a.f), 'FORBIDDEN'); rejects(() => receive(a, {}, a.d), 'FORBIDDEN'); rejects(() => receive(a, {}, a.m), 'FORBIDDEN');
  a.db.exec("UPDATE access_permission SET config_version=config_version+1 WHERE code='uc07.allocate'");
  rejects(() => receive(a, { allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: 10000, reason: '不能绕过用途权限' }] }), 'FORBIDDEN');
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 0);
  receive(a); assert.equal(a.bills().funds.availableCents, 50000);
});
