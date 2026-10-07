const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { createDatabase, hashPassword, verifyPassword, nextNo, audit } = require('./db');
const svc = require('./services');
const requirements = require('./requirements');
const materials = require('./materials');
const workflows = require('./workflows');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.CLINIC_DB || path.join(ROOT, 'data', 'clinic.db');
const PORT = Number(process.env.PORT || 3000);
const db = createDatabase(DATA);

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function csv(res, filename, columns, rows) {
  const content = '\uFEFF' + [columns.map(x => csvCell(x.label)).join(','), ...rows.map(row => columns.map(x => csvCell(row[x.key])).join(','))].join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(content);
}
function fail(status, message, extra = {}) { const e = new Error(message); e.status = status; Object.assign(e, extra); throw e; }
function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1))]; }));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 3_000_000) fail(413, '请求内容过大'); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { fail(400, '请求内容不是有效JSON'); }
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function currentUser(req) {
  const token = parseCookies(req).clinic_session;
  if (!token) return null;
  const row = db.prepare(`SELECT u.*,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND julianday(s.expires_at)>julianday('now') AND u.active=1`).get(tokenHash(token));
  return row || null;
}
function mustUser(req, roles = []) {
  const user = currentUser(req);
  if (!user) fail(401, '请先登录');
  if (roles.length && !svc.hasRole(user, ...roles)) fail(403, '当前角色不能执行此操作');
  return user;
}
function checkCsrf(req, user) {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== user.csrf_token) fail(403, '安全令牌已失效，请刷新页面后重试');
}
function isoDay(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset()*60000);
  return d.toISOString().slice(0,10);
}
const STAFF_ROLES = ['manager','frontdesk','cashier','dentist','assistant'];
function normalizedRoles(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(values.map(x => String(x).trim()).filter(x => STAFF_ROLES.includes(x)))];
}
function patientDetail(id, user) {
  const patient = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  if (!patient) fail(404, '患者不存在');
  patient.alerts = db.prepare('SELECT * FROM health_alerts WHERE patient_id=? AND active=1 ORDER BY severity DESC,id DESC').all(id);
  patient.appointments = db.prepare(`SELECT a.*,u.display_name dentist_name,c.name chair_name,s.name service_name
    FROM appointments a JOIN users u ON u.id=a.dentist_id JOIN chairs c ON c.id=a.chair_id LEFT JOIN services s ON s.id=a.service_id
    WHERE a.patient_id=? ORDER BY a.start_at DESC LIMIT 20`).all(id);
  patient.encounters = db.prepare('SELECT id,encounter_no,status,started_at,ended_at,dentist_id FROM encounters WHERE patient_id=? ORDER BY started_at DESC LIMIT 20').all(id);
  if (svc.hasRole(user, 'cashier', 'frontdesk', 'manager')) {
    patient.invoices = db.prepare('SELECT * FROM invoices WHERE patient_id=? ORDER BY created_at DESC LIMIT 20').all(id);
  }
  if(svc.hasRole(user,'frontdesk')) patient.changes=db.prepare('SELECT c.*,u.display_name changed_name FROM patient_changes c JOIN users u ON u.id=c.changed_by WHERE patient_id=? ORDER BY c.id DESC').all(id);
  return patient;
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p.startsWith('/api/patient/')) fail(410, '预约和诊后事宜请联系诊所前台办理');
  if (p === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(body.username || '').trim());
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
      audit(db, user?.id, 'auth.login', 'user', user?.id, null, { username: body.username }, 'denied');
      return json(res, 401, { error: '账号或密码不正确' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 8*3600_000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at<=CURRENT_TIMESTAMP').run();
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').run(tokenHash(token), user.id, csrf, expires);
    audit(db, user.id, 'auth.login', 'user', user.id, null, null);
    return json(res, 200, { user: { id:user.id, name:user.display_name, roles:svc.rolesOf(user) }, csrf }, { 'Set-Cookie': `clinic_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }

  const user = mustUser(req);
  checkCsrf(req, user);
  if (/^\/api\/(?:approvals|notifications|appointment-change-requests)(?:\/|$)/.test(p) || /\/portal-account$|\/refunds$/.test(p)) fail(410, '当前业务不提供此项操作');
  if (p === '/api/logout' && req.method === 'POST') {
    const token = parseCookies(req).clinic_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    audit(db, user.id, 'auth.logout', 'user', user.id, null, null);
    return json(res, 200, { ok:true }, { 'Set-Cookie':'clinic_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/me' && req.method === 'GET') return json(res,200,{ user:{id:user.id,name:user.display_name,roles:svc.rolesOf(user)},csrf:user.csrf_token });

  if (p === '/api/exports' && req.method === 'GET') {
    const type = String(url.searchParams.get('type') || '');
    const from = url.searchParams.get('from') || isoDay(new Date(Date.now()-30*86400000));
    const to = url.searchParams.get('to') || isoDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail(400, '导出日期格式无效');
    const fromDate = new Date(`${from}T00:00:00`); const toDate = new Date(`${to}T23:59:59`);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || toDate < fromDate) fail(400, '导出日期范围无效');
    if ((toDate-fromDate)/86400000 > 366) fail(400, '单次导出范围不能超过366天');
    let rows; let columns; let roles;
    if (type === 'patients') {
      roles=['frontdesk','manager'];
      columns=[['patient_no','患者编号'],['full_name','姓名'],['sex','性别'],['birth_date','出生日期'],['phone','手机号'],['emergency_contact','紧急联系人'],['contact_preference','联系偏好'],['created_at','建档时间']].map(([key,label])=>({key,label}));
      rows=db.prepare(`SELECT patient_no,full_name,sex,birth_date,phone,emergency_contact,contact_preference,created_at FROM patients WHERE active=1 AND date(created_at,'localtime') BETWEEN ? AND ? ORDER BY id`).all(from,to);
    } else if (type === 'appointments') {
      roles=['frontdesk','manager'];
      columns=[['appointment_no','预约编号'],['start_at','开始时间'],['end_at','结束时间'],['status','状态'],['patient_no','患者编号'],['full_name','患者姓名'],['phone','手机号'],['dentist_name','牙医'],['chair_name','牙椅'],['service_name','服务项目'],['source','来源'],['patient_note','患者备注']].map(([key,label])=>({key,label}));
      rows=db.prepare(`SELECT a.appointment_no,a.start_at,a.end_at,a.status,p.patient_no,p.full_name,p.phone,u.display_name dentist_name,c.name chair_name,s.name service_name,a.source,a.patient_note FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.dentist_id JOIN chairs c ON c.id=a.chair_id LEFT JOIN services s ON s.id=a.service_id WHERE date(a.start_at,'localtime') BETWEEN ? AND ? AND (p.full_name LIKE ? OR p.phone LIKE ? OR p.patient_no LIKE ?) ORDER BY a.start_at`).all(from,to,q,q,q);
    } else if (type === 'billing') {
      roles=['cashier','manager'];
      columns=[['invoice_no','账单编号'],['created_at','开单时间'],['patient_no','患者编号'],['full_name','患者姓名'],['gross_amount','应收金额'],['paid_amount','净收金额'],['tendered_amount','现金实收'],['change_amount','找零'],['receipt_no','收据编号'],['paid_at','收款时间'],['balance','未结余额'],['status','状态']].map(([key,label])=>({key,label}));
      rows=db.prepare(`SELECT i.invoice_no,i.created_at,p.patient_no,p.full_name,i.gross_amount,i.paid_amount,r.tendered_amount,r.change_amount,r.receipt_no,r.paid_at,i.balance,i.status FROM invoices i JOIN patients p ON p.id=i.patient_id LEFT JOIN cash_receipts r ON r.invoice_id=i.id WHERE date(i.created_at,'localtime') BETWEEN ? AND ? ORDER BY i.created_at`).all(from,to);
    } else if (type === 'followups') {
      roles=['frontdesk','dentist','manager'];
      columns=[['patient_no','患者编号'],['full_name','患者姓名'],['reason','复诊原因'],['due_date','建议日期'],['status','状态'],['assigned_name','负责人'],['result','处理结果'],['created_at','建立时间']].map(([key,label])=>({key,label}));
      rows=db.prepare(`SELECT p.patient_no,p.full_name,f.reason,f.due_date,f.status,u.display_name assigned_name,f.result,f.created_at FROM followups f JOIN patients p ON p.id=f.patient_id LEFT JOIN users u ON u.id=f.assigned_to WHERE date(f.created_at,'localtime') BETWEEN ? AND ? ORDER BY f.created_at`).all(from,to);
    } else fail(400, '不支持的导出类型');
    svc.requireRole(user,...roles);
    if (rows.length > 10000) fail(413, '导出记录超过10000条，请缩小日期范围');
    audit(db,user.id,'data.export',type,null,null,{from,to,rowCount:rows.length});
    return csv(res,`${type}-${from}-to-${to}.csv`,columns,rows);
  }

  if (p === '/api/reference' && req.method === 'GET') {
    const users = db.prepare("SELECT id,display_name,roles FROM users WHERE active=1 ORDER BY display_name").all();
    const services=db.prepare('SELECT * FROM services WHERE active=1').all().map(s=>{const v=requirements.priceAt(db,s.id,new Date().toISOString());return {...s,current_price:v?.unit_price??null,price_missing:!v};});
    return json(res,200,{users,dentists:users.filter(x=>String(x.roles).includes('dentist')),chairs:db.prepare('SELECT * FROM chairs WHERE active=1').all(),services});
  }

  if (p === '/api/dashboard' && req.method === 'GET') {
    const day = url.searchParams.get('date') || isoDay();
    const appointments = db.prepare(`SELECT a.*,p.patient_no,p.full_name,p.phone,u.display_name dentist_name,c.name chair_name,s.name service_name,
      (SELECT GROUP_CONCAT(description,'；') FROM health_alerts h WHERE h.patient_id=p.id AND h.active=1) alerts
      FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.dentist_id JOIN chairs c ON c.id=a.chair_id
      LEFT JOIN services s ON s.id=a.service_id WHERE date(a.start_at,'localtime')=? ORDER BY a.start_at`).all(day);
    const counts = Object.fromEntries(['confirmed','arrived','cancelled'].map(st=>[st,appointments.filter(a=>a.status===st).length]));
    const followups = db.prepare("SELECT COUNT(*) count FROM followups WHERE status='pending'").get().count;
    const unpaid = svc.hasRole(user,'cashier','manager')
      ? db.prepare("SELECT COALESCE(SUM(balance),0) amount FROM invoices WHERE balance>0").get().amount
      : null;
    return json(res,200,{ day,appointments,counts,followups,unpaid });
  }

  if (p === '/api/patients' && req.method === 'GET') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    const rows = db.prepare(`SELECT p.*,(SELECT GROUP_CONCAT(description,'；') FROM health_alerts h WHERE h.patient_id=p.id AND h.active=1) alerts
      FROM patients p WHERE p.active=1 AND (p.patient_no LIKE ? OR p.full_name LIKE ? OR p.phone LIKE ?) ORDER BY p.id DESC LIMIT 100`).all(q,q,q);
    return json(res,200,{patients:rows});
  }
  if (p === '/api/patients' && req.method === 'POST') {
    const result=workflows.savePatient(db,null,await readBody(req),user);
    return json(res,201,{...result,patient:patientDetail(result.patient.id,user)});
  }
  let m=p.match(/^\/api\/patients\/(\d+)$/);
  if (m && req.method==='GET') return json(res,200,{patient:patientDetail(Number(m[1]),user)});
  if (m && req.method==='PUT') {
    const result=workflows.savePatient(db,Number(m[1]),await readBody(req),user);
    return json(res,200,{...result,patient:patientDetail(result.patient.id,user)});
  }
  m=p.match(/^\/api\/patients\/(\d+)\/alerts$/);
  if (m && req.method==='POST') {
    svc.requireRole(user,'frontdesk','dentist','manager'); const b=await readBody(req); if(!b.description) fail(400,'风险描述为必填');
    const r=db.prepare('INSERT INTO health_alerts(patient_id,alert_type,description,severity) VALUES(?,?,?,?)').run(Number(m[1]),b.type||'风险提示',b.description,b.severity||'medium');
    audit(db,user.id,'patient.alert.create','health_alert',r.lastInsertRowid,Number(m[1]),null); return json(res,201,{ok:true});
  }
  if (p === '/api/appointments' && req.method === 'GET') {
    svc.requireRole(user,'frontdesk');
    const from=url.searchParams.get('from')||isoDay(); const to=url.searchParams.get('to')||from;requirements.day(from);requirements.day(to);if(from>to)fail(400,'结束日期不能早于开始日期');const q=`%${url.searchParams.get('q')||''}%`;
    const rows=db.prepare(`SELECT a.*,p.patient_no,p.full_name,p.phone,u.display_name dentist_name,c.name chair_name,s.name service_name
      FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.dentist_id JOIN chairs c ON c.id=a.chair_id LEFT JOIN services s ON s.id=a.service_id
      WHERE date(a.start_at,'localtime') BETWEEN ? AND ? AND (p.full_name LIKE ? OR p.phone LIKE ? OR p.patient_no LIKE ?) ORDER BY a.start_at`).all(from,to,q,q,q);
    return json(res,200,{appointments:rows});
  }
  if(p==='/api/availability'&&req.method==='GET'){
    svc.requireRole(user,'frontdesk','dentist');
    const dentistId=Number(url.searchParams.get('dentistId'));const chairId=Number(url.searchParams.get('chairId'));const date=String(url.searchParams.get('date')||'');const duration=Math.max(10,Number(url.searchParams.get('duration')||30));
    if(svc.hasRole(user,'dentist')&&!svc.hasRole(user,'frontdesk')&&dentistId!==user.id)fail(403,'牙医只能查询本人的可用接诊时段');
    requirements.day(date);if(!Number.isInteger(duration)||duration>480||!db.prepare('SELECT id FROM chairs WHERE id=? AND active=1').get(chairId))fail(400,'牙椅或诊疗时长无效');
    if(!dentistId||!chairId||!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'牙医、牙椅和日期为必填');const [year,month,day]=date.split('-').map(Number);const midday=new Date(year,month-1,day,12,0,0,0);if(Number.isNaN(midday.getTime()))fail(400,'日期无效');
    const clinic=db.prepare('SELECT * FROM clinic_hours WHERE weekday=? AND active=1').get(midday.getDay());const schedule=db.prepare('SELECT * FROM dentist_schedules WHERE dentist_id=? AND weekday=? AND active=1').get(dentistId,midday.getDay());if(!clinic||!schedule)return json(res,200,{slots:[],reason:!clinic?'诊所不营业':'牙医未排班'});
    const toMinutes=value=>{const [h,m]=String(value).split(':').map(Number);return h*60+m};const startMinute=Math.max(toMinutes(clinic.open_time),toMinutes(schedule.start_time));const endMinute=Math.min(toMinutes(clinic.close_time),toMinutes(schedule.end_time));const slots=[];
    for(let minute=startMinute;minute+duration<=endMinute;minute+=30){const start=new Date(year,month-1,day,Math.floor(minute/60),minute%60,0,0);const end=new Date(start.getTime()+duration*60000);const leave=db.prepare("SELECT id FROM staff_leaves WHERE user_id=? AND status='approved' AND start_at<? AND end_at>? LIMIT 1").get(dentistId,end.toISOString(),start.toISOString());const conflict=svc.findConflict(db,{dentistId,chairId,startAt:start.toISOString(),endAt:end.toISOString(),excludeId:url.searchParams.get('excludeId')?Number(url.searchParams.get('excludeId')):null,patientId:url.searchParams.get('patientId')?Number(url.searchParams.get('patientId')):null});if(start.getTime()>Date.now()&&!leave&&!conflict)slots.push({startAt:start.toISOString(),endAt:end.toISOString(),label:`${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}–${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`});}
    return json(res,200,{slots,clinic:{openTime:clinic.open_time,closeTime:clinic.close_time},schedule:{startTime:schedule.start_time,endTime:schedule.end_time}});
  }
  if (p === '/api/appointments' && req.method === 'POST') return json(res,201,{appointment:svc.createAppointment(db,await readBody(req),user)});
  m=p.match(/^\/api\/appointments\/(\d+)$/);
  if(m&&req.method==='PUT')return json(res,200,{appointment:svc.updateAppointment(db,Number(m[1]),await readBody(req),user)});
  m=p.match(/^\/api\/appointments\/(\d+)\/status$/);
  if (m && req.method==='POST') { const b=await readBody(req); const result=svc.changeAppointmentStatus(db,Number(m[1]),b.status,b.reason,user,b.expectedVersion); return json(res,200,{ok:true,...result}); }

  if (p === '/api/encounters' && req.method === 'GET') {
    svc.requireRole(user,'dentist');
    const rows=db.prepare(`SELECT e.*,p.patient_no,p.full_name,u.display_name dentist_name,
      (SELECT GROUP_CONCAT(tooth_code||':'||finding,'；') FROM tooth_findings t WHERE t.encounter_id=e.id) findings
      FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN users u ON u.id=e.dentist_id WHERE e.dentist_id=? ORDER BY e.started_at DESC LIMIT 100`).all(user.id);
    return json(res,200,{encounters:rows});
  }
  if (p === '/api/encounters' && req.method === 'POST') {
    svc.requireRole(user,'dentist'); const b=await readBody(req);
    const a=db.prepare('SELECT * FROM appointments WHERE id=?').get(Number(b.appointmentId));
    if(!a||a.patient_id!==Number(b.patientId)||a.dentist_id!==user.id)fail(409,'患者、预约与接诊牙医须一致');
    if(a.status!=='arrived')fail(409,'请先由前台登记本次到诊');
    const encounter=db.prepare('SELECT * FROM encounters WHERE appointment_id=? ORDER BY id LIMIT 1').get(a.id);
    if(!encounter)fail(409,'到诊登记尚未形成就诊记录，请前台核实');
    return json(res,200,{encounter});
  }
  m=p.match(/^\/api\/encounters\/(\d+)$/);
  if (m && req.method==='GET') {
    const id=Number(m[1]); workflows.clinicalAccess(db,id,user,url.searchParams.get('currentEncounterId'));
     const encounter=db.prepare(`SELECT e.*,p.patient_no,p.full_name,p.phone,u.display_name dentist_name FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN users u ON u.id=e.dentist_id WHERE e.id=?`).get(id);
    if(!encounter) fail(404,'就诊记录不存在');
    encounter.alerts=db.prepare('SELECT * FROM health_alerts WHERE patient_id=? AND active=1').all(encounter.patient_id);
    encounter.findings=db.prepare('SELECT * FROM tooth_findings WHERE encounter_id=? ORDER BY id').all(id);
    encounter.amendments=db.prepare('SELECT a.*,u.display_name signed_name FROM record_amendments a JOIN users u ON u.id=a.signed_by WHERE encounter_id=? ORDER BY signed_at').all(id);
    encounter.plans=db.prepare('SELECT * FROM treatment_plans WHERE encounter_id=? ORDER BY version_no').all(id);
    encounter.treatments=db.prepare(`SELECT t.*,s.name service_name,s.unit,u.display_name dentist_name FROM treatments t JOIN services s ON s.id=t.service_id JOIN users u ON u.id=t.performed_by WHERE encounter_id=? AND t.status='confirmed'`).all(id);
    encounter.confirmationHistory=db.prepare('SELECT * FROM treatment_confirmation_versions WHERE encounter_id=? ORDER BY version').all(id);
    encounter.attachments=db.prepare(`SELECT a.id,a.patient_id,a.encounter_id,a.category,a.original_name,a.mime_type,a.file_size,a.description,a.active,a.created_at,u.display_name uploaded_name FROM clinical_attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.encounter_id=? AND a.active=1 ORDER BY a.created_at DESC,a.id DESC`).all(id);
    audit(db,user.id,'clinical.view','encounter',id,encounter.patient_id,null);
    return json(res,200,{encounter});
  }
  if (m && req.method==='PUT') {
    const id=Number(m[1]),b=await readBody(req);
    requirements.transaction(db,()=>{
      const e=requirements.assignedEncounter(db,id,user,{editable:true});
      workflows.version(e,b);
      if(b.findings!=null&&(!Array.isArray(b.findings)||b.findings.some(x=>!String(x.toothCode||'').trim()||!String(x.finding||'').trim())))fail(400,'牙位与检查所见须完整');
      db.prepare('UPDATE encounters SET chief_complaint=?,relevant_history=?,diagnosis=?,clinical_notes=?,instructions=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(b.chiefComplaint||null,b.relevantHistory||null,b.diagnosis||null,b.clinicalNotes||null,b.instructions||null,id);
      if(Array.isArray(b.findings)){db.prepare('DELETE FROM tooth_findings WHERE encounter_id=?').run(id);const add=db.prepare('INSERT INTO tooth_findings(encounter_id,tooth_code,finding,created_by) VALUES(?,?,?,?)');for(const x of b.findings)add.run(id,x.toothCode,x.finding,user.id);}
      audit(db,user.id,'clinical.update','encounter',id,e.patient_id,null);
    });
    return json(res,200,{ok:true,version:db.prepare('SELECT version FROM encounters WHERE id=?').get(id).version});
  }
  m=p.match(/^\/api\/encounters\/(\d+)\/sign$/);
  if (m && req.method==='POST') { const b=await readBody(req);svc.requireRole(user,'dentist');if(b.expectedVersion==null)fail(400,'须提交病历版本');return json(res,200,svc.signEncounter(db,Number(m[1]),user,b.expectedVersion)); }
  m=p.match(/^\/api\/encounters\/(\d+)\/amend$/);
  if (m && req.method==='POST') { const b=await readBody(req); svc.amendEncounter(db,Number(m[1]),b.text,b.reason,user); return json(res,201,{ok:true}); }

  if(p==='/api/attachments'&&req.method==='POST'){
    svc.requireRole(user,'dentist');const b=await readBody(req);if(!b.encounterId)fail(400,'附件须关联本次就诊');requirements.assignedEncounter(db,Number(b.encounterId),user);const patientId=Number(b.patientId);const encounterId=b.encounterId?Number(b.encounterId):null;const category=String(b.category||'');const originalName=path.basename(String(b.filename||'')).slice(0,180);const mime=String(b.mimeType||'');const description=String(b.description||'').trim().slice(0,500);if(!db.prepare('SELECT id FROM patients WHERE id=?').get(patientId))fail(400,'患者不存在');if(!['xray','photo','consent','report','other'].includes(category))fail(400,'附件分类无效');if(!originalName)fail(400,'文件名不能为空');if(!['image/jpeg','image/png','application/pdf'].includes(mime))fail(415,'只允许JPEG、PNG或PDF文件');if(encounterId){const encounter=db.prepare('SELECT patient_id FROM encounters WHERE id=?').get(encounterId);if(!encounter)fail(404,'就诊记录不存在');if(encounter.patient_id!==patientId)fail(409,'附件患者与就诊记录不一致');}
    const encoded=String(b.dataBase64||'').replace(/\s/g,'');let file;try{file=Buffer.from(encoded,'base64');}catch{fail(400,'附件内容无法读取');}if(!file.length)fail(400,'附件内容为空');if(file.length>2*1024*1024)fail(413,'单个附件不能超过2MB');const signatureOk=mime==='image/jpeg'&&file.length>=3&&file[0]===0xff&&file[1]===0xd8&&file[2]===0xff||mime==='image/png'&&file.length>=8&&file.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))||mime==='application/pdf'&&file.subarray(0,5).toString()==='%PDF-';if(!signatureOk)fail(415,'文件内容与声明类型不一致');
    const r=db.prepare('INSERT INTO clinical_attachments(patient_id,encounter_id,category,original_name,mime_type,file_size,file_data,description,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)').run(patientId,encounterId,category,originalName,mime,file.length,file,description||null,user.id);audit(db,user.id,'attachment.create','clinical_attachment',r.lastInsertRowid,patientId,{encounterId,category,filename:originalName,size:file.length});return json(res,201,{id:Number(r.lastInsertRowid)});
  }
  m=p.match(/^\/api\/attachments\/(\d+)\/file$/);
  if(m&&req.method==='GET'){
    svc.requireRole(user,'dentist','assistant','manager');const item=db.prepare('SELECT * FROM clinical_attachments WHERE id=? AND active=1').get(Number(m[1]));if(!item)fail(404,'附件不存在或已归档');workflows.clinicalAccess(db,item.encounter_id,user,url.searchParams.get('currentEncounterId'));audit(db,user.id,'attachment.view','clinical_attachment',item.id,item.patient_id,null);const safeName=encodeURIComponent(item.original_name);res.writeHead(200,{'Content-Type':item.mime_type,'Content-Length':item.file_size,'Content-Disposition':`inline; filename*=UTF-8''${safeName}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(item.file_data);return;
  }
  m=p.match(/^\/api\/attachments\/(\d+)\/archive$/);
  if(m&&req.method==='PUT'){svc.requireRole(user,'manager');const item=db.prepare('SELECT * FROM clinical_attachments WHERE id=?').get(Number(m[1]));if(!item)fail(404,'附件不存在');if(!item.active)fail(409,'附件已经归档');const b=await readBody(req);const reason=String(b.reason||'').trim();if(!reason)fail(400,'归档附件必须填写原因');db.prepare('UPDATE clinical_attachments SET active=0 WHERE id=?').run(item.id);audit(db,user.id,'attachment.archive','clinical_attachment',item.id,item.patient_id,{reason});return json(res,200,{ok:true});}

  m=p.match(/^\/api\/encounters\/(\d+)\/plans$/);
  if(m&&req.method==='POST'){
    const encounterId=Number(m[1]),b=await readBody(req);
    const planId=requirements.transaction(db,()=>{
      const e=requirements.assignedEncounter(db,encounterId,user,{editable:true});workflows.version(e,b);
      if(!Array.isArray(b.items)||!b.items.length)fail(400,'治疗方案至少包含一个项目');
      const no=nextNo(db,'treatment_plans','plan_no','TP');
      const r=db.prepare("INSERT INTO treatment_plans(plan_no,patient_id,encounter_id,status,summary,explained_at,created_by) VALUES(?,?,?,'pending_decision',?,CURRENT_TIMESTAMP,?)").run(no,e.patient_id,e.id,b.summary||null,user.id);
      const add=db.prepare('INSERT INTO plan_items(plan_id,service_id,tooth_code,planned_quantity,estimated_price,decision) VALUES(?,?,?,?,?,?)');
      for(const item of b.items){
        const s=db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(Number(item.serviceId));
        const quantity=Number(item.quantity),decision=item.decision||'pending';
        if(!s||!Number.isSafeInteger(quantity)||quantity<=0)fail(400,'项目须有效且数量为正整数');
        if(!['pending','agreed','rejected','deferred'].includes(decision))fail(400,'患者方案决定无效');
        const price=requirements.priceAt(db,s.id,new Date().toISOString());
        if(!price)fail(409,'方案项目尚无适用价目，请先核实费用说明');
        add.run(r.lastInsertRowid,s.id,item.toothCode||null,quantity,requirements.cents(item.estimatedPrice??price.unit_price)/100,decision);
      }
      db.prepare('UPDATE encounters SET version=version+1 WHERE id=?').run(e.id);
      const decisions=b.items.map(x=>x.decision||'pending');const planStatus=decisions.every(x=>x==='agreed')?'agreed':decisions.some(x=>x==='agreed')?'partially_agreed':decisions.every(x=>x==='rejected')?'rejected':'pending_decision';db.prepare('UPDATE treatment_plans SET status=? WHERE id=?').run(planStatus,r.lastInsertRowid);
      audit(db,user.id,'plan.create','treatment_plan',r.lastInsertRowid,e.patient_id,{planNo:no});
      return Number(r.lastInsertRowid);
    });
    return json(res,201,{planId});
  }
  m=p.match(/^\/api\/plans\/(\d+)$/);
  if(m&&req.method==='GET'){svc.requireRole(user,'dentist');const plan=db.prepare('SELECT * FROM treatment_plans WHERE id=?').get(Number(m[1]));if(!plan)fail(404,'方案不存在');plan.clinicalVersion=workflows.clinicalAccess(db,plan.encounter_id,user,url.searchParams.get('currentEncounterId')).version;plan.items=db.prepare('SELECT pi.*,s.name service_name FROM plan_items pi JOIN services s ON s.id=pi.service_id WHERE plan_id=?').all(plan.id);return json(res,200,{plan});}
  m=p.match(/^\/api\/plans\/(\d+)\/decision$/);
  if(m&&req.method==='POST'){
    const b=await readBody(req),id=Number(m[1]);
    const status=requirements.transaction(db,()=>{
      const plan=db.prepare('SELECT * FROM treatment_plans WHERE id=?').get(id);if(!plan)fail(404,'方案不存在');
      const e=requirements.assignedEncounter(db,plan.encounter_id,user,{editable:true});workflows.version(e,b);
      if(!Array.isArray(b.items)||!b.items.length)fail(400,'须提交患者对方案的决定');
      for(const item of b.items){
        if(!['pending','agreed','rejected','deferred'].includes(item.decision))fail(400,'患者方案决定无效');
        const old=db.prepare('SELECT * FROM plan_items WHERE id=? AND plan_id=?').get(Number(item.id),id);
        if(!old)fail(409,'方案项目不属于本方案');if(old.completed_quantity>0&&item.decision!=='agreed')fail(409,'已完成项目须保留原确认依据');
        db.prepare('UPDATE plan_items SET decision=? WHERE id=?').run(item.decision,old.id);
      }
      const choices=db.prepare('SELECT decision FROM plan_items WHERE plan_id=?').all(id).map(x=>x.decision);
      const status=choices.every(x=>x==='agreed')?'agreed':choices.some(x=>x==='agreed')?'partially_agreed':choices.every(x=>x==='rejected')?'rejected':'pending_decision';
      db.prepare('UPDATE treatment_plans SET status=? WHERE id=?').run(status,id);db.prepare('UPDATE encounters SET version=version+1 WHERE id=?').run(e.id);audit(db,user.id,'plan.decision','treatment_plan',id,plan.patient_id,{status});return status;
    });
    return json(res,200,{status});
  }
  m=p.match(/^\/api\/encounters\/(\d+)\/treatments$/);
  if(m&&req.method==='POST'){const b=await readBody(req);if(b.expectedVersion==null)fail(400,'须提交当前诊疗项目版本');return json(res,201,requirements.addTreatment(db,Number(m[1]),b,user));}
  m=p.match(/^\/api\/encounters\/(\d+)\/treatment-confirmation$/);
  if(m&&req.method==='PUT')return json(res,200,{confirmation:requirements.correctTreatments(db,Number(m[1]),await readBody(req),user)});
  if(p==='/api/billing/pending'&&req.method==='GET'){
    svc.requireRole(user,'cashier','manager');
    const pending=db.prepare(`SELECT e.id encounter_id,e.encounter_no,e.started_at,p.patient_no,p.full_name,COUNT(t.id) treatment_count,
      CASE WHEN MAX(t.price_missing)>0 THEN NULL ELSE SUM(t.quantity*t.unit_price_snapshot) END amount,MAX(t.price_missing) price_missing
      FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN treatments t ON t.encounter_id=e.id AND t.status='confirmed'
      LEFT JOIN invoices i ON i.encounter_id=e.id WHERE i.id IS NULL AND e.status IN ('signed','amended') GROUP BY e.id ORDER BY e.started_at`).all();
    return json(res,200,{pending});
  }
  if(p==='/api/invoices'&&req.method==='GET'){
    svc.requireRole(user,'cashier','manager');
    return json(res,200,{invoices:db.prepare(`SELECT i.*,p.patient_no,p.full_name FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 100`).all()});
  }
  if(p==='/api/invoices'&&req.method==='POST'){const b=await readBody(req);return json(res,201,{invoice:requirements.createInvoice(db,Number(b.encounterId),user)});}
  m=p.match(/^\/api\/invoices\/(\d+)$/);
  if(m&&req.method==='GET'){svc.requireRole(user,'cashier','manager');return json(res,200,{invoice:requirements.invoiceDetail(db,Number(m[1]))});}
  m=p.match(/^\/api\/invoices\/(\d+)\/payments$/);
  if(m&&req.method==='POST'){const result=requirements.receiveCash(db,Number(m[1]),await readBody(req),user);return json(res,result.replayed?200:201,result);}
  if(p==='/api/followups'&&req.method==='GET'){
    svc.requireRole(user,'frontdesk','dentist','manager');
    const rows=db.prepare(`SELECT f.*,p.patient_no,p.full_name,e.encounter_no,e.dentist_id,u.display_name assigned_name FROM followups f JOIN patients p ON p.id=f.patient_id LEFT JOIN encounters e ON e.id=f.encounter_id LEFT JOIN users u ON u.id=f.assigned_to WHERE (?=1 OR e.dentist_id=? OR EXISTS(SELECT 1 FROM encounters re WHERE re.appointment_id=f.appointment_id AND re.dentist_id=?)) ORDER BY CASE WHEN f.status IN ('pending','contacted','scheduled') THEN 0 ELSE 1 END,COALESCE(f.next_contact_date,f.due_date)`).all(svc.hasRole(user,'frontdesk')?1:0,user.id,user.id);
    return json(res,200,{followups:rows});
  }
  if(p==='/api/followups'&&req.method==='POST'){const row=requirements.createFollowup(db,await readBody(req),user);return json(res,201,{id:row.id,followup:row});}
  m=p.match(/^\/api\/followups\/(\d+)$/);
  if(m&&req.method==='GET'){svc.requireRole(user,'frontdesk','dentist','manager');const f=requirements.followupDetail(db,Number(m[1]));if(!svc.hasRole(user,'frontdesk')&&f.dentist_id!==user.id&&f.revisitEncounter?.dentist_id!==user.id)fail(403,'只能查询本人负责的复诊随访');return json(res,200,{followup:f});}
  if(m&&['PATCH','PUT'].includes(req.method))return json(res,200,{followup:requirements.updateFollowup(db,Number(m[1]),await readBody(req),user)});
  if(p==='/api/price-versions'&&req.method==='GET'){svc.requireRole(user,'cashier','manager');return json(res,200,{versions:requirements.listPriceVersions(db,url.searchParams.get('serviceId'))});}
  if(p==='/api/price-versions'&&req.method==='POST')return json(res,201,{version:requirements.createPriceVersion(db,await readBody(req),user)});
  m=p.match(/^\/api\/price-versions\/(\d+)\/end$/);
  if(m&&req.method==='PUT')return json(res,200,{version:requirements.endPriceVersion(db,Number(m[1]),await readBody(req),user)});
  if(p==='/api/materials'&&req.method==='GET'){svc.requireRole(user,'assistant','manager');return json(res,200,materials.listMaterials(db,Object.fromEntries(url.searchParams)));}
  if(p==='/api/materials'&&req.method==='POST')return json(res,201,{material:materials.createMaterial(db,await readBody(req),user)});
  m=p.match(/^\/api\/materials\/(\d+)\/movements$/);
  if(m&&req.method==='POST')return json(res,201,materials.recordMaterialMovement(db,Number(m[1]),await readBody(req),user));
  if(p==='/api/reconciliations'&&req.method==='GET'){svc.requireRole(user,'cashier','manager');return json(res,200,requirements.reconciliations(db,url.searchParams.get('date')||isoDay()));}
  if(p==='/api/reconciliations'&&req.method==='POST')return json(res,201,requirements.recordReconciliation(db,await readBody(req),user));
  if(p==='/api/admin/settings'&&req.method==='GET'){
    svc.requireRole(user,'manager');
    const users=db.prepare('SELECT id,username,display_name,roles,active,created_at FROM users ORDER BY active DESC,id').all();
    const chairs=db.prepare('SELECT * FROM chairs ORDER BY active DESC,code').all();
    const services=db.prepare('SELECT * FROM services ORDER BY active DESC,code').all();
    const priceHistory=db.prepare(`SELECT h.*,s.code service_code,s.name service_name,u.display_name changed_by_name
      FROM service_price_history h JOIN services s ON s.id=h.service_id LEFT JOIN users u ON u.id=h.changed_by
      ORDER BY h.effective_from DESC,h.id DESC LIMIT 100`).all();
    const clinicHours=db.prepare('SELECT * FROM clinic_hours ORDER BY weekday').all();
    const dentistSchedules=db.prepare(`SELECT ds.*,u.display_name dentist_name FROM dentist_schedules ds JOIN users u ON u.id=ds.dentist_id ORDER BY ds.weekday,u.display_name`).all();
    const leaves=db.prepare(`SELECT l.*,u.display_name staff_name,c.display_name created_by_name FROM staff_leaves l JOIN users u ON u.id=l.user_id JOIN users c ON c.id=l.created_by WHERE l.end_at>=CURRENT_TIMESTAMP ORDER BY l.start_at`).all();
    return json(res,200,{users,chairs,services,priceHistory,clinicHours,dentistSchedules,scheduleHistory:db.prepare('SELECT h.*,u.display_name changed_name FROM schedule_changes h JOIN users u ON u.id=h.changed_by ORDER BY h.id DESC').all(),leaves,roles:STAFF_ROLES});
  }
  if(p==='/api/admin/users'&&req.method==='POST'){
    svc.requireRole(user,'manager');const b=await readBody(req);const username=String(b.username||'').trim();const displayName=String(b.displayName||'').trim();const password=String(b.password||'');const roles=normalizedRoles(b.roles);
    if(!/^[A-Za-z][A-Za-z0-9_.-]{2,31}$/.test(username))fail(400,'账号需为3至32位字母、数字、点、横线或下划线，并以字母开头');
    if(!displayName)fail(400,'员工姓名为必填');if(password.length<8)fail(400,'初始密码至少8位');if(!roles.length)fail(400,'至少选择一个角色');
    try{const r=db.prepare('INSERT INTO users(username,password_hash,display_name,roles,active) VALUES(?,?,?,?,1)').run(username,hashPassword(password),displayName,roles.join(','));audit(db,user.id,'admin.user.create','user',r.lastInsertRowid,null,{username,roles});return json(res,201,{id:Number(r.lastInsertRowid)});}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'员工账号已存在');throw e;}
  }
  m=p.match(/^\/api\/admin\/users\/(\d+)$/);
  if(m&&req.method==='PUT'){
    svc.requireRole(user,'manager');const id=Number(m[1]);const target=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!target)fail(404,'员工账号不存在');const b=await readBody(req);const displayName=String(b.displayName||'').trim();const roles=normalizedRoles(b.roles);const active=b.active===false||b.active===0||b.active==='0'?0:1;const password=String(b.password||'');
    if(!displayName)fail(400,'员工姓名为必填');if(!roles.length)fail(400,'至少选择一个角色');if(password&&password.length<8)fail(400,'新密码至少8位');if(id===user.id&&!active)fail(400,'不能停用当前登录账号');
    if((!active||!roles.includes('manager'))&&svc.rolesOf(target).includes('manager')){const other=db.prepare("SELECT COUNT(*) count FROM users WHERE active=1 AND id<>? AND (','||roles||',') LIKE '%,manager,%'").get(id).count;if(!other)fail(400,'系统必须保留至少一个启用的负责人账号');}
    db.exec('BEGIN');try{if(password){db.prepare('UPDATE users SET display_name=?,roles=?,active=?,password_hash=? WHERE id=?').run(displayName,roles.join(','),active,hashPassword(password),id);db.prepare('DELETE FROM sessions WHERE user_id=? AND user_id<>?').run(id,user.id);}else db.prepare('UPDATE users SET display_name=?,roles=?,active=? WHERE id=?').run(displayName,roles.join(','),active,id);audit(db,user.id,'admin.user.update','user',id,null,{roles,active,passwordReset:Boolean(password)});db.exec('COMMIT');return json(res,200,{ok:true});}catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(p==='/api/admin/chairs'&&req.method==='POST'){
    svc.requireRole(user,'manager');const b=await readBody(req);const code=String(b.code||'').trim().toUpperCase();const name=String(b.name||'').trim();if(!code||!name)fail(400,'牙椅编码和名称为必填');try{const r=db.prepare('INSERT INTO chairs(code,name,active) VALUES(?,?,1)').run(code,name);audit(db,user.id,'admin.chair.create','chair',r.lastInsertRowid,null,{code});return json(res,201,{id:Number(r.lastInsertRowid)});}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'牙椅编码已存在');throw e;}
  }
  m=p.match(/^\/api\/admin\/chairs\/(\d+)$/);
  if(m&&req.method==='PUT'){
    svc.requireRole(user,'manager');const id=Number(m[1]);const chair=db.prepare('SELECT * FROM chairs WHERE id=?').get(id);if(!chair)fail(404,'牙椅不存在');const b=await readBody(req);const name=String(b.name||'').trim();const active=b.active===false||b.active===0||b.active==='0'?0:1;if(!name)fail(400,'牙椅名称为必填');if(!active){const future=db.prepare("SELECT COUNT(*) count FROM appointments WHERE chair_id=? AND julianday(start_at)>julianday('now') AND status IN ('pending','confirmed','arrived','waiting','in_treatment')").get(id).count;if(future)fail(409,'该牙椅仍有未来有效预约，不能停用');}db.prepare('UPDATE chairs SET name=?,active=? WHERE id=?').run(name,active,id);audit(db,user.id,'admin.chair.update','chair',id,null,{active});return json(res,200,{ok:true});
  }
  if(p==='/api/admin/services'&&req.method==='POST'){
    svc.requireRole(user,'manager');const b=await readBody(req);const code=String(b.code||'').trim().toUpperCase(),name=String(b.name||'').trim(),unit=String(b.unit||'项').trim();const duration=Number(b.defaultDuration);
    if(!code||!name||!unit||!Number.isSafeInteger(duration)||duration<=0)fail(400,'项目编号、名称、单位和有效时长为必填');
    if(b.currentPrice!=null&&Number(b.currentPrice)!==0)fail(409,'新项目价目请由收费人员依据负责人确认内容维护');
    try{const r=db.prepare('INSERT INTO services(code,name,unit,default_duration,current_price,active) VALUES(?,?,?,?,0,1)').run(code,name,unit,duration);audit(db,user.id,'admin.service.create','service',r.lastInsertRowid,null,{code,name,unit});return json(res,201,{id:Number(r.lastInsertRowid)});}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'项目编号已存在');throw e;}
  }
  m=p.match(/^\/api\/admin\/services\/(\d+)$/);
  if(m&&req.method==='PUT'){
    svc.requireRole(user,'manager');const id=Number(m[1]),b=await readBody(req),item=db.prepare('SELECT * FROM services WHERE id=?').get(id);if(!item)fail(404,'服务项目不存在');
    const name=String(b.name||'').trim(),unit=String(b.unit||item.unit).trim(),duration=Number(b.defaultDuration),active=[false,0,'0'].includes(b.active)?0:1;
    if(!name||!unit||!Number.isSafeInteger(duration)||duration<=0)fail(400,'项目名称、单位及有效时长为必填');
    if(b.currentPrice!=null&&Number(b.currentPrice)!==item.current_price)fail(409,'价目须由收费人员在价目页面维护');
    db.prepare('UPDATE services SET name=?,unit=?,default_duration=?,active=? WHERE id=?').run(name,unit,duration,active,id);audit(db,user.id,'admin.service.update','service',id,null,{name,unit,active});return json(res,200,{ok:true});
  }
  m=p.match(/^\/api\/admin\/clinic-hours\/(\d)$/);
  if(m&&req.method==='PUT'){
    svc.requireRole(user,'manager');const weekday=Number(m[1]);const b=await readBody(req);const openTime=String(b.openTime||'');const closeTime=String(b.closeTime||'');const active=b.active===false||b.active===0||b.active==='0'?0:1;if(!/^\d{2}:\d{2}$/.test(openTime)||!/^\d{2}:\d{2}$/.test(closeTime)||closeTime<=openTime)fail(400,'营业开始和结束时间无效');const future=db.prepare(`SELECT appointment_no FROM appointments WHERE julianday(start_at)>julianday('now') AND status IN ('pending','confirmed','arrived','waiting','in_treatment') AND CAST(strftime('%w',start_at,'localtime') AS INTEGER)=? AND (?=0 OR time(start_at,'localtime')<? OR time(end_at,'localtime')>?) LIMIT 1`).get(weekday,active,openTime,closeTime);if(future)fail(409,`该日仍有未来预约${future.appointment_no}，请先改期或取消`);db.prepare(`INSERT INTO clinic_hours(weekday,open_time,close_time,active) VALUES(?,?,?,?) ON CONFLICT(weekday) DO UPDATE SET open_time=excluded.open_time,close_time=excluded.close_time,active=excluded.active`).run(weekday,openTime,closeTime,active);audit(db,user.id,'admin.hours.update','clinic_hours',weekday,null,{openTime,closeTime,active});return json(res,200,{ok:true});
  }
  if(p==='/api/admin/dentist-schedules'&&req.method==='POST') return json(res,200,workflows.saveSchedule(db,await readBody(req),user));
  if(p==='/api/admin/leaves'&&req.method==='POST'){
    svc.requireRole(user,'manager');const b=await readBody(req);const userId=Number(b.userId);const start=new Date(b.startAt);const end=new Date(b.endAt);const reason=String(b.reason||'').trim();if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(userId))fail(400,'员工不存在或未启用');if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)fail(400,'请假开始和结束时间无效');if(!reason)fail(400,'请假原因必填');const conflict=db.prepare("SELECT appointment_no,start_at FROM appointments WHERE dentist_id=? AND status IN ('pending','confirmed','arrived','waiting','in_treatment') AND start_at<? AND end_at>? LIMIT 1").get(userId,end.toISOString(),start.toISOString());if(conflict)fail(409,`请假时段已有预约${conflict.appointment_no}，请先改期或取消`);const r=db.prepare('INSERT INTO staff_leaves(user_id,start_at,end_at,reason,status,created_by) VALUES(?,?,?,?,\'approved\',?)').run(userId,start.toISOString(),end.toISOString(),reason,user.id);audit(db,user.id,'admin.leave.create','staff_leave',r.lastInsertRowid,null,{userId,startAt:start.toISOString(),endAt:end.toISOString()});return json(res,201,{id:Number(r.lastInsertRowid)});
  }
  m=p.match(/^\/api\/admin\/leaves\/(\d+)$/);
  if(m&&req.method==='PUT'){svc.requireRole(user,'manager');const id=Number(m[1]);const leave=db.prepare('SELECT * FROM staff_leaves WHERE id=?').get(id);if(!leave)fail(404,'请假记录不存在');const b=await readBody(req);if(b.status!=='cancelled')fail(400,'请假记录只能撤销');db.prepare("UPDATE staff_leaves SET status='cancelled' WHERE id=?").run(id);audit(db,user.id,'admin.leave.cancel','staff_leave',id,null,null);return json(res,200,{ok:true});}

  if(p==='/api/reports/summary'&&req.method==='GET'){svc.requireRole(user,'manager','cashier');return json(res,200,requirements.reportSummary(db,url.searchParams.get('from')||isoDay(new Date(Date.now()-30*86400000)),url.searchParams.get('to')||isoDay()));}
  if(p==='/api/audit'&&req.method==='GET'){svc.requireRole(user,'manager');const rows=db.prepare(`SELECT a.*,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all();return json(res,200,{events:rows});}
  fail(404,'接口不存在');
}

function serveStatic(req,res,url){
  const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
  const file=path.normalize(path.join(PUBLIC,rel));
  if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) return false;
  const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':['.html','.js'].includes(ext)?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);return true;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  try{
    if(url.pathname.startsWith('/api/')) await api(req,res,url);
    else if(!serveStatic(req,res,url)) {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('页面不存在');}
  }catch(e){
    const trace=crypto.randomBytes(4).toString('hex');if(!e.status||e.status>=500)console.error(`[${trace}]`,e);
    if(url.pathname.startsWith('/api/')) json(res,e.status||500,{error:e.status?e.message:'系统暂时无法完成操作',trace,...(e.conflict?{conflict:e.conflict}:{}),...(e.duplicates?{duplicates:e.duplicates}:{})});
    else {res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end(`系统错误，追踪编号：${trace}`);}
  }
});

if(require.main===module){server.listen(PORT,'127.0.0.1',()=>console.log(`Dental clinic system: http://127.0.0.1:${PORT}`));}
module.exports={server,db};
