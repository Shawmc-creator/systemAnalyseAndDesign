'use strict';
const {DatabaseSync}=require('node:sqlite');
const PATIENT_IDENTITY_SQL=`CREATE TABLE patient_verified_identity(
 id INTEGER PRIMARY KEY,
 patient_id INTEGER NOT NULL REFERENCES patient(id),
 issuer TEXT NOT NULL CHECK(length(trim(issuer)) BETWEEN 1 AND 200),
 subject_hash TEXT NOT NULL CHECK(length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
 verified_by INTEGER NOT NULL REFERENCES staff(id),
 verification_basis TEXT NOT NULL CHECK(length(trim(verification_basis)) BETWEEN 1 AND 1000),
 verified_at TEXT NOT NULL CHECK(length(verified_at)=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',verified_at,'+0 seconds') IS verified_at),
 revoked_at TEXT CHECK(revoked_at IS NULL OR (length(revoked_at)=20 AND strftime('%Y-%m-%dT%H:%M:%SZ',revoked_at,'+0 seconds') IS revoked_at AND revoked_at>=verified_at)),
 revoked_by INTEGER REFERENCES staff(id),
 revocation_reason TEXT,
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
       (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(trim(revocation_reason))>0))
 ) STRICT;
 CREATE UNIQUE INDEX patient_identity_active_subject ON patient_verified_identity(issuer,subject_hash) WHERE revoked_at IS NULL;
 CREATE INDEX patient_identity_patient ON patient_verified_identity(patient_id);`;
const PATIENT_IDENTITY_TRIGGERS=`
 CREATE TRIGGER patient_identity_immutable BEFORE UPDATE ON patient_verified_identity
 WHEN NEW.id IS NOT OLD.id OR NEW.patient_id IS NOT OLD.patient_id OR NEW.issuer IS NOT OLD.issuer
 OR NEW.subject_hash IS NOT OLD.subject_hash OR NEW.verified_by IS NOT OLD.verified_by
 OR NEW.verification_basis IS NOT OLD.verification_basis OR NEW.verified_at IS NOT OLD.verified_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 BEGIN SELECT RAISE(ABORT,'patient_identity_frozen'); END;
 CREATE TRIGGER patient_identity_no_delete BEFORE DELETE ON patient_verified_identity
 BEGIN SELECT RAISE(ABORT,'patient_identity_frozen'); END;`;
// Candidate schema for isolated in-memory verification only. No clinic or
// persistent demonstration database is modified by this installer.
function installPatientIdentityTrial(db){
 const files=db.prepare('PRAGMA database_list').all();
 if(files.some(x=>!['main','temp'].includes(x.name)||x.file!=='')||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1||db.isTransaction)
  throw Error('患者身份结构试验只允许启用外键的独立内存数据库');
 db.exec(PATIENT_IDENTITY_SQL+PATIENT_IDENTITY_TRIGGERS);
}
// Upgrade the serialized chain demonstration only after it has been restored
// into the isolated in-memory database. Never open or alter a clinic database.
function ensurePatientIdentityTrial(db){
 const files=db.prepare('PRAGMA database_list').all();
 if(files.some(x=>!['main','temp'].includes(x.name)||x.file!=='')||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1||db.isTransaction)
  throw Error('患者身份结构试验只允许启用外键的独立内存数据库');
 const found=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get();
 if(!found){installPatientIdentityTrial(db);return true;}
 const columns=db.prepare('PRAGMA table_info(patient_verified_identity)').all().map(x=>x.name).join(',');
 const expected='id,patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at,revoked_at,revoked_by,revocation_reason';
 const indexes=db.prepare('PRAGMA index_list(patient_verified_identity)').all();
 const active=indexes.find(x=>x.name==='patient_identity_active_subject');
 const activeSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='patient_identity_active_subject'").get()?.sql||'';
 const refs=db.prepare('PRAGMA foreign_key_list(patient_verified_identity)').all();
 const expectedDb=new DatabaseSync(':memory:');let expectedSql,expectedTriggers;
 try{expectedDb.exec('PRAGMA foreign_keys=ON; CREATE TABLE patient(id INTEGER PRIMARY KEY); CREATE TABLE staff(id INTEGER PRIMARY KEY)');installPatientIdentityTrial(expectedDb);
  expectedSql=expectedDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get().sql;
  expectedTriggers=expectedDb.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='patient_verified_identity' ORDER BY name").all();
 }finally{expectedDb.close();}
 const normalize=sql=>sql.replace(/\s+/g,' ').trim().toLowerCase();
 if(columns!==expected||!active||active.unique!==1||active.partial!==1||!indexes.some(x=>x.name==='patient_identity_patient')||
    !/ON\s+patient_verified_identity\s*\(issuer\s*,\s*subject_hash\)\s+WHERE\s+revoked_at\s+IS\s+NULL/i.test(activeSql)||
    !refs.some(x=>x.from==='patient_id'&&x.table==='patient')||!refs.some(x=>x.from==='verified_by'&&x.table==='staff')||!refs.some(x=>x.from==='revoked_by'&&x.table==='staff')||
    normalize(found.sql)!==normalize(expectedSql))throw Error('演示患者身份结构不兼容，拒绝迁移');
 const actual=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='patient_verified_identity' AND name IN ('patient_identity_immutable','patient_identity_no_delete') ORDER BY name").all();
 if(actual.some(x=>!expectedTriggers.some(y=>y.name===x.name&&normalize(y.sql)===normalize(x.sql))))throw Error('演示患者身份保护结构不兼容，拒绝迁移');
 if(actual.length===expectedTriggers.length)return false;
 db.exec('BEGIN IMMEDIATE');try{for(const trigger of expectedTriggers)if(!actual.some(x=>x.name===trigger.name))db.exec(trigger.sql);db.exec('COMMIT');}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
 return true;
}
module.exports={installPatientIdentityTrial,ensurePatientIdentityTrial,PATIENT_IDENTITY_SQL,PATIENT_IDENTITY_TRIGGERS};
