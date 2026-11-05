'use strict';
const crypto=require('node:crypto');
const {fail,id,instant,text,insert,fact,row,revision,recordNo,hash,canonical,day,utc}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {assertBillScope}=require('./chain-finance-query');
const {treatmentSnapshot,validateTreatment,consentFor,leafQuantity}=require('./treatment-gates');
const {feeSnapshot,validateFees}=require('./fee-gates');
const {validateSettlements}=require('./settlement-rules');
const {assessExecution}=require('./quote-rules');
const {toothFields}=require('./treatment');

// Isolated demonstration; correction appends a new clinical note without changing charges.
class ChainTreatmentTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.billing=app.billing;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('诊疗试验仅允许内存数据库');}
 correct(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1)fail(422,'COMMAND_VERSION','提交版本无效');
  const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),originalId=id(input.originalExecutionId,'原诊疗记录'),key=text(input.requestKey,'提交号',100),permission='uc04.execute',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),visit=row(this.db,'visit',visitId),original=row(this.db,'treatment_execution',originalId);
   if(credentials.role!=='dentist'||visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id||original.visit_id!==visit.id||original.branch_id!==branch)fail(403,'VISIT_SCOPE','仅可更正本人本店的诊疗记录');
   ctx.authority={...ctx.authority,branchId:branch,patientId:visit.patient_id,visitId,originalExecutionId:originalId};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='treatment_execution')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');const saved=row(this.db,'treatment_execution',Number(old.result_key));if(saved.original_execution_id!==originalId||saved.branch_id!==branch)fail(409,'VISIT_SCOPE','原更正记录待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   if(this.db.prepare('SELECT 1 FROM treatment_execution WHERE original_execution_id=?').get(originalId))fail(409,'CORRECTION_NOT_LEAF','该记录已有后续更正，请选择最新记录');
   const now=this.auth.now(),reason=text(input.reason,'更正原因',2000),note=text(input.procedureNote,'更正后的操作经过',8000),before=treatmentSnapshot(this.db);
   const execution=insert(this.db,'treatment_execution',fact(now,{branch_id:branch,visit_id:visitId,plan_item_id:original.plan_item_id,service_id:original.service_id,original_execution_id:originalId,tooth_code:original.tooth_code,surface_code:original.surface_code,completed_quantity:original.completed_quantity,procedure_note:note,completed_at:original.completed_at,correction_reason:reason,execution_kind:'更正记录',performed_by:ctx.session.staff_id,record_no:recordNo('EXEC')}));
   validateTreatment(this.db,before);const submission=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'treatment_execution',result_key:String(execution),result_revision:1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'treatment_execution',key:execution,revision:1},submission,'追加诊疗经过更正，原费用不变');this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(submission)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 execute(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input||input.commandVersion!==1||(!input.planItemId&&input.independentCheck!==true))fail(422,'TRIAL_SCOPE','请选择已确认方案或填写独立检查依据');
  for(const name of ['quoteItemId','originalExecutionId'])if(input[name]!=null)fail(422,'TRIAL_SCOPE','直接指定报价或治疗更正暂不在演示范围');
  const branch=id(input.branchId,'门店'),patient=id(input.patientId,'患者'),visitId=id(input.visitId,'就诊'),serviceId=id(input.serviceId,'项目'),quantity=id(input.quantity,'数量');
  const key=text(input.requestKey,'提交号',100),permission='uc04.execute',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);
   const visit=row(this.db,'visit',visitId);
   if(visit.branch_id!==branch||visit.patient_id!==patient||visit.dentist_id!==ctx.session.staff_id)fail(403,'VISIT_SCOPE','仅可办理本店本人负责的就诊');
   ctx.authority={...ctx.authority,branchId:branch,patientId:patient,visitId};
   const prior=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(prior){if(prior.permission_id!==ctx.permission.id||prior.payload_digest!==digest||prior.result_kind!=='treatment_execution')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    if(!this.db.prepare('SELECT 1 FROM treatment_execution WHERE id=? AND visit_id=? AND branch_id=?').get(Number(prior.result_key),visitId,branch))fail(409,'VISIT_SCOPE','原执行门店或就诊待核对');
    this.db.exec('COMMIT');return {...this.unit.result(prior),replayed:true};}
   revision(visit,input.expectedVisitRevision);const now=this.auth.now(),at=instant(input.completedAt,'实际执行时间');
   if(visit.status!=='接诊中'||!visit.started_at||at<visit.started_at||at>now||(visit.ended_at&&at>visit.ended_at))fail(409,'VISIT_NOT_ACTIVE','须在实际接诊期间登记');
   const ended=this.db.prepare("SELECT released_at FROM resource_occupancy WHERE visit_id=? AND release_reason='实际操作结束，转清洁核验' ORDER BY id DESC LIMIT 1").get(visitId);
   if(ended && at>ended.released_at)fail(409,'VISIT_NOT_ACTIVE','操作结束后不可登记当次新执行');
   const service=row(this.db,'service',serviceId);if(!service.is_active)fail(409,'SERVICE_DISABLED','收费项目已停用');
   if(this.db.prepare('SELECT 1 FROM patient_funds WHERE patient_id=? AND branch_id IS NULL LIMIT 1').get(patient))fail(409,'FINANCE_BRANCH_UNKNOWN','患者存在归属待核对的资金账户，须先核实');
   if(input.planItemId&&this.db.prepare(`SELECT 1 FROM quote_item i JOIN quote_version v ON v.id=i.quote_version_id JOIN treatment_quote q ON q.id=v.quote_id WHERE i.plan_item_id=? AND v.issued_at IS NOT NULL AND q.branch_id IS NOT ? LIMIT 1`).get(id(input.planItemId,'方案项目'),branch))fail(409,'QUOTE_SCOPE','原报价门店待核对');
   let planItem=null,decision=null;if(input.planItemId!=null){planItem=row(this.db,'plan_item',id(input.planItemId,'方案项目'));const version=row(this.db,'plan_version',planItem.plan_version_id),plan=row(this.db,'treatment_plan',version.treatment_plan_id);
    if(plan.branch_id!==branch||plan.patient_id!==patient||version.source_visit_id!==visitId)fail(403,'PLAN_SCOPE','方案不属于本店本次就诊');
    if(planItem.item_description!==service.record_no+'｜'+service.name+'（'+service.billing_unit+'）')fail(409,'PLAN_SERVICE_MISMATCH','实际项目与患者确认的方案项目不一致');
    if(plan.status!=='进行中'||version.status!=='已确认'||this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(plan.id).id!==version.id)fail(409,'PLAN_NOT_EXECUTABLE','方案未确认或已停止');
    const then=consentFor(this.db,planItem.id,at),current=consentFor(this.db,planItem.id,now),total=leafQuantity(this.db,planItem.id)+BigInt(quantity);
    if(!then.approval||then.approval.created_at>at||then.latest?.created_at>at||current.latest?.id!==then.latest?.id)fail(409,'CONSENT_REQUIRED','须先取得当前有效的患者同意');
    if(total>then.limit||total>BigInt(planItem.planned_quantity))fail(409,'CONSENT_QUANTITY_EXCEEDED','实际数量超过患者同意或计划数量');decision=then.approval;ctx.authority.planItemId=planItem.id;ctx.authority.decisionId=decision.id;
   }
   const position=toothFields({toothCode:input.toothCode??planItem?.tooth_code??null,surfaceCode:input.surfaceCode??planItem?.surface_code??null});if(planItem&&(position.tooth_code!==planItem.tooth_code||position.surface_code!==planItem.surface_code))fail(409,'PLAN_TOOTH_MISMATCH','实际牙位须与患者确认的方案一致');
   const note=text(input.procedureNote,'实际操作经过',8000),basis=planItem?null:text(input.independentBasis,'独立检查依据',2000);
   const treatmentBefore=treatmentSnapshot(this.db),feeBefore=feeSnapshot(this.db);
   const execution=insert(this.db,'treatment_execution',fact(now,{branch_id:branch,visit_id:visitId,plan_item_id:planItem?.id??null,service_id:serviceId,original_execution_id:null,
    ...position,completed_quantity:quantity,procedure_note:basis?note+'\n独立检查咨询依据：'+basis:note,completed_at:at,correction_reason:null,
    execution_kind:'首次记录',performed_by:ctx.session.staff_id,record_no:recordNo('EXEC')}));
   let funds=this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=? AND branch_id=?').get(patient,branch);
   if(!funds){const fundsId=insert(this.db,'patient_funds',fact(now,{branch_id:branch,patient_id:patient,opened_at:now,opened_by:ctx.session.staff_id}));funds=row(this.db,'patient_funds',fundsId);}
   const periodStart=utc(day(at)+'T00:00:00+08:00'),periodEnd=utc(Date.parse(periodStart)+86400000);
   let bill=this.db.prepare('SELECT * FROM bill WHERE patient_id=? AND branch_id=? AND period_start=? AND period_end=? ORDER BY id LIMIT 1').get(patient,branch,periodStart,periodEnd);
   if(bill){assertBillScope(this.db,branch,patient,bill.id);if(bill.patient_funds_id!==funds.id)fail(409,'FINANCE_SCOPE','账目与资金账户不一致');
    this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now,bill.id);}
   else{const billId=insert(this.db,'bill',fact(now,{branch_id:branch,patient_id:patient,patient_funds_id:funds.id,formed_at:now,
    period_start:periodStart,period_end:periodEnd,created_by:ctx.session.staff_id,record_no:recordNo('BILL')}));bill=row(this.db,'bill',billId);}
   const price=this.db.prepare(`SELECT * FROM service_price WHERE service_id=? AND branch_id=? AND status='已确认可适用'
     AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 1`).get(serviceId,branch,at,at);
   if(price && BigInt(price.unit_price_cents)*BigInt(quantity)>BigInt(Number.MAX_SAFE_INTEGER))fail(422,'MONEY_RANGE','金额超出安全范围');
   const quoted=assessExecution(this.db,{patientId:patient,at,serviceId,quantity,executionId:execution,planItemId:planItem?.id??null,toothCode:position.tooth_code,surfaceCode:position.surface_code,quoteItemId:null},price,now);
   insert(this.db,'bill_item',fact(now,{bill_id:bill.id,treatment_execution_id:execution,dispense_record_id:null,service_price_id:price&&!quoted.hold?price.id:null,
    quantity,quantity_scale:0,unit_price_cents:price&&!quoted.hold?price.unit_price_cents:null,priced_at:at,quote_item_id:quoted.quoteItemId,
    pricing_note:quoted.hold||(!price?'本店缺少适用价目，等待核价':'按本店已确认价目'),pricing_status:price&&!quoted.hold?'已核价':'待核价',priced_by:price&&!quoted.hold?ctx.session.staff_id:null}));
   this.unit.validateReception();validateTreatment(this.db,treatmentBefore);validateFees(this.db,feeBefore);validateSettlements(this.db);
   this.billing.billSummary(bill.id);ctx.authority.billId=bill.id;ctx.authority.priceId=price?.id??null;
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:'treatment_execution',result_key:String(execution),result_revision:1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'treatment_execution',key:execution,revision:1},sid,planItem?'登记患者同意的方案项目并形成计费依据':'登记独立检查并形成本店计费依据');
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
}
module.exports={ChainTreatmentTrial};
