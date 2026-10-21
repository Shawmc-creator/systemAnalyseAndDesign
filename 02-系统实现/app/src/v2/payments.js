'use strict';
const { fail, text, instant, insert, fact, row, revision, recordNo } = require('./common');
const { safe } = require('./billing');
class Payments {
  constructor(db, unit, billing) { Object.assign(this, { db, unit, billing }); }
  funds(input, ctx, now) {
    const patient = row(this.db, 'patient', input.patientId);
    let funds = this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=?').get(patient.id);
    if (funds) revision(funds, input.expectedFundsRevision);
    else {
      if (input.expectedFundsRevision != null) fail(409, 'VERSION_CONFLICT', '当前患者尚未建立资金账户，请重新核对');
      funds = row(this.db, 'patient_funds', insert(this.db, 'patient_funds', fact(now, { patient_id: patient.id, opened_at: now, opened_by: ctx.session.staff_id })));
    }
    return funds;
  }
  touchFunds(funds, now) {
    this.db.prepare('UPDATE patient_funds SET updated_at=?,revision=revision+1 WHERE id=?').run(now, funds.id);
  }
  receivedAt(value, now) {
    const at = instant(value, '实际到账时间');
    if (at > now) fail(422, 'PAYMENT_TIME', '实际到账时间不能在未来');
    return at;
  }
  uniqueReference(channel, reference, except = -1) {
    if (channel !== '现金' && reference && this.db.prepare('SELECT id FROM patient_payment WHERE channel=? AND external_reference=? AND id<>?').get(channel, reference, except)) fail(409, 'PAYMENT_DUPLICATE', '该渠道交易已经登记，请核实原付款结果，不能重复收款');
  }
  apply(ctx, payment, funds, allocations, kind, now) {
    if (!Array.isArray(allocations) || allocations.length > 100 || new Set(allocations.map(a => a.billId)).size !== allocations.length) fail(422, 'ALLOCATION_LIST', '用途须为不超过100项且账目不重复的列表');
    if (payment.status !== '到账已确认') fail(409, 'PAYMENT_NOT_CONFIRMED', '仅已核实到账的原款可以分配或抵扣');
    const balance = this.billing.fundsSummary(funds.patient_id).payments.find(p => p.id === payment.id);
    let total = 0n;
    for (const allocation of allocations) {
      const bill = row(this.db, 'bill', allocation.billId); revision(bill, allocation.expectedRevision);
      require('./settlement-rules').paymentGate(this.db,bill.id,ctx.authority.paymentOrderId);
      if (bill.patient_funds_id !== funds.id || bill.patient_id !== funds.patient_id) fail(409, 'PAYMENT_PATIENT', '原款和目标账目必须属于同一患者');
      const cents = this.billing.amount(allocation.amountCents);
      if (cents > this.billing.billSummary(bill.id).unpaidCents) fail(409, 'BILL_BUDGET', '分配不能超过当前已核价应收的未付金额');
      total += BigInt(cents);
      if (total > BigInt(balance.availableCents)) fail(409, 'PAYMENT_BUDGET', '原款可用额不足，已分配、抵扣及退款占用共用同一余额');
      const reason = text(allocation.reason, '本次用途依据', 2000);
      const isOffset = kind === 'offset';
      insert(this.db, isOffset ? 'prepayment_offset' : 'payment_allocation', fact(now, { patient_payment_id: payment.id, bill_id: bill.id,
        amount_cents: cents, effective_at: now, reason, operator_id: ctx.session.staff_id,
        ...(isOffset ? { original_offset_id: null } : { original_allocation_id: null }), fee_request_id: null }));
      this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now, bill.id);
    }
    ctx.authority.paymentId = payment.id; ctx.authority.billIds = allocations.map(a => a.billId);
    return safe(total);
  }
  receive(credentials, input) {
    return this.unit.command(credentials, 'uc07.receive', input, (ctx, now) => {
      const funds = this.funds(input, ctx, now), allocations = input.allocations || [];
      if (!Array.isArray(allocations)) fail(422, 'ALLOCATION_LIST', '付款用途必须是列表');
      if (allocations.length) {
        const extra = this.unit.auth.authorize(credentials.token, credentials.role, 'uc07.allocate', credentials.csrf ?? '');
        ctx.authority.allocationPermissionId = extra.permission.id;
      }
      let payment;
      if (input.action === 'receive') {
        const received = this.billing.amount(input.receivedCents), change = this.billing.amount(input.changeCents, true);
        if (change >= received || !['现金', '银行卡', '微信', '支付宝'].includes(input.channel) || (input.channel !== '现金' && change !== 0)) fail(422, 'PAYMENT_AMOUNT_CHANNEL', '请核对实收、找零及渠道；非现金不能找零');
        if (!['confirmed', 'pending'].includes(input.verification)) fail(422, 'PAYMENT_VERIFICATION', '须明确已核实到账或待核实');
        const confirmed = input.verification === 'confirmed';
        if (!confirmed && allocations.length) fail(409, 'PAYMENT_NOT_CONFIRMED', '到账待核实不能减少账目未付或增加可用预付');
        const reference = input.externalReference == null ? null : text(input.externalReference, '渠道交易号', 200);
        if (confirmed && input.channel !== '现金' && !reference) fail(422, 'PAYMENT_REFERENCE', '非现金已到账必须有已核实的渠道交易号');
        this.uniqueReference(input.channel, reference);
        const key = insert(this.db, 'patient_payment', fact(now, { patient_funds_id: funds.id, received_cents: received, change_cents: change,
          channel: input.channel, received_at: confirmed ? this.receivedAt(input.receivedAt, now) : null,
          transaction_evidence: text(input.transactionEvidence, '实际到账或待核实依据', 4000), external_reference: reference,
          verified_at: confirmed ? now : null, operator_id: ctx.session.staff_id, verified_by: confirmed ? ctx.session.staff_id : null,
          status: confirmed ? '到账已确认' : '待核实', record_no: recordNo('PAY') }));
        payment = row(this.db, 'patient_payment', key);
      } else if (input.action === 'verify') {
        payment = row(this.db, 'patient_payment', input.paymentId); revision(payment, input.expectedPaymentRevision);
        if (payment.patient_funds_id !== funds.id) fail(409, 'PAYMENT_PATIENT', '原款与当前患者不一致');
        if (payment.status !== '待核实') fail(409, 'PAYMENT_FROZEN', '该原款核实结果已冻结，不能覆盖');
        if (!['received', 'notReceived'].includes(input.outcome)) fail(422, 'PAYMENT_VERIFICATION', '请明确到账或未到账的核实结果');
        const confirmed = input.outcome === 'received';
        if (!confirmed && allocations.length) fail(409, 'PAYMENT_NOT_CONFIRMED', '已核实未到账不能产生付款用途');
        const reference = input.externalReference == null ? payment.external_reference : text(input.externalReference, '渠道交易号', 200);
        if (payment.external_reference && reference !== payment.external_reference) fail(409, 'PAYMENT_REFERENCE_FROZEN', '核实须保留原交易号，不能改指另一笔实际交易');
        if (confirmed && payment.channel !== '现金' && !reference) fail(422, 'PAYMENT_REFERENCE', '非现金已到账须有核实后的交易号');
        this.uniqueReference(payment.channel, reference, payment.id);
        this.db.prepare('UPDATE patient_payment SET status=?,received_at=?,verified_at=?,verified_by=?,external_reference=?,transaction_evidence=?,updated_at=?,revision=revision+1 WHERE id=?').run(
          confirmed ? '到账已确认' : '未到账已核实', confirmed ? this.receivedAt(input.receivedAt, now) : null, now, ctx.session.staff_id, reference,
          payment.transaction_evidence + '\n核实结论依据：' + text(input.transactionEvidence, '核实依据', 4000), now, payment.id);
        payment = row(this.db, 'patient_payment', payment.id);
      } else fail(422, 'INVALID_ACTION', '收款办理动作无效');
      if (payment.status === '到账已确认') {
        const applied = this.apply(ctx, payment, funds, allocations, 'allocate', now);
        if (applied < payment.net_cents && input.keepAsPrepayment !== true) fail(422, 'PREPAYMENT_CONFIRMATION', '净到账额超出本次用途，须明确将剩余额作为患者预付款，或核对现金找零');
      }
      this.touchFunds(funds, now); this.billing.fundsSummary(funds.patient_id);
      ctx.authority.paymentId = payment.id;
      return { kind: 'patient_payment', key: payment.id, revision: payment.revision, beforeRevision: input.action === 'verify' ? payment.revision - 1 : null,
        reason: payment.status === '待核实' ? '登记到账待核实，不增加可用资金' : '如实核实实际到账及用途，剩余额单独保留预付' };
    });
  }
  allocate(credentials, input) {
    return this.unit.command(credentials, 'uc07.allocate', input, (ctx, now) => {
      if (!['allocate', 'offset'].includes(input.action)) fail(422, 'INVALID_ACTION', '请选择付款分配或预付抵扣');
      const funds = this.funds(input, ctx, now), payment = row(this.db, 'patient_payment', input.paymentId);
      revision(payment, input.expectedPaymentRevision);
      if (payment.patient_funds_id !== funds.id) fail(409, 'PAYMENT_PATIENT', '原款与当前患者不一致');
      if (!Array.isArray(input.allocations) || input.allocations.length === 0) fail(422, 'ALLOCATION_LIST', '请明确至少一项目标账目及金额');
      this.apply(ctx, payment, funds, input.allocations, input.action, now);
      this.touchFunds(funds, now); this.billing.fundsSummary(funds.patient_id);
      // Confirmed payment rows are terminal facts. Only the aggregate revision and new purpose facts change.
      return { kind: 'patient_funds', key: funds.id, beforeRevision: funds.revision, revision: funds.revision + 1,
        reason: input.action === 'offset' ? '使用已确认原款的可用预付，不新增现金流入' : '分配既有已确认原款，不改付款原事实' };
    });
  }
}
module.exports = { Payments };
