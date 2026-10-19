'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFees, command } = require('./helpers/v2-fees');
test('fee HTTP workflow handles role checks, concurrent approval and refund retries, unknown hold and one real confirmed outflow', async t => {
  const a = setupFees(t); await new Promise(resolve => a.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => a.server.close(resolve)); });
  const base = 'http://127.0.0.1:' + a.server.address().port + '/api/v2';
  const send = async (p, headers, value, expected = 200) => {
    const response = await fetch(base + p, { method: value ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const login = async username => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    const s = await r.json(); assert.equal(r.status, 200); return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': s.csrf, 'X-Clinic-Role': username };
  };
  const c = await login('cashier'), m = await login('manager'), f = await login('frontdesk');
  const path = '/patient-bills/query?patientId=1', q = await send(path, c), b = q.items[0], p = q.funds.payments[0];
  const apply = command({ action: 'submit', patientId: 1, billId: b.id, paymentId: p.id, expectedFundsRevision: q.funds.revision,
    expectedBillRevision: b.revision, expectedPaymentRevision: p.revision, adjustmentCents: -20000, refundCents: 20000,
    reason: '原实收1000元，核实正确应收800元', evidence: '核对原费用及处理依据' });
  await send('/fee-requests/apply', f, apply, 403);
  const r = await send('/fee-requests/apply', c, apply);
  assert.equal((await send(path, c)).funds.refundedCents, 0);
  const approval = command({ action: 'approve', patientId: 1, requestId: r.id, expectedRevision: 1, expectedFundsRevision: q.funds.revision,
    expectedBillRevision: b.revision, expectedPaymentRevision: p.revision, adjustmentCents: -20000, refundCents: 20000, reviewNote: '负责人核实调整及退款上限',
    items: [{ billItemId: a.lineId, expectedRevision: 1, amountCents: -20000, note: '实际应收更正' }],
    releases: [{ kind: 'allocation', id: p.allocations[0].id, expectedRevision: 1, amountCents: 20000, reason: '同步释放原用途' }] });
  await send('/fee-request-decisions/approve', c, approval, 403);
  const approved = await Promise.all([send('/fee-request-decisions/approve', m, approval), send('/fee-request-decisions/approve', m, approval)]);
  assert.equal(approved.filter(x => !x.replayed).length, 1);
  let info = await send('/fee-requests/query?patientId=1', c), current = await send(path, c);
  assert.equal(current.totals.receivableCents, 80000); assert.equal(current.funds.availableCents, 20000); assert.equal(info.items[0].remainingApprovedRefundCents, 20000);
  const initiate = command({ action: 'initiate', patientId: 1, requestId: r.id, expectedApprovalRevision: 2, paymentId: p.id,
    expectedPaymentRevision: 1, expectedFundsRevision: current.funds.revision, expectedBillRevision: current.items[0].revision,
    amountCents: 20000, channel: '现金', recipientVerification: '核实原付款人与接收信息' });
  const begun = await Promise.all([send('/patient-refunds/refund', c, initiate), send('/patient-refunds/refund', c, initiate)]);
  assert.equal(begun.filter(x => !x.replayed).length, 1); const refundId = begun[0].id;
  current = await send(path, c);
  const unknown = command({ action: 'markUnknown', patientId: 1, refundId, expectedRevision: 1, expectedFundsRevision: current.funds.revision,
    transactionEvidence: '尚未取得明确渠道结论', verificationNote: '保留原办理号继续核查' });
  await send('/patient-refunds/refund', { ...c, 'X-CSRF-Token': 'wrong' }, unknown, 403);
  await send('/patient-refunds/refund', c, unknown);
  current = await send(path, c); assert.equal(current.funds.refundHeldCents, 20000); assert.equal(current.funds.refundedCents, 0);
  const another = command({ ...initiate, expectedFundsRevision: current.funds.revision });
  assert.equal((await send('/patient-refunds/refund', c, another, 409)).code, 'REFUND_IN_PROGRESS');
  const confirm = command({ action: 'verify', patientId: 1, refundId, expectedRevision: 2, expectedFundsRevision: current.funds.revision,
    outcome: 'success', actualCents: 20000, recipientMatches: true, transactionEvidence: '实际退款及对象已经线下核实', verificationNote: '确认原办理的真实结果' });
  const confirmed = await Promise.all([send('/patient-refunds/refund', c, confirm), send('/patient-refunds/refund', c, confirm)]);
  assert.equal(confirmed.filter(x => !x.replayed).length, 1);
  current = await send(path, c); info = await send('/fee-requests/query?patientId=1', m);
  assert.equal(current.funds.refundedCents, 20000); assert.equal(current.funds.refundHeldCents, 0); assert.equal(current.funds.availableCents, 0);
  assert.equal(info.items[0].remainingApprovedRefundCents, 0); assert.equal(info.items[0].refunds.length, 1); assert.equal(info.items[0].adjustment.items.length, 1);
  const receipt = await send('/submissions/' + initiate.requestKey, c); assert.equal(receipt.revision, 1); assert.equal(receipt.id, refundId);
  assert.equal(JSON.stringify(info).includes('procedure_note'), false); await send('/fee-requests/query?patientId=1', f, null, 403);
});
