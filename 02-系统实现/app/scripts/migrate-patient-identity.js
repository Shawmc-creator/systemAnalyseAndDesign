'use strict';
// Run explicitly on a recognized, stopped single-store database; never on a demo snapshot.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {openDatabase}=require('../src/v2/database');
const {upgradePatientIdentity}=require('../src/v2/patient-identity-migration');
const {VERSION:QUOTE_VERSION}=require('../src/v2/quote-schema');
const filename=process.argv[2];
if(!filename||!path.isAbsolute(filename)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){
 console.error('请提供已存在的新版 SQLite 数据库绝对路径；先停止使用该数据库的服务。');process.exitCode=1;
}else{
 let db;try{const check=new DatabaseSync(filename,{readOnly:true});try{
  if(check.prepare('PRAGMA application_id').get().application_id!==0x51484432||check.prepare('PRAGMA user_version').get().user_version!==QUOTE_VERSION||check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n!==112||check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chain_demo_snapshot_meta'").get())throw Error('只支持已确认的 112 表单店数据库');
 }finally{check.close();}db=openDatabase(filename);const result=upgradePatientIdentity(db,filename);console.log('身份关联结构升级完成，备份：'+result.backup);}
 catch(error){console.error('未完成身份关联迁移：'+error.message);process.exitCode=1;}
 finally{if(db)db.close();}
}
