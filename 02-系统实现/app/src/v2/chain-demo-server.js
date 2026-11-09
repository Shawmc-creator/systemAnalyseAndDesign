'use strict';
// Separate in-memory API demonstration. The original single-store server and
// all disk databases are intentionally outside this prototype.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createApplication}=require('./server');
const {installTrialSchema}=require('./chain-schema-trial');
const {ChainReceptionTrial}=require('./chain-reception-trial');
const {ChainApprovalTrial}=require('./chain-approval-trial');
const {ChainGrantsTrial}=require('./chain-grants-trial');
const {ChainClinicalQuery}=require('./chain-clinical-query');
const {ChainAuth}=require('./chain-auth');
const {ChainFinanceQuery}=require('./chain-finance-query');
const {assertBillScope}=require('./chain-finance-query');
const {ChainCashTrial}=require('./chain-cash-trial');
const {rebuildTrialUniqueConstraints}=require('./chain-unique-trial');
const {installTrialPriceConstraints}=require('./chain-price-constraints-trial');
const {ChainPriceTrial}=require('./chain-price-trial');
const {ChainTreatmentTrial}=require('./chain-treatment-trial');
const {ChainPendingPriceTrial}=require('./chain-pending-price-trial');
const {ChainCrossBranchOptions}=require('./chain-cross-branch-options');
const {ChainStartVisitTrial}=require('./chain-start-visit-trial');
const {ChainRecordTrial}=require('./chain-record-trial');
const {ChainResourcesTrial}=require('./chain-resources-trial');
const {ChainHealthSignTrial}=require('./chain-health-sign-trial');
const {ChainAddendumTrial}=require('./chain-addendum-trial');
const {ChainFollowupTrial}=require('./chain-followup-trial');
const {ChainInventoryTrial}=require('./chain-inventory-trial');
const {ChainPurchaseTrial}=require('./chain-purchase-trial');
const {ChainDashboardTrial}=require('./chain-dashboard-trial');
const {ChainSetupTrial}=require('./chain-setup-trial');
const {ChainPlanTrial}=require('./chain-plan-trial');
const {ChainQuoteTrial}=require('./chain-quote-trial');
const {ChainPrepayTrial}=require('./chain-prepay-trial');
const {ChainPrescriptionTrial}=require('./chain-prescription-trial');
const {ChainDocumentsTrial}=require('./chain-documents-trial');
const {MAX_FILE_BYTES}=require('./document-store');
const {ChainDemoSnapshot}=require('./chain-demo-snapshot');
const {insert,fact,day,fail,hash}=require('./common');
const {encodePassword,checkPassword}=require('./auth');

