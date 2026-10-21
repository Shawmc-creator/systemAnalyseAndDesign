'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {utc}=require('./common');
const VERSION=20261020;
const META='created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)';
// The prescription and item tables come from the current core model. Diagnosis,
// guidance and health-review references retain the evidence required by UC-25.
const SQL=`
ALTER TABLE material ADD COLUMN is_drug INTEGER NOT NULL DEFAULT 0 CHECK(is_drug IN (0,1));
CREATE TABLE prescription(
 id INTEGER PRIMARY KEY AUTOINCREMENT,patient_id INTEGER NOT NULL REFERENCES patient(id),visit_id INTEGER NOT NULL REFERENCES visit(id),
 prescriber_id INTEGER NOT NULL REFERENCES staff(id),clinical_record_id INTEGER NOT NULL REFERENCES clinical_record(id),
 collection_route TEXT NOT NULL CHECK(collection_route IN ('院外','院内')),issued_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('草稿','已开立','已作废')),
 review_status TEXT NOT NULL CHECK(review_status IN ('院外取药','院内待审','已通过','待医师处理')),
 reviewer_id INTEGER REFERENCES staff(id),review_note TEXT,diagnosis TEXT NOT NULL,guidance_note TEXT NOT NULL,
 patient_name TEXT NOT NULL,patient_no TEXT NOT NULL,prescriber_name TEXT NOT NULL,birth_date TEXT,
 health_review_id INTEGER REFERENCES health_review(id),content_hash TEXT,voided_at TEXT,void_reason TEXT,
 record_no TEXT NOT NULL UNIQUE,${META},
 CHECK(status='草稿' OR (issued_at IS NOT NULL AND health_review_id IS NOT NULL AND length(content_hash)=64)),
 CHECK((status='已作废')=(voided_at IS NOT NULL)),CHECK(status<>'已作废' OR length(trim(void_reason))>0)
) STRICT;
CREATE TABLE prescription_item(
 id INTEGER PRIMARY KEY AUTOINCREMENT,prescription_id INTEGER NOT NULL REFERENCES prescription(id),material_id INTEGER NOT NULL REFERENCES material(id),
 drug_name TEXT NOT NULL CHECK(length(trim(drug_name))>0),directions TEXT NOT NULL CHECK(length(trim(directions))>0),
 quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled BETWEEN 1 AND 9007199254740991),unit TEXT NOT NULL CHECK(length(trim(unit))>0),
 quantity_scale INTEGER NOT NULL CHECK(quantity_scale BETWEEN 0 AND 6),service_price_id INTEGER REFERENCES service_price(id),
 sequence_no INTEGER NOT NULL CHECK(sequence_no>0),${META},UNIQUE(prescription_id,sequence_no)
) STRICT;
CREATE INDEX prescription_visit ON prescription(visit_id,id);
CREATE TRIGGER prescription_context_insert BEFORE INSERT ON prescription WHEN NOT EXISTS(
 SELECT 1 FROM visit v JOIN clinical_record c ON c.visit_id=v.id WHERE v.id=NEW.visit_id AND v.patient_id=NEW.patient_id AND c.id=NEW.clinical_record_id)
 BEGIN SELECT RAISE(ABORT,'prescription_context'); END;
CREATE TRIGGER prescription_initial BEFORE INSERT ON prescription WHEN NEW.status<>'草稿'
 BEGIN SELECT RAISE(ABORT,'prescription_state'); END;
CREATE TRIGGER prescription_owner BEFORE UPDATE ON prescription WHEN NEW.id IS NOT OLD.id OR NEW.patient_id IS NOT OLD.patient_id
 OR NEW.visit_id IS NOT OLD.visit_id OR NEW.prescriber_id IS NOT OLD.prescriber_id OR NEW.clinical_record_id IS NOT OLD.clinical_record_id OR NEW.record_no IS NOT OLD.record_no
 BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_state BEFORE UPDATE ON prescription WHEN NEW.status<>OLD.status AND NOT
 ((OLD.status='草稿' AND NEW.status='已开立') OR (OLD.status='已开立' AND NEW.status='已作废'))
 BEGIN SELECT RAISE(ABORT,'prescription_state'); END;
CREATE TRIGGER prescription_sealed BEFORE UPDATE ON prescription WHEN OLD.status<>'草稿' AND
 (OLD.status='已作废' OR NEW.status<>'已作废' OR NEW.collection_route IS NOT OLD.collection_route OR NEW.issued_at IS NOT OLD.issued_at
 OR NEW.diagnosis IS NOT OLD.diagnosis OR NEW.guidance_note IS NOT OLD.guidance_note OR NEW.health_review_id IS NOT OLD.health_review_id
 OR NEW.patient_name IS NOT OLD.patient_name OR NEW.patient_no IS NOT OLD.patient_no OR NEW.prescriber_name IS NOT OLD.prescriber_name OR NEW.birth_date IS NOT OLD.birth_date
 OR NEW.content_hash IS NOT OLD.content_hash OR NEW.review_status IS NOT OLD.review_status OR NEW.reviewer_id IS NOT OLD.reviewer_id OR NEW.review_note IS NOT OLD.review_note)
 BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_no_delete BEFORE DELETE ON prescription BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_item_insert BEFORE INSERT ON prescription_item WHEN
 NOT EXISTS(SELECT 1 FROM prescription p WHERE p.id=NEW.prescription_id AND p.status='草稿')
 BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_item_update BEFORE UPDATE ON prescription_item WHEN NEW.id IS NOT OLD.id OR NEW.prescription_id IS NOT OLD.prescription_id OR
 NOT EXISTS(SELECT 1 FROM prescription p WHERE p.id=OLD.prescription_id AND p.status='草稿')
 BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_item_delete BEFORE DELETE ON prescription_item WHEN
 NOT EXISTS(SELECT 1 FROM prescription p WHERE p.id=OLD.prescription_id AND p.status='草稿')
 BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
CREATE TRIGGER prescription_material_units BEFORE UPDATE ON material WHEN
 (NEW.base_unit IS NOT OLD.base_unit OR NEW.quantity_scale IS NOT OLD.quantity_scale OR NEW.is_drug IS NOT OLD.is_drug)
 AND EXISTS(SELECT 1 FROM prescription_item i WHERE i.material_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'prescription_material_frozen'); END;
`;
function upgradePrescriptions(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version===VERSION)return;
 if(version!==20261019)throw new Error('不支持此数据库版本，未执行处方升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-prescriptions-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 db.exec('BEGIN IMMEDIATE');try{
  db.exec(SQL);const now=utc(new Date());
  for(const [code,name]of [['prescriptions.query','查阅本人或明确交接范围的处方'],['prescriptions.write','开立院外处方并记录用药指导']]){
   const id=Number(db.prepare('INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES(?,?,?,?,?,1)').run(code,'现行UC-25',name,code.endsWith('query')?'查询':'业务写入','牙医资格及明确就诊范围').lastInsertRowid);
   db.prepare("INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT id,?,1,? FROM access_role WHERE code='dentist'").run(id,now);
  }
  db.exec('PRAGMA user_version='+VERSION+'; COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
module.exports={VERSION,upgradePrescriptions};
