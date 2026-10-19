'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupInventory,command}=require('./helpers/v2-inventory');
const {insert,fact}=require('../src/v2/common');
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
test('confirmed purchase creates no stock or supplier payment; settlement evidence is hidden from assistants',t=>{
  const a=setupInventory(t,{receive:false});
  assert.equal(a.stock(),undefined);assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_payment').get().n,0);
  assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_funds').get().n,1);
  assert.equal(JSON.stringify(a.purchases.query(a.i)).includes('只用于软件测试的核验依据'),false);
  assert.equal(JSON.stringify(a.purchases.query(a.m)).includes('只用于软件测试的核验依据'),true);
  rejects(()=>a.purchases.query(a.f),'FORBIDDEN');
});
test('accepted goods post exactly once, remain unavailable until release and do not count rejected or pending goods',t=>{
  const a=setupInventory(t,{receive:false});
  const received=a.receive({items:[a.line({acceptedQuantityScaled:60,rejectedQuantityScaled:10,pendingQuantityScaled:30})]});
  assert.equal(a.stock().quantity_scaled,60);assert.equal(a.inventory.query(a.i).items[0].availableQuantityScaled,0);
  a.release();assert.equal(a.inventory.query(a.i).items[0].availableQuantityScaled,60);
  assert.equal(a.db.prepare('SELECT status FROM purchase_receipt WHERE id=?').get(received.id).status,'部分待检');
  rejects(()=>a.receive({items:[a.line({arrivedQuantityScaled:10,acceptedQuantityScaled:10})]}),'DELIVERY_DUPLICATE');
});
test('pending inspection adds only the accepted increment and preserves actual arrival and audited old values',t=>{
  const a=setupInventory(t,{receive:false});const r=a.receive({items:[a.line({acceptedQuantityScaled:60,pendingQuantityScaled:40})]});
  a.inspect(r.id);assert.equal(a.stock().quantity_scaled,100);assert.equal(a.stock().revision,3);
  const line=a.db.prepare('SELECT * FROM purchase_receipt_item').get();assert.equal(line.arrived_quantity_scaled,100);assert.equal(line.accepted_amount_cents,10000);
  assert.equal(a.db.prepare('SELECT count(*) n FROM inventory_movement').get().n,2);
  assert.ok(a.db.prepare("SELECT id FROM audit_change WHERE field_name LIKE '%accepted_quantity_scaled'").get());
  rejects(()=>a.inspect(r.id),'RECEIPT_PENDING');
});
test('receipt price uses scaled base units, frozen purchase units and rational rounding rather than floating point',t=>{
  const a=setupInventory(t,{receive:false,ordered:300,price:100,material:{conversionNumerator:3,conversionDenominator:1,quantityScale:2}});
  a.receive({items:[a.line({arrivedQuantityScaled:300,acceptedQuantityScaled:100,pendingQuantityScaled:200})]});
  assert.equal(a.db.prepare('SELECT accepted_amount_cents FROM purchase_receipt_item').get().accepted_amount_cents,33);
  const r=a.db.prepare('SELECT id FROM purchase_receipt').get();a.inspect(r.id,{newAcceptedQuantityScaled:100});
  assert.equal(a.db.prepare('SELECT accepted_amount_cents FROM purchase_receipt_item').get().accepted_amount_cents,67);
  assert.equal(a.stock().quantity_scaled,200);
});
test('actual overdelivery can be retained as pending but cannot automatically become accepted inventory',t=>{
  const a=setupInventory(t,{receive:false});
  rejects(()=>a.receive({items:[a.line({arrivedQuantityScaled:110,acceptedQuantityScaled:110})]}),'PURCHASE_ACCEPTANCE_LIMIT');
  const r=a.receive({items:[a.line({arrivedQuantityScaled:110,pendingQuantityScaled:10})]});
  assert.equal(a.stock().quantity_scaled,100);assert.equal(a.orderItem().status,'待差异处理');
  rejects(()=>a.inspect(r.id,{newAcceptedQuantityScaled:10}),'PURCHASE_ACCEPTANCE_LIMIT');
  assert.equal(a.db.prepare('SELECT pending_quantity_scaled FROM purchase_receipt_item').get().pending_quantity_scaled,10);
});
test('receipt quantities, material ownership, source versions and actual arrival times are checked',t=>{
  const a=setupInventory(t,{receive:false});
  rejects(()=>a.receive({items:[a.line({pendingQuantityScaled:1})]}),'RECEIPT_QUANTITIES');
  rejects(()=>a.receive({items:[a.line({expectedItemRevision:99})]}),'VERSION_CONFLICT');
  rejects(()=>a.receive({arrivedAt:'2026-10-20T09:00:00+08:00'}),'RECEIPT_TIME');
  rejects(()=>a.receive({items:[a.line({arrivedQuantityScaled:1.2})]}),'INVALID_QUANTITY');
  assert.equal(a.db.prepare('SELECT count(*) n FROM purchase_receipt').get().n,0);
});
test('issue and unused return update the ledger once while actual use only records its actual visit destination',t=>{
  const a=setupInventory(t),issued=a.move('issue',{quantityScaled:20});
  assert.equal(a.stock().quantity_scaled,80);
  a.move('use',{originalMovementId:issued.id,quantityScaled:12,visitId:a.v.id,patientId:1,usedAt:a.auth.now()});assert.equal(a.stock().quantity_scaled,80);
  a.move('return',{originalMovementId:issued.id,quantityScaled:8});assert.equal(a.stock().quantity_scaled,88);
  rejects(()=>a.move('return',{originalMovementId:issued.id,quantityScaled:1}),'ISSUE_BALANCE_EXCEEDED');
  rejects(()=>a.move('use',{originalMovementId:issued.id,quantityScaled:1,visitId:a.v.id,patientId:1,usedAt:a.auth.now()}),'ISSUE_BALANCE_EXCEEDED');
  assert.equal(a.inventory.query(a.m).items[0].usages[0].visit_id,a.v.id);
});
test('actual use cannot reference a different patient or an unoccurred procedure',t=>{
  const a=setupInventory(t),issued=a.move('issue');
  rejects(()=>a.move('use',{originalMovementId:issued.id,visitId:a.v.id,patientId:2,usedAt:a.auth.now()}),'PATIENT_MISMATCH');
  rejects(()=>a.move('use',{originalMovementId:issued.id,visitId:a.v.id,patientId:1,usedAt:'2026-10-19T09:20:00+08:00'}),'USAGE_NOT_ACTUAL');
  assert.equal(a.db.prepare('SELECT count(*) n FROM material_usage').get().n,0);
});
test('old balance revisions and insufficient quantity cannot overdraw stock',t=>{
  const a=setupInventory(t),old=a.stock();a.move('issue',{quantityScaled:80});
  rejects(()=>a.move('issue',{quantityScaled:30,expectedStockRevision:old.revision}),'VERSION_CONFLICT');
  rejects(()=>a.move('issue',{quantityScaled:30}),'STOCK_INSUFFICIENT');assert.equal(a.stock().quantity_scaled,20);
});
test('immediate isolation blocks ordinary issues and returns, preserves previous actual use, and only manager may restore',t=>{
  const a=setupInventory(t),issued=a.move('issue',{quantityScaled:20});
  a.inventory.record(a.i,command({action:'isolate',batchId:a.batch.id,expectedRevision:2,reason:'发现实物异常，立即隔离'}));
  rejects(()=>a.move('issue'),'BATCH_UNAVAILABLE');rejects(()=>a.move('return',{originalMovementId:issued.id}),'BATCH_UNAVAILABLE');
  rejects(()=>a.inventory.approve(a.i,command({action:'restore',batchId:a.batch.id,expectedRevision:3,reason:'助理自行恢复'})),'FORBIDDEN');
  a.move('use',{originalMovementId:issued.id,quantityScaled:5,visitId:a.v.id,patientId:1,usedAt:a.auth.now()});
  a.inventory.approve(a.m,command({action:'restore',batchId:a.batch.id,expectedRevision:3,reason:'负责人核实异常已解决'}));
  assert.equal(a.stock().quantity_scaled,80);assert.equal(a.db.prepare('SELECT count(*) n FROM batch_change').get().n,3);
});
test('actual expiry blocks issue even if a stale batch status still says usable',t=>{
  const a=setupInventory(t);a.setClock('2027-10-21T01:00:00Z');
  const s=a.auth.login({username:'assistant',password:'Clinic123!'});a.i={token:s.token,csrf:s.csrf,role:'assistant'};
  assert.equal(a.inventory.query(a.i).items[0].availableQuantityScaled,0);rejects(()=>a.move('issue'),'BATCH_UNAVAILABLE');
});
test('unknown expiry can be retained pending, but acceptance and release require verified expiry',t=>{
  const a=setupInventory(t,{receive:false,expiry:null});
  rejects(()=>a.receive(),'RECEIPT_UNAVAILABLE');
  a.receive({items:[a.line({acceptedQuantityScaled:0,pendingQuantityScaled:100})]});
  rejects(()=>a.release(),'BATCH_UNAVAILABLE');
  assert.equal(a.inventory.query(a.i).items[0].stock,null);
  a.inventory.approve(a.m,command({action:'verifyExpiry',batchId:a.batch.id,expectedRevision:1,expiryDate:'2027-10-19',reason:'依据原包装核实实际效期，保留原缺失记录'}));
  const receipt=a.db.prepare('SELECT id FROM purchase_receipt').get();a.inspect(receipt.id,{newAcceptedQuantityScaled:100});a.release();
  assert.equal(a.inventory.query(a.i).items[0].availableQuantityScaled,100);
});
test('material structural changes require confirmation and are frozen once stock facts exist',t=>{
  const a=setupInventory(t);
  rejects(()=>a.inventory.record(a.i,command({action:'material',materialId:a.material.id,expectedRevision:2,...a.materialFields,baseUnit:'毫升'})),'MATERIAL_UNITS_FROZEN');
  a.inventory.record(a.i,command({action:'material',materialId:a.material.id,expectedRevision:2,...a.materialFields,name:'修订材料显示名称'}));
  assert.equal(a.stock().quantity_scaled,100);
});
test('pending counts do not change quantity and manager confirmation posts only one authorized difference',t=>{
  const a=setupInventory(t),count=a.count(95);assert.equal(a.stock().quantity_scaled,100);
  rejects(()=>a.inventory.approveCount(a.i,command({action:'approveCount',countId:count.id,expectedRevision:1,reviewNote:'助理确认'})),'FORBIDDEN');
  a.approveCount(count.id);assert.equal(a.stock().quantity_scaled,95);
  assert.equal(a.db.prepare("SELECT count(*) n FROM inventory_movement WHERE movement_type='盘点'").get().n,1);
  rejects(()=>a.approveCount(count.id),'INVALID_STATE');
});
test('stock activity during a count commits a recheck request without applying an obsolete difference',t=>{
  const a=setupInventory(t),count=a.count(95);a.move('issue');
  const result=a.approveCount(count.id);assert.equal(result.code,'COUNT_RECHECK_REQUIRED');assert.equal(a.stock().quantity_scaled,90);
  assert.equal(a.db.prepare('SELECT status FROM stock_count WHERE id=?').get(count.id).status,'待重新核对');
  a.inventory.recordMovement(a.i,command({action:'recount',countId:count.id,expectedRevision:2,expectedStockRevision:a.stock().revision,countedQuantityScaled:88,countedAt:a.auth.now(),reason:'重新实点'}));
  a.approveCount(count.id);assert.equal(a.stock().quantity_scaled,88);
});
test('zero difference and rejected count retain evidence without generating zero inventory movements',t=>{
  const a=setupInventory(t),zero=a.count(100);a.approveCount(zero.id);
  const rejected=a.count(93);a.approveCount(rejected.id,{action:'reject'});
  assert.equal(a.stock().quantity_scaled,100);assert.equal(a.db.prepare("SELECT count(*) n FROM inventory_movement WHERE movement_type='盘点'").get().n,0);
});
test('issue command retries return the same receipt without a second inventory deduction',t=>{
  const a=setupInventory(t),input=command({action:'issue',stockId:a.stock().id,expectedStockRevision:a.stock().revision,quantityScaled:20,reason:'只领一次'});
  const first=a.inventory.recordMovement(a.i,input),replay=a.inventory.recordMovement(a.i,input);
  assert.equal(first.id,replay.id);assert.equal(replay.replayed,true);assert.equal(a.stock().quantity_scaled,80);
  rejects(()=>a.inventory.recordMovement(a.i,{...input,quantityScaled:30}),'REQUEST_KEY_REUSED');
});
test('audit failure rolls receipt, accepted quantity, stock posting and purchase progress back together',t=>{
  const a=setupInventory(t,{receive:false});
  a.db.exec("CREATE TEMP TRIGGER receipt_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='purchase_receipt' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'receipt_fault'); END");
  assert.throws(()=>a.receive(),/receipt_fault/);assert.equal(a.stock(),undefined);assert.equal(a.orderItem().status,'待交付');
  assert.equal(a.db.prepare('SELECT count(*) n FROM purchase_receipt').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM inventory_movement').get().n,0);
});
test('audit failure rolls manager count confirmation and its movement back together',t=>{
  const a=setupInventory(t),count=a.count(93);
  a.db.exec("CREATE TEMP TRIGGER count_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='stock_count' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'count_fault'); END");
  assert.throws(()=>a.approveCount(count.id),/count_fault/);assert.equal(a.stock().quantity_scaled,100);
  assert.equal(a.db.prepare('SELECT status FROM stock_count WHERE id=?').get(count.id).status,'待确认差异');
});
test('transaction gates reject acceptance without matching stock and appending to a confirmed procurement collection',t=>{
  const a=setupInventory(t,{receive:false});
  rejects(()=>a.unit.command(a.i,'uc27.draft',command({}),(ctx,now)=>{
    const i=a.orderItem();insert(a.db,'purchase_order_item',fact(now,{purchase_order_id:a.purchase.id,material_id:a.material.id,ordered_quantity_scaled:1,unit_price_cents:1,purchase_unit:'盒',conversion_numerator:10,conversion_denominator:1,quantity_scale:0,sequence_no:2,status:'待交付'}));
    return {kind:'purchase_order',key:a.purchase.id,revision:2};
  }),'PURCHASE_SEALED');
  a.receive({items:[a.line({acceptedQuantityScaled:60,pendingQuantityScaled:40})]});
  rejects(()=>a.unit.command(a.i,'uc28.receive',command({}),(ctx,now)=>{
    a.db.prepare('UPDATE purchase_receipt_item SET accepted_quantity_scaled=100,pending_quantity_scaled=0,accepted_amount_cents=10000').run();
    return {kind:'purchase_receipt',key:1,revision:2};
  }),'RECEIPT_STOCK_MISMATCH');
  assert.equal(a.stock().quantity_scaled,60);
});
test('inventory queries distinguish empty material, pending batch and stock and do not expose clinical record text',t=>{
  const a=setupInventory(t,{receive:false});assert.equal(a.inventory.query(a.m).items[0].stock,null);
  rejects(()=>a.inventory.query(a.f),'FORBIDDEN');rejects(()=>a.inventory.query(a.m,{pageSize:101}),'INVALID_PAGE');
  a.receive();a.release();const q=a.inventory.query(a.i,{page:1,pageSize:1,status:'可用',batchNo:'TEST-20261019'});
  assert.equal(q.total,1);assert.equal(q.items[0].availableQuantityScaled,100);assert.equal(JSON.stringify(q).includes('chief_complaint'),false);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(a.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
