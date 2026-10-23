'use strict';
const { setup, command } = require('./v2-treatment');
function setupFees(t, { receivedCents = 100000, offsetCents = 0, channel='现金' } = {}) {
  const a = setup(t), service = a.service(); a.price(service.id);
  a.execution = a.execute(service.id, { quantity: 5, independentCheck: true, independentBasis: '隔离财务流程所需的实际检查依据' });
  let q = a.bills(), b = q.items[0]; a.billId = b.id; a.lineId = b.items[0].id;
  a.payment = a.payments.receive(a.c, command({ action: 'receive', patientId: 1, expectedFundsRevision: q.funds.revision,
    receivedCents, changeCents: 0, channel, ...(channel==='现金'?{}:{externalReference:'FEE-PAY-'+require('node:crypto').randomUUID()}), verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '隔离演示实收依据', keepAsPrepayment: true,
    allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: Math.min(receivedCents, 100000) - offsetCents, reason: '原付款用途' }] }));
  if (offsetCents) {
    q = a.bills(); b = q.items[0];
    a.payments.allocate(a.c, command({ action: 'offset', patientId: 1, paymentId: a.payment.id, expectedPaymentRevision: 1, expectedFundsRevision: q.funds.revision,
      allocations: [{ billId: b.id, expectedRevision: b.revision, amountCents: offsetCents, reason: '既有预付抵扣用途' }] }));
  }
  a.request = (extra = {}, credentials = a.c) => {
    const q = a.bills();
    return a.fees.apply(credentials, command({ action: 'submit', patientId: 1, billId: a.billId, paymentId: a.payment.id,
      expectedFundsRevision: q.funds.revision, expectedBillRevision: q.items[0].revision, expectedPaymentRevision: 1,
      adjustmentCents: -20000, refundCents: 20000, reason: '核实后申请应收更正及退回差额', evidence: '核对原单及实际业务依据', ...extra }));
  };
  a.approve = (requestId, extra = {}, credentials = a.m) => {
    const q = a.bills(), r = a.db.prepare('SELECT * FROM fee_request WHERE id=?').get(requestId), p = q.funds.payments.find(p => p.id === a.payment.id);
    return a.fees.approve(credentials, command({ action: 'approve', patientId: 1, requestId, expectedRevision: r.revision,
      expectedFundsRevision: q.funds.revision, expectedBillRevision: q.items[0].revision, expectedPaymentRevision: 1,
      adjustmentCents: -20000, refundCents: 20000, reviewNote: '负责人核实后确认调整与退款范围',
      items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: -20000, note: '有据减少原项目应收' }],
      releases: [{ kind: 'allocation', id: p.allocations[0].id, expectedRevision: 1, amountCents: 20000, reason: '随应收减少释放原用途' }], ...extra }));
  };
  a.begin = (requestId, extra = {}, credentials = a.c) => {
    const q = a.bills(), r = a.db.prepare('SELECT * FROM fee_request WHERE id=?').get(requestId);
    return a.fees.refund(credentials, command({ action: 'initiate', patientId: 1, requestId, paymentId: a.payment.id, expectedApprovalRevision: r.revision,
      expectedFundsRevision: q.funds.revision, expectedBillRevision: q.items[0].revision, expectedPaymentRevision: 1,
      amountCents: 20000, channel, recipientVerification: '核实原付款人及实际接收信息', ...extra }));
  };
  a.finish = (refundId, extra = {}, credentials = a.c) => {
    const q = a.bills(), r = a.db.prepare('SELECT * FROM patient_refund WHERE id=?').get(refundId);
    return a.fees.refund(credentials, command({ action: 'verify', patientId: 1, refundId, expectedRevision: r.revision, expectedFundsRevision: q.funds.revision,
      outcome: 'success', actualCents: 20000, recipientMatches: true, transactionEvidence: '核实线下实际结果', verificationNote: '已核对办理号、金额及接收对象', ...extra }));
  };
  a.feeInfo = (credentials = a.c) => a.fees.query(credentials, { patientId: 1 });
  return a;
}
module.exports = { setupFees, command };
