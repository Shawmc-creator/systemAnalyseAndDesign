'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupInventory,command}=require('./helpers/v2-inventory');
test('inventory HTTP commands enforce roles and CSRF, competing balance versions, pending increments and manager count review',async t=>{
  const a=setupInventory(t,{receive:false});await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>a.server.close(resolve));});
  const base='http://127.0.0.1:'+a.server.address().port+'/api/v2';
  const send=async(path,headers,value,expected=200)=>{
    const r=await fetch(base+path,{method:value?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
    const result=await r.json();assert.equal(r.status,expected,JSON.stringify(result));return result;
  };
  const login=async username=>{
    const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});
    const s=await r.json();assert.equal(r.status,200);return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf,'X-Clinic-Role':username.startsWith('assistant')?'assistant':username};
  };
  const i=await login('assistant'),i2=await login('assistant2'),m=await login('manager'),f=await login('frontdesk');
  const received=await send('/purchase-receipts/receive',i,command({action:'receive',purchaseId:a.purchase.id,expectedPurchaseRevision:2,arrivedAt:a.auth.now(),deliveryEvidence:'HTTP随货单唯一依据',items:[a.line({acceptedQuantityScaled:60,pendingQuantityScaled:40})]}));
  let q=await send('/batch-stock/query',i);assert.equal(q.items[0].stock.quantity_scaled,60);assert.equal(q.items[0].availableQuantityScaled,0);
  await send('/batch-stock/query',f,null,403);
  const release=command({action:'release',batchId:a.batch.id,expectedRevision:1,reason:'负责人核实合格验收和有效期'});
  await send('/material-batches/approve',i,release,403);await send('/material-batches/approve',{...m,'X-CSRF-Token':'wrong'},release,403);await send('/material-batches/approve',m,release);
  const line=a.db.prepare('SELECT * FROM purchase_receipt_item').get();
  const inspect=command({action:'inspectPending',receiptId:received.id,expectedRevision:1,receiptItemId:line.id,expectedItemRevision:1,newAcceptedQuantityScaled:40,newRejectedQuantityScaled:0,inspectionNote:'HTTP后续待检结论'});
  const results=await Promise.all([send('/purchase-receipts/receive',i,inspect),send('/purchase-receipts/receive',i,inspect)]);assert.equal(results.filter(x=>!x.replayed).length,1);
  q=await send('/batch-stock/query',m);const stock=q.items[0].stock;assert.equal(stock.quantity_scaled,100);
  const issue={action:'issue',stockId:stock.id,expectedStockRevision:stock.revision,quantityScaled:70,reason:'两个助理按同一余额并发领用'};
  const competing=await Promise.all([fetch(base+'/inventory-commands/record',{method:'POST',headers:{...i,'Content-Type':'application/json'},body:JSON.stringify(command(issue))}),fetch(base+'/inventory-commands/record',{method:'POST',headers:{...i2,'Content-Type':'application/json'},body:JSON.stringify(command(issue))})]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);for(const r of competing)await r.json();
  q=await send('/batch-stock/query',i);assert.equal(q.items[0].stock.quantity_scaled,30);
  const count=await send('/inventory-commands/record',i,command({action:'count',stockId:stock.id,expectedStockRevision:q.items[0].stock.revision,countedQuantityScaled:29,countedAt:a.auth.now(),reason:'HTTP实物盘点'}));
  const approve=command({action:'approveCount',countId:count.id,expectedRevision:1,reviewNote:'核实差异并批准'});
  await send('/inventory-commands/approve',i,approve,403);await send('/inventory-commands/approve',m,approve);
  q=await send('/batch-stock/query',m);assert.equal(q.items[0].stock.quantity_scaled,29);
  const purchases=await send('/purchases/query',i);assert.equal(purchases.items[0].receipts[0].items[0].accepted_quantity_scaled,100);
  assert.equal(JSON.stringify(purchases).includes('settlement_basis'),false);
  const receipt=await send('/submissions/'+inspect.requestKey,i);assert.equal(receipt.id,received.id);assert.equal(receipt.revision,2);
});
