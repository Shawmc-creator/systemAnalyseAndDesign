'use strict';
const {fail,text,id,instant,day,utc,dateOnly,canonical,hash,insert,fact,row,revision}=require('./common');
const {integer}=require('./inventory-gates');
const {policyState}=require('./pharmacy-policy');
function validatePharmacy(db){
 const missing=db.prepare(`SELECT m.id FROM inventory_movement m LEFT JOIN dispense_record d ON d.inventory_movement_id=m.id WHERE m.movement_type='发药' AND d.id IS NULL`).get();
 if(missing)fail(409,'DISPENSE_INCOMPLETE','发药出库必须同时保存实际发药记录');
 for(const d of db.prepare('SELECT * FROM dispense_record').all()){
  const bill=db.prepare('SELECT * FROM bill_item WHERE dispense_record_id=?').get(d.id);
  if(!bill)fail(409,'DISPENSE_INCOMPLETE','实际发药须同时形成药费或待核价依据');
  const i=row(db,'prescription_item',d.prescription_item_id),p=row(db,'prescription',i.prescription_id),m=row(db,'inventory_movement',d.inventory_movement_id);
  if(bill.quantity!==d.quantity_scaled||bill.quantity_scale!==i.quantity_scale||row(db,'bill',bill.bill_id).patient_id!==p.patient_id||m.movement_type!=='发药'||m.delta_scaled!==-d.quantity_scaled)fail(409,'DISPENSE_CONTEXT','发药、患者、批次出库与计费数量不一致');
 }
}
class Pharmacy{
 constructor(db,unit,prescriptions,inventory,billing,policy){Object.assign(this,{db,unit,prescriptions,inventory,billing,policy});}
 state(){return policyState(this.policy,this.unit.auth.now());}
 requireEnabled(ctx){const p=this.state();if(!p.active)fail(409,'PHARMACY_NOT_ENABLED','机构药学条件未启用、尚未生效或已经到期，不能办理院内审方发药');if(ctx)ctx.authority.pharmacyPolicy={digest:p.digest,validFrom:p.validFrom,validUntil:p.validUntil,verificationBasis:p.verificationBasis,verifiedBy:p.verifiedBy};return p;}
 management(credentials){
  return this.unit.query(credentials,'pharmacy.management',()=>({policy:this.state(),staff:this.db.prepare(`SELECT a.id account_id,s.id staff_id,s.name,a.login_name FROM user_account a JOIN staff s ON s.id=a.staff_id WHERE a.status='启用' ORDER BY s.id`).all(),
   qualifications:this.db.prepare(`SELECT q.*,s.name,a.login_name,g.id grant_id,g.revoked_at grant_revoked_at FROM staff_role_qualification q JOIN access_role r ON r.id=q.role_id JOIN staff s ON s.id=q.staff_id LEFT JOIN user_account a ON a.staff_id=q.staff_id LEFT JOIN account_role g ON g.qualification_id=q.id WHERE r.code='pharmacist' ORDER BY q.id DESC`).all()}));
 }
 qualify(credentials,input){
  return this.unit.command(credentials,'pharmacy.manage',input,(ctx,now)=>{
   if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认已核实该人员相应药学资格及任职条件');
   const reason=text(input.reason,'核实或撤销依据',2000),role=this.db.prepare("SELECT id FROM access_role WHERE code='pharmacist'").get();
   if(input.action==='grant'){
    const account=row(this.db,'user_account',id(input.accountId)),staff=row(this.db,'staff',account.staff_id),start=instant(input.validFrom,'资格生效时间'),end=instant(input.validUntil,'资格截止时间');
    if(account.status!=='启用'||staff.employed_from>day(now)||staff.employed_until&&staff.employed_until<day(now)||start>now||end<=now||end<=start)fail(422,'QUALIFICATION_INTERVAL','须为在职启用账号，资格当前已生效且截止时间晚于现在');
    if(this.db.prepare('SELECT id FROM staff_role_qualification WHERE staff_id=? AND role_id=? AND revoked_at IS NULL AND valid_until>?').get(staff.id,role.id,now))fail(409,'QUALIFICATION_DUPLICATE','该人员已有有效药学资格，请先核实原授权');
    const key=insert(this.db,'staff_role_qualification',{staff_id:staff.id,role_id:role.id,valid_from:start,valid_until:end,verified_by:ctx.session.staff_id,verification_basis:reason,revoked_at:null,revoked_by:null,revocation_reason:null,created_at:now});
    insert(this.db,'account_role',{account_id:account.id,role_id:role.id,qualification_id:key,granted_by:ctx.session.account_id,granted_at:now,valid_until:end,grant_reason:reason,revoked_by:null,revoked_at:null,revocation_reason:null});
    return {kind:'staff_role_qualification',key,revision:1,reason};
   }
   if(input.action!=='revoke')fail(422,'INVALID_ACTION','药学资格操作无效');
   const q=row(this.db,'staff_role_qualification',id(input.qualificationId));if(q.role_id!==role.id||q.revoked_at)fail(409,'QUALIFICATION_STATE','只能撤销尚未撤销的药学岗位资格');
   this.db.prepare('UPDATE account_role SET revoked_at=?,revoked_by=?,revocation_reason=? WHERE qualification_id=? AND revoked_at IS NULL').run(now,ctx.session.account_id,reason,q.id);
   this.db.prepare('UPDATE staff_role_qualification SET revoked_at=?,revoked_by=?,revocation_reason=? WHERE id=?').run(now,ctx.session.staff_id,reason,q.id);
   return {kind:'staff_role_qualification',key:q.id,revision:2,reason};
  });
 }
 prescription(input){const p=row(this.db,'prescription',id(Number(input.prescriptionId)));if(p.collection_route!=='院内'||p.status==='草稿')fail(403,'PHARMACY_SCOPE','药学工作台仅查阅已开立的院内处方及其历史');if(input.patientId!=null&&Number(input.patientId)!==p.patient_id)fail(409,'PATIENT_MISMATCH','患者与所选处方不一致');return p;}
 latestHealth(patientId){return this.db.prepare('SELECT * FROM health_version WHERE patient_id=? ORDER BY version_no DESC LIMIT 1').get(patientId);}
 detail(p,now,pricingAt=now){
  const health=this.latestHealth(p.patient_id);
  const items=this.prescriptions.items(p.id).map(i=>{
   const dispenses=this.db.prepare(`SELECT d.*,s.name operator_name,m.batch_stock_id,b.batch_no,l.name location_name FROM dispense_record d JOIN staff s ON s.id=d.operator_id JOIN inventory_movement m ON m.id=d.inventory_movement_id JOIN batch_stock bs ON bs.id=m.batch_stock_id JOIN material_batch b ON b.id=bs.material_batch_id JOIN stock_location l ON l.id=bs.stock_location_id WHERE prescription_item_id=? ORDER BY d.id`).all(i.id);
   const used=dispenses.reduce((n,d)=>n+BigInt(d.quantity_scaled),0n);
   const stocks=this.db.prepare(`SELECT s.*,b.batch_no,b.expiry_date,b.status batch_status FROM batch_stock s JOIN material_batch b ON b.id=s.material_batch_id JOIN stock_location l ON l.id=s.stock_location_id JOIN material m ON m.id=b.material_id WHERE b.material_id=? AND b.status='可用' AND m.is_active=1 AND m.confirmed_at IS NOT NULL AND l.is_active=1 AND s.quantity_scaled>0 AND b.expiry_date IS NOT NULL AND b.expiry_date>=? ORDER BY b.expiry_date,s.id`).all(i.material_id,day(now));
   const price=i.billing_service_id?this.db.prepare("SELECT p.* FROM service_price p JOIN service s ON s.id=p.service_id WHERE s.id=? AND s.is_active=1 AND p.status='已确认可适用' AND p.valid_from<=? AND (p.valid_until IS NULL OR p.valid_until>?) ORDER BY p.valid_from DESC LIMIT 1").get(i.billing_service_id,pricingAt,pricingAt):null;
   return {...i,dispenses,remainingQuantityScaled:Number(BigInt(i.quantity_scaled)-used),stocks,currentPrice:price||null};
  });
  return {...p,items,latestHealthVersionId:health?.id||null,health:health?this.db.prepare('SELECT category,certainty,content FROM health_item WHERE health_version_id=? ORDER BY id').all(health.id):[],history:this.history(p.id),reviewHistory:this.unit.workflowHistory.list('prescription',p.id)};
 }
 history(prescriptionId){return this.db.prepare("SELECT a.occurred_at,a.reason,s.name staff_name FROM operation_audit a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.object_kind='prescription' AND a.object_key=? AND a.event_type='变更' ORDER BY a.id").all(String(prescriptionId));}
 query(credentials,input={}){
  return this.unit.query(credentials,'pharmacy.query',()=>{
   if(input.prescriptionId)return {policy:this.state(),prescription:this.detail(this.prescription(input),this.unit.auth.now(),input.pricingAt?instant(input.pricingAt,'费用发生时间'):this.unit.auth.now())};
   const selected=dateOnly(input.date||day(this.unit.auth.now())),start=utc(selected+'T00:00:00+08:00'),end=utc(Date.parse(start)+86400000);
   return {policy:this.state(),items:this.db.prepare(`SELECT p.*,(SELECT count(*) FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id WHERE i.prescription_id=p.id) dispense_count FROM prescription p WHERE p.collection_route='院内' AND p.status='已开立' AND p.issued_at>=? AND p.issued_at<? ORDER BY p.issued_at,p.id`).all(start,end)};
  });
 }
 review(credentials,input){
  return this.unit.command(credentials,'pharmacy.review',input,(ctx,now)=>{
   this.requireEnabled(ctx);const p=this.prescription(input);revision(p,input.expectedRevision);
   if(p.status!=='已开立'||p.prescriber_id===ctx.session.staff_id||!['院内待审','已通过'].includes(p.review_status))fail(409,'PHARMACY_REVIEW_STATE','须由非开立医师的药学人员办理待审处方，已通过处方仅可退回医师核实');
   if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认已核对患者、处方内容及当前健康资料');
   if(input.expectedLatestHealthVersionId!==this.latestHealth(p.patient_id)?.id)fail(409,'HEALTH_VERSION_CONFLICT','健康资料已变化，请重新核对');
   const note=text(input.reviewNote,'审方意见',2000);let status;
   if(input.action==='approve'&&p.review_status==='院内待审')status='已通过';else if(input.action==='return')status='待医师处理';else fail(422,'INVALID_ACTION','审方操作无效');
   this.db.prepare('UPDATE prescription SET review_status=?,reviewer_id=?,review_note=?,reviewed_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,ctx.session.staff_id,note,now,now,p.id);
   this.unit.workflowHistory.append('prescription',p.id,'审方',note,ctx,input,now);
   ctx.authority.prescriptionId=p.id;return {kind:'prescription',key:p.id,beforeRevision:p.revision,revision:p.revision+1,reason:note,changes:[{field:'review_status',before:p.review_status,after:status},{field:'review_note',before:p.review_note,after:note}]};
  });
 }
 dispense(credentials,input){
  return this.unit.command(credentials,'pharmacy.dispense',input,(ctx,now)=>{
   this.requireEnabled(ctx);const p=this.prescription(input);revision(p,input.expectedRevision);
   if(p.status!=='已开立'||p.review_status!=='已通过'||p.prescriber_id===ctx.session.staff_id||!p.reviewer_id||p.reviewer_id===p.prescriber_id)fail(409,'PHARMACY_REVIEW_REQUIRED','须为经药学审核通过的有效院内处方，开立医师不能代替药学岗位发药');
   if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认实际核对、交付及用药交代已经完成');
   if(input.expectedLatestHealthVersionId!==this.latestHealth(p.patient_id)?.id)fail(409,'HEALTH_VERSION_CONFLICT','健康资料已变化，请先重新核对');
   const item=row(this.db,'prescription_item',id(input.itemId));if(item.prescription_id!==p.id)fail(409,'PRESCRIPTION_CONTEXT','药品明细不属于当前处方');
   const quantity=integer(input.quantityScaled,'实际发药数量'),dispensed=instant(input.dispensedAt,'实际发药时间');
   if(dispensed>now||dispensed<p.issued_at||dispensed<p.reviewed_at)fail(422,'DISPENSE_TIME','实际发药须已发生，且不早于处方开立与本次审核');
   const used=this.db.prepare('SELECT quantity_scaled FROM dispense_record WHERE prescription_item_id=?').all(item.id).reduce((n,d)=>n+BigInt(d.quantity_scaled),0n);
   if(used+BigInt(quantity)>BigInt(item.quantity_scaled))fail(409,'DISPENSE_QUANTITY','实际发药累计数量超过原处方剩余量');
   const c=this.inventory.stockContext({stockId:input.stockId,expectedStockRevision:input.expectedStockRevision},now,true);
   if(!c.batch.expiry_date)fail(409,'BATCH_UNAVAILABLE','院内发药必须有已核实的实际有效期，不能将未知效期当作无限有效');
   if(c.material.id!==item.material_id||!c.material.is_drug||c.material.base_unit!==item.unit||c.material.quantity_scale!==item.quantity_scale)fail(409,'DISPENSE_CONTEXT','库存批次的药品、基本单位及精度与处方不一致');
   if(!item.billing_service_id||!row(this.db,'service',item.billing_service_id).is_active)fail(409,'DRUG_BILLING_CONTEXT','原处方药品缺少有效收费项目对应，请先由医师核实处理');
   const price=this.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 1").get(item.billing_service_id,dispensed,dispensed);
   if((input.expectedPriceId??null)!==(price?.id||null))fail(409,'PRICE_CHANGED','原发生时间的适用价目已变化，请刷新核对后办理');
   const note=text(input.guidanceNote,'实际核对、交付及用药交代依据',2000);
   const movement=this.inventory.movement(ctx,now,c.stock,{movement_type:'发药',delta_scaled:-quantity,reason:note,occurred_at:dispensed});
   const key=insert(this.db,'dispense_record',fact(now,{prescription_item_id:item.id,inventory_movement_id:movement,quantity_scaled:quantity,dispensed_at:dispensed,operator_id:ctx.session.staff_id,guidance_note:note}));
   const billItem=this.billing.fromDispense(row(this.db,'dispense_record',key),item,p,ctx,now);
   this.db.prepare('UPDATE prescription SET revision=revision+1,updated_at=? WHERE id=?').run(now,p.id);
   ctx.authority.prescriptionId=p.id;ctx.authority.dispenseRecordId=key;
   return {kind:'dispense_record',key,revision:1,reason:note,relatedChanges:[{kind:'inventory_movement',key:movement,revision:1,reason:note},{kind:'bill_item',key:billItem,revision:1,reason:'实际发药形成费用来源'}]};
  });
 }
}
module.exports={Pharmacy,validatePharmacy};
