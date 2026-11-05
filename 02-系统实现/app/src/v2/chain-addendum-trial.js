'use strict';
const crypto=require('node:crypto');
const {id,text,fail,revision,insert,fact,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {clinicalSnapshot,validateClinical,signedIntegrity}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');

class ChainAddendumTrial{
 constructor(app,records){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.records=records;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('补充试验仅允许内存数据库');}
 append(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1)fail(422,'COMMAND_VERSION','提交版本无效');
  const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),key=text(input.requestKey,'提交号',100),permission='uc11.sign',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),{record}=this.records.scope(ctx,branch,visitId);
   if(record.id!==id(input.recordId,'病历'))fail(409,'RECORD_MISMATCH','病历与就诊不一致');
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='record_addendum')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    if(!this.db.prepare('SELECT 1 FROM record_addendum WHERE id=? AND clinical_record_id=?').get(Number(old.result_key),record.id))fail(409,'RECORD_MISMATCH','原补充归属待核对');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   revision(record,input.expectedRevision);if(record.status!=='已签署')fail(409,'RECORD_UNSIGNED','只有已签署病历可追加补充');
   if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','请确认补充内容和原因');
   if(!signedIntegrity(this.db,record))fail(409,'SIGNED_CONTENT_CHANGED','原签署内容校验不通过');
   const content=text(input.content,'补充内容',8000),reason=text(input.reason,'补充原因',2000),now=this.auth.now(),before=clinicalSnapshot(this.db);
   const result=insert(this.db,'record_addendum',fact(now,{clinical_record_id:record.id,content,reason,added_at:now,
    content_hash:hash(canonical({recordId:record.id,content,reason,signedBy:ctx.session.staff_id,addedAt:now})),signed_by:ctx.session.staff_id}));
   this.unit.validateReception();validateClinical(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:'record_addendum',result_key:String(result),result_revision:1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'record_addendum',key:result,revision:1},sid,reason);
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainAddendumTrial};
