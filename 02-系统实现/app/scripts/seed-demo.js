const path=require('node:path');
const {createDatabase,nextNo,audit}=require('../src/db');
const svc=require('../src/services');
const rules=require('../src/requirements');
const {recordMaterialMovement,listMaterials}=require('../src/materials');
const file=process.env.CLINIC_DB||path.join(__dirname,'..','data','clinic.db');
function seedDemo(db){
 if(db.prepare("SELECT id FROM audit_events WHERE action='demo.requirements.v2' LIMIT 1").get())return {existing:true};
 const staff=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.username,u]));const {frontdesk,dentist,cashier,manager,assistant}=staff;
 const service=db.prepare("SELECT * FROM services WHERE code='EXAM'").get();
 function patient(name,phone){const prior=db.prepare('SELECT id FROM patients WHERE phone=?').get(phone);if(prior)return prior.id;return Number(db.prepare('INSERT INTO patients(patient_no,full_name,phone,notes) VALUES(?,?,?,?)').run(nextNo(db,'patients','patient_no','P'),name,phone,'当前需求流程演示').lastInsertRowid);}
 function future(pid){
  const day=new Date();for(let n=1;n<15;n++){const start=new Date(day.getFullYear(),day.getMonth(),day.getDate()+n,10,0),end=new Date(start.getTime()+30*60000);const input={patientId:pid,dentistId:dentist.id,chairId:1,serviceId:service.id,startAt:start.toISOString(),endAt:end.toISOString(),arrangementConfirmedBy:dentist.id,arrangementConfirmedAt:new Date().toISOString()};
   try{svc.validateAvailability(db,{dentistId:dentist.id,chairId:1,serviceId:service.id,startAt:start,endAt:end});if(svc.findConflict(db,{dentistId:dentist.id,chairId:1,patientId:pid,startAt:input.startAt,endAt:input.endAt}))continue;return svc.createAppointment(db,input,frontdesk);}catch(e){if(e.status!==409)throw e;}
  }throw new Error('没有可用于演示的接诊时段');
 }
 function historical(pid,offset){
  const d=new Date();d.setDate(d.getDate()-offset);while(d.getDay()===0)d.setDate(d.getDate()-1);d.setHours(10,0,0,0);const end=new Date(d.getTime()+30*60000);
  const ap=Number(db.prepare("INSERT INTO appointments(appointment_no,patient_id,dentist_id,chair_id,service_id,start_at,end_at,status,created_by,arrangement_confirmed_by,arrangement_confirmed_at) VALUES(?,?,?,?,?,?,?,'arrived',?,?,?)").run(nextNo(db,'appointments','appointment_no','A'),pid,dentist.id,1,service.id,d.toISOString(),end.toISOString(),frontdesk.id,dentist.id,d.toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO appointment_history(appointment_id,from_status,to_status,reason,changed_by) VALUES(?,NULL,'arrived','历史到诊演示记录',?)").run(ap,frontdesk.id);
  const id=Number(db.prepare("INSERT INTO encounters(encounter_no,patient_id,appointment_id,dentist_id,status,started_at,chief_complaint,relevant_history,diagnosis,clinical_notes,instructions) VALUES(?,?,?,?,'draft',?,'口腔检查','相关病史已记录','检查所见已记录','实际检查已完成','按牙医本次诊后安排联系')").run(nextNo(db,'encounters','encounter_no','E'),pid,ap,dentist.id,d.toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO tooth_findings(encounter_id,tooth_code,finding,created_by) VALUES(?,'11','已检查并记录',?)").run(id,dentist.id);
  return {id,appointmentId:ap};
 }
 const names=['预约安排示例','诊疗记录示例','待结算示例','现金找零示例'];const patients=names.map((n,i)=>patient(n,'13800008'+String(i+1).padStart(3,'0')));
 const appointment=future(patients[0]);const draft=historical(patients[1],1);const pending=historical(patients[2],3);const paidVisit=historical(patients[3],5);
 for(const v of [pending,paidVisit]){rules.addTreatment(db,v.id,{serviceId:service.id,quantity:1,outsidePlanReason:'已说明并完成检查项目',patientConfirmed:true,outcome:'实际检查完成'},dentist);svc.signEncounter(db,v.id,dentist);}
 const pendingInvoice=rules.createInvoice(db,pending.id,cashier),paidInvoice=rules.createInvoice(db,paidVisit.id,cashier);
 const paid=rules.receiveCash(db,paidInvoice.id,{expectedVersion:paidInvoice.version,amount:paidInvoice.gross_amount+50,method:'cash'},cashier);
 const next=new Date();next.setDate(next.getDate()+2);const dueDate=[next.getFullYear(),String(next.getMonth()+1).padStart(2,'0'),String(next.getDate()).padStart(2,'0')].join('-');
 const follow=rules.createFollowup(db,{type:'revisit',requestId:'seed-v2-followup-pending',patientId:patients[2],encounterId:pending.id,reason:'牙医提出复诊联系要求',dueDate,assignedTo:frontdesk.id},dentist);
 rules.updateFollowup(db,follow.id,{requestId:'seed-v2-contact-pending',expectedVersion:follow.version,contactedAt:new Date().toISOString(),status:'pending',result:'首次联系未接通，保留下次联系安排',nextContactDate:dueDate},frontdesk);
 const completed=rules.createFollowup(db,{type:'revisit',requestId:'seed-v2-followup-complete',patientId:patients[3],encounterId:paidVisit.id,reason:'复核前次诊疗结果',dueDate,assignedTo:frontdesk.id},dentist);
 const rv=historical(patients[3],2);svc.signEncounter(db,rv.id,dentist);
 rules.updateFollowup(db,completed.id,{requestId:'seed-v2-contact-scheduled',expectedVersion:completed.version,contactedAt:new Date().toISOString(),status:'scheduled',result:'已联系患者并核对复诊安排',appointmentId:rv.appointmentId},frontdesk);
 rules.updateFollowup(db,completed.id,{requestId:'seed-v2-assessment-completed',expectedVersion:completed.version+1,recovery:'诊后情况稳定',conclusion:'本次复诊已完成',opinion:'继续按医嘱维护',status:'completed',result:'复诊结果已由接诊牙医记录，后续意见见本次病历'},dentist);
 const m=listMaterials(db).items[0];if(m)recordMaterialMovement(db,m.id,{requestId:'seed-v2-material-inbound',expectedVersion:m.version,type:'inbound',quantity:5,reason:'演示材料实物入库核对'},assistant);
 const date=db.prepare("SELECT date('now','localtime') day").get().day;const summary=rules.dailySummary(db,date);rules.recordReconciliation(db,{requestId:'seed-v2-cash-reconcile',basisHash:summary.basisHash,date,countedCash:summary.expectedCash,resolutionNote:'收费人员核对现金与结算凭据一致'},cashier);
 const result={appointmentId:appointment.id,draftEncounterId:draft.id,pendingInvoiceId:pendingInvoice.id,paidInvoiceId:paidInvoice.id,receiptNo:paid.receipt.receiptNo,followupId:follow.id,completedFollowupId:completed.id};audit(db,manager.id,'demo.requirements.v2','system',null,null,result);return result;
}
if(require.main===module){const db=createDatabase(file);try{console.log(JSON.stringify(seedDemo(db),null,2));}finally{db.close();}}
module.exports={seedDemo};
