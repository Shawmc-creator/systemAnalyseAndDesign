'use strict';
const { fail, text, id, instant, dateOnly, day, row, revision, insert, fact, recordNo } = require('./common');
const { integer, safe } = require('./inventory-gates');
const UNIT_FIELDS = ['base_unit','purchase_unit','conversion_numerator','conversion_denominator','quantity_scale'];
class Inventory {
  constructor(db,unit) { Object.assign(this,{db,unit}); }
  materialFields(input) {
    const scale = integer(input.quantityScale,'数量小数位',true);
    if (scale > 6 || typeof input.requiresTrace !== 'boolean' || typeof input.requiresExpiry !== 'boolean') fail(422,'MATERIAL_FIELDS','数量精度为0至6，追溯和效期要求必须明确');
    return { name:text(input.name,'材料名称'), specification:text(input.specification,'规格'), base_unit:text(input.baseUnit,'基本单位',40),
      purchase_unit:text(input.purchaseUnit,'采购单位',40), conversion_numerator:integer(input.conversionNumerator,'换算分子'),
      conversion_denominator:integer(input.conversionDenominator,'换算分母'), quantity_scale:scale, requires_trace:+input.requiresTrace, requires_expiry:+input.requiresExpiry };
  }
  hasLedger(materialId) { return !!this.db.prepare('SELECT x.id FROM inventory_movement x JOIN batch_stock s ON s.id=x.batch_stock_id JOIN material_batch b ON b.id=s.material_batch_id WHERE b.material_id=? LIMIT 1').get(materialId); }
  batchContext(batchId) { const batch=row(this.db,'material_batch',batchId); return { batch, material:row(this.db,'material',batch.material_id) }; }
  available(batch,material,location,now) {
    return batch.status==='可用' && material.is_active===1 && material.confirmed_at!=null && location.is_active===1 && batch.expiry_date!=null && batch.expiry_date>=day(now);
  }
  stockContext(input,now,usable=false) {
    const stock=row(this.db,'batch_stock',input.stockId); revision(stock,input.expectedStockRevision);
    const {batch,material}=this.batchContext(stock.material_batch_id), location=row(this.db,'stock_location',stock.stock_location_id);
    if (usable && !this.available(batch,material,location,now)) fail(409,'BATCH_UNAVAILABLE','材料、批次或位置不可用，效期未知或已经过期');
    return {stock,batch,material,location};
  }
  movement(ctx,now,stock,fields) {
    const delta=fields.delta_scaled, after=safe(BigInt(stock.quantity_scaled)+BigInt(delta));
    if (after<0) fail(409,'STOCK_INSUFFICIENT','当前批次位置库存不足');
    return insert(this.db,'inventory_movement',fact(now,{batch_stock_id:stock.id,original_movement_id:null,stock_count_id:null,purchase_receipt_item_id:null,purchase_issue_id:null,
      before_scaled:stock.quantity_scaled,after_scaled:after,occurred_at:now,operator_id:ctx.session.staff_id,...fields}));
  }
  record(credentials,input) {
    return this.unit.command(credentials,'uc32.record',input,(ctx,now)=>{
      if(input.action==='material') {
        const fields=this.materialFields(input); let key=input.materialId;
        if(key!=null) {
          const old=row(this.db,'material',key); revision(old,input.expectedRevision);
          const structural=[...UNIT_FIELDS,'requires_trace','requires_expiry'].some(k=>old[k]!==fields[k]);
          if(structural && (this.hasLedger(key)||this.db.prepare('SELECT id FROM purchase_order_item WHERE material_id=? LIMIT 1').get(key))) fail(409,'MATERIAL_UNITS_FROZEN','已有采购或流水的单位、精度及追溯效期要求不能改写');
          this.db.prepare(`UPDATE material SET name=?,specification=?,base_unit=?,purchase_unit=?,conversion_numerator=?,conversion_denominator=?,quantity_scale=?,requires_trace=?,requires_expiry=?,
            confirmed_at=?,confirmed_by=?,is_active=?,updated_at=?,revision=revision+1 WHERE id=?`).run(...Object.values(fields),structural?null:old.confirmed_at,structural?null:old.confirmed_by,structural?0:old.is_active,now,key);
          return {kind:'material',key,beforeRevision:old.revision,revision:old.revision+1,reason:text(input.reason,'维护依据'),changes:Object.keys(fields).filter(k=>fields[k]!==old[k]).map(k=>({field:k,before:old[k],after:fields[k]}))};
        }
        key=insert(this.db,'material',fact(now,{...fields,confirmed_at:null,confirmed_by:null,is_active:0,created_by:ctx.session.staff_id,record_no:recordNo('MAT')}));
        return {kind:'material',key,revision:1,reason:text(input.reason,'材料建档依据')};
      }
      if(input.action==='location') {
        const key=insert(this.db,'stock_location',fact(now,{name:text(input.name,'位置名称'),purpose:text(input.purpose,'存放用途'),is_active:1,created_by:ctx.session.staff_id,record_no:recordNo('LOC')}));
        return {kind:'stock_location',key,revision:1,reason:text(input.reason,'位置建档依据')};
      }
      if(input.action==='batch') {
        const material=row(this.db,'material',input.materialId);
        if(!material.confirmed_at || !material.is_active) fail(409,'MATERIAL_UNCONFIRMED','先确认材料与单位，再建立批次');
        const key=insert(this.db,'material_batch',fact(now,{material_id:material.id,batch_no:text(input.batchNo,'实物批号',100),expiry_date:input.expiryDate==null?null:dateOnly(input.expiryDate,'效期'),
          source_note:text(input.sourceNote,'批次到货来源',2000),created_by:ctx.session.staff_id,status:'待检'}));
        return {kind:'material_batch',key,revision:1,reason:'按实物来源建批次，待检不代表可领用'};
      }
      if(input.action==='isolate') return this.changeBatch(ctx,now,input,'隔离');
      fail(422,'INVALID_ACTION','材料维护操作无效');
    });
  }
  changeBatch(ctx,now,input,status) {
    const {batch,material}=this.batchContext(input.batchId); revision(batch,input.expectedRevision);
    const reason=text(input.reason,'状态处理依据',2000);
    const expiry=input.expiryDate===undefined?batch.expiry_date:(input.expiryDate==null?null:dateOnly(input.expiryDate,'核实效期'));
    if(status==='可用') {
      if(!material.confirmed_at || !material.is_active || !expiry || expiry<day(now)) fail(409,'BATCH_UNAVAILABLE','恢复须已确认材料和实际有效期；未知效期不能当作无限有效');
      if(!this.db.prepare(`SELECT r.id FROM purchase_receipt_item r JOIN purchase_receipt h ON h.id=r.purchase_receipt_id
        WHERE r.material_batch_id=? AND r.accepted_quantity_scaled>0 AND h.accepted_at IS NOT NULL AND h.confirmed_by IS NOT NULL`).get(batch.id)) fail(409,'BATCH_ACCEPTANCE_REQUIRED','须有该批次已认可的合格验收范围');
      if(this.db.prepare(`SELECT i.id FROM purchase_issue i JOIN purchase_receipt_item r ON r.id=i.purchase_receipt_item_id
        WHERE r.material_batch_id=? AND i.status IN ('待确认','待处理')`).get(batch.id)) fail(409,'BATCH_UNRESOLVED','该批次仍有待处理采购异常');
    }
    if(status==='过期' && (!expiry || expiry>=day(now))) fail(409,'BATCH_NOT_EXPIRED','只有实际已过效期的批次可标记过期');
    this.db.prepare('UPDATE material_batch SET status=?,expiry_date=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,expiry,now,batch.id);
    insert(this.db,'batch_change',fact(now,{material_batch_id:batch.id,old_status:batch.status,new_status:status,reason,confirmed_at:now,operator_id:ctx.session.staff_id,confirmed_by:ctx.session.staff_id}));
    return {kind:'material_batch',key:batch.id,beforeRevision:batch.revision,revision:batch.revision+1,reason,changes:[{field:'status',before:batch.status,after:status},{field:'expiry_date',before:batch.expiry_date,after:expiry}]};
  }
  approve(credentials,input) {
    return this.unit.command(credentials,'uc32.approve',input,(ctx,now)=>{
      if(input.action==='confirmMaterial' || input.action==='deactivateMaterial') {
        const m=row(this.db,'material',input.materialId); revision(m,input.expectedRevision);
        const active=input.action==='confirmMaterial';
        this.db.prepare('UPDATE material SET confirmed_at=?,confirmed_by=?,is_active=?,updated_at=?,revision=revision+1 WHERE id=?').run(now,ctx.session.staff_id,+active,now,m.id);
        return {kind:'material',key:m.id,beforeRevision:m.revision,revision:m.revision+1,reason:text(input.reason,'负责人核实依据',2000),changes:[{field:'is_active',before:m.is_active,after:+active}]};
      }
      const statuses={release:'可用',restore:'可用',disable:'停用',expire:'过期'};
      if(input.action==='verifyExpiry') {
        const batch=row(this.db,'material_batch',input.batchId);
        if(batch.status==='过期') fail(409,'BATCH_UNAVAILABLE','已过期终态不能通过修改效期延长使用');
        const expiry=dateOnly(input.expiryDate,'核实效期');
        const status=expiry<day(now)&&['待检','可用','隔离'].includes(batch.status)?'过期':batch.status;
        return this.changeBatch(ctx,now,input,status);
      }
      if(!statuses[input.action]) fail(422,'INVALID_ACTION','批次确认操作无效');
      return this.changeBatch(ctx,now,input,statuses[input.action]);
    });
  }
  recordMovement(credentials,input) {
    return this.unit.command(credentials,'uc18.record',input,(ctx,now)=>{
      if(input.action==='recount') {
        const count=row(this.db,'stock_count',input.countId); revision(count,input.expectedRevision);
        if(count.status!=='待重新核对') fail(409,'INVALID_STATE','只有待重新核对的盘点可以重新实点');
        const stock=row(this.db,'batch_stock',count.batch_stock_id); revision(stock,input.expectedStockRevision);
        const at=instant(input.countedAt,'重新实点时刻');
        if(at>now || at<stock.updated_at) fail(422,'COUNT_TIME','实点时刻必须已发生且不早于当前库存快照');
        const quantity=integer(input.countedQuantityScaled,'实点量',true),reason=text(input.reason,'重新核对依据');
        this.db.prepare("UPDATE stock_count SET snapshot_quantity_scaled=?,counted_quantity_scaled=?,stock_revision=?,counted_at=?,operator_id=?,reason=?,status='待确认差异',updated_at=?,revision=revision+1 WHERE id=?")
          .run(stock.quantity_scaled,quantity,stock.revision,at,ctx.session.staff_id,reason,now,count.id);
        const after={counted_quantity_scaled:quantity,snapshot_quantity_scaled:stock.quantity_scaled,stock_revision:stock.revision,counted_at:at,operator_id:ctx.session.staff_id,reason};
        return {kind:'stock_count',key:count.id,beforeRevision:count.revision,revision:count.revision+1,reason:'按新实点与当前库存重新提出差异',changes:Object.keys(after).map(k=>({field:k,before:count[k],after:after[k]}))};
      }
      const {stock}=this.stockContext(input,now,['issue','return'].includes(input.action));
      if(input.action==='count') {
        if(this.db.prepare("SELECT id FROM stock_count WHERE batch_stock_id=? AND status IN ('待确认差异','待重新核对')").get(stock.id)) fail(409,'COUNT_PENDING','该批次位置已有未完成盘点');
        const at=instant(input.countedAt,'实点时刻');
        if(at>now || at<stock.updated_at) fail(422,'COUNT_TIME','实点时刻必须已发生且不早于当前库存快照');
        const key=insert(this.db,'stock_count',fact(now,{batch_stock_id:stock.id,snapshot_quantity_scaled:stock.quantity_scaled,counted_quantity_scaled:integer(input.countedQuantityScaled,'实点量',true),
          stock_revision:stock.revision,counted_at:at,reason:text(input.reason,'盘点依据'),confirmed_at:null,review_note:null,operator_id:ctx.session.staff_id,confirmed_by:null,status:'待确认差异'}));
        return {kind:'stock_count',key,revision:1,reason:'仅保存盘点快照，负责人确认前不调整余额'};
      }
      const quantity=integer(input.quantityScaled), reason=text(input.reason,'实际办理依据',2000);
      if(input.action==='issue') {
        const key=this.movement(ctx,now,stock,{movement_type:'领用',delta_scaled:-quantity,reason});
        return {kind:'inventory_movement',key,revision:1,reason};
      }
      const original=row(this.db,'inventory_movement',input.originalMovementId);
      if(original.batch_stock_id!==stock.id || original.movement_type!=='领用') fail(409,'ISSUE_SOURCE','请引用该批次位置的真实原领用');
      if(input.action==='return') {
        const key=this.movement(ctx,now,stock,{movement_type:'未用退回',delta_scaled:quantity,original_movement_id:original.id,reason});
        return {kind:'inventory_movement',key,revision:1,reason};
      }
      if(input.action==='use') {
        const visit=row(this.db,'visit',input.visitId), at=instant(input.usedAt,'实际使用时刻');
        if(visit.patient_id!==input.patientId) fail(409,'PATIENT_MISMATCH','实际使用就诊与当前患者不一致');
        if(!visit.started_at || !['接诊中','诊疗结束'].includes(visit.status) || at<visit.started_at || at<original.occurred_at || at>now || visit.ended_at && at>visit.ended_at) fail(409,'USAGE_NOT_ACTUAL','实际用料须发生于真实接诊和原领用之后');
        const key=insert(this.db,'material_usage',fact(now,{inventory_movement_id:original.id,visit_id:visit.id,quantity_scaled:quantity,used_at:at,note:reason,operator_id:ctx.session.staff_id}));
        return {kind:'material_usage',key,revision:1,reason:'实际用料仅记录去向，领用时已经扣库'};
      }
      fail(422,'INVALID_ACTION','库存办理动作无效');
    });
  }
  approveCount(credentials,input) {
    return this.unit.command(credentials,'uc18.approve',input,(ctx,now)=>{
      const count=row(this.db,'stock_count',input.countId); revision(count,input.expectedRevision);
      if(count.status!=='待确认差异') fail(409,'INVALID_STATE','请先重新实点并提出当前差异');
      const stock=row(this.db,'batch_stock',count.batch_stock_id), reason=text(input.reviewNote,'负责人意见',2000);
      if(input.action==='reject') {
        this.db.prepare("UPDATE stock_count SET status='不予调整',confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,reason,now,count.id);
      } else if(input.action==='approveCount') {
        if(stock.revision!==count.stock_revision || stock.quantity_scaled!==count.snapshot_quantity_scaled) {
          this.db.prepare("UPDATE stock_count SET status='待重新核对',review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,count.id);
          return {kind:'stock_count',key:count.id,beforeRevision:count.revision,revision:count.revision+1,code:'COUNT_RECHECK_REQUIRED',reason:'盘点期间库存已变化，保留原快照并要求重新实点'};
        }
        this.db.prepare("UPDATE stock_count SET status='差异已确认',confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,reason,now,count.id);
        const delta=count.counted_quantity_scaled-count.snapshot_quantity_scaled;
        if(delta) this.movement(ctx,now,stock,{movement_type:'盘点',delta_scaled:delta,stock_count_id:count.id,reason});
      } else fail(422,'INVALID_ACTION','盘点确认动作无效');
      return {kind:'stock_count',key:count.id,beforeRevision:count.revision,revision:count.revision+1,reason};
    });
  }
  query(credentials,input={}) {
    return this.unit.query(credentials,'uc17.query',ctx=>{
      const page=Number(input.page||1),size=Number(input.pageSize||30);
      if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100) fail(422,'INVALID_PAGE','分页参数无效');
      if(input.expiryBefore!=null) dateOnly(input.expiryBefore);
      if(input.status!=null && !['待检','可用','隔离','停用','过期'].includes(input.status)) fail(422,'INVALID_FILTER','批次状态无效');
      const materials=this.db.prepare('SELECT * FROM material ORDER BY id').all().filter(m=>input.materialId==null||m.id===Number(input.materialId));
      const batches=this.db.prepare('SELECT * FROM material_batch ORDER BY id').all().filter(b=>materials.some(m=>m.id===b.material_id) && (!input.batchNo||b.batch_no===input.batchNo) && (!input.status||b.status===input.status) && (!input.expiryBefore||b.expiry_date && b.expiry_date<=input.expiryBefore));
      const entries=[];
      for(const batch of batches) {
        const material=materials.find(m=>m.id===batch.material_id);
        const stocks=this.db.prepare('SELECT * FROM batch_stock WHERE material_batch_id=? ORDER BY id').all(batch.id).filter(s=>input.locationId==null||s.stock_location_id===Number(input.locationId));
        if(!stocks.length && input.locationId==null) entries.push({batch,material,stock:null,availableQuantityScaled:0,availability:'尚无分处库存'});
        for(const stock of stocks) {
          const location=row(this.db,'stock_location',stock.stock_location_id),available=this.available(batch,material,location,this.unit.auth.now());
          const movements=this.db.prepare('SELECT * FROM inventory_movement WHERE batch_stock_id=? ORDER BY id').all(stock.id);
          const usages=this.db.prepare(`SELECT u.id,u.inventory_movement_id,u.visit_id,v.record_no visit_no,u.quantity_scaled,u.used_at,u.operator_id
            FROM material_usage u JOIN inventory_movement m ON m.id=u.inventory_movement_id JOIN visit v ON v.id=u.visit_id WHERE m.batch_stock_id=? ORDER BY u.id`).all(stock.id);
          entries.push({batch,material,stock,location,availableQuantityScaled:available?stock.quantity_scaled:0,availability:available?'可用':!batch.expiry_date?'效期未知':batch.expiry_date<day(this.unit.auth.now())?'实际已过期':'待检、隔离、停用或材料/位置未启用',
            movements,usages,counts:this.db.prepare('SELECT * FROM stock_count WHERE batch_stock_id=? ORDER BY id').all(stock.id),changes:this.db.prepare('SELECT * FROM batch_change WHERE material_batch_id=? ORDER BY id').all(batch.id)});
        }
      }
      const items=entries.slice((page-1)*size,page*size);ctx.authority.returnedStockIds=items.map(e=>e.stock?.id).filter(Boolean);
      return {page,pageSize:size,total:entries.length,computedAt:this.unit.auth.now(),materials,locations:this.db.prepare('SELECT * FROM stock_location').all(),items};
    });
  }
}
module.exports={Inventory};
