'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {openDatabase,VERSION:OLD_VERSION}=require('../src/v2/database');
const {upgradePatientIdentity,VERSION}=require('../src/v2/patient-identity-migration');
const {createBundle,verifyBundle}=require('../scripts/lib/v2-backup');
const {verifySerialized}=require('../scripts/lib/chain-trial-verification');
function fixture(t){const dir=fs.mkdtempSync(path.join(__dirname,'identity-migration-tmp-')),file=path.join(dir,'clinic.db');
 t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(__dirname)+path.sep+'identity-migration-tmp-'))throw Error('测试目录不符');fs.rmSync(dir,{recursive:true,force:true});});
 const db=openDatabase(file);return {dir,file,db};}
test('身份迁移备份旧库，保留患者数据并支持重新打开',t=>{
 const {file,db}=fixture(t);let migrated;
 try{const before=db.prepare('SELECT COUNT(*) n FROM patient').get().n;migrated=upgradePatientIdentity(db,file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);assert.equal(db.prepare('SELECT COUNT(*) n FROM patient').get().n,before);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get());
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.throws(()=>upgradePatientIdentity(db,file),/不匹配/);
  const backup=new DatabaseSync(migrated.backup,{readOnly:true});try{assert.equal(backup.prepare('PRAGMA user_version').get().user_version,OLD_VERSION);assert.equal(backup.prepare('SELECT COUNT(*) n FROM patient').get().n,before);assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='patient_verified_identity'").get(),undefined);}finally{backup.close();}
 }finally{db.close();}
 const reopened=openDatabase(file);try{assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,VERSION);}finally{reopened.close();}
});
test('结构冲突时回滚迁移且保留备份',t=>{
 const {file,db,dir}=fixture(t);try{
  db.exec('CREATE INDEX patient_identity_patient ON patient(id)');
  assert.throws(()=>upgradePatientIdentity(db,file),/already exists/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,OLD_VERSION);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get(),undefined);
  assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(x=>x.startsWith('before-patient-identity-')).length,1);
 }finally{db.close();}
});
test('身份升级后的单店库可备份并进入连锁结构与回滚试验',async t=>{
 const {file,db,dir}=fixture(t);upgradePatientIdentity(db,file);db.close();
 const bundle=await createBundle({source:file,outputDir:path.join(dir,'bundles')});assert.equal(bundle.schemaVersion,VERSION);assert.equal(bundle.tables,113);
 assert.equal(verifyBundle(bundle.directory).schemaVersion,VERSION);
 const result=verifySerialized(fs.readFileSync(path.join(bundle.directory,'clinic-v2.db')));assert.equal(result.originalTables,113);assert.equal(result.rollbackVerified,true);assert.equal(result.uniqueConstraintTrialVerified,true);
});
