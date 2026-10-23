'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {setupFees}=require('./helpers/v2-fees');
const {openDatabase,VERSION}=require('../src/v2/database');
const {upgradeFinancialHistory,VERSION:FINANCIAL_VERSION}=require('../src/v2/financial-history-schema');

function legacy(t){
 const a=setupFees(t),r=a.request();a.approve(r.id);const active=[];
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-financial-history-'));
 t.after(()=>{for(const db of active)if(db.isOpen)db.close();const target=path.resolve(folder);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-financial-history-'))throw new Error('Unsafe cleanup');fs.rmSync(target,{recursive:true,force:true});});
 const file=path.join(folder,'previous.db');a.db.prepare('VACUUM INTO ?').run(file);const db=new DatabaseSync(file);
 // Construct a pre-history schema fixture from isolated business facts. No production record is removed.
 require('./helpers/v2-workflow-legacy').removeWorkflowHistoryFixture(db);
 db.exec('DROP TABLE fee_request_history;DROP TABLE service_price_history;PRAGMA user_version=20261023;');
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const original=new Map(names.map(name=>[name,JSON.stringify(db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all())]));db.close();
 return {file,folder,original,track:db=>{active.push(db);return db;}};
}
test('100-table upgrade preserves all facts through the financial and workflow history migrations, preserves all existing facts and takes one readable old-version backup',t=>{
 const f=legacy(t),db=f.track(openDatabase(f.file));assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);
 for(const[name,rows]of f.original)assert.equal(JSON.stringify(db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()),rows,name);
 for(const name of ['fee_request_history','service_price_history'])assert.equal(db.prepare('SELECT count(*) n FROM '+name).get().n,0,'old events must not be fabricated');
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,108);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const backups=fs.readdirSync(path.join(f.folder,'backups'));assert.equal(backups.length,1);
 const old=new DatabaseSync(path.join(f.folder,'backups',backups[0]),{readOnly:true});assert.equal(old.prepare('PRAGMA user_version').get().user_version,20261023);assert.equal(JSON.stringify(old.prepare('SELECT * FROM fee_request ORDER BY rowid').all()),f.original.get('fee_request'));old.close();
 const repeat=openDatabase(f.file);repeat.close();assert.equal(fs.readdirSync(path.join(f.folder,'backups')).length,1);
});
test('a failure creating the second history table rolls back the first, all triggers and the version',t=>{
 const f=legacy(t),db=f.track(new DatabaseSync(f.file));db.exec('CREATE TABLE service_price_history(id INTEGER PRIMARY KEY)');
 assert.throws(()=>upgradeFinancialHistory(db,':memory:'),/already exists/);assert.equal(db.prepare('PRAGMA user_version').get().user_version,20261023);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='fee_request_history'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'fee_request_history_%'").get().n,0);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM fee_request ORDER BY rowid').all()),f.original.get('fee_request'));
 db.exec('DROP TABLE service_price_history');upgradeFinancialHistory(db,':memory:');assert.equal(db.prepare('PRAGMA user_version').get().user_version,FINANCIAL_VERSION);
});
