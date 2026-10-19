'use strict';
const { fail, text, id, insert, fact, row, revision, recordNo, canonical, hash } = require('./common');
const { safe } = require('./billing');
const signedAmount = value => {
  if (!Number.isSafeInteger(value)) fail(422, 'INVALID_MONEY', '费用调整必须为安全范围内的整数分');
  return value;
};
const changes = (before, after, fields) => fields.filter(k => before[k] !== after[k]).map(k => ({ field: k, before: before[k], after: after[k] }));
const HISTORY = ['reason', 'evidence', 'proposed_adjustment_cents', 'proposed_refund_cents', 'submission_no', 'review_note', 'reviewed_at', 'reviewed_by', 'status'];
const proposalDigest = r => hash(canonical(Object.fromEntries(['patient_funds_id','bill_id','patient_payment_id','reason','evidence',
  'proposed_adjustment_cents','proposed_refund_cents','submission_no','submitted_at','created_by'].map(k => [k, r[k]]))));
class Fees {
  constructor(db, unit, billing, payments) { Object.assign(this, { db, unit, billing, payments }); }
  sources(input, existing = null) {
    const patient = row(this.db, 'patient', input.patientId), funds = this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=?').get(patient.id);
    if (!funds) fail(409, 'FEE_SOURCE_MISSING', '患者尚无可追溯的费用或原付款来源');
    revision(funds, input.expectedFundsRevision);
    const billId = existing ? existing.bill_id : input.billId ?? null, paymentId = existing ? existing.patient_payment_id : input.paymentId ?? null;
    if (existing && (existing.patient_funds_id !== funds.id || (input.billId != null && input.billId !== billId) || (input.paymentId != null && input.paymentId !== paymentId))) fail(409, 'FEE_SOURCE_CHANGED', '申请原始来源不能改指其他患者或原单');
    if (!billId && !paymentId) fail(422, 'FEE_SOURCE_MISSING', '至少选择原账目或原付款之一');
    const bill = billId ? row(this.db, 'bill', billId) : null, payment = paymentId ? row(this.db, 'patient_payment', paymentId) : null;
    if ((bill && bill.patient_funds_id !== funds.id) || (payment && payment.patient_funds_id !== funds.id)) fail(409, 'PAYMENT_PATIENT', '费用申请及所有原单必须属于同一患者');
    if (bill) revision(bill, input.expectedBillRevision);
    if (payment) revision(payment, input.expectedPaymentRevision);
    return { funds, bill, payment, refs: { fundsId: funds.id, fundsRevision: funds.revision, billId, billRevision: bill?.revision ?? null, paymentId, paymentRevision: payment?.revision ?? null } };
  }
  eligiblePayments(source) {
    const payments = this.billing.fundsSummary(source.funds.patient_id).payments.filter(p => p.status === '到账已确认');
    if (source.payment) return payments.filter(p => p.id === source.payment.id);
    return payments.filter(p => [...p.allocations, ...p.offsets].some(u => u.bill_id === source.bill.id && u.amount_cents > 0));
  }
  duplicate(source, except = -1) {
    const other = this.db.prepare(`SELECT id FROM fee_request WHERE patient_funds_id=? AND id<>? AND status IN ('待审核','已退回')
      AND ((? IS NOT NULL AND bill_id=?) OR (? IS NOT NULL AND patient_payment_id=?))`).get(source.funds.id, except, source.bill?.id ?? null, source.bill?.id ?? null, source.payment?.id ?? null, source.payment?.id ?? null);
    if (other) fail(409, 'FEE_REQUEST_PENDING', '所选原单已有未完成申请，请处理原申请', { requestId: other.id });
  }
  proposal(input, source) {
    const adjustment = signedAmount(input.adjustmentCents), refund = this.billing.amount(input.refundCents, true);
    if (adjustment === 0 && refund === 0) fail(422, 'FEE_AMOUNT_EMPTY', '至少提出一种非零的费用调整或退款金额');
    if (adjustment && !source.bill) fail(422, 'FEE_BILL_REQUIRED', '应收调整必须有原账目');
    if (refund && source.payment?.status !== undefined && source.payment.status !== '到账已确认') fail(409, 'PAYMENT_NOT_CONFIRMED', '原款到账未确认，不能申请可执行退费');
    if (source.bill) {
      const summary = this.billing.billSummary(source.bill.id);
      if (BigInt(summary.receivableCents) + BigInt(adjustment) < 0n) fail(409, 'BILL_BUDGET', '拟调整后总应收不能为负');
      safe(BigInt(summary.receivableCents) + BigInt(adjustment));
    }
    const eligible = this.eligiblePayments(source);
    const free = eligible.reduce((n, p) => n + BigInt(p.availableCents), 0n);
    const releasable = source.bill ? eligible.reduce((n, p) => n + [...p.allocations, ...p.offsets].filter(u => u.bill_id === source.bill.id).reduce((m, u) => m + BigInt(u.amount_cents), 0n), 0n) : 0n;
    const possibleRelease = adjustment < 0 ? (releasable < -BigInt(adjustment) ? releasable : -BigInt(adjustment)) : 0n;
    if (BigInt(refund) > free + possibleRelease) fail(409, 'REFUND_BUDGET', '拟退金额超过原款当前可用额及有据调整可释放的范围');
    return { adjustment, refund };
  }
  correctionRefs(input, source) {
    const ids = input.clinicalCorrectionIds || [];
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) fail(422, 'CORRECTION_REFS', '临床更正依据列表无效');
    for (const key of ids) {
      const correction = row(this.db, 'treatment_execution', key);
      if (!source.bill || !correction.original_execution_id) fail(409, 'CORRECTION_REFS', '临床更正须有原记录及当前账目来源');
      const root = this.db.prepare(`WITH RECURSIVE chain(id,original_execution_id) AS (
        SELECT id,original_execution_id FROM treatment_execution WHERE id=? UNION ALL
        SELECT e.id,e.original_execution_id FROM treatment_execution e JOIN chain c ON c.original_execution_id=e.id)
        SELECT b.id FROM chain c JOIN bill_item b ON b.treatment_execution_id=c.id WHERE b.bill_id=? LIMIT 1`).get(correction.id, source.bill.id);
      if (!root) fail(409, 'CORRECTION_REFS', '临床更正与原账目不一致');
    }
    return ids;
  }
  apply(credentials, input) {
    return this.unit.command(credentials, 'uc24.apply', input, (ctx, now) => {
      if (input.action === 'withdraw') {
        const request = row(this.db, 'fee_request', input.requestId); revision(request, input.expectedRevision);
        const source = this.sources(input, request);
        if (request.status !== '待审核') fail(409, 'INVALID_STATE', '只能撤回尚待审核的申请');
        const reason = text(input.reason, '撤回原因', 2000);
        this.db.prepare("UPDATE fee_request SET status='已撤回',updated_at=?,revision=revision+1 WHERE id=?").run(now, request.id);
        ctx.authority.sourceRefs = source.refs;
        return { kind: 'fee_request', key: request.id, beforeRevision: request.revision, revision: request.revision + 1, reason,
          changes: [{ field: 'status', before: request.status, after: '已撤回' }] };
      }
      if (!['submit', 'resubmit'].includes(input.action)) fail(422, 'INVALID_ACTION', '请选择提交、重提或撤回申请');
      const old = input.action === 'resubmit' ? row(this.db, 'fee_request', input.requestId) : null;
      if (old) { revision(old, input.expectedRevision); if (old.status !== '已退回') fail(409, 'INVALID_STATE', '只有已退回申请可以重新提交'); }
      const source = this.sources(input, old); this.duplicate(source, old?.id ?? -1);
      const amounts = this.proposal(input, source), correctionIds = this.correctionRefs(input, source);
      const fields = { reason: text(input.reason, '申请原因', 2000), proposed_adjustment_cents: amounts.adjustment, proposed_refund_cents: amounts.refund,
        evidence: text(input.evidence, '核实及申请证据', 6000), submitted_at: now, submission_no: old ? old.submission_no + 1 : 1,
        review_note: null, reviewed_at: null, reviewed_by: null, status: '待审核' };
      let key;
      if (old) {
        this.db.prepare(`UPDATE fee_request SET reason=?,proposed_adjustment_cents=?,proposed_refund_cents=?,evidence=?,submitted_at=?,submission_no=?,
          review_note=?,reviewed_at=?,reviewed_by=?,status=?,updated_at=?,revision=revision+1 WHERE id=?`).run(...Object.values(fields), now, old.id);
        key = old.id;
      } else key = insert(this.db, 'fee_request', fact(now, { patient_funds_id: source.funds.id, bill_id: source.bill?.id ?? null,
        patient_payment_id: source.payment?.id ?? null, ...fields, approved_adjustment_cents: null, approved_refund_cents: null,
        created_by: ctx.session.staff_id, record_no: recordNo('FEE') }));
      ctx.authority.sourceRefs = source.refs; ctx.authority.submissionNo = fields.submission_no; ctx.authority.clinicalCorrectionIds = correctionIds;
      ctx.authority.proposalDigest = proposalDigest(row(this.db, 'fee_request', key));
      return { kind: 'fee_request', key, beforeRevision: old?.revision, revision: old ? old.revision + 1 : 1, reason: '保留本次申请和原单版本；尚未改变应收及资金',
        changes: old ? changes(old, fields, HISTORY) : [] };
    });
  }
  submittedBasis(request) {
    const audit = this.db.prepare(`SELECT a.* FROM operation_audit a JOIN access_permission p ON p.id=a.permission_id
      WHERE a.object_kind='fee_request' AND a.object_key=? AND a.event_type='变更' AND p.code='uc24.apply'
      ORDER BY a.id DESC LIMIT 1`).get(String(request.id));
    let authority;
    try { authority = JSON.parse(audit?.authority_snapshot); } catch {}
    if (!authority?.sourceRefs || authority.submissionNo !== request.submission_no || audit.after_revision !== request.revision || authority.proposalDigest !== proposalDigest(request)) fail(409, 'APPROVAL_BASIS_MISSING', '当前申请与原提交版本的完整依据不一致，请核实申请');
    return authority;
  }
  release(ctx, input, request, source, adjustment, now) {
    const releases = input.releases || [];
    if (!Array.isArray(releases) || releases.length > 100 || new Set(releases.map(r => r.kind + ':' + r.id)).size !== releases.length) fail(422, 'RELEASE_LIST', '原用途释放列表无效');
    let total = 0n;
    for (const release of releases) {
      if (!['allocation', 'offset'].includes(release.kind)) fail(422, 'RELEASE_KIND', '请选择原付款分配或原预付抵扣');
      const offset = release.kind === 'offset', table = offset ? 'prepayment_offset' : 'payment_allocation', column = offset ? 'original_offset_id' : 'original_allocation_id';
      const original = row(this.db, table, release.id); revision(original, release.expectedRevision);
      const payment = row(this.db, 'patient_payment', original.patient_payment_id);
      if (original.amount_cents <= 0 || original.bill_id !== source.bill?.id || payment.patient_funds_id !== source.funds.id || (source.payment && source.payment.id !== payment.id)) fail(409, 'RELEASE_SOURCE', '释放须引用本申请允许的原正向用途及原款');
      const amount = this.billing.amount(release.amountCents), children = this.db.prepare(`SELECT amount_cents FROM ${table} WHERE ${column}=?`).all(original.id);
      const remaining = children.reduce((n, r) => n + BigInt(r.amount_cents), BigInt(original.amount_cents));
      if (BigInt(amount) > remaining) fail(409, 'RELEASE_BUDGET', '拟释放额超过原用途尚未释放的部分');
      total += BigInt(amount);
      if (total > (adjustment < 0 ? -BigInt(adjustment) : 0n)) fail(409, 'RELEASE_BUDGET', '用途释放不得超过本次批准的应收减少额');
      insert(this.db, table, fact(now, { patient_payment_id: payment.id, bill_id: original.bill_id, amount_cents: -amount, effective_at: now,
        reason: text(release.reason, '释放依据', 2000), operator_id: ctx.session.staff_id, [column]: original.id, fee_request_id: request.id }));
    }
    ctx.authority.releasedPurposes = releases.map(r => ({ kind: r.kind, id: r.id, amountCents: r.amountCents }));
    return total;
  }
  approve(credentials, input) {
    return this.unit.command(credentials, 'uc25.approve', input, (ctx, now) => {
      const request = row(this.db, 'fee_request', input.requestId); revision(request, input.expectedRevision);
      if (row(this.db, 'patient_funds', request.patient_funds_id).patient_id !== input.patientId) fail(409, 'PAYMENT_PATIENT', '待审申请与当前患者不一致');
      if (request.status !== '待审核') fail(409, 'INVALID_STATE', '只有待审核的当前申请可以审核');
      const review = text(input.reviewNote, '负责人审核意见', 4000);
      if (['return', 'reject'].includes(input.action)) {
        const status = input.action === 'return' ? '已退回' : '已拒绝';
        this.db.prepare('UPDATE fee_request SET status=?,review_note=?,reviewed_at=?,reviewed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(status, review, now, ctx.session.staff_id, now, request.id);
        return { kind: 'fee_request', key: request.id, beforeRevision: request.revision, revision: request.revision + 1, reason: '负责人退回或拒绝，不改变原资金',
          changes: changes(request, { status, review_note: review, reviewed_at: now, reviewed_by: ctx.session.staff_id }, ['status','review_note','reviewed_at','reviewed_by']) };
      }
      if (input.action !== 'approve') fail(422, 'INVALID_ACTION', '审核动作无效');
      const source = this.sources(input, request), basis = this.submittedBasis(request);
      if (canonical(source.refs) !== canonical(basis.sourceRefs)) fail(409, 'FEE_SOURCE_STALE', '原账目或资金已变化，请退回后重新核对并提交');
      const adjustment = signedAmount(input.adjustmentCents), refund = this.billing.amount(input.refundCents, true);
      const proposed = request.proposed_adjustment_cents;
      if ((adjustment !== 0 && (Math.sign(adjustment) !== Math.sign(proposed) || BigInt(Math.abs(adjustment)) > BigInt(Math.abs(proposed)))) || refund > request.proposed_refund_cents || (adjustment === 0 && refund === 0)) fail(422, 'APPROVAL_RANGE', '批准范围须在申请方向和金额之内，不能扩大或空批准');
      const items = input.items || [];
      if (!Array.isArray(items) || items.length > 100 || new Set(items.map(i => i.billItemId)).size !== items.length || (adjustment !== 0 ? !items.length : items.length > 0)) fail(422, 'ADJUSTMENT_ITEMS', '非零调整须逐项明确，零调整不能附带隐藏明细');
      let total = 0n;
      for (const item of items) {
        const line = row(this.db, 'bill_item', item.billItemId); revision(line, item.expectedRevision);
        if (line.bill_id !== source.bill?.id || line.pricing_status !== '已核价') fail(409, 'ADJUSTMENT_SOURCE', '只能调整原账目中已经核价的项目');
        const amount = signedAmount(item.amountCents); if (amount === 0) fail(422, 'INVALID_MONEY', '调整明细不能为零');
        const old = this.db.prepare('SELECT amount_cents FROM fee_adjustment_item WHERE bill_item_id=?').all(line.id);
        const after = old.reduce((n, i) => n + BigInt(i.amount_cents), BigInt(line.quantity) * BigInt(line.unit_price_cents)) + BigInt(amount);
        if (after < 0n) fail(409, 'LINE_NEGATIVE', '调整后单项应收不能为负'); safe(after); total += BigInt(amount);
      }
      if (total !== BigInt(adjustment)) fail(422, 'ADJUSTMENT_SUM', '逐项调整合计须等于本次批准金额');
      if (source.bill && BigInt(this.billing.billSummary(source.bill.id).receivableCents) + total < 0n) fail(409, 'BILL_BUDGET', '调整后总应收不能为负');
      this.db.prepare("UPDATE fee_request SET status='已同意',approved_adjustment_cents=?,approved_refund_cents=?,review_note=?,reviewed_at=?,reviewed_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(adjustment, refund, review, now, ctx.session.staff_id, now, request.id);
      const released = this.release(ctx, input, request, source, adjustment, now);
      if (source.bill && BigInt(this.billing.billSummary(source.bill.id).unpaidCents) + BigInt(adjustment) < 0n) fail(409, 'RELEASE_REQUIRED', '请明确释放原付款用途，使已有用途不超过新应收');
      ctx.authority.releasedCents = safe(released);
      if (adjustment !== 0) {
        const key = insert(this.db, 'fee_adjustment', fact(now, { fee_request_id: request.id, bill_id: source.bill.id,
          reason: review, effective_at: now, approved_by: ctx.session.staff_id }));
        // Positive lines first: SQLite checks row-by-row, while the aggregate check verifies the final sum.
        for (const item of [...items].sort((a, b) => (b.amountCents > 0) - (a.amountCents > 0))) insert(this.db, 'fee_adjustment_item', fact(now, {
          fee_adjustment_id: key, bill_item_id: item.billItemId, amount_cents: item.amountCents, note: text(item.note, '逐项调整依据', 2000) }));
        ctx.authority.adjustmentId = key;
      }
      const available = this.eligiblePayments(source).reduce((n, p) => n + BigInt(p.availableCents), 0n);
      if (BigInt(refund) > available) fail(409, 'REFUND_BUDGET', '批准退款超过当前有来源的可用余额，请核对原用途释放及其他占用');
      if (source.bill && adjustment !== 0) this.db.prepare('UPDATE bill SET updated_at=?,revision=revision+1 WHERE id=?').run(now, source.bill.id);
      this.payments.touchFunds(source.funds, now);
      ctx.authority.sourceRefs = source.refs; ctx.authority.submissionNo = request.submission_no; ctx.authority.clinicalCorrectionIds = basis.clinicalCorrectionIds || [];
      return { kind: 'fee_request', key: request.id, beforeRevision: request.revision, revision: request.revision + 1,
        reason: '批准、调整明细和原用途释放共同生效；批准尚不代表实际退款',
        changes: [{ field: 'status', before: request.status, after: '已同意' }, { field: 'approved_adjustment_cents', before: null, after: adjustment }, { field: 'approved_refund_cents', before: null, after: refund }] };
    });
  }
  remaining(request) {
    const rows = this.db.prepare('SELECT status,requested_cents,actual_cents FROM patient_refund WHERE fee_request_id=?').all(request.id);
    return safe(rows.reduce((n, r) => n - BigInt(r.status === '已确认退款' ? r.actual_cents : ['待办理', '待核实'].includes(r.status) ? r.requested_cents : 0), BigInt(request.approved_refund_cents || 0)));
  }
  uniqueReference(channel, reference, except = -1) {
    if (channel !== '现金' && reference && this.db.prepare('SELECT id FROM patient_refund WHERE channel=? AND external_reference=? AND id<>?').get(channel, reference, except)) fail(409, 'REFUND_DUPLICATE', '该渠道退款交易已登记，请核对原办理号');
  }
  refund(credentials, input) {
    return this.unit.command(credentials, 'uc26.refund', input, (ctx, now) => {
      if (input.action === 'initiate') {
        const request = row(this.db, 'fee_request', input.requestId); revision(request, input.expectedApprovalRevision);
        const source = this.sources({ ...input, billId: request.bill_id, paymentId: input.paymentId });
        if (request.status !== '已同意' || request.patient_funds_id !== source.funds.id || request.approved_refund_cents <= 0) fail(409, 'REFUND_NOT_APPROVED', '未取得当前患者的明确退款授权');
        if (!source.payment || source.payment.status !== '到账已确认' || (request.patient_payment_id && request.patient_payment_id !== source.payment.id)) fail(409, 'REFUND_SOURCE', '退款必须引用授权范围内的已确认原款');
        if (!request.patient_payment_id && request.bill_id && ![...this.billing.fundsSummary(input.patientId).payments.find(p => p.id === source.payment.id).allocations,
          ...this.billing.fundsSummary(input.patientId).payments.find(p => p.id === source.payment.id).offsets].some(u => u.bill_id === request.bill_id && u.amount_cents > 0)) fail(409, 'REFUND_SOURCE', '该原款不是所批准账目的付款来源');
        const inProgress = this.db.prepare("SELECT id FROM patient_refund WHERE patient_payment_id=? AND status IN ('待办理','待核实')").get(source.payment.id);
        if (inProgress) fail(409, 'REFUND_IN_PROGRESS', '原款已有退款在办理，请按原办理号核实，不能重新线下退款', { refundId: inProgress.id });
        const latest = this.db.prepare('SELECT * FROM patient_refund WHERE fee_request_id=? AND patient_payment_id=? ORDER BY id DESC LIMIT 1').get(request.id, source.payment.id);
        const previous = input.previousAttemptId == null ? null : id(input.previousAttemptId);
        if ((latest?.status === '已失败' && previous !== latest.id) || (previous && (latest?.id !== previous || latest.status !== '已失败'))) fail(409, 'REFUND_RETRY_REFERENCE', '失败重办须引用当前最近的失败办理号，不能从旧记录分叉');
        const amount = this.billing.amount(input.amountCents), balance = this.billing.fundsSummary(input.patientId).payments.find(p => p.id === source.payment.id);
        if (amount > balance.availableCents || amount > this.remaining(request)) fail(409, 'REFUND_BUDGET', '退款超过原款可用额或批准剩余额');
        if (!['现金','银行卡','微信','支付宝'].includes(input.channel)) fail(422, 'REFUND_CHANNEL', '退款渠道无效');
        const key = insert(this.db, 'patient_refund', fact(now, { fee_request_id: request.id, patient_payment_id: source.payment.id, patient_funds_id: source.funds.id,
          requested_cents: amount, actual_cents: null, initiated_at: now, channel: input.channel, transaction_evidence: null, verification_note: null, external_reference: null,
          verified_at: null, recipient_verification: text(input.recipientVerification, '接收方核实依据', 2000), operator_id: ctx.session.staff_id,
          verified_by: null, previous_attempt_id: previous, status: '待办理', record_no: recordNo('REFUND') }));
        this.payments.touchFunds(source.funds, now); ctx.authority.approvalId = request.id; ctx.authority.paymentId = source.payment.id;
        return { kind: 'patient_refund', key, revision: 1, reason: '建立唯一办理号及额度占用；实际线下退款尚未确认' };
      }
      if (!['markUnknown', 'verify'].includes(input.action)) fail(422, 'INVALID_ACTION', '退款办理动作无效');
      const refund = row(this.db, 'patient_refund', input.refundId); revision(refund, input.expectedRevision);
      const funds = row(this.db, 'patient_funds', refund.patient_funds_id); revision(funds, input.expectedFundsRevision);
      if (funds.patient_id !== input.patientId) fail(409, 'PAYMENT_PATIENT', '退款与当前患者不一致');
      if (!['待办理','待核实'].includes(refund.status)) fail(409, 'REFUND_FROZEN', '终结的退款结果不能覆盖；重试请使用原提交号或有据建立失败后继');
      let outcome = input.action === 'markUnknown' ? 'unknown' : input.outcome;
      if (!['success','failed','unknown'].includes(outcome)) fail(422, 'REFUND_OUTCOME', '退款核实结果无效');
      const evidence = text(input.transactionEvidence, '渠道结果或待核查依据', 4000), note = text(input.verificationNote, '核实结论', 4000);
      const reference = input.externalReference == null ? refund.external_reference : text(input.externalReference, '退款交易号', 200);
      if (refund.external_reference && reference !== refund.external_reference) fail(409, 'REFUND_REFERENCE_FROZEN', '同一办理号不能改指另一笔实际退款交易');
      this.uniqueReference(refund.channel, reference, refund.id);
      const observed = input.actualCents == null ? null : this.billing.amount(input.actualCents, true);
      const mismatch = (outcome === 'success' && (observed === null || observed <= 0 || observed > refund.requested_cents || input.recipientMatches !== true || (refund.channel !== '现金' && !reference))) || (outcome === 'failed' && observed > 0);
      if (mismatch) outcome = 'unknown';
      const status = outcome === 'success' ? '已确认退款' : outcome === 'failed' ? '已失败' : '待核实';
      this.db.prepare('UPDATE patient_refund SET status=?,actual_cents=?,transaction_evidence=?,verification_note=?,external_reference=?,verified_at=?,verified_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(
        status, outcome === 'success' ? observed : null, [refund.transaction_evidence,evidence].filter(Boolean).join('\n追加核实：'),
        [refund.verification_note,note, mismatch ? '报告金额、接收信息或凭据未通过核对；继续占用待负责人核实' : null].filter(Boolean).join('\n'),
        reference, outcome === 'unknown' ? null : now, outcome === 'unknown' ? null : ctx.session.staff_id, now, refund.id);
      this.payments.touchFunds(funds, now);
      ctx.authority.approvalId = refund.fee_request_id; ctx.authority.paymentId = refund.patient_payment_id; ctx.authority.observedActualCents = observed;
      ctx.authority.recipientMatches = input.recipientMatches ?? null;
      return { kind: 'patient_refund', key: refund.id, beforeRevision: refund.revision, revision: refund.revision + 1,
        code: mismatch ? 'REFUND_REVIEW_REQUIRED' : 'COMMITTED', reason: outcome === 'unknown' ? '结果仍待核实，原额度继续占用' : outcome === 'failed' ? '有据确认失败，释放原占用' : '核实实际退款，一次确认原办理流出' };
    });
  }
  query(credentials, input) {
    const permission = credentials.role === 'manager' ? 'uc25.approve' : 'uc24.apply';
    return this.unit.query(credentials, permission, () => {
      const patient = row(this.db, 'patient', Number(input.patientId)), page = input.page == null ? 1 : id(Number(input.page)), size = input.pageSize == null ? 20 : id(Number(input.pageSize));
      if (size > 100 || page > 1000000) fail(422, 'INVALID_PAGE', '每页最多100项，请使用有效页码');
      if (input.status != null && !['待审核','已退回','已拒绝','已同意','已撤回'].includes(input.status)) fail(422, 'INVALID_STATE', '申请状态筛选无效');
      const funds = this.db.prepare('SELECT * FROM patient_funds WHERE patient_id=?').get(patient.id);
      if (!funds) return { patientId: patient.id, total: 0, page, pageSize: size, items: [], funds: this.billing.fundsSummary(patient.id) };
      const all = this.db.prepare('SELECT * FROM fee_request WHERE patient_funds_id=? AND (? IS NULL OR status=?) ORDER BY submitted_at DESC,id DESC').all(funds.id, input.status ?? null, input.status ?? null);
      const items = all.slice((page - 1) * size, page * size).map(request => {
        const history = this.db.prepare(`SELECT a.id,a.occurred_at,a.staff_id,a.after_revision,a.authority_snapshot,a.reason FROM operation_audit a
          WHERE a.object_kind='fee_request' AND a.object_key=? AND a.event_type='变更' ORDER BY a.id`).all(String(request.id)).map(a => ({ id: a.id, occurredAt: a.occurred_at, staffId: a.staff_id, revision: a.after_revision, reason: a.reason,
          sourceRefs: JSON.parse(a.authority_snapshot).sourceRefs || null, clinicalCorrectionIds: JSON.parse(a.authority_snapshot).clinicalCorrectionIds || [],
          changes: this.db.prepare('SELECT field_name,before_value,after_value FROM audit_change WHERE audit_id=? ORDER BY sequence_no').all(a.id) }));
        const adjustment = this.db.prepare('SELECT * FROM fee_adjustment WHERE fee_request_id=?').get(request.id);
        return { ...request, currentSourceRefs: { fundsRevision: funds.revision,
          billRevision: request.bill_id ? row(this.db, 'bill', request.bill_id).revision : null, paymentRevision: request.patient_payment_id ? row(this.db, 'patient_payment', request.patient_payment_id).revision : null },
          history, adjustment: adjustment ? { ...adjustment, items: this.db.prepare('SELECT * FROM fee_adjustment_item WHERE fee_adjustment_id=? ORDER BY id').all(adjustment.id) } : null,
          remainingApprovedRefundCents: request.status === '已同意' ? this.remaining(request) : 0,
          refunds: this.db.prepare('SELECT * FROM patient_refund WHERE fee_request_id=? ORDER BY id').all(request.id) };
      });
      return { patientId: patient.id, computedAt: this.unit.auth.now(), total: all.length, page, pageSize: size, items, funds: this.billing.fundsSummary(patient.id) };
    });
  }
}
module.exports = { Fees };
