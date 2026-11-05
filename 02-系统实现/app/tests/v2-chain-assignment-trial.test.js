'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setupInventory,command}=require('./helpers/v2-inventory');const {trialAssignment}=require('../scripts/lib/chain-assignment-trial');
const candidate=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../01-需求文档/设计交付/连锁业务表归属候选映射.json'),'utf8'));
function assignment(db){const data={branchIds:[1,2],tables:{}};for(const r of candidate.rows){if(!['新增门店外键','来源与负责门店'].includes(r.mode))continue;const fields=r.mode==='新增门店外键'?[r.field]:r.fields;data.tables[r.table]={};for(const v of db.prepare('SELECT id FROM "'+r.table+'"').all())data.tables[r.table][v.id]=Object.fromEntries(fields.map(f=>[f,1]));}return data;}
test('含采购验收和库存流水的内存赋值保留原字段并验证回滚',t=>{
 const app=setupInventory(t),map=assignment(app.db),before=app.db.serialize(),result=trialAssignment(before,candidate,map);
 assert.equal(result.rollbackVerified,true);assert.equal(result.originalFieldsPreserved,true);assert.equal(result.foreignKeysVerified,true);assert.ok(result.assignedRecords>0);assert.ok(result.assignedTables>=6);assert.deepEqual(app.db.serialize(),before);
 const bad=structuredClone(map);delete bad.tables.material_batch[String(app.batch.id)];assert.throws(()=>trialAssignment(before,candidate,bad),/不完整或核心关联存在冲突/);assert.deepEqual(app.db.serialize(),before);
 const conflict=structuredClone(map);conflict.tables.stock_location[String(app.location.id)].branch_id=2;assert.throws(()=>trialAssignment(before,candidate,conflict),/不完整或核心关联存在冲突/);
});
test('已完成诊疗事实的不可变约束阻止候选赋值，不修改原始数据库',t=>{
 const app=setupInventory(t);const p=app.db.prepare('SELECT id,revision FROM patient WHERE id=1').get();app.reception.patient(app.f,command({patientId:p.id,expectedRevision:p.revision,fields:{address:'虚构测试地址'},reason:'核对患者资料'}));const service=app.service();app.price(service.id);app.execute(service.id,{independentCheck:true,independentBasis:'虚构检查'});
 const bill=app.billing.query(app.c,{patientId:1});const pending=app.payments.receive(app.c,command({action:'receive',patientId:1,expectedFundsRevision:bill.funds.revision,receivedCents:10000,changeCents:0,channel:'现金',verification:'pending',transactionEvidence:'虚构收款凭据'}));
 const current=app.billing.query(app.c,{patientId:1});app.payments.receive(app.c,command({action:'verify',patientId:1,expectedFundsRevision:current.funds.revision,paymentId:pending.id,expectedPaymentRevision:1,outcome:'received',receivedAt:app.auth.now(),transactionEvidence:'已核对虚构收款',keepAsPrepayment:true,allocations:[{billId:current.items[0].id,expectedRevision:current.items[0].revision,amountCents:10000,reason:'虚构费用分配'}]}));
 const before=app.db.serialize();assert.throws(()=>trialAssignment(before,candidate,assignment(app.db)),/patient_change（immutable_fact）/);const result=trialAssignment(before,candidate,assignment(app.db),{allowListedImmutable:true});assert.equal(result.guardedTriggerRestoreVerified,3);assert.equal(result.rollbackVerified,true);assert.equal(result.originalFieldsPreserved,true);assert.deepEqual(app.db.serialize(),before);
});

test('未知约束和被更改的保护触发器拒绝试验，源快照保持不变',t=>{
 const app=setupInventory(t);app.db.exec("CREATE TRIGGER unexpected_guard BEFORE UPDATE ON dated_schedule BEGIN SELECT RAISE(ABORT,'unexpected_guard'); END");
 let before=app.db.serialize();assert.throws(()=>trialAssignment(before,candidate,assignment(app.db),{allowListedImmutable:true}),/dated_schedule（unexpected_guard）/);assert.deepEqual(app.db.serialize(),before);
 app.db.exec('DROP TRIGGER unexpected_guard');const p=app.db.prepare('SELECT id,revision FROM patient WHERE id=1').get();app.reception.patient(app.f,command({patientId:p.id,expectedRevision:p.revision,fields:{address:'测试地址'},reason:'测试核实'}));
 app.db.exec('DROP TRIGGER tr_patient_change_immutable_fact_update');app.db.exec("CREATE TRIGGER tr_patient_change_immutable_fact_update BEFORE UPDATE ON patient_change BEGIN SELECT RAISE(ABORT,'immutable_fact'); END");
 before=app.db.serialize();assert.throws(()=>trialAssignment(before,candidate,assignment(app.db),{allowListedImmutable:true}),/保护触发器与已核对基线不一致/);assert.deepEqual(app.db.serialize(),before);
});
