'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {DESIGN_DIR}=require('../../src/v2/database');
const {rebuild}=require('../../src/v2/payment-prescription-schema');
let previous;
function previousContractSchema(){
 if(previous)return previous;
 const db=new DatabaseSync(':memory:');try{
  db.exec(fs.readFileSync(path.join(DESIGN_DIR,'SQLite-建表设计.sql'),'utf8'));
  for(const[file,method]of [['resource-schema','upgradeResources'],['prescription-schema','upgradePrescriptions'],['pharmacy-schema','upgradePharmacy'],['settlement-schema','upgradeSettlements'],['clinical-schema','upgradeClinical'],['financial-history-schema','upgradeFinancialHistory'],['workflow-history-schema','upgradeWorkflowHistory']])require('../../src/v2/'+file)[method](db,':memory:');
  const tables=['payment_order','payment_reconciliation','prescription'];
  previous={tables:Object.fromEntries(tables.map(t=>[t,{sql:db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t).sql,columns:db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name)}])),triggers:new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all().map(t=>[t.name,t.sql]))};return previous;
 }finally{db.close();}
}
// Only reconstructs isolated test fixtures. Never accepts a filename or opens a live database.
function removePaymentPrescriptionFixture(db){
 if(!db.prepare('PRAGMA table_xinfo(material)').all().some(c=>c.name==='category'))return;
 const schema=previousContractSchema(),triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all(),indexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('payment_order','payment_reconciliation','prescription') AND sql IS NOT NULL").all(),fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 db.exec('PRAGMA foreign_keys=OFF;BEGIN');
 try{
  for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
  for(const[table,definition]of Object.entries(schema.tables)){
   const seq=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq,cols=definition.columns.map(c=>'"'+c+'"').join(',');
   db.exec(definition.sql.replace(new RegExp('CREATE TABLE "?'+table+'"?','i'),'CREATE TABLE '+table+'_previous'));
   db.exec(`INSERT INTO ${table}_previous(${cols}) SELECT ${cols} FROM ${table};DROP TABLE ${table};ALTER TABLE ${table}_previous RENAME TO ${table};`);
   if(seq!=null)db.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?').run(seq,table);
  }
  db.exec('ALTER TABLE material DROP COLUMN category;ALTER TABLE purchase_order DROP COLUMN cancellation_reason;');
  for(const i of indexes)if(i.name!=='payment_order_live_prepayment')db.exec(i.sql);
  for(const t of triggers)if(!t.name.startsWith('contract_'))db.exec(schema.triggers.get(t.name)||t.sql);
  db.exec('PRAGMA user_version=2026102303;COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys='+fk);}
}
module.exports={removePaymentPrescriptionFixture,previousContractSchema};
