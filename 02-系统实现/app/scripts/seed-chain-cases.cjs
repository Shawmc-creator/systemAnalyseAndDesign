'use strict';
// Explicitly fictitious local fixed-date demo. Uses normal authorization and
// commands, preserves existing records and reuses stable idempotency keys.
const {examples}=require('../src/v2/chain-patient-demo-fixtures');
const port=Number(process.env.CHAIN_DEMO_SEED_PORT||3011);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('演示端口无效');
const base='http://127.0.0.1:'+port;
const demoTime='2026-10-19T03:00:00Z';
async function login(user,role,password='Clinic123'){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password})});let d=await r.json();if(!r.ok)throw Error('登录 '+user+'：'+d.message);return {cookie:r.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':role,'x-csrf-token':d.csrf};}
async function get(url,h){const r=await fetch(base+url,{headers:h});let d=await r.json();if(!r.ok)throw Error(url+'：'+d.message);return d;}
async function post(url,input,h){const r=await fetch(base+url,{method:'POST',headers:h,body:JSON.stringify(input)}),d=await r.json();if(!r.ok)throw Error(url+'：'+d.message);return d;}
const command=(branch,key,fields)=>({branchId:branch,commandVersion:1,requestKey:'case-20261112-'+key,...fields});
async function examplePatient(branch, {name,phone}, key, front) {
 const reception=await get('/api/reception/options?branchId='+branch,front);
 const {patients}=await get('/api/patients?branchId='+branch,front);
 const existing=patients.find(p=>p.phone===phone);
 const patient=existing || await post('/api/setup',command(branch,key,{
  action:'patient',fields:{name,phone,phone_owner:'本人'},reason:'仅供课程虚构演示'
 }),front);
 return {patient,reception};
}

function demoSchedule(reception, date) {
 const schedule=reception.schedules.find(s=>s.business_date===date);
 if(!schedule)throw Error('缺少 '+date+' 示例排班');
 return {scheduleId:schedule.id,scheduleRevision:schedule.revision};
}

async function finishVisit(visit, key, dentist, assistant) {
 let ended;
 if(visit.status==='诊疗结束'){
  const {blocks}=await get('/api/resources?branchId=2',assistant);
  ended=blocks.find(block=>block.status==='生效中'&&block.reason==='诊后清洁与准备待核验：'+visit.record_no);
  if(!ended)return;
 }else{
  ended=await post('/api/resources',command(2,key+'-finish',{
   action:'finish',visitId:visit.id,expectedVisitRevision:visit.revision,
   expectedOccupancyRevision:visit.occupancy_revision,endedAt:demoTime,
   confirmed:true,reason:'虚构案例结束并交接清洁'
  }),dentist);
 }
 await post('/api/resources',command(2,key+'-restore',{
  action:'restore',blockId:ended.id,expectedRevision:ended.revision,
  confirmed:true,verificationNote:'虚构案例：已完成诊椅清洁准备'
 }),assistant);
}

async function seedAppointment(front) {
 const {patient,reception}=await examplePatient(2,examples.booking,'booking-patient',front);
 if(reception.appointments.some(entry=>entry.patient_id===patient.id))return;
 await post('/api/reception',command(2,'booking',{
  action:'create',patientId:patient.id,...demoSchedule(reception,'2026-10-20'),
  startsAt:'2026-10-20T02:00:00Z',endsAt:'2026-10-20T02:30:00Z',reason:'虚构预约待到诊'
 }),front);
}

async function seedWaiting(front, dentist) {
 const {patient,reception}=await examplePatient(2,examples.waiting,'waiting-patient',front);
 const {visits}=await get('/api/treatment/options?branchId=2',dentist);
 if(visits.some(entry=>entry.patient_id===patient.id))return;
 await post('/api/reception',command(2,'waiting',{
  action:'walkIn',patientId:patient.id,...demoSchedule(reception,'2026-10-19'),
  arrivedAt:demoTime,startsAt:demoTime,endsAt:'2026-10-19T03:30:00Z'
 }),front);
}

async function seedBill(front, dentist, cashier, manager, assistant) {
 const {patient,reception}=await examplePatient(2,examples.billing,'billing-patient',front);
 const options=()=>get('/api/treatment/options?branchId=2',dentist);
 let {visits,services}=await options();
 let visit=visits.find(entry=>entry.patient_id===patient.id);
 if(visit?.status==='诊疗结束')return finishVisit(visit,'billing',dentist,assistant);
 const service=services.find(entry=>entry.name==='虚构演示口腔检查');
 if(!service)throw Error('缺少虚构演示收费项目');
 const quoteList=()=>get('/api/quotes?branchId=2',cashier);
 const {prices}=await quoteList();
 if(!prices.some(price=>price.service_id===service.id)){
  const price=await post('/api/prices',command(2,'billing-price',{
   action:'draft',serviceId:service.id,unitPriceCents:12000,
   validFrom:'2026-10-19T00:00:00+08:00',reason:'虚构示例价目'
  }),cashier);
  await post('/api/prices',command(2,'billing-price-submit',{action:'submit',priceId:price.id,expectedRevision:1}),cashier);
  await post('/api/prices',command(2,'billing-price-approve',{action:'approve',priceId:price.id,expectedRevision:2,reviewNote:'虚构演示核价'}),manager);
 }
 if(!visit){
  const arrival=await post('/api/reception',command(2,'billing-arrival',{
   action:'walkIn',patientId:patient.id,...demoSchedule(reception,'2026-10-19'),
   arrivedAt:demoTime,startsAt:demoTime,endsAt:'2026-10-19T03:30:00Z'
  }),front);
  visit=(await options()).visits.find(entry=>entry.id===arrival.id);
 }
 if(visit.status==='候诊'){
  await post('/api/treatment/start',command(2,'billing-start',{
   visitId:visit.id,expectedVisitRevision:visit.revision,startedAt:demoTime
  }),dentist);
  visit=(await options()).visits.find(entry=>entry.id===visit.id);
 }
 const billQuery='/api/finance?branchId=2&patientId='+patient.id;
 if(!(await get(billQuery,cashier)).items.length){
  const plan=await post('/api/plans',command(2,'billing-plan',{
   action:'draft',visitId:visit.id,items:[{serviceId:service.id,quantity:1}],
   goal:'虚构演示口腔检查',basis:'虚构检查依据',schedule:'一次',reason:'课程演示方案'
  }),dentist);
  await post('/api/plans',command(2,'billing-publish',{
   action:'publish',visitId:visit.id,versionId:plan.id,expectedRevision:1,explanation:'虚构方案说明'
  }),dentist);
  const {plans}=await get('/api/plans?branchId=2&visitId='+visit.id,dentist);
  const item=plans.find(entry=>entry.version_id===plan.id).items[0];
  await post('/api/plans',command(2,'billing-plan-consent',{
   action:'decide',visitId:visit.id,versionId:plan.id,expectedRevision:2,itemId:item.id,
   decision:'同意',explanationBasis:'虚构患者同意',scopeNote:'仅演示的口腔检查'
  }),dentist);
  const quote=await post('/api/quotes',command(2,'billing-quote',{
   action:'draft',visitId:visit.id,planVersionId:plan.id,scopeNote:'虚构检查项目',reason:'课程演示报价'
  }),dentist);
  let version=(await quoteList()).quotes.find(entry=>entry.version_id===quote.id);
  if(version.status==='草稿'){
   await post('/api/quotes',command(2,'billing-quote-issue',{
    action:'issue',visitId:visit.id,versionId:quote.id,expectedRevision:version.revision,
    expectedQuoteRevision:version.quote_revision,validFrom:'2026-10-19',validUntil:'2026-10-21',reason:'虚构报价核对'
   }),cashier);
   version=(await quoteList()).quotes.find(entry=>entry.version_id===quote.id);
  }
  if(!version.items[0].decision){
   await post('/api/quotes',command(2,'billing-quote-consent',{
    action:'decide',visitId:visit.id,versionId:quote.id,expectedRevision:version.revision,
    expectedQuoteRevision:version.quote_revision,itemId:version.items[0].id,
    decision:'接受',confirmationBasis:'虚构患者确认费用'
   }),cashier);
  }
  await post('/api/treatment/check',command(2,'billing-execution',{
   patientId:patient.id,visitId:visit.id,expectedVisitRevision:visit.revision,
   serviceId:service.id,planItemId:item.id,quantity:1,completedAt:demoTime,procedureNote:'虚构诊疗经过'
  }),dentist);
 }
 await finishVisit((await options()).visits.find(entry=>entry.id===visit.id),'billing',dentist,assistant);
}

async function seedPurchase(assistant) {
 const {materials,suppliers}=await get('/api/purchases?branchId=2',assistant);
 const material=materials.find(entry=>entry.name==='虚构演示一次性手套');
 const supplier=suppliers.find(entry=>entry.name==='虚构演示供应商');
 if(!material||!supplier)throw Error('缺少虚构材料或供应商');
 await post('/api/purchases',command(2,'pending-purchase',{
  action:'create',supplierId:supplier.id,expectedSupplierRevision:supplier.revision,
  agreedAt:demoTime,deliveryTerms:'虚构采购：二店收货时按箱核对',
  reason:'虚构采购待负责人确认',
  items:[{materialId:material.id,expectedMaterialRevision:material.revision,quantityScaled:20,unitPriceCents:1000}]
 }),assistant);
}

function exampleDocument() {
 const lines=[
  'BT /F1 20 Tf 54 752 Td (Fictional dental visit) Tj',
  '/F1 12 Tf 0 -30 Td (Course demonstration: follow-up and attachment review.) Tj',
  '0 -22 Td (No real patient data. No clinical use.) Tj ET'
 ].join('\n');
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length '+lines.length+' >>\nstream\n'+lines+'\nendstream'
 ];
 let pdf='%PDF-1.4\n';
 const offsets=objects.map((object,index)=>{
  const offset=pdf.length;
  pdf+=(index+1)+' 0 obj\n'+object+'\nendobj\n';
  return String(offset).padStart(10,'0')+' 00000 n \n';
 });
 const xref=pdf.length;
 pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return Buffer.from(pdf,'ascii').toString('base64');
}

