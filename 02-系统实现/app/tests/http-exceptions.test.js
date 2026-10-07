// HTTP acceptance tests follow the current requirements; legacy self-service,
// partial payment and approval assertions were replaced with their disabled routes.
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.CLINIC_DB=':memory:';
const {server,db}=require('../src/server');
const rules=require('../src/requirements');
test('网页接口按文档完成分岗、预约、诊療、结算、复诊与材料闭环',async t=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(route,s,method='GET',body){
  if(body){body={...body,requestId:body.requestId||require('node:crypto').randomUUID()};let id;
   if((id=route.match(/^\/api\/encounters\/(\d+)(?:\/sign|\/plans)?$/))&&body.expectedVersion==null)body.expectedVersion=db.prepare('SELECT version FROM encounters WHERE id=?').get(Number(id[1])).version;
   if((id=route.match(/^\/api\/plans\/(\d+)\/decision$/))&&body.expectedVersion==null)body.expectedVersion=db.prepare('SELECT e.version FROM treatment_plans p JOIN encounters e ON e.id=p.encounter_id WHERE p.id=?').get(Number(id[1])).version;
   if((id=route.match(/^\/api\/followups\/(\d+)$/))){body.expectedVersion??=db.prepare('SELECT version FROM followups WHERE id=?').get(Number(id[1])).version;if(body.status!=='completed')body.contactedAt??=new Date().toISOString();}
   if((id=route.match(/^\/api\/materials\/(\d+)\/movements$/)))body.expectedVersion??=db.prepare('SELECT version FROM materials WHERE id=?').get(Number(id[1])).version;
   if(route==='/api/reconciliations')body.basisHash??=rules.dailySummary(db,body.date).basisHash;
  }
  const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(s?{Cookie:s.cookie,...(method!=='GET'?{'X-CSRF-Token':s.csrf}:{})}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()};}
 async function login(name){const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'Clinic123!'})});assert.equal(res.status,200);const b=await res.json();return {...b,cookie:res.headers.get('set-cookie').split(';')[0]};}
 const front=await login('frontdesk'),cash=await login('cashier'),doc=await login('dentist'),owner=await login('manager'),assist=await login('assistant');
 const now=new Date(),today=db.prepare("SELECT date('now','localtime') day").get().day;
 const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,10,0),end=new Date(tomorrow.getTime()+30*60000);
 const patient=1,dentist=doc.user.id;
 db.exec("UPDATE clinic_hours SET active=1,open_time='00:00',close_time='23:59'; UPDATE dentist_schedules SET active=1,start_time='00:00',end_time='23:59'");
 for(let w=0;w<7;w++)for(const u of [dentist,owner.user.id])db.prepare("INSERT OR IGNORE INTO dentist_schedules(dentist_id,weekday,start_time,end_time,active,created_by) VALUES(?,?,'00:00','23:59',1,?)").run(u,w,owner.user.id);
 const input={patientId:patient,dentistId:dentist,chairId:1,serviceId:1,startAt:tomorrow.toISOString(),endAt:end.toISOString(),arrangementConfirmedBy:dentist,arrangementConfirmedAt:now.toISOString()};
 assert.equal((await call('/api/dashboard')).status,401);
 assert.equal((await call('/api/patient/login',null,'POST',{})).status,410);
 for(const route of ['/api/approvals','/api/notifications','/api/appointment-change-requests'])assert.equal((await call(route,front)).status,410);
 assert.equal(front.user.roles.includes('cashier'),false);assert.equal((await call('/api/invoices',front)).status,403);
 assert.equal((await call('/api/appointments',owner,'POST',input)).status,403);
 assert.equal((await call('/api/appointments',front,'POST',{...input,status:'arrived'})).status,400);
 assert.equal((await call('/api/appointments',front,'POST',{...input,startAt:'2000-01-01T10:00:00Z',endAt:'2000-01-01T10:30:00Z'})).status,400);
 const created=await call('/api/appointments',front,'POST',input);assert.equal(created.status,201,JSON.stringify(created.body));const a=created.body.appointment;
 const overlap=await call('/api/appointments',front,'POST',{...input,dentistId:owner.user.id,chairId:2,arrangementConfirmedBy:owner.user.id});assert.equal(overlap.status,409);assert.ok(overlap.body.conflict);
 assert.equal((await call(`/api/appointments/${a.id}/status`,front,'POST',{status:'arrived'})).status,409);
 const revised=await call(`/api/appointments/${a.id}`,front,'PUT',{...input,reason:'调整接诊时间',expectedVersion:a.version,startAt:new Date(tomorrow.getTime()+3600000).toISOString(),endAt:new Date(end.getTime()+3600000).toISOString()});assert.equal(revised.status,200,JSON.stringify(revised.body));
 assert.equal((await call(`/api/appointments/${a.id}`,front,'PUT',{...input,reason:'旧版本不可覆盖',expectedVersion:a.version})).status,409);
 // An existing appointment on today's date may legitimately arrive after its booked start.
 db.prepare('UPDATE appointments SET start_at=?,end_at=? WHERE id=?').run(`${today}T05:00:00.000Z`,`${today}T05:30:00.000Z`,a.id);
 const arrived=await call(`/api/appointments/${a.id}/status`,front,'POST',{status:'arrived'});assert.equal(arrived.status,200,JSON.stringify(arrived.body));const eid=arrived.body.encounter.id;
 const retry=await call(`/api/appointments/${a.id}/status`,front,'POST',{status:'arrived'});assert.equal(retry.body.encounter.id,eid);assert.equal(db.prepare('SELECT COUNT(*) n FROM encounters WHERE appointment_id=?').get(a.id).n,1);
 assert.equal((await call('/api/encounters',doc,'POST',{patientId:2,appointmentId:a.id})).status,409);
 assert.equal((await call(`/api/encounters/${eid}`,owner,'PUT',{chiefComplaint:'不属于本牙医'})).status,403);
 const update=await call(`/api/encounters/${eid}`,doc,'PUT',{chiefComplaint:'口腔检查',relevantHistory:'患者提供的病史记录',diagnosis:'检查结果记录',clinicalNotes:'检查完成',instructions:'按本次诊后安排联系',findings:[{toothCode:'11',finding:'已检查'}]});assert.equal(update.status,200,JSON.stringify(update.body));
 const p=await call(`/api/encounters/${eid}/plans`,doc,'POST',{items:[{serviceId:1,toothCode:'11',quantity:1,decision:'pending'}],summary:'已说明检查与安排'});assert.equal(p.status,201,JSON.stringify(p.body));
 const plan=(await call(`/api/plans/${p.body.planId}`,doc)).body.plan;const pi=plan.items[0].id;
 assert.equal((await call(`/api/encounters/${eid}/treatments`,doc,'POST',{expectedVersion:0,serviceId:1,planItemId:pi,toothCode:'11',quantity:1})).status,409);
 assert.equal((await call(`/api/plans/${p.body.planId}/decision`,doc,'POST',{items:[{id:pi,decision:'agreed'}]})).status,200);
 for(const quantity of [0,1.5])assert.equal((await call(`/api/encounters/${eid}/treatments`,doc,'POST',{expectedVersion:0,serviceId:1,planItemId:pi,toothCode:'11',quantity})).status,400);
 assert.equal((await call(`/api/encounters/${eid}/treatments`,doc,'POST',{expectedVersion:0,serviceId:1,planItemId:pi,toothCode:'11',quantity:1,unitPrice:1})).status,400);
 assert.equal((await call(`/api/encounters/${eid}/treatments`,doc,'POST',{expectedVersion:0,serviceId:1,planItemId:pi,toothCode:'11',quantity:1,outcome:'检查完成'})).status,201);
 assert.equal((await call('/api/invoices',cash,'POST',{encounterId:eid})).status,409);
 assert.equal((await call(`/api/encounters/${eid}/sign`,assist,'POST',{})).status,403);
 assert.equal((await call(`/api/encounters/${eid}/sign`,doc,'POST',{})).status,200);
 assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(a.id).status,'arrived');
 assert.equal((await call(`/api/encounters/${eid}/treatments`,doc,'POST',{expectedVersion:1,serviceId:1,quantity:1,outsidePlanReason:'已签署不再追加',patientConfirmed:true})).status,409);
 const billed=await call('/api/invoices',cash,'POST',{encounterId:eid});assert.equal(billed.status,201,JSON.stringify(billed.body));let invoice=billed.body.invoice;
 assert.equal((await call(`/api/invoices/${invoice.id}/payments`,front,'POST',{amount:100,expectedVersion:invoice.version,method:'cash'})).status,403);
 assert.equal((await call(`/api/invoices/${invoice.id}/payments`,cash,'POST',{amount:50,expectedVersion:invoice.version,method:'cash'})).status,400);
 assert.equal((await call(`/api/invoices/${invoice.id}/payments`,cash,'POST',{amount:100,expectedVersion:invoice.version,method:'微信'})).status,400);
 assert.equal((await call(`/api/encounters/${eid}/treatment-confirmation`,doc,'PUT',{expectedVersion:1,reason:'核实实际项目',outsidePlanReason:'本次追加的检查已说明并确认',patientConfirmed:true,items:[{serviceId:1,toothCode:'11',quantity:2}]})).status,200);
 assert.equal((await call(`/api/invoices/${invoice.id}/payments`,cash,'POST',{amount:200,expectedVersion:invoice.version,method:'cash'})).status,409);
 invoice=(await call(`/api/invoices/${invoice.id}`,cash)).body.invoice;
 const paid=await call(`/api/invoices/${invoice.id}/payments`,cash,'POST',{amount:250,expectedVersion:invoice.version,method:'cash'});assert.equal(paid.status,201,JSON.stringify(paid.body));assert.equal(paid.body.receipt.changeAmount,50);assert.equal(paid.body.invoice.balance,0);
 const paidAgain=await call(`/api/invoices/${invoice.id}/payments`,cash,'POST',{amount:250,expectedVersion:invoice.version,method:'cash'});assert.equal(paidAgain.status,200);assert.equal(paidAgain.body.receipt.receiptNo,paid.body.receipt.receiptNo);
 assert.equal((await call(`/api/invoices/${invoice.id}/refunds`,owner,'POST',{})).status,410);
 assert.equal((await call(`/api/encounters/${eid}/treatment-confirmation`,doc,'PUT',{expectedVersion:2,reason:'结清后不可覆盖',items:[{serviceId:1,quantity:1}]})).status,409);
 const fuInput={type:'revisit',patientId:1,encounterId:eid,reason:'复查本次检查结果',dueDate:input.startAt.slice(0,10),assignedTo:front.user.id};
 assert.equal((await call('/api/followups',front,'POST',fuInput)).status,403);
 assert.equal((await call('/api/followups',doc,'POST',{...fuInput,patientId:2})).status,409);
 const fu=await call('/api/followups',doc,'POST',fuInput);assert.equal(fu.status,201,JSON.stringify(fu.body));const fid=fu.body.id;
 assert.equal((await call(`/api/followups/${fid}`,front,'PATCH',{status:'completed',result:'越权评估'})).status,403);
 assert.equal((await call(`/api/followups/${fid}`,front,'PATCH',{status:'pending',result:'未接通',nextContactDate:fuInput.dueDate})).status,200);
 assert.equal((await call(`/api/followups/${fid}`,front,'PATCH',{status:'scheduled',result:'已约复诊'})).status,400);
 const revisit=await call('/api/appointments',front,'POST',input);assert.equal(revisit.status,201,JSON.stringify(revisit.body));
 assert.equal((await call(`/api/followups/${fid}`,front,'PATCH',{status:'scheduled',result:'联系成功并安排复诊',appointmentId:revisit.body.appointment.id})).status,200);
 assert.equal((await call(`/api/followups/${fid}`,doc,'PATCH',{status:'completed',result:'复诊尚未到诊'})).status,409);
 assert.ok((await call(`/api/followups/${fid}`,front)).body.followup.history.length>=3);
 assert.equal((await call('/api/materials',front)).status,403);const ms=await call('/api/materials',assist);assert.equal(ms.status,200);const material=ms.body.items[0];
 assert.equal((await call(`/api/materials/${material.id}/movements`,assist,'POST',{type:'issue',quantity:material.stock_quantity+1,reason:'不得超领'})).status,409);
 assert.equal((await call(`/api/materials/${material.id}/movements`,assist,'POST',{type:'issue',quantity:1,reason:'诊疗实际领用'})).status,201);
 const summary=await call(`/api/reconciliations?date=${today}`,cash);assert.equal(summary.status,200);assert.equal(summary.body.summary.expectedCash,200);
 assert.equal((await call('/api/reconciliations',cash,'POST',{date:today,countedCash:190})).status,400);
 assert.equal((await call('/api/reconciliations',cash,'POST',{date:today,countedCash:200,resolutionNote:'现金与收据一致'})).status,201);
 db.prepare("UPDATE invoices SET created_at='2000-01-01T00:00:00Z' WHERE id=?").run(invoice.id);const report=await call(`/api/reports/summary?from=${today}&to=${today}`,owner);assert.equal(report.body.money.paid,200);
 for(const path of ['/','/app.js','/styles.css','/patient.html'])assert.equal((await fetch(base+path)).status,200);
});
