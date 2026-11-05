'use strict';
const crypto=require('node:crypto');
const {id,text,instant,dateOnly,day,fail,row,revision,insert,fact,recordNo,hash,canonical}=require('./common');
const {assertCandidateSchedule}=require('./chain-reception-rules');
const {ChainAuth}=require('./chain-auth');
const {ChainReceptionTrial}=require('./chain-reception-trial');
const {mapError}=require('./unit-of-work');
class ChainSetupTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.reception=app.reception;this.access=new ChainAuth(app.auth);this.chainReception=new ChainReceptionTrial(app);}
 options(credentials,branchId){if(credentials.role!=='manager')fail(403,'FORBIDDEN','需要负责人岗位');const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc15.schedule',branch);ctx.authority={...ctx.authority,branchId:branch};const now=this.auth.now();
  const dentists=this.db.prepare(`SELECT DISTINCT s.id,s.name FROM staff s JOIN branch_staff_role r ON r.staff_id=s.id WHERE r.branch_id=? AND r.role_code='dentist' AND r.valid_from<=? AND (r.valid_until IS NULL OR r.valid_until>?) AND (r.revoked_at IS NULL OR r.revoked_at>?) ORDER BY s.id`).all(branch,now,now,now);
  const chairs=this.db.prepare('SELECT id,name FROM dental_chair WHERE branch_id=? ORDER BY id').all(branch);
  const schedules=this.db.prepare('SELECT id,dentist_id,dental_chair_id,business_date,starts_at,ends_at,status,revision FROM dated_schedule WHERE branch_id=? ORDER BY starts_at DESC').all(branch);
  this.unit.audit(ctx,'查询','CHAIN_SCHEDULE_OPTIONS',{kind:'branch_schedule_query',key:'branch:'+branch},null,'查询本店排班与可选资源');this.db.exec('COMMIT');return {dentists,chairs,schedules};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 patients(credentials,branchId){if(credentials.role!=='frontdesk')fail(403,'FORBIDDEN','需要前台岗位');const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc08.maintain',branch);ctx.authority={...ctx.authority,branchId:branch};
  const patients=this.db.prepare('SELECT id,record_no,name,birth_date,phone,phone_owner,address,contact_preference,contact_unavailable_reason,revision FROM patient ORDER BY id').all();
  this.unit.audit(ctx,'查询','CHAIN_PATIENT_LIST',{kind:'patient_identity_query',key:'branch:'+branch},null,'查询患者身份与联系资料');this.db.exec('COMMIT');return {patients};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 command(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['patient','patient-update','publish','change','close'].includes(input.action))fail(422,'INVALID_ACTION','操作无效');
  const branch=id(input.branchId,'门店'),permission=['patient','patient-update'].includes(input.action)?'uc08.maintain':'uc15.schedule',key=text(input.requestKey,'提交号',100),digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const now=this.auth.now(),reason=text(input.reason,'办理依据',2000);let result;
   if(['patient','patient-update'].includes(input.action)){
    if(credentials.role!=='frontdesk')fail(403,'FORBIDDEN','需要前台岗位');const fields=this.reception.personFields(input.fields,now),patient=input.action==='patient-update'?row(this.db,'patient',id(input.patientId,'患者')):null;
    if(patient)revision(patient,input.expectedRevision);const merged={...patient,...fields};text(merged.name,'患者姓名',80);
    if(merged.phone)text(merged.phone_owner,'联系电话归属');else text(merged.contact_unavailable_reason,'无法联系原因');
    if(merged.phone&&this.db.prepare('SELECT 1 FROM patient WHERE name=? AND phone=? AND id<>?').get(merged.name,merged.phone,patient?.id||0))fail(409,'PATIENT_POSSIBLE_DUPLICATE','已有姓名和电话相同的患者，请先核对既有档案');
    if(!patient){const patientId=insert(this.db,'patient',fact(now,{name:merged.name,birth_date:merged.birth_date||null,phone:merged.phone||null,phone_owner:merged.phone_owner||null,address:merged.address||null,contact_preference:merged.contact_preference||null,contact_unavailable_reason:merged.contact_unavailable_reason||null,created_by:ctx.session.staff_id,record_no:recordNo('P')}));result={kind:'patient',key:patientId,revision:1};}
    else{const changes=Object.entries(fields).filter(([field,value])=>patient[field]!==value);if(!changes.length)fail(422,'NO_CHANGES','资料没有变化');
     this.db.prepare('UPDATE patient SET '+changes.map(([field])=>'"'+field+'"=?').join(',')+',updated_at=?,revision=revision+1 WHERE id=?').run(...changes.map(([,value])=>value),now,patient.id);
     for(const [field,value] of changes)insert(this.db,'patient_change',fact(now,{patient_id:patient.id,old_value:patient[field],new_value:value,reason,occurred_at:now,field_name:field,operator_id:ctx.session.staff_id}));
     result={kind:'patient',key:patient.id,beforeRevision:patient.revision,revision:patient.revision+1};}
   }else{
    if(credentials.role!=='manager')fail(403,'FORBIDDEN','需要负责人岗位');
    if(['publish','change'].includes(input.action)){
     const oldSchedule=input.action==='change'?row(this.db,'dated_schedule',id(input.scheduleId,'排班')):null;
     if(oldSchedule){if(oldSchedule.branch_id!==branch)fail(403,'BRANCH_FORBIDDEN','排班不属于本店');revision(oldSchedule,input.expectedRevision);if(oldSchedule.status!=='已确认')fail(409,'INVALID_STATE','仅可调整已确认排班');if(this.db.prepare('SELECT 1 FROM resource_occupancy WHERE dated_schedule_id=? AND released_at IS NULL').get(oldSchedule.id))fail(409,'ACTIVE_OCCUPANCY','请先处理该排班下的预约及在诊占用');}
     const start=instant(input.startsAt,'排班开始'),end=instant(input.endsAt,'排班结束'),businessDate=dateOnly(input.businessDate,'营业日期'),dentist=id(input.dentistId,'牙医'),chair=id(input.chairId,'诊椅');
     if(end<=start||day(start)!==businessDate||day(end)!==businessDate)fail(422,'INVALID_INPUT','排班起止应在同一营业日期');if(end<=now)fail(422,'PAST_SCHEDULE','不能发布已经结束的排班');
     assertCandidateSchedule(this.db,{branchId:branch,dentistId:dentist,chairId:chair,startsAt:start,endsAt:end,scheduleId:oldSchedule?.id});this.reception.dentistAvailable(dentist,start,end);this.chainReception.ensureDentist({dentist_id:dentist},branch,start,end);
     const c=row(this.db,'dental_chair',chair);if(c.available_from>start||(c.available_until&&c.available_until<end))fail(409,'CHAIR_UNAVAILABLE','诊椅在排班时段不可用');
     if(!oldSchedule){const scheduleId=insert(this.db,'dated_schedule',fact(now,{branch_id:branch,dentist_id:dentist,dental_chair_id:chair,business_date:businessDate,starts_at:start,ends_at:end,confirmed_at:now,confirmed_by:ctx.session.staff_id,status:'已确认',closure_reason:null,created_by:ctx.session.staff_id}));result={kind:'dated_schedule',key:scheduleId,revision:1};}
     else{this.db.prepare('UPDATE dated_schedule SET dentist_id=?,dental_chair_id=?,business_date=?,starts_at=?,ends_at=?,confirmed_at=?,confirmed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(dentist,chair,businessDate,start,end,now,ctx.session.staff_id,now,oldSchedule.id);
      insert(this.db,'schedule_change',fact(now,{dated_schedule_id:oldSchedule.id,old_business_date:oldSchedule.business_date,old_starts_at:oldSchedule.starts_at,old_ends_at:oldSchedule.ends_at,new_business_date:businessDate,new_starts_at:start,new_ends_at:end,reason,occurred_at:now,change_kind:'调整',affected_handling:'已核对无有效预约及在诊占用',operator_id:ctx.session.staff_id,old_dentist_id:oldSchedule.dentist_id,new_dentist_id:dentist,old_chair_id:oldSchedule.dental_chair_id,new_chair_id:chair}));result={kind:'dated_schedule',key:oldSchedule.id,beforeRevision:oldSchedule.revision,revision:oldSchedule.revision+1};}
    }else{
     const schedule=row(this.db,'dated_schedule',id(input.scheduleId,'排班'));if(schedule.branch_id!==branch)fail(403,'BRANCH_FORBIDDEN','排班不属于本店');revision(schedule,input.expectedRevision);if(schedule.status!=='已确认')fail(409,'INVALID_STATE','仅可停诊已确认排班');
     if(this.db.prepare('SELECT 1 FROM resource_occupancy WHERE dated_schedule_id=? AND released_at IS NULL').get(schedule.id))fail(409,'ACTIVE_OCCUPANCY','请先处理该排班下的预约及在诊占用');
     this.db.prepare("UPDATE dated_schedule SET status='已停诊',closure_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,schedule.id);
     insert(this.db,'schedule_change',fact(now,{dated_schedule_id:schedule.id,old_business_date:schedule.business_date,old_starts_at:schedule.starts_at,old_ends_at:schedule.ends_at,new_business_date:schedule.business_date,new_starts_at:schedule.starts_at,new_ends_at:schedule.ends_at,reason,occurred_at:now,change_kind:'停诊',affected_handling:'已核对无有效预约及在诊占用',operator_id:ctx.session.staff_id,old_dentist_id:schedule.dentist_id,new_dentist_id:schedule.dentist_id,old_chair_id:schedule.dental_chair_id,new_chair_id:schedule.dental_chair_id}));result={kind:'dated_schedule',key:schedule.id,beforeRevision:schedule.revision,revision:schedule.revision+1};
    }
   }
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:result.kind,result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',result,sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainSetupTrial};
