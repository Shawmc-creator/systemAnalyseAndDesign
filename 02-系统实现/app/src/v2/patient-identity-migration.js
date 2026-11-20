'use strict';
// Explicit migration of the recognized single-store database. It never runs
// on a chain demo snapshot and does not enable an identity provider.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {VERSION:QUOTE_VERSION}=require('./quote-schema');
const {PATIENT_IDENTITY_SQL,PATIENT_IDENTITY_TRIGGERS}=require('./patient-identity-schema-trial');
const VERSION=2026111601,APPLICATION=0x51484432;
function upgradePatientIdentity(db,filename){
 const files=db.prepare('PRAGMA database_list').all(),main=files.find(x=>x.name==='main');
 if(db.isTransaction||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1||files.some(x=>!['main','temp'].includes(x.name)))throw Error('身份迁移需要启用外键且没有活动事务的独立数据库');
 if(!main||!main.file||typeof filename!=='string'||path.resolve(main.file).toLowerCase()!==path.resolve(filename).toLowerCase())throw Error('身份迁移需要明确指定已打开的磁盘数据库');
 const count=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
 if(db.prepare('PRAGMA application_id').get().application_id!==APPLICATION||db.prepare('PRAGMA user_version').get().user_version!==QUOTE_VERSION||count!==112||db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('patient_verified_identity','chain_demo_snapshot_meta')").get())throw Error('数据库版本或用途不匹配，拒绝身份迁移');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('数据库完整性检查失败，拒绝身份迁移');
 const directory=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(directory,{recursive:true});
 const backup=path.join(directory,'before-patient-identity-'+Date.now()+'-'+crypto.randomUUID()+'.db');db.prepare('VACUUM INTO ?').run(backup);
 db.exec('BEGIN IMMEDIATE');try{db.exec(PATIENT_IDENTITY_SQL+PATIENT_IDENTITY_TRIGGERS);db.exec(`PRAGMA user_version=${VERSION}`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('身份迁移后外键检查失败');db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 return {backup,version:VERSION};
}
module.exports={upgradePatientIdentity,VERSION};
