'use strict';
const crypto=require('node:crypto');
const {id,text,instant,fail,hash,canonical,insert}=require('./common');
const {ChainAuth}=require('./chain-auth');

// A proposal never changes an appointment. The destination's eventual
// acceptance must revalidate the original version and perform the transfer.
class ChainTransfer{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);}
 list(credentials,branchId){const branch=id(branchId,'门店');if(credentials.role!=='frontdesk')fail(403,'FORBIDDEN','需要前台岗位');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc01.maintain',branch);ctx.authority={...ctx.authority,branchId:branch};
  const rows=this.db.prepare(`SELECT a.id,a.occurred_at,a.authority_snapshot,a.reason,
   (SELECT d.outcome_code FROM operation_audit d WHERE d.object_kind='appointment_transfer_decision' AND json_extract(d.authority_snapshot,'$.proposalId')=a.id ORDER BY d.id DESC LIMIT 1) decision
   FROM operation_audit a WHERE a.object_kind='appointment_transfer_proposal' AND a.outcome_code='TRANSFER_PROPOSED'
   AND (json_extract(a.authority_snapshot,'$.proposal.sourceBranchId')=? OR json_extract(a.authority_snapshot,'$.proposal.targetBranchId')=?) ORDER BY a.id DESC`).all(branch,branch);
  const items=rows.map(r=>{let p;try{p=JSON.parse(r.authority_snapshot).proposal;}catch{fail(409,'TRANSFER_INVALID','交接申请内容待核对');}const appointment=this.db.prepare('SELECT status,revision FROM appointment WHERE id=? AND branch_id=? AND patient_id=?').get(p.appointmentId,p.sourceBranchId,p.patientId);
   const patient=this.db.prepare('SELECT name,record_no FROM patient WHERE id=?').get(p.patientId);return {id:r.id,...p,patientName:patient?.name||'待核对',patientNo:patient?.record_no||'',submittedAt:r.occurred_at,reason:r.reason,status:({'TRANSFER_REJECTED':'已拒绝','TRANSFER_WITHDRAWN':'已撤回','TRANSFER_ACCEPTED':'已确认'})[r.decision]||(!appointment||appointment.status!=='已预约'||appointment.revision!==p.appointmentRevision?'原预约已变化':'待目标店确认')};});
  const branches=this.db.prepare("SELECT b.id,b.name FROM clinic_branch b JOIN clinic_branch s ON s.chain_id=b.chain_id WHERE s.id=? AND b.id<>s.id AND b.status='active' ORDER BY b.id").all(branch);
  this.unit.audit(ctx,'查询','TRANSFER_PROPOSAL_LIST',{kind:'appointment_transfer_proposal',key:'branch:'+branch},null,'查询本店转诊交接申请');this.db.exec('COMMIT');return {items,branches};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 command(credentials,input){if(credentials.role!=='frontdesk'||!credentials.csrf)fail(403,'FORBIDDEN','需要前台岗位和安全令牌');if(!input||input.commandVersion!==1||!['propose','withdraw','reject'].includes(input.action))fail(422,'INVALID_ACTION','交接动作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),digest=hash(canonical(input));this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,'uc01.maintain',branch),now=this.auth.now();ctx.authority={...ctx.authority,branchId:branch};
   const prior=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(prior){if(prior.payload_digest!==digest||prior.permission_id!==ctx.permission.id)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');this.db.exec('COMMIT');return {id:Number(prior.result_key),replayed:true};}
   const reason=text(input.reason,'办理依据',2000);let proposalId,kind,code;
   if(input.action==='propose'){
    const target=id(input.targetBranchId,'目标门店'),appointmentId=id(input.appointmentId,'预约');if(target===branch)fail(422,'INVALID_INPUT','目标门店须不同于原门店');
    if(input.patientConfirmed!==true)fail(422,'CONFIRM_REQUIRED','须确认患者同意向目标门店交接');
    if(!this.db.prepare("SELECT 1 FROM clinic_branch s JOIN clinic_branch t ON t.chain_id=s.chain_id WHERE s.id=? AND t.id=? AND s.status='active' AND t.status='active'").get(branch,target))fail(409,'BRANCH_MISMATCH','两门店须属于同一启用连锁');
    const a=this.db.prepare('SELECT id,patient_id,revision,status FROM appointment WHERE id=? AND branch_id=?').get(appointmentId,branch);if(!a||a.status!=='已预约'||a.revision!==input.expectedRevision)fail(409,'APPOINTMENT_CHANGED','原预约已变化，请重新核对');
    const linked=this.db.prepare(`SELECT f.id,f.revision,f.responsible_frontdesk_id,f.responsible_branch_id,f.status,f.created_at,c.contacted_at last_contacted_at FROM followup_requirement f JOIN contact_history c ON c.followup_requirement_id=f.id WHERE c.appointment_id=? AND NOT EXISTS(SELECT 1 FROM contact_history n WHERE n.followup_requirement_id=c.followup_requirement_id AND (n.contacted_at>c.contacted_at OR (n.contacted_at=c.contacted_at AND n.id>c.id)))`).all(a.id);
    if(this.db.prepare('SELECT 1 FROM contact_history WHERE appointment_id=?').get(a.id)&&!linked.length)fail(409,'FOLLOWUP_SOURCE','原复诊联系已变化，请先核对');
    if(linked.some(f=>f.responsible_branch_id!==branch||f.responsible_frontdesk_id!==ctx.session.staff_id||f.status!=='待到诊或评估'))fail(403,'FOLLOWUP_FRONTDESK_SCOPE','仅责任前台可发起复诊交接');
    const contactedAt=instant(input.contactedAt,'实际联系时间');if(contactedAt>now||linked.some(f=>contactedAt<f.created_at||contactedAt<f.last_contacted_at))fail(422,'INVALID_INPUT','联系时间须已发生且不早于上次复诊联系');const method=text(input.method,'联系方式',100),contactNote=text(input.contactNote,'联系内容',2000);
    const previous=this.db.prepare(`SELECT a.id FROM operation_audit a WHERE a.object_kind='appointment_transfer_proposal' AND a.outcome_code='TRANSFER_PROPOSED' AND json_extract(a.authority_snapshot,'$.proposal.appointmentId')=? AND NOT EXISTS (SELECT 1 FROM operation_audit d WHERE d.object_kind='appointment_transfer_decision' AND json_extract(d.authority_snapshot,'$.proposalId')=a.id)`).get(a.id);if(previous)fail(409,'TRANSFER_PENDING','该预约已有待处理的交接申请');
    ctx.authority.proposal={sourceBranchId:branch,targetBranchId:target,appointmentId:a.id,appointmentRevision:a.revision,patientId:a.patient_id,sourceStaffId:ctx.session.staff_id,patientConfirmed:true,contactedAt,method,contactNote,followups:linked.map(f=>({id:f.id,revision:f.revision}))};
    proposalId=this.unit.audit(ctx,'变更','TRANSFER_PROPOSED',{kind:'appointment_transfer_proposal',key:a.id,revision:1},null,reason);kind='appointment_transfer_proposal';code='TRANSFER_PROPOSED';
   }else{
    proposalId=id(input.proposalId,'交接申请');const original=this.db.prepare("SELECT * FROM operation_audit WHERE id=? AND object_kind='appointment_transfer_proposal' AND outcome_code='TRANSFER_PROPOSED'").get(proposalId);if(!original)fail(404,'NOT_FOUND','交接申请不存在');let p;try{p=JSON.parse(original.authority_snapshot).proposal;}catch{fail(409,'TRANSFER_INVALID','交接申请内容待核对');}
    if(!p||branch!==(input.action==='withdraw'?p.sourceBranchId:p.targetBranchId))fail(403,'BRANCH_FORBIDDEN','无权办理该交接申请');
    if(this.db.prepare("SELECT 1 FROM operation_audit WHERE object_kind='appointment_transfer_decision' AND json_extract(authority_snapshot,'$.proposalId')=?").get(proposalId))fail(409,'TRANSFER_PROCESSED','交接申请已处理');
    ctx.authority={...ctx.authority,proposalId,sourceBranchId:p.sourceBranchId,targetBranchId:p.targetBranchId};code=input.action==='withdraw'?'TRANSFER_WITHDRAWN':'TRANSFER_REJECTED';kind='appointment_transfer_decision';this.unit.audit(ctx,'变更',code,{kind,key:proposalId,revision:1},null,reason);
   }
   insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:kind,result_key:String(proposalId),result_revision:1,result_code:code,correlation_id:crypto.randomUUID()});this.db.exec('COMMIT');return {id:proposalId,replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
}
class ChainTransferProposal extends ChainTransfer{
 constructor(app){super(app);if(this.db.prepare('PRAGMA database_list').all().some(x=>!['main','temp'].includes(x.name)||x.file!==''))throw Error('跨店交接演示仅允许内存数据库');}
}
module.exports={ChainTransfer,ChainTransferProposal};
