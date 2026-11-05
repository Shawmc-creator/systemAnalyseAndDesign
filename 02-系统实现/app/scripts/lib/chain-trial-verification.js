'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { installTrialSchema } = require('../../src/v2/chain-schema-trial');
const { rebuildTrialUniqueConstraints } = require('../../src/v2/chain-unique-trial');
const quote = s => '"'+s.replaceAll('"','""')+'"';
const digest = v => crypto.createHash('sha256').update(v).digest('hex');
function snapshot(db) {
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const tableData={};
 for(const name of names) {
  const cols=db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all().filter(x=>x.hidden!==1).map(x=>x.name);
  const rows=db.prepare(`SELECT ${cols.map(quote).join(',')} FROM ${quote(name)}`).all();
  const rowHashes=rows.map(row=>digest(JSON.stringify(row))).sort();
  tableData[name]={cols, count:rows.length, digest:digest(JSON.stringify(rowHashes))};
 }
 const objects=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY type,name").all();
 const sequence=db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all();
 return {tableData,objects,sequence};
}
function compareOriginal(db, before) {
 for(const [name,previous] of Object.entries(before.tableData)) {
  const columns=previous.cols.map(quote).join(',');
  const rows=db.prepare(`SELECT ${columns} FROM ${quote(name)}`).all();
  const hash=digest(JSON.stringify(rows.map(row=>digest(JSON.stringify(row))).sort()));
  if(rows.length!==previous.count || hash!==previous.digest) throw new Error('原表记录与字段核对失败：'+name);
 }
 const objects=new Map(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL").all().map(o=>[o.type+':'+o.name,o.sql]));
 for(const o of before.objects) if(objects.get(o.type+':'+o.name)!==o.sql) throw new Error('原索引或触发器变化：'+o.name);
 const seq=new Map(db.prepare('SELECT name,seq FROM sqlite_sequence').all().map(r=>[r.name,r.seq]));
 for(const row of before.sequence) if(seq.get(row.name)!==row.seq) throw new Error('原自增序列变化：'+row.name);
 if(db.prepare('PRAGMA foreign_key_check').all().length || db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('完整性或外键检查失败');
}
function cloneInMemory(bytes) {
 const db=new DatabaseSync(':memory:');
 // A serialized, already consistent WAL snapshot retains WAL header flags.
 // In-memory SQLite cannot open a WAL journal, so normalize only the copy.
 try {
  const image=Buffer.from(bytes);
  if(image.length<100 || image.subarray(0,16).toString('binary')!=='SQLite format 3\u0000') throw new Error('不是有效的SQLite快照');
  if(image[18]===2 && image[19]===2) { image[18]=1; image[19]=1; }
  db.deserialize(image);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON');
  return db;
 } catch(error) { db.close(); throw error; }
}
function verifySerialized(bytes) {
 const mapping=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json'),'utf8'));
 const fields=[];
 for(const item of mapping.rows){
  if(item.mode==='新增门店外键')fields.push([item.table,item.field]);
  if(item.mode==='来源与负责门店')for(const column of item.fields)fields.push([item.table,column]);
  if(item.table==='patient'&&item.provenance_candidate)fields.push([item.table,item.provenance_candidate.field]);
 }
 const original=cloneInMemory(bytes); let before;
 try {
  if(original.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n!==112) throw new Error('仅支持112表单店基线');
  before=snapshot(original);
 }
 finally { original.close(); }
 const failed=cloneInMemory(bytes);
 try {
  let rejected=false;
  try { installTrialSchema(failed,{testFailAfterDdl:true,includeBusinessFields:true}); } catch(e) { if(e.message!=='模拟试验失败') throw e; rejected=true; }
  if(!rejected) throw new Error('模拟失败没有触发');
  compareOriginal(failed,before);
  if(failed.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='clinic_branch'").get()) throw new Error('失败后的候选表未回滚');
  for(const [table,column] of fields)if(failed.prepare(`PRAGMA table_info(${quote(table)})`).all().some(c=>c.name===column))throw new Error('失败后的候选字段未回滚：'+table+'.'+column);
 } finally { failed.close(); }
 const trial=cloneInMemory(bytes);
 try {
  installTrialSchema(trial,{includeBusinessFields:true}); compareOriginal(trial,before);
  let rebuildFailed=false;
  try{rebuildTrialUniqueConstraints(trial,{testFailAfterFirst:true});}catch(e){if(e.message!=='模拟重建失败')throw e;rebuildFailed=true;}
  if(!rebuildFailed)throw new Error('唯一约束重建回滚试验未触发');
  compareOriginal(trial,before);
  if(!trial.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='patient_funds'").get().sql.includes('UNIQUE ("patient_id")'))throw new Error('唯一约束失败后未回滚');
  rebuildTrialUniqueConstraints(trial);compareOriginal(trial,before);
  if(!trial.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='patient_funds'").get().sql.includes('UNIQUE ("branch_id","patient_id")') ||
     !trial.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='material_batch'").get().sql.includes('UNIQUE ("branch_id","material_id","batch_no")'))throw new Error('门店唯一约束未按候选方案重建');
  const oldVisits=trial.prepare('SELECT count(*) n FROM visit WHERE branch_id IS NOT NULL').get().n;
  const oldHealth=trial.prepare('SELECT count(*) n FROM health_version WHERE source_visit_id IS NOT NULL').get().n;
  if(oldVisits || oldHealth) throw new Error('旧记录来源不应自动赋值');
  for(const [table,column] of fields){
   const matches=trial.prepare(`PRAGMA table_info(${quote(table)})`).all().filter(c=>c.name===column);
   if(matches.length!==1||matches[0].notnull!==0)throw new Error('候选字段缺失或意外非空：'+table+'.'+column);
   if(trial.prepare(`SELECT count(*) n FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`).get().n)throw new Error('旧记录被自动分配门店：'+table+'.'+column);
  }
  return {originalTables:Object.keys(before.tableData).length, originalRecords:Object.values(before.tableData).reduce((n,t)=>n+t.count,0), checkedObjects:before.objects.length,candidateBranchFields:fields.length, rollbackVerified:true,uniqueConstraintTrialVerified:true,trialVerified:true};
 } finally { trial.close(); }
}
module.exports={verifySerialized,cloneInMemory,snapshot,compareOriginal};
