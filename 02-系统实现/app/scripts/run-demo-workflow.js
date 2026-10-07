const assert=require('node:assert/strict');
const base=process.env.CLINIC_URL||'http://127.0.0.1:3000';
async function login(username){const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});assert.equal(res.status,200);const b=await res.json();return {...b,cookie:res.headers.get('set-cookie').split(';')[0]};}
async function call(route,s,method='GET',body){const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie,...(method==='GET'?{}:{'X-CSRF-Token':s.csrf})},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(`${route}: ${data.error}`);return data;}
(async()=>{
 const doc=await login('dentist'),cash=await login('cashier'),front=await login('frontdesk'),owner=await login('manager');
 const audit=await call('/api/audit',owner);const seed=audit.events.find(x=>x.action==='demo.requirements.v2');if(!seed)throw new Error('请先运行 scripts/seed-demo.js 建立当前文档演示病例');
 const example=JSON.parse(seed.details);let e=(await call(`/api/encounters/${example.draftEncounterId}`,doc)).encounter;
 if(e.status==='draft'){
  await call(`/api/encounters/${e.id}`,doc,'PUT',{expectedVersion:e.version,chiefComplaint:'演示口腔检查',relevantHistory:'患者病史已核对',diagnosis:'检查所见已记录',clinicalNotes:'完成当次检查',instructions:'按本次诊后安排联系',findings:[{toothCode:'11',finding:'完成检查记录'}]});
  if(!e.treatments.length)await call(`/api/encounters/${e.id}/treatments`,doc,'POST',{expectedVersion:e.confirmation_version,serviceId:1,quantity:1,patientConfirmed:true,outsidePlanReason:'已说明且实际完成检查',outcome:'实际检查完成'});
  e=(await call(`/api/encounters/${e.id}`,doc)).encounter;await call(`/api/encounters/${e.id}/sign`,doc,'POST',{expectedVersion:e.version});
 }
 const invoices=await call('/api/invoices',cash);let inv=invoices.invoices.find(i=>Number(i.encounter_id)===Number(e.id));if(!inv)inv=(await call('/api/invoices',cash,'POST',{encounterId:e.id})).invoice;
 inv=(await call(`/api/invoices/${inv.id}`,cash)).invoice;
 const paid=await call(`/api/invoices/${inv.id}/payments`,cash,'POST',{method:'cash',amount:inv.gross_amount+20,expectedVersion:inv.version});assert.equal(paid.invoice.balance,0);
 const followups=await call('/api/followups',doc);let f=followups.followups.find(f=>Number(f.encounter_id)===Number(e.id)&&f.reason==='HTTP闭环诊后联系');
 if(!f){const date=new Date(Date.now()+86400000).toISOString().slice(0,10);f=(await call('/api/followups',doc,'POST',{type:'followup',requestId:`demo-followup-${e.id}`,patientId:e.patient_id,encounterId:e.id,reason:'HTTP闭环诊后联系',dueDate:date,assignedTo:front.user.id})).followup;}
 if(f.status!=='completed'){await call(`/api/followups/${f.id}`,front,'PATCH',{requestId:`demo-contact-${f.id}`,expectedVersion:f.version,contactedAt:new Date().toISOString(),status:'contacted',result:'前台已联系患者并记录反馈'});await call(`/api/followups/${f.id}`,doc,'PATCH',{requestId:`demo-assess-${f.id}`,expectedVersion:f.version+1,recovery:'患者反馈恢复正常',conclusion:'本次随访完成',opinion:'按医嘱维护，如有变化联系诊所',status:'completed',result:'牙医根据反馈记录了本次诊后处理意见'});}
 console.log(JSON.stringify({encounter:e.encounter_no,invoice:inv.invoice_no,receipt:paid.receipt.receiptNo,tendered:paid.receipt.tenderedAmount,change:paid.receipt.changeAmount,replayed:paid.replayed,followupId:f.id},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
