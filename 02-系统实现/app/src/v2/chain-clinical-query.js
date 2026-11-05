'use strict';
const crypto = require('node:crypto');
const { insert, canonical, fail, hash, id } = require('./common');
const { ChainAuth } = require('./chain-auth');

// Candidate gateway only; no current route calls it. Queries are fixed here so
// callers cannot substitute a reader that escapes the authorized visit.
class ChainClinicalQuery {
  constructor(auth, store = null) { this.auth = auth; this.db = auth.db; this.access = new ChainAuth(auth); this.store=store; }
  audit(session, event, code, request, authority) {
    const safeId = x => Number.isSafeInteger(x) && x > 0 ? x : null;
    const scope = ['health','record','plan','prescription','document'].includes(request.scope) ? request.scope : null;
    insert(this.db, 'operation_audit', {
      account_id: session.account_id, staff_id: session.staff_id, session_id: session.id,
      submission_id: null, permission_id: authority?.permission.id ?? null,
      actor_kind: '职员', event_type: event, occurred_at: this.auth.now(),
      object_kind: 'cross_branch_clinical', object_key: 'access', before_revision: null, after_revision: null,
      reason: '跨店诊疗资料查阅', outcome_code: code, correlation_id: crypto.randomUUID(),
      authority_snapshot: canonical({role:authority?.authority.role ?? null, targetBranchId:safeId(request.targetBranchId),
        sourceBranchId:safeId(request.sourceBranchId), patientId:safeId(request.patientId), visitId:safeId(request.visitId),
        documentVersionId:safeId(request.documentVersionId), scope})
    });
  }
  read(credentials, request) {
    if (!request || typeof request !== 'object' || !['record','health','document'].includes(request.scope)) fail(422, 'INVALID_INPUT', '查阅资料类型无效');
    if (this.db.isTransaction) throw new Error('跨店查阅必须在独立事务中执行');
    // Reject unauthenticated callers before any access to clinical data.
    const session = this.auth.session(credentials.token);
    let authority;
    this.db.exec('BEGIN');
    try {
      authority = this.access.authorizeCrossBranchRead(credentials, request);
      let result;
      if(request.scope==='record') {
        const record=this.db.prepare(`SELECT c.* FROM clinical_record c JOIN visit v ON v.id=c.visit_id
          WHERE v.id=? AND v.patient_id=? AND v.branch_id=?`).get(request.visitId,request.patientId,request.sourceBranchId);
        if(!record) fail(404,'RECORD_NOT_FOUND','该就诊没有可查阅的病历');
        const findings=this.db.prepare('SELECT * FROM clinical_finding WHERE clinical_record_id=? ORDER BY sequence_no').all(record.id);
        const addenda=this.db.prepare('SELECT * FROM record_addendum WHERE clinical_record_id=? ORDER BY id').all(record.id);
        result={record,findings,addenda,sourceBranchId:request.sourceBranchId};
      } else if(request.scope==='health') {
        const versions=this.db.prepare(`SELECT h.* FROM health_version h JOIN visit v ON v.id=h.source_visit_id
          WHERE h.patient_id=? AND v.patient_id=? AND v.id=? AND v.branch_id=? ORDER BY h.version_no`).all(request.patientId,request.patientId,request.visitId,request.sourceBranchId);
        result={versions:versions.map(v=>({...v,items:this.db.prepare('SELECT * FROM health_item WHERE health_version_id=? ORDER BY id').all(v.id)})),sourceBranchId:request.sourceBranchId};
      } else {
        this.auth.authorize(credentials.token,'dentist','uc23.upload');
        if(!this.store) throw new Error('跨店原件存储未配置');
        const versionId=id(request.documentVersionId,'原件版本');
        const v=this.db.prepare(`SELECT dv.* FROM document_version dv JOIN clinical_document d ON d.id=dv.clinical_document_id
          JOIN visit v ON v.id=d.visit_id AND v.patient_id=d.patient_id
          WHERE dv.id=? AND v.id=? AND v.patient_id=? AND v.branch_id=?`).get(versionId,request.visitId,request.patientId,request.sourceBranchId);
        if(!v) fail(404,'DOCUMENT_NOT_FOUND','未找到该就诊的原件版本');
        let bytes;try { bytes=this.store.read(v.storage_key); } catch { fail(409,'FILE_UNAVAILABLE','原件缺失或不可读，请核对原版本'); }
        if(bytes.length!==v.size_bytes || hash(bytes)!==v.sha256) fail(409,'FILE_UNAVAILABLE','原件缺失或内容校验不符，请核对原版本');
        result={name:v.original_name,mediaType:v.media_type,bytes,documentVersionId:v.id,sourceBranchId:request.sourceBranchId};
      }
      this.audit(session, '查询', 'CROSS_BRANCH_QUERY_OK', request, authority);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (error.status === 403) {
        // A failed audit must never result in a successful read.
        this.audit(session, '拒绝', 'CROSS_BRANCH_FORBIDDEN', request, null);
      }
      throw error;
    }
  }
}
module.exports = { ChainClinicalQuery };
