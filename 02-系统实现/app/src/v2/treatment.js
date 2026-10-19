'use strict';
const { fail, text, id, instant, insert, fact, row, revision, recordNo } = require('./common');
const { leafQuantity, decisionFor } = require('./treatment-gates');

function toothFields(input) {
  const tooth = input.toothCode == null ? null : text(input.toothCode, '牙位', 8);
  const surface = input.surfaceCode == null ? null : text(input.surfaceCode, '牙面', 8);
  if ((tooth && !/^(?:[1-4][1-8]|[5-8][1-5])$/.test(tooth)) || (surface && (!tooth || !/^[MODBLIP]+$/.test(surface)))) fail(422, 'TOOTH_SURFACE', '请使用有效FDI牙位，牙面须有所属牙位');
  return { tooth_code: tooth, surface_code: surface };
}
class Treatment {
  constructor(db, unit, clinical, billing) { Object.assign(this, { db, unit, clinical, billing }); }
  context(ctx, input, operation = 'plan') {
    const visit = this.clinical.scope(ctx, input.visitId, operation);
    if (visit.patient_id !== input.patientId) fail(409, 'PATIENT_MISMATCH', '患者与获准就诊不一致');
    return visit;
  }
  version(input, visit) {
    const version = row(this.db, 'plan_version', input.versionId), plan = row(this.db, 'treatment_plan', version.treatment_plan_id);
    if (plan.patient_id !== visit.patient_id) fail(409, 'PATIENT_MISMATCH', '方案不属于当前患者');
    if (plan.status !== '进行中') fail(409, 'PLAN_CLOSED', '方案已经结束，不能继续安排执行');
    revision(version, input.expectedRevision);
    return { version, plan };
  }
  saveItems(versionId, items, now) {
    if (!Array.isArray(items) || items.length > 100) fail(422, 'PLAN_ITEMS', '方案明细须为不超过100项的列表');
    const old = this.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(versionId);
    const ids = items.filter(i => i.id != null).map(i => id(i.id));
    if (new Set(ids).size !== ids.length || old.some(i => !ids.includes(i.id)) || ids.some(i => !old.some(o => o.id === i))) fail(422, 'PLAN_ITEM_SET', '已有草稿项目须逐项修订并保留原顺序，可在末尾追加；删减请重新形成版本');
    items.forEach((i, index) => {
      const fields = { item_description: text(i.description, '计划项目说明', 2000), ...toothFields(i), planned_quantity: id(i.quantity, '计划数量'),
        estimated_cents: i.estimatedCents == null ? null : this.billing.amount(i.estimatedCents, true) };
      if (i.id != null) {
        const item = old.find(o => o.id === i.id);
        if (item.sequence_no !== index + 1) fail(422, 'PLAN_ITEM_ORDER', '已有项目保持原顺序');
        this.db.prepare(`UPDATE plan_item SET item_description=?,tooth_code=?,surface_code=?,planned_quantity=?,estimated_cents=?,updated_at=?,revision=revision+1 WHERE id=?`).run(...Object.values(fields), now, i.id);
      } else insert(this.db, 'plan_item', fact(now, { plan_version_id: versionId, ...fields, sequence_no: index + 1 }));
    });
  }
  plan(credentials, input) {
    return this.unit.command(credentials, 'uc22.plan', input, (ctx, now) => {
      const visit = this.context(ctx, input);
      if (input.action === 'draft' || input.action === 'revise') {
        let planId, previous = null, items = input.items;
        if (input.action === 'draft') {
          planId = insert(this.db, 'treatment_plan', fact(now, { patient_id: visit.patient_id, goal: text(input.goal, '治疗目标', 2000), established_at: now,
            termination_reason: null, closed_at: null, created_by: ctx.session.staff_id, closed_by: null, status: '进行中', record_no: recordNo('PLAN') }));
        } else {
          const source = this.version(input, visit); previous = source.version; planId = source.plan.id;
          revision(source.plan, input.expectedPlanRevision);
          const latest = this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(planId);
          if (latest.id !== previous.id || previous.status === '草稿') fail(409, 'PLAN_VERSION_CONFLICT', '请基于最新的已说明版本改版，已有草稿请先处理');
          const reason = text(input.reason, '改版原因', 2000);
          // Stop the old executable scope before copying its remainder; it cannot race with new consent.
          if (previous.status === '已确认') this.db.prepare("UPDATE plan_version SET status='停止后续执行',stopped_at=?,stop_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(now, reason, now, previous.id);
          const remainingItems = this.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(previous.id).flatMap(i => {
            const remaining = BigInt(i.planned_quantity) - leafQuantity(this.db, i.id);
            return remaining > 0n ? [{ description: i.item_description, toothCode: i.tooth_code, surfaceCode: i.surface_code, quantity: Number(remaining), estimatedCents: null }] : [];
          });
          // An explicitly revised scope gets new item IDs and new consent, never the old item's authorization.
          items = input.items === undefined ? remainingItems : input.items;
          this.db.prepare('UPDATE treatment_plan SET updated_at=?,revision=revision+1 WHERE id=?').run(now, planId);
        }
        const key = insert(this.db, 'plan_version', fact(now, { treatment_plan_id: planId, source_visit_id: visit.id,
          diagnostic_basis: text(input.diagnosticBasis, '诊断来源', 4000), explained_at: null, change_reason: text(input.reason, '版本形成原因', 2000),
          planned_schedule: text(input.plannedSchedule, '预计分次安排', 2000), version_no: previous ? previous.version_no + 1 : 1,
          stopped_at: null, stop_reason: null, created_by: ctx.session.staff_id, explained_by: null, previous_version_id: previous?.id || null, status: '草稿' }));
        this.saveItems(key, items || [], now);
        return { kind: 'plan_version', key, revision: 1, reason: '形成方案草稿；计划不形成实际执行或应收' };
      }
      const { version, plan } = this.version(input, visit);
      const latest = this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(plan.id);
      if (latest.id !== version.id && !['stop', 'close'].includes(input.action)) fail(409, 'PLAN_SUPERSEDED', '该版本已被后续版本替代，旧内容和决定保留查询，后续办理请选择最新版本');
      ctx.authority.planVersionId = version.id;
      if (input.action === 'save') {
        if (version.status !== '草稿') fail(409, 'PLAN_FROZEN', '已说明的方案内容不能覆盖，实质变更请改版');
        this.saveItems(version.id, input.items, now);
        this.db.prepare('UPDATE plan_version SET diagnostic_basis=?,planned_schedule=?,change_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(
          text(input.diagnosticBasis, '诊断来源', 4000), text(input.plannedSchedule, '预计分次安排', 2000), text(input.reason, '变更原因', 2000), now, version.id);
      } else if (input.action === 'publish' || input.action === 'resubmit') {
        if (version.status !== (input.action === 'publish' ? '草稿' : '暂缓')) fail(409, 'INVALID_STATE', '当前方案不能进行此说明动作');
        if (!this.db.prepare('SELECT id FROM plan_item WHERE plan_version_id=?').get(version.id)) fail(409, 'PLAN_EMPTY', '空方案不能提交说明');
        this.db.prepare("UPDATE plan_version SET status='待确认',explained_at=?,explained_by=?,updated_at=?,revision=revision+1 WHERE id=?").run(now, ctx.session.staff_id, now, version.id);
      } else if (input.action === 'decide') {
        return this.decide(ctx, input, version, plan, now);
      } else if (input.action === 'stop' || input.action === 'completeVersion') {
        if (version.status !== '已确认') fail(409, 'INVALID_STATE', '只有已确认版本可以停止后续或核对本版完成');
        if (input.action === 'completeVersion') {
          if (this.db.prepare('SELECT id,planned_quantity FROM plan_item WHERE plan_version_id=?').all(version.id).some(i => leafQuantity(this.db, i.id) !== BigInt(i.planned_quantity))) fail(409, 'PLAN_INCOMPLETE', '本版仍有未完成项目');
          this.db.prepare("UPDATE plan_version SET status='本版执行完成',updated_at=?,revision=revision+1 WHERE id=?").run(now, version.id);
        } else this.db.prepare("UPDATE plan_version SET status='停止后续执行',stopped_at=?,stop_reason=?,updated_at=?,revision=revision+1 WHERE id=?").run(now, text(input.reason, '停止依据', 2000), now, version.id);
      } else if (input.action === 'close') {
        revision(plan, input.expectedPlanRevision);
        if (!['complete', 'terminate'].includes(input.outcome)) fail(422, 'INVALID_ACTION', '请选择完成或终止方案');
        const reason = text(input.reason, '方案结束依据', 2000);
        if (input.outcome === 'complete') {
          const versions = this.db.prepare('SELECT * FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no').all(plan.id);
          if (versions.at(-1).status !== '本版执行完成' || versions.some(v => v.status === '已确认')) fail(409, 'PLAN_INCOMPLETE', '最新范围尚未完成或仍有可执行版本，不能声明整个方案已完成');
        } else {
          this.db.prepare("UPDATE plan_version SET status='停止后续执行',stopped_at=?,stop_reason=?,updated_at=?,revision=revision+1 WHERE treatment_plan_id=? AND status='已确认'").run(now, reason, now, plan.id);
        }
        this.db.prepare('UPDATE treatment_plan SET status=?,termination_reason=?,closed_at=?,closed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(
          input.outcome === 'complete' ? '已完成' : '已终止', reason, now, ctx.session.staff_id, now, plan.id);
        return { kind: 'treatment_plan', key: plan.id, beforeRevision: plan.revision, revision: plan.revision + 1, reason: '牙医确认方案结束依据' };
      } else fail(422, 'INVALID_ACTION', '方案办理动作无效');
      return { kind: 'plan_version', key: version.id, beforeRevision: version.revision, revision: version.revision + 1, reason: '按方案生命周期办理' };
    });
  }
  decide(ctx, input, version, plan, now) {
    if (!['待确认', '已确认'].includes(version.status)) fail(409, 'INVALID_STATE', '当前方案不接受新增患者决定，请先重新说明或改版');
    if (!['同意', '暂缓', '拒绝', '撤回'].includes(input.decision)) fail(422, 'INVALID_DECISION', '患者决定无效');
    const all = this.db.prepare('SELECT id FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(version.id).map(i => i.id);
    const selected = input.wholeScope === true ? all : input.itemIds;
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(i => !all.includes(i))) fail(422, 'DECISION_SCOPE', '请明确选择当前版本的具体项目，不能跨版本或重复');
    const decidedAt = instant(input.decidedAt, '患者实际决定时间');
    if (decidedAt > now || decidedAt < version.explained_at) fail(422, 'DECISION_TIME', '实际决定不能在未来或早于该版说明');
    const proxyId = input.proxyId == null ? null : id(input.proxyId);
    if (proxyId) {
      const proxy = row(this.db, 'patient_proxy', proxyId); let scope;
      try { scope = JSON.parse(proxy.scope); } catch {}
      if (proxy.patient_id !== plan.patient_id || proxy.valid_from > decidedAt || (proxy.valid_until && proxy.valid_until <= decidedAt) ||
          !scope?.planVersionIds?.includes(version.id) || !scope?.operations?.includes('decide')) fail(409, 'PROXY_SCOPE', '代理关系须在决定时有效，并明确覆盖该版本的决定事项');
    }
    const files = input.documentVersionIds || [];
    if (!Array.isArray(files) || files.length > 50 || new Set(files).size !== files.length) fail(422, 'DECISION_FILES', '原件版本列表无效');
    for (const fileId of files) {
      const file = row(this.db, 'document_version', fileId), doc = row(this.db, 'clinical_document', file.clinical_document_id);
      if (doc.patient_id !== plan.patient_id || (doc.plan_version_id && doc.plan_version_id !== version.id) || file.status !== '原件已确认' || !file.confirmed_at || file.confirmed_at > now) fail(409, 'DOCUMENT_UNCONFIRMED', '原件必须已确认，且属于当前患者和相应方案版本');
    }
    const key = insert(this.db, 'patient_decision', fact(now, { plan_version_id: version.id, patient_proxy_id: proxyId,
      decision: input.decision, decided_at: decidedAt, explanation_basis: text(input.explanationBasis, '实际告知及决定依据', 4000),
      scope_note: text(input.scopeNote, '决定范围说明', 2000), explained_by: ctx.session.staff_id, recorded_by: ctx.session.staff_id }));
    for (const itemId of selected) insert(this.db, 'decision_plan_item', { decision_id: key, plan_item_id: itemId, linked_at: now, linked_by: ctx.session.staff_id });
    for (const fileId of files) insert(this.db, 'decision_file_version', { decision_id: key, document_version_id: fileId, linked_at: now, linked_by: ctx.session.staff_id });
    let status = version.status;
    const current = all.map(itemId => decisionFor(this.db, itemId, now)?.decision);
    if (version.status === '待确认' && current.includes('同意')) status = '已确认';
    else if (version.status === '待确认' && current.every(d => d === '暂缓')) status = '暂缓';
    else if (version.status === '待确认' && current.every(d => d === '拒绝')) status = '已拒绝';
    else if (version.status === '已确认' && current.every(d => d === '撤回')) status = '停止后续执行';
    this.db.prepare('UPDATE plan_version SET status=?,stopped_at=?,stop_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,
      status === '停止后续执行' ? now : null, status === '停止后续执行' ? '患者撤回本版全部范围的同意' : null, now, version.id);
    ctx.authority.decisionItemIds = selected; ctx.authority.documentVersionIds = files;
    return { kind: 'patient_decision', key, revision: 1, reason: '如实登记患者的明确项目决定；不复制正文到审计' };
  }
  execute(credentials, input) {
    return this.unit.command(credentials, 'uc04.execute', input, (ctx, now) => {
      const visit = this.context(ctx, input, 'execute');
      revision(visit, input.expectedVisitRevision);
      const correcting = input.originalExecutionId != null;
      if (!correcting && visit.status !== '接诊中') fail(409, 'VISIT_NOT_ACTIVE', '实际执行须在接诊中确认；结束后的事实请走有依据的更正');
      const completed = instant(input.completedAt, '实际执行时间');
      const physicalEnd=this.db.prepare("SELECT released_at FROM resource_occupancy WHERE visit_id=? AND release_reason='实际操作结束，转清洁核验' ORDER BY id DESC LIMIT 1").get(visit.id)?.released_at;
      if(physicalEnd && completed>physicalEnd)fail(422,'EXECUTION_AFTER_PHYSICAL_END','实际项目时间晚于本次已确认的操作结束，不能在已交接诊椅后继续记为当次操作');
      if (!visit.started_at || completed < visit.started_at || completed > now || (visit.ended_at && completed > visit.ended_at)) fail(422, 'EXECUTION_TIME', '执行时间须真实发生且在该次实际接诊期间');
      const service = row(this.db, 'service', input.serviceId), quantity = id(input.quantity, '实际完成数量'), teeth = toothFields(input);
      if (!service.is_active && !correcting) fail(409, 'SERVICE_DISABLED', '该收费项目已停用，不能用于新执行');
      const itemId = input.planItemId == null ? null : id(input.planItemId);
      let original = null;
      if (correcting) {
        original = row(this.db, 'treatment_execution', input.originalExecutionId);
        if (original.visit_id !== visit.id || original.plan_item_id !== itemId) fail(409, 'CORRECTION_SCOPE', '更正须属于同一就诊并保留原方案项目，变更方案范围请先核对新版本');
        if (this.db.prepare('SELECT id FROM treatment_execution WHERE original_execution_id=?').get(original.id)) fail(409, 'CORRECTION_NOT_LEAF', '原记录已被更正，请基于当前链末记录办理');
      }
      if (itemId) {
        const item = row(this.db, 'plan_item', itemId), version = row(this.db, 'plan_version', item.plan_version_id), plan = row(this.db, 'treatment_plan', version.treatment_plan_id);
        if (plan.patient_id !== visit.patient_id) fail(409, 'PATIENT_MISMATCH', '方案项目与当前患者不一致');
        if (item.tooth_code !== teeth.tooth_code || item.surface_code !== teeth.surface_code) fail(409, 'EXECUTION_SCOPE', '实际牙位牙面须符合所选方案项目，范围变动先改版');
        if (!correcting) {
          const latest = this.db.prepare('SELECT id FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no DESC LIMIT 1').get(plan.id);
          if (version.status !== '已确认' || plan.status !== '进行中' || latest.id !== version.id) fail(409, 'PLAN_NOT_EXECUTABLE', '方案未确认、被后续版本替代、停止或结束，不能新增正常执行');
          const decision = decisionFor(this.db, item.id, completed), current = decisionFor(this.db, item.id, now);
          if (!decision || decision.decision !== '同意' || decision.created_at > completed || current?.id !== decision.id) fail(409, 'CONSENT_REQUIRED', '缺少执行发生前已登记且当前仍适用的明确同意；不能倒填同意授权过去执行');
          ctx.authority.decisionId = decision.id; ctx.authority.decisionScope = { decisionId: decision.id, itemId: item.id };
        }
        const total = leafQuantity(this.db, item.id) - BigInt(original?.completed_quantity || 0) + BigInt(quantity);
        if (total > BigInt(item.planned_quantity)) fail(409, 'PLAN_QUANTITY_EXCEEDED', '本次提交后有效执行量超过计划量');
        ctx.authority.planVersionId = version.id; ctx.authority.planItemId = item.id;
      } else if (!correcting && input.independentCheck !== true) fail(422, 'INDEPENDENT_BASIS_REQUIRED', '不关联方案时须明确为独立检查咨询，并记录真实依据');
      const note = text(input.procedureNote, '实际操作经过', 8000);
      const basis = !itemId && !correcting ? text(input.independentBasis, '独立检查咨询依据', 2000) : null;
      const key = insert(this.db, 'treatment_execution', fact(now, { visit_id: visit.id, plan_item_id: itemId, service_id: service.id,
        original_execution_id: original?.id || null, ...teeth, completed_quantity: quantity, procedure_note: basis ? note + '\n独立检查咨询依据：' + basis : note,
        completed_at: completed, correction_reason: correcting ? text(input.reason, '更正依据', 2000) : null,
        execution_kind: correcting ? '更正记录' : '首次记录', performed_by: ctx.session.staff_id, record_no: recordNo('EXEC') }));
      if (!correcting) this.billing.fromExecution(row(this.db, 'treatment_execution', key), visit, ctx, now);
      ctx.authority.originalExecutionId = original?.id || null;
      return { kind: 'treatment_execution', key, revision: 1, code: correcting ? 'EXECUTION_CORRECTED_FEE_REVIEW' : 'COMMITTED',
        reason: correcting ? '追加临床更正；既有应收保留，费用变化另走费用申请' : '确认真实执行并共同形成计费依据' };
    });
  }
  detail(credentials, input) {
    return this.unit.query(credentials, 'uc09.query', ctx => {
      const visit = this.context(ctx, { visitId: Number(input.visitId), patientId: Number(input.patientId) }, 'read');
      return { plans: this.db.prepare('SELECT * FROM treatment_plan WHERE patient_id=? ORDER BY id').all(visit.patient_id).map(plan => ({ ...plan,
        versions: this.db.prepare('SELECT * FROM plan_version WHERE treatment_plan_id=? ORDER BY version_no').all(plan.id).map(version => ({ ...version,
          items: this.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(version.id).map(item => ({ ...item, effectiveQuantity: Number(leafQuantity(this.db, item.id)), latestDecision: decisionFor(this.db, item.id, this.unit.auth.now()) || null })),
          decisions: this.db.prepare('SELECT * FROM patient_decision WHERE plan_version_id=? ORDER BY decided_at,id').all(version.id).map(d => ({ ...d,
            itemIds: this.db.prepare('SELECT plan_item_id FROM decision_plan_item WHERE decision_id=? ORDER BY plan_item_id').all(d.id).map(i => i.plan_item_id),
            documentVersionIds: this.db.prepare('SELECT document_version_id FROM decision_file_version WHERE decision_id=? ORDER BY document_version_id').all(d.id).map(f => f.document_version_id) })) })) })),
        executions: this.db.prepare(`SELECT e.*,s.name service_name,b.id bill_item_id,b.bill_id,b.pricing_status,
          NOT EXISTS(SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=e.id) is_effective
          FROM treatment_execution e JOIN service s ON s.id=e.service_id LEFT JOIN bill_item b ON b.treatment_execution_id=e.id WHERE e.visit_id=? ORDER BY e.id`).all(visit.id) };
    });
  }
}
module.exports = { Treatment };
