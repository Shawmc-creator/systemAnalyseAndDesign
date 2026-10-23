'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/v2/server');
test('real HTTP workflow links price review, scoped consent, racing execution, invoice and signed-record correction', async t => {
  let clock = new Date('2026-10-19T01:00:00Z'), sequence = 0;
  const a = createApplication({ demo: true, clock: () => clock });
  await new Promise(resolve => a.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => a.server.close(resolve)); a.db.close(); });
  const base = 'http://127.0.0.1:' + a.server.address().port + '/api/v2';
  const command = value => ({ ...value, commandVersion: 1, requestKey: 'treatment-http-' + (++sequence) });
  const send = async (p, headers, value, expected = 200) => {
    const r = await fetch(base + p, { method: value ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
    const result = await r.json(); assert.equal(r.status, expected, JSON.stringify(result)); return result;
  };
  const login = async username => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    const result = await r.json(); assert.equal(r.status, 200);
    return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': result.csrf, 'X-Clinic-Role': username };
  };
  const m = await login('manager'), f = await login('frontdesk'), d = await login('dentist'), c = await login('cashier');
  const s = await send('/service-prices/draft', c, command({ action: 'service', name: '实际诊疗目录（隔离演示）', billingUnit: '次', reason: '目录核对' }));
  const p = await send('/service-prices/draft', c, command({ action: 'draft', serviceId: s.id, unitPriceCents: 20000, validFrom: '2026-10-19T00:00:00+08:00', reason: '价目依据' }));
  await send('/service-prices/draft', c, command({ action: 'submit', priceId: p.id, expectedRevision: 1 }));
  await send('/service-prices/approve', c, command({ action: 'approve', priceId: p.id, expectedRevision: 2, reviewNote: '不能自行发布' }), 403);
  await send('/service-prices/approve', m, command({ action: 'approve', priceId: p.id, expectedRevision: 2, reviewNote: '负责人核实并确认' }));
  const schedule = await send('/schedules/schedule', m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '当日安排' }));
  const booking = await send('/appointments/maintain', f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1,
    startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '预约检查' }));
  clock = new Date('2026-10-19T01:35:00Z');
  const visit = await send('/visits/register', f, command({ patientId: 1, dentistId: 4, appointmentId: booking.id, expectedRevision: 1, scheduleRevision: 1, occupancyRevision: 1, arrivedAt: a.auth.now() }));
  const context = { visitId: visit.id, patientId: 1 }, path = '/treatment-plans/query?patientId=1&visitId=' + visit.id;
  await send('/clinical-records/record', d, command({ action: 'start', visitId: visit.id, expectedVisitRevision: 1, startedAt: a.auth.now() }));
  const v = await send('/treatment-plans/plan', d, command({ ...context, action: 'draft', goal: '实际确认范围', diagnosticBasis: '本次检查来源', plannedSchedule: '分次安排', reason: '首次提出',
    items: [{ description: '46牙明确项目', toothCode: '46', quantity: 3, estimatedCents: 90000 }] }));
  await send('/treatment-plans/plan', d, command({ ...context, action: 'publish', versionId: v.id, expectedRevision: 1 }));
  await send('/treatment-plans/plan', d, command({ ...context, action: 'decide', versionId: v.id, expectedRevision: 2, decision: '同意', wholeScope: true,
    decidedAt: a.auth.now(), explanationBasis: '当面说明并如实登记决定', scopeNote: '明确本版项目' }));
  const plan = await send(path, d), itemId = plan.plans[0].versions[0].items[0].id;
  const execution = command({ ...context, expectedVisitRevision: 2, serviceId: s.id, planItemId: itemId, toothCode: '46', quantity: 2, completedAt: a.auth.now(), procedureNote: '临床正文不返回收费岗位' });
  await send('/executions/execute', { ...d, 'X-CSRF-Token': 'invalid' }, execution, 403);
  const duplicate = await Promise.all([send('/executions/execute', d, execution), send('/executions/execute', d, execution)]);
  assert.equal(duplicate.filter(r => !r.replayed).length, 1);
  const competing = command({ ...execution, quantity: 2 });
  const rejected = await send('/executions/execute', d, competing, 409); assert.equal(rejected.code, 'PLAN_QUANTITY_EXCEEDED');
  const bills = await send('/patient-bills/query?patientId=1', c); assert.equal(bills.totals.receivableCents, 40000); assert.equal(bills.items[0].items.length, 1);
  assert.equal(JSON.stringify(bills).includes('临床正文'), false); await send(path, c, null, 403);
  const receipt = await send('/submissions/' + execution.requestKey, d); assert.equal(receipt.id, duplicate[0].id);
  const clinicalPath = '/patient-clinical-data/query?patientId=1&visitId=' + visit.id;
  const recordId = (await send(clinicalPath, d)).record.id;
  await send('/health-versions/health', d, command({ ...context, action: 'record', expectedHealthVersionId: null, conclusion: '本次已核对', reason: '首次明确记录',
    items: ['病史', '过敏', '用药'].map(category => ({ category, certainty: '未知', content: '如实保留尚未能确认的信息', source: '患者实际报告', reportedAt: a.auth.now() })) }));
  await send('/clinical-records/record', d, command({ ...context, action: 'save', recordId, expectedRevision: 1, chiefComplaint: '实际主诉', diagnosis: '实际牙医结论', treatmentAdvice: '实际处理意见', findings: [{ toothCode: '46', text: '实际检查所见' }] }));
  await send('/clinical-record-signatures/sign', d, command({ action: 'sign', recordId, expectedRevision: 2, confirmed: true }));
  const signed = await send(clinicalPath, d);
  assert.equal(signed.visit.status,'接诊中');
  await send('/resources/finish',d,command({visitId:visit.id,expectedVisitRevision:signed.visit.revision,expectedOccupancyRevision:signed.occupancy.revision,endedAt:a.auth.now(),confirmed:true,reason:'独立确认实际操作结束，交接清洁'}));
  const correction = await send('/executions/execute', d, command({ ...execution, expectedVisitRevision: 3, originalExecutionId: duplicate[0].id, quantity: 1, reason: '核实后独立更正数量' }));
  assert.equal(correction.code, 'EXECUTION_CORRECTED_FEE_REVIEW');
  const final = await send(clinicalPath, d); assert.equal(final.signedIntegrity, true); assert.equal(final.record.content_hash, signed.record.content_hash);
  assert.equal((await send('/patient-bills/query?patientId=1', c)).totals.receivableCents, 40000);
  const beforePay = await send('/patient-bills/query?patientId=1', c), bill = beforePay.items[0];
  const received = command({ action: 'receive', patientId: 1, expectedFundsRevision: beforePay.funds.revision, channel: '微信',
    receivedCents: 50000, changeCents: 0, verification: 'confirmed', receivedAt: a.auth.now(), externalReference: 'HTTP-WX-ORIGINAL-001',
    transactionEvidence: '收费人员核对真实线下到账依据', keepAsPrepayment: true,
    allocations: [{ billId: bill.id, expectedRevision: bill.revision, amountCents: 20000, reason: '本次实际付款用途' }] });
  const actualPayment = await Promise.all([send('/patient-payments/receive', c, received), send('/patient-payments/receive', c, received)]);
  assert.equal(actualPayment.filter(p => !p.replayed).length, 1);
  const beforeOffset = await send('/patient-bills/query?patientId=1', c), offset = command({ action: 'offset', patientId: 1,
    paymentId: actualPayment[0].id, expectedPaymentRevision: 1, expectedFundsRevision: beforeOffset.funds.revision,
    allocations: [{ billId: bill.id, expectedRevision: beforeOffset.items[0].revision, amountCents: 20000, reason: '从同一原款可用余额抵扣' }] });
  await send('/patient-payments/allocate', c, offset);
  const paid = await send('/patient-bills/query?patientId=1', c);
  assert.equal(paid.funds.confirmedReceivedCents, 50000); assert.equal(paid.funds.availableCents, 10000);
  assert.equal(paid.totals.unpaidCents, 0); assert.equal(paid.items[0].summary.settled, true);
  const duplicateReference = command({ ...received, expectedFundsRevision: paid.funds.revision, allocations: [] });
  assert.equal((await send('/patient-payments/receive', c, duplicateReference, 409)).code, 'PAYMENT_DUPLICATE');
  await send('/patient-payments/allocate', f, offset, 403);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(a.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});
