'use strict';
const {id,day,fail}=require('./common');
const {safe}=require('./inventory-gates');
const {ChainAuth}=require('./chain-auth');
const {ChainInventoryTrial}=require('./chain-inventory-trial');
const {mapError}=require('./unit-of-work');
class ChainDashboardTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);this.inventory=new ChainInventoryTrial(app);}
 query(credentials,branchId){if(credentials.role!=='manager')fail(403,'FORBIDDEN','需要负责人岗位');const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'clinic.manage',branch);ctx.authority={...ctx.authority,branchId:branch};
  const businessDate=day(this.auth.now()),start=new Date(businessDate+'T00:00:00+08:00').toISOString().replace('.000Z','Z'),end=new Date(Date.parse(start)+86400000).toISOString().replace('.000Z','Z');
  const appointments=this.db.prepare("SELECT status,COUNT(*) n FROM appointment WHERE branch_id=? AND planned_start>=? AND planned_start<? GROUP BY status").all(branch,start,end);
  const visits=this.db.prepare('SELECT COUNT(*) n FROM visit WHERE branch_id=? AND arrived_at>=? AND arrived_at<?').get(branch,start,end).n;
  const payments=this.db.prepare("SELECT p.received_cents,p.change_cents,f.branch_id funds_branch FROM patient_payment p LEFT JOIN patient_funds f ON f.id=p.patient_funds_id WHERE p.branch_id=? AND p.status='到账已确认' AND p.received_at>=? AND p.received_at<?").all(branch,start,end);
  if(payments.some(p=>p.funds_branch!==branch))fail(409,'FINANCE_BRANCH_UNKNOWN','收款归属待核对');
  const receivedCents=safe(payments.reduce((n,p)=>n+BigInt(p.received_cents)-BigInt(p.change_cents),0n));
  const refunds=this.db.prepare(`SELECT r.actual_cents,f.branch_id funds_branch,p.branch_id payment_branch FROM patient_refund r JOIN patient_funds f ON f.id=r.patient_funds_id JOIN patient_payment p ON p.id=r.patient_payment_id WHERE f.branch_id=? AND r.status='已确认退款' AND r.verified_at>=? AND r.verified_at<?`).all(branch,start,end);
  if(refunds.some(r=>r.funds_branch!==branch||r.payment_branch!==branch||r.actual_cents==null))fail(409,'FINANCE_BRANCH_UNKNOWN','退款归属或金额待核对');
  const refundedCents=safe(refunds.reduce((n,r)=>n+BigInt(r.actual_cents),0n)),netCents=safe(BigInt(receivedCents)-BigInt(refundedCents));
  const stocks=this.db.prepare('SELECT s.id FROM batch_stock s JOIN material_batch b ON b.id=s.material_batch_id JOIN stock_location l ON l.id=s.stock_location_id WHERE b.branch_id=? OR l.branch_id=?').all(branch,branch);
  for(const stock of stocks)this.inventory.scope(stock.id,branch);
  const pendingCounts=this.db.prepare("SELECT COUNT(*) n FROM stock_count c JOIN batch_stock s ON s.id=c.batch_stock_id JOIN material_batch b ON b.id=s.material_batch_id JOIN stock_location l ON l.id=s.stock_location_id WHERE b.branch_id=? AND l.branch_id=? AND c.status IN ('待确认差异','待重新核对')").get(branch,branch).n;
  const pendingPurchases=this.db.prepare("SELECT COUNT(*) n FROM purchase_order WHERE branch_id=? AND status='待确认'").get(branch).n;
  this.unit.audit(ctx,'查询','CHAIN_DASHBOARD',{kind:'branch_dashboard',key:'branch:'+branch},null,'查询本店汇总');this.db.exec('COMMIT');
  return {branchId:branch,businessDate,appointments:Object.fromEntries(appointments.map(x=>[x.status,x.n])),arrivals:visits,confirmedReceiptCount:payments.length,confirmedReceiptCents:receivedCents,confirmedRefundCount:refunds.length,confirmedRefundCents:refundedCents,netReceiptCents:netCents,stockRecords:stocks.length,pendingCounts,pendingPurchases};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainDashboardTrial};
