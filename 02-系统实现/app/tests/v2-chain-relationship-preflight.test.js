'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {DatabaseSync}=require('node:sqlite');const {checkRelationships}=require('../scripts/lib/chain-relationship-preflight');
test('核心归属关联逐项识别跨店冲突与缺失，不误把负责门店当作来源门店',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE dated_schedule(id,dental_chair_id);INSERT INTO dated_schedule VALUES(1,1);
 CREATE TABLE resource_occupancy(appointment_id,visit_id,dated_schedule_id);INSERT INTO resource_occupancy VALUES(1,1,1);
 CREATE TABLE visit(id,appointment_id);INSERT INTO visit VALUES(1,1);
 CREATE TABLE bill(id,patient_funds_id);INSERT INTO bill VALUES(1,1);
 CREATE TABLE patient_payment(id,patient_funds_id);INSERT INTO patient_payment VALUES(1,1);
 CREATE TABLE treatment_execution(id,visit_id);INSERT INTO treatment_execution VALUES(1,1);
 CREATE TABLE clinical_document(id,visit_id);INSERT INTO clinical_document VALUES(1,1),(2,NULL);
 CREATE TABLE insurance_case(id,visit_id,bill_id);INSERT INTO insurance_case VALUES(1,1,1),(2,1,NULL);
 CREATE TABLE payment_order(id,bill_id,patient_payment_id);INSERT INTO payment_order VALUES(1,1,1),(2,1,NULL);
 CREATE TABLE fee_request(id,patient_funds_id,bill_id,patient_payment_id);INSERT INTO fee_request VALUES(1,1,1,1),(2,1,NULL,NULL);
 CREATE TABLE patient_refund(id,patient_funds_id,patient_payment_id,fee_request_id);INSERT INTO patient_refund VALUES(1,1,1,1);
 CREATE TABLE batch_stock(material_batch_id,stock_location_id);INSERT INTO batch_stock VALUES(1,1);
 CREATE TABLE purchase_receipt(id,purchase_order_id);INSERT INTO purchase_receipt VALUES(1,1);
 CREATE TABLE purchase_receipt_item(purchase_receipt_id,material_batch_id,stock_location_id);INSERT INTO purchase_receipt_item VALUES(1,1,1);
 CREATE TABLE followup_requirement(id,source_visit_id);INSERT INTO followup_requirement VALUES(1,1);`);
 const tables=Object.fromEntries(['dated_schedule','dental_chair','appointment','visit','bill','patient_funds','patient_payment','material_batch','stock_location','purchase_order','treatment_execution','clinical_document','insurance_case','payment_order','fee_request','patient_refund'].map(x=>[x,{'1':{branch_id:1},'2':{branch_id:1}}]));
 tables.followup_requirement={'1':{source_branch_id:1,responsible_branch_id:2}};
 const base={tables},result=checkRelationships(db,base);assert.equal(result.consistent,true);assert.equal(result.relationships.length,22);assert.ok(result.relationships.every(x=>x.checked>=1));
 for(const name of ['临床文书与就诊','医保业务与账单','支付登记与收款记录','费用申请与账单','费用申请与收款记录'])assert.equal(result.relationships.find(x=>x.relationship===name).checked,1,name);
 const pairs=[['排班与诊椅','dated_schedule','branch_id'],['预约与排班占用','appointment','branch_id'],['就诊与预约','visit','branch_id'],['就诊与排班占用','visit','branch_id'],['账单与患者资金','bill','branch_id'],['付款与患者资金','patient_payment','branch_id'],['库存批次与库位','material_batch','branch_id'],['验收采购与材料批次','purchase_order','branch_id'],['验收采购与库位','purchase_order','branch_id'],['复诊来源与就诊','followup_requirement','source_branch_id']];
 for(const [name,table] of [['治疗执行与就诊','treatment_execution'],['临床文书与就诊','clinical_document'],['医保业务与就诊','insurance_case'],['医保业务与账单','insurance_case'],['支付登记与账单','payment_order'],['支付登记与收款记录','payment_order'],['费用申请与患者资金','fee_request'],['费用申请与账单','fee_request'],['费用申请与收款记录','fee_request'],['退款与患者资金','patient_refund'],['退款与收款记录','patient_refund'],['退款与费用申请','patient_refund']])pairs.push([name,table,'branch_id']);
 for(const [name,table,field] of pairs){const a=structuredClone(base);a.tables[table]['1'][field]=2;const r=checkRelationships(db,a).relationships.find(x=>x.relationship===name);assert.equal(r.conflicts,1,name);assert.equal(r.examples.length,1,name);delete a.tables[table]['1'][field];assert.equal(checkRelationships(db,a).relationships.find(x=>x.relationship===name).unresolved,1,name);}
 }finally{db.close();}
});
