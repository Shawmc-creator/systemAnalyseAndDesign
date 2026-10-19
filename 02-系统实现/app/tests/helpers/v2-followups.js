'use strict';
const { setup, command } = require('./v2-treatment');
const { insert } = require('../../src/v2/common');
function setupFollowups(t) {
  const a = setup(t);
  const login = (username, role = username) => { const s = a.auth.login({ username, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role }; };
  a.advance = value => { a.setClock(value); a.f=login('frontdesk'); a.m=login('manager'); a.d=login('dentist'); a.c=login('cashier'); a.other=login('manager','dentist'); if (a.frontdesk2) a.frontdesk2=login('assistant','frontdesk'); };
  a.createFollowup = (extra = {}, credentials = a.d) => a.followups.propose(credentials, command({ action: 'create', patientId: 1,
    sourceVisitId: a.v.id, type: '复诊', purpose: '由实际接诊牙医说明的虚拟诊后目标', targetStart: '2026-10-20', targetEnd: '2026-10-22',
    requiresAssessment: true, responsibleFrontdeskId: 2, ...extra }));
  a.signSource = () => {
    const record = a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(a.v.id);
    a.clinical.health(a.d, command({ visitId: a.v.id, patientId: 1, action: 'record', expectedHealthVersionId: null,
      conclusion: '按当次报告如实核对', reason: '首次记录', items: ['病史','过敏','用药'].map(category => ({ category, certainty: '未知', content: '未能确认事项如实保留', source: '虚拟患者报告', reportedAt: a.auth.now() })) }));
    a.clinical.record(a.d, command({ action: 'save', visitId: a.v.id, recordId: record.id, expectedRevision: 1,
      chiefComplaint: '隔离演示主诉', diagnosis: '虚拟软件场景记录', treatmentAdvice: '按实际情况由牙医记录', findings: [{ text: '虚拟检查所见' }] }));
    const signed=a.clinical.sign(a.d, command({ action: 'sign', recordId: record.id, expectedRevision: 2, confirmed: true }));
    const visit=a.db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id);
    const block=a.resources.finish(a.d,command({visitId:visit.id,expectedVisitRevision:visit.revision,expectedOccupancyRevision:o.revision,endedAt:a.auth.now(),confirmed:true,reason:'隔离场景：牙医确认实际结束'}));
    const s=a.auth.login({username:'assistant',password:'Clinic123!'});
    a.resources.block({token:s.token,csrf:s.csrf,role:'assistant'},command({action:'restore',blockId:block.id,expectedRevision:1,confirmed:true,verificationNote:'隔离场景：助理实际完成清洁核验'}));
    return signed;
  };
  a.followup = followupId => a.db.prepare('SELECT * FROM followup_requirement WHERE id=?').get(followupId);
  a.contact = (followupId, extra = {}, credentials = a.f) => a.followups.contact(credentials, command({ action: 'record', patientId: 1, followupId,
    expectedRevision: a.followup(followupId).revision, contactedAt: a.auth.now(), method: '人工电话', result: '已联系', nextStep: 'assess',
    note: '真实联系原述由前台记录，临床结论交牙医', ...extra }));
  a.assess = (followupId, extra = {}, credentials = a.d) => a.followups.assess(credentials, command({ patientId: 1, followupId,
    expectedRevision: a.followup(followupId).revision, method: '远程沟通', assessedAt: a.auth.now(), result: '仅就本次实际取得的信息记录评估，不替代未做的检查',
    advice: '完成', assessmentCompleted: true, ...extra }));
  a.queue = (credentials = a.f, input = {}) => a.followups.query(credentials, input);
  a.book = (date = '2026-10-20', extra = {}) => {
    let schedule = a.db.prepare("SELECT * FROM dated_schedule WHERE business_date=? AND dentist_id=4 AND dental_chair_id=1 AND status='已确认'").get(date);
    if (!schedule) { const made = a.reception.schedule(a.m, command({ action: 'publish', dentistId: 4, chairId: 1, businessDate: date,
      startsAt: date + 'T09:00:00+08:00', endsAt: date + 'T18:00:00+08:00', reason: '明确复诊接诊安排' })); schedule = a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(made.id); }
    return a.reception.appointment(a.f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: schedule.revision,
      startsAt: date + 'T11:00:00+08:00', endsAt: date + 'T11:30:00+08:00', reason: '由前台实际建立的复诊预约', ...extra }));
  };
  a.startFollowupVisit = appointmentId => {
    const occupancy = a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(appointmentId);
    const schedule = a.db.prepare('SELECT * FROM dated_schedule WHERE id=?').get(occupancy.dated_schedule_id), appt = a.db.prepare('SELECT * FROM appointment WHERE id=?').get(appointmentId);
    const v = a.reception.arrive(a.f, command({ patientId: appt.patient_id, dentistId: schedule.dentist_id, appointmentId, expectedRevision: appt.revision,
      occupancyRevision: occupancy.revision, scheduleRevision: schedule.revision, arrivedAt: a.auth.now() }));
    a.clinical.record(a.d, command({ action: 'start', visitId: v.id, expectedVisitRevision: 1, startedAt: a.auth.now() })); return v;
  };
  a.enableSecondFrontdesk = () => {
    const role = a.db.prepare("SELECT id FROM access_role WHERE code='frontdesk'").get(), now = a.auth.now();
    const q = insert(a.db, 'staff_role_qualification', { staff_id: 5, role_id: role.id, valid_from: now, valid_until: null, verified_by: 1,
      verification_basis: '隔离测试：助理兼任前台的真实资格夹具', revoked_at: null, revoked_by: null, revocation_reason: null, created_at: now });
    insert(a.db, 'account_role', { account_id: 5, role_id: role.id, qualification_id: q, granted_by: 1, granted_at: now, valid_until: null,
      grant_reason: '隔离测试资格对应授权', revoked_by: null, revoked_at: null, revocation_reason: null });
    a.frontdesk2 = login('assistant', 'frontdesk'); return q;
  };
  return a;
}
module.exports = { setupFollowups, command };