async function seedDocument(visit, patient, assistant) {
 const context={visitId:visit.id,patientId:patient.id};
 const {documents}=await get('/api/documents?branchId=2&visitId='+visit.id+'&patientId='+patient.id,assistant);
 if(documents.some(document=>document.source==='课程虚构案例附件'))return;
 await post('/api/documents/upload',command(2,'followup-document',{
  ...context,documentType:'诊疗附件',source:'课程虚构案例附件',
  ownershipNote:'对应二店演示患者 '+examples.followup.name,reason:'课堂演示牙医确认附件',
  originalName:'虚构复诊说明.pdf',contentBase64:exampleDocument()
 }),assistant);
}

(async()=>{
 const status=await get('/api/status');
 if(status.application!=='qinghe-chain-demo'||status.clockMode!=='fixed'||status.businessTime!==demoTime)throw Error('仅支持固定时间连锁演示，已停止');
 const manager=await login('manager','manager'),front=await login('frontdesk','frontdesk'),dentist=await login('manager','dentist'),assistant=await login('assistant','assistant'),cashier=await login('cashier','cashier');
 try{
  for(const branch of [1,2]){
   const {candidates}=await get('/api/branch-staff?branchId='+branch,manager),username='frontdesk'+branch;
   if(!candidates.some(x=>x.login_name===username)){
    await post('/api/branch-staff',command(branch,'staff-'+branch,{action:'create',name:'虚构'+branch+'店前台',username,password:'Clinic1234',role:'frontdesk',basis:'虚构门店岗位演示',reason:'虚构门店权限示例'}),manager);
    console.log('已创建 '+username+'（仅限本店）');
   }
  }
  const {patient,reception}=await examplePatient(2,examples.followup,'patient',front);
  let treatment=await get('/api/treatment/options?branchId=2',dentist),visit=treatment.visits.find(v=>v.patient_id===patient.id);
  if(!visit){
   const schedule=reception.schedules.find(s=>s.business_date==='2026-10-19');if(!schedule)throw Error('二店示例排班缺失');
   const arrived=await post('/api/reception',command(2,'arrival',{action:'walkIn',patientId:patient.id,scheduleId:schedule.id,scheduleRevision:schedule.revision,arrivedAt:'2026-10-19T01:35:00Z',startsAt:'2026-10-19T03:00:00Z',endsAt:'2026-10-19T03:30:00Z'}),front);
   treatment=await get('/api/treatment/options?branchId=2',dentist);visit=treatment.visits.find(v=>v.id===arrived.id);
  }
  if(!visit)throw Error('找不到示例就诊');
  if(visit.status==='候诊'){await post('/api/treatment/start',command(2,'start',{visitId:visit.id,expectedVisitRevision:visit.revision,startedAt:'2026-10-19T03:00:00Z'}),dentist);console.log('已开始虚构接诊');}
  let rx=await get('/api/prescriptions?branchId=2&visitId='+visit.id+'&patientId='+patient.id,dentist);
  if(!rx.drugs.length){const material=await post('/api/catalog',command(2,'demo-drug',{action:'material',name:'虚构示例药品（非真实药物）',specification:'仅供课堂展示',baseUnit:'片',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:false,requiresExpiry:false,isDrug:true,reason:'虚构示例，不用于实际用药'}),assistant);await post('/api/catalog',command(2,'demo-drug-confirm',{action:'confirmMaterial',materialId:material.id,expectedRevision:1,reason:'仅供虚构演示'}),manager);rx=await get('/api/prescriptions?branchId=2&visitId='+visit.id+'&patientId='+patient.id,dentist);}
  if(!rx.prescriptions.length&&rx.drugs.length){const drug=rx.drugs[0];await post('/api/prescriptions',command(2,'rx',{action:'draft',visitId:visit.id,patientId:patient.id,collectionRoute:'院外',diagnosis:'虚构示例诊断，仅用于课堂展示',guidanceNote:'虚构示例，不用于实际用药',reason:'虚构处方草稿',items:[{materialId:drug.id,expectedMaterialRevision:drug.revision,quantityScaled:1,directions:'演示用法，不用于实际用药'}]}),dentist);console.log('已建立虚构院外处方草稿');}
  let draft=await get('/api/record/draft?branchId=2&visitId='+visit.id,dentist);
  if(draft.record.status!=='已签署'){
   await post('/api/record/draft',command(2,'record',{visitId:visit.id,recordId:draft.record.id,expectedRevision:draft.record.revision,chiefComplaint:'虚构示例：牙齿遇冷不适',diagnosis:'虚构示例：口腔检查',treatmentAdvice:'虚构示例：建议按期复查',findings:[{toothCode:'16',text:'虚构检查所见，仅用于课堂展示'}]}),dentist);
   await post('/api/record/health',command(2,'health',{action:'health',visitId:visit.id,expectedHealthVersionId:null,items:['病史','过敏','用药'].map(category=>({category,certainty:'未知',content:'虚构示例',source:'虚构患者',reportedAt:'2026-10-19T03:00:00Z'})),reason:'虚构健康复核',conclusion:'虚构演示，不作为真实诊疗依据'}),dentist);
   draft=await get('/api/record/draft?branchId=2&visitId='+visit.id,dentist);
   await post('/api/record/health',command(2,'sign',{action:'sign',visitId:visit.id,recordId:draft.record.id,expectedRevision:draft.record.revision,confirmed:true}),dentist);console.log('已建立虚构病历');
  }
  const follow=await get('/api/followups?branchId=2',dentist);
  if(!follow.items.some(x=>x.patient_id===patient.id)){
   const responsible=follow.frontdesks.find(x=>x.name==='虚构2店前台')||follow.frontdesks[0];if(!responsible)throw Error('二店缺少责任前台');
   await post('/api/followups',command(2,'followup',{action:'create',visitId:visit.id,type:'复诊',requiresAssessment:true,purpose:'虚构示例：复诊检查',targetStart:'2026-10-20',targetEnd:'2026-10-21',nextContactDate:'2026-10-19',responsibleFrontdeskId:responsible.id}),dentist);console.log('已建立虚构复诊待办');
  }
  await seedDocument(visit,patient,assistant);
  // Complete only the named fixture's clinical resource handover, so it does
  // not permanently block the patient's self-service booking demonstration.
  const latest=(await get('/api/treatment/options?branchId=2',dentist)).visits.find(v=>v.id===visit.id);
  if(latest&&latest.status==='接诊中'){
   const ended=await post('/api/resources',command(2,'finish',{action:'finish',visitId:visit.id,expectedVisitRevision:latest.revision,expectedOccupancyRevision:latest.occupancy_revision,endedAt:'2026-10-19T03:00:00Z',confirmed:true,reason:'虚构案例结束并交接清洁'}),dentist);
   await post('/api/resources',command(2,'restore',{action:'restore',blockId:ended.id,expectedRevision:ended.revision,confirmed:true,verificationNote:'虚构案例：已完成诊椅清洁准备'}),assistant);
   console.log('已完成虚构接诊和诊椅恢复');
  }
  await seedAppointment(front);
  await seedBill(front,dentist,cashier,manager,assistant);
  await seedWaiting(front,dentist);
  await seedPurchase(assistant);
  console.log('已核对虚构预约、候诊、复诊、收费和采购案例。');
 }finally{for(const h of [manager,front,dentist,assistant,cashier])try{await post('/api/logout',{},h);}catch{}}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
