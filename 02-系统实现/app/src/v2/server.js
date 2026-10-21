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
const { Fees } = require('./fees');
const { Followups } = require('./followups');
const { Inventory } = require('./inventory');
const { Purchases } = require('./purchases');
const { Resources }=require('./resources');
const { Documents }=require('./documents');
const { DocumentStore,MAX_FILE_BYTES }=require('./document-store');
const {Prescriptions}=require('./prescriptions');
const {Pharmacy}=require('./pharmacy');
const {normalizePolicy,loadPolicy}=require('./pharmacy-policy');
const {Insurance}=require('./insurance');
const {Settlements}=require('./settlements');
const {normalizeInsurancePolicy,loadInsurancePolicy}=require('./insurance-policy');
const { seedDemo } = require('./demo');
const { fail, utc, day, dateOnly } = require('./common');
const PUBLIC = path.resolve(__dirname, '../../public/v2');
function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(value));
}
async function body(req,limit=64*1024) {
  let bytes = 0, chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) fail(413, 'BODY_TOO_LARGE', '提交内容过大'); chunks.push(chunk); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'INVALID_JSON', '请求内容不是有效JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'INVALID_JSON', '请求内容应为对象');
  return result;
}
function createApplication({ filename = ':memory:', demo = false, clock, attachmentDir,pharmacyPolicy,insurancePolicy,integrationSimulation=false } = {}) {
  if(integrationSimulation&&filename!==':memory:')throw new Error('支付医保模拟仅允许隔离内存数据库，不得写入实际业务库');
  const db = openDatabase(filename), auth = new Auth(db, clock), unit = new UnitOfWork(db, auth), reception = new Reception(db, unit), clinical = new Clinical(db, unit);
  const documentStore=new DocumentStore(attachmentDir||(filename===':memory:'?null:path.resolve(path.dirname(filename),'clinical-files')));
  const documents=new Documents(db,unit,clinical,documentStore);
  const billing = new Billing(db, unit), treatment = new Treatment(db, unit, clinical, billing,documents);
  const payments = new Payments(db, unit, billing);
  const fees = new Fees(db, unit, billing, payments);
  const settlements=new Settlements(db,unit,billing,payments,integrationSimulation);
  const insurance=new Insurance(db,unit,billing,normalizeInsurancePolicy(insurancePolicy===undefined?(filename===':memory:'?{enabled:false}:loadInsurancePolicy(filename)):insurancePolicy),integrationSimulation);
  const followups = new Followups(db, unit, clinical);
  const inventory = new Inventory(db, unit), purchases = new Purchases(db, unit, inventory);
  const resources=new Resources(db,unit,clinical);
  const prescriptions=new Prescriptions(db,unit,clinical);
  const pharmacy=new Pharmacy(db,unit,prescriptions,inventory,billing,normalizePolicy(pharmacyPolicy===undefined?(filename===':memory:'?{enabled:false}:loadPolicy(filename)):pharmacyPolicy));prescriptions.pharmacy=pharmacy;
  if (demo) seedDemo(db, auth, reception);
  const cookie = token => `clinic_v2_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}`;
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), p = url.pathname;
      if (!p.startsWith('/api/')) {
        const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/documents.js':['documents.js','text/javascript'], '/prescriptions.js':['prescriptions.js','text/javascript'], '/pharmacy.js':['pharmacy.js','text/javascript'], '/settlements.js':['settlements.js','text/javascript'], '/insurance.js':['insurance.js','text/javascript'], '/clinical.js':['clinical.js','text/javascript'], '/catalog.js':['catalog.js','text/javascript'], '/finance.js':['finance.js','text/javascript'], '/followups.js':['followups.js','text/javascript'], '/inventory.js':['inventory.js','text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
        if (!files[p] || req.method !== 'GET') return json(res, 404, { code: 'NOT_FOUND', message: '页面不存在' });
        res.writeHead(200, { 'Content-Type': files[p][1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
        return res.end(fs.readFileSync(path.join(PUBLIC, files[p][0])));
      }
      const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('clinic_v2_session='))?.slice('clinic_v2_session='.length);
      const credentials = { token, role: req.headers['x-clinic-role'], csrf: req.headers['x-csrf-token'] };
      if(p==='/api/v2/settlements/query'&&req.method==='GET')return json(res,200,settlements.query(credentials,Object.fromEntries(url.searchParams)));
      if(p==='/api/v2/insurance/query'&&req.method==='GET')return json(res,200,insurance.query(credentials,Object.fromEntries(url.searchParams)));
      const settlementCommands={'/api/v2/payment-orders/create':'order','/api/v2/payment-orders/verify':'verifyOrder','/api/v2/settlements/reconcile':'reconcile','/api/v2/settlements/check':'check','/api/v2/settlements/issues':'issue'};
      if(settlementCommands[p]&&req.method==='POST')return json(res,200,settlements[settlementCommands[p]](credentials,await body(req)));
      const insuranceCommands={'/api/v2/insurance/identity':'identity','/api/v2/insurance/mappings':'mapping','/api/v2/insurance/register':'register','/api/v2/insurance/prepare':'prepare','/api/v2/insurance/choice':'choice','/api/v2/insurance/settle':'settle','/api/v2/insurance/reverse':'reverse','/api/v2/insurance/receipts':'receipt'};
      if(insuranceCommands[p]&&req.method==='POST')return json(res,200,insurance[insuranceCommands[p]](credentials,await body(req)));
      if(p==='/api/v2/pharmacy/query'&&req.method==='GET')return json(res,200,pharmacy.query(credentials,Object.fromEntries(url.searchParams)));
      if(p==='/api/v2/pharmacy/management'&&req.method==='GET')return json(res,200,pharmacy.management(credentials));
      const pharmacyCommands={'/api/v2/pharmacy/qualifications':'qualify','/api/v2/pharmacy/review':'review','/api/v2/pharmacy/dispense':'dispense'};
      if(pharmacyCommands[p]&&req.method==='POST')return json(res,200,pharmacy[pharmacyCommands[p]](credentials,await body(req)));
      if(p==='/api/v2/prescriptions/worklist'&&req.method==='GET')return json(res,200,prescriptions.worklist(credentials,Object.fromEntries(url.searchParams)));
      if(p==='/api/v2/prescriptions/query'&&req.method==='GET')return json(res,200,prescriptions.query(credentials,Object.fromEntries(url.searchParams)));
      if(p==='/api/v2/prescriptions/write'&&req.method==='POST')return json(res,200,prescriptions.write(credentials,await body(req)));
      const rxExport=p.match(/^\/api\/v2\/prescriptions\/(\d+)\/export$/);
      if(rxExport&&req.method==='GET'){
        const copy=prescriptions.export(credentials,Number(rxExport[1]));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="${copy.name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"});return res.end(copy.html);
      }
      if(p==='/api/v2/documents/worklist'&&req.method==='GET')return json(res,200,documents.worklist(credentials,Object.fromEntries(url.searchParams)));
      if(p==='/api/v2/documents/query'&&req.method==='GET')return json(res,200,documents.query(credentials,Object.fromEntries(url.searchParams)));
      const documentCommands={'/api/v2/documents/upload':'upload','/api/v2/documents/verify':'verify','/api/v2/documents/correct':'correct'};
      if(documentCommands[p]&&req.method==='POST'){
        // Authenticate before accepting a large upload; command authorization is rechecked under the write lock.
        auth.authorize(token,credentials.role,documentCommands[p]==='upload'?'uc23.upload':'uc23.confirm',credentials.csrf??'');
        return json(res,200,documents[documentCommands[p]](credentials,await body(req,Math.ceil(MAX_FILE_BYTES/3)*4+32768)));
      }
      const download=p.match(/^\/api\/v2\/documents\/versions\/(\d+)\/download$/);
      if(download&&req.method==='GET'){
        const file=documents.download(credentials,Number(download[1]));
        res.writeHead(200,{'Content-Type':file.mediaType,'Content-Length':file.bytes.length,'Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(file.bytes);
      }
      if (p === '/api/v2/status' && req.method === 'GET') return json(res, 200, { application:'qinghe-dental-v2',schemaVersion:VERSION,ready:true,demo,businessDate:day(auth.now()),now:auth.now(),numbering:'现行需求文档25个系统用例，内部权限保留历史编号',implementedCoreUsecases:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],pendingCoreUsecases:[],settlementApi:{implemented:['orders','dailyReconciliation','discrepancyFollowup'],networkConnected:false,mode:integrationSimulation?'isolatedSimulation':'officialTerminalVerification'},insuranceApi:{implemented:['identity','preSettlement','patientChoice','settlement','reversal','fundReceipts'],...insurance.state()},prescriptionApi:{usecase:'现行UC-25',implemented:['outsideDraft','outsideIssue','inHouseDraft','inHouseIssue','physicianResponse','void','protectedCopy'],inHouseEnabled:pharmacy.state().active,pending:[]},pharmacyApi:{usecase:'现行UC-25',implemented:['qualification','review','physicianResponse','dispense','stockAndActualFees'],inHouseEnabled:pharmacy.state().active},excludedScope:['复杂供应商结算与付款','细粒度采购退换与资金分配','器械逐包追溯','运行迁移与详细技术验收'],purchaseReceiptApi:{usecase:'现行UC-19',implemented:['receive','inspectPending','receiptNote']},resourceApi:{usecase:'现行UC-24',implemented:['equipment','block','restore','physicalEnd','equipmentReservation','readinessCheck','waitingRecoordination']} });
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
        '/api/v2/patients/maintain': 'patient', '/api/v2/schedules/schedule': 'schedule', '/api/v2/appointments/maintain': 'appointment', '/api/v2/visits/register': 'arrive', '/api/v2/visits/recoordinate':'recoordinate'
      };
      if (commands[p] && req.method === 'POST') return json(res, 200, reception[commands[p]](credentials, await body(req)));
      const resourceCommands={'/api/v2/resources/equipment':'equipment','/api/v2/resources/blocks':'block','/api/v2/resources/finish':'finish'};
      if(resourceCommands[p]&&req.method==='POST')return json(res,200,resources[resourceCommands[p]](credentials,await body(req)));
      if(p==='/api/v2/resources/query'&&req.method==='GET')return json(res,200,resources.query(credentials,Object.fromEntries(url.searchParams)));
      const clinicalCommands = { '/api/v2/health-versions/health': 'health', '/api/v2/clinical-records/record': 'record', '/api/v2/clinical-record-signatures/sign': 'sign' };
      if (clinicalCommands[p] && req.method === 'POST') return json(res, 200, clinical[clinicalCommands[p]](credentials, await body(req)));
      const treatmentCommands = { '/api/v2/treatment-plans/plan': 'plan', '/api/v2/executions/execute': 'execute' };
      if (treatmentCommands[p] && req.method === 'POST') return json(res, 200, treatment[treatmentCommands[p]](credentials, await body(req)));
      const priceCommands = { '/api/v2/service-prices/draft': 'draft', '/api/v2/service-prices/approve': 'approve' };
      if (priceCommands[p] && req.method === 'POST') return json(res, 200, billing[priceCommands[p]](credentials, await body(req)));
      const paymentCommands = { '/api/v2/patient-payments/receive': 'receive', '/api/v2/patient-payments/allocate': 'allocate' };
      if (paymentCommands[p] && req.method === 'POST') return json(res, 200, payments[paymentCommands[p]](credentials, await body(req)));
      const feeCommands = { '/api/v2/fee-requests/apply': 'apply', '/api/v2/fee-request-decisions/approve': 'approve', '/api/v2/patient-refunds/refund': 'refund' };
      if (feeCommands[p] && req.method === 'POST') return json(res, 200, fees[feeCommands[p]](credentials, await body(req)));
      const followupCommands = { '/api/v2/followup-requirements/propose': 'propose', '/api/v2/followup-contacts/contact': 'contact', '/api/v2/followup-assessments/assess': 'assess' };
      if (followupCommands[p] && req.method === 'POST') return json(res, 200, followups[followupCommands[p]](credentials, await body(req)));
      const filters = Object.fromEntries(url.searchParams);
      if(p.startsWith('/api/v2/supplier-payments/')||p==='/api/v2/purchase-receipts/approve'){auth.session(token);fail(410,'FEATURE_REMOVED','复杂供货结算及精细退换分配已移出当前需求范围');}
      const inventoryCommands = { '/api/v2/material-batches/record':'record', '/api/v2/material-batches/approve':'approve', '/api/v2/inventory-commands/record':'recordMovement', '/api/v2/inventory-commands/approve':'approveCount' };
      if (inventoryCommands[p] && req.method === 'POST') return json(res,200,inventory[inventoryCommands[p]](credentials,await body(req)));
      const purchaseCommands = { '/api/v2/purchases/supplier':'supplier', '/api/v2/purchases/draft':'draft', '/api/v2/purchases/approve':'approve', '/api/v2/purchase-receipts/receive':'receive' };
      if (purchaseCommands[p] && req.method === 'POST') return json(res,200,purchases[purchaseCommands[p]](credentials,await body(req)));
      if (p === '/api/v2/batch-stock/query' && req.method === 'GET') return json(res,200,inventory.query(credentials,filters));
      if (p === '/api/v2/inventory/options' && req.method === 'GET') return json(res,200,inventory.options(credentials));
      if (p === '/api/v2/inventory/usage-options' && req.method === 'GET') return json(res,200,inventory.usageOptions(credentials,filters));
      if (p === '/api/v2/purchases/query' && req.method === 'GET') return json(res,200,purchases.query(credentials,filters));
      if (p === '/api/v2/followup-requirements/query' && req.method === 'GET') return json(res, 200, followups.query(credentials, filters));
      if (p === '/api/v2/followups/options' && req.method === 'GET') return json(res, 200, followups.options(credentials));
      if (p === '/api/v2/followups/context' && req.method === 'GET') return json(res, 200, followups.context(credentials,filters));
      if (p === '/api/v2/fee-requests/query' && req.method === 'GET') return json(res, 200, fees.query(credentials, filters));
      if (p === '/api/v2/treatment-plans/query' && req.method === 'GET') return json(res, 200, treatment.detail(credentials, filters));
      if (p === '/api/v2/services/options' && req.method === 'GET') return json(res, 200, billing.catalog(credentials));
      if (p === '/api/v2/patient-bills/query' && req.method === 'GET') return json(res, 200, billing.query(credentials, filters));
      if (p === '/api/v2/finance/patients' && req.method === 'GET') return json(res, 200, billing.candidates(credentials, filters));
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
        return { schedules, dentists, chairs: db.prepare('SELECT id,name FROM dental_chair ORDER BY id').all(),equipment:db.prepare('SELECT id,name,status,dental_chair_id FROM clinical_equipment ORDER BY id').all() };
      }));
      if (p === '/api/v2/visits/waiting' && req.method === 'GET') return json(res, 200, reception.waiting(credentials));
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
  return { db, auth, unit, reception, clinical, billing, treatment, payments, fees, followups, inventory, purchases, resources, documents, documentStore, prescriptions,pharmacy,settlements,insurance,server };
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
