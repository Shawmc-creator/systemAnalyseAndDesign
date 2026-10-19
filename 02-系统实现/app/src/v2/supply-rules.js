'use strict';
const { fail, row, canonical } = require('./common');
const { safe, receiptAmount } = require('./inventory-gates');
const sum = (rows, field) => rows.reduce((n, r) => n + BigInt(r[field]), 0n);
function issueData(issue) {
  try { const d = JSON.parse(issue.reason); if (d.version === 1 && ({cancelRemainder:'取消剩余',replace:'换货',return:'退货',adjust:'价款调整'})[d.action] === issue.resolution) return d; } catch {}
  fail(409, 'SUPPLY_LEGACY_BASIS', '该差异缺少本版可核验的处理依据，请单独核实历史记录');
}
function approvedIssues(db, itemId) {
  return db.prepare("SELECT * FROM purchase_issue WHERE purchase_order_item_id=? AND status IN ('待处理','已完成')").all(itemId);
}
function orderOfReceipt(db, receiptId) { return row(db, 'purchase_receipt', receiptId).purchase_order_id; }
function orderOfIssue(db, issue) { return row(db, 'purchase_order_item', issue.purchase_order_item_id).purchase_order_id; }
function fundOfOrder(db, orderId) {
  const p = row(db, 'purchase_order', orderId);
  return db.prepare('SELECT * FROM supplier_funds WHERE supplier_id=?').get(p.supplier_id);
}
function acceptanceLimit(db, item) {
  let limit = BigInt(item.ordered_quantity_scaled);
  for (const issue of approvedIssues(db,item.id)) {
    const d = issueData(issue);
    if (d.action === 'cancelRemainder') limit -= BigInt(issue.quantity_scaled);
    if (d.action === 'replace' && issue.issue_kind === '已入库退供') limit -= sum(db.prepare("SELECT delta_scaled FROM inventory_movement WHERE purchase_issue_id=? AND movement_type='退供'").all(issue.id),'delta_scaled');
  }
  return limit;
}
function dueReceipt(db, receiptId) {
  let amount = sum(db.prepare('SELECT accepted_amount_cents FROM purchase_receipt_item WHERE purchase_receipt_id=?').all(receiptId), 'accepted_amount_cents');
  amount += sum(db.prepare(`SELECT i.adjustment_cents FROM purchase_issue i JOIN purchase_receipt_item r ON r.id=i.purchase_receipt_item_id
    WHERE r.purchase_receipt_id=? AND i.status IN ('待处理','已完成')`).all(receiptId), 'adjustment_cents');
  return safe(amount);
}
function dueOrder(db, orderId) {
  let amount = db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(orderId).reduce((n, i) => n + BigInt(receiptAmount(i, i.ordered_quantity_scaled)), 0n);
  for (const i of db.prepare(`SELECT i.* FROM purchase_issue i JOIN purchase_order_item p ON p.id=i.purchase_order_item_id
    WHERE p.purchase_order_id=? AND i.status IN ('待处理','已完成')`).all(orderId)) {
    // A replacement keeps the original contract ceiling; its negative receipt adjustment offsets the replacement receipt.
    if (issueData(i).action !== 'replace') amount += BigInt(i.adjustment_cents);
  }
  return safe(amount);
}
function uses(db, { orderId, receiptId }, states = ['待生效', '已生效']) {
  const all = db.prepare(`SELECT a.*,r.purchase_order_id receipt_order FROM supplier_allocation a
    LEFT JOIN purchase_receipt r ON r.id=a.purchase_receipt_id`).all();
  return safe(sum(all.filter(a => states.includes(a.allocation_state) && (receiptId != null ? a.purchase_receipt_id === receiptId : a.purchase_order_id === orderId || a.receipt_order === orderId)), 'amount_cents'));
}
function allocations(db, paymentId) { return db.prepare('SELECT * FROM supplier_allocation WHERE supplier_payment_id=? ORDER BY id').all(paymentId); }
function balance(db, payment) {
  const effective = sum(allocations(db, payment.id).filter(a => a.allocation_state === '已生效'), 'amount_cents');
  const refunded = sum(db.prepare('SELECT received_cents FROM supplier_refund WHERE supplier_payment_id=?').all(payment.id), 'received_cents');
  return { allocatedCents: safe(effective), refundedCents: safe(refunded), availableCents: payment.status === '已确认付款' ? safe(BigInt(payment.actual_cents) - effective - refunded) : 0 };
}
function touchFunds(db, fundsId, now) { db.prepare('UPDATE supplier_funds SET updated_at=?,revision=revision+1 WHERE id=?').run(now, fundsId); }
function releaseAllocation(db, ctx, now, release, issueId, supplierFundsId) {
  const { revision, insert, fact, text } = require('./common');
  const { integer } = require('./inventory-gates');
  const a = row(db, 'supplier_allocation', release.allocationId); revision(a, release.expectedRevision);
  const p = row(db, 'supplier_payment', a.supplier_payment_id);
  if (p.supplier_funds_id !== supplierFundsId || p.status !== '已确认付款' || a.allocation_state !== '已生效' || a.amount_cents <= 0)
    fail(409, 'SUPPLY_RELEASE_SOURCE', '只可释放同供应商已确认原付款的正向有效用途');
  const amount = integer(release.amountCents, '原用途释放分金额');
  const released = -sum(db.prepare("SELECT amount_cents FROM supplier_allocation WHERE original_allocation_id=? AND allocation_state='已生效'").all(a.id), 'amount_cents');
  if (BigInt(amount) + released > BigInt(a.amount_cents)) fail(409, 'SUPPLY_RELEASE_LIMIT', '释放超过原用途尚有效部分');
  return insert(db, 'supplier_allocation', fact(now, { supplier_payment_id: p.id, purchase_order_id: a.purchase_order_id, purchase_receipt_id: a.purchase_receipt_id,
    amount_cents: -amount, effective_at: now, allocation_state: '已生效', reason: text(release.reason, '释放依据', 2000), operator_id: ctx.session.staff_id,
    original_allocation_id: a.id, purchase_issue_id: issueId }));
}
function supplySnapshot(db) {
  return { payments: db.prepare('SELECT id,status FROM supplier_payment').all(), issues: db.prepare('SELECT * FROM purchase_issue').all() };
}
function validateSupply(db, before) {
  const original = new Map(before.payments.map(p => [p.id, p.status]));
  for (const p of db.prepare('SELECT * FROM supplier_payment').all()) {
    const a = allocations(db, p.id), pending = a.filter(a => a.allocation_state === '待生效'), effective = a.filter(a => a.allocation_state === '已生效');
    if (['待付款','待核实'].includes(p.status) && (sum(pending, 'amount_cents') !== BigInt(p.requested_cents) || effective.length)) fail(409, 'SUPPLY_RESERVATION', '拟付金额必须与待生效用途同事务等额保存');
    if (p.status === '已失败' && a.some(a => a.allocation_state !== '已取消')) fail(409, 'SUPPLY_RESERVATION', '已失败办理不能遗留资金占用');
    if (p.status === '已确认付款') {
      if (pending.length || balance(db,p).availableCents < 0) fail(409, 'SUPPLY_PAYMENT_BALANCE', '原付款分配及供应商退款超过实际付款');
      if (original.get(p.id) !== '已确认付款' && sum(effective,'amount_cents') !== BigInt(p.actual_cents)) fail(409, 'SUPPLY_CONFIRMATION', '首次实际付款确认必须与等额生效用途共同保存');
    }
  }
  for (const p of db.prepare("SELECT id FROM purchase_order WHERE status='已确认'").all()) {
    const due = dueOrder(db,p.id);
    if (due < 0 || uses(db,{orderId:p.id}) > due) fail(409, 'SUPPLY_ORDER_LIMIT', '采购总额度不足；已有预付、结算和未决占用共用该额度，须先核对原用途');
  }
  for (const item of db.prepare('SELECT id,ordered_quantity_scaled FROM purchase_order_item').all()) {
    const issues=approvedIssues(db,item.id),linked=new Set(issues.filter(i=>issueData(i).action==='replace').flatMap(i=>issueData(i).replacementReceiptItemIds||[]));
    const normal=db.prepare('SELECT id,accepted_quantity_scaled FROM purchase_receipt_item WHERE purchase_order_item_id=?').all(item.id).filter(r=>!linked.has(r.id));
    const canceled=sum(issues.filter(i=>issueData(i).action==='cancelRemainder'),'quantity_scaled');
    if(sum(normal,'accepted_quantity_scaled')>BigInt(item.ordered_quantity_scaled)-canceled)fail(409,'SUPPLY_REPLACEMENT_LINK','额外换货认可必须明确关联已批准的原差异，不能混入普通交付');
  }
  for (const r of db.prepare('SELECT id FROM purchase_receipt').all()) {
    const due = dueReceipt(db,r.id);
    if (due < 0 || uses(db,{receiptId:r.id}) > due) fail(409, 'SUPPLY_RECEIPT_LIMIT', '验收应付不足，价款调整须与必要的原用途释放共同保存');
  }
  for (const old of before.issues) {
    const current = row(db,'purchase_issue',old.id);
    if (['已完成','已拒绝'].includes(old.status) && JSON.stringify(old) !== JSON.stringify(current)) fail(409,'SUPPLY_ISSUE_CLOSED','已结束差异不能覆盖');
    const approvedBasis = i => { const d = {...issueData(i)}; delete d.replacementReceiptItemIds; return canonical(d); };
    if (old.status === '待处理' && (['purchase_order_item_id','purchase_receipt_item_id','quantity_scaled','adjustment_cents','resolution','issue_kind','confirmed_by','confirmed_at'].some(k => old[k] !== current[k]) || approvedBasis(old)!==approvedBasis(current)))
      fail(409,'SUPPLY_ISSUE_SEALED','负责人已确认的差异范围不能追改');
  }
  for (const issue of db.prepare("SELECT * FROM purchase_issue WHERE status IN ('待处理','已完成')").all()) {
    const d = issueData(issue);
    const movements = db.prepare("SELECT * FROM inventory_movement WHERE purchase_issue_id=? AND movement_type='退供'").all(issue.id);
    if (movements.length) {
      if (issue.issue_kind !== '已入库退供') fail(409,'SUPPLY_RETURN_SOURCE','退供流水必须引用已确认的实物退供');
      const source = row(db,'purchase_receipt_item',issue.purchase_receipt_item_id);
      for(const m of movements) {
        const stock = row(db,'batch_stock',m.batch_stock_id);
        if (stock.material_batch_id !== source.material_batch_id || stock.stock_location_id !== source.stock_location_id || m.purchase_receipt_item_id !== source.id)
          fail(409,'SUPPLY_RETURN_SOURCE','退供须来自原验收批次位置');
      }
    }
    const returned = -sum(movements,'delta_scaled');
    if (returned > BigInt(issue.quantity_scaled) || (issue.status === '已完成' && issue.issue_kind === '已入库退供' && returned !== BigInt(issue.quantity_scaled))) fail(409,'SUPPLY_RETURN_LIMIT','实物退供数量须与批准范围一致');
    if (d.action === 'replace') {
      const refs = d.replacementReceiptItemIds || [];
      if (new Set(refs).size !== refs.length) fail(409,'SUPPLY_REPLACEMENT_LINK','换货来源不能重复');
      let accepted = 0n, pending = 0n;
      for (const ref of refs) {
        const r = row(db,'purchase_receipt_item',ref);
        if (r.purchase_order_item_id !== issue.purchase_order_item_id || r.id === issue.purchase_receipt_item_id) fail(409,'SUPPLY_REPLACEMENT_LINK','换货必须关联原采购的后续验收');
        accepted += BigInt(r.accepted_quantity_scaled); pending += BigInt(r.pending_quantity_scaled);
      }
      if (accepted + pending > BigInt(issue.quantity_scaled) || issue.status === '已完成' && accepted !== BigInt(issue.quantity_scaled)) fail(409,'SUPPLY_REPLACEMENT_LIMIT','换货认可及待检须在批准范围内，完成须足额认可');
    }
  }
}
module.exports = { sum, issueData, approvedIssues, acceptanceLimit, orderOfReceipt, orderOfIssue, fundOfOrder, dueReceipt, dueOrder, uses, allocations, balance, touchFunds, releaseAllocation, supplySnapshot, validateSupply };
