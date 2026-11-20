'use strict';
// Local development API for an explicitly opened chain workspace only.
// It is not the production server and has no patient self-service or payment integration.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fail,hash}=require('./common');
const {hasBranchRole}=require('./chain-access');
const {ChainAuth}=require('./chain-auth');
function json(res,status,value,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));}
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'TOO_LARGE','提交内容过大');chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','提交内容不是有效 JSON');}if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_JSON','提交内容应为对象');return value;}
function createWorkspaceServer(workspace){
 const {db,auth}=workspace;
 const server=http.createServer(async(req,res)=>{try{
  const address=server.address(),expected='127.0.0.1:'+address.port;if(req.headers.host!==expected)fail(403,'HOST_INVALID','仅允许本机地址访问');
  if(req.headers.origin&&req.headers.origin!=='http://'+expected)fail(403,'ORIGIN_INVALID','请求来源无效');
  const url=new URL(req.url,'http://'+expected),p=url.pathname;
  const files={'/':['index.html','text/html'], '/workspace.css':['workspace.css','text/css'], '/workspace.js':['workspace.js','text/javascript']};
  if(req.method==='GET'&&Object.hasOwn(files,p)){const [name,type]=files[p];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});return res.end(fs.readFileSync(path.resolve(__dirname,'../../public/chain-workspace',name)));}
  if(req.method==='GET'&&p==='/api/status')return json(res,200,{application:'qinghe-chain-workspace',mode:'development-only',businessTime:auth.now(),notice:'迁移工作副本，不能用于正式业务'});
  if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail(415,'CONTENT_TYPE','请使用 JSON 请求');
  if(req.method==='POST'&&p==='/api/login'){const login=auth.login(await body(req));return json(res,200,{user:login.user,csrf:login.csrf},{'Set-Cookie':`chain_workspace_session=${login.token}; HttpOnly; SameSite=Strict; Path=/`});}
  const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('chain_workspace_session='))?.slice('chain_workspace_session='.length),credentials={token,role:req.headers['x-clinic-role'],csrf:req.headers['x-csrf-token']};
  if(req.method==='POST'&&!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(req.method==='POST'&&p==='/api/logout'){const session=auth.session(token);if(hash(String(credentials.csrf))!==session.csrf_hash)fail(403,'CSRF_INVALID','安全令牌无效');auth.logout(token);return json(res,200,{ok:true},{'Set-Cookie':'chain_workspace_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
  if(req.method==='GET'&&p==='/api/branches'){
   const s=auth.session(token),map={manager:'branch_manager',frontdesk:'frontdesk',dentist:'dentist',cashier:'cashier',assistant:'assistant',pharmacist:'pharmacist'},role=map[credentials.role],now=auth.now();
   if(!role||!auth.roles(s.account_id,now).some(r=>r.code===credentials.role))fail(403,'FORBIDDEN','当前岗位不可用');
   const items=db.prepare("SELECT id,name FROM clinic_branch WHERE status='active' ORDER BY id").all().filter(b=>hasBranchRole(db,{staffId:s.staff_id,branchId:b.id,role,at:now}));return json(res,200,{items});
  }
  if(req.method==='GET'){
   const branch=Number(url.searchParams.get('branchId')),visit=Number(url.searchParams.get('visitId')),patient=Number(url.searchParams.get('patientId'));
   if(p==='/api/reception/options'){
    if(credentials.role!=='frontdesk')fail(403,'FORBIDDEN','需要前台岗位');db.exec('BEGIN');try{const ctx=new ChainAuth(auth).authorizeBranch(credentials,'uc02.query',branch);ctx.authority={...ctx.authority,branchId:branch};
     const schedules=db.prepare("SELECT s.id,s.revision,s.starts_at,s.ends_at,d.name dentist_name,c.name chair_name FROM dated_schedule s JOIN staff d ON d.id=s.dentist_id JOIN dental_chair c ON c.id=s.dental_chair_id WHERE s.branch_id=? AND c.branch_id=s.branch_id AND s.status='已确认' ORDER BY s.starts_at").all(branch);
     const patients=db.prepare('SELECT id,name,record_no FROM patient ORDER BY id LIMIT 500').all(),appointments=db.prepare(`SELECT a.id,a.patient_id,a.planned_start,a.planned_end,a.status,a.revision,p.name patient_name,p.record_no patient_no,o.revision occupancy_revision,s.revision schedule_revision,s.dentist_id FROM appointment a JOIN patient p ON p.id=a.patient_id LEFT JOIN resource_occupancy o ON o.appointment_id=a.id AND o.released_at IS NULL LEFT JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE a.branch_id=? ORDER BY a.planned_start DESC LIMIT 500`).all(branch);
     workspace.unit.audit(ctx,'查询','WORKSPACE_RECEPTION_OPTIONS',{kind:'branch_reception_query',key:'branch:'+branch},null,'查询本店预约与排班');db.exec('COMMIT');return json(res,200,{schedules,patients,appointments});
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
   }
   if(p==='/api/patients')return json(res,200,workspace.setup.patients(credentials,branch));
   if(p==='/api/schedules')return json(res,200,workspace.setup.options(credentials,branch));
   if(p==='/api/doctor/visits'){
    if(credentials.role!=='dentist')fail(403,'FORBIDDEN','需要牙医岗位');db.exec('BEGIN');try{const ctx=new ChainAuth(auth).authorizeBranch(credentials,'uc09.query',branch);ctx.authority={...ctx.authority,branchId:branch};const visits=db.prepare("SELECT v.id,v.patient_id,v.record_no,v.status,v.revision,v.arrived_at,o.revision occupancy_revision,p.name patient_name,p.record_no patient_no FROM visit v JOIN patient p ON p.id=v.patient_id LEFT JOIN resource_occupancy o ON o.visit_id=v.id AND o.released_at IS NULL WHERE v.branch_id=? AND v.dentist_id=? AND v.status IN ('候诊','接诊中','诊疗结束') ORDER BY v.arrived_at DESC LIMIT 500").all(branch,ctx.session.staff_id);workspace.unit.audit(ctx,'查询','WORKSPACE_DOCTOR_VISITS',{kind:'branch_visit_query',key:'branch:'+branch},null,'查询本店本人就诊');db.exec('COMMIT');return json(res,200,{visits});}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
   }
   if(p==='/api/followups')return json(res,200,workspace.followup.list(credentials,branch));
   if(p==='/api/transfer-proposals')return json(res,200,workspace.transfer.list(credentials,branch));
   if(p==='/api/fee-requests')return json(res,200,workspace.prepay.list(credentials,branch,url.searchParams.has('patientId')?patient:null));
   if(p==='/api/finance')return json(res,200,workspace.finance.query(credentials,{branchId:branch,patientId:patient}));
   if(p==='/api/record/draft')return json(res,200,workspace.record.detail(credentials,branch,visit));
   if(p==='/api/record/health')return json(res,200,workspace.healthSign.detail(credentials,branch,visit));
   if(p==='/api/plans')return json(res,200,workspace.plan.list(credentials,branch,visit));
   if(p==='/api/plans/options'){
    if(credentials.role!=='dentist')fail(403,'FORBIDDEN','需要牙医岗位');db.exec('BEGIN');try{const ctx=new ChainAuth(auth).authorizeBranch(credentials,'uc22.plan',branch);ctx.authority={...ctx.authority,branchId:branch};const services=db.prepare('SELECT id,name,billing_unit,record_no FROM service WHERE is_active=1 ORDER BY name,id').all();workspace.unit.audit(ctx,'查询','WORKSPACE_PLAN_OPTIONS',{kind:'branch_plan_options',key:'branch:'+branch},null,'查询治疗方案项目');db.exec('COMMIT');return json(res,200,{services});}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
   }
   if(p==='/api/quotes')return json(res,200,workspace.quote.list(credentials,branch));
   if(p==='/api/prescriptions')return json(res,200,workspace.prescription.query(credentials,{branchId:branch,visitId:visit,patientId:patient}));
   if(p==='/api/approvals')return json(res,200,workspace.approval.list(credentials,branch));
   if(p==='/api/approvals/options')return json(res,200,workspace.crossOptions.forManager(credentials,branch));
   if(p==='/api/clinical/grants')return json(res,200,workspace.crossOptions.forDentist(credentials,branch));
   if(p==='/api/inventory')return json(res,200,workspace.inventory.list(credentials,branch));
   if(p==='/api/purchases')return json(res,200,workspace.purchases.list(credentials,branch));
   if(p==='/api/prices')return json(res,200,workspace.prices.list(credentials,branch));
   if(p==='/api/prices/pending')return json(res,200,workspace.pendingPrices.list(credentials,branch));
   if(p==='/api/resources')return json(res,200,workspace.resources.list(credentials,branch));
   if(p==='/api/day-close')return json(res,200,workspace.dayClose.preview(credentials,branch,url.searchParams.get('channel')));
  }
  if(req.method==='POST'){
   const routes={'/api/setup':v=>workspace.setup.command(credentials,v),'/api/reception':v=>workspace.reception.command(credentials,v),'/api/followups':v=>workspace.followup.command(credentials,v),'/api/transfer-proposals':v=>workspace.transfer.command(credentials,v),'/api/grants':v=>workspace.grants.command(credentials,v),'/api/approvals':v=>workspace.approval.command(credentials,v),'/api/record/draft':v=>workspace.record.save(credentials,v),'/api/treatment/start':v=>workspace.startVisit.start(credentials,v),'/api/treatment/check':v=>workspace.treatment.execute(credentials,v),'/api/treatment/correct':v=>workspace.treatment.correct(credentials,v),'/api/plans':v=>workspace.plan.command(credentials,v),'/api/quotes':v=>workspace.quote.command(credentials,v),'/api/prescriptions':v=>workspace.prescription.write(credentials,v),'/api/finance/payment':v=>workspace.cash.receive(credentials,v),'/api/clinical':v=>workspace.clinical.read(credentials,v)};
   Object.assign(routes,{'/api/fee-requests':v=>workspace.prepay.command(credentials,v),'/api/record/health':v=>workspace.healthSign.command(credentials,v),'/api/record/addendum':v=>workspace.addendum.append(credentials,v),'/api/inventory/issue':v=>workspace.inventory.issue(credentials,v),'/api/inventory/batch':v=>workspace.inventory.batch(credentials,v),'/api/inventory/count':v=>workspace.inventory.count(credentials,v),'/api/purchases':v=>workspace.purchases.command(credentials,v),'/api/prices':v=>workspace.prices.command(credentials,v),'/api/prices/pending':v=>workspace.pendingPrices.price(credentials,v),'/api/resources':v=>workspace.resources.command(credentials,v),'/api/day-close':v=>workspace.dayClose.record(credentials,v)});
   if(Object.hasOwn(routes,p))return json(res,200,await routes[p](await body(req)));
  }
  return json(res,404,{code:'NOT_FOUND',message:'工作副本接口不存在'});
 }catch(error){return json(res,error.status&&error.status<500?error.status:500,{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'工作副本请求未完成'});}});
 return server;
}
module.exports={createWorkspaceServer};
