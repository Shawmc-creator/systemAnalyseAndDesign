'use strict';
const {command}=require('../../tests/helpers/v2-treatment');
// Explicitly fictional examples, only for the existing in-memory demonstration workflow.
function prepareQuoteDemo(a){
 if(a.db.location()!==null)throw new Error('报价演示仅允许内存库');
 const s=a.billing.draft(a.c,command({action:'service',name:'后续治疗项目（报价隔离演示）',billingUnit:'次',reason:'虚构演示项目，不是诊所正式价目'}));a.price(s.id,{unitPriceCents:20000});
 const p=a.draft([{description:'46牙后续治疗（虚构演示）',toothCode:'46',surfaceCode:'O',quantity:2,estimatedCents:40000},{description:'45牙后续治疗（虚构演示）',toothCode:'45',surfaceCode:'O',quantity:1,estimatedCents:20000}]);a.publish(p.id);
 const lines=a.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(p.id),v=a.quotes.prepare(a.d,command({action:'create',patientId:1,visitId:a.v.id,sourcePlanVersionId:p.id,reason:'虚构患者后续治疗费用说明',items:lines.map(i=>({planItemId:i.id,serviceId:s.id,toothCode:i.tooth_code,surfaceCode:i.surface_code,quantity:i.planned_quantity,scopeNote:'含所列项目操作；不含其他牙位、材料升级及其他疗程（虚构演示）'}))}));
 let q=a.quotes.query(a.c).quotes.find(q=>q.versions.some(x=>x.id===v.id)),version=q.versions[0];const price=a.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用'").get(s.id);
 a.quotes.issue(a.c,command({versionId:v.id,expectedRevision:version.revision,expectedQuoteRevision:q.revision,validFrom:'2026-10-19',validUntil:'2026-11-18',prices:version.items.map(i=>({itemId:i.id,priceId:price.id})),reason:'演示核价出具；患者尚未作出费用决定'}));
 return a.quotes.query(a.c).quotes.find(h=>h.id===q.id);
}
module.exports={prepareQuoteDemo};
