'use strict';
// Checks only relationships whose same-branch meaning follows existing business
// facts. It never infers a branch and does not assert that supplied facts are true.
const checks=[
 {name:'排班与诊椅',left:'dated_schedule',right:'dental_chair',sql:'SELECT s.id item_id,s.dental_chair_id right_id FROM dated_schedule s'},
 {name:'预约与排班占用',left:'appointment',right:'dated_schedule',sql:'SELECT o.appointment_id item_id,o.dated_schedule_id right_id FROM resource_occupancy o WHERE o.appointment_id IS NOT NULL'},
 {name:'就诊与预约',left:'visit',right:'appointment',sql:'SELECT v.id item_id,v.appointment_id right_id FROM visit v WHERE v.appointment_id IS NOT NULL'},
 {name:'就诊与排班占用',left:'visit',right:'dated_schedule',sql:'SELECT o.visit_id item_id,o.dated_schedule_id right_id FROM resource_occupancy o WHERE o.visit_id IS NOT NULL'},
 {name:'账单与患者资金',left:'bill',right:'patient_funds',sql:'SELECT b.id item_id,b.patient_funds_id right_id FROM bill b'},
 {name:'付款与患者资金',left:'patient_payment',right:'patient_funds',sql:'SELECT p.id item_id,p.patient_funds_id right_id FROM patient_payment p'},
 {name:'治疗执行与就诊',left:'treatment_execution',right:'visit',sql:'SELECT e.id item_id,e.visit_id right_id FROM treatment_execution e'},
 {name:'临床文书与就诊',left:'clinical_document',right:'visit',sql:'SELECT d.id item_id,d.visit_id right_id FROM clinical_document d WHERE d.visit_id IS NOT NULL'},
 {name:'医保业务与就诊',left:'insurance_case',right:'visit',sql:'SELECT c.id item_id,c.visit_id right_id FROM insurance_case c'},
 {name:'医保业务与账单',left:'insurance_case',right:'bill',sql:'SELECT c.id item_id,c.bill_id right_id FROM insurance_case c WHERE c.bill_id IS NOT NULL'},
 {name:'支付登记与账单',left:'payment_order',right:'bill',sql:'SELECT o.id item_id,o.bill_id right_id FROM payment_order o'},
 {name:'支付登记与收款记录',left:'payment_order',right:'patient_payment',sql:'SELECT o.id item_id,o.patient_payment_id right_id FROM payment_order o WHERE o.patient_payment_id IS NOT NULL'},
 {name:'费用申请与患者资金',left:'fee_request',right:'patient_funds',sql:'SELECT r.id item_id,r.patient_funds_id right_id FROM fee_request r'},
 {name:'费用申请与账单',left:'fee_request',right:'bill',sql:'SELECT r.id item_id,r.bill_id right_id FROM fee_request r WHERE r.bill_id IS NOT NULL'},
 {name:'费用申请与收款记录',left:'fee_request',right:'patient_payment',sql:'SELECT r.id item_id,r.patient_payment_id right_id FROM fee_request r WHERE r.patient_payment_id IS NOT NULL'},
 {name:'退款与患者资金',left:'patient_refund',right:'patient_funds',sql:'SELECT r.id item_id,r.patient_funds_id right_id FROM patient_refund r'},
 {name:'退款与收款记录',left:'patient_refund',right:'patient_payment',sql:'SELECT r.id item_id,r.patient_payment_id right_id FROM patient_refund r'},
 {name:'退款与费用申请',left:'patient_refund',right:'fee_request',sql:'SELECT r.id item_id,r.fee_request_id right_id FROM patient_refund r WHERE r.fee_request_id IS NOT NULL'},
 {name:'库存批次与库位',left:'material_batch',right:'stock_location',sql:'SELECT s.material_batch_id item_id,s.stock_location_id right_id FROM batch_stock s'},
 {name:'验收采购与材料批次',left:'purchase_order',right:'material_batch',sql:'SELECT r.purchase_order_id item_id,i.material_batch_id right_id FROM purchase_receipt_item i JOIN purchase_receipt r ON r.id=i.purchase_receipt_id'},
 {name:'验收采购与库位',left:'purchase_order',right:'stock_location',sql:'SELECT r.purchase_order_id item_id,i.stock_location_id right_id FROM purchase_receipt_item i JOIN purchase_receipt r ON r.id=i.purchase_receipt_id'},
 {name:'复诊来源与就诊',left:'followup_requirement',leftField:'source_branch_id',right:'visit',sql:'SELECT f.id item_id,f.source_visit_id right_id FROM followup_requirement f'}
];
function checkRelationships(db,assignment){
 const results=[];
 for(const c of checks){let checked=0,unresolved=0,conflicts=0;const examples=[];
  for(const r of db.prepare(c.sql).all()){
   const a=assignment.tables[c.left]?.[String(r.item_id)]?.[c.leftField||'branch_id'];
   const b=assignment.tables[c.right]?.[String(r.right_id)]?.branch_id;
   if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)){unresolved++;continue;}
   checked++;if(a!==b){conflicts++;if(examples.length<10)examples.push({[c.left]:r.item_id,[c.right]:r.right_id});}
  }
  results.push({relationship:c.name,checked,unresolved,conflicts,examples});
 }
 return {consistent:results.every(r=>r.unresolved===0&&r.conflicts===0),relationships:results};
}
module.exports={checkRelationships};
