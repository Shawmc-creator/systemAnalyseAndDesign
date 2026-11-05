'use strict';
// Experimental in-memory table rebuild, not a production migration. Old
// unknown branch values remain nullable; callers must not treat this as full
// branch isolation or enable the original single-store business services.
function rebuildTrialUniqueConstraints(db,{testFailAfterFirst=false}={}){
 const databases=db.prepare('PRAGMA database_list').all();
 if(!databases.some(d=>d.name==='main'&&d.file==='')||databases.some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('唯一约束试验仅允许独立内存数据库');
 if(db.isTransaction||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)throw new Error('唯一约束试验要求外键已开启且无活动事务');
 for(const table of ['patient_funds','material_batch'])if(!db.prepare(`PRAGMA table_info("${table}")`).all().some(c=>c.name==='branch_id'))throw new Error('候选门店字段尚未建立');
 const changes=[['patient_funds','UNIQUE ("patient_id")','UNIQUE ("branch_id","patient_id")'],
  ['material_batch','UNIQUE ("material_id","batch_no")','UNIQUE ("branch_id","material_id","batch_no")']];
 const quote=s=>'"'+s.replaceAll('"','""')+'"';
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name").all();
 db.exec('PRAGMA foreign_keys=OFF');
 try{
  db.exec('BEGIN IMMEDIATE');
  for(const trigger of triggers)db.exec('DROP TRIGGER '+quote(trigger.name));
  for(const [table,oldConstraint,newConstraint] of changes){
   const schema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
   if(!schema||schema.split(oldConstraint).length!==2||!schema.startsWith('CREATE TABLE '+quote(table)))throw new Error('旧唯一约束或建表格式与候选方案不符：'+table);
   const temp='chain_candidate_'+table;
   if(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(temp))throw new Error('候选临时表名已存在');
   const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(table);
   const sequence=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table);
   const next=schema.replace('CREATE TABLE '+quote(table),'CREATE TABLE '+quote(temp)).replace(oldConstraint,newConstraint);
   db.exec(next);
   const columns=db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all().filter(c=>c.hidden===0).map(c=>quote(c.name)).join(',');
   db.exec(`INSERT INTO ${quote(temp)} (${columns}) SELECT ${columns} FROM ${quote(table)}`);
   db.exec(`DROP TABLE ${quote(table)}; ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`);
   for(const index of indexes)db.exec(index.sql);
   if(sequence){db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(table);db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table,sequence.seq);}
   if(testFailAfterFirst)throw new Error('模拟重建失败');
  }
  for(const trigger of triggers)db.exec(trigger.sql);
  if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('重建后外键或完整性检查失败');
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 finally{db.exec('PRAGMA foreign_keys=ON');}
}
module.exports={rebuildTrialUniqueConstraints};
