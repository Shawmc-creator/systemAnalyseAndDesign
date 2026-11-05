'use strict';
const crypto=require('node:crypto');
const {fail,id,text,instant,insert,fact,recordNo,hash,canonical,revision}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {assertBillScope}=require('./chain-finance-query');
const {feeSnapshot,validateFees}=require('./fee-gates');
const {paymentGate,validateSettlements}=require('./settlement-rules');

// In-memory demonstration only. Records an already verified offline receipt
// allocated to one existing bill; never initiates payment or refund.
class ChainCashTrial {
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.billing=app.billing;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('现金登记试验仅允许内存数据库');}
 receive(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input||input.commandVersion!==1)fail(422,'INVALID_INPUT','提交版本无效');
  const branch=id(input.branchId,'门店'),patient=id(input.patientId,'患者'),billId=id(input.billId,'账单'),key=text(input.requestKey,'提交号',100);
  const digest=hash(canonical({permission:'uc07.receive',input}));
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const ctx=this.access.authorizeBranch(credentials,'uc07.receive',branch);
   this.access.authorizeBranch(credentials,'uc07.allocate',branch);
   ctx.authority={...ctx.authority,branchId:branch,patientId:patient,billId};
   const bill=assertBillScope(this.db,branch,patient,billId),funds=this.db.prepare('SELECT * FROM patient_funds WHERE id=?').get(bill.patient_funds_id);
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='patient_payment')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容或门店');
    if(!this.db.prepare('SELECT 1 FROM patient_payment WHERE id=? AND branch_id=? AND patient_funds_id=?').get(Number(old.result_key),branch,funds.id))fail(409,'FINANCE_BRANCH_UNKNOWN','原付款归属待核实');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   revision(bill,input.expectedBillRevision);revision(funds,input.expectedFundsRevision);
   paymentGate(this.db,bill.id);
   const summary=this.billing.billSummary(bill.id),amount=this.billing.amount(input.amountCents),now=this.auth.now();
   if(summary.pendingPricingCount||summary.insurancePending||summary.insuranceReversalPending)fail(409,'BILL_PENDING','费用或医保尚待核对');
   if(amount>summary.unpaidCents)fail(409,'BILL_BUDGET','登记金额不能超过本账最新待付');
   if(input.verified!==true)fail(422,'PAYMENT_VERIFICATION','请先核实系统外实际收款');
   const channel=input.channel??'现金';
   if(!['现金','银行卡','微信','支付宝'].includes(channel))fail(422,'PAYMENT_CHANNEL','收款渠道无效');
   const reference=channel==='现金'?null:text(input.externalReference,'已核实的渠道交易号',200);
   if(channel==='现金' && input.externalReference!=null)fail(422,'PAYMENT_REFERENCE','现金登记不填写电子交易号');
   if(reference && this.db.prepare('SELECT 1 FROM patient_payment WHERE channel=? AND external_reference=?').get(channel,reference))
    fail(409,'PAYMENT_DUPLICATE','该渠道交易已经登记，请核实原付款');
   const receivedAt=instant(input.receivedAt,'实际收款时间');if(receivedAt>now)fail(422,'PAYMENT_TIME','实际收款不能在未来');
   const evidence=text(input.evidence,'实际收款核实依据',2000),before=feeSnapshot(this.db);
   const paymentId=insert(this.db,'patient_payment',fact(now,{branch_id:branch,patient_funds_id:funds.id,received_cents:amount,change_cents:0,
    channel,received_at:receivedAt,transaction_evidence:evidence,external_reference:reference,verified_at:now,operator_id:ctx.session.staff_id,
    verified_by:ctx.session.staff_id,status:'到账已确认',record_no:recordNo('PAY'),quote_id:null}));
   insert(this.db,'payment_allocation',fact(now,{patient_payment_id:paymentId,bill_id:bill.id,amount_cents:amount,effective_at:now,
    reason:evidence,operator_id:ctx.session.staff_id,original_allocation_id:null,fee_request_id:null}));
   this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now,bill.id);
   this.db.prepare('UPDATE patient_funds SET updated_at=?,revision=revision+1 WHERE id=?').run(now,funds.id);
   validateFees(this.db,before);validateSettlements(this.db);this.billing.billSummary(bill.id);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,
    command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'patient_payment',result_key:String(paymentId),result_revision:1,
    result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'patient_payment',key:paymentId,revision:1},sid,evidence);
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
 }
}
module.exports={ChainCashTrial};
