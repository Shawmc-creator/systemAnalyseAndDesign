'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupInventory,command}=require('./helpers/v2-inventory');
const {insert,fact}=require('../src/v2/common');
test('removed workflows cannot be called via their old permissions or application services',t=>{
 const a=setupInventory(t);assert.equal(a.purchaseIssues,undefined);assert.equal(a.supplierPayments,undefined);
 for(const [who,permission]of [[a.m,'uc28.approve'],[a.m,'uc29.authorize'],[a.c,'uc29.pay']])assert.throws(()=>a.auth.authorize(who.token,who.role,permission,who.csrf),e=>e.code==='FEATURE_REMOVED'&&e.status===410);
 for(const action of ['proposeIssue','returnGoods'])assert.throws(()=>a.purchases.receive(a.i,command({action})),e=>e.code==='FEATURE_REMOVED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_funds').get().n,0);
});
test('basic receipt discrepancy notes retain actual quantities, source notes and audit, without creating supply finance or return allocation',t=>{
 const a=setupInventory(t,{receive:false}),r=a.receive({items:[a.line({acceptedQuantityScaled:60,rejectedQuantityScaled:10,pendingQuantityScaled:30})]}),line=a.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_receipt_id=?').get(r.id);
 const input=command({action:'receiptNote',receiptItemId:line.id,expectedItemRevision:line.revision,expectedRevision:r.revision,reviewNote:'负责人已联系供方核对拒收实物，30个继续待检并明确后续责任'});
 a.purchases.approve(a.m,input);assert.equal(a.purchases.approve(a.m,input).replayed,true);
 const now=a.db.prepare('SELECT * FROM purchase_receipt_item WHERE id=?').get(line.id);assert.equal(now.accepted_quantity_scaled,60);assert.equal(now.pending_quantity_scaled,30);assert.ok(now.inspection_note.startsWith(line.inspection_note));assert.ok(now.inspection_note.includes('负责人已联系供方'));
 assert.equal(a.stock().quantity_scaled,60);for(const table of ['purchase_issue','supplier_funds','supplier_payment','supplier_allocation'])assert.equal(a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 a.inspect(r.id,{newAcceptedQuantityScaled:30});assert.equal(a.stock().quantity_scaled,90);assert.ok(a.db.prepare('SELECT inspection_note FROM purchase_receipt_item WHERE id=?').get(line.id).inspection_note.includes('负责人已联系供方'));
});
test('basic redelivery after rejected goods records a separate real delivery and never needs a detailed replacement allocation',t=>{
 const a=setupInventory(t,{receive:false});a.receive({items:[a.line({acceptedQuantityScaled:90,rejectedQuantityScaled:10})]});
 a.receive({deliveryEvidence:'第二次实际随货单',items:[a.line({arrivedQuantityScaled:10,acceptedQuantityScaled:10})]});
 assert.equal(a.stock().quantity_scaled,100);assert.equal(a.orderItem().status,'履行已完成');assert.equal(a.db.prepare('SELECT count(*) n FROM purchase_receipt').get().n,2);assert.equal(a.db.prepare('SELECT count(*) n FROM purchase_issue').get().n,0);
});
test('non-expiring materials can be accepted and released without inventing an expiry; dated materials still require it',t=>{
 const a=setupInventory(t,{expiry:null,material:{requiresExpiry:false}});assert.equal(a.inventory.query(a.i).items[0].availableQuantityScaled,100);
 a.move('issue',{quantityScaled:1});assert.equal(a.stock().quantity_scaled,99);
});
test('legacy complex purchase records are read-only, preserved and cannot be mutated through a retained command',t=>{
 const a=setupInventory(t,{receive:false}),now=a.auth.now();
 const legacy=insert(a.db,'purchase_issue',fact(now,{purchase_order_item_id:a.orderItem().id,purchase_receipt_item_id:null,quantity_scaled:10,reason:'历史差异原始依据',resolution:'取消剩余',confirmed_at:null,issue_kind:'未交付',adjustment_cents:-1000,resolved_at:null,created_by:5,confirmed_by:null,status:'待确认'}));
 assert.equal(a.purchases.query(a.m).items[0].historicalReadOnly,true);assert.throws(()=>a.receive(),e=>e.code==='HISTORICAL_PURCHASE_READ_ONLY');
 assert.throws(()=>a.unit.command(a.m,'uc27.supplier',command({}),(ctx,at)=>{const id=insert(a.db,'supplier_funds',fact(at,{supplier_id:a.supplier.id,opened_at:at,opened_by:1}));return {kind:'supplier_funds',key:id,revision:1};}),e=>e.code==='FEATURE_REMOVED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM supplier_funds').get().n,0);assert.equal(a.db.prepare('SELECT reason FROM purchase_issue WHERE id=?').get(legacy).reason,'历史差异原始依据');
 assert.ok(a.reception.patient(a.f,command({patientId:2,expectedRevision:1,fields:{contact_preference:'患者核实后更新联系时间'},reason:'继续当前范围的正常患者业务'})).id);
 assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('inventory use candidates provide real patient and visit identity without chart text and deny other roles',t=>{
 const a=setupInventory(t),dto=a.inventory.usageOptions(a.i,{date:'2026-10-19'});assert.equal(dto.visits[0].id,a.v.id);assert.equal(dto.visits[0].patient_id,1);assert.equal(/chief_complaint|diagnosis|finding_text/.test(JSON.stringify(dto)),false);
 for(const who of [a.m,a.f,a.c])assert.throws(()=>a.inventory.usageOptions(who),e=>e.code==='FORBIDDEN');assert.throws(()=>a.inventory.usageOptions(a.i,{date:'2026-10-20'}),e=>e.code==='USAGE_DATE');
 assert.ok(a.inventory.options(a.m).materials.length);assert.throws(()=>a.inventory.options(a.f),e=>e.code==='FORBIDDEN');
});
test('old HTTP supply routes return removed, while status describes only the current document scope',async t=>{
 const a=setupInventory(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port,headers={Cookie:'clinic_v2_session='+a.m.token,'X-Clinic-Role':'manager'};
 for(const [path,method]of [['/supplier-payments/query','GET'],['/supplier-payments/authorize','POST'],['/supplier-payments/pay','POST'],['/purchase-receipts/approve','POST']]){const r=await fetch(base+'/api/v2'+path,{method,headers});assert.equal(r.status,410);assert.equal((await r.json()).code,'FEATURE_REMOVED');}
 const s=await (await fetch(base+'/api/v2/status')).json();assert.equal(s.supplierPaymentApi,undefined);assert.equal(s.purchaseReceiptApi.implemented.includes('returnGoods'),false);assert.ok(s.excludedScope.includes('复杂供应商结算与付款'));assert.ok(s.implementedCoreUsecases.includes(22));assert.deepEqual(s.pendingCoreUsecases,[]);assert.equal(s.insuranceApi.networkConnected,false);
});
