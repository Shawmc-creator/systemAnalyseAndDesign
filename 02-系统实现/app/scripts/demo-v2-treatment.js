'use strict';
// Deterministic, isolated example: never opens the live clinic database or changes its clock.
const { createApplication } = require('../src/v2/server');
let time = new Date('2026-10-19T01:00:00Z'), serial = 0;
const app = createApplication({ demo: true, clock: () => time });
const command = fields => ({ ...fields, commandVersion: 1, requestKey: 'example-' + (++serial) });
const steps = [];
const keep = (name, result) => { steps.push({ name, result }); return result; };
try {
  const login = name => { const s = app.auth.login({ username: name, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role: name }; };
  const manager = login('manager'), frontdesk = login('frontdesk'), dentist = login('dentist'), cashier = login('cashier');
  const schedule = app.reception.schedule(manager, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '隔离演示日期安排' }));
  const booking = app.reception.appointment(frontdesk, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1,
    startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '演示预约' }));
  time = new Date('2026-10-19T01:35:00Z');
  const visit = keep('前台登记到诊并建立病历草稿', app.reception.arrive(frontdesk, command({ patientId: 1, dentistId: 4, appointmentId: booking.id,
    expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: app.auth.now() })));
  const context = { visitId: visit.id, patientId: 1 };
  keep('牙医确认实际开始接诊', app.clinical.record(dentist, command({ action: 'start', visitId: visit.id, expectedVisitRevision: 1, startedAt: app.auth.now() })));
  const service = app.billing.draft(cashier, command({ action: 'service', name: '诊疗目录项目（隔离演示）', billingUnit: '次', reason: '演示目录' }));
  const price = app.billing.draft(cashier, command({ action: 'draft', serviceId: service.id, unitPriceCents: 20000,
    validFrom: '2026-10-19T00:00:00+08:00', reason: '隔离演示价目，非医疗收费建议' }));
  app.billing.draft(cashier, command({ action: 'submit', priceId: price.id, expectedRevision: 1 }));
  keep('负责人确认200元整数分价目', app.billing.approve(manager, command({ action: 'approve', priceId: price.id, expectedRevision: 2, reviewNote: '演示确认' })));
  const version = keep('提出含估算的三次方案；尚不形成收费', app.treatment.plan(dentist, command({ ...context, action: 'draft', goal: '演示跨次范围',
    diagnosticBasis: '仅为虚拟流程数据，不作临床诊断', plannedSchedule: '分次安排，每次另记真实执行', reason: '首次方案说明',
    items: [{ description: '由牙医说明的虚拟项目', toothCode: '46', quantity: 3, estimatedCents: 90000 }] })));
  keep('方案未执行时应收为0', app.billing.query(cashier, { patientId: 1 }).totals);
  app.treatment.plan(dentist, command({ ...context, action: 'publish', versionId: version.id, expectedRevision: 1 }));
  keep('登记患者对明确范围的同意', app.treatment.plan(dentist, command({ ...context, action: 'decide', versionId: version.id, expectedRevision: 2,
    decision: '同意', wholeScope: true, decidedAt: app.auth.now(), explanationBasis: '隔离演示：当面说明并如实登记决定', scopeNote: '本版具体项目' })));
  const item = app.treatment.detail(dentist, context).plans[0].versions[0].items[0];
  const actual = command({ ...context, expectedVisitRevision: 2, serviceId: service.id, planItemId: item.id, toothCode: '46', quantity: 2,
    completedAt: app.auth.now(), procedureNote: '隔离演示操作记录，不构成治疗指导' });
  const execution = keep('实际执行2次，形成400元应收', app.treatment.execute(dentist, actual));
  keep('同一提交重试不增加执行或收费', app.treatment.execute(dentist, actual));
  keep('原收费快照', app.billing.query(cashier, { patientId: 1 }).totals);
  keep('追加更正：有效数量改为1，原收费等待独立费用申请', app.treatment.execute(dentist, command({ ...actual,
    originalExecutionId: execution.id, quantity: 1, reason: '演示核对后更正，不能直接改写费用' })));
  const corrected = app.treatment.detail(dentist, context);
  keep('更正后有效完成量', { quantity: corrected.plans[0].versions[0].items[0].effectiveQuantity });
  keep('更正后原应收仍为400元', app.billing.query(cashier, { patientId: 1 }).totals);
  const beforePay = app.billing.query(cashier, { patientId: 1 }), bill = beforePay.items[0];
  const payment = keep('核实收到500元，200元分配到原账目，余款明确为预付', app.payments.receive(cashier, command({ action: 'receive', patientId: 1,
    expectedFundsRevision: beforePay.funds.revision, receivedCents: 50000, changeCents: 0, channel: '现金', verification: 'confirmed', receivedAt: app.auth.now(),
    transactionEvidence: '隔离演示：当面核对实收', keepAsPrepayment: true,
    allocations: [{ billId: bill.id, expectedRevision: bill.revision, amountCents: 20000, reason: '当次付款用途' }] })));
  const beforeOffset = app.billing.query(cashier, { patientId: 1 });
  keep('从同一原款再抵扣200元，不新增第二次收款', app.payments.allocate(cashier, command({ action: 'offset', patientId: 1,
    paymentId: payment.id, expectedPaymentRevision: payment.revision, expectedFundsRevision: beforeOffset.funds.revision,
    allocations: [{ billId: bill.id, expectedRevision: beforeOffset.items[0].revision, amountCents: 20000, reason: '明确使用预付余额' }] })));
  const paid = app.billing.query(cashier, { patientId: 1 });
  keep('核对已收500元、用途400元、可用预付100元', { ...paid.totals, confirmedReceivedCents: paid.funds.confirmedReceivedCents, availableCents: paid.funds.availableCents });
  const check = app.billing.draft(cashier, command({ action: 'service', name: '独立检查（隔离演示）', billingUnit: '次', reason: '演示缺价' }));
  app.treatment.execute(dentist, command({ ...context, expectedVisitRevision: 2, serviceId: check.id, quantity: 1, completedAt: app.auth.now(),
    procedureNote: '虚拟检查事实', independentCheck: true, independentBasis: '本次独立检查，不虚构持续治疗方案' }));
  const pending = app.billing.query(cashier, { patientId: 1 });
  keep('缺价仍保存执行，待核价不等于零元结清', { ...pending.totals, settled: pending.items[0].summary.settled });
  keep('外键及完整性核对', { foreignKeyErrors: app.db.prepare('PRAGMA foreign_key_check').all(), integrity: app.db.prepare('PRAGMA integrity_check').get().integrity_check });
  process.stdout.write(JSON.stringify({ scenario: '方案—同意—执行—核价—更正—收款—抵扣', isolatedInMemory: true, moneyUnit: '整数分',
    simulatedBusinessDate: '2026-10-19', touchesLiveData: false, steps }, null, 2) + '\n');
} finally { app.db.close(); }
