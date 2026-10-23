'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {setup,command}=require('./helpers/v2-prescriptions');
const {setupFees}=require('./helpers/v2-fees');
const {setupInventory}=require('./helpers/v2-inventory');
const {setup:setupSettlements}=require('./helpers/v2-settlements');
const {removePaymentPrescriptionFixture}=require('./helpers/v2-payment-prescription-legacy');
const {upgradePaymentPrescription}=require('../src/v2/payment-prescription-schema');
const {openDatabase,VERSION}=require('../src/v2/database');
const {validatePrescriptions}=require('../src/v2/prescriptions');
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
function prepay(a,extra={}){return a.settlements.order(a.c,command({patientId:1,billId:null,expectedFundsRevision:a.billing.fundsSummary(1).revision,confirmPrepayment:true,amountCents:10000,channel:'微信',evidence:'核对患者及本次独立预收用途',...extra}));}
function resultInput(a,orderId,extra={}){const o=a.db.prepare('SELECT * FROM payment_order WHERE id=?').get(orderId);return command({orderId,expectedRevision:o.revision,businessNo:o.business_no,outcome:'success',amountCents:o.amount_cents,patientMatches:true,merchantMatches:true,reference:'PRE-TEST-'+o.id,receivedAt:a.auth.now(),expectedFundsRevision:a.billing.fundsSummary(1).revision,evidence:'实际查证官方原单及同一患者、收款方和金额',...extra});}
function issued(t){const a=setup(t);a.review();a.record();a.p=a.rxDraft();a.rxIssue(a.p);a.p=a.db.prepare('SELECT * FROM prescription WHERE id=?').get(a.p.id);return a;}

