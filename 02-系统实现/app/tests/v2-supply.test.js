'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupSupply,command}=require('./helpers/v2-supply');
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
test('manager authorization holds exact supplier targets without recording actual outflow or allowing cashier approval',t=>{
  const a=setupSupply(t),p=a.authorize();const q=a.supplyInfo();
  assert.equal(q.totals.paidCents,0);assert.equal(q.totals.heldCents,10000);assert.equal(q.items[0].operator_id,3);
  assert.equal(q.items[0].allocations[0].allocation_state,'待生效');
  rejects(()=>a.authorize(),'SUPPLY_PAYMENT_IN_PROGRESS');
  rejects(()=>a.supplierPayments.authorize(a.c,command({})),'FORBIDDEN');
  rejects(()=>a.pay(p.id,'verify',{outcome:'success',actualCents:10000,recipientMatches:true}),'SUPPLY_PAYMENT_NOT_STARTED');
});
test('unknown payment keeps the original full reservation and confirmed outcome settles it once',t=>{
  const a=setupSupply(t),p=a.authorize();a.pay(p.id,'initiate');
  a.pay(p.id,'verify',{outcome:'unknown'});assert.equal(a.supplyInfo().totals.heldCents,10000);
  rejects(()=>a.pay(p.id,'initiate'),'SUPPLY_PAYMENT_STARTED');
  a.pay(p.id,'verify',{outcome:'success',actualCents:10000,recipientMatches:true});
  const q=a.supplyInfo();assert.equal(q.totals.paidCents,10000);assert.equal(q.totals.heldCents,0);assert.equal(q.orders[0].receipts[0].committedCents,10000);
  rejects(()=>a.pay(p.id,'verify',{outcome:'success',actualCents:10000,recipientMatches:true}),'SUPPLY_PAYMENT_CLOSED');
});
test('partial actual payment requires actual target split and releases the unexecuted reservation',t=>{
  const a=setupSupply(t),p=a.authorize();a.pay(p.id,'initiate');const allocation=a.supplyInfo().items[0].allocations[0];
  rejects(()=>a.pay(p.id,'verify',{outcome:'success',actualCents:8000,recipientMatches:true}),'SUPPLY_ACTUAL_ALLOCATION');
  a.pay(p.id,'verify',{outcome:'success',actualCents:8000,recipientMatches:true,actualAllocations:[{allocationId:allocation.id,amountCents:8000}]});
  assert.equal(a.supplyInfo().totals.paidCents,8000);assert.equal(a.supplyInfo().totals.heldCents,0);assert.equal(a.supplyInfo().orders[0].receipts[0].committedCents,8000);
});
test('failed payment releases holds and manager may authorize only one linked replacement attempt',t=>{
  const a=setupSupply(t),p=a.authorize();a.pay(p.id,'initiate');a.pay(p.id,'verify',{outcome:'failed',actualCents:0});
  assert.equal(a.supplyInfo().totals.heldCents,0);const second=a.authorize({previousAttemptId:p.id});
  a.pay(second.id,'cancelUnstarted');rejects(()=>a.authorize({previousAttemptId:p.id}),'SUPPLY_RETRY_SOURCE');
  a.authorize({previousAttemptId:second.id});assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_payment').get().n,3);
});
test('contradictory amount or recipient evidence remains unconfirmed and does not release the original hold',t=>{
  const a=setupSupply(t),p=a.authorize();a.pay(p.id,'initiate');
  const result=a.pay(p.id,'verify',{outcome:'failed',actualCents:1000});assert.equal(result.code,'SUPPLY_REVIEW_REQUIRED');
  a.pay(p.id,'verify',{outcome:'success',actualCents:10000,recipientMatches:false});
  assert.equal(a.supplyInfo().totals.paidCents,0);assert.equal(a.supplyInfo().totals.heldCents,10000);
});
test('noncash confirmed payments require a unique actual channel reference',t=>{
  const a=setupSupply(t),p=a.authorize({requestedCents:5000,channel:'微信',allocations:[a.target('receipt',5000)]});a.pay(p.id,'initiate');
  assert.equal(a.pay(p.id,'verify',{outcome:'success',actualCents:5000,recipientMatches:true}).code,'SUPPLY_REVIEW_REQUIRED');
  a.pay(p.id,'verify',{outcome:'success',actualCents:5000,recipientMatches:true,externalReference:'SUP-TRANSACTION-1'});
  const second=a.authorize({requestedCents:5000,channel:'微信',allocations:[a.target('receipt',5000)]});a.pay(second.id,'initiate');
  rejects(()=>a.pay(second.id,'verify',{outcome:'success',actualCents:5000,recipientMatches:true,externalReference:'SUP-TRANSACTION-1'}),'SUPPLY_REFERENCE_DUPLICATE');
  assert.equal(a.supplyInfo().totals.paidCents,5000);assert.equal(a.supplyInfo().totals.heldCents,5000);
});
test('changed original sources prevent starting a stale authorization; an unstarted authorization may be explicitly canceled',t=>{
  const a=setupSupply(t,{receive:false});const p=a.authorize({allocations:[a.target('order')]});
  a.receipt=a.receive();
  rejects(()=>a.pay(p.id,'initiate'),'VERSION_CONFLICT');a.pay(p.id,'cancelUnstarted');assert.equal(a.supplyInfo().totals.heldCents,0);
});
test('prepayment is moved to actual receipt by approved release and reallocation without a second payment',t=>{
  const a=setupSupply(t,{receive:false});const p=a.authorize({allocations:[a.target('order')]});a.confirmPayment(p.id);a.receipt=a.receive();
  const before=a.supplyInfo(),allocation=before.items[0].allocations.find(x=>x.allocation_state==='已生效');
  a.supplierPayments.authorize(a.m,command({action:'authorizeReallocation',supplierId:a.supplier.id,expectedSupplierRevision:1,expectedFundsRevision:before.funds.revision,paymentId:p.id,expectedRevision:a.payment(p.id).revision,
    reviewNote:'预付转本次实际验收',releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:10000,reason:'释放原采购预付用途'}],allocations:[a.target()]}));
  const grant=a.supplyInfo().authorizations[0];
  const input=command({action:'reallocate',supplierId:a.supplier.id,expectedFundsRevision:a.supplyInfo().funds.revision,authorizationId:grant.id});
  a.supplierPayments.pay(a.c,input);const replay=a.supplierPayments.pay(a.c,input);assert.equal(replay.replayed,true);
  assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_payment').get().n,1);assert.equal(a.supplyInfo().totals.paidCents,10000);assert.equal(a.supplyInfo().orders[0].receipts[0].committedCents,10000);
  rejects(()=>a.supplierPayments.pay(a.c,command({...input,expectedFundsRevision:a.supplyInfo().funds.revision})),'SUPPLY_AUTHORIZATION_STALE');
});
test('prepayment and receipt allocations share the original contract ceiling',t=>{
  const a=setupSupply(t),p=a.authorize({allocations:[a.target('order')]});a.confirmPayment(p.id);
  rejects(()=>a.authorize(),'SUPPLY_ORDER_LIMIT');assert.equal(a.supplyInfo().items.length,1);
});
test('return approval and original allocation release jointly lower payable but do not rewrite accepted goods or refund automatically',t=>{
  const a=setupSupply(t),p=a.authorize();a.confirmPayment(p.id);const issue=a.propose();
  assert.equal(a.stock().quantity_scaled,100);assert.equal(a.supplyInfo().orders[0].dueCents,10000);
  rejects(()=>a.approveIssue(issue.id),'SUPPLY_ORDER_LIMIT');
  const allocation=a.supplyInfo().items[0].allocations.find(a=>a.allocation_state==='已生效');
  a.approveIssue(issue.id,{releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:2000,reason:'释放已批准减少的原验收用途'}]});
  assert.equal(a.supplyInfo().orders[0].dueCents,8000);assert.equal(a.supplyInfo().items[0].availableCents,2000);assert.equal(a.stock().quantity_scaled,100);
  rejects(()=>a.pay(p.id,'refund',{issueId:issue.id,expectedIssueRevision:2,receivedCents:2000,channel:'现金',senderMatches:true,receivedAt:a.auth.now()}),'SUPPLY_REFUND_SOURCE');
  a.returnGoods(issue.id);assert.equal(a.stock().quantity_scaled,80);assert.equal(a.receiptLine().accepted_quantity_scaled,100);
  a.pay(p.id,'refund',{issueId:issue.id,expectedIssueRevision:a.issue(issue.id).revision,receivedCents:2000,channel:'现金',senderMatches:true,receivedAt:a.auth.now()});
  assert.equal(a.supplyInfo().totals.refundedCents,2000);assert.equal(a.supplyInfo().totals.paidCents,10000);assert.equal(a.supplyInfo().totals.availableCents,0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);
});
test('partial actual return consumes only its authorized remaining quantity and physical stock',t=>{
  const a=setupSupply(t),issue=a.propose();a.approveIssue(issue.id);a.returnGoods(issue.id,{quantityScaled:8});
  assert.equal(a.issue(issue.id).status,'待处理');assert.equal(a.stock().quantity_scaled,92);
  rejects(()=>a.returnGoods(issue.id,{quantityScaled:13}),'SUPPLY_RETURN_LIMIT');a.returnGoods(issue.id,{quantityScaled:12});assert.equal(a.issue(issue.id).status,'已完成');
});
test('used or issued stock cannot be returned to supplier beyond actual remaining stock',t=>{
  const a=setupSupply(t),issue=a.propose();a.approveIssue(issue.id);a.move('issue',{quantityScaled:90});
  rejects(()=>a.returnGoods(issue.id),'STOCK_INSUFFICIENT');assert.equal(a.stock().quantity_scaled,10);
});
test('undelivered cancellation reduces contract and keeps received quantity intact',t=>{
  const a=setupSupply(t,{receive:false});a.receipt=a.receive({items:[a.line({arrivedQuantityScaled:60,acceptedQuantityScaled:60})]});
  const issue=a.propose({resolutionAction:'cancelRemainder',receiptItemId:null,expectedReceiptItemRevision:null,quantityScaled:40});a.approveIssue(issue.id);
  assert.equal(a.supplyInfo().orders[0].dueCents,6000);assert.equal(a.orderItem().status,'剩余已取消');assert.equal(a.stock().quantity_scaled,60);
});
test('changed source facts invalidate proposed differences and rejected decisions do not change payable',t=>{
  const a=setupSupply(t),issue=a.propose();
  a.db.prepare('UPDATE purchase_order SET revision=revision+1 WHERE id=?').run(a.purchase.id);
  rejects(()=>a.approveIssue(issue.id),'SUPPLY_ISSUE_STALE');a.approveIssue(issue.id,{action:'reject'});
  assert.equal(a.supplyInfo().orders[0].dueCents,10000);assert.equal(a.issue(issue.id).status,'已拒绝');
});
test('rejected goods replacement keeps original rejected facts and completes only after approved replacement acceptance',t=>{
  const a=setupSupply(t,{receive:false});a.receipt=a.receive({items:[a.line({acceptedQuantityScaled:80,rejectedQuantityScaled:20})]});
  const issue=a.propose({resolutionAction:'replace'});a.approveIssue(issue.id);
  const replacement=a.receive({deliveryEvidence:'独立换货随货单-2',items:[a.line({arrivedQuantityScaled:20,acceptedQuantityScaled:10,pendingQuantityScaled:10,replacementIssueId:issue.id,expectedReplacementRevision:2})]});
  assert.equal(a.issue(issue.id).status,'待处理');a.inspect(replacement.id,{newAcceptedQuantityScaled:10});
  assert.equal(a.issue(issue.id).status,'已完成');assert.equal(a.stock().quantity_scaled,100);assert.equal(a.receiptLine().rejected_quantity_scaled,20);assert.equal(a.orderItem().status,'履行已完成');
});
test('accepted goods replacement requires actual original return and offsets replacement payable within the original contract',t=>{
  const a=setupSupply(t),issue=a.propose({resolutionAction:'replace',issueKind:'已入库退供'});a.approveIssue(issue.id);
  rejects(()=>a.receive({deliveryEvidence:'先到换货',items:[a.line({arrivedQuantityScaled:20,acceptedQuantityScaled:20,replacementIssueId:issue.id,expectedReplacementRevision:2})]}),'PURCHASE_ACCEPTANCE_LIMIT');
  a.returnGoods(issue.id);
  a.receive({deliveryEvidence:'原物退回后到货',items:[a.line({arrivedQuantityScaled:20,acceptedQuantityScaled:20,replacementIssueId:issue.id,expectedReplacementRevision:a.issue(issue.id).revision})]});
  assert.equal(a.stock().quantity_scaled,100);assert.equal(a.issue(issue.id).status,'已完成');
  const q=a.supplyInfo();assert.equal(q.orders[0].dueCents,10000);assert.equal(q.orders[0].receipts.reduce((n,r)=>n+r.dueCents,0),10000);
});
test('settlement adjustment is separately approved and over-release or unrelated allocation sources are rejected',t=>{
  const a=setupSupply(t),p=a.authorize();a.confirmPayment(p.id);const issue=a.propose({resolutionAction:'adjust',quantityScaled:0,adjustmentCents:-1000});
  const allocation=a.supplyInfo().items[0].allocations.find(a=>a.allocation_state==='已生效');
  rejects(()=>a.approveIssue(issue.id,{releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:2000,reason:'超出批准减少'}]}),'SUPPLY_RELEASE_LIMIT');
  a.approveIssue(issue.id,{releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:1000,reason:'按批准减少释放'}]});
  assert.equal(a.supplyInfo().orders[0].dueCents,9000);assert.equal(a.stock().quantity_scaled,100);
});
test('payment confirmation audit failure restores full pending hold and leaves no actual payment allocation',t=>{
  const a=setupSupply(t),p=a.authorize();a.pay(p.id,'initiate');
  a.db.exec("CREATE TEMP TRIGGER supply_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='supplier_payment' AND NEW.outcome_code='COMMITTED' BEGIN SELECT RAISE(ABORT,'supply_fault'); END");
  assert.throws(()=>a.pay(p.id,'verify',{outcome:'success',actualCents:10000,recipientMatches:true}),/supply_fault/);
  assert.equal(a.payment(p.id).status,'待付款');assert.equal(a.supplyInfo().totals.heldCents,10000);assert.equal(a.supplyInfo().totals.paidCents,0);
});
test('actual supplier return audit failure rolls inventory and issue completion back together',t=>{
  const a=setupSupply(t),issue=a.propose();a.approveIssue(issue.id);
  a.db.exec("CREATE TEMP TRIGGER supply_return_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='purchase_issue' AND NEW.outcome_code='COMMITTED' BEGIN SELECT RAISE(ABORT,'supply_return_fault'); END");
  assert.throws(()=>a.returnGoods(issue.id),/supply_return_fault/);assert.equal(a.stock().quantity_scaled,100);assert.equal(a.issue(issue.id).status,'待处理');
});
test('different suppliers cannot share purchase targets, original payments or account balances',t=>{
  const a=setupSupply(t),other=a.purchases.supplier(a.m,command({name:'另一独立供应商',contactName:'另一联系人',phone:'13800000004',settlementBasis:'独立核验依据',isActive:true,reason:'单独核验独立供货方'}));
  rejects(()=>a.supplierPayments.authorize(a.m,command({action:'authorize',supplierId:other.id,expectedSupplierRevision:1,expectedFundsRevision:1,requestedCents:10000,channel:'现金',cashierId:3,reviewNote:'错误跨供应商用途测试',allocations:[a.target()]})),'SUPPLY_OWNER');
  const p=a.authorize();rejects(()=>a.supplierPayments.pay(a.c,command({action:'initiate',supplierId:other.id,expectedFundsRevision:1,paymentId:p.id,expectedRevision:1,transactionEvidence:'错误跨供应商原款测试'})),'SUPPLY_OWNER');
  assert.equal(a.supplierPayments.query(a.c,{supplierId:other.id}).totals.heldCents,0);
});
test('supplier refund audit failure leaves no inflow, and partial incoming references cannot be registered twice',t=>{
  const a=setupSupply(t),p=a.authorize();a.confirmPayment(p.id);const issue=a.propose({resolutionAction:'adjust',quantityScaled:0,adjustmentCents:-2000});
  const allocation=a.supplyInfo().items[0].allocations.find(a=>a.allocation_state==='已生效');a.approveIssue(issue.id,{releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:2000,reason:'释放减款用途'}]});
  const input={issueId:issue.id,expectedIssueRevision:2,receivedCents:1000,channel:'银行卡',senderMatches:true,receivedAt:a.auth.now(),externalReference:'INCOMING-ONE'};
  a.db.exec("CREATE TEMP TRIGGER refund_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='supplier_refund' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'refund_fault'); END");
  assert.throws(()=>a.pay(p.id,'refund',input),/refund_fault/);assert.equal(a.supplyInfo().totals.refundedCents,0);assert.equal(a.supplyInfo().totals.availableCents,2000);
  a.db.exec('DROP TRIGGER refund_fault');a.pay(p.id,'refund',input);rejects(()=>a.pay(p.id,'refund',input),'SUPPLY_REFERENCE_DUPLICATE');
  assert.equal(a.supplyInfo().totals.refundedCents,1000);assert.equal(a.supplyInfo().totals.availableCents,1000);
});
