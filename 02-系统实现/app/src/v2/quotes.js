'use strict';
const {fail,text,id,instant,dateOnly,day,insert,fact,row,revision,recordNo}=require('./common');
const {QuoteRepository}=require('./quote-repository');
const {ACTIVE,decisionAt,money}=require('./quote-rules');
const {toothFields}=require('./treatment');
class Quotes{
 constructor(db,unit,clinical,billing){Object.assign(this,{db,unit,clinical,billing});this.repo=new QuoteRepository(db);}
 access(ctx,q,operation='read'){
  ctx.authority.patientId=q.patient_id;ctx.authority.quoteId=q.id;
  // UnitOfWork has already authorized the requested, currently qualified role.
  if(ctx.selectedRole==='cashier')return;
  if(q.created_by===ctx.session.staff_id)return;
  const v=this.repo.latest(q.id);if(v?.source_plan_version_id){const p=row(this.db,'plan_version',v.source_plan_version_id);this.clinical.scope(ctx,p.source_visit_id,operation);return;}
  fail(403,'QUOTE_SCOPE_ACCESS','当前牙医不在这份报价的编制或明确交接范围内');
 }
 source(ctx,patientId,versionId,visitId,head=null){
  if(versionId==null){
   if(head?.treatment_plan_id)fail(409,'QUOTE_SOURCE','原报价已关联治疗方案，改版须选择同一方案的明确版本');
   const visit=this.clinical.scope(ctx,id(visitId,'来源就诊'),'plan');if(visit.patient_id!==patientId)fail(409,'QUOTE_PATIENT','来源就诊与患者不一致');return {planId:null,versionId:null};
  }
  const v=row(this.db,'plan_version',versionId),p=row(this.db,'treatment_plan',v.treatment_plan_id);this.clinical.scope(ctx,v.source_visit_id,'plan');
  if(p.patient_id!==patientId||head&&head.treatment_plan_id!==p.id)fail(409,'QUOTE_PATIENT','报价须引用同一患者、同一原方案的明确版本');
  if(!['待确认','已确认'].includes(v.status)||p.status!=='进行中'||this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(p.id).id!==v.id)fail(409,'QUOTE_SOURCE','请选择已经说明且当前有效的最新治疗方案版本');
  return {planId:p.id,versionId:v.id};
 }
 saveItems(v,items,ctx,now){
  if(!Array.isArray(items)||items.length===0||items.length>100)fail(422,'QUOTE_ITEMS','报价须明确1至100项实际项目');
  const scopes=new Set();let total=0n;
  this.db.prepare('DELETE FROM quote_item WHERE quote_version_id=?').run(v.id);
  for(const [index,input]of items.entries()){
   const s=row(this.db,'service',input.serviceId);if(!s.is_active)fail(409,'SERVICE_DISABLED','停用项目不能编入新报价');
   const quantity=id(input.quantity,'报价数量'),teeth=toothFields(input),planId=input.planItemId==null?null:id(input.planItemId);
   if(v.source_plan_version_id){
    const p=row(this.db,'plan_item',planId);if(p.plan_version_id!==v.source_plan_version_id||p.tooth_code!==teeth.tooth_code||p.surface_code!==teeth.surface_code||quantity>p.planned_quantity)fail(409,'QUOTE_SOURCE','项目、牙位牙面或数量不符合本报价引用的原方案版本');
    if(scopes.has(planId))fail(422,'QUOTE_DUPLICATE_SCOPE','同一原方案项目请合并在一行报价，避免重复计算范围');scopes.add(planId);
   }else if(planId!==null)fail(409,'QUOTE_SOURCE','独立检查报价不能混入其他治疗方案项目');
   // Unknown prices remain NULL until the cashier explicitly chooses an approved price at issue time.
   insert(this.db,'quote_item',fact(now,{quote_version_id:v.id,plan_item_id:planId,service_id:s.id,service_price_id:null,description_snapshot:s.name,...teeth,quantity,billing_unit_snapshot:s.billing_unit,unit_price_cents:null,amount_cents:null,scope_note:text(input.scopeNote,'包含及不包含的范围、材料或疗程说明',2000),sequence_no:index+1}));
   total+=BigInt(quantity);if(total>BigInt(Number.MAX_SAFE_INTEGER))fail(422,'QUOTE_QUANTITY','报价数量汇总过大');
  }
 }
 prepare(credentials,input){return this.unit.command(credentials,'quote.prepare',input,(ctx,now)=>{
  const action=input.action,reason=text(input.reason,'编制或改版依据',2000);
  if(action==='create'){
   const patient=row(this.db,'patient',input.patientId),s=this.source(ctx,patient.id,input.sourcePlanVersionId,input.visitId);
   const key=insert(this.db,'treatment_quote',fact(now,{patient_id:patient.id,treatment_plan_id:s.planId,record_no:recordNo('QUOTE'),created_by:ctx.session.staff_id}));
   const v=insert(this.db,'quote_version',fact(now,{quote_id:key,source_plan_version_id:s.versionId,version_no:1,previous_version_id:null,valid_from:null,valid_until:null,status:'草稿',issued_at:null,issued_by:null,change_reason:reason,created_by:ctx.session.staff_id}));
   this.saveItems(this.repo.version(v),input.items,ctx,now);ctx.authority.quoteId=key;ctx.authority.patientId=patient.id;
   return {kind:'quote_version',key:v,revision:1,reason};
  }
  const v=this.repo.version(input.versionId),q=this.repo.head(v.quote_id);this.access(ctx,q,'plan');revision(v,input.expectedRevision);revision(q,input.expectedQuoteRevision);
  if(action==='edit'){
   if(v.status!=='草稿')fail(409,'QUOTE_FROZEN','已出具报价请建立新版本');
   const sourceId=input.sourcePlanVersionId===undefined?v.source_plan_version_id:input.sourcePlanVersionId;
   if(sourceId||q.treatment_plan_id)this.source(ctx,q.patient_id,sourceId,input.visitId,q);
   this.db.prepare('UPDATE quote_version SET source_plan_version_id=? WHERE id=?').run(sourceId,v.id);
   this.saveItems(this.repo.version(v.id),input.items,ctx,now);this.db.prepare('UPDATE quote_version SET change_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(reason,now,v.id);this.repo.touch(q.id,now);
   return {kind:'quote_version',key:v.id,beforeRevision:v.revision,revision:v.revision+1,reason};
  }
  if(action!=='revise')fail(422,'INVALID_ACTION','报价编制动作无效');
  if(v.status==='草稿'||this.repo.latest(q.id).id!==v.id)fail(409,'QUOTE_REVISION','请从最新已出具版本改版；已有草稿请继续编制');
  const s=this.source(ctx,q.patient_id,input.sourcePlanVersionId??v.source_plan_version_id,input.visitId,q);
  const key=insert(this.db,'quote_version',fact(now,{quote_id:q.id,source_plan_version_id:s.versionId,version_no:v.version_no+1,previous_version_id:v.id,valid_from:null,valid_until:null,status:'草稿',issued_at:null,issued_by:null,change_reason:reason,created_by:ctx.session.staff_id}));
  const items=input.items||this.repo.items(v.id).map(i=>({planItemId:i.plan_item_id,serviceId:i.service_id,toothCode:i.tooth_code,surfaceCode:i.surface_code,quantity:i.quantity,scopeNote:i.scope_note}));
  this.saveItems(this.repo.version(key),items,ctx,now);this.repo.touch(q.id,now);
  return {kind:'quote_version',key,revision:1,reason};
 });}
 issue(credentials,input){return this.unit.command(credentials,'quote.issue',input,(ctx,now)=>{
  const v=this.repo.version(input.versionId),q=this.repo.head(v.quote_id);revision(v,input.expectedRevision);revision(q,input.expectedQuoteRevision);
  if(v.status!=='草稿'||this.repo.latest(q.id).id!==v.id)fail(409,'QUOTE_FROZEN','只能核价出具最新的报价草稿');
  const start=dateOnly(input.validFrom,'报价生效日期'),end=dateOnly(input.validUntil,'患者接受截止日期');
  if(end<start||day(now)<start||day(now)>end)fail(422,'QUOTE_VALIDITY','生效日不得晚于出具日，接受截止日不得早于出具日');
  if(v.source_plan_version_id){const pv=row(this.db,'plan_version',v.source_plan_version_id),p=row(this.db,'treatment_plan',pv.treatment_plan_id);if(p.patient_id!==q.patient_id||p.id!==q.treatment_plan_id||!['待确认','已确认'].includes(pv.status)||p.status!=='进行中'||this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(p.id).id!==pv.id)fail(409,'QUOTE_SOURCE','原方案已变化，请由牙医核实后重新编制报价');}
  const items=this.repo.items(v.id);if(!items.length||!Array.isArray(input.prices)||input.prices.length!==items.length||new Set(input.prices.map(p=>p.itemId)).size!==items.length)fail(422,'QUOTE_PRICES','须逐项明确已批准的适用价目，不能遗漏或重复');
  let total=0n;
  for(const i of items){
   const choice=input.prices.find(p=>p.itemId===i.id);if(!choice)fail(422,'QUOTE_PRICES','价目与本版报价项目不一致');
   const p=row(this.db,'service_price',choice.priceId),s=row(this.db,'service',i.service_id);
   if(!s.is_active||p.service_id!==i.service_id||p.status!=='已确认可适用'||p.valid_from>now||p.valid_until&&p.valid_until<=now)fail(409,'QUOTE_PRICE','请选择出具时本项目已批准且有效的价目');
   const amount=money(p.unit_price_cents,i.quantity);total+=BigInt(amount);if(total>BigInt(Number.MAX_SAFE_INTEGER))fail(422,'MONEY_RANGE','报价合计金额超出安全整数分范围');
   this.db.prepare('UPDATE quote_item SET service_price_id=?,description_snapshot=?,billing_unit_snapshot=?,unit_price_cents=?,amount_cents=?,updated_at=?,revision=revision+1 WHERE id=?').run(p.id,s.name,s.billing_unit,p.unit_price_cents,amount,now,i.id);
  }
  const old=this.repo.issued(q.id);
  if(old)this.db.prepare("UPDATE quote_version SET status='已替代',updated_at=?,revision=revision+1 WHERE id=?").run(now,old.id);
  this.db.prepare("UPDATE quote_version SET valid_from=?,valid_until=?,status='已出具',issued_at=?,issued_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(start,end,now,ctx.session.staff_id,now,v.id);this.repo.touch(q.id,now);ctx.authority.quoteId=q.id;ctx.authority.patientId=q.patient_id;
  return {kind:'quote_version',key:v.id,beforeRevision:v.revision,revision:v.revision+1,reason:text(input.reason,'核价出具依据',2000)};
 });}
 decide(credentials,input){return this.unit.command(credentials,'quote.decide',input,(ctx,now)=>{
  ctx.selectedRole=credentials.role;
  const v=this.repo.version(input.versionId),q=this.repo.head(v.quote_id);this.access(ctx,q);revision(v,input.expectedRevision);revision(q,input.expectedQuoteRevision);
  if(!v.issued_at||this.repo.issued(q.id)?.id!==v.id||!ACTIVE.includes(v.status))fail(409,'QUOTE_NOT_CURRENT','仅当前已出具且未终结的版本可登记新决定');
  if(!['接受','暂缓','拒绝','撤回'].includes(input.decision))fail(422,'QUOTE_DECISION','请选择患者的实际费用决定');
  const at=instant(input.decidedAt,'患者实际决定时间'),basis=text(input.confirmationBasis,'患者实际决定及说明依据',4000);
  if(at<v.issued_at||at>now)fail(422,'QUOTE_DECISION_TIME','决定须发生在出具后且不能在未来');
  if(input.decision==='接受'&&(day(now)>v.valid_until||day(now)<v.valid_from||day(at)<v.valid_from||day(at)>v.valid_until))fail(409,'QUOTE_EXPIRED','已过接受有效期，请重新出具报价；不能倒填接受');
  const items=this.repo.items(v.id),selected=input.itemIds;
  if(!Array.isArray(selected)||!selected.length||selected.length>items.length||new Set(selected).size!==selected.length||selected.some(n=>!items.some(i=>i.id===n)))fail(422,'QUOTE_DECISION_ITEMS','请明确选择本版患者实际作出决定的项目');
  for(const itemId of selected){const old=decisionAt(this.db,itemId,now);if(old&&(at<old.decided_at||old.decision_type===input.decision))fail(409,'QUOTE_DECISION_ORDER','原项目已有相同决定或更晚决定，请核对原记录');insert(this.db,'quote_decision',{quote_item_id:itemId,decision_type:input.decision,decided_at:at,confirmation_basis:basis,recorded_by:ctx.session.staff_id,created_at:now});}
  const decisions=items.map(i=>decisionAt(this.db,i.id,now)?.decision_type),n=decisions.filter(d=>d==='接受').length;
  const status=n===items.length?'已接受':n?'部分接受':decisions.every(d=>d==='拒绝')?'已拒绝':decisions.every(d=>d==='撤回')?'已撤回':'已出具';
  this.db.prepare('UPDATE quote_version SET status=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,now,v.id);this.repo.touch(q.id,now);ctx.authority.quoteItemIds=selected;
  return {kind:'quote_version',key:v.id,beforeRevision:v.revision,revision:v.revision+1,reason:'如实追加患者逐项费用决定，不替代医疗知情同意'};
 });}
 query(credentials,input={}){return this.unit.query(credentials,'quote.read',ctx=>{
  ctx.selectedRole=credentials.role;
  const now=this.unit.auth.now(),filter=input.patientId?Number(input.patientId):null,quoteId=input.quoteId?Number(input.quoteId):null;
  if(filter!==null)id(filter);if(quoteId!==null)id(quoteId);
  const heads=this.db.prepare(`SELECT q.*,p.name patient_name,p.record_no patient_no FROM treatment_quote q JOIN patient p ON p.id=q.patient_id WHERE (? IS NULL OR q.patient_id=?) AND (? IS NULL OR q.id=?) ORDER BY q.id DESC LIMIT 200`).all(filter,filter,quoteId,quoteId).filter(q=>{try{this.access(ctx,q);return true;}catch(e){if(e.status===403)return false;throw e;}});
  if(quoteId&&!heads.length)fail(403,'QUOTE_SCOPE_ACCESS','不能查看当前报价');
  const quotes=heads.map(q=>({...q,versions:this.repo.versions(q.id).map(v=>({...v,effectiveStatus:ACTIVE.includes(v.status)&&!['已接受','部分接受'].includes(v.status)&&day(now)>v.valid_until?'已到期':v.status,items:this.repo.items(v.id).map(i=>({...i,decisions:this.repo.decisions(i.id),latestDecision:decisionAt(this.db,i.id,now)||null}))})),payments:this.db.prepare('SELECT id,record_no,net_cents,status,received_at FROM patient_payment WHERE quote_id=? ORDER BY id').all(q.id),charges:this.db.prepare('SELECT b.id,b.bill_id,b.quote_item_id,b.pricing_status,b.amount_cents,b.pricing_note FROM bill_item b JOIN quote_item i ON i.id=b.quote_item_id JOIN quote_version v ON v.id=i.quote_version_id WHERE v.quote_id=? ORDER BY b.id').all(q.id),...(credentials.role==='cashier'?{funds:this.billing.fundsSummary(q.patient_id)}:{})}));
  const visits=credentials.role==='dentist'?this.db.prepare(`SELECT v.id,v.patient_id,v.status,p.name patient_name,p.record_no patient_no FROM visit v JOIN patient p ON p.id=v.patient_id WHERE v.dentist_id=? ORDER BY v.id DESC LIMIT 200`).all(ctx.session.staff_id):[];
  const plans=credentials.role==='dentist'?this.db.prepare(`SELECT v.id,v.treatment_plan_id,v.version_no,v.source_visit_id,p.patient_id,p.goal FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE p.status='进行中' AND v.status IN ('待确认','已确认') AND v.id=(SELECT n.id FROM plan_version n WHERE n.treatment_plan_id=p.id ORDER BY version_no DESC LIMIT 1) ORDER BY v.id DESC LIMIT 200`).all().filter(v=>{try{this.clinical.scope(ctx,v.source_visit_id,'plan');return true;}catch(e){if(e.status===403)return false;throw e;}}).map(v=>({...v,items:this.db.prepare('SELECT id,item_description description,tooth_code,surface_code,planned_quantity FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(v.id)})):[];
  return {quotes,visits,plans,services:this.db.prepare('SELECT id,name,billing_unit,category,is_active FROM service ORDER BY id').all(),prices:this.db.prepare("SELECT id,service_id,unit_price_cents,valid_from,valid_until FROM service_price WHERE status='已确认可适用' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY id").all(now,now),now,businessDate:day(now)};
 });}
}
module.exports={Quotes};
