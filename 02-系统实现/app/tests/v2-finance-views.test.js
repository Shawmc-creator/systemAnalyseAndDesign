'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
function source(a){const service=a.service();a.price(service.id);a.execute(service.id,{independentCheck:true,independentBasis:'当次实际检查'});return a.bills();}
function request(a,q){return a.fees.apply(a.c,command({action:'submit',patientId:1,billId:q.items[0].id,expectedFundsRevision:q.funds.revision,expectedBillRevision:q.items[0].revision,adjustmentCents:-1000,refundCents:0,reason:'核对原单后申请调整',evidence:'收费依据及原账目核实记录'}));}
test('cashier financial candidates preserve same-name identities; manager only sees patients with fee requests; other roles are denied',t=>{
 const a=setup(t);assert.equal(a.billing.candidates(a.c).items.length,2);assert.equal(a.billing.candidates(a.m).items.length,0);
 const identities=a.billing.candidates(a.c,{q:'陈晨'}).items;assert.equal(identities.length,2);assert.notEqual(identities[0].record_no,identities[1].record_no);
 assert.equal(a.billing.candidates(a.c,{q:'13800000001'}).items[0].id,1);assert.equal(a.billing.candidates(a.c,{q:'%'}).items.length,0);
 for(const who of [a.f,a.d])assert.throws(()=>a.billing.candidates(who),e=>e.code==='FORBIDDEN');
 const q=source(a);request(a,q);assert.deepEqual(a.billing.candidates(a.m).items.map(p=>p.id),[1]);
 assert.throws(()=>a.billing.query(a.m,{patientId:1}),e=>e.code==='FORBIDDEN');
});
test('fee review DTO exposes the source bill and line versions without clinical record or health content',t=>{
 const a=setup(t),q=source(a),r=request(a,q),dto=a.fees.query(a.m,{patientId:1});
 assert.equal(dto.patient.id,1);assert.equal(dto.patient.recordNo,a.db.prepare('SELECT record_no FROM patient WHERE id=1').get().record_no);
 assert.equal(dto.items[0].id,r.id);assert.equal(dto.items[0].billSource.id,q.items[0].id);assert.equal(dto.items[0].billSource.items[0].revision,1);
 assert.equal(dto.items[0].billSource.summary.receivableCents,20000);
 assert.equal(/chief_complaint|diagnosis|treatment_advice|finding_text|procedure_note|healthVersions/.test(JSON.stringify(dto)),false);
 const empty=a.fees.query(a.c,{patientId:2});assert.equal(empty.patient.id,2);assert.equal(empty.items.length,0);
});
test('funds expose immutable original purpose links and versions needed to review a release, without treating them as new receipts',t=>{
 const a=setup(t),q=source(a);
 a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:q.funds.revision,receivedCents:20000,changeCents:0,channel:'现金',verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'已点收原款',allocations:[{billId:q.items[0].id,expectedRevision:q.items[0].revision,amountCents:20000,reason:'支付原应收'}]}));
 const funds=a.bills().funds,purpose=funds.payments[0].allocations[0];assert.equal(purpose.revision,1);assert.equal(purpose.original_id,null);assert.equal(purpose.amount_cents,20000);assert.equal(funds.confirmedReceivedCents,20000);
});
test('only manager price review sees pending financial identity; a newly confirmed catalog price never silently reprices existing facts',t=>{
 const a=setup(t),service=a.service();a.execute(service.id,{independentCheck:true,independentBasis:'当次实际检查，价目尚待核对'});
 const line=a.bills().items[0].items[0];assert.equal(line.pricing_status,'待核价');
 assert.equal(a.billing.catalog(a.c).pendingItems,undefined);assert.equal(a.billing.catalog(a.d).pendingItems,undefined);
 const pending=a.billing.catalog(a.m).pendingItems;assert.equal(pending.length,1);assert.equal(pending[0].id,line.id);assert.equal(pending[0].patient_name,'陈晨（演示）');assert.equal(/diagnosis|procedure_note|chief_complaint/.test(JSON.stringify(pending)),false);
 const price=a.price(service.id);assert.equal(a.bills().totals.pendingPricingCount,1);
 a.billing.approve(a.m,command({action:'pricePending',billItemId:line.id,expectedRevision:line.revision,priceId:price.id,reviewNote:'核对原实际发生时间后确认适用'}));
 assert.equal(a.bills().totals.pendingPricingCount,0);assert.equal(a.bills().totals.receivableCents,20000);assert.equal(a.billing.catalog(a.m).pendingItems.length,0);
});
