'use strict';
const {cloneInMemory,snapshot,compareOriginal}=require('./chain-trial-verification');
const {checkLegacyAssignments}=require('./chain-preflight');
const {checkRelationships}=require('./chain-relationship-preflight');
const {checkIdentity}=require('./chain-identity-preflight');
const {installTrialSchema}=require('../../src/v2/chain-schema-trial');
const {rebuildTrialUniqueConstraints}=require('../../src/v2/chain-unique-trial');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function trialAssignment(bytes,candidate,assignment,{allowListedImmutable=false}={}){
 const db=cloneInMemory(bytes);try{
  const map=checkLegacyAssignments(db,candidate,assignment),relations=checkRelationships(db,assignment);
  if(!map.assignmentComplete||!relations.consistent||!checkIdentity(db).consistent)throw new Error('门店映射不完整或核心关联存在冲突，拒绝赋值试验');
  const before=snapshot(db);installTrialSchema(db,{includeBusinessFields:true});rebuildTrialUniqueConstraints(db);compareOriginal(db,before);
  const entries=[];for(const row of candidate.rows){if(!['新增门店外键','来源与负责门店'].includes(row.mode))continue;
   const cols=row.mode==='新增门店外键'?[row.field]:row.fields;if(!/^\w+$/.test(row.table)||cols.some(c=>!/^\w+$/.test(c)))throw new Error('候选字段无效');
   for(const [id,values] of Object.entries(assignment.tables[row.table]||{}))entries.push({table:row.table,cols,id:Number(id),values});
  }
  // Only these exact baseline guards are eligible for the isolated transaction.
  // Other triggers remain enabled; unexpected SQL or tables fail closed.
  const policies=[
   {table:'patient_change',suffix:'immutable_fact',when:'((1) AND 1)',code:'immutable_fact'},
   {table:'treatment_execution',suffix:'immutable_fact',when:'((1) AND 1)',code:'immutable_fact'},
   {table:'patient_payment',suffix:'terminal_frozen',when:"((OLD.status IN ('到账已确认','未到账已核实')) AND 1)",code:'terminal_frozen',terminal:true}
  ];
  const guarded=[];if(allowListedImmutable)for(const policy of policies){
   const table=policy.table;if(!entries.some(e=>e.table===table))continue;const name='tr_'+table+'_'+policy.suffix+'_update';
   const expected=`CREATE TRIGGER "${name}" BEFORE UPDATE ON "${table}" WHEN ${policy.when} BEGIN SELECT RAISE(ABORT,'${policy.code}'); END`;
   const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?").get(name,table);
   if(!trigger||trigger.sql!==expected)throw new Error('保护触发器与已核对基线不一致：'+name);
   guarded.push({...policy,name,sql:trigger.sql});
  }
  const apply=(failAfter)=>{db.exec('BEGIN IMMEDIATE');try{
   for(const trigger of guarded)db.exec('DROP TRIGGER '+quote(trigger.name));
   db.prepare("INSERT INTO clinic_chain(id,name) VALUES(1,'仅供迁移试验的连锁')").run();
   for(const branch of assignment.branchIds)db.prepare("INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(?,1,?,?)").run(branch,'TRIAL-'+branch,'试验门店 '+branch);
   for(let i=0;i<entries.length;i++){const e=entries[i];let result;try{result=db.prepare(`UPDATE ${quote(e.table)} SET ${e.cols.map(c=>quote(c)+'=?').join(',')} WHERE id=?`).run(...e.cols.map(c=>e.values[c]),e.id);}catch(error){throw new Error('门店赋值被现有数据库约束拒绝：'+e.table+'（'+error.message+'）');}if(result.changes!==1)throw new Error('门店赋值未找到唯一记录：'+e.table);
    if(failAfter===i+1)throw new Error('模拟赋值失败');}
   if(failAfter===0)throw new Error('模拟赋值失败');
   for(const trigger of guarded)db.exec(trigger.sql);
   if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('赋值后外键或完整性检查失败');
   compareOriginal(db,before);db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}};
  try{apply(entries.length?1:0);throw new Error('模拟失败未发生');}catch(e){if(e.message!=='模拟赋值失败')throw e;}
  compareOriginal(db,before);if(db.prepare('SELECT COUNT(*) n FROM clinic_branch').get().n!==0)throw new Error('模拟失败后的门店未回滚');
  for(const e of entries){const v=db.prepare(`SELECT ${e.cols.map(quote).join(',')} FROM ${quote(e.table)} WHERE id=?`).get(e.id);if(e.cols.some(c=>v[c]!==null))throw new Error('模拟失败后的门店归属未回滚');}
  apply(null);
  let verifiedGuards=0;for(const trigger of guarded){const eligible=trigger.terminal?db.prepare(`SELECT id FROM ${quote(trigger.table)} WHERE status IN ('到账已确认','未到账已核实') LIMIT 1`).get():entries.find(x=>x.table===trigger.table);if(!eligible)continue;db.exec('SAVEPOINT verify_immutable');let blocked=false;try{db.prepare(`UPDATE ${quote(trigger.table)} SET id=id WHERE id=?`).run(eligible.id);}catch(error){if(error.message!==trigger.code)throw error;blocked=true;}finally{db.exec('ROLLBACK TO verify_immutable; RELEASE verify_immutable');}if(!blocked)throw new Error('历史保护未恢复：'+trigger.table);verifiedGuards++;}
  for(const e of entries){const v=db.prepare(`SELECT ${e.cols.map(quote).join(',')} FROM ${quote(e.table)} WHERE id=?`).get(e.id);if(e.cols.some(c=>v[c]!==e.values[c]))throw new Error('门店赋值结果核对失败');}
  return {assignedRecords:entries.length,assignedTables:new Set(entries.map(e=>e.table)).size,trialBranches:assignment.branchIds.length,rollbackVerified:true,originalFieldsPreserved:true,foreignKeysVerified:true,guardedTriggerRestoreVerified:verifiedGuards,guardedTriggerCount:guarded.length,method:allowListedImmutable?'受限触发器事务试验':'保留触发器直接赋值',notice:'仅在内存使用虚拟门店验证赋值；未产生迁移数据库，不验证映射真实性或系统运行隔离。'};
 }finally{db.close();}
}
module.exports={trialAssignment};
