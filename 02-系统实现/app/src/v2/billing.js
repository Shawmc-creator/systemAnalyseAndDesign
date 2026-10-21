'use strict';
const { fail, text, id, instant, dateOnly, day, utc, insert, fact, row, revision, recordNo } = require('./common');
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function safe(value) {
  if (value > MAX || value < -MAX) fail(422, 'MONEY_RANGE', '汇总金额超出安全整数分范围，请缩小业务范围并核对原单');
  return Number(value);
}
const sum = (rows, field) => rows.reduce((n, r) => n + BigInt(r[field]), 0n);
class Billing {
  constructor(db, unit) { this.db = db; this.unit = unit; }
  amount(value, zero = false) {
    if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) fail(422, 'INVALID_MONEY', '金额必须是安全范围内的整数分');
    return value;
  }
  fromExecution(execution, visit, ctx, now) {
    return this.fromFact({patientId:visit.patient_id,at:execution.completed_at,serviceId:execution.service_id,quantity:execution.completed_quantity,quantityScale:0,executionId:execution.id},ctx,now);
  }
  fromDispense(d,item,p,ctx,now){return this.fromFact({patientId:p.patient_id,at:d.dispensed_at,serviceId:item.billing_service_id,quantity:d.quantity_scaled,quantityScale:item.quantity_scale,dispenseId:d.id},ctx,now);}
  fromFact(source,ctx,now){
    const visit={patient_id:source.patientId},execution={id:source.executionId||null,completed_at:source.at,service_id:source.serviceId,completed_quantity:source.quantity};
    let funds = this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=?').get(visit.patient_id);
    if (!funds) funds = row(this.db, 'patient_funds', insert(this.db, 'patient_funds', fact(now, { patient_id: visit.patient_id, opened_at: now, opened_by: ctx.session.staff_id })));
    const start = utc(day(execution.completed_at) + 'T00:00:00+08:00'), end = utc(Date.parse(start) + 86400_000);
    let bill = this.db.prepare('SELECT * FROM bill WHERE patient_id=? AND period_start=? AND period_end=? ORDER BY id LIMIT 1').get(visit.patient_id, start, end);
    if (!bill) bill = row(this.db, 'bill', insert(this.db, 'bill', fact(now, { patient_id: visit.patient_id, patient_funds_id: funds.id, formed_at: now,
      period_start: start, period_end: end, created_by: ctx.session.staff_id, record_no: recordNo('BILL') })));
    else this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now, bill.id);
    const price = this.db.prepare(`SELECT * FROM service_price WHERE service_id=? AND status='已确认可适用'
      AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 1`).get(execution.service_id, execution.completed_at, execution.completed_at);
    if (price) safe(BigInt(price.unit_price_cents) * BigInt(execution.completed_quantity));
    const key = insert(this.db, 'bill_item', fact(now, { bill_id: bill.id, treatment_execution_id: execution.id, dispense_record_id:source.dispenseId||null,service_price_id: price?.id || null,
      quantity: execution.completed_quantity,quantity_scale:source.quantityScale, unit_price_cents: price?.unit_price_cents ?? null, priced_at: execution.completed_at,
      pricing_note: price ? '按实际执行发生时点引用已确认价目；依据：' + price.change_reason : '执行事实已保存；缺少适用的已确认价目，待负责人核价',
      pricing_status: price ? '已核价' : '待核价', priced_by: price ? ctx.session.staff_id : null }));
    ctx.authority.billItemId = key; ctx.authority.priceId = price?.id || null;
    // Include every priced line and signed adjustment, using integer arithmetic before returning a receipt.
    this.billSummary(bill.id);
    return key;
  }
  draft(credentials, input) {
    return this.unit.command(credentials, 'uc05.draft', input, (ctx, now) => {
      if (input.action === 'service') {
        const key = insert(this.db, 'service', fact(now, { name: text(input.name, '收费项目名称', 100), billing_unit: text(input.billingUnit, '计价单位', 50),
          is_active: 1, created_by: ctx.session.staff_id, record_no: recordNo('SERVICE') }));
        return { kind: 'service', key, revision: 1, reason: text(input.reason, '项目建立依据', 2000) };
      }
      if (input.action === 'draft') {
        const service = row(this.db, 'service', input.serviceId);
        if (!service.is_active) fail(409, 'SERVICE_DISABLED', '停用项目不能建立新价目');
        const cents = this.amount(input.unitPriceCents, true), start = instant(input.validFrom, '价目生效时间');
        const end = input.validUntil == null ? null : instant(input.validUntil, '价目适用截止时间');
        if (end && end <= start) fail(422, 'PRICE_INTERVAL', '适用截止时间须晚于生效时间');
        const reason = text(input.reason, '价目变更依据', 2000) + (cents === 0 ? '\n免收依据：' + text(input.waiverBasis, '免收依据', 1000) : '');
        if (input.priceId != null) {
          const price = row(this.db, 'service_price', input.priceId); revision(price, input.expectedRevision);
          if (price.service_id !== service.id || !['价目草稿', '已退回'].includes(price.status)) fail(409, 'PRICE_FROZEN', '只能修改该项目的草稿或退回价目，已发布内容请建立新版本');
          this.db.prepare('UPDATE service_price SET unit_price_cents=?,valid_from=?,valid_until=?,change_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(cents, start, end, reason, now, price.id);
          return { kind: 'service_price', key: price.id, beforeRevision: price.revision, revision: price.revision + 1 };
        }
        const key = insert(this.db, 'service_price', fact(now, { service_id: service.id, unit_price_cents: cents, valid_from: start, valid_until: end,
          change_reason: reason, confirmed_at: null, review_note: null, created_by: ctx.session.staff_id, confirmed_by: null, status: '价目草稿' }));
        return { kind: 'service_price', key, revision: 1 };
      }
      if (input.action !== 'submit') fail(422, 'INVALID_ACTION', '价目录入动作无效');
      const price = row(this.db, 'service_price', input.priceId); revision(price, input.expectedRevision);
      if (!['价目草稿', '已退回'].includes(price.status)) fail(409, 'INVALID_STATE', '当前价目不能提交负责人确认');
      this.db.prepare("UPDATE service_price SET status='待负责人确认',updated_at=?,revision=revision+1 WHERE id=?").run(now, price.id);
      return { kind: 'service_price', key: price.id, beforeRevision: price.revision, revision: price.revision + 1 };
    });
  }
  approve(credentials, input) {
    return this.unit.command(credentials, 'uc05.approve', input, (ctx, now) => {
      if (input.action === 'pricePending') return this.pricePending(ctx, input, now);
      const price = row(this.db, 'service_price', input.priceId); revision(price, input.expectedRevision);
      const note = text(input.reviewNote, '负责人处理意见', 2000);
      let status;
      if (input.action === 'approve' || input.action === 'return') {
        if (price.status !== '待负责人确认') fail(409, 'INVALID_STATE', '只有待确认价目可以确认或退回');
        if (input.action === 'approve' && !row(this.db, 'service', price.service_id).is_active) fail(409, 'SERVICE_DISABLED', '收费项目已停用');
        status = input.action === 'approve' ? '已确认可适用' : '已退回';
      } else if (input.action === 'stop') {
        if (price.status !== '已确认可适用') fail(409, 'INVALID_STATE', '只有已确认价目可以停止新计费');
        status = '不再用于新计费';
      } else fail(422, 'INVALID_ACTION', '价目确认动作无效');
      this.db.prepare('UPDATE service_price SET status=?,confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?').run(
        status, input.action === 'stop' ? price.confirmed_at : now, input.action === 'stop' ? price.confirmed_by : ctx.session.staff_id, note, now, price.id);
      return { kind: 'service_price', key: price.id, beforeRevision: price.revision, revision: price.revision + 1, reason: '负责人处理价目；原计费快照不变' };
    });
  }
  pricePending(ctx, input, now) {
    const item = row(this.db, 'bill_item', input.billItemId); revision(item, input.expectedRevision);
    if (item.pricing_status !== '待核价') fail(409, 'PRICE_FROZEN', '已核价应收不能重新定价，差错须走费用申请');
    const source=this.lines(item.bill_id).find(i=>i.id===item.id),execution={service_id:source.service_id}, price = row(this.db, 'service_price', input.priceId);
    if (price.status !== '已确认可适用' || price.service_id !== execution.service_id || price.valid_from > item.priced_at || (price.valid_until && price.valid_until <= item.priced_at)) fail(409, 'PRICE_NOT_APPLICABLE', '请选择覆盖原执行发生时点的已确认价目');
    safe(BigInt(price.unit_price_cents) * BigInt(item.quantity));
    this.db.prepare("UPDATE bill_item SET service_price_id=?,unit_price_cents=?,pricing_note=?,pricing_status='已核价',priced_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(
      price.id, price.unit_price_cents, text(input.reviewNote, '核价意见', 2000) + '\n价目依据：' + price.change_reason, ctx.session.staff_id, now, item.id);
    this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now, item.bill_id);
    this.billSummary(item.bill_id);
    return { kind: 'bill_item', key: item.id, beforeRevision: item.revision, revision: item.revision + 1, reason: '按原实际发生时点确认待核价项目' };
  }
  catalog(credentials) {
    const permission = credentials.role === 'dentist' ? 'uc04.execute' : credentials.role === 'manager' ? 'uc05.approve' : 'uc05.draft';
    return this.unit.query(credentials, permission, () => ({ services: this.db.prepare('SELECT * FROM service ORDER BY id').all(), prices: this.db.prepare('SELECT * FROM service_price ORDER BY service_id,valid_from,id').all(),
      ...(credentials.role==='manager'?{pendingItems:this.lines().filter(i=>i.pricing_status==='待核价').slice(0,100)}: {}) }));
  }
  lines(billId=null){return this.db.prepare(`SELECT i.*,coalesce(e.service_id,pi.billing_service_id) service_id,
    CASE WHEN d.id IS NOT NULL THEN pi.drug_name ELSE s.name END service_name,coalesce(pi.unit,s.billing_unit) billing_unit,
    coalesce(e.completed_at,d.dispensed_at) completed_at,EXISTS(SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=e.id) has_clinical_correction,
    b.record_no bill_no,p.name patient_name,p.record_no patient_no FROM bill_item i JOIN bill b ON b.id=i.bill_id JOIN patient p ON p.id=b.patient_id
    LEFT JOIN treatment_execution e ON e.id=i.treatment_execution_id LEFT JOIN dispense_record d ON d.id=i.dispense_record_id
    LEFT JOIN prescription_item pi ON pi.id=d.prescription_item_id LEFT JOIN service s ON s.id=coalesce(e.service_id,pi.billing_service_id)
    WHERE (? IS NULL OR i.bill_id=?) ORDER BY i.priced_at,i.id`).all(billId,billId);}
  billSummary(billId) {
    const items = this.db.prepare('SELECT amount_cents,pricing_status FROM bill_item WHERE bill_id=?').all(billId);
    const priced = items.filter(i => i.pricing_status === '已核价');
    const charges = priced.reduce((n, i) => n + BigInt(i.amount_cents), 0n);
    const adjustments = sum(this.db.prepare('SELECT i.amount_cents FROM fee_adjustment_item i JOIN fee_adjustment a ON a.id=i.fee_adjustment_id WHERE a.bill_id=?').all(billId), 'amount_cents');
    const allocated = sum(this.db.prepare('SELECT amount_cents FROM payment_allocation WHERE bill_id=?').all(billId), 'amount_cents');
    const offset = sum(this.db.prepare('SELECT amount_cents FROM prepayment_offset WHERE bill_id=?').all(billId), 'amount_cents');
    const insuranceCents=require('./settlement-rules').insuranceShare(this.db,billId);
    const pending = items.length - priced.length, unpaid = charges + adjustments - allocated - offset-BigInt(insuranceCents);
    return { pricedCents: safe(charges), adjustmentCents: safe(adjustments), receivableCents: safe(charges + adjustments), allocatedCents: safe(allocated),
      offsetCents: safe(offset), insuranceCents,patientDueCents:safe(charges+adjustments-BigInt(insuranceCents)),unpaidCents: safe(unpaid), pendingPricingCount: pending, settled: items.length > 0 && pending === 0 && unpaid === 0n };
  }
  fundsSummary(patientId) {
    const funds = this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=?').get(patientId);
    if (!funds) return { id: null, revision: null, confirmedReceivedCents: 0, pendingPaymentCents: 0, allocatedCents: 0, offsetCents: 0, refundedCents: 0, refundHeldCents: 0, availableCents: 0, payments: [] };
    const payments = this.db.prepare('SELECT * FROM patient_payment WHERE patient_funds_id=? ORDER BY id').all(funds.id).map(p => {
      const allocation = sum(this.db.prepare('SELECT amount_cents FROM payment_allocation WHERE patient_payment_id=?').all(p.id), 'amount_cents');
      const offset = sum(this.db.prepare('SELECT amount_cents FROM prepayment_offset WHERE patient_payment_id=?').all(p.id), 'amount_cents');
      const refunds = this.db.prepare('SELECT status,actual_cents,requested_cents FROM patient_refund WHERE patient_payment_id=?').all(p.id);
      const refunded = sum(refunds.filter(r => r.status === '已确认退款'), 'actual_cents'), held = sum(refunds.filter(r => ['待办理', '待核实'].includes(r.status)), 'requested_cents');
      const purposes = table => this.db.prepare(`SELECT id,bill_id,amount_cents,effective_at,reason,revision,${table==='payment_allocation'?'original_allocation_id':'original_offset_id'} original_id FROM ${table} WHERE patient_payment_id=? ORDER BY id`).all(p.id);
      return { id: p.id, recordNo: p.record_no, revision: p.revision, status: p.status, channel: p.channel, receivedAt: p.received_at,
        receivedCents: p.received_cents, changeCents: p.change_cents, netCents: p.net_cents, verifiedAt: p.verified_at, externalReference: p.external_reference,
        allocations: purposes('payment_allocation'), offsets: purposes('prepayment_offset'),
        allocatedCents: safe(allocation), offsetCents: safe(offset), refundedCents: safe(refunded), refundHeldCents: safe(held),
        availableCents: p.status === '到账已确认' ? safe(BigInt(p.net_cents) - allocation - offset - refunded - held) : 0 };
    });
    const aggregate = key => safe(sum(payments, key));
    return { id: funds.id, revision: funds.revision,
      confirmedReceivedCents: safe(sum(payments.filter(p => p.status === '到账已确认'), 'netCents')),
      pendingPaymentCents: safe(sum(payments.filter(p => p.status === '待核实'), 'netCents')),
      allocatedCents: aggregate('allocatedCents'), offsetCents: aggregate('offsetCents'), refundedCents: aggregate('refundedCents'),
      refundHeldCents: aggregate('refundHeldCents'), availableCents: aggregate('availableCents'), payments };
  }
  candidates(credentials,input={}){
    const permission=credentials.role==='manager'?'uc25.approve':'uc06.query';
    return this.unit.query(credentials,permission,()=>{
      const q=String(input.q||'').trim();if(q.length>80)fail(422,'INVALID_INPUT','患者查找条件过长');
      const pattern='%'+q.replace(/[!%_]/g,'!$&')+'%';
      return {items:this.db.prepare(`SELECT p.id,p.name,p.record_no,p.phone,p.phone_owner FROM patient p
        WHERE (p.name LIKE ? ESCAPE '!' OR p.phone LIKE ? ESCAPE '!' OR p.record_no=?)
        AND (?<>'manager' OR EXISTS(SELECT 1 FROM patient_funds f JOIN fee_request r ON r.patient_funds_id=f.id WHERE f.patient_id=p.id))
        ORDER BY p.id DESC LIMIT 50`).all(pattern,pattern,q,credentials.role)};
    });
  }
  query(credentials, input) {
    return this.unit.query(credentials, 'uc06.query', () => {
      const patient = row(this.db, 'patient', Number(input.patientId));
      const billId = input.billId == null ? null : id(Number(input.billId));
      if (billId && row(this.db, 'bill', billId).patient_id !== patient.id) fail(403, 'PATIENT_MISMATCH', '账目与指定患者不一致');
      const from = input.from == null ? null : utc(dateOnly(input.from) + 'T00:00:00+08:00');
      const until = input.to == null ? null : utc(Date.parse(dateOnly(input.to) + 'T00:00:00+08:00') + 86400_000);
      if (from && until && from >= until) fail(422, 'INVALID_RANGE', '开始日期不得晚于结束日期');
      const page = input.page == null ? 1 : id(Number(input.page)), size = input.pageSize == null ? 20 : id(Number(input.pageSize));
      if (size > 100 || page > 1000000) fail(422, 'INVALID_PAGE', '每页最多100项，页码须在有效范围内');
      for (const name of ['pendingOnly', 'unpaidOnly']) if (input[name] != null && !['true', 'false', true, false].includes(input[name])) fail(422, 'INVALID_FILTER', '筛选开关无效');
      const bills = this.db.prepare(`SELECT * FROM bill WHERE patient_id=? AND (? IS NULL OR id=?)
        AND (? IS NULL OR period_start>=?) AND (? IS NULL OR period_start<?) ORDER BY period_start DESC,id DESC`).all(patient.id, billId, billId, from, from, until, until).map(b => ({ ...b, summary: this.billSummary(b.id) }))
        .filter(b => (!['true', true].includes(input.pendingOnly) || b.summary.pendingPricingCount > 0) && (!['true', true].includes(input.unpaidOnly) || b.summary.unpaidCents > 0));
      const items = bills.slice((page - 1) * size, page * size).map(b => ({ ...b,
        items:this.lines(b.id) }));
      const total = field => safe(bills.reduce((n, b) => n + BigInt(b.summary[field]), 0n));
      return { patient: { id: patient.id, recordNo: patient.record_no, name: patient.name }, computedAt: this.unit.auth.now(), total: bills.length, page, pageSize: size, items,
        totals: { receivableCents: total('receivableCents'), allocatedCents: total('allocatedCents'), offsetCents: total('offsetCents'), unpaidCents: total('unpaidCents'), pendingPricingCount: bills.reduce((n, b) => n + b.summary.pendingPricingCount, 0) },
        funds: this.fundsSummary(patient.id) };
    });
  }
}
module.exports = { Billing, safe };
