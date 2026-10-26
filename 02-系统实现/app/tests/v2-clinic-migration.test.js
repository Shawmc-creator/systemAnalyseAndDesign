'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {setup}=require('./helpers/v2-settlements');
const {openDatabase,VERSION}=require('../src/v2/database');
const {upgradeClinic}=require('../src/v2/clinic-schema');

function snapshot(db){
 return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('PRAGMA table_xinfo('+name+')').all().map(c=>c.name),rows:db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(r=>({...r}))}));
}
function previous(t){
 const a=setup(t),folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-settings-migration-')),file=path.join(folder,'previous.db'),tracked=[];
 t.after(()=>{for(const db of tracked)if(db.isOpen)db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-settings-migration-'));fs.rmSync(folder,{recursive:true,force:true});});
 a.db.prepare('VACUUM INTO ?').run(file);const db=new DatabaseSync(file);
 // Reconstruct the old fixture only: restore its original deletion guards immediately afterwards.
 const guards=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('tr_access_permission_delete_forbidden_delete','tr_role_permission_delete_forbidden_delete')").all();
 for(const g of guards)db.exec('DROP TRIGGER "'+g.name+'"');
 db.exec("PRAGMA foreign_keys=ON;DROP TRIGGER clinic_service_identity;ALTER TABLE service DROP COLUMN category;DELETE FROM role_permission WHERE permission_id IN (SELECT id FROM access_permission WHERE code='clinic.manage');DELETE FROM access_permission WHERE code='clinic.manage';PRAGMA user_version=2026102305");
 for(const g of guards)db.exec(g.sql);
 const rows=snapshot(db);db.close();return {folder,file,rows,track:db=>{tracked.push(db);return db;}};
}

test('clinic upgrade preserves every original column and clinical row, backs up the old file once, and classifies unknown existing services as other',t=>{
 const f=previous(t),db=f.track(openDatabase(f.file));assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);
 for(const old of f.rows){
  const rows=db.prepare('SELECT * FROM '+old.name+' ORDER BY rowid').all();
  const original=['access_permission','role_permission'].includes(old.name)?rows.filter(r=>old.rows.some(o=>o.id===r.id)):rows;
  assert.deepEqual(original.map(r=>Object.fromEntries(old.columns.map(c=>[c,r[c]]))),old.rows,old.name);
 }
 assert.equal(snapshot(db).length,108);assert.ok(db.prepare('SELECT count(*) n FROM service WHERE category=\'其他\'').get().n>0);
 assert.equal(db.prepare("SELECT count(*) n FROM access_permission WHERE code='clinic.manage'").get().n,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const backups=fs.readdirSync(path.join(f.folder,'backups'));assert.equal(backups.length,1);
 const b=new DatabaseSync(path.join(f.folder,'backups',backups[0]),{readOnly:true});try{assert.equal(b.prepare('PRAGMA user_version').get().user_version,2026102305);assert.equal(b.prepare('PRAGMA table_info(service)').all().some(c=>c.name==='category'),false);assert.deepEqual(snapshot(b),f.rows);}finally{b.close();}
 openDatabase(f.file).close();assert.equal(fs.readdirSync(path.join(f.folder,'backups')).length,1);
});

test('an upgrade failure rolls the new column, permissions, triggers and version back together; the unchanged old database can be retried',t=>{
 const f=previous(t),db=f.track(new DatabaseSync(f.file));db.exec("CREATE TEMP TRIGGER reject_clinic_permission BEFORE INSERT ON access_permission WHEN NEW.code='clinic.manage' BEGIN SELECT RAISE(ABORT,'isolated migration fault');END");
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
 assert.throws(()=>upgradeClinic(db,':memory:'),/isolated migration fault/);assert.equal(db.isTransaction,false);assert.equal(db.prepare('PRAGMA user_version').get().user_version,2026102305);assert.deepEqual(snapshot(db),f.rows);assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),triggers);
 db.exec('DROP TRIGGER reject_clinic_permission');upgradeClinic(db,':memory:');assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);
});

test('unsupported versions and an existing transaction are rejected before any clinic schema changes',t=>{
 const f=previous(t),db=f.track(new DatabaseSync(f.file));db.exec('PRAGMA user_version=123');assert.throws(()=>upgradeClinic(db,':memory:'),/不支持此版本/);assert.deepEqual(snapshot(db),f.rows);
 db.exec('PRAGMA user_version=2026102305;BEGIN IMMEDIATE');assert.throws(()=>upgradeClinic(db,':memory:'),/不支持此版本/);assert.equal(db.isTransaction,true);db.exec('ROLLBACK');assert.deepEqual(snapshot(db),f.rows);
});
