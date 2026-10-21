'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {setup}=require('./helpers/v2-prescriptions');
const {openDatabase,DESIGN_DIR}=require('../src/v2/database');
const {upgradeResources}=require('../src/v2/resource-schema');
const {upgradePrescriptions}=require('../src/v2/prescription-schema');
const {validatePrescriptions}=require('../src/v2/prescriptions');
function oldDatabase(t){
 const a=setup(t);a.review();a.record();const rx=a.rxDraft();a.rxIssue(rx);const service=a.service();a.price(service.id);a.execute(service.id,{independentCheck:true,independentBasis:'旧库既有实际诊疗与费用'});
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-pharmacy-upgrade-'));t.after(()=>{assert.ok(path.resolve(folder).startsWith(path.join(os.tmpdir(),'clinic-pharmacy-upgrade-')));fs.rmSync(folder,{recursive:true,force:true});});
 const filename=path.join(folder,'known-90.db'),db=new DatabaseSync(filename);db.exec(fs.readFileSync(path.join(DESIGN_DIR,'SQLite-建表设计.sql'),'utf8'));db.exec('PRAGMA application_id=0x51484432');upgradeResources(db,':memory:');upgradePrescriptions(db,':memory:');
 db.exec('PRAGMA foreign_keys=OFF');const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();for(const tr of triggers)db.exec('DROP TRIGGER "'+tr.name+'"');
 const unchanged={};
 for(const {name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
  if(['access_role','access_permission','role_permission'].includes(name))continue;
  const columns=db.prepare('PRAGMA table_info("'+name+'")').all().map(c=>c.name),rows=a.db.prepare('SELECT '+columns.map(c=>'"'+c+'"').join(',')+' FROM "'+name+'" ORDER BY rowid').all();
  if(rows.length){const sql=db.prepare('INSERT INTO "'+name+'"('+columns.map(c=>'"'+c+'"').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');for(const row of rows)sql.run(...columns.map(c=>row[c]));}
  if(['prescription','prescription_item','bill_item','patient','staff','treatment_execution','patient_funds'].includes(name))unchanged[name]={columns,rows};
 }
 for(const tr of triggers)db.exec(tr.sql);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();return {filename,folder,unchanged};
}
test('90-table migration retains issued outside prescriptions and old clinical charges while adding the documented dispensing source',t=>{
 const {filename,folder,unchanged}=oldDatabase(t),db=openDatabase(filename);
 for(const [table,old]of Object.entries(unchanged))assert.deepEqual(db.prepare('SELECT '+old.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+table+'" ORDER BY id').all(),old.rows,'Old data changed: '+table);
 validatePrescriptions(db);assert.equal(db.prepare('SELECT quantity_scale FROM bill_item').get().quantity_scale,0);assert.equal(db.prepare('SELECT amount_cents FROM bill_item').get().amount_cents,20000);assert.equal(db.prepare('PRAGMA user_version').get().user_version,require('../src/v2/database').VERSION);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 const files=fs.readdirSync(path.join(folder,'backups'));assert.equal(files.length,1);const backup=new DatabaseSync(path.join(folder,'backups',files[0]),{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get().user_version,20261020);validatePrescriptions(backup);backup.close();openDatabase(filename).close();assert.equal(fs.readdirSync(path.join(folder,'backups')).length,1);
});
test('pharmacy migration failure restores old tables, all triggers, foreign-key structure and sealed prescription facts',t=>{
 const {filename,unchanged}=oldDatabase(t),db=new DatabaseSync(filename);db.prepare("INSERT INTO access_permission(code,name,operation_kind,object_rule,config_version) VALUES('pharmacy.query','冲突配置','查询','升级失败测试',1)").run();const triggerCount=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n;db.close();assert.throws(()=>openDatabase(filename),/UNIQUE/);
 const old=new DatabaseSync(filename);assert.equal(old.prepare('PRAGMA user_version').get().user_version,20261020);assert.equal(old.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").get().n,triggerCount);assert.equal(old.prepare('PRAGMA table_info(bill_item)').all().some(c=>c.name==='dispense_record_id'),false);assert.equal(old.prepare('PRAGMA table_info(material)').all().some(c=>c.name==='billing_service_id'),false);assert.equal(old.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='dispense_record'").get().n,0);validatePrescriptions(old);
 assert.deepEqual(old.prepare('SELECT '+unchanged.prescription.columns.map(c=>'"'+c+'"').join(',')+' FROM prescription ORDER BY id').all(),unchanged.prescription.rows);assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(),[]);old.close();
});
