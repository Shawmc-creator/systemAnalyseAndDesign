'use strict';
const crypto=require('node:crypto');
const {id,text,instant,day,fail,row,revision,insert,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {startResources}=require('./resource-rules');
const {clinicalSnapshot,validateClinical}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');

class ChainStartVisitTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('接诊试验仅允许内存数据库');}
 start(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input||input.commandVersion!==1)fail(422,'COMMAND_VERSION','提交版本无效');
  const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),key=text(input.requestKey,'提交号',100),permission='uc10.record';
  const digest=hash(canonical({permission,input}));this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),visit=row(this.db,'visit',visitId);
   if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id)fail(403,'VISIT_SCOPE','仅可开始本店本人负责的接诊');
   ctx.authority={...ctx.authority,branchId:branch,visitId,patientId:visit.patient_id};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='visit'||Number(old.result_key)!==visitId)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   revision(visit,input.expectedVisitRevision);if(visit.status!=='候诊')fail(409,'INVALID_STATE','只能开始候诊中的就诊');
   const now=this.auth.now(),started=instant(input.startedAt,'实际接诊时间');
   if(started<visit.arrived_at||started>now||day(started)!==day(now))fail(422,'START_TIME','接诊时间须为当日、已发生且不早于到诊');
   const occupancy=this.db.prepare(`SELECT o.*,s.dentist_id,s.status schedule_status,s.branch_id schedule_branch,s.dental_chair_id
    FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE o.visit_id=? AND o.released_at IS NULL`).get(visitId);
   if(!occupancy||occupancy.schedule_branch!==branch||occupancy.dentist_id!==visit.dentist_id||occupancy.schedule_status!=='已确认'||started<occupancy.starts_at||started>=occupancy.ends_at)fail(409,'CONTACT_OUTSIDE_SLOT','请核对本店有效排班和接诊时段');
   const chair=row(this.db,'dental_chair',occupancy.dental_chair_id);if(chair.branch_id!==branch)fail(409,'CHAIR_BRANCH','诊椅门店归属待核对');
   if(this.db.prepare(`SELECT 1 FROM equipment_occupancy o JOIN clinical_equipment e ON e.id=o.equipment_id WHERE o.visit_id=? AND o.status='已预留' AND e.branch_id IS NOT ?`).get(visitId,branch))fail(409,'EQUIPMENT_BRANCH','设备门店归属待核对');
   const before=clinicalSnapshot(this.db);startResources(this.db,visit,occupancy,now);
   this.db.prepare("UPDATE visit SET status='接诊中',started_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(started,now,visit.id);
   this.unit.validateReception();validateClinical(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:'visit',result_key:String(visit.id),result_revision:visit.revision+1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'visit',key:visit.id,beforeRevision:visit.revision,revision:visit.revision+1},sid,'本店牙医开始接诊');
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainStartVisitTrial};
