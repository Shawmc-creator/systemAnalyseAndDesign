'use strict';
const {fail,text,id,row,revision,insert,fact,recordNo,canonical,instant}=require('./common');
const {integer,safe}=require('./inventory-gates');
const {staffRoles}=require('./followup-rules');
const {sum,issueData,orderOfReceipt,orderOfIssue,dueOrder,dueReceipt,uses,allocations,balance,touchFunds,releaseAllocation}=require('./supply-rules');
class SupplierPayments {
  constructor(db,unit) {Object.assign(this,{db,unit});}
  funds(input) {
    row(this.db,'supplier',input.supplierId);
    const funds=this.db.prepare('SELECT * FROM supplier_funds WHERE supplier_id=?').get(input.supplierId);
    if(!funds)fail(409,'SUPPLY_FUNDS_MISSING','供应商须先由负责人核验建档');
    revision(funds,input.expectedFundsRevision);return funds;
  }
  payment(input,funds) {
    const p=row(this.db,'supplier_payment',input.paymentId);revision(p,input.expectedRevision);
    if(p.supplier_funds_id!==funds.id)fail(409,'SUPPLY_OWNER','原付款与当前供应商不一致');return p;
  }
  targets(input,funds) {
    if(!Array.isArray(input)||input.length>100||new Set(input.map(a=>a.kind+':'+a.id)).size!==input.length)fail(422,'SUPPLY_TARGETS','用途须为不超过100项且目标不重复的列表');
    return input.map(a=>{
      if(!['order','receipt'].includes(a.kind))fail(422,'SUPPLY_TARGETS','请选择采购预付或验收结算用途');
      const source=row(this.db,a.kind==='order'?'purchase_order':'purchase_receipt',a.id);revision(source,a.expectedRevision);
      const order=a.kind==='order'?source:row(this.db,'purchase_order',source.purchase_order_id);
      if(order.supplier_id!==funds.supplier_id||order.status!=='已确认')fail(409,'SUPPLY_OWNER','付款目标须为该供应商已确认采购或对应验收');
      if(a.kind==='receipt'&&!source.accepted_at)fail(409,'SUPPLY_RECEIPT_UNCONFIRMED','验收尚无已认可的结算依据');
      return {kind:a.kind,id:source.id,expectedRevision:source.revision,orderId:order.id,amountCents:integer(a.amountCents,'用途分金额')};
    });
  }
  addAllocation(ctx,now,p,target,state,amount=target.amountCents) {
    return insert(this.db,'supplier_allocation',fact(now,{supplier_payment_id:p.id,purchase_order_id:target.kind==='order'?target.id:null,purchase_receipt_id:target.kind==='receipt'?target.id:null,
      amount_cents:amount,effective_at:state==='已生效'?now:null,allocation_state:state,reason:state==='待生效'?'依据负责人明确授权保留本次付款额度':'依据已确认实际付款及核准用途',operator_id:ctx.session.staff_id,original_allocation_id:null,purchase_issue_id:null}));
  }
  started(p) {return !!this.db.prepare("SELECT id FROM operation_audit WHERE object_kind='supplier_payment' AND object_key=? AND outcome_code='SUPPLIER_PAYMENT_INITIATED' AND event_type='变更'").get(String(p.id));}
  authorize(credentials,input) {
    return this.unit.command(credentials,'uc29.authorize',input,(ctx,now)=>{
      const funds=this.funds(input),supplier=row(this.db,'supplier',input.supplierId);revision(supplier,input.expectedSupplierRevision);
      const note=text(input.reviewNote,'负责人确认范围及依据',4000),targets=this.targets(input.allocations||[],funds);
      if(input.action==='authorizeReallocation') {
        const p=this.payment(input,funds);
        if(p.status!=='已确认付款')fail(409,'SUPPLY_PAYMENT_NOT_CONFIRMED','只有实际已付款才可重新分配原款');
        const releases=input.releases||[];
        if(!Array.isArray(releases)||releases.length>100||new Set(releases.map(a=>a.allocationId)).size!==releases.length||!releases.length&&!targets.length)fail(422,'SUPPLY_RELEASE_LIST','请明确释放及目标用途');
        const normalized=releases.map(r=>{
          const a=row(this.db,'supplier_allocation',r.allocationId);revision(a,r.expectedRevision);
          if(a.supplier_payment_id!==p.id||a.amount_cents<=0||a.allocation_state!=='已生效')fail(409,'SUPPLY_RELEASE_SOURCE','释放须来自本次原付款的有效正向用途');
          const remaining=BigInt(a.amount_cents)+sum(this.db.prepare("SELECT amount_cents FROM supplier_allocation WHERE original_allocation_id=? AND allocation_state='已生效'").all(a.id),'amount_cents');
          const amount=integer(r.amountCents,'释放分金额');if(BigInt(amount)>remaining)fail(409,'SUPPLY_RELEASE_LIMIT','释放超过原用途剩余量');
          return {allocationId:a.id,expectedRevision:a.revision,amountCents:amount,reason:text(r.reason,'用途转移依据',2000)};
        });
        if(sum(targets,'amountCents')>BigInt(balance(this.db,p).availableCents)+sum(normalized,'amountCents'))fail(409,'SUPPLY_PAYMENT_BALANCE','原款可用余额和本次释放不足');
        ctx.authority.supplyReallocation={version:1,paymentId:p.id,paymentRevision:p.revision,fundsId:funds.id,fundsRevision:funds.revision+1,supplierRevision:supplier.revision,targets,releases:normalized,note};
        touchFunds(this.db,funds.id,now);
        return {kind:'supplier_funds',key:funds.id,beforeRevision:funds.revision,revision:funds.revision+1,code:'SUPPLIER_REALLOCATION_AUTHORIZED',reason:note};
      }
      if(input.action!=='authorize')fail(422,'INVALID_ACTION','供货付款授权动作无效');
      if(!supplier.is_active)fail(409,'SUPPLIER_INACTIVE','停用供应商不能发起新付款');
      if(!targets.length)fail(422,'SUPPLY_TARGETS','付款必须有明确的采购预付或验收结算用途');
      const amount=integer(input.requestedCents,'拟付分金额');
      if(sum(targets,'amountCents')!==BigInt(amount))fail(422,'SUPPLY_RESERVATION','拟付与用途合计须一致');
      if(!['现金','银行卡','微信','支付宝'].includes(input.channel))fail(422,'PAYMENT_CHANNEL','付款渠道无效');
      if(!staffRoles(this.db,this.unit.auth,id(input.cashierId,'指定收费人员')).includes('cashier'))fail(409,'SUPPLY_CASHIER','指定付款经办人须为当前有效收费人员');
      const active=this.db.prepare("SELECT id FROM supplier_payment WHERE supplier_funds_id=? AND status IN ('待付款','待核实')").get(funds.id);
      if(active)fail(409,'SUPPLY_PAYMENT_IN_PROGRESS','当前供应商有未决付款，须核实原办理号',{paymentId:active.id});
      if(input.previousAttemptId!=null) {
        const previous=row(this.db,'supplier_payment',input.previousAttemptId);
        if(previous.supplier_funds_id!==funds.id||previous.status!=='已失败'||this.db.prepare('SELECT id FROM supplier_payment WHERE previous_attempt_id=?').get(previous.id))fail(409,'SUPPLY_RETRY_SOURCE','重办须引用同供应商明确失败且尚未重办的原办理号');
      }
      const key=insert(this.db,'supplier_payment',fact(now,{supplier_funds_id:funds.id,requested_cents:amount,actual_cents:null,channel:input.channel,initiated_at:now,
        transaction_evidence:null,external_reference:null,verified_at:null,authorization_basis:canonical({version:1,supplierRevision:supplier.revision,settlementBasis:supplier.settlement_basis,targets,note}),
        authorized_by:ctx.session.staff_id,operator_id:input.cashierId,verified_by:null,previous_attempt_id:input.previousAttemptId||null,status:'待付款',record_no:recordNo('SPAY')}));
      const p=row(this.db,'supplier_payment',key);for(const target of targets)this.addAllocation(ctx,now,p,target,'待生效');
      touchFunds(this.db,funds.id,now);
      return {kind:'supplier_payment',key,revision:1,code:'SUPPLIER_PAYMENT_AUTHORIZED',reason:'负责人核准本次范围并保留额度；尚未记录实际付款'};
    });
  }
  reference(table,channel,reference,except=-1) {
    if(reference&&this.db.prepare(`SELECT id FROM ${table} WHERE channel=? AND external_reference=? AND id<>?`).get(channel,reference,except))fail(409,'SUPPLY_REFERENCE_DUPLICATE','该渠道交易已经登记，请核实原办理，不重复记录');
  }
  pay(credentials,input) {
    return this.unit.command(credentials,'uc29.pay',input,(ctx,now)=>{
      const funds=this.funds(input);
      if(input.action==='reallocate')return this.reallocate(ctx,now,input,funds);
      if(input.action==='refund')return this.refund(ctx,now,input,funds);
      const p=this.payment(input,funds);
      if(p.operator_id!==ctx.session.staff_id)fail(403,'SUPPLY_OPERATOR_SCOPE','只可办理负责人指定给本人的付款');
      if(!['待付款','待核实'].includes(p.status))fail(409,'SUPPLY_PAYMENT_CLOSED','原办理已经终结，不能覆盖实际结果');
      const evidence=text(input.transactionEvidence,'实际办理或核查依据',4000);
      if(input.action==='initiate') {
        if(this.started(p)||p.status!=='待付款')fail(409,'SUPPLY_PAYMENT_STARTED','原办理已经开始，须核查原结果，不能再付一次');
        const basis=JSON.parse(p.authorization_basis),supplier=row(this.db,'supplier',funds.supplier_id);
        if(!supplier.is_active||supplier.revision!==basis.supplierRevision)fail(409,'SUPPLY_AUTHORIZATION_STALE','供应商依据已变化，请核对并重新授权');
        this.targets(basis.targets,funds);
        this.db.prepare('UPDATE supplier_payment SET initiated_at=?,transaction_evidence=?,updated_at=?,revision=revision+1 WHERE id=?').run(now,evidence,now,p.id);
        touchFunds(this.db,funds.id,now);
        return {kind:'supplier_payment',key:p.id,beforeRevision:p.revision,revision:p.revision+1,code:'SUPPLIER_PAYMENT_INITIATED',reason:'按原办理号开始线下付款，仍保留占用，不确认实际流出'};
      }
      const cancel=input.action==='cancelUnstarted';
      if(cancel) {if(this.started(p))fail(409,'SUPPLY_PAYMENT_STARTED','已开始的线下付款须核实结果，不能当作未办理撤销');}
      else if(input.action!=='verify'||!this.started(p))fail(409,'SUPPLY_PAYMENT_NOT_STARTED','须先接收本次唯一付款办理，再核实实际结果');
      const outcome=cancel?'failed':input.outcome;
      if(!['success','failed','unknown'].includes(outcome))fail(422,'SUPPLY_PAYMENT_OUTCOME','请明确原办理实际结果');
      const observed=cancel?0:input.actualCents==null?null:integer(input.actualCents,'观察到的实际分金额',true);
      const reference=input.externalReference==null?p.external_reference:text(input.externalReference,'渠道交易号',200);
      if(p.external_reference&&reference!==p.external_reference)fail(409,'SUPPLY_REFERENCE_FIXED','同一办理不能更换已经关联的渠道交易号');
      this.reference('supplier_payment',p.channel,reference,p.id);
      const success=outcome==='success'&&observed>0&&observed<=p.requested_cents&&input.recipientMatches===true&&(p.channel==='现金'||!!reference);
      const failed=outcome==='failed'&&observed===0;
      const oldAllocations=allocations(this.db,p.id).filter(a=>a.allocation_state==='待生效');
      let actualTargets=[];
      if(success) {
        if(observed===p.requested_cents&&input.actualAllocations==null)actualTargets=oldAllocations.map(a=>({source:a,amountCents:a.amount_cents}));
        else {
          if(!Array.isArray(input.actualAllocations)||!input.actualAllocations.length||new Set(input.actualAllocations.map(a=>a.allocationId)).size!==input.actualAllocations.length)fail(422,'SUPPLY_ACTUAL_ALLOCATION','部分实付须明确实际用途');
          actualTargets=input.actualAllocations.map(a=>{const source=oldAllocations.find(s=>s.id===a.allocationId);const amount=integer(a.amountCents,'实际用途分金额');if(!source||amount>source.amount_cents)fail(409,'SUPPLY_ACTUAL_ALLOCATION','实际用途不得超出原核准范围');return {source,amountCents:amount};});
          if(sum(actualTargets,'amountCents')!==BigInt(observed))fail(422,'SUPPLY_ACTUAL_ALLOCATION','实际用途合计须等于实付');
        }
      }
      const status=success?'已确认付款':failed?'已失败':'待核实';
      if(success||failed)this.db.prepare("UPDATE supplier_allocation SET allocation_state='已取消',updated_at=?,revision=revision+1 WHERE supplier_payment_id=? AND allocation_state='待生效'").run(now,p.id);
      this.db.prepare('UPDATE supplier_payment SET status=?,actual_cents=?,transaction_evidence=?,external_reference=?,verified_at=?,verified_by=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(status,success?observed:null,evidence,reference,success||failed?now:null,success||failed?ctx.session.staff_id:null,now,p.id);
      if(success)for(const target of actualTargets)this.addAllocation(ctx,now,p,{kind:target.source.purchase_order_id?'order':'receipt',id:target.source.purchase_order_id||target.source.purchase_receipt_id},'已生效',target.amountCents);
      ctx.authority.reportedOutcome=outcome;ctx.authority.reportedActualCents=observed;ctx.authority.recipientMatches=input.recipientMatches===true;
      touchFunds(this.db,funds.id,now);
      return {kind:'supplier_payment',key:p.id,beforeRevision:p.revision,revision:p.revision+1,code:!success&&!failed?'SUPPLY_REVIEW_REQUIRED':'COMMITTED',reason:evidence,changes:[{field:'status',before:p.status,after:status},{field:'actual_cents',before:p.actual_cents,after:success?observed:null},{field:'transaction_evidence',before:p.transaction_evidence,after:evidence}]};
    });
  }
  reallocate(ctx,now,input,funds) {
    const audit=row(this.db,'operation_audit',input.authorizationId);
    let grant;try{grant=JSON.parse(audit.authority_snapshot).supplyReallocation;}catch{}
    if(audit.outcome_code!=='SUPPLIER_REALLOCATION_AUTHORIZED'||audit.object_kind!=='supplier_funds'||!grant||grant.version!==1||grant.fundsId!==funds.id||grant.fundsRevision!==funds.revision)
      fail(409,'SUPPLY_AUTHORIZATION_STALE','用途转移授权已失效，请负责人按当前依据重新核实');
    const p=row(this.db,'supplier_payment',grant.paymentId);revision(p,grant.paymentRevision);
    const supplier=row(this.db,'supplier',funds.supplier_id);revision(supplier,grant.supplierRevision);
    const targets=this.targets(grant.targets,funds);
    for(const release of grant.releases)releaseAllocation(this.db,ctx,now,release,null,funds.id);
    for(const target of targets)this.addAllocation(ctx,now,p,target,'已生效');
    touchFunds(this.db,funds.id,now);ctx.authority.reallocationAuthorizationId=audit.id;
    return {kind:'supplier_funds',key:funds.id,beforeRevision:funds.revision,revision:funds.revision+1,reason:'按负责人确认范围释放原用途并重新分配原付款，不再次付款'};
  }
  refund(ctx,now,input,funds) {
    const p=this.payment(input,funds),issue=row(this.db,'purchase_issue',input.issueId);revision(issue,input.expectedIssueRevision);
    const data=issueData(issue),orderId=orderOfIssue(this.db,issue),order=row(this.db,'purchase_order',orderId);
    if(p.status!=='已确认付款'||order.supplier_id!==funds.supplier_id||issue.status!=='已完成'||data.action==='replace'||issue.adjustment_cents>=0)fail(409,'SUPPLY_REFUND_SOURCE','退回款须引用同供应商已完成的减款差异及实际原付款');
    const related=allocations(this.db,p.id).some(a=>a.amount_cents>0&&(a.purchase_order_id===orderId||a.purchase_receipt_id&&(issue.purchase_receipt_item_id? a.purchase_receipt_id===row(this.db,'purchase_receipt_item',issue.purchase_receipt_item_id).purchase_receipt_id:orderOfReceipt(this.db,a.purchase_receipt_id)===orderId)));
    if(!related)fail(409,'SUPPLY_REFUND_SOURCE','该原付款没有对应差异采购或验收的用途来源');
    const amount=integer(input.receivedCents,'实际收到供应商退回分金额'),already=sum(this.db.prepare('SELECT received_cents FROM supplier_refund WHERE purchase_issue_id=?').all(issue.id),'received_cents');
    if(BigInt(amount)+already>BigInt(-issue.adjustment_cents)||amount>balance(this.db,p).availableCents)fail(409,'SUPPLY_REFUND_LIMIT','退回款超过已确认差异剩余减款或原付款已释放余额');
    const at=instant(input.receivedAt,'实际收到供应商退回款时间');if(at>now||at<issue.confirmed_at||at<p.verified_at)fail(422,'SUPPLY_REFUND_TIME','退回款须已经实际收到且不早于原付款与差异确认');
    if(!['现金','银行卡','微信','支付宝'].includes(input.channel)||input.senderMatches!==true)fail(422,'SUPPLY_REFUND_EVIDENCE','须核实退款渠道及供应商付款方');
    const reference=input.externalReference==null?null:text(input.externalReference,'退回款渠道交易号',200);
    if(input.channel!=='现金'&&!reference)fail(422,'SUPPLY_REFUND_EVIDENCE','非现金退回款须核实唯一渠道交易号');
    this.reference('supplier_refund',input.channel,reference);
    const key=insert(this.db,'supplier_refund',fact(now,{supplier_payment_id:p.id,purchase_issue_id:issue.id,supplier_funds_id:funds.id,received_cents:amount,channel:input.channel,received_at:at,
      transaction_evidence:text(input.transactionEvidence,'实际收到退回款的核实证据',4000),external_reference:reference,operator_id:ctx.session.staff_id,verified_by:ctx.session.staff_id,record_no:recordNo('SREF')}));
    touchFunds(this.db,funds.id,now);
    return {kind:'supplier_refund',key,revision:1,reason:'按原付款与已完成减款差异登记实际收到的供应商退回款，不计患者收入'};
  }
  query(credentials,input={}) {
    return this.unit.query(credentials,credentials.role==='manager'?'uc29.authorize':'uc29.pay',ctx=>{
      const supplier=row(this.db,'supplier',Number(input.supplierId)),funds=this.db.prepare('SELECT * FROM supplier_funds WHERE supplier_id=?').get(supplier.id);
      const items=this.db.prepare('SELECT * FROM supplier_payment WHERE supplier_funds_id=? ORDER BY id DESC').all(funds.id).map(p=>({...p,...balance(this.db,p),initiated:this.started(p),allocations:allocations(this.db,p.id),refunds:this.db.prepare('SELECT * FROM supplier_refund WHERE supplier_payment_id=? ORDER BY id').all(p.id)}));
      const orders=this.db.prepare("SELECT * FROM purchase_order WHERE supplier_id=? AND status='已确认'").all(supplier.id).map(p=>({...p,dueCents:dueOrder(this.db,p.id),committedCents:uses(this.db,{orderId:p.id}),
        items:this.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(p.id),
        issues:this.db.prepare('SELECT i.* FROM purchase_issue i JOIN purchase_order_item p ON p.id=i.purchase_order_item_id WHERE p.purchase_order_id=? ORDER BY i.id').all(p.id).map(i=>({...i,basis:issueData(i)})),
        receipts:this.db.prepare('SELECT * FROM purchase_receipt WHERE purchase_order_id=?').all(p.id).map(r=>({...r,dueCents:dueReceipt(this.db,r.id),committedCents:uses(this.db,{receiptId:r.id}),items:this.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_receipt_id=?').all(r.id)}))}));
      const authorizations=this.db.prepare("SELECT id,occurred_at,authority_snapshot FROM operation_audit WHERE object_kind='supplier_funds' AND object_key=? AND outcome_code='SUPPLIER_REALLOCATION_AUTHORIZED' ORDER BY id DESC LIMIT 50").all(String(funds.id)).map(a=>({id:a.id,occurredAt:a.occurred_at,grant:JSON.parse(a.authority_snapshot).supplyReallocation}));
      const totals={paidCents:safe(sum(items.filter(p=>p.status==='已确认付款'),'actual_cents')),heldCents:safe(sum(items.filter(p=>['待付款','待核实'].includes(p.status)),'requested_cents')),refundedCents:safe(sum(items,'refundedCents')),availableCents:safe(sum(items,'availableCents'))};
      totals.netPaidCents=totals.paidCents-totals.refundedCents;
      ctx.authority.supplierFundsId=funds.id;return {supplier,funds,items,orders,authorizations,totals,computedAt:this.unit.auth.now()};
    });
  }
}
module.exports={SupplierPayments};
