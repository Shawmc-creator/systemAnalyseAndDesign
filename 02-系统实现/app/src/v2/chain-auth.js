'use strict';
const { fail } = require('./common');
const { hasBranchRole, canReadCrossBranch } = require('./chain-access');

// Candidate adapter: deliberately not registered with existing routes until
// schema migration, scoped queries and access auditing are implemented.
class ChainAuth {
  constructor(auth) { this.auth = auth; this.db = auth.db; }
  authorizeBranch(credentials, permission, branchId, branchRole = null) {
    const roles = { frontdesk:'frontdesk', dentist:'dentist', assistant:'assistant', cashier:'cashier', pharmacist:'pharmacist', manager:'branch_manager' };
    branchRole = branchRole ?? roles[credentials.role];
    if (roles[credentials.role] !== branchRole) fail(403, 'BRANCH_FORBIDDEN', '当前岗位无权办理该门店业务');
    const result = this.auth.authorize(credentials.token, credentials.role, permission, credentials.csrf);
    const at = this.auth.now();
    if (!hasBranchRole(this.db, {staffId:result.session.staff_id, branchId, role:branchRole, at}))
      fail(403, 'BRANCH_FORBIDDEN', '当前岗位无权办理该门店业务');
    return { ...result, branchId, checkedAt:at };
  }
  authorizeCrossBranchRead(credentials, request) {
    if (credentials.role !== 'dentist') fail(403, 'CROSS_BRANCH_FORBIDDEN', '无权查阅该诊疗资料');
    const result = this.authorizeBranch(credentials, 'uc09.query', request.targetBranchId);
    if (!canReadCrossBranch(this.db, {staffId:result.session.staff_id, targetBranchId:result.branchId,
      sourceBranchId:request.sourceBranchId, patientId:request.patientId, visitId:request.visitId,
      scope:request.scope, at:result.checkedAt}))
      fail(403, 'CROSS_BRANCH_FORBIDDEN', '无权查阅该诊疗资料');
    return result;
  }
}
module.exports = { ChainAuth };
