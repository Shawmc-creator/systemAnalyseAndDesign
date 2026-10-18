'use strict';
const crypto = require('node:crypto');
const { BusinessError, fail, hash, canonical, insert, text } = require('./common');
const { clinicalSnapshot, validateClinical } = require('./clinical-gates');
const { treatmentSnapshot, validateTreatment } = require('./treatment-gates');
const RESULT_TABLES = new Set(['patient', 'dated_schedule', 'appointment', 'visit', 'health_review', 'clinical_record', 'record_addendum',
  'treatment_plan', 'plan_version', 'patient_decision', 'treatment_execution', 'service', 'service_price', 'bill_item', 'patient_payment', 'patient_funds']);
const SQL_ERRORS = {
  occupancy_overlap: ['RESOURCE_CONFLICT', '患者、牙医或诊椅在该时段已被占用'],
  schedule_overlap: ['SCHEDULE_CONFLICT', '该牙医或诊椅已有重叠排班'],
  schedule_has_active_occupancy: ['ACTIVE_OCCUPANCY', '请先处理该安排的预约或在诊占用，再调整或停诊'],
  occupancy_schedule: ['SCHEDULE_CHANGED', '排班已变化，请刷新后重新选择'],
  state_transition: ['INVALID_STATE', '当前状态不能进行此操作'],
  reviewed_health_frozen: ['HEALTH_VERSION_SEALED', '已经复核的健康版本不能追加条目，请形成新版本'],
  terminal_frozen: ['RECORD_SIGNED', '已经终结的业务记录不能覆盖'],
  signed_findings_frozen: ['RECORD_SIGNED', '签署后的检查所见不能覆盖或追加'],
  price_overlap: ['PRICE_OVERLAP', '该项目已存在重叠的已确认价目，请核对适用区间'],
  referenced_price_frozen: ['PRICE_FROZEN', '已被计费引用的价目内容不能追改'],
  priced_item_frozen: ['PRICE_FROZEN', '已经核价的应收不能覆盖，请走费用调整申请'],
  plan_scope_frozen: ['PLAN_FROZEN', '方案说明后项目内容已经冻结，请建立新版本'],
  published_plan_content_frozen: ['PLAN_FROZEN', '已说明方案正文不能覆盖，请建立新版本']
};
function mapError(error) {
  if (error instanceof BusinessError) return error;
  if (SQL_ERRORS[error.message]) { const [code, message] = SQL_ERRORS[error.message]; return new BusinessError(409, code, message); }
  if (/UNIQUE constraint failed: patient_payment.channel, patient_payment.external_reference/.test(error.message)) return new BusinessError(409, 'PAYMENT_DUPLICATE', '该渠道交易已经登记，请核实原付款结果，不能重复收款');
  if (/constraint|UNIQUE|FOREIGN KEY|CHECK/.test(error.message)) return new BusinessError(409, 'DATA_CONFLICT', '数据关联或状态已变化，请刷新后核对');
  if (/locked|busy/.test(error.message)) return new BusinessError(409, 'DATABASE_BUSY', '其他工作人员正在办理，请稍后用原提交号重试');
  return error;
}
class UnitOfWork {
  constructor(db, auth) { this.db = db; this.auth = auth; }
  audit(ctx, event, outcome, object, submission = null, reason = '按岗位办理', correlation = crypto.randomUUID()) {
    return insert(this.db, 'operation_audit', { account_id: ctx.session.account_id, staff_id: ctx.session.staff_id,
      session_id: ctx.session.id, submission_id: submission, permission_id: ctx.permission.id,
      actor_kind: '职员', event_type: event, occurred_at: this.auth.now(), object_kind: object.kind,
      object_key: String(object.key), before_revision: object.beforeRevision || null, after_revision: object.revision || null,
      reason, outcome_code: outcome, correlation_id: correlation, authority_snapshot: canonical(ctx.authority) });
  }
  result(submission) {
    if (!RESULT_TABLES.has(submission.result_kind)) throw new Error('Unsupported stored result type');
    // Return the immutable stage receipt, not a newly interpreted success or a newer object's data.
    return { kind: submission.result_kind, id: Number(submission.result_key), revision: submission.result_revision,
      code: submission.result_code, requestKey: submission.request_key, committedAt: submission.committed_at };
  }
  command(credentials, permission, input, handler) {
    const requestKey = text(input.requestKey, '提交号', 128);
    if (input.commandVersion !== 1) fail(422, 'COMMAND_VERSION', '不支持的命令版本，请刷新页面');
    const digest = hash(canonical({ permission, commandVersion: 1, input }));
    const correlation = crypto.randomUUID(); let ctx;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Re-evaluate authorization under the write lock, including replay requests.
      ctx = this.auth.authorize(credentials.token, credentials.role, permission, credentials.csrf ?? '');
      const old = this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id, requestKey);
      if (old) {
        if (old.permission_id !== ctx.permission.id || old.payload_digest !== digest) fail(409, 'REQUEST_KEY_REUSED', '同一提交号的内容已变化，请核实原结果后新建提交');
        this.db.exec('COMMIT'); return { ...this.result(old), replayed: true };
      }
      const clinicalBefore = clinicalSnapshot(this.db);
      const treatmentBefore = treatmentSnapshot(this.db);
      const output = handler(ctx, this.auth.now());
      this.validateReception();
      validateClinical(this.db, clinicalBefore);
      validateTreatment(this.db, treatmentBefore);
      const now = this.auth.now();
      const sid = insert(this.db, 'request_submission', { account_id: ctx.session.account_id, permission_id: ctx.permission.id,
        request_key: requestKey, payload_digest: digest, command_version: 1, status: '已提交', created_at: now, committed_at: now,
        result_kind: output.kind, result_key: String(output.key), result_revision: output.revision, result_code: output.code || 'COMMITTED', correlation_id: correlation });
      const aid = this.audit(ctx, '变更', output.code || 'COMMITTED', output, sid, output.reason || input.reason || '按规约办理', correlation);
      for (const [i, change] of (output.changes || []).entries()) insert(this.db, 'audit_change', {
        audit_id: aid, field_name: change.field, value_type: typeof change.after === 'number' ? 'integer' : 'text',
        before_value: change.before == null ? null : canonical(change.before), after_value: change.after == null ? null : canonical(change.after), sequence_no: i + 1 });
      this.db.exec('COMMIT');
      return { ...this.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)), replayed: false };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      const mapped = mapError(error);
      // A failed business transaction must not leave a successful receipt. Record failure separately.
      if (!ctx) {
        try {
          const session = this.auth.session(credentials.token), p = this.db.prepare('SELECT * FROM access_permission WHERE code=?').get(permission);
          if (p) ctx = { session, permission: p, authority: { deniedRole: credentials.role || null } };
        } catch {}
      }
      if (ctx) {
        try { this.audit(ctx, mapped.status && mapped.status < 500 ? '拒绝' : '失败', mapped.code || 'INTERNAL_ERROR', { kind: 'request_submission', key: requestKey }, null, '办理失败；业务变更已回滚', correlation); }
        catch (auditError) { console.error('v2 failure audit could not be saved:', auditError.message); }
      }
      throw mapped;
    }
  }
  query(credentials, permission, handler) {
    this.db.exec('BEGIN');
    try {
      const ctx = this.auth.authorize(credentials.token, credentials.role, permission);
      const result = handler(ctx);
      this.db.exec('COMMIT');
      this.audit(ctx, '查询', 'QUERY_OK', { kind: 'query', key: permission }, null, '按授权范围查询');
      return result;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw mapError(error); }
  }
  validateReception() {
    const broken = this.db.prepare(`SELECT a.id FROM appointment a LEFT JOIN visit v ON v.appointment_id=a.id
      LEFT JOIN resource_occupancy o ON o.appointment_id=a.id AND o.released_at IS NULL
      WHERE a.status='已预约' OR (a.status='已到诊' AND (v.id IS NULL OR v.status<>'诊疗结束')) GROUP BY a.id HAVING count(o.id)<>1`).get();
    if (broken) fail(409, 'OCCUPANCY_INCOMPLETE', '预约必须有且只有一个有效资源占用');
    const mismatch = this.db.prepare(`SELECT o.id FROM resource_occupancy o JOIN appointment a ON a.id=o.appointment_id
      LEFT JOIN visit v ON v.id=o.visit_id WHERE o.released_at IS NULL AND
      (a.planned_start<>o.starts_at OR a.planned_end<>o.ends_at OR a.status IN ('已取消','未到') OR
      (o.visit_id IS NOT NULL AND (v.patient_id<>a.patient_id OR v.appointment_id<>a.id)))`).get();
    if (mismatch) fail(409, 'OCCUPANCY_MISMATCH', '资源占用与预约或到诊不一致');
    if (this.db.prepare('SELECT v.id FROM visit v LEFT JOIN clinical_record c ON c.visit_id=v.id WHERE c.id IS NULL').get()) fail(409, 'RECORD_MISSING', '到诊必须同时建立病历草稿');
    if (this.db.prepare(`SELECT v.id FROM visit v LEFT JOIN resource_occupancy o ON o.visit_id=v.id AND o.released_at IS NULL
      GROUP BY v.id HAVING (v.status='诊疗结束' AND count(o.id)<>0) OR (v.status<>'诊疗结束' AND count(o.id)<>1)`).get()) fail(409, 'VISIT_OCCUPANCY', '在诊占用与就诊状态不一致');
  }
}
module.exports = { UnitOfWork, mapError };
