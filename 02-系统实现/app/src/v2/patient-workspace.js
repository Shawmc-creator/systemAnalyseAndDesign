'use strict';
const {fail,id,row,text}=require('./common');
const PERMISSIONS={dentist:'uc09.query',frontdesk:'uc08.maintain',cashier:'uc06.query'};
const TABS={dentist:['summary','information','clinical','plans','quotes','documents','fees','prescriptions','followups','history'],frontdesk:['summary','information','appointments','followups','history'],cashier:['summary','information','quotes','finance','history']};
class PatientWorkspace{
 constructor(db,unit,clinical){Object.assign(this,{db,unit,clinical});}
 permission(credentials){this.unit.auth.session(credentials.token);const p=PERMISSIONS[credentials.role];if(!p)fail(403,'FORBIDDEN','请使用前台、牙医或收费岗位进入患者工作区');return p;}
 visible(ctx,visit){if(ctx.authority.role!=='dentist')return true;try{this.clinical.scope(ctx,visit.id,'read');return true;}catch(e){if(e.code==='CLINICAL_SCOPE')return false;throw e;}}
 candidates(credentials,input={}){return this.unit.query(credentials,this.permission(credentials),ctx=>{
  const q=input.q==null||input.q===''?'':text(input.q,'患者查找线索',80),pattern='%'+q.replace(/[!%_]/g,'!$&')+'%',doctor=ctx.authority.role==='dentist',now=this.unit.auth.now();
  const rows=this.db.prepare(`SELECT p.id,p.name,p.record_no,p.phone,p.phone_owner,p.birth_date,p.contact_unavailable_reason FROM patient p WHERE (p.name LIKE ? ESCAPE '!' OR p.phone LIKE ? ESCAPE '!' OR p.record_no=?) AND (?=0 OR EXISTS(SELECT 1 FROM visit v WHERE v.patient_id=p.id AND (v.dentist_id=? OR EXISTS(SELECT 1 FROM clinical_handover h WHERE h.patient_id=p.id AND h.receiving_dentist_id=? AND h.valid_from<=? AND (h.valid_until IS NULL OR h.valid_until>?))))) ORDER BY p.id DESC LIMIT 101`).all(pattern,pattern,q,doctor?1:0,ctx.session.staff_id,ctx.session.staff_id,now,now).filter(p=>!doctor||this.db.prepare('SELECT id FROM visit WHERE patient_id=? ORDER BY id DESC').all(p.id).some(v=>this.visible(ctx,v)));
  return {items:rows.slice(0,100),hasMore:rows.length>100};
 });}
 query(credentials,input={}){return this.unit.query(credentials,this.permission(credentials),ctx=>{
  const patientId=id(Number(input.patientId),'患者'),p=row(this.db,'patient',patientId),doctor=ctx.authority.role==='dentist';
  const visits=this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.dentist_id,v.arrived_at,v.started_at,v.ended_at,v.status,v.arrival_source,s.name dentist_name,r.status record_status,r.signed_at FROM visit v JOIN staff s ON s.id=v.dentist_id JOIN clinical_record r ON r.visit_id=v.id WHERE v.patient_id=? ORDER BY v.arrived_at DESC,v.id DESC`).all(patientId).filter(v=>this.visible(ctx,v));
  const selectedId=input.visitId==null||input.visitId===''?visits[0]?.id:id(Number(input.visitId),'就诊');
  const selected=visits.find(v=>v.id===selectedId)||null;
  if(doctor&&!selected||selectedId&&!selected)fail(403,'WORKSPACE_SCOPE','患者与所选就诊不一致，或当前牙医没有获准的就诊范围');
  const appointmentRows=this.db.prepare(`SELECT a.*,d.name dentist_name,c.name chair_name,s.dentist_id,s.dental_chair_id,v.id visit_id,v.status visit_status FROM appointment a LEFT JOIN resource_occupancy o ON o.id=(SELECT x.id FROM resource_occupancy x WHERE x.appointment_id=a.id ORDER BY x.id DESC LIMIT 1) LEFT JOIN dated_schedule s ON s.id=o.dated_schedule_id LEFT JOIN staff d ON d.id=s.dentist_id LEFT JOIN dental_chair c ON c.id=s.dental_chair_id LEFT JOIN visit v ON v.appointment_id=a.id WHERE a.patient_id=? ORDER BY a.planned_start DESC,a.id DESC`).all(patientId).filter(a=>!doctor||a.dentist_id===ctx.session.staff_id||visits.some(v=>v.id===a.visit_id));
  const patient={id:p.id,name:p.name,record_no:p.record_no,birth_date:p.birth_date,phone:p.phone,phone_owner:p.phone_owner,contact_preference:p.contact_preference,contact_unavailable_reason:p.contact_unavailable_reason,...(ctx.authority.role==='frontdesk'?{address:p.address,revision:p.revision}:{})};
  const visitDTO=v=>doctor?v:Object.fromEntries(Object.entries(v).filter(([k])=>!['record_status','signed_at'].includes(k)));
  let feeSources=[];
  if(doctor)feeSources=this.db.prepare(`SELECT e.id,e.visit_id,e.tooth_code,e.surface_code,e.completed_quantity,e.completed_at,s.name service_name,s.billing_unit,b.pricing_status,NOT EXISTS(SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=e.id) is_effective FROM treatment_execution e JOIN visit v ON v.id=e.visit_id JOIN service s ON s.id=e.service_id LEFT JOIN bill_item b ON b.treatment_execution_id=e.id WHERE v.patient_id=? ORDER BY e.completed_at DESC,e.id DESC`).all(patientId).filter(e=>visits.some(v=>v.id===e.visit_id));
  const changes=ctx.authority.role==='frontdesk'?this.db.prepare('SELECT field_name,old_value,new_value,reason,occurred_at FROM patient_change WHERE patient_id=? ORDER BY id DESC LIMIT 100').all(patientId):[];
  ctx.authority.patientId=patientId;ctx.authority.returnedVisitIds=visits.map(v=>v.id);ctx.authority.visitId=selected?.id||null;
  return {patient,visits:visits.map(visitDTO),selectedVisit:selected?visitDTO(selected):null,tabs:TABS[ctx.authority.role],canEditPatient:ctx.authority.role==='frontdesk',appointments:appointmentRows.slice(0,100),appointmentCount:appointmentRows.length,feeSources,patientChanges:changes,now:this.unit.auth.now()};
 });}
}
module.exports={PatientWorkspace};
