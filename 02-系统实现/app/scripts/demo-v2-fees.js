'use strict';
const { createApplication } = require('../src/v2/server');
let clock = new Date('2026-10-19T01:00:00Z'), serial = 0;
const a = createApplication({ demo: true, clock: () => clock });
const command = fields => ({ ...fields, commandVersion: 1, requestKey: 'fee-demo-' + (++serial) });
const steps = [], keep = (name, value) => { steps.push({ name, result: value }); return value; };
try {
  const login = username => { const s = a.auth.login({ username, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role: username }; };
  const m = login('manager'), f = login('frontdesk'), d = login('dentist'), c = login('cashier');
  const schedule = a.reception.schedule(m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '隔离演示日期安排' }));
  const appointment = a.reception.appointment(f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1,
    startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '虚拟患者预约' }));
  clock = new Date('2026-10-19T01:35:00Z');
  const visit = a.reception.arrive(f, command({ patientId: 1, dentistId: 4, appointmentId: appointment.id,
    expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() }));
  a.clinical.record(d, command({ action: 'start', visitId: visit.id, expectedVisitRevision: 1, startedAt: a.auth.now() }));
  const service = a.billing.draft(c, command({ action: 'service', name: '财务流程虚拟项目（演示）', billingUnit: '次', reason: '仅用于软件流程演示' }));
  const price = a.billing.draft(c, command({ action: 'draft', serviceId: service.id, unitPriceCents: 100000,
    validFrom: '2026-10-19T00:00:00+08:00', reason: '隔离演示金额，不代表真实收费建议' }));
  a.billing.draft(c, command({ action: 'submit', priceId: price.id, expectedRevision: 1 }));
  a.billing.approve(m, command({ action: 'approve', priceId: price.id, expectedRevision: 2, reviewNote: '演示确认' }));
  a.treatment.execute(d, command({ visitId: visit.id, patientId: 1, expectedVisitRevision: 2, serviceId: service.id, quantity: 1,
    completedAt: a.auth.now(), procedureNote: '隔离软件测试的虚拟记录', independentCheck: true, independentBasis: '虚拟独立检查事实，不构成诊疗指导' }));
  const bills = () => a.billing.query(c, { patientId: 1 });
  let q = bills(); const billId = q.items[0].id, lineId = q.items[0].items[0].id;
  const payment = a.payments.receive(c, command({ action: 'receive', patientId: 1, expectedFundsRevision: q.funds.revision,
    channel: '现金', receivedCents: 100000, changeCents: 0, verification: 'confirmed', receivedAt: a.auth.now(), transactionEvidence: '演示核实原实收1000元',
    allocations: [{ billId, expectedRevision: q.items[0].revision, amountCents: 100000, reason: '原款分配' }] }));
  q = bills(); keep('原实收1000元、原应收1000元、原用途1000元', { bill: q.totals, funds: q.funds });
  const request = keep('收费人员申请应收减少200元及退回200元；尚未改款', a.fees.apply(c, command({ action: 'submit', patientId: 1, billId, paymentId: payment.id,
    expectedFundsRevision: q.funds.revision, expectedBillRevision: q.items[0].revision, expectedPaymentRevision: 1,
    adjustmentCents: -20000, refundCents: 20000, reason: '核对正确应收800元', evidence: '隔离演示：核对原单及实际费用依据' })));
  keep('申请后应收仍为1000元', bills().totals);
  const approval = command({ action: 'approve', patientId: 1, requestId: request.id, expectedRevision: 1, expectedFundsRevision: q.funds.revision,
    expectedBillRevision: q.items[0].revision, expectedPaymentRevision: 1, adjustmentCents: -20000, refundCents: 20000, reviewNote: '负责人核实并批准明确范围',
    items: [{ billItemId: lineId, expectedRevision: 1, amountCents: -20000, note: '保留原项目，另记减少200元' }],
    releases: [{ kind: 'allocation', id: q.funds.payments[0].allocations[0].id, expectedRevision: 1, amountCents: 20000, reason: '同步释放原款用途200元' }] });
  keep('负责人批准，调整与原用途释放共同生效', a.fees.approve(m, approval));
  keep('同一审批请求重试不重复减少应收', a.fees.approve(m, approval));
  q = bills(); keep('应收800元、用途800元、可退原款200元，尚未退款', { bill: q.totals, availableCents: q.funds.availableCents, refundedCents: q.funds.refundedCents });
  const begin = command({ action: 'initiate', patientId: 1, requestId: request.id, expectedApprovalRevision: 2,
    paymentId: payment.id, expectedPaymentRevision: 1, expectedFundsRevision: q.funds.revision, expectedBillRevision: q.items[0].revision,
    amountCents: 20000, channel: '现金', recipientVerification: '已核实原付款人及实际接收信息' });
  const refund = keep('建立唯一退款办理号并占用200元', a.fees.refund(c, begin));
  q = bills();
  keep('结果不明，继续保留原占用', a.fees.refund(c, command({ action: 'markUnknown', patientId: 1, refundId: refund.id,
    expectedRevision: 1, expectedFundsRevision: q.funds.revision, transactionEvidence: '尚未取得明确渠道结论', verificationNote: '按原办理号核查，不能再次线下退款' })));
  q = bills(); keep('待核实期间实退为0、占用200元', { refundedCents: q.funds.refundedCents, heldCents: q.funds.refundHeldCents, availableCents: q.funds.availableCents });
  const confirm = command({ action: 'verify', patientId: 1, refundId: refund.id, expectedRevision: 2, expectedFundsRevision: q.funds.revision,
    outcome: 'success', actualCents: 20000, recipientMatches: true, transactionEvidence: '已核实原办理的真实退款结果', verificationNote: '金额、接收方与办理号一致' });
  keep('确认原办理实际退款200元', a.fees.refund(c, confirm));
  keep('确认请求重试仍只退款一次', a.fees.refund(c, confirm));
  q = bills(); keep('最终：原收1000元、实退200元、应收及原款有效用途800元', { bill: q.totals, funds: q.funds });
  keep('外键与完整性检查', { foreignKeyErrors: a.db.prepare('PRAGMA foreign_key_check').all(), integrity: a.db.prepare('PRAGMA integrity_check').get().integrity_check });
  process.stdout.write(JSON.stringify({ scenario: '费用申请—审批—用途释放—未知退款—确认原办理', isolatedInMemory: true,
    touchesLiveData: false, simulatedBusinessDate: '2026-10-19', moneyUnit: '整数分', steps }, null, 2) + '\n');
} finally { a.db.close(); }
