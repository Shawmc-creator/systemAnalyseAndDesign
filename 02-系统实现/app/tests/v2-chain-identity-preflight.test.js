'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {checkIdentity}=require('../scripts/lib/chain-identity-preflight');
test('同店但患者或资金账户不一致时拒绝通过，可选关联为空不误报',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(`CREATE TABLE appointment(id,patient_id); INSERT INTO appointment VALUES(1,1);
   CREATE TABLE visit(id,patient_id,appointment_id); INSERT INTO visit VALUES(1,1,1);
   CREATE TABLE clinical_document(id,patient_id,visit_id); INSERT INTO clinical_document VALUES(1,1,1),(2,2,NULL);
   CREATE TABLE insurance_case(id,patient_id,visit_id); INSERT INTO insurance_case VALUES(1,1,1);
   CREATE TABLE bill(id,patient_funds_id); INSERT INTO bill VALUES(1,1);
   CREATE TABLE patient_payment(id,patient_funds_id); INSERT INTO patient_payment VALUES(1,1);
   CREATE TABLE fee_request(id,patient_funds_id,bill_id,patient_payment_id); INSERT INTO fee_request VALUES(1,1,1,1),(2,1,NULL,NULL);
   CREATE TABLE patient_refund(id,patient_funds_id,patient_payment_id,fee_request_id); INSERT INTO patient_refund VALUES(1,1,1,1);
   CREATE TABLE payment_order(id,bill_id,patient_payment_id); INSERT INTO payment_order VALUES(1,1,1),(2,1,NULL);`);
  assert.equal(checkIdentity(db).consistent,true);
  for(const [table,column,name] of [['visit','patient_id','就诊与预约患者'],['clinical_document','patient_id','临床文书与就诊患者'],['insurance_case','patient_id','医保业务与就诊患者'],['fee_request','patient_funds_id','费用申请与账单资金'],['fee_request','patient_funds_id','费用申请与收款资金'],['patient_refund','patient_funds_id','退款与收款资金'],['patient_refund','patient_funds_id','退款与申请资金'],['patient_payment','patient_funds_id','支付登记的账单与收款资金']]){
   db.prepare(`UPDATE ${table} SET ${column}=2 WHERE id=1`).run();const result=checkIdentity(db);assert.equal(result.consistent,false);assert.equal(result.relationships.find(r=>r.relationship===name).conflicts,1);db.prepare(`UPDATE ${table} SET ${column}=1 WHERE id=1`).run();
  }
  db.exec('UPDATE visit SET patient_id=NULL WHERE id=1');
  assert.equal(checkIdentity(db).relationships.find(r=>r.relationship==='就诊与预约患者').unresolved,1);
  assert.equal(checkIdentity(db).consistent,false);
 }finally{db.close();}
});
