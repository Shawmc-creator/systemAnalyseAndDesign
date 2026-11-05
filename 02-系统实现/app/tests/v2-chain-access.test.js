'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {hasBranchRole, canReadCrossBranch} = require('../src/v2/chain-access');
const at = '2026-10-29T00:00:00Z';
function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE clinic_chain(id INTEGER,status TEXT);
 CREATE TABLE clinic_branch(id INTEGER,chain_id INTEGER,status TEXT);
 CREATE TABLE branch_staff_role(staff_id INTEGER,branch_id INTEGER,role_code TEXT,valid_from TEXT,valid_until TEXT,revoked_at TEXT);
 CREATE TABLE visit(id INTEGER,patient_id INTEGER,branch_id INTEGER);
 CREATE TABLE cross_branch_record_access(dentist_id INTEGER,patient_id INTEGER,visit_id INTEGER,source_branch_id INTEGER,target_branch_id INTEGER,scope TEXT,valid_from TEXT,valid_until TEXT,revoked_at TEXT);
 INSERT INTO clinic_chain VALUES(1,'active'),(2,'active');
 INSERT INTO clinic_branch VALUES(1,1,'active'),(2,1,'active'),(3,2,'active');
 INSERT INTO branch_staff_role VALUES(7,2,'dentist','2026-10-01T00:00:00Z',NULL,NULL);
 INSERT INTO visit VALUES(11,12,1);
 INSERT INTO cross_branch_record_access VALUES(7,12,11,1,2,'record','2026-10-01T00:00:00Z',NULL,NULL);`);
 return db;
}
const request = {staffId:7,targetBranchId:2,sourceBranchId:1,patientId:12,visitId:11,scope:'record',at};
test('只有目标门店牙医和明确授权的患者、就诊及范围可查', () => {
 const db=fixture(); try {
  assert.equal(canReadCrossBranch(db,request),true);
  for(const changed of [{staffId:8},{patientId:13},{visitId:12},{scope:'document'},{sourceBranchId:2},{targetBranchId:3}]) assert.equal(canReadCrossBranch(db,{...request,...changed}),false);
  assert.equal(hasBranchRole(db,{staffId:7,branchId:2,role:'frontdesk',at}),false);
 } finally {db.close();}
});
test('授权、岗位撤销或过期，以及目标门店停用均拒绝', () => {
 const db=fixture(); try {
  db.prepare('UPDATE cross_branch_record_access SET valid_until=?').run(at); assert.equal(canReadCrossBranch(db,request),false);
  db.exec('UPDATE cross_branch_record_access SET valid_until=NULL'); db.prepare('UPDATE cross_branch_record_access SET revoked_at=?').run(at); assert.equal(canReadCrossBranch(db,request),false);
  db.exec('UPDATE cross_branch_record_access SET revoked_at=NULL'); db.prepare('UPDATE branch_staff_role SET revoked_at=?').run(at); assert.equal(canReadCrossBranch(db,request),false);
  db.exec("UPDATE branch_staff_role SET revoked_at=NULL; UPDATE clinic_branch SET status='inactive' WHERE id=2"); assert.equal(canReadCrossBranch(db,request),false);
 } finally {db.close();}
});
test('其他连锁、非法时间或伪造全范围请求不能获取权限', () => {
 const db=fixture(); try {
  db.exec('UPDATE clinic_branch SET chain_id=2 WHERE id=1'); assert.equal(canReadCrossBranch(db,request),false);
  assert.equal(canReadCrossBranch(db,{...request,at:'2026-10-29'}),false);
  assert.equal(canReadCrossBranch(db,{...request,scope:'all'}),false);
  db.exec("UPDATE clinic_branch SET chain_id=1 WHERE id=1; UPDATE cross_branch_record_access SET valid_until='9999-invalid'");
  assert.equal(canReadCrossBranch(db,request),false);
 } finally {db.close();}
});
