'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=2026102601;
function upgradeClinic(db,filename,backupNeeded=true){
 const current=db.prepare('PRAGMA user_version').get().user_version;if(current===VERSION)return;
 if(current!==2026102305||db.isTransaction)throw new Error('不支持此版本，未执行诊所基础管理升级');
 if(filename!==':memory:'&&backupNeeded){const folder=path.join(path.dirname(path.resolve(filename)),'backups');fs.mkdirSync(folder,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(folder,'before-clinic-settings-'+Date.now()+'-'+crypto.randomUUID()+'.db'));}
 db.exec('BEGIN IMMEDIATE');try{
  if(!db.prepare('PRAGMA table_info(service)').all().some(c=>c.name==='category'))db.exec("ALTER TABLE service ADD COLUMN category TEXT NOT NULL DEFAULT '其他' CHECK(category IN ('检查预防','牙体牙髓','拔牙外科','修复','正畸','药品','其他'))");
  db.prepare("INSERT OR IGNORE INTO access_permission(code,usecase_no,name,operation_kind,object_rule,config_version) VALUES('clinic.manage','UC-26','维护诊所基础资料与账号','业务写入','负责人核实任职及权限；保留历史，不绕过已有接诊安排',1)").run();
  db.prepare("INSERT OR IGNORE INTO role_permission(role_id,permission_id,config_version,created_at) SELECT r.id,p.id,1,'2026-10-26T00:00:00Z' FROM access_role r,access_permission p WHERE r.code='manager' AND p.code='clinic.manage'").run();
  db.exec(`CREATE TRIGGER IF NOT EXISTS clinic_service_identity BEFORE UPDATE ON service WHEN (NEW.name IS NOT OLD.name OR NEW.billing_unit IS NOT OLD.billing_unit) AND (EXISTS(SELECT 1 FROM service_price WHERE service_id=OLD.id) OR EXISTS(SELECT 1 FROM treatment_execution WHERE service_id=OLD.id) OR EXISTS(SELECT 1 FROM prescription_item WHERE billing_service_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'service_identity_frozen'); END;PRAGMA user_version=${VERSION};COMMIT`);
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
module.exports={VERSION,upgradeClinic};
