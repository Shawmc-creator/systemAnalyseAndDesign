'use strict';
const {setupInventory,command}=require('./v2-inventory');
function setupSupply(t,options={}) {
  const a=setupInventory(t,options);
  a.supplyInfo=()=>a.supplierPayments.query(a.c,{supplierId:a.supplier.id});
  a.payment=id=>a.db.prepare('SELECT * FROM supplier_payment WHERE id=?').get(id);
  a.issue=id=>a.db.prepare('SELECT * FROM purchase_issue WHERE id=?').get(id);
  a.receiptLine=()=>a.db.prepare('SELECT r.* FROM purchase_receipt_item r JOIN purchase_receipt h ON h.id=r.purchase_receipt_id WHERE h.purchase_order_id=? ORDER BY r.id LIMIT 1').get(a.purchase.id);
  a.target=(kind='receipt',amount=10000,key=null)=>{const source=a.db.prepare('SELECT * FROM '+(kind==='receipt'?'purchase_receipt':'purchase_order')+' WHERE id=?').get(key||(kind==='receipt'?a.receipt.id:a.purchase.id));return {kind,id:source.id,expectedRevision:source.revision,amountCents:amount};};
  a.authorize=(extra={})=>a.supplierPayments.authorize(a.m,command({action:'authorize',supplierId:a.supplier.id,expectedSupplierRevision:1,expectedFundsRevision:a.supplyInfo().funds.revision,
    requestedCents:10000,channel:'现金',cashierId:3,reviewNote:'负责人核准本次供货付款与明确用途',allocations:extra.allocations||[a.target()],...extra}));
  a.pay=(paymentId,action,extra={})=>a.supplierPayments.pay(a.c,command({action,supplierId:a.supplier.id,expectedFundsRevision:a.supplyInfo().funds.revision,paymentId,expectedRevision:a.payment(paymentId).revision,
    transactionEvidence:'隔离测试：线下办理与核查实际结果',...extra}));
  a.confirmPayment=(paymentId,extra={})=>{a.pay(paymentId,'initiate');return a.pay(paymentId,'verify',{outcome:'success',actualCents:a.payment(paymentId).requested_cents,recipientMatches:true,...extra});};
  a.propose=(extra={})=>{
    const r=a.receiptLine();return a.purchases.receive(a.i,command({action:'proposeIssue',purchaseItemId:a.orderItem().id,expectedItemRevision:a.orderItem().revision,
      expectedPurchaseRevision:a.db.prepare('SELECT revision FROM purchase_order WHERE id=?').get(a.purchase.id).revision,receiptItemId:r?.id,expectedReceiptItemRevision:r?.revision,
      resolutionAction:'return',quantityScaled:20,resolutionNote:'明确退回原实物与价款处理范围',reason:'软件测试中如实记录的实际差异',...extra}));
  };
  a.approveIssue=(issueId,extra={})=>a.purchaseIssues.approve(a.m,command({action:'approve',issueId,expectedRevision:a.issue(issueId).revision,expectedFundsRevision:a.supplyInfo().funds.revision,reviewNote:'负责人核对原单与具体差异',...extra}));
  a.returnGoods=(issueId,extra={})=>a.purchases.receive(a.i,command({action:'returnGoods',issueId,expectedRevision:a.issue(issueId).revision,stockId:a.stock().id,expectedStockRevision:a.stock().revision,
    quantityScaled:20,returnedAt:a.auth.now(),handoverEvidence:'供应商实际接收实物的隔离演示证据',...extra}));
  return a;
}
module.exports={setupSupply,command};
