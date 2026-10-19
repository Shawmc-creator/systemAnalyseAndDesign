'use strict';
const { fail, row, day } = require('./common');
function staffRoles(db, auth, staffId) {
  const account = db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(staffId);
  return account ? auth.roles(account.id).map(r => r.code) : [];
}
function requireFrontdesk(db, auth, staffId) {
  row(db, 'staff', staffId);
  if (!staffRoles(db, auth, staffId).includes('frontdesk')) fail(409, 'FRONTDESK_UNAVAILABLE', '联系责任人须为当前在岗且具有有效前台资格的职员');
  return staffId;
}
function sourceState(db, requirement) {
  const visit = requirement.source_visit_id ? db.prepare(`SELECT v.id,v.patient_id,v.status,c.status record_status,c.signed_at
    FROM visit v JOIN clinical_record c ON c.visit_id=v.id WHERE v.id=?`).get(requirement.source_visit_id) : null;
  const version = requirement.source_plan_version_id ? db.prepare(`SELECT v.id,v.status,v.explained_at,p.patient_id,p.status plan_status
    FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.id=?`).get(requirement.source_plan_version_id) : null;
  const ready = !!(visit || version) && (!requirement.source_visit_id || !!visit && visit.patient_id === requirement.patient_id && visit.status === '诊疗结束' && visit.record_status === '已签署') &&
    (!requirement.source_plan_version_id || !!version && version.patient_id === requirement.patient_id && ['已确认','本版执行完成'].includes(version.status) && version.plan_status !== '已终止');
  return { ready, visit, version };
}
function publishSourceFollowups(db, auth, permission, input, output, now) {
  let visitId = null, versionId = null;
  if (permission === 'uc11.sign' && input.action === 'sign') visitId = row(db, 'clinical_record', output.key).visit_id;
  if (permission === 'uc22.plan' && input.action === 'decide') versionId = row(db, 'patient_decision', output.key).plan_version_id;
  if (!visitId && !versionId) return [];
  const candidates = db.prepare("SELECT * FROM followup_requirement WHERE status='待发布' AND (source_visit_id=? OR source_plan_version_id=?)").all(visitId, versionId);
  const related = [];
  for (const f of candidates) {
    if (!sourceState(db, f).ready || !staffRoles(db, auth, f.responsible_frontdesk_id).includes('frontdesk')) continue;
    const next = f.next_contact_date && f.next_contact_date >= day(now) ? f.next_contact_date : day(now);
    db.prepare("UPDATE followup_requirement SET status='待联系',next_contact_date=?,updated_at=?,revision=revision+1 WHERE id=?").run(next, now, f.id);
    related.push({ kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1,
      code: 'FOLLOWUP_PUBLISHED', reason: '来源签署或方案确认后发布诊后要求', changes: [
        { field: 'status', before: f.status, after: '待联系' }, { field: 'next_contact_date', before: f.next_contact_date, after: next }] });
  }
  return related;
}
function followupSnapshot(db) {
  return { lastContact: db.prepare('SELECT coalesce(max(id),0) n FROM contact_history').get().n,
    lastAssessment: db.prepare('SELECT coalesce(max(id),0) n FROM clinical_assessment').get().n,
    closed: new Set(db.prepare("SELECT id FROM followup_requirement WHERE status IN ('已完成','已撤销')").all().map(r => r.id)) };
}
function validateFollowups(db, before) {
  for (const table of ['contact_history', 'clinical_assessment']) {
    const limit = table === 'contact_history' ? before.lastContact : before.lastAssessment;
    for (const item of db.prepare(`SELECT followup_requirement_id FROM ${table} WHERE id>?`).all(limit)) {
      if (before.closed.has(item.followup_requirement_id)) fail(409, 'FOLLOWUP_CLOSED', '关闭后的新问题请另建有来源的新要求，不能改写原关闭流程');
    }
  }
  if (db.prepare("SELECT id FROM followup_requirement WHERE status='待联系' AND next_contact_date IS NULL").get()) fail(409, 'FOLLOWUP_NEXT_DATE', '待联系事项必须保留下次联系日期及责任');
  for (const f of db.prepare("SELECT * FROM followup_requirement WHERE status='已完成'").all()) {
    if (before.closed.has(f.id)) continue;
    const assessment = db.prepare('SELECT * FROM clinical_assessment WHERE followup_requirement_id=? ORDER BY assessed_at DESC,id DESC LIMIT 1').get(f.id);
    const contact = db.prepare('SELECT * FROM contact_history WHERE followup_requirement_id=? ORDER BY contacted_at DESC,id DESC LIMIT 1').get(f.id);
    const clinical = assessment?.advice === '完成' && assessment.assessed_by === f.closed_by && assessment.assessed_at <= f.closed_at;
    const nonclinical = !f.requires_assessment && contact?.result === '已联系' && contact.operator_id === f.closed_by && contact.contacted_at <= f.closed_at;
    if (!clinical && !nonclinical) fail(409, 'FOLLOWUP_COMPLETION_BASIS', '完成要求须有对应岗位的实际评估或无需评估的联系完成依据');
  }
}
module.exports = { staffRoles, requireFrontdesk, sourceState, publishSourceFollowups, followupSnapshot, validateFollowups };
