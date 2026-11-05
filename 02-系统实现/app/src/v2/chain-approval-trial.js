'use strict';
const crypto=require('node:crypto');
const {fail,id,text,instant,insert,canonical,hash}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {hasBranchRole}=require('./chain-access');

// Candidate two-manager flow: immutable existing audit entries carry the
// proposal and its decision; the live server never calls this prototype.
class ChainApprovalTrial {
 constructor(app){
  this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!=='')) throw new Error('协同授权试验仅允许内存数据库');
 }
 list(credentials,branchId){
  branchId=id(branchId,'门店');
  if(this.db.isTransaction)throw new Error('授权申请列表须独立查询');
  this.db.exec('BEGIN');
  try{
   const ctx=this.access.authorizeBranch(credentials,'clinic.manage',branchId);
   ctx.authority={...ctx.authority,branchId};
   const rows=this.db.prepare(`SELECT a.id,a.occurred_at,a.reason,a.authority_snapshot,
     (SELECT d.outcome_code FROM operation_audit d WHERE d.outcome_code IN ('CROSS_BRANCH_APPROVED','CROSS_BRANCH_REJECTED','CROSS_BRANCH_WITHDRAWN')
      AND json_extract(d.authority_snapshot,'$.proposalId')=a.id ORDER BY d.id DESC LIMIT 1) decision
     FROM operation_audit a WHERE a.outcome_code='CROSS_BRANCH_PROPOSAL' AND a.object_kind='cross_branch_access_proposal'
     AND (json_extract(a.authority_snapshot,'$.proposal.sourceBranchId')=? OR json_extract(a.authority_snapshot,'$.proposal.targetBranchId')=?) ORDER BY a.id DESC`).all(branchId,branchId);
   const now=this.auth.now();
   const items=rows.map(r=>{const p=JSON.parse(r.authority_snapshot).proposal;
    const status=({CROSS_BRANCH_APPROVED:'已确认',CROSS_BRANCH_REJECTED:'已拒绝',CROSS_BRANCH_WITHDRAWN:'已撤回'})[r.decision] || (p.validUntil<=now?'已过期':'待确认');
    return {id:r.id,sourceBranchId:p.sourceBranchId,targetBranchId:p.targetBranchId,dentistId:p.dentistId,patientId:p.patientId,visitId:p.visitId,scope:p.scope,validUntil:p.validUntil,submittedAt:r.occurred_at,reason:r.reason,status};});
   this.unit.audit(ctx,'查询','CROSS_BRANCH_PROPOSAL_LIST',{kind:'cross_branch_access_proposal',key:'branch:'+branchId},null,'按授权门店查询申请');
   this.db.exec('COMMIT');return {items};
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
 command(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(credentials.role!=='manager'||!input||!['propose','approve','reject','withdraw'].includes(input.action))fail(403,'FORBIDDEN','需要负责人权限');
  const key=text(input.requestKey,'提交号',100);if(input.commandVersion!==1)fail(422,'INVALID_INPUT','提交版本无效');
  const digest=hash(canonical({permission:'clinic.manage',input}));
  this.db.exec('BEGIN IMMEDIATE');
  try{
   let proposal,original;
   if(input.action!=='propose'){
    original=this.db.prepare("SELECT * FROM operation_audit WHERE id=? AND outcome_code='CROSS_BRANCH_PROPOSAL' AND object_kind='cross_branch_access_proposal'").get(id(input.proposalId,'申请'));
    if(!original)fail(404,'NOT_FOUND','授权申请不存在');
    try{proposal=JSON.parse(original.authority_snapshot).proposal;}catch{fail(409,'PROPOSAL_INVALID','授权申请内容无法核对');}
    if(!proposal||typeof proposal!=='object')fail(409,'PROPOSAL_INVALID','授权申请内容无法核对');
   }else proposal={sourceBranchId:id(input.sourceBranchId,'来源门店'),targetBranchId:id(input.targetBranchId,'目标门店'),
    dentistId:id(input.dentistId,'牙医'),patientId:id(input.patientId,'患者'),visitId:id(input.visitId,'来源就诊'),scope:input.scope,
    validUntil:instant(input.validUntil,'授权截止时间')};
   const source=id(proposal.sourceBranchId,'来源门店'),target=id(proposal.targetBranchId,'目标门店');
   if(source===target||!['record','health','plan','prescription','document','all'].includes(proposal.scope))fail(422,'INVALID_INPUT','授权门店或资料范围无效');
   const ctx=this.access.authorizeBranch(credentials,'clinic.manage',['propose','withdraw'].includes(input.action)?source:target);
   const previous=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(previous){
    const expected=input.action==='propose'?'cross_branch_access_proposal':input.action==='approve'?'cross_branch_record_access':'cross_branch_access_decision';
    if(previous.permission_id!==ctx.permission.id||previous.payload_digest!==digest||previous.result_kind!==expected)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');
    this.db.exec('COMMIT');return {id:Number(previous.result_key),replayed:true};
   }
   const now=this.auth.now(),reason=text(input.reason,'办理依据',2000);
   if(input.action!=='propose' && this.db.prepare("SELECT 1 FROM operation_audit WHERE outcome_code IN ('CROSS_BRANCH_APPROVED','CROSS_BRANCH_REJECTED','CROSS_BRANCH_WITHDRAWN') AND json_extract(authority_snapshot,'$.proposalId')=?").get(original.id))fail(409,'PROPOSAL_PROCESSED','该申请已经处理');
   if(['propose','approve'].includes(input.action)){
    if(proposal.validUntil<=now)fail(409,'PROPOSAL_EXPIRED','授权截止时间已到');
    if(!this.db.prepare("SELECT 1 FROM clinic_branch a JOIN clinic_branch b ON b.chain_id=a.chain_id WHERE a.id=? AND b.id=? AND a.status='active' AND b.status='active'").get(source,target))fail(409,'BRANCH_MISMATCH','两门店须属于同一启用连锁');
    if(!this.db.prepare('SELECT 1 FROM visit WHERE id=? AND patient_id=? AND branch_id=?').get(proposal.visitId,proposal.patientId,source))fail(409,'VISIT_SOURCE','患者、来源就诊及门店不一致');
    const dentistAccount=this.db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(proposal.dentistId);
    if(!dentistAccount||!this.auth.roles(dentistAccount.id,now).some(r=>r.code==='dentist')||!hasBranchRole(this.db,{staffId:proposal.dentistId,branchId:target,role:'dentist',at:now}))fail(409,'DENTIST_UNAVAILABLE','牙医须具备有效资格及目标门店岗位授权');
   }
   let resultId,kind,code;
   if(input.action==='propose'){
    ctx.authority={...ctx.authority,proposal,sourceBranchId:source};
    resultId=this.unit.audit(ctx,'变更','CROSS_BRANCH_PROPOSAL',{kind:'cross_branch_access_proposal',key:'申请',revision:1},null,reason);
    kind='cross_branch_access_proposal';code='CROSS_BRANCH_PROPOSAL';
   }else if(input.action==='approve'){
    if(original.account_id===ctx.session.account_id)fail(409,'APPROVER_SAME','此协同流程需由目标店另一名负责人确认');
    const proposer=this.db.prepare("SELECT id,staff_id FROM user_account WHERE id=? AND status='启用'").get(original.account_id);
    const managerPermission=this.db.prepare(`SELECT 1 FROM access_permission p JOIN role_permission rp ON rp.permission_id=p.id AND rp.config_version=p.config_version
      JOIN access_role r ON r.id=rp.role_id WHERE p.code='clinic.manage' AND r.code='manager'`).get();
    if(!proposer||!managerPermission||!this.auth.roles(proposer.id,now).some(r=>r.code==='manager')||!hasBranchRole(this.db,{staffId:proposer.staff_id,branchId:source,role:'branch_manager',at:now}))
     fail(409,'PROPOSER_UNAVAILABLE','来源店负责人权限已失效，请重新核对申请');
    if(this.db.prepare(`SELECT 1 FROM cross_branch_record_access WHERE dentist_id=? AND patient_id=? AND visit_id=? AND source_branch_id=? AND target_branch_id=?
      AND (scope=? OR scope='all' OR ?='all') AND (revoked_at IS NULL OR revoked_at>?) AND (valid_until IS NULL OR valid_until>?) LIMIT 1`).get(proposal.dentistId,proposal.patientId,proposal.visitId,source,target,proposal.scope,proposal.scope,now,now))fail(409,'GRANT_EXISTS','该范围已有有效授权');
    resultId=insert(this.db,'cross_branch_record_access',{dentist_id:proposal.dentistId,patient_id:proposal.patientId,visit_id:proposal.visitId,source_branch_id:source,target_branch_id:target,
      scope:proposal.scope,valid_from:now,valid_until:proposal.validUntil,granted_by:ctx.session.staff_id,granted_at:now,evidence:original.reason+'；目标门店确认：'+reason,revoked_at:null,revoked_by:null});
    ctx.authority={...ctx.authority,proposalId:original.id,sourceManagerId:proposer.staff_id,sourceBranchId:source,targetBranchId:target};
    kind='cross_branch_record_access';code='CROSS_BRANCH_APPROVED';
    this.unit.audit(ctx,'变更',code,{kind,key:resultId,revision:1},null,reason);
   }else{
    ctx.authority={...ctx.authority,proposalId:original.id,sourceBranchId:source,targetBranchId:target};
    resultId=original.id;kind='cross_branch_access_decision';code=input.action==='reject'?'CROSS_BRANCH_REJECTED':'CROSS_BRANCH_WITHDRAWN';
    this.unit.audit(ctx,'变更',code,{kind,key:resultId,revision:1},null,reason);
   }
   insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:kind,result_key:String(resultId),result_revision:1,result_code:code,correlation_id:crypto.randomUUID()});
   this.db.exec('COMMIT');return {id:resultId,replayed:false};
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
module.exports={ChainApprovalTrial};
