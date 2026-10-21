'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {utc}=require('./common');
const VERSION=20261021;
const denominator="CASE quantity_scale WHEN 0 THEN 1 WHEN 1 THEN 10 WHEN 2 THEN 100 WHEN 3 THEN 1000 WHEN 4 THEN 10000 WHEN 5 THEN 100000 ELSE 1000000 END";
function extended(sql,table,columns,constraint){let result=sql.replace(new RegExp('CREATE TABLE "?'+table+'"?','i'),'CREATE TABLE '+table+'_new');if(columns)result=result.replace('(','('+columns+',');return result.replace(/\)\s*STRICT\s*;?\s*$/i,','+constraint+') STRICT');}
function rebuild(db,table,sql){const sequence=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq;const columns=db.prepare('PRAGMA table_info("'+table+'")').all().map(c=>'"'+c.name+'"').join(',');db.exec(sql);db.exec(`INSERT INTO ${table}_new(${columns}) SELECT ${columns} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table};`);if(sequence!=null){db.prepare('INSERT INTO sqlite_sequence(name,seq) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)').run(table,sequence,table);db.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?').run(sequence,table);}}
function upgradePharmacy(db,filename,backupNeeded=true){
 const old=db.prepare('PRAGMA user_version').get().user_version;if(old===VERSION)return;if(old!==20261020)throw new Error('不支持此数据库版本，未执行药学升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-pharmacy-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
 const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('bill_item','inventory_movement','access_role') AND sql IS NOT NULL").all();
 let billSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bill_item'").get().sql;
 let movementSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_movement'").get().sql;
 billSql=billSql.replace(/("treatment_execution_id"\s+INTEGER)\s+NOT NULL/i,'$1');
 billSql=extended(billSql,'bill_item',`dispense_record_id INTEGER UNIQUE REFERENCES dispense_record(id),quantity_scale INTEGER NOT NULL DEFAULT 0 CHECK(quantity_scale BETWEEN 0 AND 6),amount_cents INTEGER GENERATED ALWAYS AS ((quantity*unit_price_cents+(${denominator})/2)/(${denominator})) STORED`,`CHECK((treatment_execution_id IS NOT NULL)+(dispense_record_id IS NOT NULL)=1)`);
 movementSql=extended(movementSql.replace("'退供'))","'退供','发药'))"),'inventory_movement','',"CHECK(movement_type<>'发药' OR delta_scaled<0)");
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try{
  for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
  db.exec(`ALTER TABLE material ADD COLUMN billing_service_id INTEGER REFERENCES service(id);
   ALTER TABLE prescription_item ADD COLUMN billing_service_id INTEGER REFERENCES service(id);
   ALTER TABLE prescription ADD COLUMN reviewed_at TEXT;
   CREATE TABLE dispense_record(id INTEGER PRIMARY KEY AUTOINCREMENT,prescription_item_id INTEGER NOT NULL REFERENCES prescription_item(id),
    inventory_movement_id INTEGER NOT NULL UNIQUE REFERENCES inventory_movement(id),quantity_scaled INTEGER NOT NULL CHECK(quantity_scaled BETWEEN 1 AND 9007199254740991),
    dispensed_at TEXT NOT NULL,operator_id INTEGER NOT NULL REFERENCES staff(id),guidance_note TEXT NOT NULL CHECK(length(trim(guidance_note))>0),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision=1)) STRICT;`);
  rebuild(db,'bill_item',billSql);rebuild(db,'inventory_movement',movementSql);
  const roleSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_role'").get().sql.replace(/CREATE TABLE "?access_role"?/i,'CREATE TABLE access_role_new').replace("'manager'))","'manager','pharmacist'))");rebuild(db,'access_role',roleSql);
  for(const index of indexes)db.exec(index.sql);
  for(const t of triggers){
   if(t.name==='prescription_sealed')continue;
   let sql=t.sql.replace(/quantity\s*\*\s*unit_price_cents/g,'amount_cents');
   if(/^tr_bill_item_bill_(execution_patient|price_source)_(insert|update)$/.test(t.name))sql=sql.replace(' WHEN (',' WHEN NEW.treatment_execution_id IS NOT NULL AND (');
   db.exec(sql);
  }
  db.exec(`CREATE TRIGGER prescription_sealed BEFORE UPDATE ON prescription WHEN OLD.status<>'草稿' AND (
   OLD.status='已作废' OR NEW.collection_route IS NOT OLD.collection_route OR NEW.issued_at IS NOT OLD.issued_at OR NEW.diagnosis IS NOT OLD.diagnosis
   OR NEW.guidance_note IS NOT OLD.guidance_note OR NEW.health_review_id IS NOT OLD.health_review_id OR NEW.patient_name IS NOT OLD.patient_name
   OR NEW.patient_no IS NOT OLD.patient_no OR NEW.prescriber_name IS NOT OLD.prescriber_name OR NEW.birth_date IS NOT OLD.birth_date OR NEW.content_hash IS NOT OLD.content_hash
   OR (OLD.collection_route='院外' AND (NEW.status<>'已作废' OR NEW.review_status IS NOT OLD.review_status OR NEW.review_note IS NOT OLD.review_note OR NEW.reviewer_id IS NOT OLD.reviewer_id))
   OR (OLD.collection_route='院内' AND NEW.status<>'已作废' AND NOT
    ((OLD.review_status='院内待审' AND NEW.review_status IN ('已通过','待医师处理')) OR (OLD.review_status='已通过' AND NEW.review_status='待医师处理') OR (OLD.review_status='待医师处理' AND NEW.review_status='院内待审')
     OR (NEW.review_status IS OLD.review_status AND NEW.reviewer_id IS OLD.reviewer_id AND NEW.review_note IS OLD.review_note AND NEW.reviewed_at IS OLD.reviewed_at))))
   BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
   CREATE TRIGGER dispense_record_frozen_update BEFORE UPDATE ON dispense_record BEGIN SELECT RAISE(ABORT,'dispense_frozen'); END;
   CREATE TRIGGER dispense_record_frozen_delete BEFORE DELETE ON dispense_record BEGIN SELECT RAISE(ABORT,'dispense_frozen'); END;
   CREATE TRIGGER dispense_quantity BEFORE INSERT ON dispense_record WHEN NEW.quantity_scaled+COALESCE((SELECT sum(quantity_scaled) FROM dispense_record WHERE prescription_item_id=NEW.prescription_item_id),0)>(SELECT quantity_scaled FROM prescription_item WHERE id=NEW.prescription_item_id)
    BEGIN SELECT RAISE(ABORT,'dispense_quantity'); END;
   CREATE TRIGGER dispense_context BEFORE INSERT ON dispense_record WHEN NOT EXISTS(
    SELECT 1 FROM prescription_item i JOIN prescription p ON p.id=i.prescription_id JOIN inventory_movement m ON m.id=NEW.inventory_movement_id
    JOIN batch_stock s ON s.id=m.batch_stock_id JOIN material_batch b ON b.id=s.material_batch_id WHERE i.id=NEW.prescription_item_id AND p.status='已开立'
    AND p.collection_route='院内' AND p.review_status='已通过' AND p.reviewer_id<>p.prescriber_id AND m.movement_type='发药' AND m.delta_scaled=-NEW.quantity_scaled
    AND b.material_id=i.material_id AND m.occurred_at=NEW.dispensed_at AND m.operator_id=NEW.operator_id)
    BEGIN SELECT RAISE(ABORT,'dispense_context'); END;
   CREATE TRIGGER bill_dispense_owner BEFORE UPDATE ON bill_item WHEN NEW.dispense_record_id IS NOT OLD.dispense_record_id OR NEW.quantity_scale IS NOT OLD.quantity_scale
    BEGIN SELECT RAISE(ABORT,'immutable_ownership'); END;
   CREATE TRIGGER bill_dispense_source_insert BEFORE INSERT ON bill_item WHEN NEW.dispense_record_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id JOIN prescription p ON p.id=i.prescription_id JOIN bill b ON b.id=NEW.bill_id
    WHERE d.id=NEW.dispense_record_id AND p.patient_id=b.patient_id AND d.quantity_scaled=NEW.quantity AND i.quantity_scale=NEW.quantity_scale AND d.dispensed_at=NEW.priced_at)
    BEGIN SELECT RAISE(ABORT,'dispense_context'); END;
   CREATE TRIGGER bill_dispense_price_insert BEFORE INSERT ON bill_item WHEN NEW.dispense_record_id IS NOT NULL AND NEW.service_price_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id JOIN service_price x ON x.id=NEW.service_price_id
    WHERE d.id=NEW.dispense_record_id AND x.service_id=i.billing_service_id AND x.valid_from<=NEW.priced_at AND (x.valid_until IS NULL OR NEW.priced_at<x.valid_until)
    AND x.status IN ('已确认可适用','不再用于新计费') AND (NEW.pricing_status<>'已核价' OR NEW.unit_price_cents=x.unit_price_cents))
    BEGIN SELECT RAISE(ABORT,'bill_price_source'); END;
   CREATE TRIGGER bill_dispense_price_update BEFORE UPDATE ON bill_item WHEN NEW.dispense_record_id IS NOT NULL AND NEW.service_price_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM dispense_record d JOIN prescription_item i ON i.id=d.prescription_item_id JOIN service_price x ON x.id=NEW.service_price_id
    WHERE d.id=NEW.dispense_record_id AND x.service_id=i.billing_service_id AND x.valid_from<=NEW.priced_at AND (x.valid_until IS NULL OR NEW.priced_at<x.valid_until)
    AND x.status IN ('已确认可适用','不再用于新计费') AND (NEW.pricing_status<>'已核价' OR NEW.unit_price_cents=x.unit_price_cents))
    BEGIN SELECT RAISE(ABORT,'bill_price_source'); END;`);
  const now=utc(new Date());db.prepare("INSERT INTO access_role(code,name,description,created_at) VALUES('pharmacist','药学岗位','经核实资质后授予；不自动继承助理权限',?)").run(now);
  for(const [code,name,roles]of [['pharmacy.manage','核实药学岗位资格',['manager']],['pharmacy.management','查阅机构条件和药学资格',['manager']],['pharmacy.query','查阅院内待审处方及实际发药',['pharmacist']],['pharmacy.review','院内审方及退回医师处理',['pharmacist']],['pharmacy.dispense','实际发药及库存收费交接',['pharmacist']]]){
   const pid=Number(db.prepare('INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES(?,?,?,?,?,1)').run(code,'现行UC-25',name,code.endsWith('query')||code.endsWith('management')?'查询':'业务写入','机构条件及有效药学资格；原处方与实际批次').lastInsertRowid);
   for(const role of roles)db.prepare('INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT id,?,1,? FROM access_role WHERE code=?').run(pid,now,role);
  }
  db.prepare("INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,? FROM access_role r,access_permission p WHERE r.code='pharmacist' AND p.code='ops.request.query'").run(now);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('药学升级后外键检查失败');
  db.exec('PRAGMA user_version='+VERSION+'; COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
}
module.exports={VERSION,upgradePharmacy};
