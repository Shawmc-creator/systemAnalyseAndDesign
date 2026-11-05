'use strict';
const crypto=require('node:crypto');
const {id,text,instant,dateOnly,day,fail,row,revision,insert,fact,recordNo,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {hasBranchRole,canReadCrossBranch}=require('./chain-access');
const {requireFrontdesk,followupSnapshot,validateFollowups}=require('./followup-rules');
const {signedIntegrity}=require('./clinical-gates');
const {mapError}=require('./unit-of-work');
const open=['待联系','待到诊或评估'];

// Limited to a signed source visit, same responsible branch and actual contacts.
class ChainFollowupTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('复诊试验仅允许内存数据库');}
 frontdesk(staff,branch,now){requireFrontdesk(this.db,this.auth,staff);if(!hasBranchRole(this.db,{staffId:staff,branchId:branch,role:'frontdesk',at:now}))fail(409,'FRONTDESK_BRANCH','责任前台未获本店授权');}
 source(ctx,branch,visitId){const visit=row(this.db,'visit',visitId);if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id)fail(403,'FOLLOWUP_SCOPE','仅可办理本店本人来源就诊');
  const record=this.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(visitId);if(!record||record.status!=='已签署'||!signedIntegrity(this.db,record))fail(409,'FOLLOWUP_SOURCE_NOT_READY','须先核对来源病历并完成签署');return visit;}
 list(credentials,branchId){const branch=id(branchId,'门店');if(!['frontdesk','dentist'].includes(credentials.role))fail(403,'FORBIDDEN','需要牙医或前台岗位');
  this.db.exec('BEGIN');try{const ctx=this.access.authorizeBranch(credentials,credentials.role==='dentist'?'uc12.propose':'uc13.contact',branch),now=this.auth.now();ctx.authority={...ctx.authority,branchId:branch};
   const items=this.db.prepare(`SELECT f.id,f.patient_id,f.source_visit_id,f.source_branch_id,f.responsible_branch_id,f.responsible_frontdesk_id,f.purpose,f.followup_type,f.target_start,f.target_end,f.requires_assessment,f.next_contact_date,f.status,f.revision,f.created_at,p.name patient_name,p.record_no patient_no,p.birth_date patient_birth_date
    FROM followup_requirement f JOIN patient p ON p.id=f.patient_id JOIN visit v ON v.id=f.source_visit_id AND v.patient_id=f.patient_id
    WHERE f.responsible_branch_id=? AND f.source_branch_id=v.branch_id AND f.source_plan_version_id IS NULL AND (?='dentist' OR ?='frontdesk' AND f.responsible_frontdesk_id=? AND f.status<>'待发布') ORDER BY f.id DESC`).all(branch,credentials.role,credentials.role,ctx.session.staff_id).filter(f=>credentials.role!=='dentist'||(f.source_branch_id===branch?this.db.prepare('SELECT dentist_id FROM visit WHERE id=?').get(f.source_visit_id).dentist_id===ctx.session.staff_id:canReadCrossBranch(this.db,{staffId:ctx.session.staff_id,targetBranchId:branch,sourceBranchId:f.source_branch_id,patientId:f.patient_id,visitId:f.source_visit_id,scope:'record',at:now})));
   for(const f of items){f.contacts=this.db.prepare('SELECT id,method,contacted_at,result,next_contact_date,note,appointment_id FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at,id').all(f.id);
    if(credentials.role==='dentist')f.assessments=this.db.prepare('SELECT id,visit_id,method,assessed_at,result,advice FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at,id').all(f.id);
    if(credentials.role==='frontdesk')f.contactInfo=this.db.prepare('SELECT phone,phone_owner,contact_preference,contact_unavailable_reason FROM patient WHERE id=?').get(f.patient_id);}
   const frontdesks=credentials.role==='dentist'?this.db.prepare(`SELECT DISTINCT s.id,s.name FROM staff s JOIN branch_staff_role r ON r.staff_id=s.id WHERE r.branch_id=? AND r.role_code='frontdesk' ORDER BY s.id`).all(branch).filter(s=>{try{this.frontdesk(s.id,branch,now);return true;}catch(e){if(e.status&&e.status<500)return false;throw e;}}):[];
   const appointments=credentials.role==='frontdesk'?this.db.prepare("SELECT id,patient_id,planned_start,planned_end,status,revision FROM appointment WHERE branch_id=? AND status IN ('已预约','已到诊') ORDER BY planned_start").all(branch):[];
   const visits=credentials.role==='dentist'?this.db.prepare("SELECT id,patient_id,record_no,started_at,ended_at,status FROM visit WHERE branch_id=? AND dentist_id=? AND started_at IS NOT NULL AND status IN ('接诊中','诊疗结束') ORDER BY id DESC").all(branch,ctx.session.staff_id):[];
   this.unit.audit(ctx,'查询','CHAIN_FOLLOWUP_LIST',{kind:'branch_followup_query',key:'branch:'+branch},null,'按门店和本人责任查询复诊事项');this.db.exec('COMMIT');return {items,frontdesks,appointments,visits};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 command(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['create','contact','assess'].includes(input.action))fail(422,'INVALID_ACTION','复诊动作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission={create:'uc12.propose',contact:'uc13.contact',assess:'uc14.assess'}[input.action],digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{const ctx=this.access.authorizeBranch(credentials,permission,branch),now=this.auth.now();ctx.authority={...ctx.authority,branchId:branch};
   let f=null;if(input.action!=='create'){f=row(this.db,'followup_requirement',id(input.followupId,'复诊事项'));if(f.responsible_branch_id!==branch||!f.source_branch_id||!f.source_visit_id||f.source_plan_version_id)fail(409,'FOLLOWUP_BRANCH_UNKNOWN','复诊责任或来源门店须先核对');
    const source=row(this.db,'visit',f.source_visit_id);if(source.branch_id!==f.source_branch_id||source.patient_id!==f.patient_id)fail(409,'FOLLOWUP_BRANCH_UNKNOWN','复诊来源及患者须先核对');
    const sourceRecord=this.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(source.id);if(!sourceRecord||sourceRecord.status!=='已签署'||!signedIntegrity(this.db,sourceRecord))fail(409,'FOLLOWUP_SOURCE_NOT_READY','来源病历未签署或校验未通过，请先核对');
    if(input.action==='contact'&&f.responsible_frontdesk_id!==ctx.session.staff_id)fail(403,'FOLLOWUP_FRONTDESK_SCOPE','仅可办理本人负责的联系');
    if(input.action==='assess'&&(source.branch_id===branch?source.dentist_id!==ctx.session.staff_id:!canReadCrossBranch(this.db,{staffId:ctx.session.staff_id,targetBranchId:branch,sourceBranchId:source.branch_id,patientId:f.patient_id,visitId:source.id,scope:'record',at:now})))fail(403,'FOLLOWUP_SCOPE','跨店评估须获得来源病历授权');
    ctx.authority.followupId=f.id;ctx.authority.patientId=f.patient_id;}
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key),kind={create:'followup_requirement',contact:'contact_history',assess:'clinical_assessment'}[input.action];
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!==kind)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    if(f){const table=input.action==='contact'?'contact_history':'clinical_assessment';if(!this.db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND followup_requirement_id=?`).get(Number(old.result_key),f.id))fail(409,'FOLLOWUP_SCOPE','原提交归属待核对');}
    else if(!this.db.prepare('SELECT 1 FROM followup_requirement WHERE id=? AND source_branch_id=? AND responsible_branch_id=? AND created_by=?').get(Number(old.result_key),branch,branch,ctx.session.staff_id))fail(409,'FOLLOWUP_SCOPE','原要求归属待核对');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const before=followupSnapshot(this.db),history=this.unit.workflowHistory.snapshot();let result,reason;
   if(input.action==='create'){
    const visit=this.source(ctx,branch,id(input.visitId,'来源就诊'));if(!['复诊','随访'].includes(input.type)||typeof input.requiresAssessment!=='boolean')fail(422,'FOLLOWUP_FIELDS','请明确复诊类型及是否需要评估');
    const start=dateOnly(input.targetStart,'目标开始'),end=dateOnly(input.targetEnd,'目标截止'),next=dateOnly(input.nextContactDate,'下次联系');if(end<start||next<day(now))fail(422,'FOLLOWUP_WINDOW','请核对目标日期及下次联系时间');
    const responsible=id(input.responsibleFrontdeskId,'责任前台');this.frontdesk(responsible,branch,now);const purpose=text(input.purpose,'复诊目的',2000);
    if(this.db.prepare(`SELECT 1 FROM followup_requirement WHERE patient_id=? AND source_visit_id=? AND source_plan_version_id IS NULL AND followup_type=? AND purpose=? AND status IN ('待发布','待联系','待到诊或评估') AND target_start<=? AND target_end>=?`).get(visit.patient_id,visit.id,input.type,purpose,end,start))fail(409,'FOLLOWUP_DUPLICATE','相同来源和目的已有重叠要求');
    const followup=insert(this.db,'followup_requirement',fact(now,{patient_id:visit.patient_id,source_visit_id:visit.id,source_plan_version_id:null,source_branch_id:branch,responsible_branch_id:branch,purpose,followup_type:input.type,target_start:start,target_end:end,requires_assessment:input.requiresAssessment?1:0,responsible_frontdesk_id:responsible,next_contact_date:next,cancellation_reason:null,closed_at:null,closure_basis:null,created_by:ctx.session.staff_id,closed_by:null,published_by:ctx.session.staff_id,published_at:now,status:'待联系',record_no:recordNo('FOLLOW')}));
    this.unit.workflowHistory.append('followup_requirement',followup,'发布','来源病历已签署，发布复诊要求',ctx,input,now);result={kind,key:followup,revision:1};ctx.authority={...ctx.authority,followupId:followup,patientId:visit.patient_id,sourceVisitId:visit.id};reason='提出本店复诊要求';
   }else if(input.action==='contact'){
    revision(f,input.expectedRevision);if(!open.includes(f.status))fail(409,'FOLLOWUP_CLOSED','当前复诊事项不能联系办理');this.frontdesk(ctx.session.staff_id,branch,now);
    if(!['已联系','未联系上','拒绝','待跟进'].includes(input.result)||!['continue','arrange','complete'].includes(input.nextStep))fail(422,'FOLLOWUP_CONTACT','请选择联系结果和后续动作');
    const at=instant(input.contactedAt,'实际联系时间'),last=this.db.prepare('SELECT * FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at DESC,id DESC LIMIT 1').get(f.id);
    if(at>now||at<f.created_at||(last&&at<last.contacted_at))fail(422,'FOLLOWUP_CONTACT_TIME','联系时间须已发生且按顺序记录');
    let appointment=null;if(input.appointmentId!=null){appointment=row(this.db,'appointment',id(input.appointmentId,'预约'));revision(appointment,input.expectedAppointmentRevision);
     if(appointment.branch_id!==branch||appointment.patient_id!==f.patient_id)fail(409,'FOLLOWUP_BRANCH_UNKNOWN','预约与负责门店或患者不一致');
     if(!['已预约','已到诊'].includes(appointment.status)||(appointment.status==='已预约'&&appointment.planned_end<=now)||appointment.planned_start<f.created_at||day(appointment.planned_start)<f.target_start||day(appointment.planned_start)>f.target_end||appointment.id===row(this.db,'visit',f.source_visit_id).appointment_id)fail(409,'FOLLOWUP_APPOINTMENT_WINDOW','请选择目标日期内有效的复诊预约');
    }else if(last?.appointment_id){const prior=row(this.db,'appointment',last.appointment_id);if(['已预约','已到诊'].includes(prior.status))appointment=prior;}
    if(appointment&&(appointment.branch_id!==branch||appointment.patient_id!==f.patient_id))fail(409,'FOLLOWUP_BRANCH_UNKNOWN','历史预约与负责门店或患者不一致');
    if(appointment&&((appointment.status==='已预约'&&appointment.planned_end<=now)||appointment.planned_start<f.created_at||day(appointment.planned_start)<f.target_start||day(appointment.planned_start)>f.target_end||appointment.id===row(this.db,'visit',f.source_visit_id).appointment_id))fail(409,'FOLLOWUP_APPOINTMENT_WINDOW','已有预约已过期或不在复诊目标范围，请先核对');
    if(input.result!=='已联系'&&input.nextStep!=='continue')fail(422,'FOLLOWUP_CONTACT_RESULT','未实际联系不能记为安排或完成');
    let status,next=null,closure=null;if(input.nextStep==='arrange'){if(!appointment)fail(422,'FOLLOWUP_APPOINTMENT','请先建立复诊预约');status='待到诊或评估';}
    else if(input.nextStep==='complete'){if(f.status!=='待联系'||f.requires_assessment||appointment||input.goalAchieved!==true)fail(409,'FOLLOWUP_ASSESSMENT_REQUIRED','需临床评估或已有预约的事项不能由前台直接完成');status='已完成';closure=text(input.completionBasis,'完成依据',2000);}
    else{status=appointment?'待到诊或评估':'待联系';next=dateOnly(input.nextContactDate,'下次联系日期');if(next<day(now))fail(422,'FOLLOWUP_NEXT_DATE','下次联系不能早于今天');}
    const contact=insert(this.db,'contact_history',fact(now,{followup_requirement_id:f.id,appointment_id:appointment?.id??null,operator_branch_id:branch,method:text(input.method,'联系方式',100),contacted_at:at,result:input.result,next_contact_date:next,note:text(input.note,'实际联系内容',4000),operator_id:ctx.session.staff_id}));
    this.db.prepare('UPDATE followup_requirement SET status=?,next_contact_date=?,closed_at=?,closure_basis=?,closed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,next,closure?now:null,closure,closure?ctx.session.staff_id:null,now,f.id);
    this.unit.workflowHistory.append('followup_requirement',f.id,status==='已完成'?'完成':'联系更新',closure||'记录实际联系及安排',ctx,input,now);result={kind,key:contact,revision:1};reason='记录本店实际复诊联系';
   }else{
    revision(f,input.expectedRevision);if(!open.includes(f.status))fail(409,'FOLLOWUP_CLOSED','当前事项不能评估');if(!['远程沟通','到诊检查'].includes(input.method)||!['完成','继续跟进'].includes(input.advice)||input.assessmentCompleted!==true)fail(422,'TRIAL_SCOPE','请选择实际评估方式和处理意见并确认');
    const at=instant(input.assessedAt,'实际评估时间'),last=this.db.prepare('SELECT assessed_at FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at DESC,id DESC LIMIT 1').get(f.id);if(at>now||at<f.created_at||(last&&at<last.assessed_at))fail(422,'FOLLOWUP_ASSESSMENT_TIME','评估时间须已发生并按顺序记录');
    let visitId=null;if(input.method==='到诊检查'){const v=row(this.db,'visit',id(input.visitId,'复诊就诊'));if(v.branch_id!==branch||v.dentist_id!==ctx.session.staff_id||v.patient_id!==f.patient_id||v.id===f.source_visit_id||!v.started_at||v.started_at<f.created_at||v.started_at>at||(v.ended_at&&at>v.ended_at)||!['接诊中','诊疗结束'].includes(v.status))fail(409,'FOLLOWUP_VISIT_NOT_ACTUAL','请选择本店本人对同一患者实际开展的复诊接诊');visitId=v.id;}else if(input.visitId!=null)fail(422,'FOLLOWUP_REMOTE_VISIT','远程评估不能关联到诊记录');else if(f.source_branch_id!==branch)fail(409,'FOLLOWUP_VISIT_NOT_ACTUAL','跨店复诊请关联本人实际接诊记录');
    let next=null,responsible=null;if(input.advice==='继续跟进'){next=dateOnly(input.nextDate,'下次联系日期');if(next<day(now))fail(422,'FOLLOWUP_NEXT_DATE','下次联系不能早于今天');responsible=id(input.responsibleFrontdeskId??f.responsible_frontdesk_id,'责任前台');this.frontdesk(responsible,branch,now);}
    const assessment=insert(this.db,'clinical_assessment',fact(now,{followup_requirement_id:f.id,visit_id:visitId,method:input.method,assessed_at:at,result:text(input.result,'实际评估结果',6000),advice:input.advice,next_date:next,assessed_by:ctx.session.staff_id,responsible_staff_id:responsible}));
    if(input.advice==='完成'&&f.status==='待联系')this.db.prepare("UPDATE followup_requirement SET status='待到诊或评估' WHERE id=?").run(f.id);
    const finished=input.advice==='完成';this.db.prepare('UPDATE followup_requirement SET status=?,next_contact_date=?,responsible_frontdesk_id=?,closed_at=?,closure_basis=?,closed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(finished?'已完成':'待联系',next,responsible??f.responsible_frontdesk_id,finished?now:null,finished?'依据临床评估编号'+assessment+'及牙医完成确认':null,finished?ctx.session.staff_id:null,now,f.id);if(!finished)ctx.authority={...ctx.authority,previousFrontdeskId:f.responsible_frontdesk_id,responsibleFrontdeskId:responsible};
    this.unit.workflowHistory.append('followup_requirement',f.id,finished?'完成':'继续跟进','依据实际临床评估编号'+assessment,ctx,input,now);result={kind,key:assessment,revision:1};reason=finished?'牙医完成实际临床评估':'牙医评估后安排继续跟进';
   }
   this.unit.validateReception();validateFollowups(this.db,before);this.unit.workflowHistory.validate(history,permission);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:kind,result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',result,sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainFollowupTrial};
