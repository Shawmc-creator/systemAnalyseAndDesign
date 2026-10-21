'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setup,command}=require('./helpers/v2-treatment');
const {DocumentStore,decodeFile,MAX_FILE_BYTES}=require('../src/v2/document-store');
const {hash}=require('../src/v2/common');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const PDF=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const file=(bytes=PNG,name='牙科影像.png')=>({originalName:name,contentBase64:bytes.toString('base64')});
function upload(a,extra={},actor=a.d){return a.documents.upload(actor,command({...a.context,documentType:'影像',source:'诊室设备导出',ownershipNote:'核对患者号和本次就诊',reason:'首次归档',...file(),...extra}));}
function verify(a,v,extra={}){return a.documents.verify(a.d,command({versionId:v.id,expectedRevision:v.revision,action:'confirm',verificationNote:'已核对原件内容及患者归属',confirmed:true,...extra}));}
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
function assistant(a){const s=a.auth.login({username:'assistant',password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:'assistant'};}
test('actual bytes, detected format, digest, unknown capture time and confirmation are stored; assistant cannot confirm',t=>{
 const a=setup(t),s=assistant(a),v=upload(a,{},s),saved=a.db.prepare('SELECT * FROM document_version').get();
 assert.equal(saved.sha256,hash(PNG));assert.equal(saved.size_bytes,PNG.length);assert.equal(saved.captured_at,null);assert.equal(saved.status,'原件待确认');
 assert.deepEqual(a.documents.download(s,v.id).bytes,PNG);
 reject(()=>a.documents.verify(s,command({versionId:v.id,expectedRevision:1,action:'confirm'})),'FORBIDDEN');
 verify(a,v);const d=a.documents.query(a.d,a.context);assert.equal(d.documents[0].versions[0].confirmed_by,4);assert.equal(d.documents[0].versions[0].available,true);assert.equal(JSON.stringify(d).includes('storage_key'),false);
 assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_document').get().n,1);
});
test('replacement creates a numbered pending version and preserves original confirmed file and evidence',t=>{
 const a=setup(t),first=upload(a);verify(a,first);const doc=a.documents.query(a.d,a.context).documents[0];
 const second=upload(a,{documentId:doc.id,expectedRevision:doc.revision,...file(PDF,'补充文书.pdf'),reason:'补充原件'});
 const versions=a.documents.query(a.d,a.context).documents[0].versions;assert.deepEqual(versions.map(v=>v.status),['原件待确认','原件已确认']);assert.equal(versions[0].previous_version_id,first.id);
 assert.deepEqual(a.documents.download(a.d,first.id).bytes,PNG);assert.deepEqual(a.documents.download(a.d,second.id).bytes,PDF);
 reject(()=>upload(a,{documentId:doc.id,expectedRevision:doc.revision}),'VERSION_CONFLICT');
 assert.equal(a.documentStore.memory.size,2);
});
test('file validation rejects forged types, paths, malformed base64, over-limit bytes and future capture times without rows or blobs',t=>{
 const a=setup(t);
 for(const extra of [{...file(Buffer.from('<script>unsafe</script>'),'a.png')},{originalName:'../a.png'},{originalName:'a.pdf'},{mediaType:'text/html'},{contentBase64:'AAAA==='},{contentBase64:Buffer.alloc(MAX_FILE_BYTES+1).toString('base64')},{capturedAt:'2026-10-20T00:00:00Z'}])assert.throws(()=>upload(a,extra));
 assert.equal(a.documentStore.memory.size,0);assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_document').get().n,0);
 assert.equal(decodeFile(file(PDF,'原件.pdf')).mime,'application/pdf');
});
test('current grants, CSRF, physician visit scope and patient/plan ownership are enforced',t=>{
 const a=setup(t),v=upload(a);
 for(const actor of [a.f,a.m,a.c])assert.throws(()=>a.documents.query(actor,a.context));
 reject(()=>a.documents.query(a.other,a.context),'CLINICAL_SCOPE');reject(()=>a.documents.download(a.other,v.id),'CLINICAL_SCOPE');
 reject(()=>upload(a,{}, {...a.d,csrf:'bad'}),'CSRF_INVALID');reject(()=>upload(a,{patientId:2}),'PATIENT_MISMATCH');
 const plan=a.draft();upload(a,{planVersionId:plan.id});
 assert.throws(()=>a.db.prepare('UPDATE treatment_plan SET patient_id=2 WHERE id=(SELECT treatment_plan_id FROM plan_version WHERE id=?)').run(plan.id),/immutable_ownership/);
});
test('same request replays without additional disk bytes; changed content under same request is rejected',t=>{
 const a=setup(t),input=command({...a.context,documentType:'诊疗附件',source:'患者提供',ownershipNote:'核实患者号',reason:'保存原件',...file()});
 const first=a.documents.upload(a.d,input),second=a.documents.upload(a.d,input);assert.equal(first.id,second.id);assert.equal(second.replayed,true);assert.equal(a.documentStore.memory.size,1);
 reject(()=>a.documents.upload(a.d,{...input,reason:'改动'}),'REQUEST_KEY_REUSED');assert.equal(a.db.prepare('SELECT count(*) n FROM document_version').get().n,1);
});
test('audit failure rolls back file bytes, file index, versions and successful receipt together',t=>{
 const a=setup(t);a.db.exec("CREATE TEMP TRIGGER document_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='document_version' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'document_audit_fault'); END");
 assert.throws(()=>upload(a),/document_audit_fault/);assert.equal(a.documentStore.memory.size,0);
 for(const table of ['clinical_document','document_version'])assert.equal(a.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('unavailable bytes cannot be confirmed or downloaded; returning an original preserves immutable content',t=>{
 const a=setup(t),v=upload(a),saved=a.db.prepare('SELECT * FROM document_version').get();a.documentStore.memory.delete(saved.storage_key);
 reject(()=>verify(a,v),'FILE_UNAVAILABLE');reject(()=>a.documents.download(a.d,v.id),'FILE_UNAVAILABLE');
 verify(a,v,{action:'return',verificationNote:'上传后原件缺失，请重新提供'});
 reject(()=>verify(a,{id:v.id,revision:2}),'DOCUMENT_STATE');
 assert.throws(()=>a.db.prepare('UPDATE document_version SET sha256=? WHERE id=?').run('b'.repeat(64),v.id),/immutable_ownership/);
 assert.throws(()=>a.db.prepare('UPDATE clinical_document SET patient_id=2').run(),/immutable_ownership|context_patient/);
});
test('verified missing/corrupt files require original hash restoration; confirmation and linked consent history remain intact',t=>{
 const a=setup(t),plan=a.draft();a.publish(plan.id);const v=upload(a,{planVersionId:plan.id,documentType:'同意文书',...file(PDF,'同意文书.pdf')});verify(a,v);
 const decision=a.decide(plan.id,2,{documentVersionIds:[v.id]});const saved=a.db.prepare('SELECT * FROM document_version WHERE id=?').get(v.id);
 reject(()=>verify(a,{id:v.id,revision:2},{action:'missing'}),'DOCUMENT_STATE');
 a.documentStore.memory.set(saved.storage_key,Buffer.from('damaged'));
 reject(()=>a.decide(plan.id,3,{documentVersionIds:[v.id]}),'FILE_UNAVAILABLE');
 verify(a,{id:v.id,revision:2},{action:'missing',verificationNote:'核查发现原件内容损坏'});
 reject(()=>verify(a,{id:v.id,revision:3},{action:'restore',...file()}),'RESTORE_HASH');
 verify(a,{id:v.id,revision:3},{action:'restore',...file(PDF,'备份.pdf'),verificationNote:'从核实备份恢复相同原件'});
 const restored=a.db.prepare('SELECT * FROM document_version WHERE id=?').get(v.id);assert.equal(restored.status,'原件已确认');assert.equal(restored.confirmed_at,saved.confirmed_at);assert.equal(restored.sha256,saved.sha256);assert.equal(restored.original_name,'同意文书.pdf');assert.equal(restored.revision,4);
 assert.equal(a.db.prepare('SELECT document_version_id FROM decision_file_version WHERE decision_id=?').get(decision.id).document_version_id,v.id);
 assert.deepEqual(a.documents.download(a.d,v.id).bytes,PDF);
});
test('pending wrong-visit association is corrected by a new index and an audited source link',t=>{
 const a=setup(t),v=upload(a);
 const schedule=a.db.prepare('SELECT dated_schedule_id FROM resource_occupancy WHERE visit_id=?').get(a.v.id).dated_schedule_id;
 const appointment=a.reception.appointment(a.f,command({action:'create',patientId:2,scheduleId:schedule,scheduleRevision:1,startsAt:'2026-10-19T10:30:00+08:00',endsAt:'2026-10-19T11:00:00+08:00',reason:'另一患者到诊'}));
 const visit=a.reception.arrive(a.f,command({patientId:2,dentistId:4,appointmentId:appointment.id,expectedRevision:1,occupancyRevision:1,scheduleRevision:1,arrivedAt:a.auth.now()}));
 const corrected=a.documents.correct(a.d,command({versionId:v.id,expectedRevision:1,visitId:visit.id,patientId:2,reason:'重新核对原件患者号，原归档时选错患者'}));
 assert.equal(a.documents.query(a.d,a.context).documents[0].versions[0].status,'退回核对');
 const next=a.documents.query(a.d,{visitId:visit.id,patientId:2}).documents[0];assert.equal(next.patient_id,2);assert.equal(next.versions[0].status,'原件待确认');assert.deepEqual(a.documents.download(a.d,corrected.id).bytes,PNG);
 assert.equal(a.db.prepare("SELECT count(*) n FROM audit_change WHERE field_name='corrected_from_version_id'").get().n,1);
});
test('disk storage survives reopening, uses controlled keys, and restores old data on a failed repair',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-documents-'));t.after(()=>{assert.ok(path.resolve(folder).startsWith(path.join(os.tmpdir(),'clinic-documents-')));fs.rmSync(folder,{recursive:true,force:true});});
 const store=new DocumentStore(folder),key=store.key(),write=store.stage(key,PNG);write.commit();
 assert.deepEqual(new DocumentStore(folder).read(key),PNG);assert.throws(()=>store.read('../elsewhere'));
 const repair=store.stage(key,PDF,true);repair.rollback();assert.deepEqual(store.read(key),PNG);assert.deepEqual(fs.readdirSync(folder),[key]);
 const newKey=store.key();store.stage(newKey,PNG).rollback();assert.equal(fs.existsSync(path.join(folder,newKey)),false);
});
module.exports={PNG,PDF};
