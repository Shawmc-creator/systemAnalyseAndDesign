'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2026102304;
function tableSql(db,name){return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;}
function replace(sql,from,to){if(!sql.includes(from))throw new Error('升级前结构不匹配，未改写：'+from);return sql.replace(from,to);}
function rebuild(db,table,sql,extra={}){
 const sequence=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq;
 const columns=db.prepare('PRAGMA table_xinfo('+table+')').all().filter(c=>!c.hidden).map(c=>c.name);
 const names=[...columns,...Object.keys(extra)],quoted=names.map(c=>'"'+c+'"').join(',');
 db.exec(sql.replace(new RegExp('CREATE TABLE "?'+table+'"?','i'),'CREATE TABLE '+table+'_new'));
 db.exec(`INSERT INTO ${table}_new(${quoted}) SELECT ${[...columns.map(c=>'"'+c+'"'),...Object.values(extra)].join(',')} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table};`);
 if(sequence!=null){db.prepare('INSERT INTO sqlite_sequence(name,seq) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)').run(table,sequence,table);db.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?').run(sequence,table);}
}
function upgradePaymentPrescription(db,filename,backupNeeded=true){
 const version=db.prepare('PRAGMA user_version').get().user_version;if(version===VERSION)return;
 if(version!==2026102303||db.isTransaction)throw new Error('不支持此数据库版本或事务状态，未执行收付处方升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-payment-prescription-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
 const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('payment_order','payment_reconciliation','prescription') AND sql IS NOT NULL").all();
 let order=replace(tableSql(db,'payment_order'),'bill_id INTEGER NOT NULL REFERENCES bill(id)','patient_funds_id INTEGER NOT NULL REFERENCES patient_funds(id),bill_id INTEGER REFERENCES bill(id)');
 let check=replace(tableSql(db,'payment_reconciliation'),'payment_order_id INTEGER REFERENCES payment_order(id)','patient_payment_id INTEGER REFERENCES patient_payment(id),payment_order_id INTEGER REFERENCES payment_order(id)');
 check=replace(check,'resolution TEXT NOT NULL','resolution TEXT');check=replace(check,'(payment_order_id IS NOT NULL)+(patient_refund_id IS NOT NULL)=1','(patient_payment_id IS NOT NULL)+(payment_order_id IS NOT NULL)+(patient_refund_id IS NOT NULL)=1');
 let rx=replace(tableSql(db,'prescription'),'guidance_note TEXT NOT NULL','guidance_note TEXT');
 rx=replace(rx,'id INTEGER PRIMARY KEY AUTOINCREMENT,','id INTEGER PRIMARY KEY AUTOINCREMENT,handed_over_at TEXT,handed_over_by INTEGER REFERENCES staff(id),voided_by INTEGER REFERENCES staff(id),original_prescription_id INTEGER REFERENCES prescription(id),');
 rx=rx.replace(/\)\s*STRICT\s*$/i,",CHECK(status='草稿' OR (guidance_note IS NOT NULL AND length(trim(guidance_note))>0)),CHECK((handed_over_at IS NULL)=(handed_over_by IS NULL)),CHECK(voided_by IS NULL OR status='已作废'),CHECK(handed_over_at IS NULL OR (collection_route='院外' AND issued_at IS NOT NULL AND handed_over_at>=issued_at))) STRICT");
 const fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 db.exec('PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE');
 try{
  for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
  rebuild(db,'payment_order',order,{patient_funds_id:'(SELECT patient_funds_id FROM bill WHERE bill.id=payment_order.bill_id)'});
  rebuild(db,'payment_reconciliation',check);rebuild(db,'prescription',rx);
  db.exec("ALTER TABLE material ADD COLUMN category TEXT GENERATED ALWAYS AS (CASE is_drug WHEN 1 THEN '药品' ELSE '材料' END) VIRTUAL NOT NULL CHECK(category IN ('材料','药品'));ALTER TABLE purchase_order ADD COLUMN cancellation_reason TEXT CHECK(cancellation_reason IS NULL OR length(trim(cancellation_reason))>0);");
  for(const index of indexes)db.exec(index.sql);
  for(const t of triggers){
   let sql=t.sql;
   if(t.name==='payment_order_terminal')sql=replace(sql,'NEW.bill_id IS NOT OLD.bill_id','NEW.patient_funds_id IS NOT OLD.patient_funds_id OR NEW.bill_id IS NOT OLD.bill_id');
   if(t.name==='prescription_sealed')sql=replace(sql,"(OLD.collection_route='院外' AND (NEW.status<>'已作废'", "(OLD.collection_route='院外' AND ((NEW.status<>'已作废' AND NOT (NEW.status='已开立' AND OLD.handed_over_at IS NULL AND NEW.handed_over_at IS NOT NULL))");
   db.exec(sql);
  }
  db.exec(`
   CREATE UNIQUE INDEX payment_order_live_prepayment ON payment_order(patient_funds_id) WHERE bill_id IS NULL AND status IN ('待支付','处理中','待核实');
   CREATE TRIGGER contract_order_initial BEFORE INSERT ON payment_order WHEN NEW.status<>'待支付' OR NEW.patient_payment_id IS NOT NULL OR NEW.external_reference IS NOT NULL OR NEW.verified_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'payment_order_context'); END;
   CREATE TRIGGER contract_order_context_insert BEFORE INSERT ON payment_order WHEN NEW.bill_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bill WHERE id=NEW.bill_id AND patient_funds_id=NEW.patient_funds_id) BEGIN SELECT RAISE(ABORT,'payment_order_context'); END;
   CREATE TRIGGER contract_order_success BEFORE UPDATE ON payment_order WHEN NEW.status='已成功' AND NOT EXISTS(SELECT 1 FROM patient_payment p WHERE p.id=NEW.patient_payment_id AND p.patient_funds_id=NEW.patient_funds_id AND p.status='到账已确认' AND p.channel=NEW.channel AND p.net_cents=NEW.amount_cents AND p.external_reference=NEW.external_reference) BEGIN SELECT RAISE(ABORT,'payment_order_context'); END;
   CREATE TRIGGER contract_cash_check BEFORE INSERT ON payment_reconciliation WHEN NEW.patient_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM patient_payment WHERE id=NEW.patient_payment_id AND channel='现金' AND status='到账已确认' AND net_cents=NEW.expected_cents) BEGIN SELECT RAISE(ABORT,'cash_check_context'); END;
   CREATE TRIGGER contract_check_previous BEFORE INSERT ON payment_reconciliation WHEN NEW.previous_reconciliation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_reconciliation p WHERE p.id=NEW.previous_reconciliation_id AND p.patient_payment_id IS NEW.patient_payment_id AND p.payment_order_id IS NEW.payment_order_id AND p.patient_refund_id IS NEW.patient_refund_id AND p.expected_cents=NEW.expected_cents AND p.business_date=NEW.business_date AND p.status IN ('待核对','差异待处理')) BEGIN SELECT RAISE(ABORT,'cash_check_context'); END;
   CREATE TRIGGER contract_rx_original_insert BEFORE INSERT ON prescription WHEN NEW.original_prescription_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prescription p WHERE p.id=NEW.original_prescription_id AND p.id<>NEW.id AND p.patient_id=NEW.patient_id AND p.visit_id=NEW.visit_id AND p.status<>'草稿') BEGIN SELECT RAISE(ABORT,'prescription_context'); END;
   CREATE TRIGGER contract_rx_initial_facts BEFORE INSERT ON prescription WHEN NEW.handed_over_at IS NOT NULL OR NEW.handed_over_by IS NOT NULL OR NEW.voided_by IS NOT NULL BEGIN SELECT RAISE(ABORT,'prescription_context'); END;
   CREATE TRIGGER contract_rx_original_frozen BEFORE UPDATE ON prescription WHEN NEW.original_prescription_id IS NOT OLD.original_prescription_id BEGIN SELECT RAISE(ABORT,'prescription_frozen'); END;
   CREATE TRIGGER contract_rx_handover BEFORE UPDATE ON prescription WHEN (OLD.handed_over_at IS NOT NULL AND (NEW.handed_over_at IS NOT OLD.handed_over_at OR NEW.handed_over_by IS NOT OLD.handed_over_by)) OR (OLD.handed_over_at IS NULL AND NEW.handed_over_at IS NOT NULL AND (OLD.status<>'已开立' OR NEW.status<>'已开立' OR NEW.collection_route<>'院外' OR NEW.handed_over_by<>NEW.prescriber_id OR strftime('%Y-%m-%dT%H:%M:%SZ',NEW.handed_over_at,'+0 seconds') IS NOT NEW.handed_over_at)) BEGIN SELECT RAISE(ABORT,'prescription_handover'); END;
   CREATE TRIGGER contract_rx_void BEFORE UPDATE ON prescription WHEN OLD.status<>'已作废' AND NEW.status='已作废' AND (NEW.voided_by IS NULL OR NEW.voided_by<>NEW.prescriber_id OR NEW.voided_at IS NULL OR NEW.void_reason IS NULL) BEGIN SELECT RAISE(ABORT,'prescription_context'); END;
   CREATE TRIGGER contract_purchase_cancel BEFORE UPDATE ON purchase_order WHEN NEW.status='已取消' AND OLD.status<>'已取消' AND NEW.cancellation_reason IS NULL BEGIN SELECT RAISE(ABORT,'purchase_cancel_reason'); END;
  `);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('收付处方升级外键检查失败');
  db.exec('PRAGMA user_version='+VERSION+';COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.exec('PRAGMA foreign_keys='+fk);}
}
module.exports={VERSION,upgradePaymentPrescription,rebuild};
