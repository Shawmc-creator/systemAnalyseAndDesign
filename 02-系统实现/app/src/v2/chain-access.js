'use strict';

// Candidate authorization rules. Call only after authenticating the staff
// member and validating the existing role qualification and permission.
// This module is not yet connected to the running application.
function validTime(at) {
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) &&
    Number.isFinite(Date.parse(at)) && new Date(at).toISOString().replace('.000Z', 'Z') === at;
}
function positiveId(value) { return Number.isSafeInteger(value) && value > 0; }
function validGrantTimes(row) {
  return validTime(row.valid_from) && (row.valid_until === null || validTime(row.valid_until)) &&
    (row.revoked_at === null || validTime(row.revoked_at));
}
function hasBranchRole(db, { staffId, branchId, role, at }) {
  if (!positiveId(staffId) || !positiveId(branchId) || typeof role !== 'string' || !validTime(at)) return false;
  return db.prepare(`SELECT r.valid_from,r.valid_until,r.revoked_at FROM branch_staff_role r
    JOIN clinic_branch b ON b.id=r.branch_id JOIN clinic_chain c ON c.id=b.chain_id
    WHERE r.staff_id=? AND r.branch_id=? AND r.role_code=? AND b.status='active' AND c.status='active'
      AND r.valid_from<=? AND (r.valid_until IS NULL OR r.valid_until>?)
      AND (r.revoked_at IS NULL OR r.revoked_at>?)`).all(staffId, branchId, role, at, at, at).some(validGrantTimes);
}
function canReadCrossBranch(db, { staffId, targetBranchId, sourceBranchId, patientId, visitId, scope, at }) {
  const scopes = new Set(['health', 'record', 'plan', 'prescription', 'document']);
  if (![staffId, targetBranchId, sourceBranchId, patientId, visitId].every(positiveId) ||
      targetBranchId === sourceBranchId || !scopes.has(scope) || !validTime(at) ||
      !hasBranchRole(db, {staffId, branchId: targetBranchId, role: 'dentist', at})) return false;
  return db.prepare(`SELECT a.valid_from,a.valid_until,a.revoked_at FROM cross_branch_record_access a
    JOIN clinic_branch source ON source.id=a.source_branch_id
    JOIN clinic_branch target ON target.id=a.target_branch_id AND target.chain_id=source.chain_id
    JOIN visit v ON v.id=a.visit_id AND v.patient_id=a.patient_id AND v.branch_id=a.source_branch_id
    WHERE a.dentist_id=? AND a.target_branch_id=? AND a.source_branch_id=? AND a.patient_id=? AND a.visit_id=?
      AND a.scope IN (?, 'all') AND a.valid_from<=? AND (a.valid_until IS NULL OR a.valid_until>?)
      AND (a.revoked_at IS NULL OR a.revoked_at>?)`)
    .all(staffId, targetBranchId, sourceBranchId, patientId, visitId, scope, at, at, at).some(validGrantTimes);
}
module.exports = { hasBranchRole, canReadCrossBranch };
