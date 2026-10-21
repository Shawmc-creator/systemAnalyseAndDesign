'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-pharmacy');
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('qualified pharmacy review and real fractional dispensing form stock movement, record and actual integer-cent charge together',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);rejects(()=>a.give(),'PHARMACY_REVIEW_REQUIRED');a.approveRx();const d=a.give();
 assert.equal(a.stock().quantity_scaled,875);assert.equal(a.db.prepare('SELECT quantity_scaled FROM dispense_record WHERE id=?').get(d.id).quantity_scaled,125);
 const line=a.bills().items[0].items[0];assert.equal(line.treatment_execution_id,null);assert.equal(line.dispense_record_id,d.id);assert.equal(line.quantity,125);assert.equal(line.quantity_scale,2);assert.equal(line.amount_cents,250);assert.equal(a.bills().totals.receivableCents,250);assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,0);
 a.give();assert.equal(a.bills().totals.receivableCents,500);assert.equal(a.stock().quantity_scaled,750);rejects(()=>a.give(),'DISPENSE_QUANTITY');
});
test('review return and physician response preserve sealed prescription and audit history before re-review',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx({action:'return',reviewNote:'演示：需要医师核实原方说明'});rejects(()=>a.give(),'PHARMACY_REVIEW_REQUIRED');
 a.rx({action:'respond',prescriptionId:p.id,expectedRevision:3,confirmed:true,reason:'医师核实原处方正文无需改变，说明依据后重新送审'});assert.equal(a.rxInfo().review_status,'院内待审');a.approveRx();a.give();
 assert.equal(a.prescriptions.query(a.d,a.context).prescriptions[0].contentIntact,true);assert.equal(a.pharmacy.history(p.id).some(h=>h.reason.includes('需要医师核实')),true);
});
test('inactive institution, unqualified assistant and prescriber self-review cannot authorize medicine delivery',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);rejects(()=>a.give({},a.i),'FORBIDDEN');a.pharmacy.policy={enabled:false};rejects(()=>a.approveRx(),'PHARMACY_NOT_ENABLED');assert.equal(a.stock().quantity_scaled,1000);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,0);
});
test('expiry, isolation, stale stock, stale prescription and wrong patient roll back without charging',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx();rejects(()=>a.give({expectedStockRevision:99}),'VERSION_CONFLICT');rejects(()=>a.give({expectedRevision:99}),'VERSION_CONFLICT');rejects(()=>a.give({patientId:2}),'PATIENT_MISMATCH');
 a.inventory.record(a.i,command({action:'isolate',batchId:a.batch.id,expectedRevision:2,reason:'隔离演示批次'}));rejects(()=>a.give(),'BATCH_UNAVAILABLE');assert.equal(a.bills().items.length,0);assert.equal(a.stock().quantity_scaled,1000);
});
test('a legacy non-expiry material flag never permits dispensing medicine with an unknown actual expiry',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx();a.db.prepare('UPDATE material SET requires_expiry=0 WHERE id=?').run(a.drug.id);a.db.prepare('UPDATE material_batch SET expiry_date=NULL WHERE id=?').run(a.batch.id);
 assert.equal(a.pharmacy.query(a.ph,{prescriptionId:p.id}).prescription.items[0].stocks.length,0);rejects(()=>a.give(),'BATCH_UNAVAILABLE');assert.equal(a.stock().quantity_scaled,1000);assert.equal(a.bills().items.length,0);
});
test('revoking pharmacy qualification immediately rejects replay and new dispensing while retaining facts',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx();const input=a.giveInput(),d=a.pharmacy.dispense(a.ph,input);assert.equal(a.pharmacy.dispense(a.ph,input).replayed,true);assert.equal(a.stock().quantity_scaled,875);rejects(()=>a.pharmacy.dispense(a.ph,{...input,quantityScaled:100}),'REQUEST_KEY_REUSED');
 a.pharmacy.qualify(a.m,command({action:'revoke',qualificationId:a.qualification.id,confirmed:true,reason:'资格核实后撤销，停止该药学岗位授权'}));rejects(()=>a.give(),'FORBIDDEN');rejects(()=>a.pharmacy.dispense(a.ph,input),'FORBIDDEN');assert.equal(a.auth.roles(6).some(r=>r.code==='pharmacist'),false);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record WHERE id=?').get(d.id).n,1);
});
test('an expired institution or a prescriber with pharmacy qualification still cannot approve their own prescription',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.pharmacy.qualify(a.m,command({action:'grant',accountId:4,validFrom:a.auth.now(),validUntil:'2027-01-01T00:00:00Z',reason:'仅隔离测试：双岗位资格',confirmed:true}));
 const s=a.auth.login({username:'dentist',password:'Clinic123!'}),actor={token:s.token,csrf:s.csrf,role:'pharmacist'};
 rejects(()=>a.pharmacy.review(actor,command({action:'approve',prescriptionId:p.id,patientId:1,expectedRevision:2,expectedLatestHealthVersionId:1,confirmed:true,reviewNote:'测试自审'})),'PHARMACY_REVIEW_STATE');
 a.pharmacy.policy={...a.pharmacy.policy,validUntil:'2026-10-19T01:35:00Z'};rejects(()=>a.approveRx(),'PHARMACY_NOT_ENABLED');
});
test('partial medicine delivery cannot be voided or overwritten and an actual-time price change requires a fresh check',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx();rejects(()=>a.give({expectedPriceId:999}),'PRICE_CHANGED');a.give();
 rejects(()=>a.rx({action:'void',prescriptionId:p.id,expectedRevision:a.rxInfo().revision,confirmed:true,reason:'试图覆盖实际发药'}),'DISPENSE_ALREADY_OCCURRED');
 assert.throws(()=>a.db.prepare('UPDATE dispense_record SET quantity_scaled=1').run(),/dispense_frozen/);assert.throws(()=>a.db.prepare('DELETE FROM dispense_record').run(),/dispense_frozen/);
});
test('fractional medicine charges use rounded integer cents in collection budgets and fee adjustments, retaining the original handover',t=>{
 const a=setup(t,{priceCents:199}),p=a.inDraft();a.rxIssue(p);a.approveRx();a.give();let q=a.bills(),b=q.items[0],line=b.items[0];assert.equal(line.amount_cents,249);assert.equal(q.totals.receivableCents,249);
 const pay=a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:q.funds.revision,receivedCents:300,changeCents:0,channel:'现金',verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'演示真实点收',keepAsPrepayment:true,allocations:[{billId:b.id,expectedRevision:b.revision,amountCents:249,reason:'实际药费'}]}));
 q=a.bills();assert.equal(q.totals.unpaidCents,0);assert.equal(q.funds.availableCents,51);
 rejects(()=>a.payments.allocate(a.c,command({action:'allocate',patientId:1,paymentId:pay.id,expectedPaymentRevision:1,expectedFundsRevision:q.funds.revision,allocations:[{billId:b.id,expectedRevision:q.items[0].revision,amountCents:1,reason:'测试不可超实际应收'}]})),'BILL_BUDGET');
 const req=a.fees.apply(a.c,command({action:'submit',patientId:1,billId:b.id,paymentId:pay.id,expectedFundsRevision:q.funds.revision,expectedBillRevision:q.items[0].revision,expectedPaymentRevision:1,adjustmentCents:-49,refundCents:0,reason:'演示核实费用差额',evidence:'原药费与实际依据'}));
 const info=a.fees.query(a.m,{patientId:1});assert.equal(info.items[0].billSource.items[0].amount_cents,249);
 a.fees.approve(a.m,command({action:'approve',patientId:1,requestId:req.id,expectedRevision:1,expectedFundsRevision:q.funds.revision,expectedBillRevision:q.items[0].revision,expectedPaymentRevision:1,adjustmentCents:-49,refundCents:0,reviewNote:'核对原实际发药与差额，保留原费用',items:[{billItemId:line.id,expectedRevision:1,amountCents:-49,note:'独立药费调整'}],releases:[{kind:'allocation',id:q.funds.payments[0].allocations[0].id,expectedRevision:1,amountCents:49,reason:'随应收减少释放原用途'}]}));
 assert.equal(a.bills().totals.receivableCents,200);assert.equal(a.stock().quantity_scaled,875);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,1);
});
test('no current price creates an actual pending-price line; manager prices only the matching drug service at original dispensing time',t=>{
 const a=setup(t,{price:false}),p=a.inDraft();a.rxIssue(p);a.approveRx();a.give();let line=a.bills().items[0].items[0];assert.equal(line.pricing_status,'待核价');assert.equal(a.bills().totals.receivableCents,0);assert.equal(a.billing.catalog(a.m).pendingItems[0].service_id,a.drugService);
 const price=a.price(a.drugService,{unitPriceCents:200});a.billing.approve(a.m,command({action:'pricePending',billItemId:line.id,expectedRevision:1,priceId:price.id,reviewNote:'核对原发药时刻适用的药品价目'}));assert.equal(a.bills().totals.receivableCents,250);
});
test('audit failure rolls actual medicine handover, batch deduction, bill and successful receipt back together',t=>{
 const a=setup(t),p=a.inDraft();a.rxIssue(p);a.approveRx();a.db.exec("CREATE TEMP TRIGGER pharmacy_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='dispense_record' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'pharmacy_audit_fault'); END");assert.throws(()=>a.give(),/pharmacy_audit_fault/);assert.equal(a.stock().quantity_scaled,1000);assert.equal(a.db.prepare("SELECT count(*) n FROM inventory_movement WHERE movement_type='发药'").get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,0);assert.equal(a.bills().items.length,0);
});
