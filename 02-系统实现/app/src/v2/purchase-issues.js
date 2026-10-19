'use strict';
const {fail,text,row,revision,insert,fact,canonical,instant}=require('./common');
const {integer,safe,receiptAmount}=require('./inventory-gates');
const {sum,issueData,approvedIssues,fundOfOrder,orderOfIssue,touchFunds,releaseAllocation}=require('./supply-rules');
class PurchaseIssues {
  constructor(db,unit,inventory,purchases) {Object.assign(this,{db,unit,inventory,purchases});}
  propose(ctx,now,input) {
    const item=row(this.db,'purchase_order_item',input.purchaseItemId);revision(item,input.expectedItemRevision);
    const order=row(this.db,'purchase_order',item.purchase_order_id);revision(order,input.expectedPurchaseRevision);
    if(order.status!=='已确认')fail(409,'PURCHASE_UNCONFIRMED','差异须引用已确认采购');
    const source=input.receiptItemId==null?null:row(this.db,'purchase_receipt_item',input.receiptItemId);
    if(source) {revision(source,input.expectedReceiptItemRevision);if(source.purchase_order_item_id!==item.id)fail(409,'SUPPLY_ISSUE_SOURCE','差异验收与采购项目不一致');}
    if(input.resolutionAction==='replace'&&input.issueKind!=null&&!['拒收','已入库退供'].includes(input.issueKind))fail(422,'SUPPLY_ISSUE_SOURCE','换货须明确原拒收或原合格入库来源');
    const kinds={'cancelRemainder':'未交付',replace:input.issueKind||(source?.rejected_quantity_scaled>0?'拒收':'已入库退供'),return:'已入库退供',adjust:'结算调整'};
    const kind=kinds[input.resolutionAction];if(!kind)fail(422,'INVALID_ACTION','差异处理方式无效');
    if(input.resolutionAction!=='cancelRemainder'&&!source)fail(422,'SUPPLY_ISSUE_SOURCE','退换及价款调整须指定原验收条目');
    const quantity=integer(input.quantityScaled,'差异基本单位放大量',input.resolutionAction==='adjust');
    if(input.resolutionAction==='adjust'&&quantity!==0)fail(422,'SUPPLY_ISSUE_QUANTITY','纯结算调整不虚构实物数量');
    const prior=this.db.prepare("SELECT * FROM purchase_issue WHERE purchase_order_item_id=? AND status<>'已拒绝'").all(item.id);
    if(prior.some(i=>i.status==='待确认'&&i.purchase_receipt_item_id===(source?.id||null)&&issueData(i).action===input.resolutionAction))fail(409,'SUPPLY_ISSUE_DUPLICATE','已有同来源待确认差异，请核对原事项');
    let adjustment=0;
    if(input.resolutionAction==='cancelRemainder') {
      if(source)fail(422,'SUPPLY_ISSUE_SOURCE','取消未交付剩余不改指已到货条目');
      const arrivals=this.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_order_item_id=?').all(item.id);
      const replacementIds=new Set(prior.flatMap(i=>issueData(i).replacementReceiptItemIds||[]));
      const arrived=sum(arrivals.filter(r=>!replacementIds.has(r.id)),'arrived_quantity_scaled');
      const canceled=sum(prior.filter(i=>issueData(i).action==='cancelRemainder'),'quantity_scaled');
      if(BigInt(quantity)+arrived+canceled>BigInt(item.ordered_quantity_scaled)||arrivals.some(r=>r.pending_quantity_scaled>0))fail(409,'SUPPLY_CANCEL_LIMIT','只可取消尚未交付的数量；有待检实物时须先核清');
      adjustment=receiptAmount(item,safe(BigInt(item.ordered_quantity_scaled)-canceled-BigInt(quantity)))-receiptAmount(item,safe(BigInt(item.ordered_quantity_scaled)-canceled));
    } else if(kind==='已入库退供') {
      const priorQty=sum(prior.filter(i=>i.purchase_receipt_item_id===source.id&&i.issue_kind==='已入库退供'),'quantity_scaled');
      if(priorQty+BigInt(quantity)>BigInt(source.accepted_quantity_scaled))fail(409,'SUPPLY_RETURN_LIMIT','拟退供合计超过原合格认可量');
      adjustment=receiptAmount(item,safe(BigInt(source.accepted_quantity_scaled)-priorQty-BigInt(quantity)))-receiptAmount(item,safe(BigInt(source.accepted_quantity_scaled)-priorQty));
    } else if(kind==='拒收') {
      const priorQty=sum(prior.filter(i=>i.purchase_receipt_item_id===source.id&&i.issue_kind==='拒收'),'quantity_scaled');
      if(priorQty+BigInt(quantity)>BigInt(source.rejected_quantity_scaled))fail(409,'SUPPLY_REPLACEMENT_LIMIT','换货范围超过原拒收量');
    } else {
      if(!Number.isSafeInteger(input.adjustmentCents)||input.adjustmentCents===0)fail(422,'SUPPLY_ADJUSTMENT','结算调整须为非零整数分');
      adjustment=input.adjustmentCents;
    }
    const data={version:1,action:input.resolutionAction,requestReason:text(input.reason,'实际差异依据',2000),note:text(input.resolutionNote,'具体处理约定',2000),itemRevision:item.revision,purchaseRevision:order.revision,
      receiptItemRevision:source?.revision||null,replacementReceiptItemIds:[]};
    const key=insert(this.db,'purchase_issue',fact(now,{purchase_order_item_id:item.id,purchase_receipt_item_id:source?.id||null,quantity_scaled:quantity,reason:canonical(data),
      resolution:({cancelRemainder:'取消剩余',replace:'换货',return:'退货',adjust:'价款调整'})[data.action],confirmed_at:null,issue_kind:kind,adjustment_cents:adjustment,resolved_at:null,created_by:ctx.session.staff_id,confirmed_by:null,status:'待确认'}));
    return {kind:'purchase_issue',key,revision:1,reason:'保存有来源的差异申请，负责人确认前不调价、不退供或退款'};
  }
  approve(credentials,input) {
    return this.unit.command(credentials,'uc28.approve',input,(ctx,now)=>{
      const issue=row(this.db,'purchase_issue',input.issueId);revision(issue,input.expectedRevision);
      if(issue.status!=='待确认')fail(409,'SUPPLY_ISSUE_SEALED','差异已经审核，请按原处理记录继续办理');
      const data=issueData(issue),note=text(input.reviewNote,'负责人核实意见',2000),orderId=orderOfIssue(this.db,issue),funds=fundOfOrder(this.db,orderId);
      revision(funds,input.expectedFundsRevision);
      if(input.action==='reject') {
        this.db.prepare("UPDATE purchase_issue SET status='已拒绝',reason=?,confirmed_at=?,confirmed_by=?,resolved_at=?,updated_at=?,revision=revision+1 WHERE id=?")
          .run(canonical({...data,reviewNote:note}),now,ctx.session.staff_id,now,now,issue.id);
      } else if(input.action==='approve') {
        const item=row(this.db,'purchase_order_item',issue.purchase_order_item_id),order=row(this.db,'purchase_order',orderId);
        if(item.revision!==data.itemRevision||order.revision!==data.purchaseRevision||issue.purchase_receipt_item_id&&row(this.db,'purchase_receipt_item',issue.purchase_receipt_item_id).revision!==data.receiptItemRevision)
          fail(409,'SUPPLY_ISSUE_STALE','差异提出后的原单已经变化，请核对后重新提出');
        const releases=input.releases||[];
        if(!Array.isArray(releases)||releases.length>100||new Set(releases.map(r=>r.allocationId)).size!==releases.length)fail(422,'SUPPLY_RELEASE_LIST','原用途释放列表无效');
        if(sum(releases.map(r=>({amount:integer(r.amountCents,'释放分金额')})),'amount')>BigInt(Math.max(0,-issue.adjustment_cents)))fail(409,'SUPPLY_RELEASE_LIMIT','本次释放不能超出批准的价款减少');
        const status=['adjust','cancelRemainder'].includes(data.action)?'已完成':'待处理';
        this.db.prepare('UPDATE purchase_issue SET status=?,reason=?,confirmed_at=?,confirmed_by=?,resolved_at=?,updated_at=?,revision=revision+1 WHERE id=?')
          .run(status,canonical({...data,reviewNote:note}),now,ctx.session.staff_id,status==='已完成'?now:null,now,issue.id);
        for(const release of releases) {
          const a=row(this.db,'supplier_allocation',release.allocationId);
          const matches=a.purchase_order_id===orderId||issue.purchase_receipt_item_id&&a.purchase_receipt_id===row(this.db,'purchase_receipt_item',issue.purchase_receipt_item_id).purchase_receipt_id;
          if(!matches)fail(409,'SUPPLY_RELEASE_SOURCE','释放须对应本次差异的采购或原验收用途');
          releaseAllocation(this.db,ctx,now,release,issue.id,funds.id);
        }
        // The existing state machine does not reopen fulfilled items; their subsequent differences remain separate records.
        this.purchases.progress(orderId,now);
        this.db.prepare('UPDATE purchase_order SET updated_at=?,revision=revision+1 WHERE id=?').run(now,orderId);
      } else fail(422,'INVALID_ACTION','差异审核动作无效');
      touchFunds(this.db,funds.id,now);
      return {kind:'purchase_issue',key:issue.id,beforeRevision:issue.revision,revision:issue.revision+1,reason:note,changes:[{field:'reason',before:issue.reason,after:row(this.db,'purchase_issue',issue.id).reason},{field:'status',before:issue.status,after:row(this.db,'purchase_issue',issue.id).status}]};
    });
  }
  returnGoods(ctx,now,input) {
    const issue=row(this.db,'purchase_issue',input.issueId);revision(issue,input.expectedRevision);
    if(issue.status!=='待处理'||issue.issue_kind!=='已入库退供')fail(409,'SUPPLY_RETURN_SOURCE','须引用待处理且已获负责人确认的退供');
    const source=row(this.db,'purchase_receipt_item',issue.purchase_receipt_item_id),stock=row(this.db,'batch_stock',input.stockId);revision(stock,input.expectedStockRevision);
    if(stock.material_batch_id!==source.material_batch_id||stock.stock_location_id!==source.stock_location_id)fail(409,'SUPPLY_RETURN_SOURCE','退供必须来自原验收的批次位置');
    const quantity=integer(input.quantityScaled),returned=-sum(this.db.prepare("SELECT delta_scaled FROM inventory_movement WHERE purchase_issue_id=? AND movement_type='退供'").all(issue.id),'delta_scaled');
    if(returned+BigInt(quantity)>BigInt(issue.quantity_scaled))fail(409,'SUPPLY_RETURN_LIMIT','累计实际退供超出批准量');
    const at=instant(input.returnedAt,'实际交还供应商时间');if(at>now||at<issue.confirmed_at)fail(422,'SUPPLY_RETURN_TIME','实物交还须实际发生且不早于退供确认');
    const movementId=this.inventory.movement(ctx,now,stock,{movement_type:'退供',delta_scaled:-quantity,purchase_issue_id:issue.id,purchase_receipt_item_id:source.id,
      occurred_at:at,reason:text(input.handoverEvidence,'实际交还供应商的证据',2000)});
    const data=issueData(issue),complete=data.action==='return'&&returned+BigInt(quantity)===BigInt(issue.quantity_scaled);
    this.db.prepare('UPDATE purchase_issue SET status=?,resolved_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(complete?'已完成':'待处理',complete?now:null,now,issue.id);
    const funds=fundOfOrder(this.db,orderOfIssue(this.db,issue));touchFunds(this.db,funds.id,now);
    ctx.authority.returnMovementId=movementId;
    return {kind:'purchase_issue',key:issue.id,beforeRevision:issue.revision,revision:issue.revision+1,reason:'登记真实退供出库，保留原合格验收及原入库事实'};
  }
}
module.exports={PurchaseIssues};
