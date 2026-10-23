'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {rebuild}=require('./payment-prescription-schema');
const VERSION=2026102305;
const TABLES=['insurance_identity','insurance_case','insurance_fee','insurance_settlement','insurance_reversal'];
function change(sql,a,b){if(!sql.includes(a))throw new Error('医保升级前结构不匹配：'+a);return sql.replace(a,b);}
function checked(sql,checks){return sql.replace(/\)\s*STRICT\s*$/i,','+checks.join(',')+') STRICT');}
function upgradeInsuranceAlignment(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version===VERSION)return;
 if(version!==2026102304||db.isTransaction)throw new Error('不支持此数据库版本或事务状态，未执行医保升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-insurance-alignment-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 // Never manufacture a historical request or result operator to satisfy a new constraint.
 if(db.prepare('SELECT id FROM insurance_fee WHERE preestimate_request_id IS NULL UNION ALL SELECT id FROM insurance_settlement WHERE preestimate_request_id IS NULL LIMIT 1').get())throw new Error('医保历史缺少确切原提交依据，原库未改动；请先核实历史原单再升级');
 for(const r of db.prepare('SELECT * FROM insurance_reversal').all()){
  const approval=db.prepare("SELECT a.staff_id FROM operation_audit a JOIN access_permission p ON p.id=a.permission_id WHERE a.object_kind='insurance_reversal' AND a.object_key=? AND a.event_type='变更' AND a.after_revision=1 AND p.code='insurance.manage'").get(String(r.id));
  const verification=db.prepare("SELECT staff_id FROM operation_audit WHERE object_kind='insurance_reversal' AND object_key=? AND event_type='变更' AND after_revision=?").get(String(r.id),r.revision);
  if(!approval||approval.staff_id!==r.operator_id||(['已成功','已失败'].includes(r.status)&&(!verification||!r.verified_at)))throw new Error('医保撤销历史缺少负责人批准或最终核实人依据，原库未改动');
 }
 const schema=Object.fromEntries(TABLES.map(t=>[t,db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t).sql]));
 schema.insurance_identity=checked(change(change(schema.insurance_identity,'insured_person_no TEXT NOT NULL','insured_person_no TEXT'),'valid_until TEXT NOT NULL','valid_until TEXT'),["CHECK(status<>'核验通过' OR (insured_person_no IS NOT NULL AND length(trim(insured_person_no))>0 AND valid_until IS NOT NULL))"]);
 schema.insurance_case=change(schema.insurance_case,'result_note TEXT NOT NULL','result_note TEXT');
 schema.insurance_case=change(schema.insurance_case,'id INTEGER PRIMARY KEY AUTOINCREMENT,','id INTEGER PRIMARY KEY AUTOINCREMENT,previous_case_id INTEGER REFERENCES insurance_case(id),');
 schema.insurance_fee=change(change(change(schema.insurance_fee,'mapping_id INTEGER NOT NULL','mapping_id INTEGER'),'preestimate_request_id INTEGER REFERENCES','preestimate_request_id INTEGER NOT NULL REFERENCES'),'UNIQUE(insurance_case_id,bill_item_id)','UNIQUE(preestimate_request_id,bill_item_id)');
 schema.insurance_fee=change(schema.insurance_fee,'id INTEGER PRIMARY KEY AUTOINCREMENT,','id INTEGER PRIMARY KEY AUTOINCREMENT,is_self_pay INTEGER NOT NULL CHECK(is_self_pay IN (0,1)),insurance_code_snapshot TEXT,fee_revision INTEGER NOT NULL CHECK(fee_revision>0),');
 schema.insurance_fee=checked(schema.insurance_fee,["CHECK((is_self_pay=1 AND mapping_id IS NULL AND insurance_code_snapshot IS NULL) OR (is_self_pay=0 AND mapping_id IS NOT NULL AND insurance_code_snapshot IS NOT NULL AND length(trim(insurance_code_snapshot))>0))"]);
 schema.insurance_settlement=change(schema.insurance_settlement,'preestimate_request_id INTEGER REFERENCES','preestimate_request_id INTEGER NOT NULL REFERENCES');
 schema.insurance_reversal=change(schema.insurance_reversal,'fee_request_id INTEGER NOT NULL','fee_request_id INTEGER');
 schema.insurance_reversal=change(schema.insurance_reversal,'id INTEGER PRIMARY KEY AUTOINCREMENT,','id INTEGER PRIMARY KEY AUTOINCREMENT,approved_by INTEGER NOT NULL REFERENCES staff(id),approved_at TEXT NOT NULL,approval_basis TEXT NOT NULL CHECK(length(trim(approval_basis))>0),verified_by INTEGER REFERENCES staff(id),verification_note TEXT,');
 schema.insurance_reversal=checked(schema.insurance_reversal,["CHECK(status NOT IN ('已成功','已失败') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verification_note IS NOT NULL AND length(trim(verification_note))>0))","CHECK(status<>'已成功' OR (external_reference IS NOT NULL AND length(trim(external_reference))>0))"]);
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all(),indexes=db.prepare("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all().filter(i=>TABLES.includes(i.tbl_name)),fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 db.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE');
 try{
  for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
  rebuild(db,'insurance_identity',schema.insurance_identity);rebuild(db,'insurance_case',schema.insurance_case);
  rebuild(db,'insurance_fee',schema.insurance_fee,{is_self_pay:'0',insurance_code_snapshot:'(SELECT insurance_code FROM insurance_item_mapping WHERE id=insurance_fee.mapping_id)',fee_revision:'(SELECT fee_revision FROM insurance_preestimate_history WHERE id=insurance_fee.preestimate_request_id)'});
  rebuild(db,'insurance_settlement',schema.insurance_settlement);
  rebuild(db,'insurance_reversal',schema.insurance_reversal,{approved_by:'operator_id',approved_at:'created_at',approval_basis:"CASE WHEN instr(result_note,char(10)||'核实结果：')>0 THEN substr(result_note,1,instr(result_note,char(10)||'核实结果：')-1) ELSE result_note END",verified_by:"(SELECT staff_id FROM operation_audit WHERE object_kind='insurance_reversal' AND object_key=CAST(insurance_reversal.id AS TEXT) AND event_type='变更' AND after_revision=insurance_reversal.revision ORDER BY id DESC LIMIT 1)",verification_note:"CASE WHEN status IN ('已成功','已失败') THEN result_note ELSE NULL END"});
  for(const i of indexes)db.exec(i.sql);
  for(const t of triggers){let sql=t.sql;if(t.name==='insurance_reversal_terminal')sql=sql.replace('NEW.fee_request_id<>OLD.fee_request_id','NEW.fee_request_id IS NOT OLD.fee_request_id');db.exec(sql);}
  db.exec(`
   CREATE TRIGGER insurance_contract_fee BEFORE INSERT ON insurance_fee WHEN NOT EXISTS(SELECT 1 FROM insurance_preestimate_history h WHERE h.id=NEW.preestimate_request_id AND h.fee_revision=NEW.fee_revision) OR (NEW.is_self_pay=0 AND NOT EXISTS(SELECT 1 FROM insurance_item_mapping m WHERE m.id=NEW.mapping_id AND m.insurance_code=NEW.insurance_code_snapshot AND m.status='有效')) BEGIN SELECT RAISE(ABORT,'insurance_contract_context'); END;
   CREATE TRIGGER insurance_contract_previous BEFORE INSERT ON insurance_case WHEN NEW.previous_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM insurance_case c WHERE c.id=NEW.previous_case_id AND c.patient_id=NEW.patient_id AND c.visit_id=NEW.visit_id AND c.status='已撤销' AND NOT EXISTS(SELECT 1 FROM insurance_settlement s WHERE s.insurance_case_id=c.id AND s.status='有效')) BEGIN SELECT RAISE(ABORT,'insurance_contract_context'); END;
   CREATE TRIGGER insurance_contract_case_origin BEFORE UPDATE ON insurance_case WHEN NEW.previous_case_id IS NOT OLD.previous_case_id OR NEW.patient_id IS NOT OLD.patient_id OR NEW.visit_id IS NOT OLD.visit_id OR NEW.business_no IS NOT OLD.business_no OR NEW.institution_code IS NOT OLD.institution_code BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;
   CREATE TRIGGER insurance_contract_reversal_initial BEFORE INSERT ON insurance_reversal WHEN NEW.status<>'待办理' OR NEW.approved_by<>NEW.operator_id OR NEW.approved_at<>NEW.created_at OR NEW.verified_by IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.verification_note IS NOT NULL OR NOT EXISTS(SELECT 1 FROM insurance_settlement WHERE id=NEW.settlement_id AND status='有效') OR (NEW.fee_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fee_request f JOIN insurance_settlement s ON s.id=NEW.settlement_id JOIN insurance_case c ON c.id=s.insurance_case_id WHERE f.id=NEW.fee_request_id AND f.bill_id=c.bill_id AND f.status='已同意')) BEGIN SELECT RAISE(ABORT,'insurance_contract_context'); END;
   CREATE TRIGGER insurance_contract_approval_frozen BEFORE UPDATE ON insurance_reversal WHEN NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approval_basis IS NOT OLD.approval_basis OR NEW.operator_id IS NOT OLD.operator_id BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;
   CREATE TRIGGER insurance_mapping_snapshot_frozen BEFORE UPDATE ON insurance_item_mapping WHEN EXISTS(SELECT 1 FROM insurance_fee WHERE mapping_id=OLD.id) AND (NEW.insurance_code IS NOT OLD.insurance_code OR NEW.service_id IS NOT OLD.service_id OR NEW.material_id IS NOT OLD.material_id OR NEW.insured_area IS NOT OLD.insured_area OR NEW.valid_from IS NOT OLD.valid_from OR NEW.valid_until IS NOT OLD.valid_until) BEGIN SELECT RAISE(ABORT,'immutable_fact'); END;
  `);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('医保升级外键检查失败');
  db.exec('PRAGMA user_version='+VERSION+';COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys='+fk);}
}
module.exports={VERSION,TABLES,upgradeInsuranceAlignment};
