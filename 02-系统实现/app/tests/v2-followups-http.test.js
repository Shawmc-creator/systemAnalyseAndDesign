'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFollowups, command } = require('./helpers/v2-followups');
test('followup HTTP routes preserve scoped queues, contact retries, cancellation recovery and clinical privacy', async t => {
  const a = setupFollowups(t);
  await new Promise(resolve => a.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => a.server.close(resolve)); });
  const base = 'http://127.0.0.1:' + a.server.address().port + '/api/v2';
  const send = async (path, headers, value, expected = 200) => {
    const r = await fetch(base + path, { method: value ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
    const result = await r.json(); assert.equal(r.status, expected, JSON.stringify(result)); return result;
  };
  const login = async username => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    const s = await r.json(); assert.equal(r.status, 200);
    return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': s.csrf, 'X-Clinic-Role': username };
  };
  const d = await login('dentist'), f = await login('frontdesk'), c = await login('cashier');
  const propose = command({ action: 'create', patientId: 1, sourceVisitId: a.v.id, type: '复诊', purpose: '接口验收的诊后目标',
    targetStart: '2026-10-20', targetEnd: '2026-10-22', requiresAssessment: true, responsibleFrontdeskId: 2 });
  const p = '/followup-requirements/propose', q = '/followup-requirements/query?patientId=1';
  await send(p, f, propose, 403); const created = await send(p, d, propose);
  assert.equal((await send(q, f)).total, 0); assert.equal((await send(q, d)).items[0].status, '待发布');
  a.signSource(); assert.equal((await send(q, f)).items[0].status, '待联系');
  const contact = command({ action: 'record', patientId: 1, followupId: created.id, expectedRevision: 2, contactedAt: a.auth.now(),
    method: '人工电话', result: '未联系上', nextStep: 'continue', nextContactDate: '2026-10-20', note: '实际未接通' });
  await send('/followup-contacts/contact', { ...f, 'X-CSRF-Token': 'wrong' }, contact, 403);
  const attempts = await Promise.all([send('/followup-contacts/contact', f, contact), send('/followup-contacts/contact', f, contact)]);
  assert.equal(attempts.filter(x => !x.replayed).length, 1);
  const schedule = a.db.prepare("SELECT * FROM dated_schedule WHERE business_date='2026-10-20' AND dentist_id=4 AND dental_chair_id=1 AND status='已确认'").get();
  const booking = await send('/appointments/maintain', f, command({ action: 'create', patientId: 1, scheduleId: schedule.id, scheduleRevision: schedule.revision,
    startsAt: '2026-10-20T11:00:00+08:00', endsAt: '2026-10-20T11:30:00+08:00', reason: '通过预约接口建立复诊' }));
  await send('/followup-contacts/contact', f, command({ ...contact, expectedRevision: 3, result: '已联系', nextStep: 'arrange',
    appointmentId: booking.id, expectedAppointmentRevision: 1, note: '确认预约时间' }));
  assert.equal((await send(q, f)).items[0].status, '待到诊或评估');
  await send('/appointments/maintain', f, command({ action: 'cancel', appointmentId: booking.id, expectedRevision: 1, reason: '患者取消，由前台重新联系' }));
  const restored = (await send(q, f)).items[0]; assert.equal(restored.status, '待联系'); assert.equal(restored.contacts.length, 2);
  const assess = command({ patientId: 1, followupId: created.id, expectedRevision: restored.revision, method: '远程沟通', assessedAt: a.auth.now(),
    result: 'HTTP验收专用临床结论正文', advice: '完成', assessmentCompleted: true });
  await send('/followup-assessments/assess', f, assess, 403); await send('/followup-assessments/assess', d, assess);
  assert.equal((await send(q, d)).items[0].status, '已完成');
  assert.equal(JSON.stringify(await send(q, f)).includes('HTTP验收专用临床结论正文'), false);
  assert.equal(JSON.stringify(await send(q, d)).includes('HTTP验收专用临床结论正文'), true);
  await send(q, c, null, 403); await send('/followups/options', f);
  const receipt = await send('/submissions/' + contact.requestKey, f); assert.equal(receipt.id, attempts[0].id);
  assert.equal((await send('/status', f)).followupApi.length, 3);
});
