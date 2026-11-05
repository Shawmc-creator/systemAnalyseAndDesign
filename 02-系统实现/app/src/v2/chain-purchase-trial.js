'use strict';
const crypto=require('node:crypto');
const {id,text,instant,fail,row,revision,insert,fact,recordNo,hash,canonical}=require('./common');
const {integer,safe,receiptAmount,inventorySnapshot,validateInventory}=require('./inventory-gates');
const {ChainAuth}=require('./chain-auth');
const {mapError}=require('./unit-of-work');

// Purchase lines use existing same-store batches and locations; no payment.
class ChainPurchaseTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.purchases=app.purchases;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('采购试验仅允许内存数据库');}
 list(credentials,branchId){const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,credentials.role==='manager'?'uc27.approve':'uc27.draft',branch);ctx.authority={...ctx.authority,branchId:branch};
  const orders=this.db.prepare('SELECT id,branch_id,supplier_id,record_no,status,cancellation_reason,revision FROM purchase_order WHERE branch_id=? ORDER BY id DESC').all(branch).map(p=>({...p,items:this.db.prepare('SELECT id,material_id,ordered_quantity_scaled,unit_price_cents,status,revision FROM purchase_order_item WHERE purchase_order_id=? ORDER BY id').all(p.id),receipts:this.db.prepare('SELECT id,record_no,status,arrived_at,delivery_evidence,revision FROM purchase_receipt WHERE purchase_order_id=? ORDER BY id').all(p.id).map(r=>({...r,items:this.db.prepare('SELECT id,purchase_order_item_id,material_batch_id,stock_location_id,arrived_quantity_scaled,accepted_quantity_scaled,rejected_quantity_scaled,pending_quantity_scaled,inspection_note,revision FROM purchase_receipt_item WHERE purchase_receipt_id=? ORDER BY id').all(r.id)}))}));
  const suppliers=this.db.prepare('SELECT id,name,revision FROM supplier WHERE is_active=1 ORDER BY id').all(),materials=this.db.prepare('SELECT id,name,base_unit,quantity_scale,revision FROM material WHERE is_active=1 AND confirmed_at IS NOT NULL ORDER BY id').all();
  const batches=this.db.prepare('SELECT id,material_id,batch_no,status,expiry_date,revision FROM material_batch WHERE branch_id=? ORDER BY id').all(branch),locations=this.db.prepare('SELECT id,name FROM stock_location WHERE branch_id=? AND is_active=1 ORDER BY id').all(branch);
  this.unit.audit(ctx,'查询','CHAIN_PURCHASE_LIST',{kind:'branch_purchase_query',key:'branch:'+branch},null,'查询本店采购和共享目录');this.db.exec('COMMIT');return {orders,suppliers,materials,batches,locations};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 command(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['create','approve','cancel','receive','inspect'].includes(input.action))fail(422,'INVALID_ACTION','采购操作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission={create:'uc27.draft',approve:'uc27.approve',cancel:'uc27.approve',receive:'uc28.receive',inspect:'uc28.receive'}[input.action],digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};let order=null;
   if(input.action!=='create'){order=row(this.db,'purchase_order',id(input.purchaseId,'采购单'));if(order.branch_id!==branch)fail(403,'PURCHASE_BRANCH','采购单不属于本店');}
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key),kind=['receive','inspect'].includes(input.action)?'purchase_receipt':'purchase_order';
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!==kind)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    const original=['receive','inspect'].includes(input.action)?this.db.prepare('SELECT purchase_order_id id FROM purchase_receipt WHERE id=?').get(Number(old.result_key))?.id:Number(old.result_key);
    if(!this.db.prepare('SELECT 1 FROM purchase_order WHERE id=? AND branch_id=?').get(original,branch))fail(409,'PURCHASE_BRANCH','原采购门店待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const now=this.auth.now(),before=inventorySnapshot(this.db),history=this.unit.workflowHistory.snapshot();let result,reason;
   if(input.action==='create'){
    const supplier=row(this.db,'supplier',id(input.supplierId,'供应商'));revision(supplier,input.expectedSupplierRevision);if(!supplier.is_active)fail(409,'SUPPLIER_INACTIVE','供应商已停用');
    const requested=input.items??[{materialId:input.materialId,expectedMaterialRevision:input.expectedMaterialRevision,quantityScaled:input.quantityScaled,unitPriceCents:input.unitPriceCents}];
    if(!Array.isArray(requested)||!requested.length||requested.length>20)fail(422,'PURCHASE_ITEMS','请填写一至二十项材料');
    const seen=new Set(),fields=requested.map(item=>{const materialId=id(item?.materialId,'材料');if(seen.has(materialId))fail(422,'PURCHASE_ITEMS','同一材料请合并为一个采购项目');seen.add(materialId);return this.purchases.itemFields({materialId,expectedMaterialRevision:item.expectedMaterialRevision,orderedQuantityScaled:item.quantityScaled,unitPriceCents:item.unitPriceCents});});
    const agreed=instant(input.agreedAt,'采购约定时间');if(agreed>now)fail(422,'PURCHASE_TIME','采购约定不能在未来');reason=text(input.reason,'采购依据',2000);
    const p=insert(this.db,'purchase_order',fact(now,{branch_id:branch,supplier_id:supplier.id,agreed_at:agreed,delivery_terms:text(input.deliveryTerms,'交付条件',2000),request_reason:reason,created_by:ctx.session.staff_id,confirmed_at:null,confirmed_by:null,status:'待确认',record_no:recordNo('PO')}));
    fields.forEach((line,index)=>insert(this.db,'purchase_order_item',fact(now,{...line,purchase_order_id:p,sequence_no:index+1,status:'待交付'})));result={kind,key:p,revision:1};
   }else if(input.action==='approve'){
    revision(order,input.expectedRevision);if(order.status!=='待确认')fail(409,'PURCHASE_SEALED','仅待确认采购可审核');const supplier=row(this.db,'supplier',order.supplier_id);revision(supplier,input.expectedSupplierRevision);if(!supplier.is_active)fail(409,'SUPPLIER_INACTIVE','供应商已停用');
    const items=this.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(order.id);if(!items.length)fail(409,'PURCHASE_ITEMS','采购单没有项目');
    for(const item of items){const m=row(this.db,'material',item.material_id);if(!m.is_active||!m.confirmed_at||['purchase_unit','conversion_numerator','conversion_denominator','quantity_scale'].some(k=>item[k]!==m[k]))fail(409,'PURCHASE_UNITS_CHANGED','材料单位待核对');receiptAmount(item,item.ordered_quantity_scaled);}
    reason=text(input.reviewNote,'负责人意见',2000);this.db.prepare("UPDATE purchase_order SET status='已确认',confirmed_at=?,confirmed_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,now,order.id);result={kind,key:order.id,beforeRevision:order.revision,revision:order.revision+1};
   }else if(input.action==='cancel'){
    revision(order,input.expectedRevision);if(order.status!=='待确认')fail(409,'PURCHASE_SEALED','仅待确认采购可取消');reason=text(input.reviewNote,'取消依据',2000);
    this.db.prepare("UPDATE purchase_order SET status='已取消',cancellation_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,order.id);result={kind,key:order.id,beforeRevision:order.revision,revision:order.revision+1};
   }else if(input.action==='receive'){
    revision(order,input.expectedPurchaseRevision);if(order.status!=='已确认')fail(409,'PURCHASE_UNCONFIRMED','先确认采购');const line=row(this.db,'purchase_order_item',id(input.purchaseItemId,'采购项目'));revision(line,input.expectedItemRevision);
    if(line.purchase_order_id!==order.id||['剩余已取消','履行已完成'].includes(line.status))fail(409,'PURCHASE_ITEM_SOURCE','采购项目不可验收');
    const batch=row(this.db,'material_batch',id(input.batchId,'批次')),location=row(this.db,'stock_location',id(input.locationId,'库位'));
    if(batch.branch_id!==branch||location.branch_id!==branch)fail(409,'INVENTORY_BRANCH_UNKNOWN','批次或库位不属于本店');
    const arrived=instant(input.arrivedAt,'到货时间');if(arrived>now||arrived<order.agreed_at)fail(422,'RECEIPT_TIME','到货时间无效');
    const evidence=text(input.deliveryEvidence,'随货依据',1000);if(this.db.prepare('SELECT 1 FROM purchase_receipt r JOIN purchase_order p ON p.id=r.purchase_order_id JOIN purchase_receipt_item i ON i.purchase_receipt_id=r.id WHERE p.supplier_id=? AND r.delivery_evidence=? AND (p.id<>? OR i.purchase_order_item_id=?)').get(order.supplier_id,evidence,order.id,line.id))fail(409,'DELIVERY_DUPLICATE','该项目的随货依据已登记');
    const qty=integer(input.quantityScaled,'实际到货量'),accepted=integer(input.acceptedScaled??qty,'合格量',true),rejected=integer(input.rejectedScaled??0,'拒收量',true),pending=integer(input.pendingScaled??0,'待检量',true);if(BigInt(accepted)+BigInt(rejected)+BigInt(pending)!==BigInt(qty))fail(422,'RECEIPT_QUANTITIES','到货量须等于合格、拒收与待检之和');this.purchases.validateAcceptance(line,batch,location,accepted,now);
    reason=text(input.inspectionNote,'验收依据',2000);const receipt=insert(this.db,'purchase_receipt',fact(now,{purchase_order_id:order.id,arrived_at:arrived,delivery_evidence:evidence,accepted_at:now,operator_id:ctx.session.staff_id,confirmed_by:ctx.session.staff_id,status:pending?'部分待检':'已确认',record_no:recordNo('PR')}));
    const item=insert(this.db,'purchase_receipt_item',fact(now,{purchase_receipt_id:receipt,purchase_order_item_id:line.id,material_batch_id:batch.id,stock_location_id:location.id,arrived_quantity_scaled:qty,accepted_quantity_scaled:accepted,rejected_quantity_scaled:rejected,pending_quantity_scaled:pending,accepted_amount_cents:receiptAmount(line,accepted),inspection_note:reason}));
    const movement=this.purchases.stockAccepted(ctx,now,item,accepted,batch.id,location.id);this.unit.workflowHistory.append('purchase_receipt_item',item,'首次确认',reason,ctx,input,now,{newly_accepted_scaled:accepted,inventory_movement_id:movement||null});
    this.purchases.progress(order.id,now);this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,order.id);ctx.authority.purchaseId=order.id;result={kind,key:receipt,revision:1};
   }else{
    if(order.status!=='已确认')fail(409,'PURCHASE_UNCONFIRMED','采购单状态待核对');const receipt=row(this.db,'purchase_receipt',id(input.receiptId,'验收单'));revision(receipt,input.expectedReceiptRevision);if(receipt.purchase_order_id!==order.id)fail(403,'PURCHASE_BRANCH','验收单不属于本采购');
    const item=row(this.db,'purchase_receipt_item',id(input.receiptItemId,'验收条目'));revision(item,input.expectedItemRevision);if(item.purchase_receipt_id!==receipt.id||!item.pending_quantity_scaled)fail(409,'RECEIPT_PENDING','条目没有待检数量');
    const batch=row(this.db,'material_batch',item.material_batch_id),location=row(this.db,'stock_location',item.stock_location_id),line=row(this.db,'purchase_order_item',item.purchase_order_item_id);if(batch.branch_id!==branch||location.branch_id!==branch||line.purchase_order_id!==order.id)fail(409,'INVENTORY_BRANCH_UNKNOWN','验收来源门店待核对');
    const accepted=integer(input.acceptedScaled,'转合格量',true),rejected=integer(input.rejectedScaled,'转拒收量',true);if(accepted+rejected===0||BigInt(accepted)+BigInt(rejected)>BigInt(item.pending_quantity_scaled))fail(422,'RECEIPT_QUANTITIES','检验结论须在待检量内');
    const total=safe(BigInt(item.accepted_quantity_scaled)+BigInt(accepted));this.purchases.validateAcceptance(line,batch,location,total,now,item.id);reason=text(input.inspectionNote,'后续检验依据',2000);
    this.db.prepare('UPDATE purchase_receipt_item SET accepted_quantity_scaled=?,rejected_quantity_scaled=?,pending_quantity_scaled=?,accepted_amount_cents=?,inspection_note=?,updated_at=?,revision=revision+1 WHERE id=?').run(total,item.rejected_quantity_scaled+rejected,item.pending_quantity_scaled-accepted-rejected,receiptAmount(line,total),item.inspection_note+'\n后续检验（'+now+'）：'+reason,now,item.id);
    const pending=this.db.prepare('SELECT 1 FROM purchase_receipt_item WHERE purchase_receipt_id=? AND pending_quantity_scaled>0').get(receipt.id);this.db.prepare('UPDATE purchase_receipt SET status=?,updated_at=?,revision=revision+1 WHERE id=?').run(pending?'部分待检':'已确认',now,receipt.id);
    const movement=this.purchases.stockAccepted(ctx,now,item.id,accepted,batch.id,location.id);this.unit.workflowHistory.append('purchase_receipt_item',item.id,'待检后确认',reason,ctx,input,now,{newly_accepted_scaled:accepted,inventory_movement_id:movement||null});
    this.purchases.progress(order.id,now);this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,order.id);ctx.authority.purchaseId=order.id;result={kind,key:receipt.id,beforeRevision:receipt.revision,revision:receipt.revision+1};
   }
   validateInventory(this.db,before);this.unit.workflowHistory.validate(history,permission);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:kind,result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',result,sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainPurchaseTrial};
