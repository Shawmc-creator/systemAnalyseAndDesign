'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {setup}=require('./helpers/v2-settlements'),{removeQuotesFixture}=require('./helpers/v2-quote-legacy');
const {openDatabase,VERSION}=require('../src/v2/database'),{upgradeQuotes}=require('../src/v2/quote-schema');
const snapshot=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('PRAGMA table_xinfo('+name+')').all().map(c=>c.name),rows:db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(r=>({...r}))}));
function previous(t){
 const a=setup(t),folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-quote-migration-')),file=path.join(folder,'previous.db'),tracked=[];
 t.after(()=>{for(const d of tracked)if(d.isOpen)d.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-quote-migration-'));fs.rmSync(folder,{recursive:true,force:true});});
 a.db.prepare('VACUUM INTO ?').run(file);const d=new DatabaseSync(file);removeQuotesFixture(d);const old=snapshot(d);d.close();return {file,folder,old,track:d=>{tracked.push(d);return d;}};
}
test('quotation migration preserves all 108 original tables and money, adds empty quotation structures, backs up exactly once',t=>{
 const f=previous(t),d=f.track(openDatabase(f.file));assert.equal(d.prepare('PRAGMA user_version').get().user_version,VERSION);assert.equal(snapshot(d).length,112);
 for(const old of f.old){const rows=d.prepare('SELECT * FROM '+old.name+' ORDER BY rowid').all().filter(r=>!['access_permission','role_permission'].includes(old.name)||old.rows.some(o=>o.id===r.id));assert.deepEqual(rows.map(r=>Object.fromEntries(old.columns.map(c=>[c,r[c]]))),old.rows,old.name);}
 for(const table of ['treatment_quote','quote_version','quote_item','quote_decision'])assert.equal(d.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.equal(d.prepare('SELECT count(*) n FROM patient_payment WHERE quote_id IS NOT NULL').get().n,0);assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(d.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const files=fs.readdirSync(path.join(f.folder,'backups'));assert.equal(files.length,1);const b=new DatabaseSync(path.join(f.folder,'backups',files[0]),{readOnly:true});try{assert.equal(b.prepare('PRAGMA user_version').get().user_version,2026102601);assert.deepEqual(snapshot(b),f.old);}finally{b.close();}openDatabase(f.file).close();assert.equal(fs.readdirSync(path.join(f.folder,'backups')).length,1);
});
test('quote migration failure rolls DDL, columns, permissions and version back atomically and can be retried',t=>{
 const f=previous(t),d=f.track(new DatabaseSync(f.file));d.exec("CREATE TEMP TRIGGER reject_quote_permission BEFORE INSERT ON access_permission WHEN NEW.code='quote.issue' BEGIN SELECT RAISE(ABORT,'isolated quote migration fault');END");
 assert.throws(()=>upgradeQuotes(d,':memory:'),/isolated quote migration fault/);assert.equal(d.isTransaction,false);assert.equal(d.prepare('PRAGMA user_version').get().user_version,2026102601);assert.deepEqual(snapshot(d),f.old);
 d.exec('DROP TRIGGER reject_quote_permission');upgradeQuotes(d,':memory:');assert.equal(d.prepare('PRAGMA user_version').get().user_version,VERSION);
});
test('quote migration rejects unknown versions and an existing transaction before mutation',t=>{
 const f=previous(t),d=f.track(new DatabaseSync(f.file));d.exec('PRAGMA user_version=1');assert.throws(()=>upgradeQuotes(d,':memory:'),/不支持此版本/);assert.deepEqual(snapshot(d),f.old);d.exec('PRAGMA user_version=2026102601;BEGIN');assert.throws(()=>upgradeQuotes(d,':memory:'),/不支持此版本/);assert.equal(d.isTransaction,true);d.exec('ROLLBACK');assert.deepEqual(snapshot(d),f.old);
});
