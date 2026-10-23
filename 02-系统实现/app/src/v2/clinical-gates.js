'use strict';
const { canonical, hash, fail } = require('./common');
function legacySignaturePayload(db, record) {
  return {
    recordId: record.id, visitId: record.visit_id, draftRevision: record.signed_revision || record.revision,
    chiefComplaint: record.chief_complaint, diagnosis: record.diagnosis, treatmentAdvice: record.treatment_advice,
    findings: db.prepare(`SELECT id,sequence_no,tooth_code,surface_code,finding_text,recorded_by FROM clinical_finding
      WHERE clinical_record_id=? ORDER BY sequence_no,id`).all(record.id),
    healthReviews: db.prepare(`SELECT id,health_version_id,reviewed_at,conclusion,reviewed_by FROM health_review
      WHERE visit_id=? ORDER BY id`).all(record.visit_id)
  };
}
function signaturePayload(db,record){
  const payload=legacySignaturePayload(db,record);
  payload.healthReviews=record.signed_health_review_id
    ?payload.healthReviews.filter(r=>r.id===record.signed_health_review_id)
    :payload.healthReviews.slice(-1);
  return payload;
}
function signedIntegrity(db,record){
  if(hash(canonical(signaturePayload(db,record)))===record.content_hash)return true;
  // Older signatures hashed all existing reviews. Retain that original receipt, bounded by its frozen review ID.
  const legacy=legacySignaturePayload(db,record);
  legacy.healthReviews=legacy.healthReviews.filter(r=>r.id<=record.signed_health_review_id&&r.reviewed_at<=record.signed_at);
  return legacy.healthReviews.length>0&&hash(canonical(legacy))===record.content_hash;
}
function clinicalSnapshot(db) {
  return db.prepare('SELECT v.id,count(i.id) n FROM health_version v LEFT JOIN health_item i ON i.health_version_id=v.id GROUP BY v.id').all();
}
function validateClinical(db, before) {
  for (const version of before) {
    if (db.prepare('SELECT count(*) n FROM health_item WHERE health_version_id=?').get(version.id).n !== version.n) fail(409, 'HEALTH_VERSION_SEALED', '既有健康版本不能追加条目，请形成新版本');
  }
  const incomplete = db.prepare(`SELECT v.id FROM health_version v LEFT JOIN health_item i ON i.health_version_id=v.id
    GROUP BY v.id HAVING count(i.id)<>3 OR count(DISTINCT i.category)<>3`).get();
  if (incomplete) fail(409, 'HEALTH_INCOMPLETE', '健康版本必须完整记录病史、过敏和用药三类');
  for (const record of db.prepare("SELECT * FROM clinical_record WHERE status='已签署'").all()) {
    if (!signedIntegrity(db,record)) fail(409, 'SIGNED_CONTENT_CHANGED', '签署正文、所见或健康复核依据发生变化，已拒绝提交');
  }
}
module.exports = { signaturePayload, legacySignaturePayload, signedIntegrity, clinicalSnapshot, validateClinical };
