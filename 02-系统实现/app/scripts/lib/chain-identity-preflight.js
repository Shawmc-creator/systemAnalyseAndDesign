'use strict';
// Read-only consistency checks; missing optional references are not invented.
const checks=[
 ['就诊与预约患者','SELECT v.patient_id a,a.patient_id b FROM visit v JOIN appointment a ON a.id=v.appointment_id'],
 ['临床文书与就诊患者','SELECT d.patient_id a,v.patient_id b FROM clinical_document d JOIN visit v ON v.id=d.visit_id'],
 ['医保业务与就诊患者','SELECT c.patient_id a,v.patient_id b FROM insurance_case c JOIN visit v ON v.id=c.visit_id'],
 ['费用申请与账单资金','SELECT r.patient_funds_id a,b.patient_funds_id b FROM fee_request r JOIN bill b ON b.id=r.bill_id'],
 ['费用申请与收款资金','SELECT r.patient_funds_id a,p.patient_funds_id b FROM fee_request r JOIN patient_payment p ON p.id=r.patient_payment_id'],
 ['退款与收款资金','SELECT r.patient_funds_id a,p.patient_funds_id b FROM patient_refund r JOIN patient_payment p ON p.id=r.patient_payment_id'],
 ['退款与申请资金','SELECT r.patient_funds_id a,f.patient_funds_id b FROM patient_refund r JOIN fee_request f ON f.id=r.fee_request_id'],
 ['支付登记的账单与收款资金','SELECT b.patient_funds_id a,p.patient_funds_id b FROM payment_order o JOIN bill b ON b.id=o.bill_id JOIN patient_payment p ON p.id=o.patient_payment_id']
];
function checkIdentity(db){
 const relationships=checks.map(([name,sql])=>{let checked=0,conflicts=0,unresolved=0;for(const r of db.prepare(sql).iterate()){
  if(r.a==null||r.b==null){unresolved++;continue;}checked++;if(r.a!==r.b)conflicts++;
 }return {relationship:name,checked,conflicts,unresolved};});
 return {consistent:relationships.every(r=>r.conflicts===0&&r.unresolved===0),relationships};
}
module.exports={checkIdentity};
