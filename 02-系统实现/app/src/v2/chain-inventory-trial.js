'use strict';
const crypto=require('node:crypto');
const {id,text,instant,dateOnly,fail,row,revision,insert,fact,hash,canonical}=require('./common');
const {integer,inventorySnapshot,validateInventory}=require('./inventory-gates');
const {ChainAuth}=require('./chain-auth');
const {mapError}=require('./unit-of-work');

class ChainInventoryTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.inventory=app.inventory;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('库存试验仅允许内存数据库');}
 scope(stockId,branch){const stock=row(this.db,'batch_stock',stockId),batch=row(this.db,'material_batch',stock.material_batch_id),location=row(this.db,'stock_location',stock.stock_location_id);
  if(location.branch_id!==branch||batch.branch_id!==branch)fail(409,'INVENTORY_BRANCH_UNKNOWN','库存位置与批次门店不一致，请先核对');
  const bad=this.db.prepare(`SELECT 1 FROM inventory_movement m LEFT JOIN purchase_receipt_item ri ON ri.id=m.purchase_receipt_item_id LEFT JOIN purchase_receipt r ON r.id=ri.purchase_receipt_id
   LEFT JOIN purchase_order p ON p.id=r.purchase_order_id WHERE m.batch_stock_id=? AND m.movement_type='验收入库' AND (ri.id IS NULL OR p.branch_id IS NOT ?) LIMIT 1`).get(stock.id,branch);
  if(bad)fail(409,'INVENTORY_BRANCH_UNKNOWN','库存验收来源门店不明或不一致，请先核对');
  return {stock,batch,location,material:row(this.db,'material',batch.material_id)};}
 list(credentials,branchId){const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc17.query',branch);ctx.authority={...ctx.authority,branchId:branch};const now=this.auth.now();
  const materials=this.db.prepare('SELECT id,name,specification,base_unit,purchase_unit,conversion_numerator,conversion_denominator,quantity_scale,requires_trace,requires_expiry,is_active,confirmed_at,revision,is_drug FROM material ORDER BY id').all();
  const candidates=this.db.prepare(`SELECT s.id FROM batch_stock s JOIN material_batch b ON b.id=s.material_batch_id JOIN stock_location l ON l.id=s.stock_location_id
   WHERE b.branch_id=? OR l.branch_id=? ORDER BY s.id`).all(branch,branch);
  const items=candidates.map(({id:stockId})=>{const {stock,batch,location,material}=this.scope(stockId,branch);return {stockId:stock.id,revision:stock.revision,quantityScaled:stock.quantity_scaled,
   batchId:batch.id,batchNo:batch.batch_no,expiryDate:batch.expiry_date,batchStatus:batch.status,materialId:material.id,materialName:material.name,specification:material.specification,unit:material.base_unit,scale:material.quantity_scale,
   locationName:location.name,available:this.inventory.available(batch,material,location,now)};});
  const counts=[],issues=[],movements=[];for(const item of items){for(const c of this.db.prepare("SELECT id,batch_stock_id,snapshot_quantity_scaled,counted_quantity_scaled,stock_revision,counted_at,status,revision,reason,review_note FROM stock_count WHERE batch_stock_id=? ORDER BY id DESC").all(item.stockId))counts.push({...c,materialName:item.materialName,batchNo:item.batchNo,unit:item.unit,scale:item.scale});
   for(const m of this.db.prepare("SELECT id,movement_type,delta_scaled,original_movement_id,occurred_at,reason FROM inventory_movement WHERE batch_stock_id=? AND movement_type IN ('领用','未用退回') ORDER BY id DESC LIMIT 100").all(item.stockId))movements.push({...m,materialName:item.materialName,batchNo:item.batchNo,unit:item.unit,scale:item.scale});
   for(const m of this.db.prepare("SELECT id,occurred_at,delta_scaled FROM inventory_movement WHERE batch_stock_id=? AND movement_type='领用' ORDER BY id DESC").all(item.stockId)){const returned=this.db.prepare("SELECT COALESCE(SUM(delta_scaled),0) n FROM inventory_movement WHERE original_movement_id=? AND movement_type='未用退回'").get(m.id).n,used=this.db.prepare('SELECT COALESCE(SUM(quantity_scaled),0) n FROM material_usage WHERE inventory_movement_id=?').get(m.id).n,remaining=-m.delta_scaled-returned-used;if(remaining>0&&item.available)issues.push({id:m.id,stockId:item.stockId,stockRevision:item.revision,materialName:item.materialName,batchNo:item.batchNo,unit:item.unit,scale:item.scale,remainingScaled:remaining,occurredAt:m.occurred_at});}}
  this.unit.audit(ctx,'查询','CHAIN_INVENTORY_LIST',{kind:'branch_inventory_query',key:'branch:'+branch},null,'查询统一材料目录和本店库存');this.db.exec('COMMIT');return {materials,items,counts,issues,movements:movements.sort((a,b)=>b.id-a.id).slice(0,100)};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 issue(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1)fail(422,'COMMAND_VERSION','提交版本无效');
  const branch=id(input.branchId,'门店'),stockId=id(input.stockId,'库存'),key=text(input.requestKey,'提交号',100),permission='uc18.record',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch),{stock,batch,location,material}=this.scope(stockId,branch);ctx.authority={...ctx.authority,branchId:branch,stockId,materialId:material.id};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='inventory_movement')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    if(!this.db.prepare('SELECT 1 FROM inventory_movement WHERE id=? AND batch_stock_id=?').get(Number(old.result_key),stockId))fail(409,'INVENTORY_BRANCH_UNKNOWN','原领用归属待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   revision(stock,input.expectedStockRevision);const now=this.auth.now();if(!this.inventory.available(batch,material,location,now))fail(409,'BATCH_UNAVAILABLE','材料、批次或位置不可用，或效期待核对');
   const returning=input.action==='return';if(input.action!==undefined&&!['issue','return'].includes(input.action))fail(422,'INVALID_ACTION','库存动作无效');
   const quantity=integer(input.quantityScaled,returning?'退回数量':'领用数量'),reason=text(input.reason,'实际办理依据',2000),before=inventorySnapshot(this.db);let originalId=null;
   if(returning){const original=row(this.db,'inventory_movement',id(input.originalMovementId,'原领用'));if(original.batch_stock_id!==stock.id||original.movement_type!=='领用')fail(409,'ISSUE_SOURCE','请引用本店该批次的原领用');originalId=original.id;
    const returned=this.db.prepare("SELECT COALESCE(SUM(delta_scaled),0) n FROM inventory_movement WHERE original_movement_id=? AND movement_type='未用退回'").get(original.id).n,used=this.db.prepare('SELECT COALESCE(SUM(quantity_scaled),0) n FROM material_usage WHERE inventory_movement_id=?').get(original.id).n;if(quantity>-original.delta_scaled-returned-used)fail(409,'ISSUE_BALANCE_EXCEEDED','退回数量超过原领用未使用余额');}
   const movement=this.inventory.movement(ctx,now,stock,{movement_type:returning?'未用退回':'领用',delta_scaled:returning?quantity:-quantity,original_movement_id:originalId,reason});validateInventory(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'inventory_movement',result_key:String(movement),result_revision:1,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'inventory_movement',key:movement,revision:1},sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 batch(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['create','release'].includes(input.action))fail(422,'INVALID_ACTION','批次动作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission=input.action==='create'?'uc32.record':'uc32.approve',digest=hash(canonical({permission,input}));this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='material_batch')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');if(!this.db.prepare('SELECT 1 FROM material_batch WHERE id=? AND branch_id=?').get(Number(old.result_key),branch))fail(409,'INVENTORY_BRANCH_UNKNOWN','原批次归属待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const now=this.auth.now(),before=inventorySnapshot(this.db);let result,reason;
   if(input.action==='create'){const material=row(this.db,'material',id(input.materialId,'材料'));if(!material.confirmed_at||!material.is_active)fail(409,'MATERIAL_UNCONFIRMED','材料未确认');
    reason=text(input.sourceNote,'到货来源',2000);const batch=insert(this.db,'material_batch',fact(now,{branch_id:branch,material_id:material.id,batch_no:text(input.batchNo,'实物批号',100),expiry_date:input.expiryDate==null?null:dateOnly(input.expiryDate,'效期'),source_note:reason,created_by:ctx.session.staff_id,status:'待检'}));result={kind:'material_batch',key:batch,revision:1};
   }else{const batch=row(this.db,'material_batch',id(input.batchId,'批次'));if(batch.branch_id!==branch)fail(403,'INVENTORY_BRANCH','批次不属于本店');if(batch.status!=='待检')fail(409,'INVALID_STATE','仅待检批次可放行');
    if(this.db.prepare(`SELECT 1 FROM purchase_receipt_item i JOIN purchase_receipt r ON r.id=i.purchase_receipt_id JOIN purchase_order p ON p.id=r.purchase_order_id JOIN stock_location l ON l.id=i.stock_location_id WHERE i.material_batch_id=? AND (p.branch_id IS NOT ? OR l.branch_id IS NOT ?) LIMIT 1`).get(batch.id,branch,branch))fail(409,'INVENTORY_BRANCH_UNKNOWN','批次验收来源门店不一致');
    result=this.inventory.changeBatch(ctx,now,{batchId:batch.id,expectedRevision:input.expectedRevision,reason:input.reason},'可用');reason=result.reason;}
   validateInventory(this.db,before);const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'material_batch',result_key:String(result.key),result_revision:result.revision,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',result,sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
 count(credentials,input){if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');if(!input||input.commandVersion!==1||!['count','recount','approve','reject'].includes(input.action))fail(422,'INVALID_ACTION','盘点动作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission=['count','recount'].includes(input.action)?'uc18.record':'uc18.approve',digest=hash(canonical({permission,input}));
  this.db.exec('BEGIN IMMEDIATE');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);let count=null,stockId;
   if(input.action==='count')stockId=id(input.stockId,'库存');else{count=row(this.db,'stock_count',id(input.countId,'盘点'));stockId=count.batch_stock_id;}
   const {stock}=this.scope(stockId,branch);ctx.authority={...ctx.authority,branchId:branch,stockId,countId:count?.id||null};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='stock_count')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他内容');
    if(!this.db.prepare('SELECT 1 FROM stock_count WHERE id=? AND batch_stock_id=?').get(Number(old.result_key),stockId))fail(409,'INVENTORY_BRANCH_UNKNOWN','原盘点归属待核对');this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const now=this.auth.now(),before=inventorySnapshot(this.db),history=this.unit.workflowHistory.snapshot();let countId,rev,previous=null,reason,code='COMMITTED';
   if(input.action==='count'||input.action==='recount'){
    revision(stock,input.expectedStockRevision);const at=instant(input.countedAt,'实点时间');if(at>now||at<stock.updated_at)fail(422,'COUNT_TIME','实点须已发生且不早于当前库存快照');
    const qty=integer(input.countedQuantityScaled,'实点量',true);reason=text(input.reason,'实点依据',2000);
    if(input.action==='count'){
     if(this.db.prepare("SELECT 1 FROM stock_count WHERE batch_stock_id=? AND status IN ('待确认差异','待重新核对')").get(stockId))fail(409,'COUNT_PENDING','该库存已有未完成盘点');
     countId=insert(this.db,'stock_count',fact(now,{batch_stock_id:stockId,snapshot_quantity_scaled:stock.quantity_scaled,counted_quantity_scaled:qty,stock_revision:stock.revision,counted_at:at,reason,confirmed_at:null,review_note:null,operator_id:ctx.session.staff_id,confirmed_by:null,status:'待确认差异'}));rev=1;
     this.unit.workflowHistory.append('stock_count',countId,'提交',reason,ctx,input,now);
    }else{revision(count,input.expectedRevision);if(count.status!=='待重新核对')fail(409,'INVALID_STATE','只有待重新核对的盘点可以重新实点');
     this.db.prepare("UPDATE stock_count SET snapshot_quantity_scaled=?,counted_quantity_scaled=?,stock_revision=?,counted_at=?,operator_id=?,reason=?,status='待确认差异',review_note=NULL,confirmed_by=NULL,confirmed_at=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(stock.quantity_scaled,qty,stock.revision,at,ctx.session.staff_id,reason,now,count.id);
     countId=count.id;previous=count.revision;rev=count.revision+1;this.unit.workflowHistory.append('stock_count',countId,'重新实点',reason,ctx,input,now);}
   }else{
    revision(count,input.expectedRevision);if(count.status!=='待确认差异')fail(409,'INVALID_STATE','请先重新实点并提出差异');reason=text(input.reviewNote,'负责人意见',2000);
    if(input.action==='reject')this.db.prepare("UPDATE stock_count SET status='不予调整',confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,reason,now,count.id);
    else if(stock.revision!==count.stock_revision||stock.quantity_scaled!==count.snapshot_quantity_scaled){this.db.prepare("UPDATE stock_count SET status='待重新核对',review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,count.id);code='COUNT_RECHECK_REQUIRED';}
    else{this.db.prepare("UPDATE stock_count SET status='差异已确认',confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,reason,now,count.id);
     const delta=count.counted_quantity_scaled-count.snapshot_quantity_scaled;if(delta)this.inventory.movement(ctx,now,stock,{movement_type:'盘点',delta_scaled:delta,stock_count_id:count.id,reason});}
    countId=count.id;previous=count.revision;rev=count.revision+1;this.unit.workflowHistory.append('stock_count',countId,code==='COUNT_RECHECK_REQUIRED'?'版本不符':input.action==='reject'?'拒绝':'同意',reason,ctx,input,now);
   }
   validateInventory(this.db,before);this.unit.workflowHistory.validate(history,permission);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'stock_count',result_key:String(countId),result_revision:rev,result_code:code,correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更',code,{kind:'stock_count',key:countId,beforeRevision:previous,revision:rev},sid,reason);this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}}
}
module.exports={ChainInventoryTrial};
