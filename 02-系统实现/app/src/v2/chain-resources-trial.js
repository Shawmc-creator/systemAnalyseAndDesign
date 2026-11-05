'use strict';
const crypto=require('node:crypto');
const {id,text,instant,fail,row,revision,insert,fact,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {PHYSICAL_END}=require('./resource-rules');
const {clinicalSnapshot,validateClinical}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');

// Only the isolated candidate database; no live resource migration.
class ChainResourcesTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('资源试验仅允许内存数据库');}
 list(credentials,branchId){const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'resources.query',branch);ctx.authority={...ctx.authority,branchId:branch};
  const chairs=this.db.prepare(`SELECT c.id,c.name,EXISTS(SELECT 1 FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN visit v ON v.id=o.visit_id
   WHERE s.dental_chair_id=c.id AND o.released_at IS NULL AND v.started_at IS NOT NULL) busy FROM dental_chair c WHERE c.branch_id=? ORDER BY c.id`).all(branch);
  const equipment=this.db.prepare(`SELECT e.id,e.name,e.equipment_type,e.status,EXISTS(SELECT 1 FROM equipment_occupancy o WHERE o.equipment_id=e.id AND o.status='使用中') busy FROM clinical_equipment e WHERE e.branch_id=? ORDER BY e.id`).all(branch);
  const blocks=this.db.prepare(`SELECT b.id,b.dental_chair_id,b.equipment_id,b.reason,b.starts_at,b.ends_at,b.status,b.revision,c.name chair_name,e.name equipment_name FROM resource_block b LEFT JOIN dental_chair c ON c.id=b.dental_chair_id LEFT JOIN clinical_equipment e ON e.id=b.equipment_id
   WHERE (c.branch_id=? OR e.branch_id=?) AND b.status='生效中' ORDER BY b.id`).all(branch,branch);
  for(const b of blocks){b.affected=b.dental_chair_id?this.db.prepare(`SELECT a.id,a.record_no,a.planned_start,a.planned_end FROM appointment a JOIN resource_occupancy o ON o.appointment_id=a.id JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE a.branch_id=? AND a.status='已预约' AND o.released_at IS NULL AND s.dental_chair_id=? AND a.planned_end>? ORDER BY a.planned_start`).all(branch,b.dental_chair_id,b.starts_at):this.db.prepare(`SELECT a.id,a.record_no,a.planned_start,a.planned_end FROM appointment a JOIN equipment_occupancy o ON o.appointment_id=a.id WHERE a.branch_id=? AND a.status='已预约' AND o.status='已预留' AND o.equipment_id=? AND a.planned_end>? ORDER BY a.planned_start`).all(branch,b.equipment_id,b.starts_at);}
  this.unit.audit(ctx,'查询','CHAIN_RESOURCES_LIST',{kind:'branch_resource_query',key:'branch:'+branch},null,'查询本店诊椅、设备和限制');this.db.exec('COMMIT');return {chairs,equipment,blocks};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 command(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['finish','block','restore'].includes(input.action))fail(422,'INVALID_ACTION','资源动作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission=input.action==='finish'?'resources.finish':'resources.manage',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};
   const prior=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(prior){if(prior.permission_id!==ctx.permission.id||prior.payload_digest!==digest||prior.result_kind!=='resource_block')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    const b=row(this.db,'resource_block',Number(prior.result_key));const target=b.dental_chair_id?row(this.db,'dental_chair',b.dental_chair_id):row(this.db,'clinical_equipment',b.equipment_id);if(target.branch_id!==branch)fail(409,'RESOURCE_BRANCH','原记录门店待核对');
    if(input.action==='finish'){const visit=row(this.db,'visit',id(input.visitId,'就诊'));if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id)fail(403,'VISIT_SCOPE','仅可办理本人本店接诊');}
    this.db.exec('COMMIT');return {...this.unit.result(prior),replayed:true};}
   const now=this.auth.now(),before=clinicalSnapshot(this.db);let blockId,rev,oldRev,reason;
   if(input.action==='finish'){
    const visit=row(this.db,'visit',id(input.visitId,'就诊'));if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id)fail(403,'VISIT_SCOPE','仅可结束本人本店接诊');
    revision(visit,input.expectedVisitRevision);if(visit.status!=='接诊中'||!visit.started_at)fail(409,'VISIT_NOT_ACTIVE','须为接诊中的就诊');
    if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','须确认已结束实际操作并交接清洁');
    const end=instant(input.endedAt,'实际结束时间');if(end<visit.started_at||end>now)fail(422,'INVALID_END_TIME','实际结束须已发生且不早于接诊');
    const last=this.db.prepare('SELECT max(completed_at) at FROM treatment_execution WHERE visit_id=?').get(visit.id).at;if(last&&end<last)fail(409,'TREATMENT_AFTER_END','结束时间早于已登记治疗');
    const o=this.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(visit.id);if(!o)fail(409,'OPERATION_ALREADY_FINISHED','实际操作已经结束或占用待核对');revision(o,input.expectedOccupancyRevision);
    const schedule=row(this.db,'dated_schedule',o.dated_schedule_id),chair=row(this.db,'dental_chair',schedule.dental_chair_id);
    if(schedule.branch_id!==branch||chair.branch_id!==branch||schedule.dentist_id!==visit.dentist_id)fail(409,'RESOURCE_BRANCH','排班或诊椅门店待核对');
    if(this.db.prepare(`SELECT 1 FROM equipment_occupancy o JOIN clinical_equipment e ON e.id=o.equipment_id WHERE o.visit_id=? AND o.status<>'已释放' AND e.branch_id IS NOT ?`).get(visit.id,branch))fail(409,'RESOURCE_BRANCH','设备门店待核对');
    reason=text(input.reason,'交接依据',2000);this.db.prepare('UPDATE resource_occupancy SET released_at=?,released_by=?,release_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(end,ctx.session.staff_id,PHYSICAL_END,now,o.id);
    this.db.prepare("UPDATE equipment_occupancy SET status='已释放',actual_ended_at=?,release_reason=?,updated_at=?,revision=revision+1 WHERE visit_id=? AND status='使用中'").run(end,reason,now,visit.id);
    blockId=insert(this.db,'resource_block',fact(now,{dental_chair_id:chair.id,equipment_id:null,starts_at:end,ends_at:null,reason:'诊后清洁与准备待核验：'+visit.record_no,released_at:null,status:'生效中',operator_id:ctx.session.staff_id}));
    this.db.prepare("UPDATE visit SET status='诊疗结束',ended_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(end,now,visit.id);rev=1;oldRev=null;
    ctx.authority={...ctx.authority,visitId:visit.id,patientId:visit.patient_id,occupancyId:o.id,chairId:chair.id};
    const aid=this.unit.audit(ctx,'变更','CHAIN_PHYSICAL_END',{kind:'visit',key:visit.id,beforeRevision:visit.revision,revision:visit.revision+1},null,reason);
    this.unit.auditChanges(aid,[{field:'status',before:visit.status,after:'诊疗结束'}]);
   }else if(input.action==='block'){
    const chairId=input.chairId==null?null:id(input.chairId,'诊椅'),equipmentId=input.equipmentId==null?null:id(input.equipmentId,'设备');if((chairId!==null)===(equipmentId!==null))fail(422,'RESOURCE_TARGET','请选择一项诊椅或设备');
    const target=row(this.db,chairId?'dental_chair':'clinical_equipment',chairId||equipmentId);if(target.branch_id!==branch)fail(403,'RESOURCE_BRANCH','资源不属于当前门店');
    const end=input.endsAt?instant(input.endsAt,'预计结束时间'):null;if(end&&end<=now)fail(422,'INVALID_INTERVAL','预计结束须晚于当前时间');reason=text(input.reason,'故障或维护依据',2000);
    blockId=insert(this.db,'resource_block',fact(now,{dental_chair_id:chairId,equipment_id:equipmentId,starts_at:now,ends_at:end,reason:'故障维护：'+reason,released_at:null,status:'生效中',operator_id:ctx.session.staff_id}));rev=1;oldRev=null;ctx.authority={...ctx.authority,chairId,equipmentId};
   }else{
    const block=row(this.db,'resource_block',id(input.blockId,'限制记录')),target=block.dental_chair_id?row(this.db,'dental_chair',block.dental_chair_id):row(this.db,'clinical_equipment',block.equipment_id);if(target.branch_id!==branch)fail(403,'RESOURCE_BRANCH','资源不属于当前门店');
    if(block.reason.startsWith('故障维护：')&&credentials.role!=='manager')fail(403,'RESOURCE_MANAGER_REQUIRED','故障维护恢复须由负责人核验');
    revision(block,input.expectedRevision);if(block.status!=='生效中')fail(409,'RESOURCE_ALREADY_RESTORED','资源已恢复');
    if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','请核实清洁准备已完成');reason=text(input.verificationNote,'清洁恢复核验依据',2000);
    if(now<block.starts_at)fail(409,'BLOCK_NOT_STARTED','清洁记录尚未开始');
    const busy=block.dental_chair_id?this.db.prepare(`SELECT 1 FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id JOIN visit v ON v.id=o.visit_id WHERE s.dental_chair_id=? AND o.released_at IS NULL AND v.started_at IS NOT NULL`).get(block.dental_chair_id):this.db.prepare("SELECT 1 FROM equipment_occupancy WHERE equipment_id=? AND status='使用中'").get(block.equipment_id);
    if(busy)fail(409,'RESOURCE_STILL_IN_USE','资源仍在使用');
    this.db.prepare("UPDATE resource_block SET status='已解除',released_at=?,operator_id=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,now,block.id);
    blockId=block.id;oldRev=block.revision;rev=block.revision+1;ctx.authority={...ctx.authority,chairId:block.dental_chair_id,equipmentId:block.equipment_id};
   }
   this.unit.validateReception();validateClinical(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'resource_block',result_key:String(blockId),result_revision:rev,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'resource_block',key:blockId,beforeRevision:oldRev,revision:rev},sid,reason);
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainResourcesTrial};
