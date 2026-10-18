'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, command } = require('./helpers/v2-treatment');
const { insert, fact } = require('../src/v2/common');
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
const check = { independentCheck: true, independentBasis: '牙医如实记录的独立检查，不虚构治疗方案' };
test('cashier drafts and resubmits prices; only the manager can publish after review', t => {
  const a = setup(t), s = a.service(), price = a.price(s.id, {}, false);
  rejects(() => a.billing.approve(a.c, command({ action: 'approve', priceId: price.id, expectedRevision: 2, reviewNote: '试图自行确认' })), 'FORBIDDEN');
  a.billing.approve(a.m, command({ action: 'return', priceId: price.id, expectedRevision: 2, reviewNote: '补充适用依据' }));
  const changed = a.billing.draft(a.c, command({ action: 'draft', priceId: price.id, expectedRevision: 3, serviceId: s.id,
    unitPriceCents: 25000, validFrom: '2026-10-19T00:00:00+08:00', reason: '补充核对后的价目' }));
  a.billing.draft(a.c, command({ action: 'submit', priceId: price.id, expectedRevision: changed.revision }));
  a.billing.approve(a.m, command({ action: 'approve', priceId: price.id, expectedRevision: 5, reviewNote: '已核对' }));
  assert.equal(a.billing.catalog(a.c).prices[0].status, '已确认可适用');
  rejects(() => a.billing.draft(a.c, command({ action: 'draft', priceId: price.id, expectedRevision: 6, serviceId: s.id, unitPriceCents: 1,
    validFrom: '2026-10-19T00:00:00+08:00', reason: '试图改写发布内容' })), 'PRICE_FROZEN');
});
test('overlapping approved prices fail atomically; adjacent half-open intervals are accepted', t => {
  const a = setup(t), s = a.service();
  a.price(s.id, { validUntil: '2026-10-19T10:00:00+08:00' });
  const pending = a.price(s.id, { validFrom: '2026-10-19T09:59:59+08:00' }, false);
  rejects(() => a.billing.approve(a.m, command({ action: 'approve', priceId: pending.id, expectedRevision: 2, reviewNote: '重叠发布' })), 'PRICE_OVERLAP');
  assert.equal(a.db.prepare('SELECT status FROM service_price WHERE id=?').get(pending.id).status, '待负责人确认');
  a.price(s.id, { validFrom: '2026-10-19T10:00:00+08:00', unitPriceCents: 22000 });
  a.execute(s.id, check); assert.equal(a.bills().totals.receivableCents, 20000);
});
test('missing price remains unknown instead of zero; manager can later price once against the original occurrence time', t => {
  const a = setup(t), s = a.service(); a.execute(s.id, check);
  let b = a.bills().items[0]; const line = b.items[0];
  assert.equal(line.unit_price_cents, null); assert.equal(b.summary.pendingPricingCount, 1); assert.equal(b.summary.settled, false);
  const wrong = a.price(s.id, { validFrom: '2026-10-20T00:00:00+08:00' });
  rejects(() => a.billing.approve(a.m, command({ action: 'pricePending', billItemId: line.id, expectedRevision: 1, priceId: wrong.id, reviewNote: '不适用过去时点' })), 'PRICE_NOT_APPLICABLE');
  const right = a.price(s.id, { validUntil: '2026-10-20T00:00:00+08:00' });
  a.billing.approve(a.m, command({ action: 'pricePending', billItemId: line.id, expectedRevision: 1, priceId: right.id, reviewNote: '补充已核实的原执行价目依据' }));
  b = a.bills().items[0]; assert.equal(b.summary.receivableCents, 20000); assert.equal(b.summary.pendingPricingCount, 0);
  rejects(() => a.billing.approve(a.m, command({ action: 'pricePending', billItemId: line.id, expectedRevision: 2, priceId: right.id, reviewNote: '试图重新定价' })), 'PRICE_FROZEN');
});
test('zero-price needs explicit waiver evidence and is distinct from a missing price', t => {
  const a = setup(t), s = a.service();
  rejects(() => a.price(s.id, { unitPriceCents: 0 }), 'INVALID_INPUT');
  a.price(s.id, { unitPriceCents: 0, waiverBasis: '负责人确认的本次检查免收政策' }); a.execute(s.id, check);
  const b = a.bills().items[0]; assert.equal(b.summary.pendingPricingCount, 0); assert.equal(b.summary.settled, true);
  assert.match(b.items[0].pricing_note, /免收依据/);
});
test('stopping a price preserves historical amount; new executions become pending rather than use a retired price', t => {
  const a = setup(t), s = a.service(), p = a.price(s.id); a.execute(s.id, check);
  a.billing.approve(a.m, command({ action: 'stop', priceId: p.id, expectedRevision: 3, reviewNote: '停止后续新计费，历史原单保留' }));
  a.execute(s.id, check);
  const b = a.bills().items[0]; assert.equal(b.summary.receivableCents, 20000); assert.equal(b.summary.pendingPricingCount, 1); assert.equal(b.summary.settled, false);
  assert.equal(b.items[0].unit_price_cents, 20000); assert.equal(b.items[1].unit_price_cents, null);
});
test('unsafe multiplied money rolls back clinical and billing facts instead of losing precision', t => {
  const a = setup(t), s = a.service(); a.price(s.id, { unitPriceCents: Number.MAX_SAFE_INTEGER });
  rejects(() => a.execute(s.id, { ...check, quantity: 2 }), 'MONEY_RANGE');
  for (const table of ['treatment_execution', 'bill_item', 'bill', 'patient_funds']) assert.equal(a.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  rejects(() => a.price(s.id, { unitPriceCents: 0.1 }), 'INVALID_MONEY');
});
test('bill queries expose no diagnosis, health or procedure text and validate dates, pages and patient identity', t => {
  const a = setup(t), s = a.service(); a.price(s.id); a.execute(s.id, { ...check, procedureNote: '不得流向收费查询的临床私密正文' });
  const b = a.bills(); const serialized = JSON.stringify(b);
  assert.equal(serialized.includes('不得流向'), false); assert.equal(serialized.includes('diagnosis'), false); assert.equal(serialized.includes('health'), false);
  assert.equal(a.bills({ pendingOnly: 'true' }).total, 0); assert.equal(a.bills({ unpaidOnly: 'true' }).total, 1);
  assert.equal(a.bills({ from: '2026-10-20' }).total, 0); assert.equal(a.bills({ to: '2026-10-18' }).total, 0);
  assert.equal(a.bills({ page: 2, pageSize: 1 }).items.length, 0);
  rejects(() => a.bills({ page: 0 }), 'INVALID_INPUT'); rejects(() => a.bills({ pageSize: 101 }), 'INVALID_PAGE');
  rejects(() => a.bills({ from: '2026-10-20', to: '2026-10-18' }), 'INVALID_RANGE');
  rejects(() => a.bills({ pendingOnly: 'garbage' }), 'INVALID_FILTER');
  rejects(() => a.billing.query(a.c, { patientId: 2, billId: b.items[0].id }), 'PATIENT_MISMATCH');
});
test('fund summaries separate actual received, allocated, prepayment and unverified money without clinical payloads', t => {
  const a = setup(t), s = a.service(); a.price(s.id); a.execute(s.id, { ...check, quantity: 5 });
  const b = a.bills().items[0], now = a.auth.now();
  const payment = insert(a.db, 'patient_payment', fact(now, { patient_funds_id: b.patient_funds_id, received_cents: 60000, change_cents: 10000,
    channel: '现金', received_at: now, transaction_evidence: '当面核对实收及找零', external_reference: null, verified_at: now, operator_id: 3, verified_by: 3, status: '到账已确认', record_no: 'PAY-TEST-1' }));
  insert(a.db, 'payment_allocation', fact(now, { patient_payment_id: payment, bill_id: b.id, amount_cents: 20000, effective_at: now, reason: '当次用途', operator_id: 3, original_allocation_id: null, fee_request_id: null }));
  insert(a.db, 'prepayment_offset', fact(now, { patient_payment_id: payment, bill_id: b.id, amount_cents: 10000, effective_at: now, reason: '预付余额抵扣', operator_id: 3, original_offset_id: null, fee_request_id: null }));
  insert(a.db, 'patient_payment', fact(now, { patient_funds_id: b.patient_funds_id, received_cents: 15000, change_cents: 0,
    channel: '微信', received_at: null, transaction_evidence: '待核实，不能作已收', external_reference: null, verified_at: null, operator_id: 3, verified_by: null, status: '待核实', record_no: 'PAY-TEST-2' }));
  const result = a.bills(); assert.equal(result.totals.receivableCents, 100000); assert.equal(result.totals.unpaidCents, 70000);
  assert.equal(result.funds.confirmedReceivedCents, 50000); assert.equal(result.funds.pendingPaymentCents, 15000); assert.equal(result.funds.availableCents, 20000);
  assert.equal(result.funds.allocatedCents, 20000); assert.equal(result.funds.offsetCents, 10000);
});
