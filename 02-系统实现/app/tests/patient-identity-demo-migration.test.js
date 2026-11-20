'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {ensurePatientIdentityTrial}=require('../src/v2/patient-identity-schema-trial');

test('演示身份表随快照保留关联和撤销状态，重复检查不丢数据',()=>{
 const demo=createChainDemo(),db=demo.db;
 try{
  const original=db.prepare('SELECT count(*) n FROM patient').get().n;
  const result=db.prepare(`INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at)
   VALUES(1,'fictional-test',?,1,'虚构核实','2026-10-19T01:00:00Z')`).run('a'.repeat(64));
  assert.throws(()=>db.prepare('UPDATE patient_verified_identity SET patient_id=2 WHERE id=?').run(result.lastInsertRowid),/patient_identity_frozen/);
  assert.throws(()=>db.prepare('DELETE FROM patient_verified_identity WHERE id=?').run(result.lastInsertRowid),/patient_identity_frozen/);
  db.prepare('UPDATE patient_verified_identity SET revoked_at=?,revoked_by=1,revocation_reason=? WHERE id=?').run('2026-10-19T02:00:00Z','虚构撤销',result.lastInsertRowid);
  assert.throws(()=>db.prepare('UPDATE patient_verified_identity SET revocation_reason=? WHERE id=?').run('改写',result.lastInsertRowid),/patient_identity_frozen/);
  const restored=new DatabaseSync(':memory:');
  try{
   restored.deserialize(db.serialize());restored.exec('PRAGMA foreign_keys=ON; DROP TRIGGER patient_identity_immutable; DROP TRIGGER patient_identity_no_delete');
   assert.equal(ensurePatientIdentityTrial(restored),true);assert.equal(ensurePatientIdentityTrial(restored),false);
   assert.equal(restored.prepare('SELECT count(*) n FROM patient').get().n,original);
   const row=restored.prepare('SELECT patient_id,revoked_at,revocation_reason FROM patient_verified_identity WHERE id=?').get(result.lastInsertRowid);
   assert.deepEqual({...row},{patient_id:1,revoked_at:'2026-10-19T02:00:00Z',revocation_reason:'虚构撤销'});
   assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{restored.close();}
 }finally{db.close();}
});

test('身份结构不兼容时拒绝继续而非覆盖已有数据',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE patient_verified_identity(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO patient_verified_identity VALUES(1,\'保留\');');
  assert.throws(()=>ensurePatientIdentityTrial(db),/不兼容/);
  assert.equal(db.prepare('SELECT note FROM patient_verified_identity WHERE id=1').get().note,'保留');
 }finally{db.close();}
});

test('旧演示快照启动后补建身份结构并保留原患者数据',()=>{
 const folder=fs.mkdtempSync(path.join(__dirname,'identity-demo-tmp-'));
 const file=path.join(folder,'chain-demo.snapshot.sqlite');let demo;
 try{
  demo=createChainDemo({snapshotPath:file});
  const patientCount=demo.db.prepare('SELECT count(*) n FROM patient').get().n;
  demo.db.exec('DROP TABLE patient_verified_identity');
  fs.writeFileSync(file,demo.db.serialize()); // Simulate a snapshot made before this migration.
  demo.server.emit('close');demo.db.close();demo=null;
  demo=createChainDemo({snapshotPath:file});
  assert.equal(demo.db.prepare('SELECT count(*) n FROM patient_verified_identity').get().n,0);
  assert.equal(demo.db.prepare('SELECT count(*) n FROM patient').get().n,patientCount);
  const saved=new DatabaseSync(file,{readOnly:true});try{
   assert.ok(saved.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get());
  }finally{saved.close();}
 }finally{
  if(demo){demo.server.emit('close');demo.db.close();}
  const safePrefix=path.resolve(__dirname)+path.sep+'identity-demo-tmp-';
  if(!path.resolve(folder).startsWith(safePrefix))throw Error('测试临时目录不在预期位置');
  fs.rmSync(folder,{recursive:true,force:true});
 }
});
