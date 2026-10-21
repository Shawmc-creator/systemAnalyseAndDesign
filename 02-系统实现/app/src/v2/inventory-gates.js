'use strict';
const { fail, canonical } = require('./common');
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function integer(value, label = '数量', zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) fail(422, 'INVALID_QUANTITY', label + '须为安全范围内的' + (zero ? '非负' : '正') + '整数');
  return value;
}
function safe(value) {
  if (value > MAX || value < -MAX) fail(422, 'QUANTITY_OVERFLOW', '计算结果超出安全整数范围');
  return Number(value);
}
function receiptAmount(item, quantity) {
  const n = BigInt(quantity) * BigInt(item.conversion_denominator) * BigInt(item.unit_price_cents);
  const d = 10n ** BigInt(item.quantity_scale) * BigInt(item.conversion_numerator);
  return safe((n + d / 2n) / d);
}
const terms = db => db.prepare(`SELECT i.id,i.purchase_order_id,i.material_id,i.ordered_quantity_scaled,i.unit_price_cents,
  i.purchase_unit,i.conversion_numerator,i.conversion_denominator,i.quantity_scale,i.sequence_no FROM purchase_order_item i
  JOIN purchase_order p ON p.id=i.purchase_order_id WHERE p.status='已确认' ORDER BY i.id`).all();
function inventorySnapshot(db) {
  return { terms: terms(db), orders: db.prepare("SELECT id,supplier_id,agreed_at,delivery_terms,request_reason,confirmed_at,confirmed_by FROM purchase_order WHERE status='已确认'").all(),
    receipts: db.prepare('SELECT * FROM purchase_receipt_item').all(),
    batches: db.prepare('SELECT id,status FROM material_batch').all(), lastChange: db.prepare('SELECT coalesce(max(id),0) n FROM batch_change').get().n };
}
function validateInventory(db, before) {
  const currentTerms = terms(db);
  for (const p of before.orders) {
    const current = db.prepare('SELECT id,supplier_id,agreed_at,delivery_terms,request_reason,confirmed_at,confirmed_by FROM purchase_order WHERE id=?').get(p.id);
    if (canonical(current) !== canonical(p)) fail(409, 'PURCHASE_SEALED', '已确认采购的约定内容不能覆盖');
    const priorItems = before.terms.filter(i => i.purchase_order_id === p.id);
    const currentItems = currentTerms.filter(i => i.purchase_order_id === p.id);
    if (canonical(priorItems) !== canonical(currentItems)) fail(409, 'PURCHASE_SEALED', '已确认采购的项目集合、数量与价格不能覆盖或后补');
  }
  for (const prior of before.receipts) {
    const current = db.prepare('SELECT * FROM purchase_receipt_item WHERE id=?').get(prior.id);
    if (['purchase_receipt_id','purchase_order_item_id','material_batch_id','stock_location_id','arrived_quantity_scaled'].some(k => current[k] !== prior[k]) ||
      current.accepted_quantity_scaled < prior.accepted_quantity_scaled || current.rejected_quantity_scaled < prior.rejected_quantity_scaled || current.pending_quantity_scaled > prior.pending_quantity_scaled)
      fail(409, 'RECEIPT_FACT_FIXED', '原到货和已作出的合格/拒收事实不能覆盖；待检只能追加结论');
  }
  for (const r of db.prepare('SELECT * FROM purchase_receipt_item').all()) {
    const item = db.prepare('SELECT * FROM purchase_order_item WHERE id=?').get(r.purchase_order_item_id);
    const stocked = db.prepare("SELECT coalesce(sum(delta_scaled),0) n FROM inventory_movement WHERE purchase_receipt_item_id=? AND movement_type='验收入库'").get(r.id).n;
    if (stocked !== r.accepted_quantity_scaled) fail(409, 'RECEIPT_STOCK_MISMATCH', '合格认可量必须与累计验收入库量相等并共同提交');
    if (r.accepted_amount_cents !== receiptAmount(item, r.accepted_quantity_scaled)) fail(409, 'RECEIPT_AMOUNT_MISMATCH', '验收价款须按采购单位换算精确计算');
  }
  for (const item of db.prepare('SELECT id,ordered_quantity_scaled FROM purchase_order_item').all()) {
    const receipts = db.prepare('SELECT accepted_quantity_scaled FROM purchase_receipt_item WHERE purchase_order_item_id=?').all(item.id);
    if (receipts.reduce((n,r) => n + BigInt(r.accepted_quantity_scaled), 0n) > require('./legacy-scope').acceptanceLimit(db,item)) fail(409, 'PURCHASE_ACCEPTANCE_LIMIT', '合格认可量超出当前采购约定');
  }
  for (const p of db.prepare('SELECT id FROM purchase_order').all()) {
    if (!db.prepare('SELECT id FROM purchase_order_item WHERE purchase_order_id=?').get(p.id)) fail(409, 'PURCHASE_EMPTY', '采购必须包含明确项目');
  }
  for (const b of before.batches) {
    const current = db.prepare('SELECT status FROM material_batch WHERE id=?').get(b.id);
    if (current.status !== b.status && !db.prepare('SELECT id FROM batch_change WHERE id>? AND material_batch_id=? AND old_status=? AND new_status=?').get(before.lastChange,b.id,b.status,current.status))
      fail(409, 'BATCH_CHANGE_REQUIRED', '批次状态改变必须共同保存变更依据');
  }
  const mismatch = db.prepare(`SELECT s.id FROM batch_stock s LEFT JOIN inventory_movement m ON m.batch_stock_id=s.id
    GROUP BY s.id HAVING s.quantity_scaled<>coalesce(sum(m.delta_scaled),0)`).get();
  if (mismatch) fail(409, 'STOCK_LEDGER_MISMATCH', '库存余额与不可改写流水不一致');
  for (const c of db.prepare("SELECT * FROM stock_count WHERE status='差异已确认'").all()) {
    const m = db.prepare('SELECT * FROM inventory_movement WHERE stock_count_id=?').all(c.id);
    const delta = c.counted_quantity_scaled - c.snapshot_quantity_scaled;
    if (delta === 0 ? m.length !== 0 : m.length !== 1 || m[0].delta_scaled !== delta || m[0].before_scaled !== c.snapshot_quantity_scaled)
      fail(409, 'COUNT_MOVEMENT_MISMATCH', '盘点确认与唯一差异流水必须共同提交，零差异不产生流水');
  }
}
module.exports = { integer, safe, receiptAmount, inventorySnapshot, validateInventory };