test('net received and material category are correctly typed non-null generated columns, not duplicate inputs',t=>{
 const a=setupFees(t),payment=a.db.prepare('SELECT * FROM patient_payment').get();assert.equal(payment.net_cents,payment.received_cents-payment.change_cents);
 assert.equal(a.db.prepare('PRAGMA table_xinfo(patient_payment)').all().find(c=>c.name==='net_cents').hidden,3);
 assert.throws(()=>a.db.prepare('UPDATE patient_payment SET net_cents=1 WHERE id=?').run(payment.id),/generated column/);
 const b=setupInventory(t);assert.equal(b.db.prepare('SELECT category FROM material').get().category,'材料');b.db.prepare('UPDATE material SET is_drug=1').run();assert.equal(b.db.prepare('SELECT category FROM material').get().category,'药品');assert.throws(()=>b.db.prepare("UPDATE material SET category='材料'").run(),/generated column/);
});
test('electronic prepayment without a bill stays unreceived while unknown, then credits one original payment exactly once',t=>{
 const a=setup(t),o=prepay(a),row=a.db.prepare('SELECT * FROM payment_order').get();assert.equal(row.bill_id,null);assert.ok(row.patient_funds_id);assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);
 a.settlements.verifyOrder(a.c,resultInput(a,o.id,{outcome:'unknown'}));assert.equal(a.billing.fundsSummary(1).confirmedReceivedCents,0);assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);reject(()=>prepay(a),'PAYMENT_ORDER_PENDING');
 const input=resultInput(a,o.id);a.settlements.verifyOrder(a.c,input);assert.equal(a.settlements.verifyOrder(a.c,input).replayed,true);assert.equal(a.billing.fundsSummary(1).availableCents,10000);assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,1);assert.equal(a.db.prepare('SELECT count(*) n FROM payment_allocation').get().n,0);assert.equal(a.settlements.query(a.c).orders[0].bill_id,null);
});
test('confirmed electronic prepayment can later offset an actual bill without another receipt or an automatic early allocation',t=>{
 const a=setup(t),o=prepay(a);a.settlements.verifyOrder(a.c,resultInput(a,o.id));a.review();a.record();const s=a.service();a.price(s.id,{unitPriceCents:6000});a.execute(s.id,{independentCheck:true,independentBasis:'当前实际独立检查及患者确认依据'});
 const b=a.bills(),p=b.funds.payments[0];a.payments.allocate(a.c,command({action:'offset',patientId:1,paymentId:p.id,expectedPaymentRevision:p.revision,expectedFundsRevision:b.funds.revision,allocations:[{billId:b.items[0].id,expectedRevision:b.items[0].revision,amountCents:4000,reason:'从既有确认预收中抵扣本次实际费用'}]}));
 assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,1);assert.equal(a.bills().totals.unpaidCents,2000);assert.equal(a.billing.fundsSummary(1).availableCents,6000);assert.equal(a.billing.fundsSummary(1).confirmedReceivedCents,10000);
});
test('prepayment verification rejects stale funds, wrong amounts and duplicate channel receipts without a partial success',t=>{
 const a=setup(t),o=prepay(a);reject(()=>a.settlements.verifyOrder(a.c,resultInput(a,o.id,{expectedFundsRevision:99})),'VERSION_CONFLICT');reject(()=>a.settlements.verifyOrder(a.c,resultInput(a,o.id,{amountCents:9999})),'PAYMENT_RESULT_MISMATCH');
 assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);assert.equal(a.db.prepare('SELECT status FROM payment_order').get().status,'待支付');
 a.settlements.verifyOrder(a.c,resultInput(a,o.id));const another=prepay(a);reject(()=>a.settlements.verifyOrder(a.c,resultInput(a,another.id,{reference:'PRE-TEST-'+o.id})),'PAYMENT_DUPLICATE');assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,1);
});
test('audit failure rolls electronic success, actual payment and funds revision back to the original pending order',t=>{
 const a=setup(t),o=prepay(a),funds=a.billing.fundsSummary(1);a.db.exec("CREATE TEMP TRIGGER prepay_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='payment_order' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'prepay_audit_fault'); END");
 assert.throws(()=>a.settlements.verifyOrder(a.c,resultInput(a,o.id)),/prepay_audit_fault/);assert.equal(a.billing.fundsSummary(1).revision,funds.revision);assert.equal(a.billing.fundsSummary(1).availableCents,0);assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);assert.equal(a.db.prepare('SELECT status FROM payment_order').get().status,'待支付');
});
test('cash reconciliation records exactly one cash original and immutable resolution without modifying payment or business date',t=>{
 const a=setupFees(t),original=a.db.prepare('SELECT * FROM patient_payment').get(),input=command({action:'check',paymentId:original.id,date:'2026-10-19',actualCents:99000,evidence:'逐笔实盘与原收据核对发现差异'}),r=a.settlements.check(a.c,input);assert.equal(a.settlements.check(a.c,input).replayed,true);
 const first=a.db.prepare('SELECT * FROM payment_reconciliation').get();assert.equal(first.patient_payment_id,original.id);assert.equal(first.status,'差异待处理');assert.equal(first.expected_cents,original.net_cents);
 reject(()=>a.settlements.check(a.m,command({action:'resolve',checkId:r.id,paymentId:original.id,date:'2026-10-18',actualCents:100000,evidence:'错误更改营业日期'})),'RECONCILIATION_RANGE');
 a.settlements.check(a.m,command({action:'resolve',checkId:r.id,paymentId:original.id,date:'2026-10-19',actualCents:100000,evidence:'负责人回查实盘，原款无需改写'}));assert.equal(a.db.prepare('SELECT count(*) n FROM payment_reconciliation').get().n,2);assert.deepEqual(a.db.prepare('SELECT * FROM patient_payment').get(),original);assert.equal(a.db.prepare('SELECT actual_cents FROM payment_reconciliation WHERE id=?').get(r.id).actual_cents,99000);
 assert.throws(()=>a.db.prepare('DELETE FROM payment_reconciliation WHERE id=?').run(r.id),/delete_forbidden/);
});
test('cash checks reject noncash, mixed or absent sources; unverified pending check can leave resolution empty',t=>{
 const a=setupFees(t,{channel:'微信'});reject(()=>a.settlements.check(a.c,command({action:'check',paymentId:a.payment.id,date:'2026-10-19',actualCents:100000,evidence:'错误来源'})),'RECONCILIATION_SOURCE');
 reject(()=>a.settlements.check(a.c,command({action:'check',date:'2026-10-19'})),'RECONCILIATION_SOURCE');reject(()=>a.settlements.check(a.c,command({action:'check',paymentId:a.payment.id,orderId:1,date:'2026-10-19'})),'RECONCILIATION_SOURCE');
 const b=setupFees(t),r=b.settlements.check(b.c,command({action:'check',paymentId:b.payment.id,date:'2026-10-19',actualCents:null,evidence:null})),saved=b.db.prepare('SELECT * FROM payment_reconciliation WHERE id=?').get(r.id);assert.equal(saved.status,'待核对');assert.equal(saved.resolution,null);
});
test('a partially successful refund is reconciled against actual refunded money rather than its larger requested amount',t=>{
 const a=setupFees(t),r=a.request();a.approve(r.id);const refund=a.begin(r.id);a.finish(refund.id,{actualCents:10000});const check=a.settlements.check(a.c,command({action:'check',refundId:refund.id,date:'2026-10-19',actualCents:10000,evidence:'核实原退款实际仅成功100元'}));const row=a.db.prepare('SELECT * FROM payment_reconciliation WHERE id=?').get(check.id);assert.equal(row.expected_cents,10000);assert.equal(row.status,'一致');
});
test('prescription guidance can remain unknown in a draft but issuance requires the completed actual guidance',t=>{
 const a=setup(t);a.review();a.record();const draft=a.rxDraft({guidanceNote:null});assert.equal(a.db.prepare('SELECT guidance_note FROM prescription').get().guidance_note,null);reject(()=>a.rxIssue(draft),'PRESCRIPTION_GUIDANCE');
 a.rx({action:'save',prescriptionId:draft.id,expectedRevision:1,diagnosis:'实际诊断记录',guidanceNote:'本次由医师填写的实际说明',items:a.prescriptions.items(draft.id).map(i=>({materialId:i.material_id,expectedMaterialRevision:2,quantityScaled:i.quantity_scaled,directions:i.directions})),reason:'实际补全指导后再次核对'});a.rxIssue({id:draft.id,revision:2});assert.equal(a.prescriptions.query(a.d,a.context).prescriptions[0].contentIntact,true);
});
test('downloading is not handover; explicit actual handover retains the sealed prescription and creates no dispensing or charge',t=>{
 const a=issued(t),hash=a.p.content_hash;a.prescriptions.export(a.d,a.p.id);assert.equal(a.db.prepare('SELECT handed_over_at FROM prescription').get().handed_over_at,null);
 const input=command({...a.context,action:'handover',prescriptionId:a.p.id,expectedRevision:2,handedOverAt:a.auth.now(),recipientVerified:true,confirmed:true,reason:'核对接收人后实际交付处方文件及用药指导'});a.prescriptions.write(a.d,input);assert.equal(a.prescriptions.write(a.d,input).replayed,true);
 const p=a.db.prepare('SELECT * FROM prescription').get();assert.equal(p.handed_over_by,4);assert.equal(p.content_hash,hash);assert.equal(a.prescriptions.query(a.d,a.context).prescriptions[0].contentIntact,true);
 for(const table of ['dispense_record','bill_item','inventory_movement'])assert.equal(a.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 reject(()=>a.rx({action:'handover',prescriptionId:p.id,expectedRevision:3,handedOverAt:a.auth.now(),confirmed:true,recipientVerified:true,reason:'不能重复交付确认'}),'PRESCRIPTION_HANDOVER');
 assert.throws(()=>a.db.prepare('UPDATE prescription SET handed_over_at=? WHERE id=?').run('2026-10-19T01:36:00Z',p.id),/prescription_handover|prescription_frozen/);
});
test('handover validates recipient and real time, and unknown outside medication dispensing blocks void',t=>{
 const a=issued(t),base={action:'handover',prescriptionId:a.p.id,expectedRevision:2,handedOverAt:a.auth.now(),confirmed:true,recipientVerified:true,reason:'原方实际文件交付'};
 reject(()=>a.rx({...base,recipientVerified:false}),'CONFIRM_REQUIRED');reject(()=>a.rx({...base,handedOverAt:'2026-10-20T01:35:00Z'}),'PRESCRIPTION_HANDOVER_TIME');a.rx(base);
 reject(()=>a.rx({action:'void',prescriptionId:a.p.id,expectedRevision:3,confirmed:true,reason:'尚未明确院外是否已取药'}),'PRESCRIPTION_MEDICATION_UNKNOWN');assert.equal(a.db.prepare('SELECT status FROM prescription').get().status,'已开立');
});
test('verified void retains the original handover and names the actual doctor; corrected prescribing links the original without reusing dispensing',t=>{
 const a=issued(t);a.rx({action:'handover',prescriptionId:a.p.id,expectedRevision:2,handedOverAt:a.auth.now(),confirmed:true,recipientVerified:true,reason:'已实际交付处方文件'});a.rx({action:'void',prescriptionId:a.p.id,expectedRevision:3,confirmed:true,medicationNotDispensed:true,reason:'回查患者确认尚未院外取药后作废原方'});
 const old=a.db.prepare('SELECT * FROM prescription').get();assert.equal(old.voided_by,4);assert.equal(old.handed_over_by,4);assert.equal(old.content_hash,a.p.content_hash);
 const draft=a.rxDraft({originalPrescriptionId:old.id,expectedOriginalRevision:old.revision});a.rxIssue(draft);const next=a.db.prepare('SELECT * FROM prescription WHERE id=?').get(draft.id);assert.equal(next.original_prescription_id,old.id);assert.equal(next.handed_over_at,null);assert.equal(a.prescriptions.query(a.d,a.context).prescriptions.every(p=>p.contentIntact),true);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,0);
 assert.throws(()=>a.db.prepare('UPDATE prescription SET original_prescription_id=NULL WHERE id=?').run(next.id),/prescription_frozen/);
});
test('reissue cannot reference an untreated active original or ignore a stale original revision',t=>{
 const a=issued(t);reject(()=>a.rxDraft({originalPrescriptionId:a.p.id,expectedOriginalRevision:1}),'VERSION_CONFLICT');reject(()=>a.rxDraft({originalPrescriptionId:a.p.id,expectedOriginalRevision:2}),'PRESCRIPTION_ORIGINAL');assert.equal(a.db.prepare('SELECT count(*) n FROM prescription').get().n,1);
});
test('handover audit failure rolls the person, time and request receipt back together',t=>{
 const a=issued(t);a.db.exec("CREATE TEMP TRIGGER handover_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='prescription' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'handover_audit_fault'); END");assert.throws(()=>a.rx({action:'handover',prescriptionId:a.p.id,expectedRevision:2,handedOverAt:a.auth.now(),confirmed:true,recipientVerified:true,reason:'实际交付后保存失败'}),/handover_audit_fault/);assert.deepEqual(a.db.prepare('SELECT * FROM prescription').get(),a.p);
});
test('procurement cancellation preserves its specific reason without overwriting the original demand',t=>{
 const a=setupInventory(t),p=a.purchases.draft(a.i,command({action:'create',supplierId:a.supplier.id,expectedSupplierRevision:1,agreedAt:a.auth.now(),deliveryTerms:'独立采购计划',reason:'原实际采购需求',items:[{materialId:a.material.id,expectedMaterialRevision:2,orderedQuantityScaled:10,unitPriceCents:1000}]}));
 a.purchases.approve(a.m,command({action:'cancel',purchaseId:p.id,expectedRevision:1,reviewNote:'负责人确认当前采购需求取消'}));const row=a.db.prepare('SELECT * FROM purchase_order WHERE id=?').get(p.id);assert.equal(row.request_reason,'原实际采购需求');assert.equal(row.cancellation_reason,'负责人确认当前采购需求取消');
});

