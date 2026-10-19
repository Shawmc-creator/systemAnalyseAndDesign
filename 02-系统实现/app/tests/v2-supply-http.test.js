'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupSupply,command}=require('./helpers/v2-supply');
test('supplier HTTP workflow enforces approval roles, idempotent authorization, unknown holds, return release and actual supplier refund',async t=>{
  const a=setupSupply(t);await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>a.server.close(resolve));});
  const base='http://127.0.0.1:'+a.server.address().port+'/api/v2';
  const send=async(path,headers,value,expected=200)=>{
    const r=await fetch(base+path,{method:value?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
    const result=await r.json();assert.equal(r.status,expected,JSON.stringify(result));return result;
  };
  const login=async username=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});const s=await r.json();assert.equal(r.status,200);return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf,'X-Clinic-Role':username==='assistant'?'assistant':username};};
  const m=await login('manager'),c=await login('cashier'),i=await login('assistant'),f=await login('frontdesk');
  const query='/supplier-payments/query?supplierId='+a.supplier.id,q=()=>send(query,c);
  let info=await q();const authorization=command({action:'authorize',supplierId:a.supplier.id,expectedFundsRevision:info.funds.revision,expectedSupplierRevision:1,requestedCents:10000,channel:'现金',cashierId:3,reviewNote:'HTTP负责人确认原验收结算',allocations:[a.target()]});
  await send('/supplier-payments/authorize',c,authorization,403);
  const authorized=await Promise.all([send('/supplier-payments/authorize',m,authorization),send('/supplier-payments/authorize',m,authorization)]);
  assert.equal(authorized.filter(x=>!x.replayed).length,1);const paymentId=authorized[0].id;
  info=await q();assert.equal(info.totals.paidCents,0);assert.equal(info.totals.heldCents,10000);
  await send('/supplier-payments/pay',c,command({action:'initiate',supplierId:a.supplier.id,expectedFundsRevision:info.funds.revision,paymentId,expectedRevision:1,transactionEvidence:'按原付款号开始线下办理'}));
  info=await q();await send('/supplier-payments/pay',c,command({action:'verify',supplierId:a.supplier.id,expectedFundsRevision:info.funds.revision,paymentId,expectedRevision:2,outcome:'unknown',transactionEvidence:'付款渠道结果尚不明确'}));
  info=await q();assert.equal(info.totals.heldCents,10000);assert.equal(info.totals.paidCents,0);
  const verify=command({action:'verify',supplierId:a.supplier.id,expectedFundsRevision:info.funds.revision,paymentId,expectedRevision:3,outcome:'success',actualCents:10000,recipientMatches:true,transactionEvidence:'核实原办理已经实际付款100元'});
  await send('/supplier-payments/pay',{...c,'X-CSRF-Token':'wrong'},verify,403);await send('/supplier-payments/pay',c,verify);
  const line=a.receiptLine(),issue=await send('/purchase-receipts/receive',i,command({action:'proposeIssue',purchaseItemId:a.orderItem().id,expectedItemRevision:a.orderItem().revision,expectedPurchaseRevision:a.db.prepare('SELECT revision FROM purchase_order WHERE id=?').get(a.purchase.id).revision,
    receiptItemId:line.id,expectedReceiptItemRevision:line.revision,resolutionAction:'return',quantityScaled:20,resolutionNote:'20个退供，减少价款20元',reason:'实际实物退供差异'}));
  info=await q();const allocation=info.items[0].allocations.find(x=>x.allocation_state==='已生效');
  const approve=command({action:'approve',issueId:issue.id,expectedRevision:1,expectedFundsRevision:info.funds.revision,reviewNote:'负责人确认退供范围及必要释放',releases:[{allocationId:allocation.id,expectedRevision:1,amountCents:2000,reason:'释放原付款中对应退供价款的用途'}]});
  await send('/purchase-receipts/approve',i,approve,403);await send('/purchase-receipts/approve',m,approve);
  await send('/purchase-receipts/receive',i,command({action:'returnGoods',issueId:issue.id,expectedRevision:2,stockId:a.stock().id,expectedStockRevision:a.stock().revision,quantityScaled:20,returnedAt:a.auth.now(),handoverEvidence:'供应商已实际接收20个材料'}));
  info=await q();const refund=command({action:'refund',supplierId:a.supplier.id,expectedFundsRevision:info.funds.revision,paymentId,expectedRevision:4,issueId:issue.id,expectedIssueRevision:3,receivedCents:2000,channel:'现金',senderMatches:true,receivedAt:a.auth.now(),transactionEvidence:'已核实实际收到供应商退回20元'});
  const refunded=await Promise.all([send('/supplier-payments/pay',c,refund),send('/supplier-payments/pay',c,refund)]);assert.equal(refunded.filter(x=>!x.replayed).length,1);
  info=await q();assert.equal(info.totals.netPaidCents,8000);assert.equal(info.totals.availableCents,0);assert.equal(info.orders[0].receipts[0].dueCents,8000);assert.equal(a.stock().quantity_scaled,80);
  await send(query,f,null,403);await send(query,i,null,403);assert.equal(JSON.stringify(info).includes('chief_complaint'),false);
  const receipt=await send('/submissions/'+refund.requestKey,c);assert.equal(receipt.id,refunded[0].id);
});
