'use strict';
const {fail,row,day}=require('./common');
const ACTIVE=['已出具','已接受','部分接受'];
function decisionAt(db,itemId,at){return db.prepare('SELECT * FROM quote_decision WHERE quote_item_id=? AND decided_at<=? AND created_at<=? ORDER BY decided_at DESC,id DESC LIMIT 1').get(itemId,at,at);}
function money(unit,quantity){const amount=BigInt(unit)*BigInt(quantity);if(amount>BigInt(Number.MAX_SAFE_INTEGER))fail(422,'MONEY_RANGE','报价金额超出安全整数分范围');return Number(amount);}
function activeVersion(db,quoteId){return db.prepare('SELECT * FROM quote_version WHERE quote_id=? AND issued_at IS NOT NULL ORDER BY version_no DESC LIMIT 1').get(quoteId);}
function paymentQuote(db,quoteId,patientId,now){
 if(quoteId==null)return null;
 const q=row(db,'treatment_quote',quoteId),v=activeVersion(db,q.id);
 if(q.patient_id!==patientId)fail(409,'QUOTE_PATIENT','报价与实际付款必须属于同一患者');
 if(!v||!ACTIVE.includes(v.status)||day(now)<v.valid_from||day(now)>v.valid_until&&!['已接受','部分接受'].includes(v.status))fail(409,'QUOTE_NOT_CURRENT','请核对当前已出具的有效报价或已接受范围，再登记预付款意向');
 return q.id;
}
// A price disagreement holds the charge, while preserving the clinician's actual work.
function assessExecution(db,source,price,now,{forPricing=false}={}){
 let item=null;
 if(source.quoteItemId!=null){item=row(db,'quote_item',source.quoteItemId);}
 else if(source.planItemId){
  const candidates=db.prepare(`SELECT i.* FROM quote_item i JOIN quote_version v ON v.id=i.quote_version_id JOIN treatment_quote q ON q.id=v.quote_id WHERE i.plan_item_id=? AND q.patient_id=? AND v.issued_at IS NOT NULL AND v.id=(SELECT n.id FROM quote_version n WHERE n.quote_id=q.id AND n.issued_at IS NOT NULL ORDER BY n.version_no DESC LIMIT 1)`).all(source.planItemId,source.patientId);
  const matching=candidates.filter(i=>i.service_id===source.serviceId&&i.tooth_code===(source.toothCode||null)&&i.surface_code===(source.surfaceCode||null));
  if(matching.length===1)item=matching[0];
  else if(candidates.length)return {quoteItemId:null,hold:'原方案已有报价，请明确本次实际项目对应的报价范围并核对患者费用决定'};
 }
 if(!item)return {quoteItemId:null,hold:null};
 const v=row(db,'quote_version',item.quote_version_id),q=row(db,'treatment_quote',v.quote_id);
 if(q.patient_id!==source.patientId||item.service_id!==source.serviceId||item.plan_item_id!==(source.planItemId||null)||item.tooth_code!==(source.toothCode||null)||item.surface_code!==(source.surfaceCode||null))fail(409,'QUOTE_SCOPE','实际项目与报价的患者、原方案项目、收费项目或牙位牙面不一致');
 const hold=message=>({quoteItemId:item.id,hold:message});
 if(!v.issued_at)fail(409,'QUOTE_NOT_ISSUED','报价草稿不能关联实际费用，请选择已出具报价或先核对实际项目来源');
 if(v.id!==activeVersion(db,q.id)?.id||!ACTIVE.includes(v.status))return hold('原报价已撤回或被替代，请核实费用约定后核价');
 const at=forPricing?now:source.at,decision=decisionAt(db,item.id,at),current=decisionAt(db,item.id,now);
 if(v.issued_at>at||decision?.decision_type!=='接受'||current?.decision_type!=='接受')return hold('缺少有效的患者逐项费用接受记录，请说明并核实费用约定后核价');
 // Corrections retain the original charge link, so follow its clinical chain to the effective leaf.
 const used=db.prepare(`WITH RECURSIVE chain(id,quantity) AS (SELECT e.id,e.completed_quantity FROM bill_item b JOIN treatment_execution e ON e.id=b.treatment_execution_id WHERE b.quote_item_id=? AND e.id<>? UNION ALL SELECT n.id,n.completed_quantity FROM treatment_execution n JOIN chain c ON n.original_execution_id=c.id) SELECT c.quantity FROM chain c WHERE NOT EXISTS(SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=c.id)`).all(item.id,source.executionId||-1).reduce((n,e)=>n+BigInt(e.quantity),0n);
 if(used+BigInt(source.quantity)>BigInt(item.quantity))return hold('实际累计数量超过患者已接受的报价范围，请说明并重新报价');
 if(!price||price.unit_price_cents!==item.unit_price_cents)return hold('实际适用价目与已接受的报价金额不一致，请说明并重新报价后核价');
 return {quoteItemId:item.id,hold:null};
}
module.exports={ACTIVE,decisionAt,money,activeVersion,paymentQuote,assessExecution};
