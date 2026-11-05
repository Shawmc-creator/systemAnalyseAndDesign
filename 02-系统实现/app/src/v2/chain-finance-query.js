'use strict';
const {id,fail}=require('./common');
const {ChainAuth}=require('./chain-auth');
function assertBillScope(db,branch,patient,billId){
 const bill=db.prepare(`SELECT b.*,f.branch_id funds_branch,f.patient_id funds_patient FROM bill b
  JOIN patient_funds f ON f.id=b.patient_funds_id WHERE b.id=? AND b.branch_id=? AND b.patient_id=?`).get(billId,branch,patient);
 if(!bill)fail(403,'FINANCE_SCOPE','账目不属于当前患者或门店');
 if(bill.funds_branch!==branch||bill.funds_patient!==patient)fail(409,'FINANCE_BRANCH_UNKNOWN','账目与患者资金门店归属不一致，请先核对');
 for(const table of ['payment_allocation','prepayment_offset']) {
  const bad=db.prepare(`SELECT 1 FROM ${table} a JOIN patient_payment p ON p.id=a.patient_payment_id
   JOIN patient_funds f ON f.id=p.patient_funds_id WHERE a.bill_id=? AND (p.branch_id IS NOT ? OR f.branch_id IS NOT ? OR f.patient_id IS NOT ?) LIMIT 1`).get(bill.id,branch,branch,patient);
  if(bad)fail(409,'FINANCE_BRANCH_UNKNOWN','付款与账目的门店或患者归属不一致，请先核对');
 }
 return bill;
}

// Read-only candidate: never reuse the single-store patient-wide funds summary
// across branches. Inconsistent or unknown legacy ownership is rejected.
class ChainFinanceQuery {
 constructor(app){this.db=app.db;this.auth=app.auth;this.billing=app.billing;this.unit=app.unit;this.access=new ChainAuth(app.auth);}
 query(credentials,input){
  const branch=id(input.branchId,'门店'),patient=id(input.patientId,'患者');
  if(this.db.isTransaction)throw new Error('财务查询须独立执行');
  this.db.exec('BEGIN');
  try{
   const ctx=this.access.authorizeBranch(credentials,'uc06.query',branch);
   ctx.authority={...ctx.authority,branchId:branch,patientId:patient};
   const bills=this.db.prepare(`SELECT b.id,b.patient_id,b.record_no,b.formed_at,b.revision,b.branch_id,f.branch_id funds_branch,f.patient_id funds_patient,f.revision fundsRevision
    FROM bill b JOIN patient_funds f ON f.id=b.patient_funds_id WHERE b.branch_id=? AND b.patient_id=? ORDER BY b.id`).all(branch,patient);
   for(const bill of bills){
    assertBillScope(this.db,branch,patient,bill.id);
   }
   const items=bills.map(({funds_branch,funds_patient,...bill})=>({...bill,summary:this.billing.billSummary(bill.id),
    lines:this.billing.lines(bill.id).map(line=>{const source=line.treatment_execution_id?this.db.prepare('SELECT e.branch_id execution_branch,e.tooth_code,e.surface_code,e.completed_at,v.branch_id visit_branch,v.patient_id FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.id=?').get(line.treatment_execution_id):null;const verified=!!source&&source.execution_branch===branch&&source.visit_branch===branch&&source.patient_id===patient;return {id:line.id,service_name:line.service_name,billing_unit:line.billing_unit,quantity:line.quantity,amount_cents:line.amount_cents,pricing_status:line.pricing_status,source_verified:verified,has_clinical_correction:verified&&!!line.has_clinical_correction,tooth_code:verified?source.tooth_code:null,surface_code:verified?source.surface_code:null,completed_at:verified?source.completed_at:null};}),
    payments:this.db.prepare(`SELECT DISTINCT p.id,p.record_no,p.channel,p.status,p.received_at,p.net_cents,p.external_reference
      FROM patient_payment p JOIN payment_allocation a ON a.patient_payment_id=p.id WHERE a.bill_id=? AND p.branch_id=? ORDER BY p.id`).all(bill.id,branch)}));
   this.unit.audit(ctx,'查询','CHAIN_BILL_QUERY',{kind:'branch_bill_query',key:'branch:'+branch},null,'按门店核对账单');
   this.db.exec('COMMIT');return {branchId:branch,patientId:patient,items};
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
module.exports={ChainFinanceQuery,assertBillScope};
