'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, VERSION } = require('./database');
const { Auth } = require('./auth');
const { UnitOfWork, mapError } = require('./unit-of-work');
const { Reception } = require('./reception');
const { Clinical } = require('./clinical');
const { Billing } = require('./billing');
const { Treatment } = require('./treatment');
const { Payments } = require('./payments');
const { seedDemo } = require('./demo');
const { fail, utc, day, dateOnly } = require('./common');
const PUBLIC = path.resolve(__dirname, '../../public/v2');
function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(value));
}
async function body(req) {
  let bytes = 0, chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 64 * 1024) fail(413, 'BODY_TOO_LARGE', '提交内容过大'); chunks.push(chunk); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'INVALID_JSON', '请求内容不是有效JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'INVALID_JSON', '请求内容应为对象');
  return result;
}
function createApplication({ filename = ':memory:', demo = false, clock } = {}) {
  const db = openDatabase(filename), auth = new Auth(db, clock), unit = new UnitOfWork(db, auth), reception = new Reception(db, unit), clinical = new Clinical(db, unit);
  const billing = new Billing(db, unit), treatment = new Treatment(db, unit, clinical, billing);
  const payments = new Payments(db, unit, billing);
  if (demo) seedDemo(db, auth, reception);
  const cookie = token => `clinic_v2_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}`;
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), p = url.pathname;
      if (!p.startsWith('/api/')) {
        const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
        if (!files[p] || req.method !== 'GET') return json(res, 404, { code: 'NOT_FOUND', message: '页面不存在' });
        res.writeHead(200, { 'Content-Type': files[p][1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
        return res.end(fs.readFileSync(path.join(PUBLIC, files[p][0])));
      }
      const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('clinic_v2_session='))?.slice('clinic_v2_session='.length);
      const credentials = { token, role: req.headers['x-clinic-role'], csrf: req.headers['x-csrf-token'] };
      if (p === '/api/v2/status' && req.method === 'GET') return json(res, 200, { application: 'qinghe-dental-v2', schemaVersion: VERSION, ready: true, demo, businessDate: day(auth.now()), now: auth.now(), implemented: ['UC-01', 'UC-02', 'UC-03', 'UC-08', 'UC-15'], clinicalApi: ['UC-09', 'UC-10', 'UC-11', 'UC-21'], treatmentBillingApi: ['UC-04', 'UC-05', 'UC-06', 'UC-07', 'UC-22'] });
      if (p === '/api/v2/auth/login' && req.method === 'POST') {
        // Reject cross-origin requests even before login; do not trust forwarded IP headers.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) fail(403, 'ORIGIN_FORBIDDEN', '请求来源无效');
        const input = await body(req), session = auth.login(input, req.socket.remoteAddress || 'local');
        if (token) { try { auth.logout(token); } catch {} }
        return json(res, 200, { user: session.user, csrf: session.csrf }, { 'Set-Cookie': cookie(session.token) });
      }
      if (p === '/api/v2/auth/me' && req.method === 'GET') return json(res, 200, { user: auth.profile(auth.session(token)), csrf: auth.csrf(token) });
      if (p === '/api/v2/auth/logout' && req.method === 'POST') {
        const session = auth.session(token);
        const { hash } = require('./common');
        if (hash(String(credentials.csrf)) !== session.csrf_hash) fail(403, 'CSRF_INVALID', '安全令牌无效');
        auth.logout(token); return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('') });
      }
      const commands = {
        '/api/v2/patients/maintain': 'patient', '/api/v2/schedules/schedule': 'schedule', '/api/v2/appointments/maintain': 'appointment', '/api/v2/visits/register': 'arrive'
      };
      if (commands[p] && req.method === 'POST') return json(res, 200, reception[commands[p]](credentials, await body(req)));
      const clinicalCommands = { '/api/v2/health-versions/health': 'health', '/api/v2/clinical-records/record': 'record', '/api/v2/clinical-record-signatures/sign': 'sign' };
      if (clinicalCommands[p] && req.method === 'POST') return json(res, 200, clinical[clinicalCommands[p]](credentials, await body(req)));
      const treatmentCommands = { '/api/v2/treatment-plans/plan': 'plan', '/api/v2/executions/execute': 'execute' };
      if (treatmentCommands[p] && req.method === 'POST') return json(res, 200, treatment[treatmentCommands[p]](credentials, await body(req)));
      const priceCommands = { '/api/v2/service-prices/draft': 'draft', '/api/v2/service-prices/approve': 'approve' };
      if (priceCommands[p] && req.method === 'POST') return json(res, 200, billing[priceCommands[p]](credentials, await body(req)));
      const paymentCommands = { '/api/v2/patient-payments/receive': 'receive', '/api/v2/patient-payments/allocate': 'allocate' };
      if (paymentCommands[p] && req.method === 'POST') return json(res, 200, payments[paymentCommands[p]](credentials, await body(req)));
      const filters = Object.fromEntries(url.searchParams);
      if (p === '/api/v2/treatment-plans/query' && req.method === 'GET') return json(res, 200, treatment.detail(credentials, filters));
      if (p === '/api/v2/services/options' && req.method === 'GET') return json(res, 200, billing.catalog(credentials));
      if (p === '/api/v2/patient-bills/query' && req.method === 'GET') return json(res, 200, billing.query(credentials, filters));
      if (p === '/api/v2/patient-clinical-data/query' && req.method === 'GET') return json(res, 200, clinical.detail(credentials, filters));
      if (p === '/api/v2/clinical-worklist/query' && req.method === 'GET') return json(res, 200, clinical.queue(credentials, filters));
      if (p === '/api/v2/appointments/query' && req.method === 'GET') return json(res, 200, reception.list(credentials, filters));
      if (p === '/api/v2/patients/candidates' && req.method === 'GET') return json(res, 200, unit.query(credentials, 'uc08.maintain', () => {
        const query = String(filters.q || '').trim();
        if (query.length > 80) fail(422, 'INVALID_INPUT', '查找条件过长');
        const pattern = '%' + query.replace(/[!%_]/g, '!$&') + '%';
        return { items: db.prepare("SELECT * FROM patient WHERE name LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR record_no=? ORDER BY id DESC LIMIT 100").all(pattern, pattern, query) };
      }));
      if (p === '/api/v2/reception/options' && req.method === 'GET') return json(res, 200, unit.query(credentials, credentials.role === 'manager' ? 'uc15.schedule' : 'uc02.query', () => {
        const selectedDay = dateOnly(filters.date || day(auth.now()));
        const schedules = db.prepare(`SELECT s.*,d.name dentist_name,c.name chair_name FROM dated_schedule s JOIN staff d ON d.id=s.dentist_id
          JOIN dental_chair c ON c.id=s.dental_chair_id WHERE s.business_date=? ORDER BY s.starts_at,s.id`).all(selectedDay);
        const dentists = db.prepare(`SELECT DISTINCT s.id,s.name FROM staff s JOIN staff_role_qualification q ON q.staff_id=s.id JOIN access_role r ON r.id=q.role_id
          WHERE r.code='dentist' AND s.employed_from<=? AND (s.employed_until IS NULL OR s.employed_until>=?)
          AND q.valid_from<=? AND (q.valid_until IS NULL OR q.valid_until>?) AND (q.revoked_at IS NULL OR q.revoked_at>?)`).all(selectedDay, selectedDay, auth.now(), auth.now(), auth.now());
        return { schedules, dentists, chairs: db.prepare('SELECT id,name FROM dental_chair ORDER BY id').all() };
      }));
      if (p === '/api/v2/visits/waiting' && req.method === 'GET') return json(res, 200, unit.query(credentials, 'uc03.register', () => ({ items: db.prepare(`SELECT v.id,v.record_no,v.status,v.arrived_at,p.name patient_name,d.name dentist_name
        FROM visit v JOIN patient p ON p.id=v.patient_id JOIN staff d ON d.id=v.dentist_id WHERE v.arrived_at>=? AND v.arrived_at<? ORDER BY v.arrived_at`).all(utc(day(auth.now()) + 'T00:00:00+08:00'), utc(Date.parse(day(auth.now()) + 'T00:00:00+08:00') + 86400_000)) })));
      const submission = p.match(/^\/api\/v2\/submissions\/([^/]+)$/);
      if (submission && req.method === 'GET') return json(res, 200, unit.query(credentials, 'ops.request.query', ctx => {
        const receipt = db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id, decodeURIComponent(submission[1]));
        if (!receipt) fail(404, 'RESULT_NOT_FOUND', '尚未查到已提交结果，请保持原提交号重试');
        return unit.result(receipt);
      }));
      auth.session(token);
      fail(404, 'NOT_IMPLEMENTED_ROUTE', '此功能尚未接入本批新版页面');
    } catch (error) {
      const mapped = mapError(error);
      if (!mapped.status) console.error('v2 request failure:', mapped.message);
      json(res, mapped.status || 500, { code: mapped.code || 'INTERNAL_ERROR', message: mapped.status ? mapped.message : '办理失败，请保留原提交号并核实结果', ...(mapped.details ? { details: mapped.details } : {}) });
    }
  };
  const server = http.createServer(handler);
  return { db, auth, unit, reception, clinical, billing, treatment, payments, server };
}
if (require.main === module) {
  const filename = process.env.CLINIC_V2_DB || path.resolve(__dirname, '../../data/clinic-v2.db');
  const app = createApplication({ filename, demo: process.argv.includes('--demo') });
  const port = Number(process.env.CLINIC_V2_PORT || 3001);
  app.server.listen(port, '127.0.0.1', () => console.log(`新版诊所系统 http://127.0.0.1:${port}/\n数据库：${filename}${process.argv.includes('--demo') ? '\n演示账号 frontdesk / manager，密码 Clinic123!' : ''}`));
  const stop = () => app.server.close(() => { app.db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { createApplication };
