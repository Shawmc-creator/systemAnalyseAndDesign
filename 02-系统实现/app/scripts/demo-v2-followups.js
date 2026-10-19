'use strict';
const { createApplication } = require('../src/v2/server');
let clock = new Date('2026-10-19T01:00:00Z'), serial = 0;
const a = createApplication({ demo: true, clock: () => clock });
const command = fields => ({ ...fields, commandVersion: 1, requestKey: 'followup-demo-' + (++serial) });
const steps = [], keep = (name, result) => { steps.push({ name, result }); return result; };
try {
  const login = username => { const s = a.auth.login({ username, password: 'Clinic123!' }); return { token: s.token, csrf: s.csrf, role: username }; };
  const m = login('manager'), f = login('frontdesk'), d = login('dentist');
  const schedule = a.reception.schedule(m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '隔离演示日期安排' }));
  const appointment = a.reception.appointment(f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: 1,
    startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '虚拟患者预约' }));
  clock = new Date('2026-10-19T01:35:00Z');
  const visit = a.reception.arrive(f, command({ patientId: 1, dentistId: 4, appointmentId: appointment.id,
    expectedRevision: 1, occupancyRevision: 1, scheduleRevision: 1, arrivedAt: a.auth.now() }));
  a.clinical.record(d, command({ action: 'start', visitId: visit.id, expectedVisitRevision: 1, startedAt: a.auth.now() }));
  const requirement = keep('牙医提出有来源、目标日期和前台责任人的待发布要求', a.followups.propose(d, command({ action: 'create', patientId: 1,
    sourceVisitId: visit.id, type: '复诊', purpose: '隔离演示：诊后复诊评估', targetStart: '2026-10-20', targetEnd: '2026-10-22',
    requiresAssessment: true, responsibleFrontdeskId: 2 })));
  const queue = credentials => a.followups.query(credentials, { patientId: 1 });
  const current = () => a.db.prepare('SELECT * FROM followup_requirement WHERE id=?').get(requirement.id);
  keep('来源未签署，前台没有待办', queue(f));
  a.clinical.health(d, command({ visitId: visit.id, patientId: 1, action: 'record', expectedHealthVersionId: null,
    conclusion: '虚拟患者的信息边界', reason: '隔离软件演示', items: ['病史','过敏','用药'].map(category => ({ category, certainty: '未知',
      content: '实际未能确认的信息保留未知', source: '虚拟患者报告', reportedAt: a.auth.now() })) }));
  const record = a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(visit.id);
  a.clinical.record(d, command({ action: 'save', visitId: visit.id, recordId: record.id, expectedRevision: 1,
    chiefComplaint: '虚拟软件场景主诉', diagnosis: '隔离软件场景诊疗记录', treatmentAdvice: '具体诊疗内容须由实际牙医确定', findings: [{ text: '虚拟检查所见' }] }));
  keep('签署来源病历，同一事务发布要求', a.clinical.sign(d, command({ action: 'sign', recordId: record.id, expectedRevision: 2, confirmed: true })));
  keep('前台收到有责任人和下次日期的待联系事项', queue(f));
  const missed = command({ action: 'record', patientId: 1, followupId: requirement.id, expectedRevision: current().revision,
    contactedAt: a.auth.now(), method: '人工电话', result: '未联系上', nextStep: 'continue', nextContactDate: '2026-10-20', note: '虚拟演示：电话未接通' });
  keep('未联系上，保留下一次联系日期', a.followups.contact(f, missed));
  keep('同号重试不追加第二条联系记录', a.followups.contact(f, missed));
  const nextSchedule = a.db.prepare("SELECT * FROM dated_schedule WHERE business_date='2026-10-20' AND dentist_id=4 AND dental_chair_id=1 AND status='已确认'").get();
  const booked = keep('通过预约业务建立真实关联，不由随访接口重复占用资源', a.reception.appointment(f, command({ action: 'create', patientId: 1,
    scheduleId: nextSchedule.id, scheduleRevision: nextSchedule.revision, startsAt: '2026-10-20T11:00:00+08:00',
    endsAt: '2026-10-20T11:30:00+08:00', reason: '隔离演示复诊预约' })));
  keep('已联系并关联复诊预约，转为待到诊或评估', a.followups.contact(f, command({ action: 'record', patientId: 1, followupId: requirement.id,
    expectedRevision: current().revision, contactedAt: a.auth.now(), method: '人工电话', result: '已联系', nextStep: 'arrange',
    appointmentId: booked.id, expectedAppointmentRevision: 1, note: '虚拟患者确认预约时间' })));
  keep('患者取消预约，自动恢复待联系并保留取消审计', a.reception.appointment(f, command({ action: 'cancel', appointmentId: booked.id,
    expectedRevision: 1, reason: '虚拟患者取消预约，需要重新联系' })));
  keep('取消后的待办与历史联系', queue(f));
  keep('牙医记录真实远程评估；不伪造到诊', a.followups.assess(d, command({ patientId: 1, followupId: requirement.id,
    expectedRevision: current().revision, method: '远程沟通', assessedAt: a.auth.now(), result: '隔离演示：按本次实际远程信息记录结论及信息边界',
    advice: '完成', assessmentCompleted: true })));
  keep('前台完成态视图：保留办理记录，不返回临床评估正文', queue(f));
  keep('牙医视图：可查实际临床评估', queue(d));
  keep('未生成虚构复诊到诊或收付款', { patientVisitCount: a.db.prepare('SELECT count(*) n FROM visit WHERE patient_id=1').get().n,
    paymentCount: a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, assessmentVisitId: a.db.prepare('SELECT visit_id FROM clinical_assessment').get().visit_id });
  keep('外键与完整性检查', { foreignKeyErrors: a.db.prepare('PRAGMA foreign_key_check').all(), integrity: a.db.prepare('PRAGMA integrity_check').get().integrity_check });
  process.stdout.write(JSON.stringify({ scenario: '提出要求—来源签署发布—联系—预约—取消恢复—牙医远程评估',
    isolatedInMemory: true, touchesLiveData: false, automaticMessaging: false, simulatedBusinessDate: '2026-10-19', steps }, null, 2) + '\n');
} finally { a.db.close(); }
