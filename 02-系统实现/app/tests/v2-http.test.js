'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src/v2/server');
async function start(t) {
  const a = createApplication({ demo: true, clock: () => new Date('2026-10-19T02:00:00Z') });
  await new Promise(resolve => a.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + a.server.address().port;
  t.after(async () => { await new Promise(resolve => a.server.close(resolve)); a.db.close(); });
  async function login(username) {
    const res = await fetch(base + '/api/v2/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Clinic123!' }) });
    assert.equal(res.status, 200); const data = await res.json();
    return { 'Cookie': res.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': data.csrf, 'X-Clinic-Role': username };
  }
  return { ...a, base, login };
}
test('HTTP login, candidate escaping, CSRF, role guard and own submission scope', async t => {
  const a = await start(t), f = await a.login('frontdesk'), m = await a.login('manager');
  const request = (route, headers, body) => fetch(a.base + '/api/v2' + route, { headers: { ...headers, 'Content-Type': 'application/json' }, method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/patients/candidates?q=陈晨', f)).status, 200);
  const wild = await (await request('/patients/candidates?q=%25', f)).json(); assert.equal(wild.items.length, 0);
  assert.equal((await request('/patients/candidates', m)).status, 403);
  const values = { requestKey: 'http-patient', commandVersion: 1, fields: { name: 'HTTP患者', contact_unavailable_reason: '暂无法提供电话' }, reason: '本人提供资料' };
  assert.equal((await request('/patients/maintain', { ...f, 'X-CSRF-Token': '' }, values)).status, 403);
  const noCsrf = { ...f }; delete noCsrf['X-CSRF-Token']; assert.equal((await request('/patients/maintain', noCsrf, values)).status, 403);
  assert.equal((await request('/patients/maintain', f, values)).status, 200);
  assert.equal((await request('/submissions/http-patient', f)).status, 200);
  assert.equal((await request('/submissions/http-patient', m)).status, 404);
  assert.equal((await request('/patients/maintain', {}, values)).status, 401);
  assert.equal((await request('/auth/logout', f, {})).status, 200);
  assert.equal((await request('/auth/me', f)).status, 401);
});
test('front desk can distinguish same-name candidates by a known birth date without inventing unknown dates', async t => {
  const a=await start(t),f=await a.login('frontdesk');
  const c={token:f.Cookie.split('=')[1],csrf:f['X-CSRF-Token'],role:'frontdesk'};
  a.reception.patient(c,{requestKey:'candidate-known-birthday',commandVersion:1,fields:{name:'陈晨（演示）',birth_date:'2000-01-02',contact_unavailable_reason:'暂未提供'},reason:'隔离验证患者身份'});
  const get=async q=>{const r=await fetch(a.base+'/api/v2/patients/candidates?'+q,{headers:f});return {status:r.status,body:await r.json()};};
  const all=await get('q='+encodeURIComponent('陈晨（演示）'));assert.equal(all.body.items.length,3);assert.equal(all.body.items.filter(p=>p.birth_date===null).length,2);
  const exact=await get('q='+encodeURIComponent('陈晨（演示）')+'&birthDate=2000-01-02');assert.equal(exact.body.items.length,1);assert.equal(exact.body.items[0].birth_date,'2000-01-02');
  assert.equal((await get('birthDate=2000-02-30')).status,422);
});
test('concurrent HTTP retries commit exactly one appointment and enforce slot conflict', async t => {
  const a = await start(t), f = await a.login('frontdesk'), m = await a.login('manager');
  const post = (route, who, body) => fetch(a.base + '/api/v2' + route, { method: 'POST', headers: { ...who, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const s = await (await post('/schedules/schedule', m, { requestKey: 'http-schedule', commandVersion: 1, action: 'publish', businessDate: '2026-10-19', dentistId: 4, chairId: 1,
    startsAt: '2026-10-19T10:00:00+08:00', endsAt: '2026-10-19T18:00:00+08:00', reason: '负责人确认' })).json();
  const input = { requestKey: 'http-booking', commandVersion: 1, action: 'create', patientId: 1, scheduleId: s.id, scheduleRevision: 1,
    startsAt: '2026-10-19T10:30:00+08:00', endsAt: '2026-10-19T11:00:00+08:00', reason: '检查' };
  const results = await Promise.all(Array.from({ length: 5 }, () => post('/appointments/maintain', f, input).then(r => r.json())));
  assert.equal(new Set(results.map(r => r.id)).size, 1); assert.equal(results.filter(r => !r.replayed).length, 1);
  const conflicting = await post('/appointments/maintain', f, { ...input, requestKey: 'another-booking', patientId: 2 });
  assert.equal(conflicting.status, 409); assert.equal((await conflicting.json()).code, 'RESOURCE_CONFLICT');
  const receipt = await (await fetch(a.base + '/api/v2/submissions/http-booking', { headers: f })).json(); assert.equal(receipt.id, results[0].id);
  const index = await fetch(a.base + '/'); assert.equal(index.status, 200); assert.match(await index.text(), /工作人员登录/);
});