function previous(t){
 const a=setupSettlements(t),o=a.order();a.settlements.verifyOrder(a.c,command(a.orderResult(o.id)));const rx=a.rxDraft();a.rxIssue(rx);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-payment-prescription-')),file=path.join(folder,'previous.db'),tracked=[];
 t.after(()=>{for(const db of tracked)if(db.isOpen)db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-payment-prescription-'));fs.rmSync(folder,{recursive:true,force:true});});
 a.db.prepare('VACUUM INTO ?').run(file);const db=new DatabaseSync(file);removePaymentPrescriptionFixture(db);db.prepare('UPDATE sqlite_sequence SET seq=100 WHERE name=?').run('payment_order');
 const original=new Map(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>[r.name,{columns:db.prepare('PRAGMA table_xinfo('+r.name+')').all().map(c=>c.name),rows:JSON.stringify(db.prepare('SELECT * FROM '+r.name+' ORDER BY rowid').all())}]));const signed=db.prepare('SELECT content_hash FROM prescription').get().content_hash;db.close();return {folder,file,original,signed,track:db=>{tracked.push(db);return db;}};
}
test('108-table migration preserves original rows, generated money, sealed prescription hashes and reserved sequence; backup is readable once',t=>{
 const f=previous(t),db=f.track(openDatabase(f.file));assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);
 for(const[name,old]of f.original){const current=db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(r=>Object.fromEntries(old.columns.map(c=>[c,r[c]])));assert.equal(JSON.stringify(current),old.rows,name);}
 assert.equal(db.prepare('SELECT patient_funds_id FROM payment_order').get().patient_funds_id,db.prepare('SELECT patient_funds_id FROM bill').get().patient_funds_id);assert.equal(db.prepare('SELECT content_hash FROM prescription').get().content_hash,f.signed);validatePrescriptions(db);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('payment_order').seq,100);
 const backups=fs.readdirSync(path.join(f.folder,'backups'));assert.equal(backups.length,1);const b=new DatabaseSync(path.join(f.folder,'backups',backups[0]),{readOnly:true});assert.equal(b.prepare('PRAGMA user_version').get().user_version,2026102303);b.close();openDatabase(f.file).close();assert.equal(fs.readdirSync(path.join(f.folder,'backups')).length,1);
});
test('failure after rebuilding three tables rolls back their definitions, rows, triggers and schema version',t=>{
 const f=previous(t),db=f.track(new DatabaseSync(f.file));db.exec('PRAGMA foreign_keys=ON;ALTER TABLE material ADD COLUMN category TEXT');const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='prescription'").get().sql;
 assert.throws(()=>upgradePaymentPrescription(db,':memory:'),/duplicate column/);assert.equal(db.prepare('PRAGMA user_version').get().user_version,2026102303);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='prescription'").get().sql,sql);assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),triggers);assert.equal(JSON.stringify(db.prepare('SELECT * FROM payment_order ORDER BY rowid').all()),f.original.get('payment_order').rows);
 db.exec('ALTER TABLE material DROP COLUMN category');upgradePaymentPrescription(db,':memory:');assert.equal(db.prepare('PRAGMA user_version').get().user_version,2026102304);
});
test('HTTP electronic prepayment works without a bill, preserves replay, returns it for the right patient, and rejects CSRF and role misuse',async t=>{
 const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port+'/api/v2';
 async function login(name){const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'Clinic123!'})}),s=await r.json();return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf,'X-Clinic-Role':name};}
 async function send(route,h,input){const r=await fetch(base+route,{method:input?'POST':'GET',headers:{...h,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json()};}
 const c=await login('cashier'),f=await login('frontdesk'),input=command({patientId:1,billId:null,expectedFundsRevision:null,confirmPrepayment:true,channel:'微信',amountCents:10000,evidence:'HTTP核对患者预收'});
 assert.equal((await send('/payment-orders/create',f,input)).status,403);assert.equal((await send('/payment-orders/create',{...c,'X-CSRF-Token':''},input)).status,403);assert.equal((await send('/payment-orders/create',c,input)).status,200);assert.equal((await send('/payment-orders/create',c,input)).body.replayed,true);
 const q=await send('/patient-bills/query?patientId=1',c);assert.equal(q.body.items.length,0);assert.equal(q.body.paymentOrders.length,1);assert.equal((await send('/patient-bills/query?patientId=2',c)).body.paymentOrders.length,0);
});
