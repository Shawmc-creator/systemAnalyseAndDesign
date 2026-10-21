'use strict';
const {fail,text,instant,dateOnly,day,row,revision,insert,fact,recordNo,canonical}=require('./common');
const {safe}=require('./billing');
const {feeDigest,paymentGate}=require('./settlement-rules');
const {policyState,requireActive}=require('./insurance-policy');
class Insurance{
 constructor(db,unit,billing,policy,simulation=false){Object.assign(this,{db,unit,billing,policy,simulation});}
 state(){return policyState(this.policy,this.unit.auth.now(),this.simulation);}
 active(ctx,now){const s=requireActive(this.policy,now,this.simulation);ctx.authority.insurance={institutionCode:s.institutionCode,mode:s.mode,verificationBasis:this.policy.verificationBasis};return s;}
 result(kind,key,before){return {kind,key,revision:row(this.db,kind,key).revision,beforeRevision:before,reason:'核对医保原业务号、原费用及实际平台结果；与患者现金收付分别记录'};}
 update(table,item,values,now){const keys=Object.keys(values);this.db.prepare(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')},updated_at=?,revision=revision+1 WHERE id=?`).run(...Object.values(values),now,item.id);return this.result(table,item.id,item.revision);}
 evidence(input){return text(input.evidence,'官方平台原单、身份及结果核实依据',4000);}
 time(value,now,label){const at=instant(value,label);if(at>now)fail(422,'INSURANCE_TIME',label+'不能在未来');return at;}
 splits(input,total,prefix=''){
  const fund=this.billing.amount(input[prefix+'fundCents'],true),account=this.billing.amount(input[prefix+'accountCents'],true),patient=this.billing.amount(input[prefix+'patientCents'],true);
  if(BigInt(fund)+BigInt(account)+BigInt(patient)!==BigInt(total))fail(422,'INSURANCE_SPLIT','基金、个账及患者其他自付合计必须等于本次原费用');return {fund,account,patient};
 }
 identity(credentials,input){return this.unit.command(credentials,'insurance.identity',input,(ctx,now)=>{
  this.active(ctx,now);row(this.db,'patient',input.patientId);if(!['passed','failed'].includes(input.outcome))fail(422,'INSURANCE_IDENTITY_RESULT','须如实记录身份核验结果');
  const verified=this.time(input.verifiedAt,now,'实际核验时间'),until=instant(input.validUntil,'核验适用截止');if(until<=verified)fail(422,'INSURANCE_VALIDITY','核验截止须晚于核验时间');
  const key=insert(this.db,'insurance_identity',fact(now,{patient_id:input.patientId,insured_person_no:text(input.personNo,'医保人员编号',100),insured_area:text(input.area,'参保地区',100),verified_at:verified,valid_until:until,status:input.outcome==='passed'?'核验通过':'核验未通过',result_note:this.evidence(input),operator_id:ctx.session.staff_id}));return this.result('insurance_identity',key);
 });}
 mapping(credentials,input){return this.unit.command(credentials,'insurance.manage',input,(ctx,now)=>{
  this.active(ctx,now);
  if(input.action==='stop'){const m=row(this.db,'insurance_item_mapping',input.mappingId);revision(m,input.expectedRevision);if(m.status!=='有效')fail(409,'INSURANCE_MAPPING_STOPPED','原对应已停用');return this.update('insurance_item_mapping',m,{status:'停用',basis:m.basis+'\n停用依据：'+this.evidence(input)},now);}
  if(input.action!=='create')fail(422,'INVALID_ACTION','项目对应操作无效');
  const service=input.serviceId==null?null:row(this.db,'service',input.serviceId),material=input.materialId==null?null:row(this.db,'material',input.materialId);
  if(!!service===!!material)fail(422,'INSURANCE_MAPPING_SOURCE','请选择一个收费项目或药品来源');
  const from=dateOnly(input.validFrom),until=input.validUntil?dateOnly(input.validUntil):null;if(until&&until<=from)fail(422,'INSURANCE_VALIDITY','对应结束须晚于开始日期');
  const key=insert(this.db,'insurance_item_mapping',fact(now,{service_id:service?.id||null,material_id:material?.id||null,insurance_code:text(input.code,'适用医保项目编码',100),insured_area:text(input.area,'适用地区',100),valid_from:from,valid_until:until,status:'有效',basis:this.evidence(input),operator_id:ctx.session.staff_id}));return this.result('insurance_item_mapping',key);
 });}
 register(credentials,input){return this.unit.command(credentials,'insurance.identity',input,(ctx,now)=>{
  const state=this.active(ctx,now),visit=row(this.db,'visit',input.visitId);if(visit.patient_id!==input.patientId)fail(409,'PATIENT_MISMATCH','就诊与指定患者不一致');
  const bill=input.billId==null?null:row(this.db,'bill',input.billId),identity=input.identityId==null?null:row(this.db,'insurance_identity',input.identityId);
  if(bill&&bill.patient_id!==input.patientId||identity&&identity.patient_id!==input.patientId)fail(409,'PATIENT_MISMATCH','医保办理的身份、账单及患者须一致');
  if(this.db.prepare("SELECT id FROM insurance_case WHERE visit_id=? AND status<>'已撤销'").get(visit.id))fail(409,'INSURANCE_CASE_EXISTS','当次就诊已有未结束医保办理，请回查原单');
  const key=insert(this.db,'insurance_case',fact(now,{patient_id:input.patientId,visit_id:visit.id,bill_id:bill?.id||null,identity_id:identity?.id||null,business_no:recordNo('INS'),fee_revision:null,patient_choice:'待确认',patient_confirmed_at:null,institution_code:state.institutionCode,diagnosis_code:null,estimated_fund_cents:null,estimated_account_cents:null,estimated_patient_cents:null,status:identity?.status==='核验通过'?'待预结算':'待核验',result_note:this.evidence(input),fee_digest:null,pre_valid_until:null,pre_reference:null,operator_id:ctx.session.staff_id}));return this.result('insurance_case',key);
 });}
 prepare(credentials,input){return this.unit.command(credentials,'insurance.prepare',input,(ctx,now)=>{
  const state=this.active(ctx,now),c=row(this.db,'insurance_case',input.caseId);revision(c,input.expectedRevision);
  if(!['待核验','待预结算'].includes(c.status))fail(409,'INSURANCE_CASE_STATE','仅未完成预结算的原办理可以上传费用；变化后请结束原办理并重新登记');
  if(c.institution_code!==state.institutionCode)fail(409,'INSURANCE_INSTITUTION','机构编码已变，须核实原办理');
  const bill=row(this.db,'bill',input.billId),identity=row(this.db,'insurance_identity',input.identityId);revision(bill,input.expectedBillRevision);
  if(bill.patient_id!==c.patient_id||identity.patient_id!==c.patient_id)fail(409,'PATIENT_MISMATCH','医保身份、就诊、账单须属于同一患者');
  if(identity.status!=='核验通过'||identity.valid_until<=now)fail(409,'INSURANCE_IDENTITY_INVALID','身份核验未通过或已过期，请重新核验');
  if(this.db.prepare("SELECT id FROM payment_order WHERE bill_id=? AND status IN ('待支付','处理中','待核实')").get(bill.id))fail(409,'PAYMENT_ORDER_PENDING','先核实原电子支付再办理医保');
  const summary=this.billing.billSummary(bill.id),lines=this.billing.lines(bill.id);if(!lines.length||summary.pendingPricingCount||summary.receivableCents<=0)fail(409,'INSURANCE_FEES','须有实际项目和明确的正数已核价费用');
  if(summary.allocatedCents||summary.offsetCents)fail(409,'INSURANCE_PATIENT_PAID','原账目已有患者付款用途，须核对费用路径后再办理医保，不能重复分摊');
  const visitIds=new Set();for(const line of lines){const v=line.treatment_execution_id?this.db.prepare('SELECT visit_id FROM treatment_execution WHERE id=?').get(line.treatment_execution_id):this.db.prepare('SELECT p.visit_id FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id JOIN prescription p ON p.id=i.prescription_id WHERE d.id=?').get(line.dispense_record_id);visitIds.add(v.visit_id);}
  if(!visitIds.has(c.visit_id))fail(409,'INSURANCE_BILL_VISIT','原账单不包含本次登记就诊的实际项目');
  for(const v of visitIds){const record=this.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(v);if(!record?.diagnosis||record.status!=='已签署')fail(409,'INSURANCE_DIAGNOSIS','医保预结算前，原费用涉及的每次就诊均须有已签署诊断');}
  if(!Array.isArray(input.items)||input.items.length!==lines.length||new Set(input.items.map(i=>i.billItemId)).size!==lines.length)fail(422,'INSURANCE_FEE_LIST','须逐项核对全部原费用，不能漏项、重复或添加无来源项目');
  const evidence=this.evidence(input),splits=this.splits(input,summary.receivableCents),until=instant(input.validUntil,'预结算有效截止');if(until<=now)fail(422,'INSURANCE_PRE_EXPIRED','预结算已过期');
  for(const line of lines){const selected=input.items.find(i=>i.billItemId===line.id);if(!selected)fail(422,'INSURANCE_FEE_LIST','原费用明细不完整');const mapping=row(this.db,'insurance_item_mapping',selected.mappingId);revision(mapping,selected.expectedRevision);
   const material=line.dispense_record_id?this.db.prepare('SELECT i.material_id FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id WHERE d.id=?').get(line.dispense_record_id).material_id:null;
   if(mapping.status!=='有效'||mapping.insured_area!==identity.insured_area||mapping.valid_from>day(line.completed_at)||(mapping.valid_until&&mapping.valid_until<=day(line.completed_at))||(mapping.material_id?mapping.material_id!==material:mapping.service_id!==line.service_id))fail(409,'INSURANCE_MAPPING_INVALID','项目对应须覆盖原项目、地区与发生日期');
   const adjustments=this.db.prepare('SELECT amount_cents FROM fee_adjustment_item WHERE bill_item_id=?').all(line.id).reduce((n,r)=>n+BigInt(r.amount_cents),BigInt(line.amount_cents));
   insert(this.db,'insurance_fee',fact(now,{insurance_case_id:c.id,bill_item_id:line.id,mapping_id:mapping.id,amount_cents:safe(adjustments),quantity:line.quantity,quantity_scale:line.quantity_scale,uploaded_at:this.time(input.uploadedAt,now,'平台费用上传时间'),result_note:evidence}));
  }
  return this.update('insurance_case',c,{bill_id:bill.id,identity_id:identity.id,fee_revision:bill.revision,diagnosis_code:text(input.diagnosisCode,'核实的诊断编码',100),estimated_fund_cents:splits.fund,estimated_account_cents:splits.account,estimated_patient_cents:splits.patient,fee_digest:feeDigest(this.db,bill.id),pre_valid_until:until,pre_reference:text(input.reference,'平台预结算号',200),status:'预结算完成',result_note:c.result_note+'\n预结算：'+evidence},now);
 });}
 choice(credentials,input){return this.unit.command(credentials,'insurance.prepare',input,(ctx,now)=>{
  this.active(ctx,now);const c=row(this.db,'insurance_case',input.caseId);revision(c,input.expectedRevision);
  if(['结算待核实','已结算','已撤销'].includes(c.status))fail(409,'INSURANCE_CASE_STATE','当前原笔已提交或结束，不能更改患者选择');
  if(!['医保','自费'].includes(input.choice)||input.patientConfirmed!==true)fail(422,'INSURANCE_CHOICE','须说明预估分摊及自费项目，并记录患者真实选择');
  if(input.choice==='医保'&&(c.status!=='预结算完成'||c.pre_valid_until<=now||c.fee_digest!==feeDigest(this.db,c.bill_id)))fail(409,'INSURANCE_PRE_STALE','须取得当前费用的有效预结算，再确认医保办理');
  return this.update('insurance_case',c,{patient_choice:input.choice,patient_confirmed_at:now,...(input.choice==='自费'?{status:'已撤销'}:{}),result_note:c.result_note+'\n患者选择：'+this.evidence(input)},now);
 });}
 settle(credentials,input){return this.unit.command(credentials,'insurance.settle',input,(ctx,now)=>{
  this.active(ctx,now);const c=row(this.db,'insurance_case',input.caseId);revision(c,input.expectedRevision);const evidence=this.evidence(input);
  if(input.businessNo!==c.business_no)fail(409,'INSURANCE_ORIGINAL_ORDER','必须核对当前原医保办理号');
  if(input.action==='submit'){
   if(c.status!=='预结算完成'||c.patient_choice!=='医保'||!c.patient_confirmed_at||c.pre_valid_until<=now||c.fee_digest!==feeDigest(this.db,c.bill_id))fail(409,'INSURANCE_PRE_STALE','正式办理前须有患者已确认的有效预结算及一致原费用');
   const identity=row(this.db,'insurance_identity',c.identity_id);if(identity.valid_until<=now)fail(409,'INSURANCE_IDENTITY_INVALID','身份核验已过期');
   return this.update('insurance_case',c,{status:'结算待核实',result_note:c.result_note+'\n提交原单待查证：'+evidence},now);
  }
  if(input.action!=='verify'||c.status!=='结算待核实')fail(409,'INSURANCE_CASE_STATE','须回查已提交的原医保办理');
  if(!['success','failed','unknown'].includes(input.outcome))fail(422,'INSURANCE_RESULT','医保原单结果无效');
  if(input.outcome==='unknown')return this.update('insurance_case',c,{result_note:c.result_note+'\n仍待核实：'+evidence},now);
  if(input.outcome==='failed')return this.update('insurance_case',c,{status:'预结算完成',result_note:c.result_note+'\n核实未成功：'+evidence},now);
  if(input.patientMatches!==true)fail(422,'INSURANCE_PATIENT_RESULT','须核对官方原单的患者、诊所、费用与本地原单一致');
  const total=this.billing.billSummary(c.bill_id).receivableCents,s=this.splits(input,total),key=insert(this.db,'insurance_settlement',fact(now,{insurance_case_id:c.id,external_reference:text(input.reference,'官方正式结算号',200),total_cents:total,fund_cents:s.fund,account_cents:s.account,patient_due_cents:s.patient,confirmed_at:this.time(input.confirmedAt,now,'实际正式结果核实时间'),status:'有效'}));
  this.update('insurance_case',c,{status:'已结算',result_note:c.result_note+'\n正式结算：'+evidence},now);this.db.prepare('UPDATE bill SET revision=revision+1,updated_at=? WHERE id=?').run(now,c.bill_id);
  return this.result('insurance_settlement',key);
 });}
 reverse(credentials,input){const permission=input.action==='initiate'?'insurance.manage':'insurance.settle';return this.unit.command(credentials,permission,input,(ctx,now)=>{
  this.active(ctx,now);const evidence=this.evidence(input);
  if(input.action==='initiate'){
   const settlement=row(this.db,'insurance_settlement',input.settlementId);revision(settlement,input.expectedRevision);const c=row(this.db,'insurance_case',settlement.insurance_case_id),request=row(this.db,'fee_request',input.requestId);
   if(settlement.status!=='有效'||request.bill_id!==c.bill_id||!['待审核','已同意'].includes(request.status))fail(409,'INSURANCE_REVERSAL_REQUEST','须引用同一原账目的有效费用申请和有效医保结算');
   if(this.db.prepare("SELECT id FROM payment_order WHERE bill_id=? AND status IN ('待支付','处理中','待核实')").get(c.bill_id))fail(409,'PAYMENT_ORDER_PENDING','先核实患者原支付结果再办理医保撤销');
   const key=insert(this.db,'insurance_reversal',fact(now,{settlement_id:settlement.id,fee_request_id:request.id,business_no:recordNo('IRV'),reason:text(input.reason,'原结算撤销及批准依据',2000),external_reference:null,verified_at:null,status:'待办理',result_note:evidence,operator_id:ctx.session.staff_id}));return this.result('insurance_reversal',key);
  }
  if(input.action!=='verify')fail(422,'INVALID_ACTION','撤销操作无效');const r=row(this.db,'insurance_reversal',input.reversalId);revision(r,input.expectedRevision);
  if(!['待办理','待核实'].includes(r.status)||input.businessNo!==r.business_no)fail(409,'INSURANCE_REVERSAL_STATE','请回查未结束的原撤销业务号');
  if(!['success','failed','unknown'].includes(input.outcome))fail(422,'INSURANCE_RESULT','撤销结果无效');
  if(input.outcome==='success'){
   if(input.patientMatches!==true)fail(422,'INSURANCE_PATIENT_RESULT','须核实原结算及撤销对象、机构一致');
   const s=row(this.db,'insurance_settlement',r.settlement_id),c=row(this.db,'insurance_case',s.insurance_case_id);this.update('insurance_settlement',s,{status:'已撤销'},now);this.update('insurance_case',c,{status:'已撤销',result_note:c.result_note+'\n原医保已撤销：'+evidence},now);this.db.prepare('UPDATE bill SET revision=revision+1,updated_at=? WHERE id=?').run(now,c.bill_id);
  }
  return this.update('insurance_reversal',r,{status:input.outcome==='success'?'已成功':input.outcome==='failed'?'已失败':'待核实',external_reference:input.outcome==='success'?text(input.reference,'官方撤销结果号',200):null,verified_at:input.outcome==='unknown'?null:now,result_note:r.result_note+'\n核实结果：'+evidence},now);
 });}
 receipt(credentials,input){return this.unit.command(credentials,'insurance.receipt',input,(ctx,now)=>{
  this.active(ctx,now);const s=row(this.db,'insurance_settlement',input.settlementId);revision(s,input.expectedRevision);const amount=this.billing.amount(input.amountCents),old=this.db.prepare('SELECT flow_type,amount_cents FROM insurance_fund_receipt WHERE settlement_id=?').all(s.id).reduce((n,r)=>n+BigInt(r.flow_type==='拨付'?r.amount_cents:-r.amount_cents),0n),share=BigInt(s.fund_cents)+BigInt(s.account_cents);
  if(!['拨付','退回'].includes(input.flowType)||input.flowType==='拨付'&&(s.status!=='有效'||old+BigInt(amount)>share)||input.flowType==='退回'&&(s.status!=='已撤销'||BigInt(amount)>old))fail(409,'INSURANCE_RECEIPT_BUDGET','实际拨付不能超未回款，撤销后实际退回不能超已收到原医保款');
  const key=insert(this.db,'insurance_fund_receipt',fact(now,{settlement_id:s.id,flow_type:input.flowType,amount_cents:amount,occurred_at:this.time(input.occurredAt,now,'实际医保收付时间'),evidence_reference:text(input.reference,'医保或银行唯一收付凭据',200),operator_id:ctx.session.staff_id}));ctx.authority.evidence=this.evidence(input);return this.result('insurance_fund_receipt',key);
 });}
 query(credentials,input={}){return this.unit.query(credentials,'insurance.query',()=>{
  const patientId=input.patientId?Number(input.patientId):null;if(patientId)row(this.db,'patient',patientId);
  const cases=this.db.prepare(`SELECT c.*,p.name patient_name,p.record_no patient_no,b.record_no bill_no FROM insurance_case c JOIN patient p ON p.id=c.patient_id LEFT JOIN bill b ON b.id=c.bill_id WHERE (? IS NULL OR c.patient_id=?) ORDER BY c.id DESC LIMIT 200`).all(patientId,patientId).map(c=>({...c,preValid:c.status==='预结算完成'&&c.pre_valid_until>this.unit.auth.now()&&c.fee_digest===feeDigest(this.db,c.bill_id),...(credentials.role==='frontdesk'?{}:{fees:this.db.prepare('SELECT f.*,m.insurance_code FROM insurance_fee f JOIN insurance_item_mapping m ON m.id=f.mapping_id WHERE f.insurance_case_id=?').all(c.id),settlement:this.db.prepare('SELECT * FROM insurance_settlement WHERE insurance_case_id=?').get(c.id)||null})}));
  const identities=this.db.prepare('SELECT i.*,p.name patient_name,p.record_no patient_no FROM insurance_identity i JOIN patient p ON p.id=i.patient_id WHERE (? IS NULL OR i.patient_id=?) ORDER BY i.id DESC LIMIT 200').all(patientId,patientId).map(i=>({...i,insured_person_no:'****'+i.insured_person_no.slice(-4)}));
  const basic={policy:this.state(),cases,identities,patients:this.db.prepare('SELECT id,name,record_no FROM patient ORDER BY id DESC LIMIT 500').all(),visits:this.db.prepare('SELECT id,patient_id,arrived_at FROM visit ORDER BY id DESC LIMIT 500').all()};
  if(credentials.role==='frontdesk')return {...basic,cases:cases.map(c=>({id:c.id,revision:c.revision,patient_id:c.patient_id,patient_name:c.patient_name,patient_no:c.patient_no,visit_id:c.visit_id,status:c.status,business_no:c.business_no,patient_choice:c.patient_choice}))};
  return {...basic,mappings:this.db.prepare('SELECT * FROM insurance_item_mapping ORDER BY id DESC').all(),services:this.db.prepare('SELECT id,name FROM service WHERE is_active=1').all(),materials:this.db.prepare('SELECT id,name FROM material').all(),bills:this.db.prepare('SELECT b.*,p.name patient_name FROM bill b JOIN patient p ON p.id=b.patient_id WHERE (? IS NULL OR b.patient_id=?) ORDER BY b.id DESC LIMIT 200').all(patientId,patientId).map(b=>({...b,summary:this.billing.billSummary(b.id),items:this.billing.lines(b.id)})),reversals:this.db.prepare('SELECT * FROM insurance_reversal ORDER BY id DESC LIMIT 200').all(),receipts:this.db.prepare('SELECT * FROM insurance_fund_receipt ORDER BY id DESC LIMIT 200').all(),requests:this.db.prepare("SELECT id,bill_id,status,reason FROM fee_request WHERE status IN ('待审核','已同意') ORDER BY id DESC LIMIT 200").all()};
 });}
}
module.exports={Insurance};
