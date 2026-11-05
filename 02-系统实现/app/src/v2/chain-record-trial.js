'use strict';
const crypto=require('node:crypto');
const {id,text,fail,row,revision,insert,fact,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {clinicalSnapshot,validateClinical,signedIntegrity}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');

// Draft only: no signing, health review, handover or cross-store writing.
class ChainRecordTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('病历试验仅允许内存数据库');}
 scope(ctx,branch,visitId){const visit=row(this.db,'visit',visitId);
  if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id)fail(403,'VISIT_SCOPE','仅可办理本店本人负责的就诊');
  if(!['接诊中','诊疗结束'].includes(visit.status)||!visit.started_at)fail(409,'VISIT_NOT_ACTIVE','须先开始接诊');
  const record=this.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(visitId);if(!record)fail(409,'RECORD_MISSING','就诊病历缺失');
  ctx.authority={...ctx.authority,branchId:branch,visitId,patientId:visit.patient_id,recordId:record.id};return {visit,record};}
 detail(credentials,branchId,visitId){const branch=id(branchId,'门店'),visit=id(visitId,'就诊');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc09.query',branch),result=this.scope(ctx,branch,visit);
  const findings=this.db.prepare('SELECT id,sequence_no,tooth_code,surface_code,finding_text FROM clinical_finding WHERE clinical_record_id=? ORDER BY sequence_no').all(result.record.id);
  const addenda=this.db.prepare('SELECT id,content,reason,added_at,signed_by FROM record_addendum WHERE clinical_record_id=? ORDER BY id').all(result.record.id);
  const executions=this.db.prepare(`SELECT e.id,e.record_no,e.tooth_code,e.surface_code,e.completed_quantity,e.procedure_note,e.correction_reason,e.completed_at,e.execution_kind,s.name service_name,s.billing_unit,NOT EXISTS(SELECT 1 FROM treatment_execution next WHERE next.original_execution_id=e.id) is_current FROM treatment_execution e JOIN service s ON s.id=e.service_id WHERE e.visit_id=? AND e.branch_id=? ORDER BY e.completed_at,e.id`).all(visit,branch);
  const r=result.record,valid=r.status==='已签署'?signedIntegrity(this.db,r):null;this.unit.audit(ctx,'查询','CHAIN_RECORD_DRAFT_READ',{kind:'clinical_record',key:r.id},null,'查询本人本店病历草稿');
  this.db.exec('COMMIT');return {record:{id:r.id,revision:r.revision,status:r.status,signed_at:r.signed_at,signature_valid:valid,chief_complaint:r.chief_complaint,diagnosis:r.diagnosis,treatment_advice:r.treatment_advice},findings,addenda,executions};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 save(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1)fail(422,'COMMAND_VERSION','提交版本无效');
  const branch=id(input.branchId,'门店'),visit=id(input.visitId,'就诊'),key=text(input.requestKey,'提交号',100),permission='uc10.record',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),{record}=this.scope(ctx,branch,visit);
   if(record.id!==id(input.recordId,'病历'))fail(409,'RECORD_MISMATCH','病历与就诊不一致');
   const previous=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(previous){if(previous.permission_id!==ctx.permission.id||previous.payload_digest!==digest||previous.result_kind!=='clinical_record'||Number(previous.result_key)!==record.id)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    this.db.exec('COMMIT');return {...this.unit.result(previous),replayed:true};}
   revision(record,input.expectedRevision);if(record.status!=='草稿')fail(409,'RECORD_SIGNED','已签署病历不能覆盖');
   const optional=(v,label)=>v==null||v===''?null:text(v,label,4000);
   const chief=optional(input.chiefComplaint,'主诉'),diagnosis=optional(input.diagnosis,'诊断'),advice=optional(input.treatmentAdvice,'诊疗建议');
   if(!Array.isArray(input.findings)||input.findings.length>100)fail(422,'FINDINGS_REQUIRED','检查所见须为不超过100项的列表');
   const existing=this.db.prepare('SELECT * FROM clinical_finding WHERE clinical_record_id=? ORDER BY sequence_no').all(record.id);
   const ids=input.findings.filter(f=>f.id!=null).map(f=>id(f.id,'所见'));if(new Set(ids).size!==ids.length||existing.some(f=>!ids.includes(f.id))||ids.some(i=>!existing.some(f=>f.id===i)))fail(422,'FINDING_SET','已有检查所见须保留且属于本病历');
   const now=this.auth.now(),before=clinicalSnapshot(this.db);
   for(let i=0;i<input.findings.length;i++){const f=input.findings[i],old=existing.find(e=>e.id===f.id),tooth=f.toothCode?text(f.toothCode,'牙位',8):null,surface=f.surfaceCode?text(f.surfaceCode,'牙面',8):null;
    if((tooth&&!/^(?:[1-4][1-8]|[5-8][1-5])$/.test(tooth))||(surface&&(!tooth||!/^[MODBLIP]+$/.test(surface))))fail(422,'TOOTH_SURFACE','牙位或牙面无效');
    const finding=text(f.text,'检查所见',4000);if(old){if(old.sequence_no!==i+1)fail(422,'FINDING_ORDER','已有所见须保留顺序');
     this.db.prepare('UPDATE clinical_finding SET tooth_code=?,surface_code=?,finding_text=?,recorded_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(tooth,surface,finding,ctx.session.staff_id,now,old.id);
    }else insert(this.db,'clinical_finding',fact(now,{clinical_record_id:record.id,tooth_code:tooth,surface_code:surface,finding_text:finding,sequence_no:i+1,recorded_by:ctx.session.staff_id}));}
   this.db.prepare('UPDATE clinical_record SET chief_complaint=?,diagnosis=?,treatment_advice=?,updated_at=?,revision=revision+1 WHERE id=?').run(chief,diagnosis,advice,now,record.id);
   this.unit.validateReception();validateClinical(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:'clinical_record',result_key:String(record.id),result_revision:record.revision+1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'clinical_record',key:record.id,beforeRevision:record.revision,revision:record.revision+1},sid,'保存本店本人接诊病历草稿');
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainRecordTrial};
