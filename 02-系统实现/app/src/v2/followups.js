'use strict';
const { fail, text, id, instant, dateOnly, day, row, revision, insert, fact, recordNo } = require('./common');
const { staffRoles, requireFrontdesk, sourceState } = require('./followup-rules');
const OPEN = ['待联系','待到诊或评估'];
const FIELDS = ['purpose','followup_type','target_start','target_end','requires_assessment','responsible_frontdesk_id','next_contact_date','status'];
const changed = (before, after, fields = FIELDS) => fields.filter(k => before[k] !== after[k]).map(k => ({ field: k, before: before[k], after: after[k] }));
class Followups {
  constructor(db, unit, clinical) { Object.assign(this, { db, unit, clinical }); }
  handover(ctx, patientId, refs, operation) {
    const now = this.unit.auth.now();
    return this.db.prepare(`SELECT * FROM clinical_handover WHERE patient_id=? AND receiving_dentist_id=?
      AND valid_from<=? AND (valid_until IS NULL OR valid_until>?)`).all(patientId, ctx.session.staff_id, now, now).find(h => {
      try {
        const s = JSON.parse(h.scope);
        const match = (refs.followupId && s.followupIds?.includes(refs.followupId)) || (refs.visitId && s.visitIds?.includes(refs.visitId)) || (refs.versionId && s.planVersionIds?.includes(refs.versionId));
        if (match && s.operations?.includes(operation)) { ctx.authority.handoverId = h.id; return true; }
      } catch {}
      return false;
    });
  }
  ownsVisit(ctx, visitId) { return !!visitId && row(this.db, 'visit', visitId).dentist_id === ctx.session.staff_id; }
  ownsVersion(ctx, versionId) {
    if (!versionId) return false;
    const v = row(this.db, 'plan_version', versionId);
    return v.created_by === ctx.session.staff_id || v.explained_by === ctx.session.staff_id;
  }
  scope(ctx, f, operation = 'followup') {
    const assigned = this.db.prepare('SELECT responsible_staff_id FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at DESC,id DESC LIMIT 1').get(f.id);
    if (f.created_by !== ctx.session.staff_id && assigned?.responsible_staff_id !== ctx.session.staff_id && !this.ownsVisit(ctx, f.source_visit_id) && !this.ownsVersion(ctx, f.source_plan_version_id) &&
      !this.handover(ctx, f.patient_id, { followupId: f.id, visitId: f.source_visit_id, versionId: f.source_plan_version_id }, operation)) fail(403, 'FOLLOWUP_SCOPE', '当前牙医不在该诊后要求的责任或明确交接范围内');
    ctx.authority.followupId = f.id; ctx.authority.patientId = f.patient_id;
  }
  source(ctx, input) {
    const patientId = id(input.patientId), visitId = input.sourceVisitId == null ? null : id(input.sourceVisitId), versionId = input.sourcePlanVersionId == null ? null : id(input.sourcePlanVersionId);
    row(this.db, 'patient', patientId);
    if (!visitId && !versionId) fail(422, 'FOLLOWUP_SOURCE', '至少选择一次来源就诊或一个明确方案版本');
    if (visitId) {
      const visit = row(this.db, 'visit', visitId);
      if (visit.patient_id !== patientId) fail(409, 'PATIENT_MISMATCH', '来源就诊与患者不一致');
      if (!this.ownsVisit(ctx, visitId) && !this.handover(ctx, patientId, { visitId }, 'followup')) fail(403, 'FOLLOWUP_SCOPE', '未获得来源就诊的诊后要求权限');
    }
    if (versionId) {
      const v = row(this.db, 'plan_version', versionId), p = row(this.db, 'treatment_plan', v.treatment_plan_id);
      if (p.patient_id !== patientId) fail(409, 'PATIENT_MISMATCH', '来源方案与患者不一致');
      if (!this.ownsVersion(ctx, versionId) && !this.handover(ctx, patientId, { versionId }, 'followup')) fail(403, 'FOLLOWUP_SCOPE', '未获得该方案版本的诊后要求权限');
    }
    return { patient_id: patientId, source_visit_id: visitId, source_plan_version_id: versionId };
  }
  patient(f, input) { if (f.patient_id !== input.patientId) fail(409, 'PATIENT_MISMATCH', '诊后要求与当前患者不一致'); }
  mutable(f) { if (['已完成','已撤销'].includes(f.status)) fail(409, 'FOLLOWUP_CLOSED', '原要求已关闭，新问题请另建有来源的新要求'); }
  nextDate(value, now) {
    const date = dateOnly(value, '下次联系日期');
    if (date < day(now)) fail(422, 'FOLLOWUP_NEXT_DATE', '下一次实际跟进安排不得早于今天');
    return date;
  }
  fields(input, now) {
    if (!['复诊','随访'].includes(input.type) || typeof input.requiresAssessment !== 'boolean') fail(422, 'FOLLOWUP_FIELDS', '请明确复诊或随访，以及是否需要临床评估');
    const start = dateOnly(input.targetStart), end = dateOnly(input.targetEnd);
    if (end < start) fail(422, 'FOLLOWUP_WINDOW', '目标截止日期不能早于开始日期');
    const responsible = requireFrontdesk(this.db, this.unit.auth, input.responsibleFrontdeskId);
    return { purpose: text(input.purpose, '诊后目的', 2000), followup_type: input.type, target_start: start, target_end: end,
      requires_assessment: input.requiresAssessment ? 1 : 0, responsible_frontdesk_id: responsible,
      next_contact_date: this.nextDate(input.nextContactDate || (start < day(now) ? day(now) : start), now) };
  }
  duplicate(source, fields, except = -1) {
    const duplicate = this.db.prepare(`SELECT id FROM followup_requirement WHERE patient_id=? AND source_visit_id IS ? AND source_plan_version_id IS ?
      AND followup_type=? AND purpose=? AND status IN ('待发布','待联系','待到诊或评估') AND target_start<=? AND target_end>=? AND id<>?`).get(
      source.patient_id, source.source_visit_id, source.source_plan_version_id, fields.followup_type, fields.purpose, fields.target_end, fields.target_start, except);
    if (duplicate) fail(409, 'FOLLOWUP_DUPLICATE', '相同来源及目的已有重叠日期的未完成要求，请核对原事项', { followupId: duplicate.id });
  }
  propose(credentials, input) {
    return this.unit.command(credentials, 'uc12.propose', input, (ctx, now) => {
      if (input.action === 'create') {
        const source = this.source(ctx, input), fields = this.fields(input, now); this.duplicate(source, fields);
        const ready = sourceState(this.db, source).ready;
        const key = insert(this.db, 'followup_requirement', fact(now, { ...source, ...fields, cancellation_reason: null, closed_at: null, closure_basis: null,
          created_by: ctx.session.staff_id, closed_by: null, published_by:ready?ctx.session.staff_id:null,published_at:ready?now:null,status: ready ? '待联系' : '待发布', record_no: recordNo('FOLLOW') }));
        if(ready)this.unit.workflowHistory.append('followup_requirement',key,'发布','来源已确认，发布诊后要求',ctx,input,now);
        ctx.authority.followupId = key; ctx.authority.sourceVisitId = source.source_visit_id; ctx.authority.sourcePlanVersionId = source.source_plan_version_id;
        return { kind: 'followup_requirement', key, revision: 1, reason: '提出有来源和责任的诊后要求，不占用预约资源或修改费用' };
      }
      const f = row(this.db, 'followup_requirement', input.followupId); this.patient(f, input); this.scope(ctx, f); this.mutable(f); revision(f, input.expectedRevision);
      if (input.action === 'publish') {
        if (f.status !== '待发布' || !sourceState(this.db, f).ready) fail(409, 'FOLLOWUP_SOURCE_NOT_READY', '须等所选来源签署或确认后再发布');
        requireFrontdesk(this.db, this.unit.auth, f.responsible_frontdesk_id);
        const next = f.next_contact_date && f.next_contact_date >= day(now) ? f.next_contact_date : day(now);
        this.db.prepare("UPDATE followup_requirement SET status='待联系',next_contact_date=?,updated_at=?,revision=revision+1 WHERE id=?").run(next, now, f.id);
        this.db.prepare('UPDATE followup_requirement SET published_by=?,published_at=? WHERE id=?').run(ctx.session.staff_id,now,f.id);
        this.unit.workflowHistory.append('followup_requirement',f.id,'发布','核对来源与责任后发布',ctx,input,now);
        return { kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1, reason: '核对来源与责任后发布', changes: changed(f, { ...f, status: '待联系', next_contact_date: next }) };
      }
      if (input.action === 'cancel') {
        if (!OPEN.includes(f.status)) fail(409, 'INVALID_STATE', '当前状态机只允许撤销已发布要求；待发布要求请先核对来源');
        const reason = text(input.reason, '牙医撤销依据', 2000);
        this.db.prepare("UPDATE followup_requirement SET status='已撤销',cancellation_reason=?,closed_at=?,closure_basis=?,closed_by=?,next_contact_date=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(reason, now, reason, ctx.session.staff_id, now, f.id);
        this.unit.workflowHistory.append('followup_requirement',f.id,'撤销',reason,ctx,input,now);
        return { kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1, reason: '牙医有据撤销要求；预约另经预约业务办理', changes: changed(f, { ...f, status: '已撤销', next_contact_date: null }) };
      }
      if (input.action !== 'update') fail(422, 'INVALID_ACTION', '诊后要求操作无效');
      if ((Object.hasOwn(input,'sourceVisitId') && input.sourceVisitId !== f.source_visit_id) || (Object.hasOwn(input,'sourcePlanVersionId') && input.sourcePlanVersionId !== f.source_plan_version_id)) fail(409, 'FOLLOWUP_SOURCE_FIXED', '原来源不能改指其他就诊或版本，请新建要求');
      const fields = this.fields(input, now); this.duplicate(f, fields, f.id);
      const last = this.db.prepare('SELECT appointment_id FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at DESC,id DESC LIMIT 1').get(f.id);
      if (last?.appointment_id) {
        const appointment = row(this.db, 'appointment', last.appointment_id);
        if (['已预约','已到诊'].includes(appointment.status) && (day(appointment.planned_start) < fields.target_start || day(appointment.planned_start) > fields.target_end)) fail(409, 'FOLLOWUP_APPOINTMENT_WINDOW', '关联的有效预约不在新目标窗口内，请先核对或改约');
      }
      this.db.prepare('UPDATE followup_requirement SET purpose=?,followup_type=?,target_start=?,target_end=?,requires_assessment=?,responsible_frontdesk_id=?,next_contact_date=?,updated_at=?,revision=revision+1 WHERE id=?').run(...Object.values(fields), now, f.id);
      if(f.status!=='待发布')this.unit.workflowHistory.append('followup_requirement',f.id,'调整',text(input.reason,'变更依据',2000),ctx,input,now);
      return { kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1, reason: text(input.reason, '变更依据', 2000), changes: changed(f, { ...f, ...fields }) };
    });
  }
  contact(credentials, input) {
    return this.unit.command(credentials, 'uc13.contact', input, (ctx, now) => {
      const f = row(this.db, 'followup_requirement', input.followupId); this.patient(f, input); this.mutable(f); revision(f, input.expectedRevision);
      if (f.responsible_frontdesk_id !== ctx.session.staff_id) fail(403, 'FOLLOWUP_FRONTDESK_SCOPE', '只能办理本人负责的诊后联系，转交须由原责任人或有权牙医办理');
      if (!OPEN.includes(f.status)) fail(409, 'FOLLOWUP_UNPUBLISHED', '待发布要求不进入前台联系办理');
      if (input.action === 'transfer') {
        const owner = requireFrontdesk(this.db, this.unit.auth, input.responsibleFrontdeskId);
        if (owner === f.responsible_frontdesk_id) fail(422, 'FOLLOWUP_OWNER', '转交对象与原责任人相同');
        this.db.prepare('UPDATE followup_requirement SET responsible_frontdesk_id=?,updated_at=?,revision=revision+1 WHERE id=?').run(owner, now, f.id);
        this.unit.workflowHistory.append('followup_requirement',f.id,'转交',text(input.reason,'责任转交依据',2000),ctx,input,now);
        return { kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1, reason: text(input.reason, '责任转交依据', 2000), changes: changed(f, { ...f, responsible_frontdesk_id: owner }) };
      }
      if (input.action !== 'record' || !['已联系','未联系上','拒绝','待跟进'].includes(input.result) || !['continue','arrange','assess','complete'].includes(input.nextStep)) fail(422, 'FOLLOWUP_CONTACT', '请明确真实联系结果与后续办理动作');
      const contacted = instant(input.contactedAt, '实际联系时间'), latest = this.db.prepare('SELECT * FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at DESC,id DESC LIMIT 1').get(f.id);
      if (contacted > now || contacted < f.created_at || (latest && contacted < latest.contacted_at)) fail(422, 'FOLLOWUP_CONTACT_TIME', '本批按实际先后追加联系；时间须已发生且不早于要求或最近联系');
      let appointment = null;
      if (input.appointmentId != null) appointment = row(this.db, 'appointment', input.appointmentId);
      else if (latest?.appointment_id) {
        const prior = row(this.db, 'appointment', latest.appointment_id);
        if (['已预约','已到诊'].includes(prior.status)) appointment = prior;
      }
      if (appointment) {
        if (appointment.patient_id !== f.patient_id) fail(409, 'PATIENT_MISMATCH', '复诊预约与患者不一致');
        if (!['已预约','已到诊'].includes(appointment.status) || (appointment.status === '已预约' && appointment.planned_end <= now)) fail(409, 'FOLLOWUP_APPOINTMENT', '只能关联仍有效的预约或其实际到诊');
        if (input.appointmentId != null) revision(appointment, input.expectedAppointmentRevision);
        const sourceVisit = f.source_visit_id ? row(this.db, 'visit', f.source_visit_id) : null;
        if (appointment.id === sourceVisit?.appointment_id || appointment.planned_start < f.created_at || day(appointment.planned_start) < f.target_start || day(appointment.planned_start) > f.target_end) fail(409, 'FOLLOWUP_APPOINTMENT_WINDOW', '请选择要求形成后、目标日期内的真实复诊预约，不能用原就诊充当复诊');
      }
      if (input.result !== '已联系' && input.nextStep !== 'continue') fail(422, 'FOLLOWUP_CONTACT_RESULT', '未联系上、拒绝或待跟进不能当作安排成功、评估或完成');
      let status, next = null, needs = f.requires_assessment, closure = null;
      if (input.nextStep === 'complete') {
        if (f.status !== '待联系' || f.requires_assessment || appointment || input.goalAchieved !== true) fail(409, 'FOLLOWUP_ASSESSMENT_REQUIRED', '只有无需临床评估、无有效预约且明确达成联系目标的待联系事项可由前台完成');
        status = '已完成'; closure = text(input.completionBasis, '联系目标完成依据', 2000);
      } else if (input.nextStep === 'arrange') {
        if (!appointment) fail(422, 'FOLLOWUP_APPOINTMENT', '请先通过预约业务建立复诊预约，再关联本次联系');
        status = '待到诊或评估';
      } else if (input.nextStep === 'assess') { status = '待到诊或评估'; needs = 1; }
      else { status = appointment ? '待到诊或评估' : '待联系'; next = this.nextDate(input.nextContactDate, now); }
      const key = insert(this.db, 'contact_history', fact(now, { followup_requirement_id: f.id, appointment_id: appointment?.id ?? null,
        method: text(input.method, '实际联系方式', 100), contacted_at: contacted, result: input.result, next_contact_date: next,
        note: text(input.note, '真实联系内容及结果', 4000), operator_id: ctx.session.staff_id }));
      this.db.prepare('UPDATE followup_requirement SET status=?,requires_assessment=?,next_contact_date=?,closed_at=?,closure_basis=?,closed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(
        status, needs, next, closure ? now : null, closure, closure ? ctx.session.staff_id : null, now, f.id);
      ctx.authority.followupId = f.id; ctx.authority.followupBeforeRevision = f.revision; ctx.authority.followupAfterRevision = f.revision + 1;
      this.unit.workflowHistory.append('followup_requirement',f.id,status==='已完成'?'完成':'联系更新',closure||'追加实际联系及后续安排',ctx,input,now);
      return { kind: 'contact_history', key, revision: 1, reason: '追加实际联系，临床结论仍由牙医评估', changes: changed(f, { ...f, status, requires_assessment: needs, next_contact_date: next }) };
    });
  }
  assess(credentials, input) {
    return this.unit.command(credentials, 'uc14.assess', input, (ctx, now) => {
      const f = row(this.db, 'followup_requirement', input.followupId); this.patient(f, input); this.mutable(f); revision(f, input.expectedRevision); this.scope(ctx, f, 'assess');
      if (!OPEN.includes(f.status)) fail(409, 'FOLLOWUP_UNPUBLISHED', '来源尚未发布，不能据此完成诊后评估');
      if (!['到诊检查','远程沟通'].includes(input.method) || !['完成','继续跟进','另行处置'].includes(input.advice)) fail(422, 'FOLLOWUP_ASSESSMENT', '请明确实际评估方式和处理意见');
      const at = instant(input.assessedAt, '实际评估时间'), last = this.db.prepare('SELECT assessed_at FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at DESC,id DESC LIMIT 1').get(f.id);
      if (at > now || at < f.created_at || (last && at < last.assessed_at)) fail(422, 'FOLLOWUP_ASSESSMENT_TIME', '评估须真实发生，按实际先后记录');
      let visitId = null;
      if (input.method === '到诊检查') {
        const visit = this.clinical.scope(ctx, input.visitId, 'assess');
        const planSourceVisit = f.source_plan_version_id ? row(this.db, 'plan_version', f.source_plan_version_id).source_visit_id : null;
        if (visit.patient_id !== f.patient_id) fail(409, 'PATIENT_MISMATCH', '评估就诊与患者不一致');
        if (visit.id === f.source_visit_id || visit.id === planSourceVisit || !visit.started_at || visit.started_at < f.created_at || visit.started_at > at || (visit.ended_at && at > visit.ended_at) || !['接诊中','诊疗结束'].includes(visit.status)) fail(409, 'FOLLOWUP_VISIT_NOT_ACTUAL', '到诊检查须引用要求形成后的实际复诊接诊，不能虚构到诊或复用原来源');
        visitId = visit.id;
      } else if (input.visitId != null) fail(422, 'FOLLOWUP_REMOTE_VISIT', '远程沟通不关联虚构的到诊记录');
      let next = null, responsible = null, frontdesk = f.responsible_frontdesk_id;
      if (input.advice !== '完成') {
        next = this.nextDate(input.nextDate, now); responsible = id(input.responsibleStaffId);
        const roles = staffRoles(this.db, this.unit.auth, responsible);
        if (!roles.some(r => ['frontdesk','dentist'].includes(r))) fail(409, 'FOLLOWUP_OWNER', '后续责任须为在岗前台或牙医');
        if (input.responsibleFrontdeskId != null) frontdesk = requireFrontdesk(this.db, this.unit.auth, input.responsibleFrontdeskId);
        else if (roles.includes('frontdesk')) frontdesk = responsible;
        requireFrontdesk(this.db, this.unit.auth, frontdesk);
      } else if (input.assessmentCompleted !== true) fail(422, 'FOLLOWUP_ASSESSMENT_CONFIRMATION', '请明确确认本次实际评估足以完成诊后要求');
      const result = text(input.result, '实际临床评估及信息边界', 6000);
      const key = insert(this.db, 'clinical_assessment', fact(now, { followup_requirement_id: f.id, visit_id: visitId, method: input.method, assessed_at: at,
        result, advice: input.advice, next_date: next, assessed_by: ctx.session.staff_id, responsible_staff_id: responsible }));
      if (input.advice === '完成' && f.status === '待联系') this.db.prepare("UPDATE followup_requirement SET status='待到诊或评估' WHERE id=?").run(f.id);
      const status = input.advice === '完成' ? '已完成' : '待联系';
      this.db.prepare('UPDATE followup_requirement SET status=?,next_contact_date=?,responsible_frontdesk_id=?,closed_at=?,closure_basis=?,closed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(
        status, next, frontdesk, input.advice === '完成' ? now : null, input.advice === '完成' ? '依据临床评估编号' + key + '及牙医完成确认' : null,
        input.advice === '完成' ? ctx.session.staff_id : null, now, f.id);
      ctx.authority.followupId = f.id; ctx.authority.followupBeforeRevision = f.revision; ctx.authority.followupAfterRevision = f.revision + 1;
      this.unit.workflowHistory.append('followup_requirement',f.id,status==='已完成'?'完成':'继续跟进','依据实际临床评估编号'+key+'记录处理意见',ctx,input,now);
      return { kind: 'clinical_assessment', key, revision: 1, reason: '牙医如实记录评估并决定完成或继续，费用状态独立',
        changes: changed(f, { ...f, status, next_contact_date: next, responsible_frontdesk_id: frontdesk }) };
    });
  }
  query(credentials, input) {
    const clinical = credentials.role === 'dentist';
    return this.unit.query(credentials, clinical ? 'uc14.assess' : 'uc13.contact', ctx => {
      const patientId = input.patientId == null ? null : id(Number(input.patientId)), page = input.page == null ? 1 : id(Number(input.page)), size = input.pageSize == null ? 20 : id(Number(input.pageSize));
      if (size > 100 || page > 1000000) fail(422, 'INVALID_PAGE', '请使用有效页码，每页最多100项');
      if (input.status != null && !['待发布', ...OPEN, '已完成','已撤销'].includes(input.status)) fail(422, 'INVALID_STATE', '诊后要求状态筛选无效');
      if (input.overdueOnly != null && !['true','false',true,false].includes(input.overdueOnly)) fail(422, 'INVALID_FILTER', '逾期筛选无效');
      const from = input.from == null ? null : dateOnly(input.from), to = input.to == null ? null : dateOnly(input.to);
      if (from && to && from > to) fail(422, 'INVALID_RANGE', '日期范围无效');
      const candidates = this.db.prepare(`SELECT * FROM followup_requirement WHERE (? IS NULL OR patient_id=?) AND (? IS NULL OR status=?)
        ORDER BY coalesce(next_contact_date,target_start),id`).all(patientId, patientId, input.status ?? null, input.status ?? null);
      const visible = candidates.filter(f => {
        if (!clinical) return f.responsible_frontdesk_id === ctx.session.staff_id && f.status !== '待发布';
        try { this.scope(ctx, f, 'followup.read'); return true; } catch (e) { if (e.code === 'FOLLOWUP_SCOPE') return false; throw e; }
      }).filter(f => {
        const due = f.next_contact_date || f.target_start;
        return (!from || due >= from) && (!to || due <= to) && (!['true',true].includes(input.overdueOnly) || OPEN.includes(f.status) && due < day(this.unit.auth.now()));
      });
      const items = visible.slice((page - 1) * size, page * size).map(f => {
        const patient = row(this.db, 'patient', f.patient_id), source = sourceState(this.db, f);
        const assessments = this.db.prepare('SELECT * FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at,id').all(f.id);
        const contacts = this.db.prepare(`SELECT c.*,a.status appointment_status,a.planned_start,a.planned_end,a.revision appointment_revision,v.id actual_visit_id
          FROM contact_history c LEFT JOIN appointment a ON a.id=c.appointment_id LEFT JOIN visit v ON v.appointment_id=a.id WHERE c.followup_requirement_id=? ORDER BY c.contacted_at,c.id`).all(f.id);
        return { ...f,history:this.unit.workflowHistory.list('followup_requirement',f.id),sourceReady: source.ready, sourceNeedsReview: f.status !== '待发布' && !source.ready,
          responsibleAvailable: staffRoles(this.db, this.unit.auth, f.responsible_frontdesk_id).includes('frontdesk'), source,
          patient: { id: patient.id, name: patient.name, recordNo: patient.record_no, phone: patient.phone, phoneOwner: patient.phone_owner,
            contactPreference: patient.contact_preference, contactUnavailableReason: patient.contact_unavailable_reason }, contacts,
          assessments: clinical ? assessments : assessments.map(a => ({ id: a.id, method: a.method, assessedAt: a.assessed_at, advice: a.advice, nextDate: a.next_date, responsibleStaffId: a.responsible_staff_id })) };
      });
      ctx.authority.returnedFollowupIds = items.map(f => f.id);
      return { total: visible.length, page, pageSize: size, computedAt: this.unit.auth.now(), items };
    });
  }
  context(credentials,input){
    const dentist=credentials.role==='dentist';
    return this.unit.query(credentials,dentist?'uc14.assess':'uc13.contact',ctx=>{
      const f=row(this.db,'followup_requirement',Number(input.followupId));
      if(dentist)this.scope(ctx,f,'assess');
      else if(f.responsible_frontdesk_id!==ctx.session.staff_id||f.status==='待发布')fail(403,'FOLLOWUP_FRONTDESK_SCOPE','只能查看本人负责且已发布的诊后联系资料');
      if(dentist){
        const planVisit=f.source_plan_version_id?row(this.db,'plan_version',f.source_plan_version_id).source_visit_id:null;
        const candidates=this.db.prepare(`SELECT id,record_no,patient_id,dentist_id,status,started_at,ended_at FROM visit
          WHERE patient_id=? AND id IS NOT ? AND id IS NOT ? AND started_at>=? AND status IN ('接诊中','诊疗结束') ORDER BY started_at DESC,id DESC`).all(f.patient_id,f.source_visit_id,planVisit,f.created_at);
        const visits=candidates.filter(v=>{try{this.clinical.scope(ctx,v.id,'assess');return true;}catch(e){if(e.code==='CLINICAL_SCOPE')return false;throw e;}});
        return {followupId:f.id,patientId:f.patient_id,visits};
      }
      const original=f.source_visit_id?row(this.db,'visit',f.source_visit_id).appointment_id:null;
      const date=input.date?dateOnly(input.date):null;
      const appointments=this.db.prepare(`SELECT a.id,a.record_no,a.revision,a.planned_start,a.planned_end,a.status FROM appointment a
        WHERE a.patient_id=? AND a.id IS NOT ? AND a.status IN ('已预约','已到诊') AND a.planned_start>=?
        AND (a.status='已到诊' OR a.planned_end>?) ORDER BY a.planned_start,a.id`).all(f.patient_id,original,f.created_at,this.unit.auth.now())
        .filter(a=>day(a.planned_start)>=f.target_start&&day(a.planned_start)<=f.target_end&&(!date||day(a.planned_start)===date));
      return {followupId:f.id,patientId:f.patient_id,appointments:appointments.slice(0,100),total:appointments.length};
    });
  }
  options(credentials) {
    const permission = credentials.role === 'dentist' ? 'uc12.propose' : 'uc13.contact';
    return this.unit.query(credentials, permission, () => ({ staff: this.db.prepare('SELECT id,name FROM staff ORDER BY id').all()
      .map(s => ({ ...s, roles: staffRoles(this.db, this.unit.auth, s.id).filter(r => ['frontdesk','dentist'].includes(r)) })).filter(s => s.roles.length) }));
  }
}
module.exports = { Followups };
