'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {TABLES}=require('../../src/v2/insurance-alignment-schema');
let previous;
function previousInsuranceSchema(){
 if(previous)return previous;
 const db=new DatabaseSync(':memory:');try{
  const file=path.resolve(__dirname,'../../../../01-需求文档/数据层设计/SQLite-建表设计.sql');db.exec(fs.readFileSync(file,'utf8'));
  for(const[file,method]of [['resource-schema','upgradeResources'],['prescription-schema','upgradePrescriptions'],['pharmacy-schema','upgradePharmacy'],['settlement-schema','upgradeSettlements'],['clinical-schema','upgradeClinical'],['financial-history-schema','upgradeFinancialHistory'],['workflow-history-schema','upgradeWorkflowHistory'],['payment-prescription-schema','upgradePaymentPrescription']])require('../../src/v2/'+file)[method](db,':memory:');
  previous={tables:Object.fromEntries(TABLES.map(t=>[t,{sql:db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql,columns:db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name)}])),triggers:new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all().map(t=>[t.name,t.sql]))};return previous;
 }finally{db.close();}
}
// Isolated test fixtures only. No filename or production database is accepted.
function removeInsuranceFixture(db){
 if(!db.prepare('PRAGMA table_info(insurance_fee)').all().some(c=>c.name==='is_self_pay'))return;
 const schema=previousInsuranceSchema(),triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all(),indexes=db.prepare("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all().filter(i=>TABLES.includes(i.tbl_name)),fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 db.exec('PRAGMA foreign_keys=OFF;BEGIN');try{
  for(const t of triggers)db.exec('DROP TRIGGER "'+t.name+'"');
  for(const[table,def]of Object.entries(schema.tables)){
   const seq=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table)?.seq,cols=def.columns.map(c=>'"'+c+'"').join(',');
   db.exec(def.sql.replace(new RegExp('CREATE TABLE "?'+table+'"?','i'),'CREATE TABLE '+table+'_previous'));
   db.exec(`INSERT INTO ${table}_previous(${cols}) SELECT ${cols} FROM ${table};DROP TABLE ${table};ALTER TABLE ${table}_previous RENAME TO ${table};`);
   if(seq!=null)db.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?').run(seq,table);
  }
  for(const i of indexes)db.exec(i.sql);
  for(const t of triggers)if(!t.name.startsWith('insurance_contract_')&&t.name!=='insurance_mapping_snapshot_frozen')db.exec(schema.triggers.get(t.name)||t.sql);
  db.exec('PRAGMA user_version=2026102304;COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys='+fk);}
}
module.exports={removeInsuranceFixture,previousInsuranceSchema};
