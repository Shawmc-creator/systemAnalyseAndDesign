'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {setupFees}=require('./helpers/v2-fees');
const {installTrialSchema}=require('../src/v2/chain-schema-trial');
const {rebuildTrialUniqueConstraints}=require('../src/v2/chain-unique-trial');

test('门店资金账户与批次唯一性可在内存重建，失败回滚并保留现有数据和触发器',t=>{
 const a=setupFees(t),db=a.db,now=a.auth.now(),staff=a.auth.session(a.m.token).staff_id;
 installTrialSchema(db,{includeBusinessFields:true});
 db.exec("INSERT INTO clinic_chain(id,name) VALUES(1,'演示'); INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店'),(2,1,'B','二店'); UPDATE patient_funds SET branch_id=1");
 db.prepare(`INSERT INTO material(name,specification,base_unit,purchase_unit,conversion_numerator,conversion_denominator,quantity_scale,
  requires_trace,requires_expiry,is_active,created_by,record_no,created_at,updated_at,revision)
  VALUES('演示材料','测试','个','个',1,1,0,1,0,1,?,'CHAIN-MAT',?,?,1)`).run(staff,now,now);
 const material=db.prepare("SELECT id FROM material WHERE record_no='CHAIN-MAT'").get().id;
 db.prepare("INSERT INTO material_batch(material_id,batch_no,source_note,created_by,status,created_at,updated_at,revision,branch_id) VALUES(?,'演示批次','演示',?,'待检',?,?,1,1)").run(material,staff,now,now);
 const beforeFunds=db.prepare('SELECT * FROM patient_funds ORDER BY id').all(),beforeBatch=db.prepare('SELECT * FROM material_batch ORDER BY id').all();
 const schema=()=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','trigger','index') AND sql IS NOT NULL ORDER BY type,name").all().map(x=>[x.type,x.name,x.sql]);
 const beforeSchema=schema(),beforeSeq=db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all().map(x=>[x.name,x.seq]);
 assert.throws(()=>rebuildTrialUniqueConstraints(db,{testFailAfterFirst:true}),/模拟重建失败/);
 assert.deepEqual(schema(),beforeSchema);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.deepEqual(db.prepare('SELECT * FROM patient_funds ORDER BY id').all(),beforeFunds);
 rebuildTrialUniqueConstraints(db);
 assert.deepEqual(db.prepare('SELECT * FROM patient_funds ORDER BY id').all(),beforeFunds);
 assert.deepEqual(db.prepare('SELECT * FROM material_batch ORDER BY id').all(),beforeBatch);
 assert.deepEqual(db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all().map(x=>[x.name,x.seq]),beforeSeq);
 const triggers=beforeSchema.filter(x=>x[0]==='trigger');assert.deepEqual(schema().filter(x=>x[0]==='trigger'),triggers);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const newFund=db.prepare('INSERT INTO patient_funds(patient_id,opened_at,opened_by,created_at,updated_at,revision,branch_id) VALUES(1,?,?,?,?,1,?)');
 newFund.run(now,staff,now,now,2);assert.throws(()=>newFund.run(now,staff,now,now,1),/UNIQUE/);
 const newBatch=db.prepare("INSERT INTO material_batch(material_id,batch_no,source_note,created_by,status,created_at,updated_at,revision,branch_id) VALUES(?,'演示批次','演示',?,'待检',?,?,1,?)");
 newBatch.run(material,staff,now,now,2);assert.throws(()=>newBatch.run(material,staff,now,now,1),/UNIQUE/);
});
test('约束重建拒绝磁盘数据库，拒绝后原文件不改变',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-unique-')),file=path.join(folder,'sample.db');
 const db=new DatabaseSync(file);try{
  db.exec('CREATE TABLE demo(id INTEGER PRIMARY KEY); INSERT INTO demo VALUES(1)');
  const before=fs.readFileSync(file);
  assert.throws(()=>rebuildTrialUniqueConstraints(db),/仅允许独立内存数据库/);
  assert.deepEqual(fs.readFileSync(file),before);
 }finally{db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
