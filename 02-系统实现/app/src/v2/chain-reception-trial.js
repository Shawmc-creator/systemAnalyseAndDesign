'use strict';
const crypto=require('node:crypto');
const {fail,id,instant,text,insert,fact,recordNo,hash,canonical,row,revision,day}=require('./common');
const {assertCandidateReservation}=require('./chain-reception-rules');
const {ChainAuth}=require('./chain-auth');
const {equipmentIds,reserveEquipment,releaseReservations}=require('./resource-rules');
const {followupSnapshot,validateFollowups}=require('./followup-rules');

// Experimental in-memory service only; not exposed by the running server.
// Candidate implementation, all changes and receipts
// are committed together under one SQLite write lock.
class ChainReceptionTrial {
 constructor(app) {
  this.db=app.db; this.auth=app.auth; this.unit=app.unit; this.reception=app.reception;
  const databases=this.db.prepare('PRAGMA database_list').all();
  if(databases.some(d=>!['main','temp'].includes(d.name)||d.file!=='')) throw new Error('连锁接诊试验仅允许内存数据库');
  this.access=new ChainAuth(this.auth);
 }
 ensureDentist(schedule,branch,start,end) {
  const role=this.db.prepare(`SELECT valid_from,valid_until,revoked_at FROM branch_staff_role WHERE staff_id=? AND branch_id=? AND role_code='dentist'
    AND valid_from<=? AND (valid_until IS NULL OR valid_until>=?) AND (revoked_at IS NULL OR revoked_at>=?)`).all(schedule.dentist_id,branch,start,end,end);
  const valid=t=>typeof t==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t) && Number.isFinite(Date.parse(t)) && new Date(t).toISOString().replace('.000Z','Z')===t;
  if(!role.some(r=>valid(r.valid_from)&&(!r.valid_until||valid(r.valid_until))&&(!r.revoked_at||valid(r.revoked_at)))) fail(409,'DENTIST_BRANCH_UNAVAILABLE','牙医未获该门店有效接诊授权');
 }
 ensureEquipment(ids,branch) {
  for(const equipmentId of ids) {
   const equipment=row(this.db,'clinical_equipment',equipmentId);
   if(equipment.branch_id!==branch) fail(409,'EQUIPMENT_BRANCH','设备不属于当前门店');
  }
 }
 command(credentials,input) {
  if(!credentials.csrf) fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input || !['create','cancel','reschedule','arrive','walkIn','noShow','transfer'].includes(input.action)) fail(422,'INVALID_ACTION','不支持该隔离试验操作');
  if(input.equipmentIds!==undefined && !['create','reschedule','transfer','walkIn'].includes(input.action)) fail(422,'INVALID_EQUIPMENT','此操作不能修改设备选择');
  const branch=id(input.branchId,'门店'), key=text(input.requestKey,'提交号',100);
  const targetBranch=input.action==='transfer'?id(input.targetBranchId,'目标门店'):null;
  if(targetBranch===branch) fail(422,'INVALID_INPUT','转店时目标门店须不同于原门店');
  if(input.commandVersion!==1) fail(422,'INVALID_INPUT','提交版本无效');
  const permission=['arrive','walkIn'].includes(input.action)?'uc03.register':'uc01.maintain';
  const digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const ctx=this.access.authorizeBranch(credentials,permission,branch);
   if(targetBranch) this.access.authorizeBranch(credentials,permission,targetBranch);
   ctx.authority={...ctx.authority,branchId:branch};
   const previous=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(previous) {
    if(previous.permission_id!==ctx.permission.id || previous.payload_digest!==digest) fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容或门店');
    this.db.exec('COMMIT'); return {...this.unit.result(previous),replayed:true};
   }
   const now=this.auth.now(); let result,related=[];
   if(input.action==='create') {
    row(this.db,'patient',input.patientId);
    const start=instant(input.startsAt,'预约开始'), end=instant(input.endsAt,'预约结束');
    if(start<=now) fail(422,'PAST_APPOINTMENT','预约开始必须晚于当前时间');
    const schedule=this.reception.checkSchedule(input.scheduleId,input.scheduleRevision,start,end);
    assertCandidateReservation(this.db,{branchId:branch,patientId:input.patientId,scheduleId:schedule.id,startsAt:start,endsAt:end});
    this.ensureDentist(schedule,branch,start,end);
    const ids=equipmentIds(input.equipmentIds);this.ensureEquipment(ids,branch);
    const keyId=insert(this.db,'appointment',fact(now,{branch_id:branch,patient_id:input.patientId,planned_start:start,planned_end:end,
     reason:text(input.reason,'就诊目的'),due_at:end,arrangement_revision:1,status_reason:null,notified_at:null,
     created_by:ctx.session.staff_id,notified_by:null,status:'已预约',record_no:recordNo('A')}));
    this.reception.occupy(schedule,{start,end},ctx,now,keyId);
    reserveEquipment(this.db,schedule.dental_chair_id,ids,start,end,now,keyId);
    result={kind:'appointment',key:keyId,revision:1};
   } else if(input.action==='walkIn'){
    const patient=row(this.db,'patient',id(input.patientId,'患者')),arrived=instant(input.arrivedAt,'实际到诊时间'),start=instant(input.startsAt,'现场接诊开始'),end=instant(input.endsAt,'现场接诊结束');
    if(day(arrived)!==day(now)||arrived>now||day(start)!==day(now)||start<arrived||end<=start)fail(422,'ARRIVAL_DATE','现场到诊须已发生，接诊时间须在当日到诊之后');
    const schedule=this.reception.checkSchedule(input.scheduleId,input.scheduleRevision,start,end);assertCandidateReservation(this.db,{branchId:branch,patientId:patient.id,scheduleId:schedule.id,startsAt:start,endsAt:end});this.ensureDentist(schedule,branch,start,end);
    const ids=equipmentIds(input.equipmentIds);this.ensureEquipment(ids,branch);
    const visit=insert(this.db,'visit',fact(now,{branch_id:branch,patient_id:patient.id,appointment_id:null,dentist_id:schedule.dentist_id,arrived_at:arrived,started_at:null,ended_at:null,arrival_source:'现场',registered_by:ctx.session.staff_id,status:'候诊',record_no:recordNo('V')}));
    this.reception.occupy(schedule,{start,end},ctx,now,null,visit);reserveEquipment(this.db,schedule.dental_chair_id,ids,start,end,now,null,visit);
    insert(this.db,'clinical_record',fact(now,{visit_id:visit,status:'草稿',record_no:recordNo('C')}));result={kind:'visit',key:visit,revision:1,reason:'登记现场到诊'};
   } else {
    const old=row(this.db,'appointment',input.appointmentId);
    if(old.branch_id!==branch) fail(403,'BRANCH_FORBIDDEN','预约不属于当前门店');
    revision(old,input.expectedRevision);
    if(old.status!=='已预约') fail(409,'INVALID_STATE','仅可取消尚未到诊的预约');
    const occupancy=this.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(old.id);
    if(!occupancy || occupancy.visit_id) fail(409,'OCCUPANCY_SOURCE','预约占用缺失或已到诊');
    let linked=[];
    if(this.db.prepare('SELECT 1 FROM contact_history WHERE appointment_id=? LIMIT 1').get(old.id)) {
     const columns=this.db.prepare('PRAGMA table_info(followup_requirement)').all().map(x=>x.name);
     if(!columns.includes('responsible_branch_id')) fail(409,'FOLLOWUP_BRANCH_UNKNOWN','复诊负责门店尚未核实');
     linked=this.db.prepare(`SELECT f.* FROM followup_requirement f JOIN contact_history c ON c.followup_requirement_id=f.id
      WHERE c.appointment_id=? AND NOT EXISTS (SELECT 1 FROM contact_history n WHERE n.followup_requirement_id=c.followup_requirement_id
      AND (n.contacted_at>c.contacted_at OR (n.contacted_at=c.contacted_at AND n.id>c.id)))`).all(old.id);
     if(linked.some(f=>f.patient_id!==old.patient_id || f.responsible_branch_id!==branch))
      fail(409,'FOLLOWUP_BRANCH_UNKNOWN','复诊患者或负责门店不一致，须先核实');
    }
    const reserved=this.db.prepare("SELECT equipment_id FROM equipment_occupancy WHERE appointment_id=? AND status='已预留'").all(old.id).map(e=>e.equipment_id);
    this.ensureEquipment(reserved,branch);
    if(input.action==='transfer') {
     if(input.patientConfirmed!==true) fail(422,'CONFIRM_REQUIRED','须确认患者同意转店');
     if(this.db.prepare('SELECT 1 FROM contact_history WHERE appointment_id=? LIMIT 1').get(old.id) && !linked.length)
      fail(409,'FOLLOWUP_SOURCE','原复诊联系已被后续记录替代，请先核对');
     if(linked.some(f=>f.status!=='待到诊或评估' || f.responsible_frontdesk_id!==ctx.session.staff_id))
      fail(409,'FOLLOWUP_FRONTDESK_SCOPE','须由复诊当前责任前台办理，并核对待到诊状态');
     if(reserved.length && input.equipmentIds===undefined)
      fail(422,'EQUIPMENT_CONFIRM','请确认目标门店所需设备，或明确选择无需设备');
     const sameChain=this.db.prepare(`SELECT 1 FROM clinic_branch s JOIN clinic_branch d ON d.chain_id=s.chain_id
       WHERE s.id=? AND d.id=? AND s.status='active' AND d.status='active'`).get(branch,targetBranch);
     if(!sameChain) fail(409,'BRANCH_MISMATCH','原门店及目标门店不属于同一启用连锁');
     const start=instant(input.startsAt,'新预约开始'),end=instant(input.endsAt,'新预约结束');
     if(start<=now) fail(422,'PAST_APPOINTMENT','新预约开始必须晚于当前时间');
     if(linked.some(f=>day(start)<f.target_start || day(start)>f.target_end))
      fail(409,'FOLLOWUP_APPOINTMENT_WINDOW','目标预约不在复诊目标日期内，请先核对要求');
     let contact=null, followupBefore=null, historyBefore=null;
     if(linked.length) {
      if(!input.transferContact || typeof input.transferContact!=='object') fail(422,'FOLLOWUP_CONTACT','请记录实际联系情况');
      const contacted=instant(input.transferContact.contactedAt,'实际联系时间');
      if(contacted>now || linked.some(f=>contacted<f.created_at)) fail(422,'FOLLOWUP_CONTACT_TIME','联系时间必须已经发生且不早于复诊要求');
      for(const f of linked) {
       const last=this.db.prepare('SELECT contacted_at FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at DESC,id DESC LIMIT 1').get(f.id);
       if(last && contacted<last.contacted_at) fail(422,'FOLLOWUP_CONTACT_TIME','联系时间不能早于最近联系');
      }
      contact={contacted,method:text(input.transferContact.method,'实际联系方式',100),note:text(input.transferContact.note,'真实联系内容及结果',4000)};
      followupBefore=followupSnapshot(this.db);historyBefore=this.unit.workflowHistory.snapshot();
     }
     const reason=text(input.reason,'转店依据');
     const schedule=this.reception.checkSchedule(input.scheduleId,input.scheduleRevision,start,end);
     this.ensureDentist(schedule,targetBranch,start,end);
     const ids=equipmentIds(input.equipmentIds);this.ensureEquipment(ids,targetBranch);
     // Releasing the original happens under the same write lock: any failure
     // below rolls the release back and keeps the original reservation intact.
     releaseReservations(this.db,old.id,now,'患者确认转店，释放原设备预留：'+reason);
     this.reception.release(occupancy,ctx,now,reason);
     assertCandidateReservation(this.db,{branchId:targetBranch,patientId:old.patient_id,scheduleId:schedule.id,startsAt:start,endsAt:end});
     this.db.prepare("UPDATE appointment SET status='已取消',status_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,old.id);
     insert(this.db,'appointment_change',fact(now,{appointment_id:old.id,old_start:old.planned_start,old_end:old.planned_end,
      old_revision:old.arrangement_revision,new_start:null,new_end:null,new_revision:old.arrangement_revision,reason,occurred_at:now,
      change_kind:'取消',operator_id:ctx.session.staff_id,old_schedule_id:occupancy.dated_schedule_id,new_schedule_id:null}));
     const newId=insert(this.db,'appointment',fact(now,{branch_id:targetBranch,patient_id:old.patient_id,planned_start:start,planned_end:end,
      reason:old.reason,due_at:end,arrangement_revision:1,status_reason:null,notified_at:null,created_by:ctx.session.staff_id,
      notified_by:null,status:'已预约',record_no:recordNo('A')}));
     this.reception.occupy(schedule,{start,end},ctx,now,newId);
     reserveEquipment(this.db,schedule.dental_chair_id,ids,start,end,now,newId);
     const followupChanges=[];
     for(const f of linked) {
      insert(this.db,'contact_history',fact(now,{followup_requirement_id:f.id,appointment_id:newId,method:contact.method,
       contacted_at:contact.contacted,result:'已联系',next_contact_date:null,note:contact.note,operator_id:ctx.session.staff_id}));
      this.db.prepare("UPDATE followup_requirement SET responsible_branch_id=?,responsible_frontdesk_id=?,status='待到诊或评估',next_contact_date=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(targetBranch,ctx.session.staff_id,now,f.id);
      this.unit.workflowHistory.append('followup_requirement',f.id,'联系更新','实际联系并确认转店预约',ctx,input,now);
      followupChanges.push({kind:'followup_requirement',key:f.id,beforeRevision:f.revision,revision:f.revision+1,
       code:'FOLLOWUP_TRANSFERRED',reason:'实际联系并确认转店预约',changes:[{field:'responsible_branch_id',before:branch,after:targetBranch}]});
     }
     if(linked.length){validateFollowups(this.db,followupBefore);this.unit.workflowHistory.validate(historyBefore,permission);}
     ctx.authority.transfer={originalAppointmentId:old.id,newAppointmentId:newId,sourceBranchId:branch,targetBranchId:targetBranch,patientConfirmed:true};
     related=[{kind:'appointment',key:old.id,beforeRevision:old.revision,revision:old.revision+1,code:'TRANSFER_SOURCE_CANCELLED',reason,changes:[]},...followupChanges];
     result={kind:'appointment',key:newId,revision:1,reason};
    } else if(input.action==='arrive') {
     if(old.patient_id!==id(input.patientId,'患者')) fail(409,'PATIENT_MISMATCH','患者与预约不一致');
     const arrived=instant(input.arrivedAt,'实际到诊时间');
     if(day(arrived)!==day(now)||arrived>now||day(old.planned_start)!==day(now)) fail(422,'ARRIVAL_DATE','仅可登记当日已发生的到诊');
     revision(occupancy,input.occupancyRevision);
     const schedule=this.reception.checkSchedule(occupancy.dated_schedule_id,input.scheduleRevision,occupancy.starts_at,occupancy.ends_at,false);
     if(schedule.branch_id!==branch || schedule.dentist_id!==id(input.dentistId,'牙医')) fail(409,'SCHEDULE_CHANGED','门店或牙医与预约安排不一致');
     this.ensureDentist(schedule,branch,occupancy.starts_at,occupancy.ends_at);
     const visit=insert(this.db,'visit',fact(now,{branch_id:branch,patient_id:old.patient_id,appointment_id:old.id,dentist_id:schedule.dentist_id,
      arrived_at:arrived,started_at:null,ended_at:null,arrival_source:'预约',registered_by:ctx.session.staff_id,status:'候诊',record_no:recordNo('V')}));
     this.db.prepare('UPDATE resource_occupancy SET visit_id=?,updated_at=?,revision=revision+1 WHERE id=?').run(visit,now,occupancy.id);
     this.db.prepare("UPDATE equipment_occupancy SET visit_id=?,updated_at=?,revision=revision+1 WHERE appointment_id=? AND status='已预留'").run(visit,now,old.id);
     this.db.prepare("UPDATE appointment SET status='已到诊',updated_at=?,revision=revision+1 WHERE id=?").run(now,old.id);
     insert(this.db,'clinical_record',fact(now,{visit_id:visit,status:'草稿',record_no:recordNo('C')}));
     result={kind:'visit',key:visit,revision:1};
    } else {
     const reason=text(input.reason,'办理依据'); let start=null,end=null,schedule=null,newRevision=old.arrangement_revision;
     if(input.action==='reschedule') {
      start=instant(input.startsAt,'新预约开始');end=instant(input.endsAt,'新预约结束');
      if(start<=now) fail(422,'PAST_APPOINTMENT','新预约开始必须晚于当前时间');
      if(linked.some(f=>['待联系','待到诊或评估'].includes(f.status) && (day(start)<f.target_start || day(start)>f.target_end)))
       fail(409,'FOLLOWUP_APPOINTMENT_WINDOW','新预约不在复诊目标日期内，请先核对要求');
      schedule=this.reception.checkSchedule(input.scheduleId,input.scheduleRevision,start,end);
      assertCandidateReservation(this.db,{branchId:branch,patientId:old.patient_id,scheduleId:schedule.id,startsAt:start,endsAt:end,excludedOccupancyId:occupancy.id,originalAppointmentId:old.id});
      this.ensureDentist(schedule,branch,start,end);
      const ids=input.equipmentIds===undefined?reserved:equipmentIds(input.equipmentIds);this.ensureEquipment(ids,branch);
      releaseReservations(this.db,old.id,now,'改约释放原设备预留：'+reason);
      this.reception.release(occupancy,ctx,now,reason);this.reception.occupy(schedule,{start,end},ctx,now,old.id);
      reserveEquipment(this.db,schedule.dental_chair_id,ids,start,end,now,old.id);
      newRevision++;
      this.db.prepare('UPDATE appointment SET planned_start=?,planned_end=?,due_at=?,arrangement_revision=?,notified_at=NULL,notified_by=NULL,updated_at=?,revision=revision+1 WHERE id=?').run(start,end,end,newRevision,now,old.id);
     } else {
      if(input.action==='noShow' && now<=old.due_at) fail(409,'NOT_DUE','尚未超过预约截止时间');
      const followupBefore=followupSnapshot(this.db),historyBefore=this.unit.workflowHistory.snapshot();
      releaseReservations(this.db,old.id,now,(input.action==='noShow'?'未到释放：':'预约取消：')+reason);
      this.reception.release(occupancy,ctx,now,reason);
      this.db.prepare('UPDATE appointment SET status=?,status_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(input.action==='noShow'?'未到':'已取消',reason,now,old.id);
      related=this.reception.restoreFollowups(old.id,now);
      for(const item of related) this.unit.workflowHistory.append('followup_requirement',item.key,'继续跟进',item.reason,ctx,input,now);
      validateFollowups(this.db,followupBefore);this.unit.workflowHistory.validate(historyBefore,permission);
     }
     if(input.action!=='noShow') insert(this.db,'appointment_change',fact(now,{appointment_id:old.id,old_start:old.planned_start,old_end:old.planned_end,
      old_revision:old.arrangement_revision,new_start:start,new_end:end,new_revision:newRevision,reason,occurred_at:now,
      change_kind:input.action==='reschedule'?'改约':'取消',operator_id:ctx.session.staff_id,old_schedule_id:occupancy.dated_schedule_id,new_schedule_id:schedule?.id||null}));
     result={kind:'appointment',key:old.id,revision:old.revision+1,beforeRevision:old.revision,reason,
      changes:input.action==='noShow'?[{field:'status',before:old.status,after:'未到'},{field:'status_reason',before:old.status_reason,after:reason}]:[]};
    }
   }
   this.unit.validateReception();
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,
    payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:result.kind,
    result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   const mainAudit=this.unit.audit(ctx,'变更','COMMITTED',result,sid,result.reason||'连锁预约隔离试验');
   this.unit.auditChanges(mainAudit,result.changes);
   for(const item of related) {
    const auditId=this.unit.audit(ctx,'变更',item.code,item,sid,item.reason);
    this.unit.auditChanges(auditId,item.changes);
   }
   this.db.exec('COMMIT');
   return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  } catch(error) {if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
module.exports={ChainReceptionTrial};
