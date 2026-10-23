'use strict';
const { fail, text, id, instant, dateOnly, day, utc, canonical, hash, insert, fact, row, revision } = require('./common');
const { signaturePayload,signedIntegrity } = require('./clinical-gates');
const CATEGORIES = ['病史', '过敏', '用药'];
const { startResources }=require('./resource-rules');
class Clinical {
  constructor(db, unit) { this.db = db; this.unit = unit; }
  scope(ctx, visitId, operation = 'read') {
    const visit = row(this.db, 'visit', visitId);
    if (visit.dentist_id !== ctx.session.staff_id) {
      // Free-text handovers never silently grant clinical access. Recognize only an explicit visit/operation scope.
      const now = this.unit.auth.now();
      const handovers = this.db.prepare(`SELECT * FROM clinical_handover WHERE patient_id=? AND receiving_dentist_id=? AND valid_from<=? AND (valid_until IS NULL OR valid_until>?)`).all(visit.patient_id, ctx.session.staff_id, now, now);
      const authorized = handovers.find(h => {
        try { const s = JSON.parse(h.scope); return Array.isArray(s.visitIds) && s.visitIds.includes(visit.id) && Array.isArray(s.operations) && s.operations.includes(operation); } catch { return false; }
      });
      if (!authorized) fail(403, 'CLINICAL_SCOPE', '当前牙医不在此就诊的接诊或明确交接范围内');
      ctx.authority.handoverId = authorized.id;
    }
    ctx.authority.visitId = visit.id; ctx.authority.patientId = visit.patient_id;
    return visit;
  }
  active(ctx, visitId, operation) {
    const visit = this.scope(ctx, visitId, operation);
    if (visit.status !== '接诊中') fail(409, 'VISIT_NOT_ACTIVE', '请先确认实际开始接诊；结束的就诊不能继续覆盖记录');
    return visit;
  }
  recordFor(visitId) {
    const record = this.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(visitId);
    if (!record) fail(409, 'RECORD_MISSING', '就诊缺少病历，需要负责人核对');
    return record;
  }
  draftContext(ctx,visitId,operation){
    const visit=this.scope(ctx,visitId,operation);
    if(!visit.started_at||!['接诊中','诊疗结束'].includes(visit.status))fail(409,'VISIT_NOT_ACTIVE','请先实际开始接诊，再填写本次病历');
    const record=this.recordFor(visit.id);
    if(record.status!=='草稿')fail(409,'RECORD_SIGNED','正文已签署，请追加独立补充');
    return {visit,record};
  }
  health(credentials, input) {
    return this.unit.command(credentials, 'uc21.health', input, (ctx, now) => {
      const {visit,record}=this.draftContext(ctx,input.visitId,'health');
      if (record.status !== '草稿') fail(409, 'RECORD_SIGNED', '签署病历所据健康复核已经冻结');
      if (input.patientId !== visit.patient_id) fail(409, 'PATIENT_MISMATCH', '患者与当前就诊不一致');
      const previous = this.db.prepare('SELECT * FROM health_version WHERE patient_id=? ORDER BY version_no DESC LIMIT 1').get(visit.patient_id);
      if ((input.expectedHealthVersionId ?? null) !== (previous?.id || null)) fail(409, 'HEALTH_VERSION_CONFLICT', '患者健康资料已变化，请重新核对最新版本');
      const conclusion = text(input.conclusion, '当次复核结论', 2000);
      let versionId = previous?.id;
      if (input.action === 'record') {
        if (!Array.isArray(input.items) || input.items.length !== 3 || new Set(input.items.map(i => i.category)).size !== 3) fail(422, 'HEALTH_INCOMPLETE', '病史、过敏、用药须分别明确记录');
        const items = CATEGORIES.map(category => {
          const i = input.items.find(i => i.category === category);
          if (!i || !['有', '无', '未知'].includes(i.certainty)) fail(422, 'HEALTH_INCOMPLETE', '每类健康资料必须明确选择有、无或未知');
          const reported = instant(i.reportedAt, '资料报告时间'), occurred = i.occurredAt ? instant(i.occurredAt, '实际发生时间') : null;
          if (reported > now || (occurred && occurred > now)) fail(422, 'FUTURE_FACT', '健康资料来源及发生时间不能在未来');
          return { category, certainty: i.certainty, content: text(i.content, '健康资料内容', 2000), source: text(i.source, '报告来源'), reported_at: reported, occurred_at: occurred };
        });
        const effective = instant(input.effectiveAt || now, '健康资料生效时间');
        if (effective > now || (previous && effective < previous.effective_at)) fail(422, 'HEALTH_EFFECTIVE_TIME', '健康资料生效时间须不晚于现在且不早于上一版本');
        const clinicalFacts = list => list.map(i => [i.category, i.certainty, i.content, i.occurred_at]);
        const oldItems = previous ? this.db.prepare('SELECT * FROM health_item WHERE health_version_id=?').all(previous.id).sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)) : [];
        if (!previous || canonical(clinicalFacts(items)) !== canonical(clinicalFacts(oldItems))) {
          versionId = insert(this.db, 'health_version', fact(now, { patient_id: visit.patient_id, formed_at: now, change_reason: text(input.reason, '健康变更原因'),
            version_no: previous ? previous.version_no + 1 : 1, effective_at: effective, created_by: ctx.session.staff_id, previous_version_id: previous?.id || null }));
          for (const i of items) insert(this.db, 'health_item', fact(now, { health_version_id: versionId, ...i }));
        }
      } else if (input.action !== 'review') fail(422, 'INVALID_ACTION', '健康办理动作无效');
      if (!versionId) fail(409, 'HEALTH_MISSING', '请先完整记录患者的健康资料');
      const key = insert(this.db, 'health_review', fact(now, { visit_id: visit.id, health_version_id: versionId, reviewed_at: now, conclusion, reviewed_by: ctx.session.staff_id }));
      ctx.authority.healthVersionId = versionId;
      return { kind: 'health_review', key, revision: 1, reason: '完成当次健康资料复核' };
    });
  }
  record(credentials, input) {
    return this.unit.command(credentials, 'uc10.record', input, (ctx, now) => {
      const visit = this.scope(ctx, input.visitId, 'record');
      if (input.action === 'start') {
        revision(visit, input.expectedVisitRevision);
        if (visit.status !== '候诊') fail(409, 'INVALID_STATE', '只能从候诊状态开始接诊');
        const started = instant(input.startedAt, '实际接诊时间');
        if (started < visit.arrived_at || started > now || day(started) !== day(now)) fail(422, 'START_TIME', '开始接诊须为当日、已发生且不早于实际到诊');
        const occupancy = this.db.prepare(`SELECT o.*,s.dentist_id,s.status schedule_status FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE o.visit_id=? AND o.released_at IS NULL`).get(visit.id);
        if (!occupancy || occupancy.dentist_id !== visit.dentist_id || occupancy.schedule_status !== '已确认' || started < occupancy.starts_at || started >= occupancy.ends_at) fail(409, 'CONTACT_OUTSIDE_SLOT', '实际接诊不在当前有效占用内，请由前台核对接诊时段');
        startResources(this.db,visit,occupancy,now);
        this.db.prepare("UPDATE visit SET status='接诊中',started_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(started, now, visit.id);
        return { kind: 'visit', key: visit.id, beforeRevision: visit.revision, revision: visit.revision + 1 };
      }
      if (input.action !== 'save') fail(422, 'INVALID_ACTION', '病历办理动作无效');
      const {record}=this.draftContext(ctx,visit.id,'record');
      if (input.recordId !== record.id) fail(409, 'RECORD_MISMATCH', '病历与当前就诊不一致');
      if (record.status !== '草稿') fail(409, 'RECORD_SIGNED', '病历已签署，后续请追加独立补充');
      revision(record, input.expectedRevision);
      const optional=(value,label)=>value==null||value===''?null:text(value,label,4000);
      const fields = { chief_complaint: optional(input.chiefComplaint, '主诉'), diagnosis: optional(input.diagnosis, '诊断'), treatment_advice: optional(input.treatmentAdvice, '处理意见') };
      if (!Array.isArray(input.findings) || input.findings.length > 100) fail(422, 'FINDINGS_REQUIRED', '检查所见须为不超过100项的列表；尚未完成可暂存草稿');
      const existing = this.db.prepare('SELECT * FROM clinical_finding WHERE clinical_record_id=? ORDER BY sequence_no').all(record.id);
      const ids = input.findings.filter(f => f.id != null).map(f => id(f.id));
      if (new Set(ids).size !== ids.length || existing.some(f => !ids.includes(f.id)) || ids.some(i => !existing.some(f => f.id === i))) fail(422, 'FINDING_SET', '所见须属于当前病历；已有条目请逐项修订，本批暂不提供删除');
      for (let index = 0; index < input.findings.length; index++) {
        const f = input.findings[index], old = existing.find(e => e.id === f.id);
        const tooth = f.toothCode ? text(f.toothCode, '牙位', 8) : null, surface = f.surfaceCode ? text(f.surfaceCode, '牙面', 8) : null;
        if ((tooth && !/^(?:[1-4][1-8]|[5-8][1-5])$/.test(tooth)) || (surface && (!tooth || !/^[MODBLIP]+$/.test(surface)))) fail(422, 'TOOTH_SURFACE', '请使用有效FDI牙位；牙面必须有所属牙位');
        const finding = text(f.text, '检查所见', 4000);
        if (old) {
          if (old.sequence_no !== index + 1) fail(422, 'FINDING_ORDER', '本批所见保留原顺序，可在末尾追加');
          this.db.prepare('UPDATE clinical_finding SET tooth_code=?,surface_code=?,finding_text=?,recorded_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(tooth, surface, finding, ctx.session.staff_id, now, old.id);
        } else insert(this.db, 'clinical_finding', fact(now, { clinical_record_id: record.id, tooth_code: tooth, surface_code: surface, finding_text: finding, sequence_no: index + 1, recorded_by: ctx.session.staff_id }));
      }
      this.db.prepare('UPDATE clinical_record SET chief_complaint=?,diagnosis=?,treatment_advice=?,updated_at=?,revision=revision+1 WHERE id=?').run(...Object.values(fields), now, record.id);
      return { kind: 'clinical_record', key: record.id, revision: record.revision + 1, beforeRevision: record.revision, reason: '牙医记录实际检查诊断' };
    });
  }
  sign(credentials, input) {
    return this.unit.command(credentials, 'uc11.sign', input, (ctx, now) => {
      const record = row(this.db, 'clinical_record', input.recordId), visit = this.scope(ctx, record.visit_id, input.action === 'addendum' ? 'addendum' : 'sign');
      revision(record,input.action==='sign'&&record.status==='已签署'&&input.expectedRevision===record.signed_revision?record.revision:input.expectedRevision);
      if (input.confirmed !== true) fail(422, 'CONFIRMATION_REQUIRED', '请确认已经逐项核对本次病历');
      if (input.action === 'addendum') {
        if (record.status !== '已签署') fail(409, 'RECORD_UNSIGNED', '独立补充只适用于已签署病历');
        const content = text(input.content, '独立补充正文', 8000), reason = text(input.reason, '补充或更正依据', 2000);
        const key = insert(this.db, 'record_addendum', fact(now, { clinical_record_id: record.id, content, reason, added_at: now,
          content_hash: hash(canonical({ recordId: record.id, content, reason, signedBy: ctx.session.staff_id, addedAt: now })), signed_by: ctx.session.staff_id }));
        return { kind: 'record_addendum', key, revision: 1, reason: '追加独立病历补充' };
      }
      if (input.action !== 'sign') fail(422, 'INVALID_ACTION', '签署动作无效');
      if(record.status==='已签署')return {kind:'clinical_record',key:record.id,revision:record.revision,code:'ALREADY_SIGNED',reason:'返回原签署结果'};
      if (record.status !== '草稿' || !visit.started_at || !['接诊中','诊疗结束'].includes(visit.status)) fail(409, 'INVALID_STATE', '实际开始接诊后可核对草稿签署；实际结束独立办理');
      if (visit.started_at > now) fail(409, 'START_TIME', '接诊时间晚于当前时间，不能结束诊疗');
      for (const [key, label] of [['chief_complaint', '主诉'], ['diagnosis', '诊断'], ['treatment_advice', '处理意见']]) text(record[key], label, 4000);
      const payload = signaturePayload(this.db, record);
      if (!payload.findings.length || !payload.healthReviews.length) fail(409, 'SIGNING_INCOMPLETE', '签署前必须保存检查所见并完成当次健康复核');
      const latestVersion = this.db.prepare('SELECT id FROM health_version WHERE patient_id=? ORDER BY version_no DESC LIMIT 1').get(visit.patient_id);
      if (payload.healthReviews.at(-1).health_version_id !== latestVersion?.id) fail(409, 'HEALTH_REVIEW_STALE', '健康版本已经更新，请重新复核后再签署');
      this.db.prepare("UPDATE clinical_record SET status='已签署',signed_at=?,signed_by=?,signed_revision=?,signed_health_review_id=?,content_hash=?,updated_at=?,revision=revision+1 WHERE id=?").run(now, ctx.session.staff_id, record.revision,payload.healthReviews[0].id, hash(canonical(payload)), now, record.id);
      // A signed record does not certify physical end or completed chair preparation.
      ctx.authority.healthReviewIds = payload.healthReviews.map(r => r.id);
      return { kind: 'clinical_record', key: record.id, beforeRevision: record.revision, revision: record.revision + 1, reason: '冻结正文、所见及确切健康复核；实际结束独立办理' };
    });
  }
  detail(credentials, input) {
    return this.unit.query(credentials, 'uc09.query', ctx => {
      const visit = this.scope(ctx, Number(input.visitId));
      if (Number(input.patientId) !== visit.patient_id) fail(403, 'PATIENT_MISMATCH', '患者与获准就诊不一致');
      const record = this.recordFor(visit.id), versions = this.db.prepare('SELECT * FROM health_version WHERE patient_id=? ORDER BY version_no DESC').all(visit.patient_id);
      const occupancy=this.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(visit.id)||null;
      return { serverNow:this.unit.auth.now(),visit, patient: row(this.db, 'patient', visit.patient_id), record,
        requiresEndVerification:visit.status==='诊疗结束'&&!!occupancy,occupancy,physicalEnd:this.db.prepare("SELECT released_at FROM resource_occupancy WHERE visit_id=? AND release_reason='实际操作结束，转清洁核验' ORDER BY id DESC LIMIT 1").get(visit.id)?.released_at||null,
        findings: this.db.prepare('SELECT * FROM clinical_finding WHERE clinical_record_id=? ORDER BY sequence_no').all(record.id),
        addenda: this.db.prepare('SELECT * FROM record_addendum WHERE clinical_record_id=? ORDER BY id').all(record.id),
        healthVersions: versions.map(v => ({ ...v, items: this.db.prepare('SELECT * FROM health_item WHERE health_version_id=? ORDER BY id').all(v.id) })),
        reviews: this.db.prepare('SELECT * FROM health_review WHERE visit_id=? ORDER BY id').all(visit.id),
        signedIntegrity: record.status === '已签署' ? signedIntegrity(this.db,record) : null };
    });
  }
  queue(credentials, input) {
    return this.unit.query(credentials, 'uc09.query', ctx => {
      const date = dateOnly(input.date || day(this.unit.auth.now()));
      return { items: this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.status,v.revision,v.arrived_at,p.name patient_name,p.record_no patient_no,c.id record_id,c.status record_status
        FROM visit v JOIN patient p ON p.id=v.patient_id JOIN clinical_record c ON c.visit_id=v.id
        WHERE v.dentist_id=? AND v.arrived_at>=? AND v.arrived_at<? ORDER BY v.arrived_at,v.id`).all(ctx.session.staff_id, utc(date + 'T00:00:00+08:00'), utc(Date.parse(date + 'T00:00:00+08:00') + 86400_000)) };
    });
  }
}
module.exports = { Clinical };
