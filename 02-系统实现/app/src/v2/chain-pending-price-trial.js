'use strict';
const crypto=require('node:crypto');
const {id,text,fail,row,revision,insert,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {assertBillScope}=require('./chain-finance-query');
const {feeSnapshot,validateFees}=require('./fee-gates');
const {validateSettlements}=require('./settlement-rules');
const {mapError}=require('./unit-of-work');
const {decisionAt}=require('./quote-rules');

// Candidate pending pricing for independent checks and same-visit plans; no quoted or corrected work.
class ChainPendingPriceTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.billing=app.billing;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('核价试验仅允许内存数据库');}
 list(credentials,branchId){
  const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
   const ctx=this.access.authorizeBranch(credentials,'uc05.approve',branch);ctx.authority={...ctx.authority,branchId:branch};
   const items=this.db.prepare(`SELECT i.id,i.bill_id,i.revision,i.priced_at,i.quantity,i.quote_item_id,e.plan_item_id,e.service_id,e.tooth_code,e.surface_code,s.name service_name,b.patient_id,b.record_no bill_no,b.revision bill_revision
    FROM bill_item i JOIN bill b ON b.id=i.bill_id JOIN treatment_execution e ON e.id=i.treatment_execution_id
    JOIN visit v ON v.id=e.visit_id JOIN service s ON s.id=e.service_id JOIN patient_funds f ON f.id=b.patient_funds_id
    LEFT JOIN plan_item pi ON pi.id=e.plan_item_id LEFT JOIN plan_version pv ON pv.id=pi.plan_version_id LEFT JOIN treatment_plan tp ON tp.id=pv.treatment_plan_id
    LEFT JOIN quote_item qi ON qi.id=i.quote_item_id LEFT JOIN quote_version qv ON qv.id=qi.quote_version_id LEFT JOIN treatment_quote q ON q.id=qv.quote_id
    WHERE i.pricing_status='待核价' AND b.branch_id=? AND e.branch_id=b.branch_id AND v.branch_id=b.branch_id
    AND v.patient_id=b.patient_id AND f.branch_id=b.branch_id AND f.patient_id=b.patient_id
    AND (e.plan_item_id IS NULL OR (tp.branch_id=b.branch_id AND tp.patient_id=b.patient_id AND pv.source_visit_id=v.id)) AND e.original_execution_id IS NULL AND (i.quote_item_id IS NULL OR (q.branch_id=b.branch_id AND q.patient_id=b.patient_id AND qi.plan_item_id IS e.plan_item_id AND qi.service_id=e.service_id AND qi.tooth_code IS e.tooth_code AND qi.surface_code IS e.surface_code)) ORDER BY i.id`).all(branch);
   for(const item of items){item.quoteOptions=this.db.prepare(`SELECT qi.id,qi.amount_cents,qi.quantity,q.record_no,qv.version_no FROM quote_item qi JOIN quote_version qv ON qv.id=qi.quote_version_id JOIN treatment_quote q ON q.id=qv.quote_id WHERE q.branch_id=? AND q.patient_id=? AND qi.plan_item_id IS ? AND qi.service_id=? AND qi.tooth_code IS ? AND qi.surface_code IS ? AND qv.issued_at IS NOT NULL AND qv.id=(SELECT x.id FROM quote_version x WHERE x.quote_id=q.id AND x.issued_at IS NOT NULL ORDER BY x.version_no DESC LIMIT 1) ORDER BY q.id DESC`).all(branch,item.patient_id,item.plan_item_id,item.service_id,item.tooth_code,item.surface_code).map(x=>({...x,decision:decisionAt(this.db,x.id,this.auth.now())?.decision_type||null}));}
   this.unit.audit(ctx,'查询','CHAIN_PENDING_PRICE_LIST',{kind:'branch_pending_price_query',key:'branch:'+branch},null,'查询本店待核价诊疗项目');
   this.db.exec('COMMIT');return {branchId:branch,items};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
 price(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input||input.commandVersion!==1)fail(422,'TRIAL_SCOPE','提交版本无效');
  const branch=id(input.branchId,'门店'),itemId=id(input.billItemId,'账单明细'),priceId=id(input.priceId,'价目');
  const key=text(input.requestKey,'提交号',100),permission='uc05.approve',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};
   const item=row(this.db,'bill_item',itemId),bill=row(this.db,'bill',item.bill_id);
   assertBillScope(this.db,branch,bill.patient_id,bill.id);
   if(!item.treatment_execution_id||item.dispense_record_id)fail(409,'TRIAL_SCOPE','该项目不属于本演示的诊疗范围');
   const execution=row(this.db,'treatment_execution',item.treatment_execution_id),visit=row(this.db,'visit',execution.visit_id);
   if(execution.branch_id!==branch||visit.branch_id!==branch||visit.patient_id!==bill.patient_id)fail(409,'FINANCE_BRANCH_UNKNOWN','治疗、就诊及账目归属须先核对');
   for(const selectedQuote of new Set([item.quote_item_id,input.quoteItemId].filter(x=>x!=null))){const qi=row(this.db,'quote_item',id(selectedQuote,'报价项目')),qv=row(this.db,'quote_version',qi.quote_version_id),q=row(this.db,'treatment_quote',qv.quote_id);if(q.branch_id!==branch||q.patient_id!==bill.patient_id||qi.plan_item_id!==execution.plan_item_id||qi.service_id!==execution.service_id||qi.tooth_code!==execution.tooth_code||qi.surface_code!==execution.surface_code)fail(409,'QUOTE_SCOPE','报价、方案、牙位和账目归属不一致');}
   if(execution.original_execution_id)fail(409,'TRIAL_SCOPE','治疗更正须走完整流程');
   if(execution.plan_item_id){const planItem=row(this.db,'plan_item',execution.plan_item_id),version=row(this.db,'plan_version',planItem.plan_version_id),plan=row(this.db,'treatment_plan',version.treatment_plan_id);if(plan.branch_id!==branch||plan.patient_id!==bill.patient_id||version.source_visit_id!==visit.id)fail(409,'FINANCE_BRANCH_UNKNOWN','方案、就诊与账目归属不一致');}
   const price=row(this.db,'service_price',priceId);if(price.branch_id!==branch)fail(403,'PRICE_BRANCH','价目不属于当前门店');
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='bill_item'||Number(old.result_key)!==itemId)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   revision(bill,input.expectedBillRevision);
   const now=this.auth.now(),before=feeSnapshot(this.db);
   const result=this.billing.pricePending(ctx,input,now);
   validateFees(this.db,before);validateSettlements(this.db);
   ctx.authority={...ctx.authority,patientId:bill.patient_id,billId:bill.id,billItemId:item.id,priceId:price.id};
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,
    status:'已提交',created_at:now,committed_at:now,result_kind:result.kind,result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:result.kind,key:result.key,revision:result.revision,beforeRevision:result.beforeRevision},sid,result.reason);
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainPendingPriceTrial};
