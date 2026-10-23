'use strict';
const {fail,canonical,hash}=require('./common');
const {safe}=require('./billing');
function feeDigest(db,billId){return hash(canonical({items:db.prepare('SELECT id,quantity,quantity_scale,unit_price_cents,pricing_status,amount_cents FROM bill_item WHERE bill_id=? ORDER BY id').all(billId),adjustments:db.prepare('SELECT i.id,i.bill_item_id,i.amount_cents FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=? ORDER BY i.id').all(billId)}));}
function insuranceShare(db,billId){const s=db.prepare("SELECT s.* FROM insurance_settlement s JOIN insurance_case c ON c.id=s.insurance_case_id WHERE c.bill_id=? AND s.status='有效'").get(billId);return s?safe(BigInt(s.fund_cents)+BigInt(s.account_cents)):0;}
function paymentGate(db,billId,orderId=null){
 if(db.prepare("SELECT id FROM payment_order WHERE bill_id=? AND status IN ('待支付','处理中','待核实') AND id<>?").get(billId,orderId||-1))fail(409,'PAYMENT_ORDER_PENDING','原笔支付尚未明确，请先核查原单，不能再次收费或改费用');
 if(db.prepare("SELECT id FROM insurance_case WHERE bill_id=? AND status<>'已撤销' AND status<>'已结算' AND patient_choice<>'自费'").get(billId))fail(409,'INSURANCE_PENDING','医保最终承担尚未明确，请先完成医保或由患者确认自费路径');
 if(db.prepare("SELECT r.id FROM insurance_reversal r JOIN insurance_settlement s ON s.id=r.settlement_id JOIN insurance_case c ON c.id=s.insurance_case_id WHERE c.bill_id=? AND r.status IN ('待办理','待核实')").get(billId))fail(409,'INSURANCE_REVERSAL_PENDING','医保撤销尚未明确，暂不办理患者退补');
}
function feeChangeGate(db,billId){if(billId&&db.prepare("SELECT id FROM insurance_case WHERE bill_id=? AND status IN ('结算待核实','已结算')").get(billId))fail(409,'INSURANCE_REVERSAL_REQUIRED','先核实医保原单并完成必要撤销，再确认费用更正及患者退补');if(billId&&db.prepare("SELECT id FROM payment_order WHERE bill_id=? AND status IN ('待支付','处理中','待核实')").get(billId))fail(409,'PAYMENT_ORDER_PENDING','先核查原支付结果，再更正费用');}
function validateSettlements(db){
 for(const c of db.prepare("SELECT * FROM insurance_case WHERE status IN ('结算待核实','已结算')").all())if(!c.bill_id||c.fee_digest!==feeDigest(db,c.bill_id))fail(409,'INSURANCE_FEES_FROZEN','医保原笔办理未结束，不能改动原费用；请先核实并撤销');
 for(const b of db.prepare('SELECT id FROM bill').all()){
  const share=insuranceShare(db,b.id);if(!share)continue;
  const charges=db.prepare("SELECT amount_cents FROM bill_item WHERE bill_id=? AND pricing_status='已核价'").all(b.id).reduce((n,r)=>n+BigInt(r.amount_cents),0n);
  const adjusted=db.prepare('SELECT i.amount_cents FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=?').all(b.id).reduce((n,r)=>n+BigInt(r.amount_cents),charges);
  const paid=['payment_allocation','prepayment_offset'].flatMap(t=>db.prepare(`SELECT amount_cents FROM ${t} WHERE bill_id=?`).all(b.id)).reduce((n,r)=>n+BigInt(r.amount_cents),0n);
  if(paid+BigInt(share)>adjusted)fail(409,'INSURANCE_PATIENT_BUDGET','患者付款用途不能超过医保正式分摊后的患者承担额');
 }
 if(db.prepare(`SELECT o.id FROM payment_order o JOIN patient_payment p ON p.id=o.patient_payment_id LEFT JOIN bill b ON b.id=o.bill_id WHERE o.status='已成功' AND (p.status<>'到账已确认' OR p.net_cents<>o.amount_cents OR p.channel<>o.channel OR p.external_reference<>o.external_reference OR p.patient_funds_id<>o.patient_funds_id OR (o.bill_id IS NOT NULL AND (b.id IS NULL OR b.patient_funds_id<>o.patient_funds_id)))`).get())fail(409,'PAYMENT_ORDER_SOURCE','支付成功结果与患者原款不一致');
}
module.exports={feeDigest,insuranceShare,paymentGate,feeChangeGate,validateSettlements};
