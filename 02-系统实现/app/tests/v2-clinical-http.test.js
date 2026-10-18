'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/v2/server');
test('clinical HTTP workflow preserves scope, exact signing result and independent addendum', async t => {
  let clock = new Date('2026-10-19T01:00:00Z');
  const a = createApplication({ demo: true, clock: () => clock });
  await new Promise(resolve => a.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => a.server.close(resolve)); a.db.close(); });
  const base = 'http://127.0.0.1:' + a.server.address().port + '/api/v2';
  let sequence = 0;
  const send = async (p, headers, value) => {
    const r = await fetch(base + p, { method: value ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  const command = value => ({ ...value, commandVersion: 1, requestKey: 'clinical-http-' + (++sequence) });
  const login = async username => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    const s = await r.json(); assert.equal(r.status, 200); return { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': s.csrf, 'X-Clinic-Role': username };
  };
  const m = await login('manager'), f = await login('frontdesk'), d = await login('dentist');
  const schedule = await send('/schedules/schedule', m, command({ action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1, startsAt: '2026-10-19T09:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '负责人核对' })); assert.equal(schedule.status, 200);
  const booking = await send('/appointments/maintain', f, command({ action: 'create', patientId: 1, scheduleId: schedule.body.id, scheduleRevision: 1, startsAt: '2026-10-19T09:30:00+08:00', endsAt: '2026-10-19T10:00:00+08:00', reason: '检查' })); assert.equal(booking.status, 200);
  clock = new Date('2026-10-19T01:35:00Z');
  const arrived = await send('/visits/register', f, command({ patientId: 1, appointmentId: booking.body.id, dentistId: 4, expectedRevision: 1, scheduleRevision: 1, occupancyRevision: 1, arrivedAt: a.auth.now() })); assert.equal(arrived.status, 200);
  const visitId = arrived.body.id, readPath = '/patient-clinical-data/query?patientId=1&visitId=' + visitId;
  assert.equal((await send(readPath, f)).status, 403);
  assert.equal((await send('/clinical-records/record', d, command({ action: 'start', visitId, expectedVisitRevision: 1, startedAt: a.auth.now() }))).status, 200);
  const info = await send(readPath, d); assert.equal(info.status, 200); const recordId = info.body.record.id;
  assert.equal((await send('/health-versions/health', d, command({ action: 'record', visitId, patientId: 1, expectedHealthVersionId: null, conclusion: '当次健康复核', reason: '首次记录', items: ['病史', '过敏', '用药'].map(category => ({ category, certainty: '未知', content: '本次未能确认', source: '患者报告', reportedAt: a.auth.now() })) }))).status, 200);
  assert.equal((await send('/clinical-records/record', d, command({ action: 'save', visitId, recordId, expectedRevision: 1, chiefComplaint: '演示主诉', diagnosis: '实际牙医结论由牙医填写', treatmentAdvice: '已向患者说明检查意见', findings: [{ toothCode: '46', text: '隔离检查所见' }] }))).status, 200);
  const sign = command({ action: 'sign', recordId, expectedRevision: 2, confirmed: true });
  const results = await Promise.all([send('/clinical-record-signatures/sign', d, sign), send('/clinical-record-signatures/sign', d, sign)]);
  assert.ok(results.every(r => r.status === 200)); assert.equal(results.filter(r => !r.body.replayed).length, 1);
  const signed = await send(readPath, d); assert.equal(signed.body.signedIntegrity, true); assert.equal(signed.body.visit.status, '诊疗结束');
  const addendum = await send('/clinical-record-signatures/sign', d, command({ action: 'addendum', recordId, expectedRevision: 3, confirmed: true, content: '追加患者沟通说明', reason: '补充记录' })); assert.equal(addendum.status, 200);
  const last = await send(readPath, d); assert.equal(last.body.addenda.length, 1); assert.equal(last.body.record.content_hash, signed.body.record.content_hash);
});
