const test = require('node:test');
const assert = require('node:assert/strict');
const {createDatabase} = require('../src/db');
const r = require('../src/requirements');
const {signEncounter} = require('../src/services');
function setup(t){const db=createDatabase(':memory:');t.after(()=>db.close());return {db,...Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.username,u]))};}
function visit(db,dentist,no='E900001'){const id=Number(db.prepare("INSERT INTO encounters(encounter_no,patient_id,dentist_id,status,chief_complaint,diagnosis,clinical_notes,instructions) VALUES(?,1,?,'draft','口腔检查','检查记录','本次检查已完成','遵循诊后安排')").run(no,dentist.id).lastInsertRowid);db.prepare("INSERT INTO tooth_findings(encounter_id,tooth_code,finding,created_by) VALUES(?,'全口','记录全口检查所见',?)").run(id,dentist.id);return id;}
function item(db,id,dentist,sid=1,qty=1){return r.addTreatment(db,id,{serviceId:sid,quantity:qty,outsidePlanReason:'实际完成项目',patientConfirmed:true},dentist);}
function price(db,sid,value,cashier,manager){return r.createPriceVersion(db,{serviceId:sid,unitPrice:value,effectiveFrom:'2020-01-01T00:00:00Z',confirmedBy:manager.id,confirmedAt:new Date().toISOString(),confirmationNote:'演示价目已经确认'},cashier);}
test('六名工作人员分岗，负责人同时具有牙医身份',t=>{
 const {db,frontdesk,cashier,manager}=setup(t);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,6);assert.equal(frontdesk.roles,'frontdesk');assert.equal(cashier.roles,'cashier');assert.ok(manager.roles.includes('dentist'));
});
test('整数分结算0.1乘3，实收与找零分开，重复返回原收据',t=>{
 const {db,dentist,cashier,manager}=setup(t);const sid=Number(db.prepare("INSERT INTO services(code,name,default_duration,current_price) VALUES('SMALL','金额精度案例',30,0)").run().lastInsertRowid);price(db,sid,0.1,cashier,manager);
 const id=visit(db,dentist);item(db,id,dentist,sid,3);signEncounter(db,id,dentist);const inv=r.createInvoice(db,id,cashier);
 const paid=r.receiveCash(db,inv.id,{expectedVersion:inv.version,amount:1,method:'cash'},cashier);assert.equal(paid.receipt.dueAmount,0.3);assert.equal(paid.receipt.changeAmount,0.7);assert.equal(paid.invoice.balance,0);assert.equal(paid.invoice.paid_amount,0.3);
 const retry=r.receiveCash(db,inv.id,{expectedVersion:inv.version,amount:1},cashier);assert.equal(retry.replayed,true);assert.equal(retry.receipt.receiptNo,paid.receipt.receiptNo);assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
});
test('有效零价可以结清，缺价不得按零元结算',t=>{
 const {db,dentist,cashier,manager}=setup(t);const sid=Number(db.prepare("INSERT INTO services(code,name,default_duration,current_price) VALUES('FREE','零价检查',30,0)").run().lastInsertRowid);
 const id=visit(db,dentist);item(db,id,dentist,sid);signEncounter(db,id,dentist);assert.throws(()=>r.createInvoice(db,id,cashier),e=>e.status===409&&/缺少/.test(e.message));
 price(db,sid,0,cashier,manager);const inv=r.createInvoice(db,id,cashier);const paid=r.receiveCash(db,inv.id,{expectedVersion:inv.version,amount:0,method:'cash'},cashier);assert.equal(paid.invoice.status,'paid');assert.equal(paid.receipt.dueAmount,0);
});
test('价目区间不重叠，左闭右开衔接，失败不截断旧版本',t=>{
 const {db,cashier,manager}=setup(t);const old=r.listPriceVersions(db,1)[0];const input={serviceId:1,unitPrice:120,effectiveFrom:'2040-01-01T00:00:00Z',confirmedBy:manager.id,confirmedAt:new Date().toISOString(),confirmationNote:'价目调整'};
 assert.throws(()=>r.createPriceVersion(db,input,cashier),e=>e.status===409);assert.equal(r.listPriceVersions(db,1)[0].effective_to,null);
 r.createPriceVersion(db,{...input,replacesVersionId:old.id,expectedVersion:old.version},cashier);assert.equal(r.priceAt(db,1,'2039-12-31T23:59:59Z').unit_price,100);assert.equal(r.priceAt(db,1,'2040-01-01T00:00:00Z').unit_price,120);
 assert.throws(()=>r.createPriceVersion(db,{...input,replacesVersionId:old.id,expectedVersion:1},cashier),e=>e.status===409);
});
test('项目更正使旧核对版本失效，结清后不能覆盖项目',t=>{
 const {db,dentist,cashier}=setup(t);const id=visit(db,dentist);item(db,id,dentist);signEncounter(db,id,dentist);const inv=r.createInvoice(db,id,cashier);
 r.correctTreatments(db,id,{expectedVersion:1,reason:'核对实际数量',outsidePlanReason:'已核对实际完成检查数量',patientConfirmed:true,items:[{serviceId:1,quantity:2}]},dentist);
 assert.throws(()=>r.receiveCash(db,inv.id,{expectedVersion:inv.version,amount:200},cashier),e=>e.status===409);
 const fresh=r.invoiceDetail(db,inv.id);assert.equal(fresh.gross_amount,200);r.receiveCash(db,inv.id,{expectedVersion:fresh.version,amount:200},cashier);
 assert.throws(()=>r.correctTreatments(db,id,{expectedVersion:2,reason:'不能覆盖已结清',items:[{serviceId:1,quantity:1}]},dentist),e=>e.status===409);assert.equal(db.prepare('SELECT COUNT(*) n FROM treatment_confirmation_versions WHERE encounter_id=?').get(id).n,2);
});
test('统计按实际收款日期，核对说明不改写收据',t=>{
 const {db,dentist,cashier,manager}=setup(t);const id=visit(db,dentist);item(db,id,dentist);signEncounter(db,id,dentist);const inv=r.createInvoice(db,id,cashier);r.receiveCash(db,inv.id,{expectedVersion:inv.version,amount:100},cashier);
 db.prepare("UPDATE invoices SET created_at='2000-01-01T00:00:00Z' WHERE id=?").run(inv.id);const date=db.prepare("SELECT date(paid_at,'localtime') date FROM payments WHERE invoice_id=?").get(inv.id).date;
 assert.equal(r.reportSummary(db,date,date).money.paid,100);assert.equal(r.dailySummary(db,date).expectedCash,100);assert.throws(()=>r.recordReconciliation(db,{date,countedCash:90},cashier),e=>e.status===400);
 r.recordReconciliation(db,{date,requestId:'core-reconciliation-01',basisHash:r.dailySummary(db,date).basisHash,confirmedBy:manager.id,confirmedAt:new Date().toISOString(),confirmationNote:'负责人确认差异处理',countedCash:90,differenceReason:'现金复点差异',resolutionNote:'负责人复核原始凭据'},cashier);assert.equal(r.invoiceDetail(db,inv.id).receipt.dueAmount,100);
});
