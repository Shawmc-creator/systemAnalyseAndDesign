'use strict';
const crypto=require('node:crypto');
const {fail,id,text,instant,insert,canonical,hash}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {hasBranchRole}=require('./chain-access');

// Isolated prototype. It is intentionally absent from the live server and
// only supports a manager holding authority in both participating branches.
class ChainGrantsTrial {
 constructor(app) {
  this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!=='')) throw new Error('授权试验仅允许内存数据库');
 }
 command(credentials,input) {
  if(!credentials.csrf) fail(403,'CSRF_INVALID','缺少安全令牌');
  if(credentials.role!=='manager'||!input||!['grant','revoke'].includes(input.action)) fail(403,'FORBIDDEN','需要负责人授权');
  const key=text(input.requestKey,'提交号',100);if(input.commandVersion!==1) fail(422,'INVALID_INPUT','提交版本无效');
  const digest=hash(canonical({permission:'clinic.manage',input}));
  this.db.exec('BEGIN IMMEDIATE');
  try {
   let grant=null;
   if(input.action==='revoke') grant=this.db.prepare('SELECT * FROM cross_branch_record_access WHERE id=?').get(id(input.grantId,'授权'));
   if(input.action==='revoke'&&!grant) fail(404,'NOT_FOUND','授权记录不存在');
   const source=id(grant?.source_branch_id??input.sourceBranchId,'来源门店'),target=id(grant?.target_branch_id??input.targetBranchId,'目标门店');
   if(source===target) fail(422,'INVALID_INPUT','来源与目标门店应不同');
   const ctx=this.access.authorizeBranch(credentials,'clinic.manage',source);
   this.access.authorizeBranch(credentials,'clinic.manage',target);
   ctx.authority={...ctx.authority,sourceBranchId:source,targetBranchId:target};
   const previous=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(previous) {
    if(previous.permission_id!==ctx.permission.id||previous.payload_digest!==digest||previous.result_kind!=='cross_branch_record_access') fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');
    this.db.exec('COMMIT');return {id:Number(previous.result_key),revision:previous.result_revision,replayed:true};
   }
   const same=this.db.prepare("SELECT 1 FROM clinic_branch a JOIN clinic_branch b ON b.chain_id=a.chain_id WHERE a.id=? AND b.id=? AND a.status='active' AND b.status='active'").get(source,target);
   if(!same)fail(409,'BRANCH_MISMATCH','两门店须属于同一启用连锁');
   const now=this.auth.now(),reason=text(input.reason,'授权或撤销依据',2000);let keyId,rev,code;
   if(input.action==='grant') {
    const dentist=id(input.dentistId,'牙医'),patient=id(input.patientId,'患者'),visit=id(input.visitId,'来源就诊');
    const scope=input.scope;if(!['health','record','plan','prescription','document','all'].includes(scope))fail(422,'INVALID_INPUT','授权资料范围无效');
    const until=input.validUntil?instant(input.validUntil,'授权截止时间'):null;
    if(until&&until<=now)fail(422,'INVALID_INPUT','授权截止须晚于当前时间');
    if(!this.db.prepare('SELECT 1 FROM visit WHERE id=? AND patient_id=? AND branch_id=?').get(visit,patient,source)) fail(409,'VISIT_SOURCE','患者、来源就诊及门店不一致');
    const account=this.db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(dentist);
    if(!account||!this.auth.roles(account.id,now).some(r=>r.code==='dentist')||!hasBranchRole(this.db,{staffId:dentist,branchId:target,role:'dentist',at:now}))
     fail(409,'DENTIST_UNAVAILABLE','牙医须具备有效资格及目标门店岗位授权');
    if(this.db.prepare(`SELECT 1 FROM cross_branch_record_access WHERE dentist_id=? AND patient_id=? AND visit_id=? AND source_branch_id=? AND target_branch_id=?
      AND (scope=? OR scope='all' OR ?='all') AND (revoked_at IS NULL OR revoked_at>?) AND (valid_until IS NULL OR valid_until>?) LIMIT 1`).get(dentist,patient,visit,source,target,scope,scope,now,now))
     fail(409,'GRANT_EXISTS','该范围已有有效授权');
    keyId=insert(this.db,'cross_branch_record_access',{dentist_id:dentist,patient_id:patient,visit_id:visit,source_branch_id:source,target_branch_id:target,
     scope,valid_from:now,valid_until:until,granted_by:ctx.session.staff_id,granted_at:now,evidence:reason,revoked_at:null,revoked_by:null});
    rev=1;code='CROSS_BRANCH_GRANT';
   } else {
    if(grant.revoked_at)fail(409,'GRANT_REVOKED','该授权已经撤销');
    this.db.prepare('UPDATE cross_branch_record_access SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL').run(now,ctx.session.staff_id,grant.id);
    keyId=grant.id;rev=2;code='CROSS_BRANCH_REVOKE';
   }
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:'cross_branch_record_access',result_key:String(keyId),result_revision:rev,result_code:code,correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更',code,{kind:'cross_branch_record_access',key:keyId,revision:rev},sid,reason);
   this.db.exec('COMMIT');return {id:keyId,revision:rev,replayed:false};
  } catch(error) {if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
module.exports={ChainGrantsTrial};
