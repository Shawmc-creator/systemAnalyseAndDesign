'use strict';
// Explicitly fictitious local fixed-date demo. Uses normal authorization and
// commands, preserves existing records and reuses stable idempotency keys.
const port=Number(process.env.CHAIN_DEMO_SEED_PORT||3011);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('演示端口无效');
const base='http://127.0.0.1:'+port;
async function login(user,role,password='Clinic123'){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password})});let d=await r.json();if(!r.ok)throw Error('登录 '+user+'：'+d.message);return {cookie:r.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':role,'x-csrf-token':d.csrf};}
async function get(url,h){const r=await fetch(base+url,{headers:h});let d=await r.json();if(!r.ok)throw Error(url+'：'+d.message);return d;}
async function post(url,input,h){const r=await fetch(base+url,{method:'POST',headers:h,body:JSON.stringify(input)}),d=await r.json();if(!r.ok)throw Error(url+'：'+d.message);return d;}
const command=(branch,key,fields)=>({branchId:branch,commandVersion:1,requestKey:'case-20261112-'+key,...fields});
(async()=>{const manager=await login('manager','manager'),front=await login('frontdesk','frontdesk'),dentist=await login('manager','dentist'),assistant=await login('assistant','assistant');
 try{
  const status=await get('/api/status',manager);if(status.clockMode!=='fixed'||status.businessTime!=='2026-10-19T03:00:00Z')throw Error('仅支持固定时间演示，已停止');
  for(const branch of [1,2]){
   const {candidates}=await get('/api/branch-staff?branchId='+branch,manager),username='frontdesk'+branch;
   if(!candidates.some(x=>x.login_name===username)){
    await post('/api/branch-staff',command(branch,'staff-'+branch,{action:'create',name:'虚构'+branch+'店前台',username,password:'Clinic1234',role:'frontdesk',basis:'虚构门店岗位演示',reason:'虚构门店权限示例'}),manager);
    console.log('已创建 '+username+'（仅限本店）');
   }
  }
  const reception=await get('/api/reception/options?branchId=2',front);
  let patient=reception.patients.find(p=>p.name==='虚构示例复诊患者');
  if(!patient){const added=await post('/api/setup',command(2,'patient',{action:'patient',fields:{name:'虚构示例复诊患者',phone:'13800007777',phone_owner:'本人'},reason:'仅供课程虚构演示'}),front);patient={id:added.id};console.log('已建立虚构患者');}
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
  // Complete only the named fixture's clinical resource handover, so it does
  // not permanently block the patient's self-service booking demonstration.
  const latest=(await get('/api/treatment/options?branchId=2',dentist)).visits.find(v=>v.id===visit.id);
  if(latest&&latest.status==='接诊中'){
   const ended=await post('/api/resources',command(2,'finish',{action:'finish',visitId:visit.id,expectedVisitRevision:latest.revision,expectedOccupancyRevision:latest.occupancy_revision,endedAt:'2026-10-19T03:00:00Z',confirmed:true,reason:'虚构案例结束并交接清洁'}),dentist);
   await post('/api/resources',command(2,'restore',{action:'restore',blockId:ended.id,expectedRevision:ended.revision,confirmed:true,verificationNote:'虚构案例：已完成诊椅清洁准备'}),assistant);
   console.log('已完成虚构接诊和诊椅恢复');
  }
 }finally{for(const h of [manager,front,dentist,assistant])try{await post('/api/logout',{},h);}catch{}}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
