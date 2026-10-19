'use strict';
const { fail,text,id,instant,day,row,revision,insert,fact,recordNo,canonical }=require('./common');
const {integer,safe,receiptAmount}=require('./inventory-gates');
const {sum,issueData,approvedIssues,acceptanceLimit,fundOfOrder,touchFunds}=require('./supply-rules');
class Purchases {
  constructor(db,unit,inventory) { Object.assign(this,{db,unit,inventory}); }
  supplier(credentials,input) {
    return this.unit.command(credentials,'uc27.supplier',input,(ctx,now)=>{
      if(typeof input.isActive!=='boolean') fail(422,'SUPPLIER_FIELDS','须明确供应商是否启用');
      const fields={name:text(input.name,'供应商名称'),contact_name:text(input.contactName,'联系人'),phone:text(input.phone,'联系电话',100),
        address:input.address==null?null:text(input.address,'地址'),settlement_basis:text(input.settlementBasis,'负责人核验的结算依据',4000),is_active:+input.isActive};
      const reason=text(input.reason,'供应商核验依据',2000);
      if(input.supplierId!=null) {
        const s=row(this.db,'supplier',input.supplierId);revision(s,input.expectedRevision);
        this.db.prepare('UPDATE supplier SET name=?,contact_name=?,phone=?,address=?,settlement_basis=?,is_active=?,verified_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(...Object.values(fields),ctx.session.staff_id,now,s.id);
        return {kind:'supplier',key:s.id,beforeRevision:s.revision,revision:s.revision+1,reason,changes:Object.keys(fields).filter(k=>s[k]!==fields[k]).map(k=>({field:k,before:s[k],after:fields[k]}))};
      }
      const key=insert(this.db,'supplier',fact(now,{...fields,created_by:ctx.session.staff_id,verified_by:ctx.session.staff_id,record_no:recordNo('SUP')}));
      insert(this.db,'supplier_funds',fact(now,{supplier_id:key,opened_at:now,opened_by:ctx.session.staff_id}));
      return {kind:'supplier',key,revision:1,reason};
    });
  }
  itemFields(input) {
    const m=row(this.db,'material',input.materialId);revision(m,input.expectedMaterialRevision);
    if(!m.is_active||!m.confirmed_at) fail(409,'MATERIAL_UNCONFIRMED','采购前须确认材料单位');
    return {material_id:m.id,ordered_quantity_scaled:integer(input.orderedQuantityScaled,'基本单位放大后的约定量'),unit_price_cents:integer(input.unitPriceCents,'采购单位单价',true),
      purchase_unit:m.purchase_unit,conversion_numerator:m.conversion_numerator,conversion_denominator:m.conversion_denominator,quantity_scale:m.quantity_scale};
  }
  draft(credentials,input) {
    return this.unit.command(credentials,'uc27.draft',input,(ctx,now)=>{
      if(input.action==='create') {
        const s=row(this.db,'supplier',input.supplierId);revision(s,input.expectedSupplierRevision);
        if(!s.is_active) fail(409,'SUPPLIER_INACTIVE','停用供应商不能形成新采购');
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail(422,'PURCHASE_EMPTY','采购须有1至100个明确项目');
        const items=input.items.map(i=>this.itemFields(i));
        if(new Set(items.map(i=>i.material_id)).size!==items.length) fail(422,'PURCHASE_DUPLICATE_ITEM','同一材料请合并为一项采购约定');
        const agreed=instant(input.agreedAt,'供货约定时刻');if(agreed>now) fail(422,'PURCHASE_TIME','约定时刻不能是未来');
        const key=insert(this.db,'purchase_order',fact(now,{supplier_id:s.id,agreed_at:agreed,delivery_terms:text(input.deliveryTerms,'交付条件',2000),
          request_reason:text(input.reason,'采购需求依据',2000),created_by:ctx.session.staff_id,confirmed_at:null,confirmed_by:null,status:'待确认',record_no:recordNo('PO')}));
        items.forEach((i,n)=>insert(this.db,'purchase_order_item',fact(now,{...i,purchase_order_id:key,sequence_no:n+1,status:'待交付'})));
        return {kind:'purchase_order',key,revision:1,reason:'助理提出采购，尚未形成库存或实际付款'};
      }
      if(input.action!=='updateItem') fail(422,'INVALID_ACTION','采购录入动作无效');
      const p=row(this.db,'purchase_order',input.purchaseId);revision(p,input.expectedRevision);
      if(p.status!=='待确认'||p.created_by!==ctx.session.staff_id) fail(403,'PURCHASE_DRAFT_SCOPE','仅原录入助理可调整待确认采购');
      const i=row(this.db,'purchase_order_item',input.itemId);revision(i,input.expectedItemRevision);
      if(i.purchase_order_id!==p.id||i.material_id!==input.materialId) fail(409,'PURCHASE_ITEM_SOURCE','不能将原采购项目改指另一材料或采购');
      const fields=this.itemFields(input);
      this.db.prepare('UPDATE purchase_order_item SET ordered_quantity_scaled=?,unit_price_cents=?,purchase_unit=?,conversion_numerator=?,conversion_denominator=?,quantity_scale=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(fields.ordered_quantity_scaled,fields.unit_price_cents,fields.purchase_unit,fields.conversion_numerator,fields.conversion_denominator,fields.quantity_scale,now,i.id);
      this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,p.id);
      return {kind:'purchase_order',key:p.id,beforeRevision:p.revision,revision:p.revision+1,reason:text(input.reason,'采购修改依据'),changes:[{field:'item:'+i.id,before:i,after:fields}]};
    });
  }
  approve(credentials,input) {
    return this.unit.command(credentials,'uc27.approve',input,(ctx,now)=>{
      const p=row(this.db,'purchase_order',input.purchaseId);revision(p,input.expectedRevision);
      if(p.status!=='待确认') fail(409,'PURCHASE_SEALED','采购已确认或取消；已有约定不能追改');
      const reason=text(input.reviewNote,'负责人核实意见',2000);
      if(input.action==='cancel') {
        this.db.prepare("UPDATE purchase_order SET status='已取消',updated_at=?,revision=revision+1 WHERE id=?").run(now,p.id);
      } else if(input.action==='approve') {
        const s=row(this.db,'supplier',p.supplier_id);revision(s,input.expectedSupplierRevision);
        if(!s.is_active) fail(409,'SUPPLIER_INACTIVE','供应商当前停用，请核对原需求');
        const items=this.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(p.id);
        if(!items.length) fail(409,'PURCHASE_EMPTY','不能确认空采购');
        for(const i of items) {
          const m=row(this.db,'material',i.material_id);
          if(!m.is_active||!m.confirmed_at||['purchase_unit','conversion_numerator','conversion_denominator','quantity_scale'].some(k=>i[k]!==m[k])) fail(409,'PURCHASE_UNITS_CHANGED','材料或单位已变化，请核对并修改原草稿项目');
          receiptAmount(i,i.ordered_quantity_scaled);
        }
        this.db.prepare("UPDATE purchase_order SET status='已确认',confirmed_at=?,confirmed_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,now,p.id);
        ctx.authority.supplierRevision=s.revision;
      } else fail(422,'INVALID_ACTION','采购审核动作无效');
      return {kind:'purchase_order',key:p.id,beforeRevision:p.revision,revision:p.revision+1,reason};
    });
  }
  totals(itemId,except=null) {
    const rows=this.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_order_item_id=? AND id<>?').all(itemId,except||-1);
    return {arrived:rows.reduce((n,r)=>n+BigInt(r.arrived_quantity_scaled),0n),accepted:rows.reduce((n,r)=>n+BigInt(r.accepted_quantity_scaled),0n)};
  }
  validateAcceptance(item,batch,location,accepted,now,except=null) {
    if(batch.material_id!==item.material_id) fail(409,'RECEIPT_MATERIAL','批次与采购材料不一致');
    const material=row(this.db,'material',item.material_id);
    if(accepted>0 && (!material.confirmed_at||!material.is_active||!location.is_active||!['待检','可用'].includes(batch.status)||!batch.expiry_date||batch.expiry_date<day(now))) fail(409,'RECEIPT_UNAVAILABLE','合格认可须有有效材料、位置、批次和实际有效期');
    if(this.totals(item.id,except).accepted+BigInt(accepted)>acceptanceLimit(this.db,item)) fail(409,'PURCHASE_ACCEPTANCE_LIMIT','合格认可不能超出采购约定及已实际退供的换货范围');
  }
  stockAccepted(ctx,now,receiptItemId,delta,batchId,locationId) {
    if(!delta) return;
    let stock=this.db.prepare('SELECT * FROM batch_stock WHERE material_batch_id=? AND stock_location_id=?').get(batchId,locationId);
    if(!stock) { const key=insert(this.db,'batch_stock',fact(now,{material_batch_id:batchId,stock_location_id:locationId,quantity_scaled:0}));stock=row(this.db,'batch_stock',key); }
    this.inventory.movement(ctx,now,stock,{movement_type:'验收入库',delta_scaled:delta,purchase_receipt_item_id:receiptItemId,reason:'按本次新增合格认可量入库；批次放行另核实'});
  }
  progress(purchaseId,now) {
    for(const item of this.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(purchaseId)) {
      const lines=this.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_order_item_id=?').all(item.id);
      const issues=approvedIssues(this.db,item.id);
      if(!lines.length&&!issues.length||['履行已完成','剩余已取消'].includes(item.status))continue;
      const canceled=sum(issues.filter(i=>issueData(i).action==='cancelRemainder'),'quantity_scaled');
      const refundReturn=sum(issues.filter(i=>i.issue_kind==='已入库退供'&&issueData(i).action==='return'),'quantity_scaled');
      const returns=-sum(this.db.prepare("SELECT m.delta_scaled FROM inventory_movement m JOIN purchase_issue i ON i.id=m.purchase_issue_id WHERE i.purchase_order_item_id=? AND m.movement_type='退供'").all(item.id),'delta_scaled');
      const accepted=sum(lines,'accepted_quantity_scaled')-returns,target=BigInt(item.ordered_quantity_scaled)-canceled-refundReturn;
      const replacementIds=new Set(issues.flatMap(i=>issueData(i).replacementReceiptItemIds||[]));
      const arrived=sum(lines.filter(r=>!replacementIds.has(r.id)),'arrived_quantity_scaled');
      const unresolved=issues.some(i=>i.status==='待处理')||lines.some(r=>r.pending_quantity_scaled>0||BigInt(r.rejected_quantity_scaled)>sum(issues.filter(i=>i.status==='已完成'&&i.issue_kind==='拒收'&&i.purchase_receipt_item_id===r.id),'quantity_scaled'))||arrived>BigInt(item.ordered_quantity_scaled);
      const finished=accepted===target;
      const status=unresolved?'待差异处理':finished&&canceled>0&&['待交付','履行中'].includes(item.status)?'剩余已取消':finished?'履行已完成':'履行中';
      if(item.status!==status) this.db.prepare('UPDATE purchase_order_item SET status=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,now,item.id);
    }
  }
  receive(credentials,input) {
    return this.unit.command(credentials,'uc28.receive',input,(ctx,now)=>{
      if(input.action==='proposeIssue')return this.issues.propose(ctx,now,input);
      if(input.action==='returnGoods')return this.issues.returnGoods(ctx,now,input);
      if(input.action==='receive') {
        const p=row(this.db,'purchase_order',input.purchaseId);revision(p,input.expectedPurchaseRevision);
        if(p.status!=='已确认') fail(409,'PURCHASE_UNCONFIRMED','先确认采购约定，再登记验收');
        const arrived=instant(input.arrivedAt,'实际到货时刻');
        if(arrived>now||arrived<p.agreed_at) fail(422,'RECEIPT_TIME','到货须实际发生且不早于供货约定');
        const evidence=text(input.deliveryEvidence,'供应商随货单号及依据',1000);
        if(this.db.prepare(`SELECT r.id FROM purchase_receipt r JOIN purchase_order p ON p.id=r.purchase_order_id WHERE p.supplier_id=? AND r.delivery_evidence=?`).get(p.supplier_id,evidence)) fail(409,'DELIVERY_DUPLICATE','同供应商的该随货依据已经登记，请查询原验收');
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail(422,'RECEIPT_EMPTY','验收须有1至100个到货项目');
        const parsed=input.items.map(line=>{
          const item=row(this.db,'purchase_order_item',line.purchaseItemId);revision(item,line.expectedItemRevision);
          if(item.purchase_order_id!==p.id || !line.replacementIssueId&&['剩余已取消','履行已完成'].includes(item.status)) fail(409,'PURCHASE_ITEM_SOURCE','项目不属于本采购或已结束正常交付');
          const batch=row(this.db,'material_batch',line.batchId),location=row(this.db,'stock_location',line.locationId);
          const accepted=integer(line.acceptedQuantityScaled,'合格量',true),rejected=integer(line.rejectedQuantityScaled,'拒收量',true),pending=integer(line.pendingQuantityScaled,'待检量',true),qty=integer(line.arrivedQuantityScaled,'到货量');
          if(BigInt(accepted)+BigInt(rejected)+BigInt(pending)!==BigInt(qty)) fail(422,'RECEIPT_QUANTITIES','到货量须等于合格、拒收、待检三类数量之和');
          this.validateAcceptance(item,batch,location,accepted,now);
          let replacement=null;
          if(line.replacementIssueId!=null) {
            replacement=row(this.db,'purchase_issue',line.replacementIssueId);revision(replacement,line.expectedReplacementRevision);
            if(replacement.status!=='待处理'||issueData(replacement).action!=='replace'||replacement.purchase_order_item_id!==item.id)fail(409,'SUPPLY_REPLACEMENT_LINK','换货须引用该项目待处理的已批准原差异');
            if(replacement.issue_kind==='已入库退供') {
              const returned=-sum(this.db.prepare("SELECT delta_scaled FROM inventory_movement WHERE purchase_issue_id=? AND movement_type='退供'").all(replacement.id),'delta_scaled');
              if(returned!==BigInt(replacement.quantity_scaled))fail(409,'SUPPLY_REPLACEMENT_RETURN_REQUIRED','已入库换货须先实际交还批准范围的原实物');
            }
          }
          return {item,batch,location,accepted,rejected,pending,qty,replacement,note:text(line.inspectionNote,'实物验收依据',2000)};
        });
        if(new Set(parsed.map(x=>[x.item.id,x.batch.id,x.location.id].join(':'))).size!==parsed.length) fail(422,'RECEIPT_DUPLICATE_ITEM','同采购项目、批次及位置请合并为一个验收条目');
        const pending=parsed.some(x=>x.pending>0);
        const key=insert(this.db,'purchase_receipt',fact(now,{purchase_order_id:p.id,arrived_at:arrived,delivery_evidence:evidence,accepted_at:now,
          operator_id:ctx.session.staff_id,confirmed_by:ctx.session.staff_id,status:pending?'部分待检':'已确认',record_no:recordNo('PR')}));
        const relatedChanges=[];
        for(const r of parsed) {
          const lineId=insert(this.db,'purchase_receipt_item',fact(now,{purchase_receipt_id:key,purchase_order_item_id:r.item.id,material_batch_id:r.batch.id,stock_location_id:r.location.id,
            arrived_quantity_scaled:r.qty,accepted_quantity_scaled:r.accepted,rejected_quantity_scaled:r.rejected,pending_quantity_scaled:r.pending,accepted_amount_cents:receiptAmount(r.item,r.accepted),inspection_note:r.note}));
          this.stockAccepted(ctx,now,lineId,r.accepted,r.batch.id,r.location.id);
          if(r.replacement) {
            const old=row(this.db,'purchase_issue',r.replacement.id),data=issueData(old);
            const resolution=canonical({...data,replacementReceiptItemIds:[...data.replacementReceiptItemIds,lineId]});
            this.db.prepare('UPDATE purchase_issue SET reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(resolution,now,old.id);
            const updated=this.completeReplacement(old.id,now);
            relatedChanges.push({kind:'purchase_issue',key:old.id,beforeRevision:old.revision,revision:updated.revision,reason:'后续换货验收明确关联原批准差异',changes:[{field:'reason',before:old.reason,after:resolution},{field:'status',before:old.status,after:updated.status}]});
          }
        }
        this.progress(p.id,now);this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,p.id);
        touchFunds(this.db,fundOfOrder(this.db,p.id).id,now);
        ctx.authority.purchaseId=p.id;
        return {kind:'purchase_receipt',key,revision:1,reason:'保存实际到货组成；只为合格增量入库，不自动放行批次或付款',relatedChanges};
      }
      if(input.action!=='inspectPending') fail(422,'INVALID_ACTION','验收动作无效');
      const h=row(this.db,'purchase_receipt',input.receiptId);revision(h,input.expectedRevision);
      const r=row(this.db,'purchase_receipt_item',input.receiptItemId);revision(r,input.expectedItemRevision);
      if(r.purchase_receipt_id!==h.id||r.pending_quantity_scaled===0) fail(409,'RECEIPT_PENDING','该验收条目没有待检数量');
      const accepted=integer(input.newAcceptedQuantityScaled,'本次待检转合格量',true),rejected=integer(input.newRejectedQuantityScaled,'本次待检转拒收量',true);
      if(accepted+rejected===0||BigInt(accepted)+BigInt(rejected)>BigInt(r.pending_quantity_scaled)) fail(422,'RECEIPT_QUANTITIES','本次结论量须在原待检量内');
      const item=row(this.db,'purchase_order_item',r.purchase_order_item_id),batch=row(this.db,'material_batch',r.material_batch_id),location=row(this.db,'stock_location',r.stock_location_id);
      const total=safe(BigInt(r.accepted_quantity_scaled)+BigInt(accepted));this.validateAcceptance(item,batch,location,total,now,r.id);
      const note=text(input.inspectionNote,'后续检验依据',2000);
      const after={accepted_quantity_scaled:total,rejected_quantity_scaled:r.rejected_quantity_scaled+rejected,pending_quantity_scaled:r.pending_quantity_scaled-accepted-rejected,accepted_amount_cents:receiptAmount(item,total)};
      this.db.prepare('UPDATE purchase_receipt_item SET accepted_quantity_scaled=?,rejected_quantity_scaled=?,pending_quantity_scaled=?,accepted_amount_cents=?,inspection_note=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(...Object.values(after),note,now,r.id);
      const stillPending=!!this.db.prepare('SELECT id FROM purchase_receipt_item WHERE purchase_receipt_id=? AND pending_quantity_scaled>0').get(h.id);
      this.db.prepare('UPDATE purchase_receipt SET status=?,updated_at=?,revision=revision+1 WHERE id=?').run(stillPending?'部分待检':'已确认',now,h.id);
      this.stockAccepted(ctx,now,r.id,accepted,batch.id,location.id);this.progress(h.purchase_order_id,now);
      const relatedChanges=[];
      for(const old of this.db.prepare("SELECT * FROM purchase_issue WHERE status='待处理'").all())if(issueData(old).action==='replace'&&issueData(old).replacementReceiptItemIds.includes(r.id)) {
        const current=this.completeReplacement(old.id,now);
        if(old.status!==current.status)relatedChanges.push({kind:'purchase_issue',key:old.id,beforeRevision:old.revision,revision:current.revision,reason:'后续换货待检转为足额合格',changes:[{field:'status',before:old.status,after:current.status}]});
      }
      this.progress(h.purchase_order_id,now);touchFunds(this.db,fundOfOrder(this.db,h.purchase_order_id).id,now);
      this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,h.purchase_order_id);
      ctx.authority.receiptItemId=r.id;ctx.authority.itemBeforeRevision=r.revision;ctx.authority.itemAfterRevision=r.revision+1;
      return {kind:'purchase_receipt',key:h.id,beforeRevision:h.revision,revision:h.revision+1,reason:'按检验结论追加认可量，原到货与旧合格量保留',relatedChanges,changes:[...Object.keys(after).map(k=>({field:'item:'+r.id+':'+k,before:r[k],after:after[k]})),{field:'item:'+r.id+':inspection_note',before:r.inspection_note,after:note}]};
    });
  }
  completeReplacement(issueId,now) {
    const issue=row(this.db,'purchase_issue',issueId),data=issueData(issue);
    const accepted=data.replacementReceiptItemIds.reduce((n,key)=>n+BigInt(row(this.db,'purchase_receipt_item',key).accepted_quantity_scaled),0n);
    if(accepted===BigInt(issue.quantity_scaled))this.db.prepare("UPDATE purchase_issue SET status='已完成',resolved_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,now,issue.id);
    return row(this.db,'purchase_issue',issue.id);
  }
  query(credentials,input={}) {
    return this.unit.query(credentials,credentials.role==='manager'?'uc27.approve':'uc27.draft',ctx=>{
      const page=Number(input.page||1),size=Number(input.pageSize||30);
      if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100) fail(422,'INVALID_PAGE','分页参数无效');
      const all=this.db.prepare('SELECT * FROM purchase_order ORDER BY id DESC').all().filter(p=>(input.purchaseId==null||p.id===Number(input.purchaseId))&&(input.supplierId==null||p.supplier_id===Number(input.supplierId)));
      const items=all.slice((page-1)*size,page*size).map(p=>({...p,items:this.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=? ORDER BY sequence_no').all(p.id),
        receipts:this.db.prepare('SELECT * FROM purchase_receipt WHERE purchase_order_id=? ORDER BY id').all(p.id).map(r=>({...r,items:this.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_receipt_id=? ORDER BY id').all(r.id)})),
        issues:this.db.prepare('SELECT i.* FROM purchase_issue i JOIN purchase_order_item p ON p.id=i.purchase_order_item_id WHERE p.purchase_order_id=? ORDER BY i.id').all(p.id)}));
      const suppliers=this.db.prepare('SELECT * FROM supplier ORDER BY id').all().map(s=>credentials.role==='manager'?s:{id:s.id,name:s.name,contact_name:s.contact_name,phone:s.phone,is_active:s.is_active,revision:s.revision});
      ctx.authority.returnedPurchaseIds=items.map(p=>p.id);
      return {page,pageSize:size,total:all.length,items,suppliers,computedAt:this.unit.auth.now()};
    });
  }
}
module.exports={Purchases};
