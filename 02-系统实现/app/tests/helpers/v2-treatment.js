'use strict';
const { createApplication } = require('../../src/v2/server');
let sequence = 0;
const command = value => ({ ...value, commandVersion: 1, requestKey: 'treatment-' + (++sequence) });
function setup(t) {
  let clock = new Date('2026-10-19T01:00:00Z');
  const a = createApplication({ demo: true, clock: () => clock });
  t.after(() => a.db.close());
  const login = (name, role = name) => { const s = a.auth.login({ username: name, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role }; };
  a.f = login('frontdesk'); a.m = login('manager'); a.d = login('dentist'); a.c = login('cashier'); a.other = login('manager', 'dentist');
  const schedule = a.reception.schedule(a.m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '接诊安排' }));
  const appointment = a.reception.appointment(a.f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1,
    startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '诊疗预约' }));
  clock = new Date('2026-10-19T01:35:00Z');
  a.v = a.reception.arrive(a.f, command({ patientId: 1, dentistId: 4, appointmentId: appointment.id, expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() }));
  a.clinical.record(a.d, command({ action: 'start', visitId: a.v.id, expectedVisitRevision: 1, startedAt: a.auth.now() }));
  a.setClock = at => { clock = new Date(at); };
  a.context = { visitId: a.v.id, patientId: 1 };
  a.plan = (fields = {}, credentials = a.d) => a.treatment.plan(credentials, command({ ...a.context, ...fields }));
  a.draft = (items = [{ description: '46牙按实际诊断说明的项目', toothCode: '46', surfaceCode: 'O', quantity: 3, estimatedCents: 80000 }]) => a.plan({ action: 'draft', goal: '按患者确认范围分次治疗', diagnosticBasis: '当前就诊的实际检查记录', reason: '首次提出方案', plannedSchedule: '分次执行，每次核对实际情况', items });
  a.publish = versionId => a.plan({ action: 'publish', versionId, expectedRevision: 1 });
  a.decide = (versionId, expectedRevision = 2, extra = {}) => a.plan({ action: 'decide', versionId, expectedRevision, decision: '同意', wholeScope: true,
    decidedAt: a.auth.now(), explanationBasis: '已当面说明项目、风险与费用估算，患者作出该决定', scopeNote: '本版所选具体项目', ...extra });
  a.service = () => a.billing.draft(a.c, command({ action: 'service', name: '按实际医嘱记录的诊疗项目（演示）', billingUnit: '次', reason: '诊所项目目录核对' }));
  a.price = (serviceId, extra = {}, approve = true) => {
    const draft = a.billing.draft(a.c, command({ action: 'draft', serviceId, unitPriceCents: 20000, validFrom: '2026-10-19T00:00:00+08:00', reason: '核定价目', ...extra }));
    a.billing.draft(a.c, command({ action: 'submit', priceId: draft.id, expectedRevision: draft.revision }));
    if (approve) return a.billing.approve(a.m, command({ action: 'approve', priceId: draft.id, expectedRevision: draft.revision + 1, reviewNote: '负责人核对后确认适用' }));
    return { ...draft, revision: draft.revision + 1 };
  };
  a.execute = (serviceId, extra = {}, credentials = a.d) => a.treatment.execute(credentials, command({ ...a.context, expectedVisitRevision: 2, serviceId,
    quantity: 1, completedAt: a.auth.now(), procedureNote: '由牙医如实登记的本次实际操作经过', ...extra }));
  a.info = () => a.treatment.detail(a.d, a.context);
  a.bills = (extra = {}) => a.billing.query(a.c, { patientId: 1, ...extra });
  return a;
}
module.exports = { command, setup };