const CHAIN_DEMO_BUILD='20261109-01';
function createChainDemo({snapshotPath=null,runtimeClock=null}={}){
 if(runtimeClock!==null&&typeof runtimeClock!=='function')throw new Error('运行时钟必须是函数');
 const demoNow='2026-10-19T01:35:00Z';
 let demoClock='2026-10-19T01:00:00Z';
 let initialized=false;
 const app=createApplication({demo:true,clock:()=>initialized&&runtimeClock?runtimeClock():new Date(demoClock),attachmentDir:snapshotPath?snapshotPath+'.files':null,integrationSimulation:true,insurancePolicy:{enabled:true,institutionCode:'DEMO-ONLY',verificationBasis:'虚构演示机构',verifiedBy:'演示负责人',validFrom:'2026-10-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'}}),db=app.db;
 // Seed a real in-memory walk-in and draft using the existing single-store
 // application, before introducing candidate branch fields.
 const managerLogin=app.auth.login({username:'manager',password:'Clinic123!'}),frontLogin=app.auth.login({username:'frontdesk',password:'Clinic123!'}),dentistLogin=app.auth.login({username:'dentist',password:'Clinic123!'}),cashierLogin=app.auth.login({username:'cashier',password:'Clinic123!'}),assistantLogin=app.auth.login({username:'assistant',password:'Clinic123!'});
 const credentials=(login,role)=>({token:login.token,csrf:login.csrf,role});
 const m=credentials(managerLogin,'manager'),f=credentials(frontLogin,'frontdesk'),d=credentials(dentistLogin,'dentist'),c=credentials(cashierLogin,'cashier'),a=credentials(assistantLogin,'assistant');
 const cmd=(requestKey,fields)=>({requestKey,commandVersion:1,...fields});
 const today=day(demoNow),dentistId=dentistLogin.user.staffId;
 const todaySchedule=app.reception.schedule(m,cmd('chain-demo-today-schedule',{action:'publish',dentistId,chairId:1,businessDate:today,
  startsAt:today+'T09:00:00+08:00',endsAt:today+'T18:00:00+08:00',reason:'虚构演示接诊安排'}));
 const secondSchedule=app.reception.schedule(m,cmd('chain-demo-branch2-schedule',{action:'publish',dentistId:managerLogin.user.staffId,chairId:2,businessDate:today,
  startsAt:today+'T09:00:00+08:00',endsAt:today+'T18:00:00+08:00',reason:'虚构二店当日排班'}));
 const sameDayAppointment=app.reception.appointment(f,cmd('chain-demo-arrival-appointment',{action:'create',patientId:2,scheduleId:secondSchedule.id,scheduleRevision:secondSchedule.revision,
  startsAt:today+'T09:30:00+08:00',endsAt:today+'T10:00:00+08:00',reason:'虚构二店预约到诊'}));
 demoClock=demoNow;
 const visit=app.reception.arrive(f,cmd('chain-demo-visit',{patientId:1,dentistId,scheduleId:todaySchedule.id,scheduleRevision:todaySchedule.revision,
  startsAt:demoNow,endsAt:'2026-10-19T02:05:00Z',arrivedAt:demoNow}));
 app.clinical.record(d,cmd('chain-demo-start',{action:'start',visitId:visit.id,expectedVisitRevision:1,startedAt:demoNow}));
 const record=db.prepare('SELECT id,revision FROM clinical_record WHERE visit_id=?').get(visit.id);
 app.clinical.record(d,cmd('chain-demo-record',{action:'save',visitId:visit.id,recordId:record.id,expectedRevision:record.revision,
  chiefComplaint:'虚构演示：牙齿敏感',diagnosis:'虚构演示：待进一步检查',treatmentAdvice:'演示：由牙医核实后制定方案',findings:[{text:'虚构演示：口腔检查所见'}]}));
 const item=app.billing.draft(c,cmd('chain-demo-service',{action:'service',name:'虚构演示口腔检查',billingUnit:'次',reason:'演示目录'}));
 app.billing.draft(c,cmd('chain-demo-unpriced-service',{action:'service',name:'虚构演示专项检查（待定价）',billingUnit:'次',reason:'演示待核价流程'}));
 const price=app.billing.draft(c,cmd('chain-demo-price',{action:'draft',serviceId:item.id,unitPriceCents:20000,validFrom:'2026-10-19T00:00:00+08:00',reason:'演示价目'}));
 app.billing.draft(c,cmd('chain-demo-price-submit',{action:'submit',priceId:price.id,expectedRevision:1}));
 app.billing.approve(m,cmd('chain-demo-price-approve',{action:'approve',priceId:price.id,expectedRevision:2,reviewNote:'虚构演示价目'}));
 app.treatment.execute(d,cmd('chain-demo-execution',{visitId:visit.id,patientId:1,expectedVisitRevision:2,serviceId:item.id,quantity:1,
  completedAt:demoNow,procedureNote:'虚构演示：完成口腔检查',independentCheck:true,independentBasis:'演示：检查记录'}));
 const material=app.inventory.record(a,cmd('chain-demo-material',{action:'material',name:'虚构演示一次性手套',specification:'中号',baseUnit:'个',purchaseUnit:'盒',conversionNumerator:100,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,reason:'演示统一材料目录'}));
 app.inventory.approve(m,cmd('chain-demo-confirm-material',{action:'confirmMaterial',materialId:material.id,expectedRevision:1,reason:'演示核实单位'}));
 const drug=app.inventory.record(a,cmd('chain-demo-drug',{action:'material',name:'虚构演示药品（非真实药物）',specification:'仅用于流程展示',baseUnit:'片',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,isDrug:true,reason:'虚构演示药品目录'}));
 app.inventory.approve(m,cmd('chain-demo-confirm-drug',{action:'confirmMaterial',materialId:drug.id,expectedRevision:1,reason:'虚构演示药品核对'}));
 const drug2=app.inventory.record(a,cmd('chain-demo-drug-2',{action:'material',name:'虚构演示药品二（非真实药物）',specification:'仅用于流程展示',baseUnit:'粒',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,isDrug:true,reason:'虚构演示药品目录'}));
 app.inventory.approve(m,cmd('chain-demo-confirm-drug-2',{action:'confirmMaterial',materialId:drug2.id,expectedRevision:1,reason:'虚构演示药品核对'}));
 const supplier=app.purchases.supplier(m,cmd('chain-demo-supplier',{name:'虚构演示供应商',contactName:'演示联系人',phone:'13800000003',settlementBasis:'仅供演示',isActive:true,reason:'演示供应商'}));
 function seedStock(branch,quantity){
  const location=app.inventory.record(a,cmd('chain-demo-location-'+branch,{action:'location',name:branch+'店演示材料库',purpose:'虚构耗材储存',reason:'演示库位'}));
  const batch=app.inventory.record(a,cmd('chain-demo-batch-'+branch,{action:'batch',materialId:material.id,batchNo:'DEMO-'+branch,expiryDate:'2027-10-19',sourceNote:'虚构演示供货批次'}));
  const purchase=app.purchases.draft(a,cmd('chain-demo-purchase-'+branch,{action:'create',supplierId:supplier.id,expectedSupplierRevision:1,agreedAt:demoNow,deliveryTerms:'虚构演示验收',reason:'虚构演示采购',items:[{materialId:material.id,expectedMaterialRevision:2,orderedQuantityScaled:quantity,unitPriceCents:1000}]}));
  app.purchases.approve(m,cmd('chain-demo-purchase-approve-'+branch,{action:'approve',purchaseId:purchase.id,expectedRevision:1,expectedSupplierRevision:1,reviewNote:'演示确认采购'}));
  const orderItem=db.prepare('SELECT id,revision FROM purchase_order_item WHERE purchase_order_id=?').get(purchase.id);
  app.purchases.receive(a,cmd('chain-demo-receive-'+branch,{action:'receive',purchaseId:purchase.id,expectedPurchaseRevision:2,arrivedAt:demoNow,deliveryEvidence:'虚构演示随货单-'+branch,
   items:[{purchaseItemId:orderItem.id,expectedItemRevision:orderItem.revision,batchId:batch.id,locationId:location.id,arrivedQuantityScaled:quantity,acceptedQuantityScaled:quantity,rejectedQuantityScaled:0,pendingQuantityScaled:0,inspectionNote:'虚构逐项验收'}]}));
  app.inventory.approve(m,cmd('chain-demo-release-'+branch,{action:'release',batchId:batch.id,expectedRevision:1,reason:'演示核实批次'}));
  return {location:location.id,batch:batch.id,purchase:purchase.id};
 }
 const stockA=seedStock(1,100),stockB=seedStock(2,60);
 const billData=app.billing.query(c,{patientId:1}),bill=billData.items[0];
 const pendingPayment=app.payments.receive(c,cmd('chain-demo-payment',{action:'receive',patientId:1,expectedFundsRevision:billData.funds.revision,receivedCents:10000,changeCents:0,
  channel:'现金',verification:'pending',transactionEvidence:'虚构演示：等待核对系统外收款'}));
 installTrialSchema(db,{includeBusinessFields:true});
 db.exec(`INSERT INTO clinic_chain(id,name) VALUES(1,'演示连锁');
 INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店（演示）'),(2,1,'B','二店（演示）'),(3,1,'C','三店（演示）');
 UPDATE dental_chair SET branch_id=CASE id WHEN 1 THEN 1 ELSE 2 END;
 UPDATE clinical_equipment SET branch_id=1; UPDATE dated_schedule SET branch_id=CASE WHEN id=${secondSchedule.id} THEN 2 ELSE 1 END;
 UPDATE appointment SET branch_id=CASE WHEN id=${sameDayAppointment.id} THEN 2 ELSE 1 END; UPDATE visit SET branch_id=1;
 UPDATE bill SET branch_id=1; UPDATE patient_funds SET branch_id=1; UPDATE patient_payment SET branch_id=1; UPDATE service_price SET branch_id=1;
 UPDATE stock_location SET branch_id=CASE id WHEN ${stockA.location} THEN 1 WHEN ${stockB.location} THEN 2 END;
 UPDATE material_batch SET branch_id=CASE id WHEN ${stockA.batch} THEN 1 WHEN ${stockB.batch} THEN 2 END;
 UPDATE purchase_order SET branch_id=CASE id WHEN ${stockA.purchase} THEN 1 WHEN ${stockB.purchase} THEN 2 END;`);
 // The single-store seed predates branch fields. Backfill only its known
 // execution while constructing the isolated in-memory seed, then restore the
 // immutable-fact trigger before any snapshot or external request is served.
 const executionFreeze=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='tr_treatment_execution_immutable_fact_update' AND tbl_name='treatment_execution'").get()?.sql;
 const expectedFreeze=`CREATE TRIGGER "tr_treatment_execution_immutable_fact_update" BEFORE UPDATE ON "treatment_execution" WHEN ((1) AND 1) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END`;
 if(executionFreeze!==expectedFreeze)throw new Error('演示初始化的诊疗事实保护不符合预期');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('DROP TRIGGER tr_treatment_execution_immutable_fact_update');
  const result=db.prepare('UPDATE treatment_execution SET branch_id=? WHERE visit_id=? AND branch_id IS NULL').run(1,visit.id);
  if(result.changes!==1)throw new Error('演示初始化的诊疗来源数量不符合预期');
  db.exec(executionFreeze);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 const currentBill=app.billing.query(c,{patientId:1});
 app.payments.receive(c,cmd('chain-demo-payment-confirm',{action:'verify',patientId:1,expectedFundsRevision:currentBill.funds.revision,
  paymentId:pendingPayment.id,expectedPaymentRevision:1,outcome:'received',receivedAt:demoNow,transactionEvidence:'虚构演示：系统外收款已核对',keepAsPrepayment:true,
  allocations:[{billId:bill.id,expectedRevision:currentBill.items[0].revision,amountCents:10000,reason:'虚构演示付款分配'}]}));
 for(const login of [managerLogin,frontLogin,dentistLogin,cashierLogin,assistantLogin])app.auth.logout(login.token);
 rebuildTrialUniqueConstraints(db);
 installTrialPriceConstraints(db);
 const now=app.auth.now(), staff=Object.fromEntries(db.prepare('SELECT login_name,staff_id FROM user_account').all().map(x=>[x.login_name,x.staff_id]));
 // assistant / manager represents a second, separately authenticated manager
 // in branch 2; it is not a claim of real-world professional qualification.
 const assistant=db.prepare("SELECT id,staff_id FROM user_account WHERE login_name='assistant'").get(),managerAccount=db.prepare("SELECT id FROM user_account WHERE login_name='manager'").get();
 const managerRole=db.prepare("SELECT id FROM access_role WHERE code='manager'").get().id;
 const qualification=insert(db,'staff_role_qualification',{staff_id:assistant.staff_id,role_id:managerRole,valid_from:now,valid_until:null,
  verified_by:staff.manager,verification_basis:'虚构演示资格',revoked_at:null,revoked_by:null,revocation_reason:null,created_at:now});
 insert(db,'account_role',{account_id:assistant.id,role_id:managerRole,qualification_id:qualification,granted_by:managerAccount.id,granted_at:now,
  valid_until:null,grant_reason:'虚构演示岗位',revoked_by:null,revoked_at:null,revocation_reason:null});
 const grant=db.prepare('INSERT INTO branch_staff_role(branch_id,staff_id,role_code,valid_from,granted_by,granted_at,evidence) VALUES(?,?,?,?,?,?,?)');
 for(const branch of [1,2,3]){
  grant.run(branch,staff.manager,'branch_manager',now,staff.manager,now,'仅供虚构演示');
  grant.run(branch,staff.frontdesk,'frontdesk',now,staff.manager,now,'仅供虚构演示');
  grant.run(branch,staff.cashier,'cashier',now,staff.manager,now,'仅供虚构演示');
  grant.run(branch,staff.assistant,'assistant',now,staff.manager,now,'仅供虚构演示');
 }
 grant.run(1,staff.dentist,'dentist',now,staff.manager,now,'仅供虚构演示');
 grant.run(2,staff.manager,'dentist','2026-10-19T01:00:00Z',staff.manager,now,'仅供虚构演示');
 grant.run(3,staff.dentist,'dentist',now,staff.manager,now,'仅供虚构演示');
 grant.run(2,staff.assistant,'branch_manager',now,staff.manager,now,'仅供虚构演示');
 const chair=insert(db,'dental_chair',fact(now,{name:'三店演示诊椅',available_from:now,available_until:null,created_by:staff.manager,record_no:'CHAIN-DEMO-CHAIR-3',branch_id:3}));
 const tomorrow=day(Date.parse(now)+86400000),following=day(Date.parse(now)+2*86400000);
 const schedule=(branch,dentist,chairId,date)=>insert(db,'dated_schedule',fact(now,{branch_id:branch,dentist_id:dentist,dental_chair_id:chairId,
  business_date:date,starts_at:new Date(date+'T09:00:00+08:00').toISOString().replace('.000Z','Z'),ends_at:new Date(date+'T18:00:00+08:00').toISOString().replace('.000Z','Z'),
  confirmed_at:now,closure_reason:null,created_by:staff.manager,confirmed_by:staff.manager,status:'已确认'}));
 schedule(2,staff.manager,2,tomorrow);schedule(3,staff.dentist,chair,following);
 let store=null;try{if(snapshotPath){store=new ChainDemoSnapshot(snapshotPath);store.initialize(db);}
  // Only migrate the original demo password; preserve independently changed credentials.
  const demoNames=['frontdesk','dentist','cashier','assistant','assistant2','manager'];
  const findAccount=db.prepare('SELECT id,password_hash FROM user_account WHERE login_name=?');
  const updateAccount=db.prepare('UPDATE user_account SET password_hash=?,auth_version=auth_version+1 WHERE id=?');
  db.exec('BEGIN');
  try{
   let changed=false;
   for(const name of demoNames){const account=findAccount.get(name);if(account&&checkPassword('Clinic123!',account.password_hash)){updateAccount.run(encodePassword('Clinic123'),account.id);changed=true;}}
   db.exec('COMMIT');
   if(changed&&store)store.save(db);
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 }catch(error){if(store)store.close();db.close();throw error;}
 initialized=true;
 const reception=new ChainReceptionTrial(app),approval=new ChainApprovalTrial(app),grants=new ChainGrantsTrial(app),clinical=new ChainClinicalQuery(app.auth,app.documentStore),finance=new ChainFinanceQuery(app),cash=new ChainCashTrial(app),prices=new ChainPriceTrial(app),treatment=new ChainTreatmentTrial(app),pendingPrices=new ChainPendingPriceTrial(app),crossOptions=new ChainCrossBranchOptions(app),startVisit=new ChainStartVisitTrial(app),recordTrial=new ChainRecordTrial(app),resourcesTrial=new ChainResourcesTrial(app),healthSign=new ChainHealthSignTrial(app,recordTrial),addendumTrial=new ChainAddendumTrial(app,recordTrial),followupTrial=new ChainFollowupTrial(app),inventoryTrial=new ChainInventoryTrial(app),purchaseTrial=new ChainPurchaseTrial(app),dashboard=new ChainDashboardTrial(app),setup=new ChainSetupTrial(app),planTrial=new ChainPlanTrial(app),quoteTrial=new ChainQuoteTrial(app),prepayTrial=new ChainPrepayTrial(app),prescriptionTrial=new ChainPrescriptionTrial(app),access=new ChainAuth(app.auth);
 const documentsTrial=new ChainDocumentsTrial(app);
 let persistenceFailed=false;
 const json=(res,status,value,extra={})=>{if(store&&!persistenceFailed){try{store.save(db);}catch(error){persistenceFailed=true;status=503;value={code:'SNAPSHOT_WRITE_FAILED',message:'演示数据保存失败，服务已停止；请检查磁盘后重新启动并核对操作结果。'};extra={};setImmediate(()=>server.close());}}res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(value));};
 const body=async(req,limit=65536)=>{let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>limit)fail(413,'TOO_LARGE','请求过大');chunks.push(c);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','请输入有效JSON');}if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_JSON','请求应为对象');return value;};
 const server=http.createServer(async(req,res)=>{
  try{
   if(persistenceFailed)fail(503,'SNAPSHOT_WRITE_FAILED','演示数据保存失败，请重新启动并核对操作结果');
   const url=new URL(req.url,'http://127.0.0.1'),origin=req.headers.origin,expected=`http://127.0.0.1:${server.address().port}`;
   if(origin&&origin!==expected)fail(403,'ORIGIN_INVALID','来源不允许');
   const staticFiles={'/':['chain-demo.html','text/html; charset=utf-8'],'/chain-demo.js':['chain-demo.js','text/javascript; charset=utf-8'],'/chain-demo.css':['chain-demo.css','text/css; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
   if(req.method==='GET'&&staticFiles[url.pathname]){
    const [name,type]=staticFiles[url.pathname];const root=name==='styles.css'?path.join(__dirname,'../../public/v2'):path.join(__dirname,'../../public/chain-demo');
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(name==='chain-demo.html'?fs.readFileSync(path.join(root,name),'utf8').replace('数据保存方式取决于启动方式',store?'重新启动后演示数据保留':'关闭服务后数据清除').replace('演示时间：2026 年 10 月 19 日 09:35。',runtimeClock?'演示使用当前系统时间。':'演示时间：2026 年 10 月 19 日 09:35。'):fs.readFileSync(path.join(root,name)));
   }
   if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{application:'qinghe-chain-demo',buildVersion:CHAIN_DEMO_BUILD,mode:store?'persistent-snapshot':'memory',clockMode:runtimeClock?'live':'fixed',businessTime:app.auth.now()});
   if(req.method==='POST'&&!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'CONTENT_TYPE','请求需使用JSON');
   if(req.method==='POST'&&url.pathname==='/api/login'){
    const login=app.auth.login(await body(req));return json(res,200,{user:login.user,csrf:login.csrf},{'Set-Cookie':`chain_demo_session=${login.token}; HttpOnly; SameSite=Strict; Path=/`});
   }
   const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('chain_demo_session='))?.slice('chain_demo_session='.length);
   const credentials={token,role:req.headers['x-clinic-role'],csrf:req.headers['x-csrf-token']};
   if(req.method==='POST'&&!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
   if(req.method==='POST'&&url.pathname==='/api/logout'){
    const session=app.auth.session(token);if(hash(String(credentials.csrf))!==session.csrf_hash)fail(403,'CSRF_INVALID','安全令牌无效');
    app.auth.logout(token);return json(res,200,{ok:true},{'Set-Cookie':'chain_demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
   }
   if(req.method==='GET'&&url.pathname==='/api/branches'){
    const session=app.auth.session(token),role=credentials.role;
    const roleMap={manager:'branch_manager',frontdesk:'frontdesk',dentist:'dentist',cashier:'cashier',assistant:'assistant'};
    if(!roleMap[role]||!app.auth.roles(session.account_id).some(r=>r.code===role))fail(403,'FORBIDDEN','岗位无效');
    const now=app.auth.now(),items=db.prepare(`SELECT DISTINCT b.id,b.name FROM clinic_branch b JOIN branch_staff_role r ON r.branch_id=b.id
     WHERE b.status='active' AND r.staff_id=? AND r.role_code=? AND r.valid_from<=? AND (r.valid_until IS NULL OR r.valid_until>?) AND (r.revoked_at IS NULL OR r.revoked_at>?) ORDER BY b.id`).all(session.staff_id,roleMap[role],now,now,now);
    return json(res,200,{items});
   }
   if(req.method==='GET'&&url.pathname==='/api/patients')return json(res,200,setup.patients(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='GET'&&url.pathname==='/api/schedules')return json(res,200,setup.options(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='GET'&&url.pathname==='/api/branch-staff'){
    const branch=Number(url.searchParams.get('branchId'));access.authorizeBranch(credentials,'clinic.manage',branch);
    const staff=db.prepare(`SELECT s.id,s.name,s.record_no,s.revision staff_revision,a.login_name,a.status account_status,r.id grant_id,r.role_code,r.valid_from,r.revoked_at FROM branch_staff_role r JOIN staff s ON s.id=r.staff_id LEFT JOIN user_account a ON a.staff_id=s.id WHERE r.branch_id=? ORDER BY s.id,r.id`).all(branch);const candidates=db.prepare("SELECT s.id,s.name,a.id account_id,a.login_name FROM staff s JOIN user_account a ON a.staff_id=s.id WHERE a.status='启用' ORDER BY s.id").all().map(s=>({id:s.id,name:s.name,login_name:s.login_name,roles:app.auth.roles(s.account_id).map(r=>r.code).filter(r=>['frontdesk','dentist','cashier','assistant','manager'].includes(r))}));const info=db.prepare('SELECT id,name,branch_code,status FROM clinic_branch WHERE id=?').get(branch);return json(res,200,{staff,candidates,branch:info});
   }
   if(req.method==='POST'&&url.pathname==='/api/branch-staff'){
    const value=await body(req),roles={frontdesk:'frontdesk',dentist:'dentist',cashier:'cashier',assistant:'assistant',manager:'branch_manager'},branchRole=roles[value.role];
    if(value.action==='create'){if(!branchRole)fail(422,'INVALID_ACTION','请选择有效岗位');return json(res,200,app.clinic.staff(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'clinic.manage',value.branchId);ctx.authority={...ctx.authority,branchId:value.branchId};},afterCreate:(ctx,now,staffId)=>{insert(db,'branch_staff_role',{branch_id:value.branchId,staff_id:staffId,role_code:branchRole,valid_from:now,granted_by:ctx.session.staff_id,granted_at:now,evidence:value.basis});}}));}
    if(['disable','enable'].includes(value.action))return json(res,200,app.clinic.staff(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'clinic.manage',value.branchId);const rows=db.prepare('SELECT DISTINCT branch_id FROM branch_staff_role WHERE staff_id=? AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>?)').all(value.staffId,app.auth.now());if(!rows.some(r=>r.branch_id===value.branchId))fail(403,'BRANCH_FORBIDDEN','该账号不属于当前门店');for(const row of rows)access.authorizeBranch(credentials,'clinic.manage',row.branch_id);if(value.action==='disable'&&db.prepare("SELECT 1 FROM followup_requirement WHERE responsible_frontdesk_id=? AND status IN ('待发布','待联系','待到诊或评估') LIMIT 1").get(value.staffId))fail(409,'FOLLOWUP_ACTIVE','请先转交该人员的未完成复诊事项');ctx.authority={...ctx.authority,branchId:value.branchId,staffId:value.staffId};}}));
    if(!['grant','revoke'].includes(value.action))fail(422,'INVALID_ACTION','岗位操作无效');
    return json(res,200,app.unit.command(credentials,'clinic.manage',value,(ctx,now)=>{const reason=typeof value.reason==='string'?value.reason.trim():'';if(!reason||reason.length>1000)fail(422,'INVALID_INPUT','请填写岗位办理依据');let staffId;
     if(value.action==='grant'){if(!branchRole||!Number.isSafeInteger(value.staffId))fail(422,'INVALID_INPUT','请选择人员及岗位');staffId=value.staffId;const account=db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(staffId);if(!account||!app.auth.roles(account.id).some(r=>r.code===value.role))fail(409,'STAFF_ROLE_MISSING','该人员账号尚无有效的对应岗位资格');if(db.prepare('SELECT 1 FROM branch_staff_role WHERE staff_id=? AND branch_id=? AND role_code=? AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>?)').get(staffId,value.branchId,branchRole,now))fail(409,'BRANCH_ROLE_EXISTS','该人员已有本店岗位');insert(db,'branch_staff_role',{branch_id:value.branchId,staff_id:staffId,role_code:branchRole,valid_from:now,granted_by:ctx.session.staff_id,granted_at:now,evidence:reason});}
     else{const grant=db.prepare('SELECT * FROM branch_staff_role WHERE id=? AND branch_id=?').get(value.grantId,value.branchId);if(!grant||grant.revoked_at)fail(409,'BRANCH_ROLE_MISSING','岗位不存在或已撤销');staffId=grant.staff_id;if(staffId===ctx.session.staff_id&&grant.role_code==='branch_manager')fail(409,'SELF_LOCKOUT','不能撤销当前本人本店负责人岗位');if(grant.role_code==='dentist'&&db.prepare("SELECT 1 FROM dated_schedule WHERE branch_id=? AND dentist_id=? AND status='已确认' AND ends_at>? LIMIT 1").get(value.branchId,staffId,now))fail(409,'CLINIC_ACTIVE_SCHEDULE','请先协调该牙医本店有效排班');if(grant.role_code==='frontdesk'&&db.prepare("SELECT 1 FROM followup_requirement WHERE responsible_branch_id=? AND responsible_frontdesk_id=? AND status NOT IN ('已完成','已取消') LIMIT 1").get(value.branchId,staffId))fail(409,'FOLLOWUP_ACTIVE','请先转交该前台的未完成复诊事项');db.prepare('UPDATE branch_staff_role SET revoked_at=?,revoked_by=? WHERE id=?').run(now,ctx.session.staff_id,grant.id);}
     const person=db.prepare('SELECT revision FROM staff WHERE id=?').get(staffId);ctx.authority={...ctx.authority,branchId:value.branchId,staffId};return {kind:'staff',key:staffId,revision:person.revision,reason};},ctx=>{access.authorizeBranch(credentials,'clinic.manage',value.branchId);ctx.authority={...ctx.authority,branchId:value.branchId};}));
   }
   if(req.method==='POST'&&url.pathname==='/api/branch-details'){
    const value=await body(req);return json(res,200,app.unit.command(credentials,'clinic.manage',value,(ctx)=>{const current=db.prepare('SELECT id,name,branch_code FROM clinic_branch WHERE id=?').get(value.branchId);if(!current)fail(404,'BRANCH_MISSING','门店不存在');if(current.name!==value.expectedName)fail(409,'BRANCH_CHANGED','门店名称已变化，请重新查看');const name=typeof value.name==='string'?value.name.trim():'';const reason=typeof value.reason==='string'?value.reason.trim():'';if(!name||name.length>80||!reason||reason.length>1000)fail(422,'INVALID_INPUT','请填写门店名称和修改依据');db.prepare('UPDATE clinic_branch SET name=? WHERE id=?').run(name,current.id);ctx.authority={...ctx.authority,branchId:current.id};return {kind:'clinic_branch',key:current.id,revision:1,reason,changes:[{field:'name',before:current.name,after:name}]};},ctx=>{access.authorizeBranch(credentials,'clinic.manage',value.branchId);ctx.authority={...ctx.authority,branchId:value.branchId};}));
   }
   if(req.method==='GET'&&url.pathname==='/api/insurance/options'){
    const branch=Number(url.searchParams.get('branchId'));access.authorizeBranch(credentials,'insurance.query',branch);
    const visits=db.prepare(`SELECT v.id,v.patient_id,v.record_no,p.name patient_name,p.record_no patient_no FROM visit v JOIN patient p ON p.id=v.patient_id WHERE v.branch_id=? ORDER BY v.id DESC`).all(branch);
    const identities=db.prepare(`SELECT i.id,i.patient_id,i.status,i.insured_area,i.verified_at,i.valid_until,i.insured_person_no,a.authority_snapshot FROM insurance_identity i JOIN operation_audit a ON a.object_kind='insurance_identity' AND a.object_key=CAST(i.id AS TEXT) AND a.event_type='变更' ORDER BY i.id DESC`).all().flatMap(i=>{let scope;try{scope=JSON.parse(i.authority_snapshot);}catch{return [];}if(scope.branchId!==branch||!visits.some(v=>v.id===scope.visitId&&v.patient_id===i.patient_id))return [];return [{id:i.id,visitId:scope.visitId,status:i.status,area:i.insured_area,verifiedAt:i.verified_at,validUntil:i.valid_until,personSuffix:i.insured_person_no?i.insured_person_no.slice(-4):null}];});
    const cases=db.prepare(`SELECT c.id,c.visit_id,c.patient_id,c.identity_id,c.bill_id,c.business_no,c.status,c.patient_choice,c.revision,c.estimated_fund_cents,c.estimated_account_cents,c.estimated_patient_cents FROM insurance_case c JOIN visit v ON v.id=c.visit_id AND v.patient_id=c.patient_id WHERE v.branch_id=? ORDER BY c.id DESC`).all(branch).map(c=>({...c,settlement:credentials.role==='frontdesk'?null:(db.prepare('SELECT id,revision,status,external_reference,total_cents,fund_cents,account_cents,patient_due_cents FROM insurance_settlement WHERE insurance_case_id=?').get(c.id)||null)}));
    const reversals=credentials.role==='frontdesk'?[]:db.prepare(`SELECT r.id,r.business_no,r.status,r.revision,r.settlement_id FROM insurance_reversal r JOIN insurance_settlement s ON s.id=r.settlement_id JOIN insurance_case c ON c.id=s.insurance_case_id JOIN visit v ON v.id=c.visit_id AND v.patient_id=c.patient_id WHERE v.branch_id=? ORDER BY r.id DESC`).all(branch);
    const bills=credentials.role==='cashier'?db.prepare('SELECT id,patient_id,record_no,revision FROM bill WHERE branch_id=? ORDER BY id DESC').all(branch).map(b=>{assertBillScope(db,branch,b.patient_id,b.id);return {...b,summary:app.billing.billSummary(b.id),items:app.billing.lines(b.id).map(i=>({id:i.id,service_id:i.service_id,service_name:i.service_name,amount_cents:i.amount_cents,pricing_status:i.pricing_status}))};}):[];
    const mappings=['cashier','manager'].includes(credentials.role)?db.prepare("SELECT id,service_id,material_id,insurance_code,insured_area,valid_from,valid_until,revision FROM insurance_item_mapping WHERE status='有效'").all():[];
    const services=credentials.role==='manager'?db.prepare('SELECT id,name FROM service WHERE is_active=1 ORDER BY id').all():[];
    return json(res,200,{enabled:branch===1&&app.insurance.state().active,visits,identities,cases,reversals,bills,mappings,services,note:'虚构模拟，不连接真实医保平台；仅一店演示启用'});
   }
   if(req.method==='POST'&&url.pathname==='/api/insurance/identity'){
    const value=await body(req);if(value.branchId!==1)fail(409,'INSURANCE_DISABLED','该门店未配置医保演示条件');
    return json(res,200,app.insurance.identity(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'insurance.identity',value.branchId);const v=db.prepare('SELECT id,patient_id,branch_id FROM visit WHERE id=?').get(value.visitId);if(!v||v.branch_id!==value.branchId||v.patient_id!==value.patientId)fail(403,'INSURANCE_BRANCH_SCOPE','就诊与门店或患者不一致');ctx.authority={...ctx.authority,branchId:value.branchId,visitId:v.id,patientId:v.patient_id};}}));
   }
   if(req.method==='POST'&&url.pathname==='/api/insurance/register'){
    const value=await body(req);if(value.branchId!==1)fail(409,'INSURANCE_DISABLED','该门店未配置医保演示条件');
    return json(res,200,app.insurance.register(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'insurance.identity',value.branchId);const v=db.prepare('SELECT id,patient_id,branch_id FROM visit WHERE id=?').get(value.visitId);if(!v||v.branch_id!==value.branchId||v.patient_id!==value.patientId)fail(403,'INSURANCE_BRANCH_SCOPE','就诊与门店或患者不一致');const identity=db.prepare('SELECT patient_id,status,valid_until FROM insurance_identity WHERE id=?').get(value.identityId);if(!identity||identity.patient_id!==v.patient_id||identity.status!=='核验通过'||identity.valid_until<=app.auth.now())fail(409,'INSURANCE_IDENTITY_INVALID','请选择本次有效的身份核验');const audit=db.prepare("SELECT authority_snapshot FROM operation_audit WHERE object_kind='insurance_identity' AND object_key=? AND event_type='变更' ORDER BY id DESC LIMIT 1").get(String(value.identityId));let origin;try{origin=JSON.parse(audit.authority_snapshot);}catch{fail(409,'INSURANCE_IDENTITY_SOURCE','医保身份来源待核对');}if(origin.branchId!==value.branchId||origin.visitId!==value.visitId||origin.patientId!==value.patientId)fail(403,'INSURANCE_BRANCH_SCOPE','身份核验与本次就诊不一致');if(value.billId!=null||value.previousCaseId!=null)fail(422,'INSURANCE_SCOPE','当前演示仅支持首次登记，账单及重新办理尚未接入');ctx.authority={...ctx.authority,branchId:value.branchId,visitId:v.id,patientId:v.patient_id};}}));
   }
   if(req.method==='POST'&&['/api/insurance/prepare','/api/insurance/choice','/api/insurance/settle'].includes(url.pathname)){
    const value=await body(req),action=url.pathname.split('/').pop();if(value.branchId!==1)fail(409,'INSURANCE_DISABLED','该门店未配置医保演示条件');
    const scopeGuard=ctx=>{access.authorizeBranch(credentials,action==='settle'?'insurance.settle':'insurance.prepare',value.branchId);const c=db.prepare('SELECT c.*,v.branch_id FROM insurance_case c JOIN visit v ON v.id=c.visit_id AND v.patient_id=c.patient_id WHERE c.id=?').get(value.caseId);if(!c||c.branch_id!==value.branchId)fail(403,'INSURANCE_BRANCH_SCOPE','医保办理不属于当前门店');if(action==='prepare'){if(value.action!=='record')fail(422,'INSURANCE_SCOPE','当前演示仅登记已核对预结算结果');if(value.identityId!==c.identity_id)fail(403,'INSURANCE_BRANCH_SCOPE','身份核验与原办理不一致');const b=assertBillScope(db,value.branchId,c.patient_id,value.billId);for(const line of app.billing.lines(b.id)){const source=line.treatment_execution_id?db.prepare('SELECT e.branch_id,v.branch_id visit_branch,v.patient_id FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.id=?').get(line.treatment_execution_id):null;if(!source||source.branch_id!==value.branchId||source.visit_branch!==value.branchId||source.patient_id!==c.patient_id)fail(409,'INSURANCE_BRANCH_SCOPE','账单项目来源门店待核对');}}else if(action==='settle'){if(!['submit','verify'].includes(value.action))fail(422,'INSURANCE_SCOPE','结算动作无效');if(c.bill_id==null)fail(409,'INSURANCE_SCOPE','医保办理尚未关联账单');assertBillScope(db,value.branchId,c.patient_id,c.bill_id);}ctx.authority={...ctx.authority,branchId:value.branchId,visitId:c.visit_id,patientId:c.patient_id,caseId:c.id};};
    return json(res,200,app.insurance[action](credentials,value,{scopeGuard}));
   }
   if(req.method==='POST'&&url.pathname==='/api/insurance/mapping'){
    const value=await body(req);if(value.branchId!==1||value.action!=='create')fail(422,'INSURANCE_SCOPE','当前仅支持一店虚构项目对应');return json(res,200,app.insurance.mapping(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'insurance.manage',value.branchId);ctx.authority={...ctx.authority,branchId:value.branchId};}}));
   }
   if(req.method==='POST'&&['/api/insurance/reverse','/api/insurance/receipt'].includes(url.pathname)){
    const value=await body(req),action=url.pathname.endsWith('/reverse')?'reverse':'receipt';if(value.branchId!==1)fail(409,'INSURANCE_DISABLED','该门店未配置医保演示条件');
    const guard=ctx=>{const permission=action==='receipt'?'insurance.receipt':value.action==='initiate'?'insurance.manage':'insurance.settle';access.authorizeBranch(credentials,permission,value.branchId);let settlementId=value.settlementId;if(action==='reverse'&&value.action==='verify')settlementId=db.prepare('SELECT settlement_id FROM insurance_reversal WHERE id=?').get(value.reversalId)?.settlement_id;const origin=db.prepare(`SELECT c.patient_id,c.visit_id,c.bill_id,v.branch_id FROM insurance_settlement s JOIN insurance_case c ON c.id=s.insurance_case_id JOIN visit v ON v.id=c.visit_id AND v.patient_id=c.patient_id WHERE s.id=?`).get(settlementId);if(!origin||origin.branch_id!==value.branchId)fail(403,'INSURANCE_BRANCH_SCOPE','医保结算不属于当前门店');assertBillScope(db,value.branchId,origin.patient_id,origin.bill_id);if(value.requestId!=null)fail(422,'INSURANCE_SCOPE','当前演示仅支持独立撤销');ctx.authority={...ctx.authority,branchId:value.branchId,visitId:origin.visit_id,patientId:origin.patient_id,settlementId};};
    return json(res,200,app.insurance[action](credentials,value,{scopeGuard:guard}));
   }
   if(req.method==='GET'&&url.pathname==='/api/documents/options')return json(res,200,documentsTrial.options(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='GET'&&url.pathname==='/api/documents'){const q=Object.fromEntries(url.searchParams);return json(res,200,documentsTrial.query(credentials,{branchId:Number(q.branchId),visitId:Number(q.visitId),patientId:Number(q.patientId)}));}
   if(req.method==='POST'&&url.pathname==='/api/documents/upload')return json(res,200,documentsTrial.upload(credentials,await body(req,Math.ceil(MAX_FILE_BYTES/3)*4+32768)));
   if(req.method==='POST'&&url.pathname==='/api/documents/verify')return json(res,200,documentsTrial.verify(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/documents/download'){const file=documentsTrial.download(credentials,await body(req));return json(res,200,{name:file.name,mediaType:file.mediaType,contentBase64:file.bytes.toString('base64')});}
   if(req.method==='POST'&&url.pathname==='/api/setup')return json(res,200,setup.command(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/catalog'){
    const value=await body(req),k=value.action,permission=k==='service'?'uc05.draft':k==='material'?'uc32.record':['confirmMaterial','deactivateMaterial'].includes(k)?'uc32.approve':['editService','stopService','enableService'].includes(k)?'uc05.approve':null;if(!permission)fail(422,'INVALID_ACTION','目录操作无效');
    const scopeGuard=ctx=>{access.authorizeBranch(credentials,permission,value.branchId);const branches=db.prepare("SELECT id FROM clinic_branch WHERE status='active'").all();for(const b of branches)access.authorizeBranch(credentials,permission,b.id);ctx.authority={...ctx.authority,branchId:value.branchId,sharedCatalog:true};};
    if(k==='service')return json(res,200,app.billing.draft(credentials,value,{scopeGuard}));if(k==='material')return json(res,200,app.inventory.record(credentials,value,{scopeGuard}));if(['editService','stopService','enableService'].includes(k))return json(res,200,app.billing.manageService(credentials,{...value,action:{editService:'edit',stopService:'stop',enableService:'enable'}[k]},{scopeGuard}));return json(res,200,app.inventory.approve(credentials,value,{scopeGuard}));
   }
   if(req.method==='GET'&&url.pathname==='/api/suppliers'){
    const branch=Number(url.searchParams.get('branchId'));access.authorizeBranch(credentials,'uc27.supplier',branch);const items=db.prepare('SELECT id,name,contact_name,phone,address,settlement_basis,is_active,revision FROM supplier ORDER BY id').all();return json(res,200,{items});
   }
   if(req.method==='POST'&&url.pathname==='/api/suppliers'){
    const value=await body(req);return json(res,200,app.purchases.supplier(credentials,value,{scopeGuard:ctx=>{access.authorizeBranch(credentials,'uc27.supplier',value.branchId);for(const b of db.prepare("SELECT id FROM clinic_branch WHERE status='active'").all())access.authorizeBranch(credentials,'uc27.supplier',b.id);ctx.authority={...ctx.authority,branchId:value.branchId,sharedCatalog:true};}}));
   }
   if(req.method==='GET'&&url.pathname==='/api/prescriptions')return json(res,200,prescriptionTrial.query(credentials,{branchId:Number(url.searchParams.get('branchId')),visitId:Number(url.searchParams.get('visitId')),patientId:Number(url.searchParams.get('patientId'))}));
   if(req.method==='POST'&&url.pathname==='/api/prescriptions')return json(res,200,prescriptionTrial.write(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/reception/options'){
    const branch=Number(url.searchParams.get('branchId'));access.authorizeBranch(credentials,'uc02.query',branch);
    const schedules=db.prepare("SELECT s.id,s.branch_id,s.dentist_id,s.dental_chair_id,s.business_date,s.starts_at,s.ends_at,s.revision,d.name dentist_name,c.name chair_name FROM dated_schedule s JOIN staff d ON d.id=s.dentist_id JOIN dental_chair c ON c.id=s.dental_chair_id WHERE s.branch_id=? AND s.status='已确认' ORDER BY s.starts_at").all(branch);
    const patients=db.prepare('SELECT id,name,record_no,birth_date FROM patient ORDER BY id').all();
    const appointments=db.prepare(`SELECT a.id,a.patient_id,a.planned_start,a.planned_end,a.status,a.revision,a.branch_id,o.revision occupancy_revision,
     s.id schedule_id,s.revision schedule_revision,s.dentist_id FROM appointment a LEFT JOIN resource_occupancy o ON o.appointment_id=a.id AND o.released_at IS NULL
     LEFT JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE a.branch_id=? ORDER BY a.planned_start`).all(branch);
    const visits=db.prepare("SELECT v.id,v.patient_id,v.record_no,v.status,v.arrived_at,v.branch_id,v.revision,d.name dentist_name FROM visit v JOIN staff d ON d.id=v.dentist_id WHERE v.branch_id=? AND v.status IN ('候诊','接诊中') ORDER BY v.arrived_at,v.id").all(branch);
    return json(res,200,{schedules,patients,appointments,visits});
   }
   if(req.method==='POST'&&url.pathname==='/api/reception')return json(res,200,reception.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/approvals')return json(res,200,approval.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='GET'&&url.pathname==='/api/approvals/options')return json(res,200,crossOptions.forManager(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/approvals')return json(res,200,approval.command(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/grants')return json(res,200,grants.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/finance/patients'){
    const branch=Number(url.searchParams.get('branchId')),term=String(url.searchParams.get('q')||'').trim();if(term.length<2||term.length>80)fail(422,'SEARCH_TERM','请输入 2 至 80 个字的姓名、电话或患者编号');
    db.exec('BEGIN');try{const ctx=access.authorizeBranch(credentials,'uc06.query',branch);if(credentials.role!=='cashier')fail(403,'FORBIDDEN','需要收费岗位');ctx.authority={...ctx.authority,branchId:branch};
     const items=db.prepare("SELECT id,name,record_no,phone FROM patient WHERE instr(name,?)>0 OR instr(record_no,?)>0 OR instr(coalesce(phone,''),?)>0 ORDER BY id LIMIT 50").all(term,term,term).map(p=>({id:p.id,name:p.name,record_no:p.record_no,phone_hint:p.phone?'尾号 '+p.phone.slice(-4):'未记录电话'}));
     app.unit.audit(ctx,'查询','CHAIN_FINANCE_PATIENT_SEARCH',{kind:'patient_identity_search',key:'branch:'+branch},null,'查询患者身份以核对本店费用');db.exec('COMMIT');return json(res,200,{items});
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
   }
   if(req.method==='GET'&&url.pathname==='/api/prepayments')return json(res,200,prepayTrial.list(credentials,Number(url.searchParams.get('branchId')),url.searchParams.has('patientId')?Number(url.searchParams.get('patientId')):null));
   if(req.method==='POST'&&url.pathname==='/api/prepayments')return json(res,200,prepayTrial.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/finance')return json(res,200,finance.query(credentials,{branchId:Number(url.searchParams.get('branchId')),patientId:Number(url.searchParams.get('patientId'))}));
   if(req.method==='GET'&&url.pathname==='/api/prices')return json(res,200,prices.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/prices')return json(res,200,prices.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/treatment/options'){
    const branch=Number(url.searchParams.get('branchId'));db.exec('BEGIN');try{
     const ctx=access.authorizeBranch(credentials,'uc04.execute',branch);ctx.authority={...ctx.authority,branchId:branch};
     const visits=db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.revision,v.status,p.name patient_name,p.record_no patient_no,p.birth_date patient_birth_date,o.revision occupancy_revision FROM visit v JOIN patient p ON p.id=v.patient_id
       LEFT JOIN resource_occupancy o ON o.visit_id=v.id AND o.released_at IS NULL
       WHERE v.branch_id=? AND v.dentist_id=? AND v.status IN ('候诊','接诊中','诊疗结束') ORDER BY v.id`).all(branch,ctx.session.staff_id);
     const services=db.prepare('SELECT id,name,billing_unit,record_no FROM service WHERE is_active=1 ORDER BY id').all();
     app.unit.audit(ctx,'查询','CHAIN_TREATMENT_OPTIONS',{kind:'branch_treatment_query',key:'branch:'+branch},null,'查询本人本店接诊和收费项目');
     db.exec('COMMIT');return json(res,200,{visits,services});
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
   }
   if(req.method==='GET'&&url.pathname==='/api/quotes')return json(res,200,quoteTrial.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/quotes')return json(res,200,quoteTrial.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/plans')return json(res,200,planTrial.list(credentials,Number(url.searchParams.get('branchId')),Number(url.searchParams.get('visitId'))));
   if(req.method==='POST'&&url.pathname==='/api/plans')return json(res,200,planTrial.command(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/treatment/check')return json(res,200,treatment.execute(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/treatment/correct')return json(res,200,treatment.correct(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/treatment/start')return json(res,200,startVisit.start(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/record/draft')return json(res,200,recordTrial.detail(credentials,Number(url.searchParams.get('branchId')),Number(url.searchParams.get('visitId'))));
   if(req.method==='POST'&&url.pathname==='/api/record/draft')return json(res,200,recordTrial.save(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/record/health')return json(res,200,healthSign.detail(credentials,Number(url.searchParams.get('branchId')),Number(url.searchParams.get('visitId'))));
   if(req.method==='POST'&&url.pathname==='/api/record/health')return json(res,200,healthSign.command(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/record/addendum')return json(res,200,addendumTrial.append(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/followups')return json(res,200,followupTrial.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/followups')return json(res,200,followupTrial.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/inventory')return json(res,200,inventoryTrial.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/inventory/issue')return json(res,200,inventoryTrial.issue(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/inventory/batch')return json(res,200,inventoryTrial.batch(credentials,await body(req)));
   if(req.method==='POST'&&url.pathname==='/api/inventory/count')return json(res,200,inventoryTrial.count(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/dashboard')return json(res,200,dashboard.query(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='GET'&&url.pathname==='/api/purchases')return json(res,200,purchaseTrial.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/purchases')return json(res,200,purchaseTrial.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/resources')return json(res,200,resourcesTrial.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/resources')return json(res,200,resourcesTrial.command(credentials,await body(req)));
   if(req.method==='GET'&&url.pathname==='/api/prices/pending')return json(res,200,pendingPrices.list(credentials,Number(url.searchParams.get('branchId'))));
   if(req.method==='POST'&&url.pathname==='/api/prices/pending')return json(res,200,pendingPrices.price(credentials,await body(req)));
   if(req.method==='POST'&&['/api/finance/cash','/api/finance/payment'].includes(url.pathname)){
    const value=await body(req);
    if(url.pathname==='/api/finance/cash'&&value.channel!==undefined&&value.channel!=='现金')fail(422,'PAYMENT_CHANNEL','现金接口仅支持现金');
    return json(res,200,cash.receive(credentials,value));
   }
   if(req.method==='POST'&&url.pathname==='/api/clinical'){
    const query=await body(req);if(query.scope==='document')fail(422,'TRIAL_SCOPE','此演示接口尚未提供原件下载');
    return json(res,200,clinical.read(credentials,query));
   }
   if(req.method==='GET'&&url.pathname==='/api/clinical/grants')return json(res,200,crossOptions.forDentist(credentials,Number(url.searchParams.get('branchId'))));
   return json(res,404,{code:'NOT_FOUND',message:'演示接口不存在'});
  }catch(e){return json(res,e.status&&e.status<500?e.status:500,{code:e.code||'INTERNAL_ERROR',message:e.status?e.message:'演示请求未完成'});}
 });
 if(store){server.on('close',()=>store.close());server.on('error',()=>store.close());}
 return {server,db,app};
}
module.exports={createChainDemo,CHAIN_DEMO_BUILD};
