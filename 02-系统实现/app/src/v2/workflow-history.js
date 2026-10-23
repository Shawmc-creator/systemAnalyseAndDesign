'use strict';
const {insert,row,canonical,hash,fail}=require('./common');
const {CONFIG}=require('./workflow-history-schema');

// Business methods select the event. This repository only maps it to its typed storage.
class WorkflowHistoryRepository{
 constructor(db){this.db=db;}
 append(kind,objectId,eventType,eventReason,ctx,input,now,extra={}){
  const c=CONFIG[kind];if(!c)throw new Error('Unsupported workflow history owner');
  const current=row(this.db,kind,objectId),last=this.db.prepare(`SELECT coalesce(max(event_no),0) n FROM ${c.table} WHERE ${c.ownerField}=?`).get(objectId).n;
  const operationNo=hash(canonical({accountId:ctx.session.account_id,requestKey:input.requestKey,kind,objectId,eventType}));
  const id=insert(this.db,c.table,{[c.ownerField]:objectId,event_no:last+1,operation_no:operationNo,event_type:eventType,event_reason:eventReason,
   actor_id:ctx.session.staff_id,occurred_at:now,...Object.fromEntries(c.fields.map(f=>[f,current[f]])),...extra});
  (ctx.authority.workflowHistories??=[]).push({table:c.table,id,operationNo});return id;
 }
 list(kind,objectId){const c=CONFIG[kind];return this.db.prepare(`SELECT h.*,s.name actor_name FROM ${c.table} h JOIN staff s ON s.id=h.actor_id WHERE h.${c.ownerField}=? ORDER BY h.event_no`).all(objectId);}
 snapshot(){return {states:Object.fromEntries(Object.entries(CONFIG).filter(([,c])=>c.fields.length).map(([kind,c])=>[kind,{last:this.db.prepare(`SELECT coalesce(max(id),0) n FROM ${c.table}`).get().n,
  objects:new Map(this.db.prepare(`SELECT * FROM ${kind}`).all().map(r=>[r.id,canonical(Object.fromEntries(c.fields.map(f=>[f,r[f]])))]))}])),
  documents:new Map(this.db.prepare('SELECT * FROM document_version').all().map(r=>[r.id,r])),
  insurance:new Map(this.db.prepare('SELECT * FROM insurance_case').all().map(r=>[r.id,r])),
  lastCorrection:this.db.prepare('SELECT coalesce(max(id),0) n FROM document_correction').get().n,
  lastPreestimate:this.db.prepare('SELECT coalesce(max(id),0) n FROM insurance_preestimate_history').get().n};}
 validate(before,permission){
  for(const[kind,old]of Object.entries(before.states)){
   if(kind==='prescription'&&permission!=='pharmacy.review')continue;
   const c=CONFIG[kind];for(const current of this.db.prepare(`SELECT * FROM ${kind}`).all()){
    // A proposed follow-up becomes published only after its clinical source is ready.
    if(kind==='followup_requirement'&&current.status==='待发布')continue;
    const payload=canonical(Object.fromEntries(c.fields.map(f=>[f,current[f]])));
    if(old.objects.get(current.id)===payload)continue;
    const h=this.db.prepare(`SELECT * FROM ${c.table} WHERE ${c.ownerField}=? ORDER BY event_no DESC LIMIT 1`).get(current.id);
    if(!h||h.id<=old.last||canonical(Object.fromEntries(c.fields.map(f=>[f,h[f]])))!==payload)
     fail(409,'WORKFLOW_HISTORY_MISSING','本次业务结果缺少对应历史，已整体回滚');
   }
  }
  for(const current of this.db.prepare('SELECT * FROM document_version').all()){
   const old=before.documents.get(current.id);if(old?.status!=='原件已确认'||current.status!=='退回核对')continue;
   const h=this.db.prepare('SELECT * FROM document_correction WHERE document_version_id=? AND id>?').get(current.id,before.lastCorrection);
   if(!h||h.original_confirmed_by!==old.confirmed_by||h.original_confirmed_at!==old.confirmed_at||h.original_confirmation_note!==old.verification_note)
    fail(409,'WORKFLOW_HISTORY_MISSING','已确认原件归属更正必须共同保留原确认及更正历史');
  }
  for(const c of this.db.prepare('SELECT * FROM insurance_case WHERE current_preestimate_id IS NOT NULL').all()){
   const old=before.insurance.get(c.id),request=row(this.db,'insurance_preestimate_history',c.current_preestimate_id);
   if(request.insurance_case_id!==c.id||request.event_type!=='提交'||request.bill_id!==c.bill_id||request.identity_id!==c.identity_id||request.fee_revision!==c.fee_revision||request.diagnosis_code!==c.diagnosis_code)
    fail(409,'INSURANCE_HISTORY_CONTEXT','当前医保预结算与原提交不一致');
   if(old?.patient_choice!==c.patient_choice&&c.patient_choice!=='待确认'){
    const choice=this.db.prepare("SELECT id FROM insurance_preestimate_history WHERE insurance_case_id=? AND request_id=? AND event_type='患者选择' AND patient_choice=? AND id>?").get(c.id,request.id,c.patient_choice,before.lastPreestimate);
    if(!choice)fail(409,'WORKFLOW_HISTORY_MISSING','本次患者医保选择缺少对应原提交的历史');
   }
  }
 }
}
module.exports={WorkflowHistoryRepository};
