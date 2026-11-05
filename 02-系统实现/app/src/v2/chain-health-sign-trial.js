'use strict';
const crypto=require('node:crypto');
const {id,text,instant,fail,row,revision,insert,fact,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {clinicalSnapshot,validateClinical,signaturePayload}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');
const categories=['病史','过敏','用药'];

class ChainHealthSignTrial{
 constructor(app,recordTrial){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.records=recordTrial;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('健康与签署试验仅允许内存数据库');}
 latest(credentials,branch,visit){
  const latest=this.db.prepare('SELECT * FROM health_version WHERE patient_id=? ORDER BY version_no DESC LIMIT 1').get(visit.patient_id);if(!latest)return null;
  if(!latest.source_visit_id)fail(409,'HEALTH_SOURCE_UNKNOWN','健康资料来源就诊不明，须先核对');
  const source=this.db.prepare('SELECT * FROM visit WHERE id=? AND patient_id=?').get(latest.source_visit_id,visit.patient_id);
  if(!source||!source.branch_id)fail(409,'HEALTH_SOURCE_UNKNOWN','健康资料来源门店不明，须先核对');
  if(source.branch_id!==branch)this.access.authorizeCrossBranchRead(credentials,{scope:'health',sourceBranchId:source.branch_id,targetBranchId:branch,patientId:visit.patient_id,visitId:source.id});
  return latest;
 }
 detail(credentials,branchId,visitId){const branch=id(branchId,'门店'),visitIdValue=id(visitId,'就诊');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc09.query',branch),{visit,record}=this.records.scope(ctx,branch,visitIdValue),latest=this.latest(credentials,branch,visit);
  const items=latest?this.db.prepare('SELECT category,certainty,content,source,reported_at,occurred_at FROM health_item WHERE health_version_id=? ORDER BY id').all(latest.id):[];
  const review=this.db.prepare('SELECT id,health_version_id,conclusion,reviewed_at FROM health_review WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(visit.id)||null;
  this.unit.audit(ctx,'查询','CHAIN_HEALTH_READ',{kind:'visit',key:visit.id},null,'查询本人本店就诊的健康资料及复核');this.db.exec('COMMIT');return {version:latest?{id:latest.id,version_no:latest.version_no,source_visit_id:latest.source_visit_id}:null,items,review,recordStatus:record.status};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 command(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['health','sign'].includes(input.action))fail(422,'INVALID_ACTION','临床操作无效');
  const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),key=text(input.requestKey,'提交号',100),permission=input.action==='health'?'uc21.health':'uc11.sign',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),{visit,record}=this.records.scope(ctx,branch,visitId),latest=this.latest(credentials,branch,visit);
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key),expectedKind=input.action==='health'?'health_review':'clinical_record';
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!==expectedKind)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    const own=input.action==='health'?this.db.prepare('SELECT 1 FROM health_review WHERE id=? AND visit_id=?').get(Number(old.result_key),visit.id):Number(old.result_key)===record.id;
    if(!own)fail(409,'VISIT_SCOPE','原提交归属待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   if(record.status!=='草稿')fail(409,'RECORD_SIGNED','已签署病历不可覆盖或再次复核');
   const now=this.auth.now(),before=clinicalSnapshot(this.db);let resultId,resultRevision,reason,beforeRevision=null;
   if(input.action==='health'){
    if((input.expectedHealthVersionId??null)!==(latest?.id??null))fail(409,'HEALTH_VERSION_CONFLICT','健康资料已变化，请重新核对');
    if(!Array.isArray(input.items)||input.items.length!==3||new Set(input.items.map(i=>i.category)).size!==3)fail(422,'HEALTH_INCOMPLETE','病史、过敏、用药须分别记录');
    const items=categories.map(category=>{const i=input.items.find(x=>x.category===category);if(!i||!['有','无','未知'].includes(i.certainty))fail(422,'HEALTH_INCOMPLETE','每类须明确有、无或未知');
     const reported=instant(i.reportedAt,'报告时间'),occurred=i.occurredAt?instant(i.occurredAt,'发生时间'):null;if(reported>now||(occurred&&occurred>now))fail(422,'FUTURE_FACT','健康资料时间不能在未来');
     return {category,certainty:i.certainty,content:text(i.content,'健康资料内容',2000),source:text(i.source,'报告来源',2000),reported_at:reported,occurred_at:occurred};});
    const effective=instant(input.effectiveAt||now,'生效时间');if(effective>now||(latest&&effective<latest.effective_at))fail(422,'HEALTH_EFFECTIVE_TIME','健康生效时间无效');
    const facts=list=>list.map(i=>[i.category,i.certainty,i.content,i.occurred_at]);const existing=latest?this.db.prepare('SELECT * FROM health_item WHERE health_version_id=?').all(latest.id).sort((a,b)=>categories.indexOf(a.category)-categories.indexOf(b.category)):[];
    let versionId=latest?.id;if(!latest||canonical(facts(items))!==canonical(facts(existing))){versionId=insert(this.db,'health_version',fact(now,{patient_id:visit.patient_id,source_visit_id:visit.id,formed_at:now,change_reason:text(input.reason,'健康变更原因',2000),version_no:latest?latest.version_no+1:1,effective_at:effective,created_by:ctx.session.staff_id,previous_version_id:latest?.id||null}));
     for(const i of items)insert(this.db,'health_item',fact(now,{health_version_id:versionId,...i}));}
    resultId=insert(this.db,'health_review',fact(now,{visit_id:visit.id,health_version_id:versionId,reviewed_at:now,conclusion:text(input.conclusion,'复核结论',2000),reviewed_by:ctx.session.staff_id}));
    resultRevision=1;ctx.authority.healthVersionId=versionId;reason='完成当次健康资料复核';
   }else{
    if(record.id!==id(input.recordId,'病历'))fail(409,'RECORD_MISMATCH','病历与就诊不一致');revision(record,input.expectedRevision);
    if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','请确认逐项核对病历');
    for(const [field,label] of [['chief_complaint','主诉'],['diagnosis','诊断'],['treatment_advice','诊疗建议']])text(record[field],label,4000);
    const payload=signaturePayload(this.db,record);if(!payload.findings.length||!payload.healthReviews.length)fail(409,'SIGNING_INCOMPLETE','须保存检查所见并完成健康复核');
    if(!latest||payload.healthReviews.at(-1).health_version_id!==latest.id)fail(409,'HEALTH_REVIEW_STALE','健康资料已变化，请重新复核');
    this.db.prepare("UPDATE clinical_record SET status='已签署',signed_at=?,signed_by=?,signed_revision=?,signed_health_review_id=?,content_hash=?,updated_at=?,revision=revision+1 WHERE id=?")
     .run(now,ctx.session.staff_id,record.revision,payload.healthReviews[0].id,hash(canonical(payload)),now,record.id);
    resultId=record.id;beforeRevision=record.revision;resultRevision=record.revision+1;ctx.authority.healthReviewIds=payload.healthReviews.map(r=>r.id);reason='签署病历并冻结所见及当次健康复核';
   }
   this.unit.validateReception();validateClinical(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:expectedKind,result_key:String(resultId),result_revision:resultRevision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:expectedKind,key:resultId,beforeRevision,revision:resultRevision},sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainHealthSignTrial};
