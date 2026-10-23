'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {setup,command}=require('./helpers/v2-treatment');
const {openDatabase,VERSION}=require('../src/v2/database');
const {upgradeClinical,VERSION:CLINICAL_VERSION}=require('../src/v2/clinical-schema');
const {legacySignaturePayload,signedIntegrity}=require('../src/v2/clinical-gates');
const {hash,canonical}=require('../src/v2/common');

function oldSigned(t){
 const tracked=[],a=setup(t),folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-core-alignment-'));
 t.after(()=>{for(const db of tracked)if(db.isOpen)db.close();const resolved=path.resolve(folder);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-core-alignment-'))throw new Error('Unsafe cleanup');fs.rmSync(resolved,{recursive:true,force:true});});
 const record=a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(a.v.id);
 a.clinical.health(a.d,command({...a.context,action:'record',expectedHealthVersionId:null,reason:'首次核实',conclusion:'未知事项保留',items:['病史','过敏','用药'].map(category=>({category,certainty:'未知',content:'隔离验收未知事实',source:'虚构患者',reportedAt:a.auth.now()}))}));
 a.clinical.health(a.d,command({...a.context,action:'review',expectedHealthVersionId:1,conclusion:'当次第二次实际复核'}));
 a.clinical.record(a.d,command({...a.context,recordId:record.id,action:'save',expectedRevision:1,chiefComplaint:'保留原主诉',diagnosis:'保留原诊断',treatmentAdvice:'保留原意见',findings:[{text:'保留原所见'}]}));
 a.clinical.sign(a.d,command({recordId:record.id,action:'sign',expectedRevision:2,confirmed:true}));
 const file=path.join(folder,'old-signed.db');a.db.prepare('VACUUM INTO ?').run(file);
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');
 require('./helpers/v2-workflow-legacy').removeWorkflowHistoryFixture(db);
 for(const table of ['fee_request_history','service_price_history']){assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);db.exec('DROP TABLE '+table);}
 const terminal=db.prepare("SELECT sql FROM sqlite_master WHERE name='tr_clinical_record_terminal_frozen_update'").get().sql;
 const signed=db.prepare('SELECT * FROM clinical_record WHERE id=?').get(record.id),digest=hash(canonical(legacySignaturePayload(db,signed)));
 db.exec(`DROP TRIGGER tr_clinical_record_terminal_frozen_update;DROP TRIGGER clinical_signature_review_insert;DROP TRIGGER clinical_signature_review_update;DROP TRIGGER visit_actual_end_update;DROP TRIGGER decision_quantity_insert;`);
 db.prepare('UPDATE clinical_record SET content_hash=? WHERE id=?').run(digest,record.id);
 db.prepare("UPDATE visit SET status='诊疗结束',ended_at=? WHERE id=?").run(signed.signed_at,a.v.id);
 db.exec(`ALTER TABLE clinical_record DROP COLUMN signed_health_review_id;ALTER TABLE decision_plan_item DROP COLUMN scope_quantity;${terminal};
 CREATE TRIGGER tr_visit_visit_end_unsigned_insert BEFORE INSERT ON visit WHEN NEW.status='诊疗结束' AND NOT EXISTS(SELECT 1 FROM clinical_record WHERE visit_id=NEW.id AND status='已签署') BEGIN SELECT RAISE(ABORT,'visit_end_unsigned'); END;
 CREATE TRIGGER tr_visit_visit_end_unsigned_update BEFORE UPDATE ON visit WHEN NEW.status='诊疗结束' AND NOT EXISTS(SELECT 1 FROM clinical_record WHERE visit_id=NEW.id AND status='已签署') BEGIN SELECT RAISE(ABORT,'visit_end_unsigned'); END;
 PRAGMA user_version=20261022;`);
 const original=db.prepare('SELECT * FROM clinical_record').get(),visit=db.prepare('SELECT * FROM visit').get();db.close();
 return {file,folder,recordId:record.id,original,visit,track:db=>{tracked.push(db);return db;}};
}

test('20261022 upgrade preserves original signed text, hash, reviews and legacy visit facts; backfills exact review and backs up once',t=>{
 const fixture=oldSigned(t),db=fixture.track(openDatabase(fixture.file));
 const r=db.prepare('SELECT * FROM clinical_record').get(),{signed_health_review_id,...original}=r;
 assert.deepEqual(original,{...fixture.original});assert.equal(signed_health_review_id,2);assert.equal(signedIntegrity(db,r),true);
 assert.deepEqual(db.prepare('SELECT * FROM visit').get(),fixture.visit);assert.equal(db.prepare('SELECT count(*) n FROM health_review').get().n,2);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const files=fs.readdirSync(path.join(fixture.folder,'backups'));assert.equal(files.length,1);
 const backup=new DatabaseSync(path.join(fixture.folder,'backups',files[0]),{readOnly:true});
 assert.equal(backup.prepare('PRAGMA user_version').get().user_version,20261022);assert.deepEqual(backup.prepare('SELECT * FROM clinical_record').get(),fixture.original);backup.close();
 const reopened=openDatabase(fixture.file);reopened.close();assert.equal(fs.readdirSync(path.join(fixture.folder,'backups')).length,1);
});
test('corrupt legacy signature refuses migration without rewriting or silently repairing original clinical facts',t=>{
 const fixture=oldSigned(t),db=new DatabaseSync(fixture.file);const tr=db.prepare("SELECT sql FROM sqlite_master WHERE name='tr_clinical_record_terminal_frozen_update'").get().sql;
 db.exec('DROP TRIGGER tr_clinical_record_terminal_frozen_update');db.prepare('UPDATE clinical_record SET content_hash=?').run('0'.repeat(64));db.exec(tr);db.close();
 assert.throws(()=>openDatabase(fixture.file),/签署校验未通过/);
 const unchanged=new DatabaseSync(fixture.file,{readOnly:true});assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version,20261022);
 assert.equal(unchanged.prepare('SELECT content_hash FROM clinical_record').get().content_hash,'0'.repeat(64));assert.equal(unchanged.prepare('PRAGMA table_info(clinical_record)').all().some(c=>c.name==='signed_health_review_id'),false);unchanged.close();
});
test('failure during signature reference backfill rolls columns, triggers and version back together',t=>{
 const fixture=oldSigned(t),db=fixture.track(new DatabaseSync(fixture.file));
 db.exec("CREATE TEMP TRIGGER migration_backfill_fault BEFORE UPDATE ON clinical_record BEGIN SELECT RAISE(ABORT,'injected_backfill_failure'); END");
 assert.throws(()=>upgradeClinical(db,':memory:'),/injected_backfill_failure/);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,20261022);assert.deepEqual(db.prepare('SELECT * FROM clinical_record').get(),fixture.original);
 assert.equal(db.prepare('PRAGMA table_info(decision_plan_item)').all().some(c=>c.name==='scope_quantity'),false);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='tr_visit_visit_end_unsigned_update'").get());
 db.exec('DROP TRIGGER migration_backfill_fault');upgradeClinical(db,':memory:');assert.equal(db.prepare('PRAGMA user_version').get().user_version,CLINICAL_VERSION);
});
