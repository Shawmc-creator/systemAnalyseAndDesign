'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { checkLegacyAssignments } = require('../scripts/lib/chain-preflight');

const candidate = { rows: [
  { table: 'appointment', mode: '新增门店外键', field: 'branch_id' },
  { table: 'followup_requirement', mode: '来源与负责门店', fields: ['source_branch_id', 'responsible_branch_id'] }
] };
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE appointment(id INTEGER PRIMARY KEY); INSERT INTO appointment VALUES(1),(2); CREATE TABLE followup_requirement(id INTEGER PRIMARY KEY); INSERT INTO followup_requirement VALUES(3)');
  return db;
}
function valid() { return { branchIds: [1, 2], tables: {
  appointment: { 1: { branch_id: 1 }, 2: { branch_id: 2 } },
  followup_requirement: { 3: { source_branch_id: 1, responsible_branch_id: 2 } }
} }; }

test('完整映射分别核对来源和负责门店，检查不修改记录', () => {
  const db = fixture(); try {
    assert.equal(checkLegacyAssignments(db, candidate, valid()).assignmentComplete, true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM appointment').get().n, 2);
  } finally { db.close(); }
});
test('缺失记录、缺失字段、未知门店和多余记录均不通过', () => {
  const db = fixture(); try {
    const a = valid(); delete a.tables.appointment['2'];
    a.tables.followup_requirement['3'] = { source_branch_id: 1 };
    assert.equal(checkLegacyAssignments(db, candidate, a).assignmentComplete, false);
    assert.equal(checkLegacyAssignments(db, candidate, a).tables[0].missing, 1);
    assert.equal(checkLegacyAssignments(db, candidate, a).tables[1].invalid, 1);
    const b = valid(); b.tables.appointment['1'].branch_id = 99; b.tables.appointment['99'] = { branch_id: 1 };
    const result = checkLegacyAssignments(db, candidate, b);
    assert.equal(result.assignmentComplete, false); assert.equal(result.tables[0].invalid, 1); assert.equal(result.tables[0].unexpected, 1);
  } finally { db.close(); }
});
test('拒绝未知表、重复门店编号和数据库缺表', () => {
  const db = fixture(); try {
    const a = valid(); a.tables.unknown = {}; assert.throws(() => checkLegacyAssignments(db, candidate, a), /非候选/);
    const b = valid(); b.branchIds = [1, 1]; assert.throws(() => checkLegacyAssignments(db, candidate, b), /互不重复/);
    db.exec('DROP TABLE appointment'); assert.throws(() => checkLegacyAssignments(db, candidate, valid()), /缺少候选表/);
  } finally { db.close(); }
});
test('拒绝重复或不合法候选字段、继承的记录及门店字段', () => {
  const db = fixture(); try {
    const malformed={rows:[{table:'appointment',mode:'来源与负责门店',fields:['branch_id','branch_id']}]};
    assert.throws(()=>checkLegacyAssignments(db,malformed,{branchIds:[1],tables:{}}),/候选字段/);
    assert.throws(()=>checkLegacyAssignments(db,{rows:[{table:'appointment',mode:'新增门店外键',field:'branch id'}]},{branchIds:[1],tables:{}}),/候选字段/);
    const inherited=valid(); inherited.tables.appointment=Object.create({'1':{branch_id:1}}); inherited.tables.appointment['2']={branch_id:2};
    assert.equal(checkLegacyAssignments(db,candidate,inherited).tables[0].missing,1);
    const inheritedField=valid(); inheritedField.tables.appointment['1']=Object.create({branch_id:1});
    assert.equal(checkLegacyAssignments(db,candidate,inheritedField).tables[0].invalid,1);
  } finally { db.close(); }
});
