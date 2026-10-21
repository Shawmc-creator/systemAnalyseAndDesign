'use strict';
const { fail } = require('./common');
function feeSnapshot(db) {
  return db.prepare(`SELECT a.id,count(i.id) members FROM fee_adjustment a
    LEFT JOIN fee_adjustment_item i ON i.fee_adjustment_id=a.id GROUP BY a.id`).all();
}
function validateFees(db, before) {
  for (const a of before) {
    if (db.prepare('SELECT count(*) n FROM fee_adjustment_item WHERE fee_adjustment_id=?').get(a.id).n !== a.members) fail(409, 'ADJUSTMENT_SEALED', '既有费用调整明细不能后补，请另留更正依据');
  }
  for (const a of db.prepare(`SELECT a.id,r.approved_adjustment_cents approved FROM fee_adjustment a JOIN fee_request r ON r.id=a.fee_request_id`).all()) {
    const items = db.prepare('SELECT amount_cents FROM fee_adjustment_item WHERE fee_adjustment_id=?').all(a.id);
    if (!items.length || items.reduce((n, i) => n + BigInt(i.amount_cents), 0n) !== BigInt(a.approved)) fail(409, 'ADJUSTMENT_SUM', '调整明细须非空且合计等于批准金额');
  }
  if (db.prepare(`SELECT r.id FROM fee_request r WHERE r.status='已同意' AND r.approved_adjustment_cents<>0
    AND NOT EXISTS (SELECT 1 FROM fee_adjustment a WHERE a.fee_request_id=r.id)`).get()) fail(409, 'ADJUSTMENT_MISSING', '批准非零调整时须同时保存调整依据');
  for (const i of db.prepare(`SELECT id,amount_cents FROM bill_item WHERE pricing_status='已核价'`).all()) {
    const adjustments = db.prepare('SELECT amount_cents FROM fee_adjustment_item WHERE bill_item_id=?').all(i.id);
    if (adjustments.reduce((n, a) => n + BigInt(a.amount_cents), BigInt(i.amount_cents)) < 0n) fail(409, 'LINE_NEGATIVE', '单项累计调整后应收不能为负');
  }
  for (const b of db.prepare('SELECT id FROM bill').all()) {
    const charges = db.prepare("SELECT amount_cents FROM bill_item WHERE bill_id=? AND pricing_status='已核价'").all(b.id);
    let unpaid = charges.reduce((n, i) => n + BigInt(i.amount_cents), 0n);
    for (const a of db.prepare('SELECT i.amount_cents FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=?').all(b.id)) unpaid += BigInt(a.amount_cents);
    for (const table of ['payment_allocation', 'prepayment_offset']) for (const p of db.prepare(`SELECT amount_cents FROM ${table} WHERE bill_id=?`).all(b.id)) unpaid -= BigInt(p.amount_cents);
    if (unpaid < 0n) fail(409, 'BILL_BUDGET', '现有用途超过调整后的应收，须共同释放原用途');
  }
  for (const p of db.prepare('SELECT id,net_cents FROM patient_payment').all()) {
    let available = BigInt(p.net_cents);
    for (const table of ['payment_allocation', 'prepayment_offset']) for (const u of db.prepare(`SELECT amount_cents FROM ${table} WHERE patient_payment_id=?`).all(p.id)) available -= BigInt(u.amount_cents);
    for (const r of db.prepare('SELECT status,actual_cents,requested_cents FROM patient_refund WHERE patient_payment_id=?').all(p.id)) {
      if (r.status === '已确认退款') available -= BigInt(r.actual_cents);
      else if (['待办理', '待核实'].includes(r.status)) available -= BigInt(r.requested_cents);
    }
    if (available < 0n) fail(409, 'PAYMENT_BUDGET', '原款用途与退款占用合计超过净到账额');
  }
}
module.exports = { feeSnapshot, validateFees };
