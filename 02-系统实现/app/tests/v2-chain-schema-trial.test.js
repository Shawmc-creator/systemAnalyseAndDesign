'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/v2/database');
const { installTrialSchema } = require('../src/v2/chain-schema-trial');
const { setup } = require('./helpers/v2-treatment');
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
const columns = (db, table) => db.prepare(`PRAGMA table_info("${table}")`).all().map(r=>r.name);

test('内存基线可原子建立候选表，原有表保留且未知来源为空', () => {
 const db=openDatabase(); try {
  const before=tables(db),version=db.prepare('PRAGMA user_version').get().user_version;
  installTrialSchema(db);
  assert.equal(tables(db).length,116); assert.ok(before.every(x=>tables(db).includes(x)));
  assert.ok(columns(db,'visit').includes('branch_id')); assert.ok(columns(db,'health_version').includes('source_visit_id'));
  assert.equal(db.prepare('SELECT count(*) n FROM clinic_branch').get().n,0);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally { db.close(); }
});
test('中途失败时字段、索引和候选表全部回滚', () => {
 const db=openDatabase(); try {
  const before=tables(db),index=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index'").get().n;
  assert.throws(()=>installTrialSchema(db,{testFailAfterDdl:true}),/模拟试验失败/);
  assert.deepEqual(tables(db),before); assert.equal(columns(db,'visit').includes('branch_id'),false);
  assert.equal(columns(db,'health_version').includes('source_visit_id'),false);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index'").get().n,index);
 } finally {db.close();}
});
test('完整候选字段在单个事务内添加或整体回滚，旧值不推断归属',t=>{
 const a=setup(t),db=a.db;
 assert.throws(()=>installTrialSchema(db,{includeBusinessFields:true,testFailAfterDdl:true}),/模拟试验失败/);
 for(const [table,column] of [['patient','created_branch_id'],['patient_funds','branch_id'],['followup_requirement','responsible_branch_id'],['treatment_quote','branch_id']])
  assert.equal(columns(db,table).includes(column),false);
 installTrialSchema(db,{includeBusinessFields:true});
 for(const [table,column] of [['patient','created_branch_id'],['patient_funds','branch_id'],['followup_requirement','source_branch_id'],['followup_requirement','responsible_branch_id'],['treatment_quote','branch_id']]){
  assert.ok(columns(db,table).includes(column));
  assert.equal(db.prepare(`SELECT count(*) n FROM "${table}" WHERE "${column}" IS NOT NULL`).get().n,0);
 }
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('拒绝对磁盘数据库执行，即使是临时副本', () => {
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-chain-trial-'));
 const db=openDatabase(path.join(folder,'trial.db')); try {
  assert.throws(()=>installTrialSchema(db),/仅允许独立内存数据库/);
  assert.equal(tables(db).length,112);
 } finally {db.close(); fs.rmSync(folder,{recursive:true,force:true});}
});
test('已有就诊事实不变，跨店授权不能关联错误患者或来源门店', t => {
 const a=setup(t),db=a.db;
 const before=db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id);
 installTrialSchema(db);
 const after=db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id);
 assert.equal(after.branch_id,null);
 for(const [key,value] of Object.entries(before)) assert.equal(after[key],value,key);
 db.exec("INSERT INTO clinic_chain(id,name) VALUES(1,'演示'); INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店'),(2,1,'B','二店')");
 db.prepare('UPDATE visit SET branch_id=1 WHERE id=?').run(a.v.id);
 const staff=a.auth.session(a.d.token).staff_id, manager=a.auth.session(a.m.token).staff_id, now=a.auth.now();
 const q=db.prepare("INSERT INTO cross_branch_record_access(dentist_id,patient_id,visit_id,source_branch_id,target_branch_id,scope,valid_from,granted_by,granted_at,evidence) VALUES(?,?,?,1,2,'record',?,?,?,'演示')");
 assert.throws(()=>q.run(staff,999999,a.v.id,now,manager,now),/FOREIGN KEY/);
 q.run(staff,1,a.v.id,now,manager,now);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
