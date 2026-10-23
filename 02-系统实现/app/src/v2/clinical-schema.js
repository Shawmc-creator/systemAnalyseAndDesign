'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonical,hash}=require('./common');
const VERSION=20261023;

function upgradeClinical(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version===VERSION)return;
 if(version!==20261022)throw new Error('不支持此数据库版本，未执行诊疗对齐升级');
 // Validate existing signatures before inferring their original selected review. Never rewrite their hash or clinical text.
 const signed=db.prepare("SELECT * FROM clinical_record WHERE status='已签署'").all();
 const {legacySignaturePayload}=require('./clinical-gates');
 for(const record of signed){
  const payload=legacySignaturePayload(db,record);
  if(!payload.healthReviews.length||hash(canonical(payload))!==record.content_hash)throw new Error('原病历签署校验未通过，请先核实原记录；未修改数据库');
 }
 if(filename!==':memory:'&&backupNeeded){
  const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});
  db.prepare('VACUUM INTO ?').run(path.join(folder,'before-clinical-'+Date.now()+'-'+crypto.randomUUID()+'.db'));
 }
 db.exec('BEGIN IMMEDIATE');
 try{
  const terminalSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='tr_clinical_record_terminal_frozen_update'").get().sql;
  db.exec(`ALTER TABLE clinical_record ADD COLUMN signed_health_review_id INTEGER REFERENCES health_review(id);
   ALTER TABLE decision_plan_item ADD COLUMN scope_quantity INTEGER CHECK(scope_quantity IS NULL OR scope_quantity>0);
   DROP TRIGGER tr_clinical_record_terminal_frozen_update;`);
  // Old code ended visits at signature time. Only the separately recorded resource release is evidence of actual end.
  // Keep existing legacy visit facts intact; new commands use the corrected rule. Do not fabricate historical end times.
  for(const record of signed){
   const last=db.prepare('SELECT id FROM health_review WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(record.visit_id);
   db.prepare('UPDATE clinical_record SET signed_health_review_id=? WHERE id=?').run(last.id,record.id);
  }
  db.exec(`${terminalSql};
   DROP TRIGGER tr_visit_visit_end_unsigned_insert;
   DROP TRIGGER tr_visit_visit_end_unsigned_update;
   CREATE TRIGGER clinical_signature_review_insert BEFORE INSERT ON clinical_record
    WHEN (NEW.status='已签署' AND NOT EXISTS(SELECT 1 FROM health_review WHERE id=NEW.signed_health_review_id AND visit_id=NEW.visit_id))
     OR (NEW.status='草稿' AND (NEW.signed_health_review_id IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.signed_by IS NOT NULL OR NEW.signed_revision IS NOT NULL OR NEW.content_hash IS NOT NULL))
    BEGIN SELECT RAISE(ABORT,'signature_review_context'); END;
   CREATE TRIGGER clinical_signature_review_update BEFORE UPDATE ON clinical_record
    WHEN (NEW.status='已签署' AND NOT EXISTS(SELECT 1 FROM health_review WHERE id=NEW.signed_health_review_id AND visit_id=NEW.visit_id))
     OR (NEW.status='草稿' AND (NEW.signed_health_review_id IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.signed_by IS NOT NULL OR NEW.signed_revision IS NOT NULL OR NEW.content_hash IS NOT NULL))
    BEGIN SELECT RAISE(ABORT,'signature_review_context'); END;
   CREATE TRIGGER visit_actual_end_update BEFORE UPDATE ON visit WHEN
    (NEW.status='候诊' AND (NEW.started_at IS NOT NULL OR NEW.ended_at IS NOT NULL)) OR
    (NEW.status='接诊中' AND (NEW.started_at IS NULL OR NEW.ended_at IS NOT NULL)) OR
    (NEW.status='诊疗结束' AND (OLD.status<>'诊疗结束' OR NEW.ended_at IS NOT OLD.ended_at) AND NOT EXISTS(SELECT 1 FROM resource_occupancy o
      WHERE o.visit_id=NEW.id AND o.released_at=NEW.ended_at AND o.release_reason='实际操作结束，转清洁核验'))
    BEGIN SELECT RAISE(ABORT,'actual_end_required'); END;
   CREATE TRIGGER decision_quantity_insert BEFORE INSERT ON decision_plan_item
    WHEN NEW.scope_quantity>(SELECT planned_quantity FROM plan_item WHERE id=NEW.plan_item_id)
    BEGIN SELECT RAISE(ABORT,'consent_quantity'); END;
   PRAGMA user_version=${VERSION};`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('诊疗对齐外键检查未通过');
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
module.exports={VERSION,upgradeClinical};
