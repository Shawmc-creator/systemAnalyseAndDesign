'use strict';
const {fail,text,id,canonical,hash,insert,fact,recordNo,row,revision}=require('./common');
const {integer}=require('./inventory-gates');
const {dateOnly,day,utc,instant}=require('./common');
const optionalGuidance=value=>value==null||typeof value==='string'&&!value.trim()?null:text(value,'用药指导及注意事项',4000);
function payload(db,p){
 return {id:p.id,recordNo:p.record_no,patientId:p.patient_id,patientName:p.patient_name,patientNo:p.patient_no,birthDate:p.birth_date,prescriberId:p.prescriber_id,prescriberName:p.prescriber_name,
  visitId:p.visit_id,clinicalRecordId:p.clinical_record_id,route:p.collection_route,diagnosis:p.diagnosis,guidance:p.guidance_note,healthReviewId:p.health_review_id,issuedAt:p.issued_at,
  ...(p.original_prescription_id?{originalPrescriptionId:p.original_prescription_id}:{}),items:db.prepare('SELECT id,material_id,drug_name,directions,quantity_scaled,unit,quantity_scale,service_price_id,sequence_no'+(p.collection_route==='院内'?',billing_service_id':'')+' FROM prescription_item WHERE prescription_id=? ORDER BY sequence_no').all(p.id)};
}
function validatePrescriptions(db){
 if(db.prepare("SELECT p.id FROM prescription p LEFT JOIN health_review h ON h.id=p.health_review_id WHERE p.status<>'草稿' AND (h.id IS NULL OR h.visit_id<>p.visit_id)").get())fail(409,'PRESCRIPTION_CONTEXT','处方健康复核依据须属于同一次就诊');
 for(const p of db.prepare("SELECT * FROM prescription WHERE status<>'草稿'").all())if(hash(canonical(payload(db,p)))!==p.content_hash)fail(409,'PRESCRIPTION_SEALED','处方开立正文或明细发生变化，已拒绝提交');
}
class Prescriptions{
 constructor(db,unit,clinical){Object.assign(this,{db,unit,clinical});}
 context(ctx,input,active=false){
  const visit=active?this.clinical.active(ctx,id(Number(input.visitId)),'prescribe'):this.clinical.scope(ctx,id(Number(input.visitId)));
  if(visit.patient_id!==Number(input.patientId))fail(409,'PATIENT_MISMATCH','患者与所选就诊不一致');return visit;
 }
 own(ctx,input,active=false){
  const p=row(this.db,'prescription',id(input.prescriptionId)),visit=this.context(ctx,input,active);
  if(p.patient_id!==visit.patient_id||p.visit_id!==visit.id)fail(409,'PRESCRIPTION_CONTEXT','处方不属于当前患者及就诊');
  if(p.prescriber_id!==ctx.session.staff_id)fail(403,'PRESCRIBER_SCOPE','原处方须由原开立牙医核实；其他牙医可按本人接诊依据另开处方');
  revision(p,input.expectedRevision);return p;
 }
 items(prescriptionId){return this.db.prepare('SELECT * FROM prescription_item WHERE prescription_id=? ORDER BY sequence_no').all(prescriptionId);}
 drug(materialId){const m=row(this.db,'material',id(materialId));if(!m.is_drug||!m.is_active||!m.confirmed_at)fail(409,'DRUG_UNAVAILABLE','请选择经负责人核实启用的处方药品目录');return m;}
 writeItems(key,items,now,inHouse=false){
  if(!Array.isArray(items)||items.length<1||items.length>20)fail(422,'PRESCRIPTION_ITEMS','每张处方须明确1至20条药品明细');
  const seen=new Set(),values=items.map((i,index)=>{
   const m=this.drug(i.materialId);if(seen.has(m.id))fail(422,'PRESCRIPTION_DUPLICATE_DRUG','同一药品请合并数量并明确完整用法，不重复录入');seen.add(m.id);
   if(i.expectedMaterialRevision!==m.revision)fail(409,'DRUG_CHANGED','药品目录已变化，请重新核实名称、规格及单位');
   if(inHouse&&(!m.billing_service_id||!row(this.db,'service',m.billing_service_id).is_active))fail(409,'DRUG_BILLING_CONTEXT','院内处方药品须先核实对应的启用收费项目');
   const price=inHouse?this.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 1").get(m.billing_service_id,now,now):null;
   return {prescription_id:key,material_id:m.id,drug_name:m.name+' / '+m.specification,directions:text(i.directions,'医师明确的用法、用量及疗程说明',2000),quantity_scaled:integer(i.quantityScaled,'开立数量'),unit:m.base_unit,quantity_scale:m.quantity_scale,service_price_id:price?.id||null,billing_service_id:inHouse?m.billing_service_id:null,sequence_no:index+1};
  });
  this.db.prepare('DELETE FROM prescription_item WHERE prescription_id=?').run(key);
  for(const value of values)insert(this.db,'prescription_item',fact(now,value));
 }
 write(credentials,input){
  return this.unit.command(credentials,'prescriptions.write',input,(ctx,now)=>{
   if(['review','dispense'].includes(input.action))fail(409,'PHARMACY_NOT_ENABLED','审方与发药须由具备药学岗位资格的人员办理');
   const route=input.collectionRoute===undefined?'院外':input.collectionRoute;if(!['院外','院内'].includes(route))fail(422,'INVALID_INPUT','请选择院外或院内取药');
   if(route==='院内')this.pharmacy.requireEnabled(ctx);
   const reason=text(input.reason,'办理依据',2000);
   if(input.action==='draft'){
    const visit=this.context(ctx,input,true),record=this.clinical.recordFor(visit.id),patient=row(this.db,'patient',visit.patient_id);
    let original=null;
    if(input.originalPrescriptionId!=null){
     original=row(this.db,'prescription',id(input.originalPrescriptionId));revision(original,input.expectedOriginalRevision);
     if(original.patient_id!==visit.patient_id||original.visit_id!==visit.id||original.status==='草稿')fail(409,'PRESCRIPTION_ORIGINAL','重开须引用同患者、同次实际就诊的已开立或已作废原方');
     const dispensed=this.db.prepare('SELECT d.id FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id WHERE i.prescription_id=? LIMIT 1').get(original.id);
     if(original.status!=='已作废'&&(!dispensed||input.originalDispensingReviewed!==true))fail(409,'PRESCRIPTION_ORIGINAL','未发药原方须先核实作废；已有实际发药须核实原交付事实后按新医嘱另开');
     ctx.authority.originalPrescriptionId=original.id;ctx.authority.originalDispensingReviewed=!!dispensed;
    }
    const key=insert(this.db,'prescription',fact(now,{patient_id:visit.patient_id,visit_id:visit.id,prescriber_id:ctx.session.staff_id,clinical_record_id:record.id,
     original_prescription_id:original?.id||null,handed_over_at:null,handed_over_by:null,voided_by:null,collection_route:route,issued_at:null,status:'草稿',review_status:route==='院内'?'院内待审':'院外取药',reviewer_id:null,review_note:null,diagnosis:text(input.diagnosis,'本次处方诊断',4000),guidance_note:optionalGuidance(input.guidanceNote),
     patient_name:patient.name,patient_no:patient.record_no,birth_date:patient.birth_date,prescriber_name:row(this.db,'staff',ctx.session.staff_id).name,health_review_id:null,content_hash:null,voided_at:null,void_reason:null,record_no:recordNo('RX')}));
    this.writeItems(key,input.items,now,route==='院内');ctx.authority.prescriptionId=key;return {kind:'prescription',key,revision:1,reason};
   }
   const p=this.own(ctx,input,!['void','respond','handover'].includes(input.action));ctx.authority.prescriptionId=p.id;
   if(p.collection_route==='院内'&&input.action!=='void')this.pharmacy.requireEnabled(ctx);
   if(input.action==='save'){
    if(p.status!=='草稿')fail(409,'PRESCRIPTION_SEALED','已开立处方不能覆盖，请核实后作废重开');
    if(input.collectionRoute!==undefined&&route!==p.collection_route)fail(409,'PRESCRIPTION_CONTEXT','取药路径不能在原草稿中替换，请另建处方');
    this.writeItems(p.id,input.items,now,p.collection_route==='院内');
    this.db.prepare('UPDATE prescription SET diagnosis=?,guidance_note=?,updated_at=?,revision=revision+1 WHERE id=?').run(text(input.diagnosis,'处方诊断',4000),optionalGuidance(input.guidanceNote),now,p.id);
   }else if(input.action==='issue'){
    if(p.status!=='草稿')fail(409,'PRESCRIPTION_STATE','只有草稿处方可确认开立');
    if(!p.guidance_note?.trim())fail(409,'PRESCRIPTION_GUIDANCE','开立前请补全由牙医实际说明的用药指导及注意事项');
    if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认已核对患者、诊断、过敏、既往用药及本次处方内容');
    const patient=row(this.db,'patient',p.patient_id),record=row(this.db,'clinical_record',p.clinical_record_id);revision(patient,input.expectedPatientRevision);revision(record,input.expectedRecordRevision);
    if(!record.diagnosis?.trim())fail(409,'PRESCRIPTION_DIAGNOSIS','请先记录本次病历的实际诊断');
    const review=this.db.prepare('SELECT * FROM health_review WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(p.visit_id);
    const latest=this.db.prepare('SELECT id FROM health_version WHERE patient_id=? ORDER BY version_no DESC LIMIT 1').get(p.patient_id);
    if(!review||review.id!==input.expectedHealthReviewId||review.health_version_id!==latest?.id)fail(409,'HEALTH_REVIEW_REQUIRED','请先完成本次健康资料复核，并核对最新病史、过敏及既往用药');
    const items=this.items(p.id);if(!items.length)fail(422,'PRESCRIPTION_ITEMS','处方缺少药品明细');
    for(const i of items){const m=this.drug(i.material_id);if(i.drug_name!==m.name+' / '+m.specification||i.unit!==m.base_unit||i.quantity_scale!==m.quantity_scale||(p.collection_route==='院内'&&i.billing_service_id!==m.billing_service_id))fail(409,'DRUG_CHANGED','药品目录已变化，请先刷新并修订草稿后再确认');}
    const snapshot={...p,issued_at:now,health_review_id:review.id,patient_name:patient.name,patient_no:patient.record_no,birth_date:patient.birth_date,prescriber_name:row(this.db,'staff',ctx.session.staff_id).name};
    const digest=hash(canonical(payload(this.db,snapshot)));
    this.db.prepare("UPDATE prescription SET status='已开立',issued_at=?,health_review_id=?,patient_name=?,patient_no=?,birth_date=?,prescriber_name=?,content_hash=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,review.id,snapshot.patient_name,snapshot.patient_no,snapshot.birth_date,snapshot.prescriber_name,digest,now,p.id);
   }else if(input.action==='handover'){
    if(p.status!=='已开立'||p.collection_route!=='院外'||p.handed_over_at)fail(409,'PRESCRIPTION_HANDOVER','仅有效且尚未确认交付的院外处方可办理文件交付');
    if(input.confirmed!==true||input.recipientVerified!==true)fail(422,'CONFIRM_REQUIRED','请核对患者或获准接收人，并确认处方文件与用药指导已实际交付');
    const at=instant(input.handedOverAt,'实际处方文件交付时刻');if(at<p.issued_at||at>now)fail(422,'PRESCRIPTION_HANDOVER_TIME','交付须已发生且不早于开立');
    this.db.prepare('UPDATE prescription SET handed_over_at=?,handed_over_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(at,ctx.session.staff_id,now,p.id);
    ctx.authority.prescriptionFileHandedOver=true;ctx.authority.externalMedicationDispensed='未据此推定';
   }else if(input.action==='void'){
    if(this.db.prepare('SELECT d.id FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id WHERE i.prescription_id=? LIMIT 1').get(p.id))fail(409,'DISPENSE_ALREADY_OCCURRED','已有实际发药，不能将原处方直接作废；请保留事实并核实后续处理');
    if(p.status!=='已开立')fail(409,'PRESCRIPTION_STATE','仅已开立处方可作废，原处方内容保留');
    if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请核实作废原因并确认保留原处方记录');
    if(input.medicationNotDispensed!==true)fail(409,'PRESCRIPTION_MEDICATION_UNKNOWN','须先核实药品尚未交付；已有实际发药或取药事实不明不能直接作废');
    ctx.authority.medicationNotDispensed=true;ctx.authority.medicationVerificationBasis=reason;
    this.db.prepare("UPDATE prescription SET status='已作废',voided_at=?,voided_by=?,void_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,reason,now,p.id);
   }else if(input.action==='respond'){
    if(p.status!=='已开立'||p.collection_route!=='院内'||p.review_status!=='待医师处理'||input.confirmed!==true)fail(409,'PHYSICIAN_RESPONSE_REQUIRED','仅退回医师处理的院内处方可核实回复');
    this.db.prepare("UPDATE prescription SET review_status='院内待审',reviewer_id=NULL,review_note=?,reviewed_at=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,p.id);
   }else fail(422,'INVALID_ACTION','处方操作无效');
   const after=row(this.db,'prescription',p.id);
   return {kind:'prescription',key:p.id,beforeRevision:p.revision,revision:p.revision+1,reason,changes:['status','handed_over_at','handed_over_by','voided_at','voided_by','void_reason'].filter(k=>p[k]!==after[k]).map(field=>({field,before:p[field],after:after[field]}))};
  });
 }
 worklist(credentials,input={}){
  return this.unit.query(credentials,'prescriptions.query',ctx=>{
   const date=dateOnly(input.date||day(this.unit.auth.now())),start=utc(date+'T00:00:00+08:00');
   return {items:this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.arrived_at,v.status,p.name patient_name,p.record_no patient_no,
    (SELECT count(*) FROM prescription x WHERE x.visit_id=v.id) prescription_count FROM visit v JOIN patient p ON p.id=v.patient_id WHERE v.arrived_at>=? AND v.arrived_at<? ORDER BY v.arrived_at,v.id`).all(start,utc(Date.parse(start)+86400000)).filter(v=>{try{this.clinical.scope(ctx,v.id);return true;}catch(e){if(e.code==='CLINICAL_SCOPE')return false;throw e;}})};
  });
 }
 query(credentials,input){
  return this.unit.query(credentials,'prescriptions.query',ctx=>{
   const visit=this.context(ctx,input),record=this.clinical.recordFor(visit.id),review=this.db.prepare('SELECT * FROM health_review WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(visit.id)||null;
   const health=review?this.db.prepare('SELECT category,certainty,content,source FROM health_item WHERE health_version_id=? ORDER BY id').all(review.health_version_id):[];
   const prescriptions=this.db.prepare('SELECT * FROM prescription WHERE visit_id=? ORDER BY id DESC').all(visit.id).map(p=>({...p,originalRecordNo:p.original_prescription_id?row(this.db,'prescription',p.original_prescription_id).record_no:null,items:this.items(p.id).map(i=>({...i,dispensedQuantityScaled:this.db.prepare('SELECT coalesce(sum(quantity_scaled),0) n FROM dispense_record WHERE prescription_item_id=?').get(i.id).n})),history:this.pharmacy.history(p.id),reviewHistory:this.unit.workflowHistory.list('prescription',p.id),contentIntact:p.status==='草稿'?null:hash(canonical(payload(this.db,p)))===p.content_hash,canManage:p.prescriber_id===ctx.session.staff_id}));
   return {visit,patient:row(this.db,'patient',visit.patient_id),record,review,health,prescriptions,drugs:this.db.prepare('SELECT id,name,specification,base_unit,quantity_scale,revision,billing_service_id FROM material WHERE is_drug=1 AND is_active=1 AND confirmed_at IS NOT NULL ORDER BY name,id').all(),inHouseEnabled:this.pharmacy.state().active};
  });
 }
 export(credentials,rxId){
  return this.unit.query(credentials,'prescriptions.query',ctx=>{
   const p=row(this.db,'prescription',Number(rxId));this.context(ctx,{visitId:p.visit_id,patientId:p.patient_id});
   if(p.status==='草稿')fail(409,'PRESCRIPTION_STATE','草稿不能作为有效处方交付');
   if(hash(canonical(payload(this.db,p)))!==p.content_hash)fail(409,'PRESCRIPTION_SEALED','处方正文校验不符，请核对原记录');
   const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const qty=i=>{const s=String(i.quantity_scaled).padStart(i.quantity_scale+1,'0');return i.quantity_scale?s.slice(0,-i.quantity_scale)+'.'+s.slice(-i.quantity_scale):s;};
   const local=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+'（诊所时间）';
   const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>处方 ${esc(p.record_no)}</title><style>body{max-width:800px;margin:36px auto;padding:20px;font:16px/1.7 sans-serif;color:#122b35}h1{text-align:center}table{width:100%;border-collapse:collapse}td,th{border:1px solid #777;padding:10px;text-align:left;overflow-wrap:anywhere}p,td{white-space:pre-wrap}.status{font-weight:bold}@media print{body{margin:0;padding:0}}</style><h1>青禾牙科 · 处方记录</h1><p>处方号：${esc(p.record_no)}\n患者：${esc(p.patient_name)}　患者号：${esc(p.patient_no)}${p.birth_date?'　出生日期：'+esc(p.birth_date):''}\n诊断：${esc(p.diagnosis)}\n开立人：${esc(p.prescriber_name)}　开立时间：${esc(local(p.issued_at))}\n取药路径：${esc(p.collection_route)}取药${p.original_prescription_id?'\n更正重开引用原方编号：'+esc(p.original_prescription_id):''}</p><p class="status">状态：${esc(p.status)}</p>${p.status==='已作废'?'<p>作废时间：'+esc(local(p.voided_at))+'\n作废依据：'+esc(p.void_reason)+'</p>':''}<table><thead><tr><th>药品名称及规格</th><th>数量</th><th>医师填写的用法、用量与疗程</th></tr></thead><tbody>${this.items(p.id).map(i=>'<tr><td>'+esc(i.drug_name)+'</td><td>'+esc(qty(i))+' '+esc(i.unit)+'</td><td>'+esc(i.directions)+'</td></tr>').join('')}</tbody></table><h2>用药指导及注意事项</h2><p>${esc(p.guidance_note)}</p><p>此记录保存医师在系统内确认的处方内容；需适用签章的处方由医师按机构要求办理。生成时间：${esc(local(this.unit.auth.now()))}。原件状态以诊所当前记录为准。</p></html>`;
   ctx.authority.prescriptionId=p.id;return {name:p.record_no+'.html',html};
  });
 }
}
module.exports={Prescriptions,validatePrescriptions};
