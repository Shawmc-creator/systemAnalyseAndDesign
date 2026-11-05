'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {backup,DatabaseSync}=require('node:sqlite');
const {setup}=require('./helpers/v2-treatment');
const {verifySerialized}=require('../scripts/lib/chain-trial-verification');

test('含虚构接诊数据的快照全表对照及回滚，磁盘原快照保持不变',async t=>{
 const app=setup(t), folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-snapshot-'));
 const filename=path.join(folder,'snapshot.db');
 try {
  await backup(app.db,filename);
  const before=fs.readFileSync(filename), disk=new DatabaseSync(filename,{readOnly:true}); let bytes;
  try {bytes=disk.serialize();} finally {disk.close();}
  const result=verifySerialized(bytes);
  assert.equal(result.originalTables,112); assert.ok(result.originalRecords>0);
  assert.equal(result.candidateBranchFields,29);
  assert.equal(result.uniqueConstraintTrialVerified,true);
  assert.ok(result.checkedObjects>0); assert.equal(result.rollbackVerified,true); assert.equal(result.trialVerified,true);
  assert.deepEqual(fs.readFileSync(filename),before);
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
test('拒绝非SQLite数据及不匹配单店基线',()=>{
 assert.throws(()=>verifySerialized(Buffer.from('invalid')),/SQLite快照/);
 const db=new DatabaseSync(':memory:'); try {
  db.exec('CREATE TABLE sqlite_test_fixture(id INTEGER)'.replace('sqlite_test_fixture','test_fixture'));
  assert.throws(()=>verifySerialized(db.serialize()),/112表/);
 } finally {db.close();}
});
