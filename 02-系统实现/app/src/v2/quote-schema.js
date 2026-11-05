'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2026102602;
const SCHEMA_HASH='895a588892efe464813657824f4ac4640560e8b5f53e963c0236e46bd21f0584';
function upgradeQuotes(db,filename,backupNeeded=true){
 const current=db.prepare('PRAGMA user_version').get().user_version;if(current===VERSION)return;
 if(current!==2026102601||db.isTransaction)throw new Error('不支持此版本，未执行独立报价升级');
 if(filename!==':memory:'&&backupNeeded){const dir=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,'before-quotes-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 // The design supplement is input to this checked, atomic migration, never run on its own.
 const source=fs.readFileSync(path.resolve(__dirname,'../../../../01-需求文档/数据层设计/SQLite-独立报价设计补充.sql'));
 if(crypto.createHash('sha256').update(source).digest('hex')!==SCHEMA_HASH)throw new Error('独立报价设计SQL摘要不匹配，请核对定稿设计');
 const sql=source.toString('utf8').replace(/^PRAGMA foreign_keys=ON;\s*/m,'').replace(/^BEGIN IMMEDIATE;\s*/m,'').replace(/^COMMIT;\s*/m,'');
 db.exec('BEGIN IMMEDIATE');try{
  db.exec(sql);
  for(const [code,name,kind,roles] of [
   ['quote.read','查询独立报价','查询',['dentist','cashier']],
   ['quote.prepare','编制独立报价','业务写入',['dentist']],
   ['quote.issue','核价并出具报价','业务写入',['cashier']],
   ['quote.decide','登记患者费用决定','业务写入',['dentist','cashier']]]){
   db.prepare('INSERT INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES(?,\'UC-27\',?,?,\'报价与患者、原方案及实际收付分开核实\',1)').run(code,name,kind);
   for(const role of roles)db.prepare("INSERT INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-26T00:00:00Z' FROM access_role r,access_permission p WHERE r.code=? AND p.code=?").run(role,code);
  }
  db.exec(`CREATE TRIGGER quote_source_frozen BEFORE UPDATE ON quote_version WHEN NEW.quote_id IS NOT OLD.quote_id OR (OLD.status<>'草稿' AND NEW.source_plan_version_id IS NOT OLD.source_plan_version_id) OR NEW.version_no IS NOT OLD.version_no OR NEW.previous_version_id IS NOT OLD.previous_version_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'quote_version_frozen'); END;
   CREATE TRIGGER quote_version_no_delete BEFORE DELETE ON quote_version BEGIN SELECT RAISE(ABORT,'quote_version_frozen'); END;
   CREATE TRIGGER quote_head_no_delete BEFORE DELETE ON treatment_quote BEGIN SELECT RAISE(ABORT,'quote_identity_frozen'); END;
   CREATE TRIGGER quote_payment_identity BEFORE UPDATE ON patient_payment WHEN NEW.quote_id IS NOT OLD.quote_id BEGIN SELECT RAISE(ABORT,'quote_identity_frozen'); END;
   CREATE TRIGGER quote_priced_identity BEFORE UPDATE ON bill_item WHEN OLD.pricing_status='已核价' AND NEW.quote_item_id IS NOT OLD.quote_item_id BEGIN SELECT RAISE(ABORT,'quote_identity_frozen'); END;
   PRAGMA user_version=${VERSION};COMMIT;`);
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
module.exports={VERSION,upgradeQuotes};
