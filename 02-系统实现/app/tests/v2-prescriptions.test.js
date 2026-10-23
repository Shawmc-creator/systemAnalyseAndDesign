'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {setup,command}=require('./helpers/v2-prescriptions');
const {openDatabase,DESIGN_DIR,VERSION}=require('../src/v2/database');
const {upgradeResources}=require('../src/v2/resource-schema');
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('outside prescription keeps diagnosis, directions and guidance; issuance does not dispense, bill or reduce stock',t=>{
 const a=setup(t);a.review();a.record();const draft=a.rxDraft();assert.equal(a.prescriptions.query(a.d,a.context).prescriptions[0].status,'草稿');
 a.rxIssue(draft);const q=a.prescriptions.query(a.d,a.context),p=q.prescriptions[0];assert.equal(p.status,'已开立');assert.equal(p.review_status,'院外取药');assert.equal(p.items[0].quantity_scaled,7);assert.equal(p.items[0].unit,'片');assert.equal(p.contentIntact,true);assert.equal(q.inHouseEnabled,false);
 for(const table of ['bill','bill_item','patient_funds','inventory_movement'])assert.equal(a.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('issue requires actual diagnosis, current health review, explicit confirmation and fresh patient/record versions',t=>{
 const a=setup(t),p=a.rxDraft();rejects(()=>a.rxIssue(p),'PRESCRIPTION_DIAGNOSIS');a.record();rejects(()=>a.rxIssue(p),'HEALTH_REVIEW_REQUIRED');
 a.review();rejects(()=>a.rxIssue(p,{confirmed:false}),'CONFIRM_REQUIRED');rejects(()=>a.rxIssue(p,{expectedPatientRevision:99}),'VERSION_CONFLICT');rejects(()=>a.rxIssue(p,{expectedRecordRevision:99}),'VERSION_CONFLICT');rejects(()=>a.rxIssue(p,{expectedHealthReviewId:999}),'HEALTH_REVIEW_REQUIRED');a.rxIssue(p);
});
test('material must be explicitly classified as a drug and confirmed; directory revisions and quantities are checked',t=>{
 const a=setup(t),base={materialId:a.drug.id,expectedMaterialRevision:2,quantityScaled:7,directions:'演示用法'};
 rejects(()=>a.rxDraft({items:[{...base,expectedMaterialRevision:1}]}),'DRUG_CHANGED');rejects(()=>a.rxDraft({items:[{...base,quantityScaled:0}]}),'INVALID_QUANTITY');rejects(()=>a.rxDraft({items:[base,base]}),'PRESCRIPTION_DUPLICATE_DRUG');
 a.db.prepare('UPDATE material SET is_drug=0 WHERE id=?').run(a.drug.id);rejects(()=>a.rxDraft(),'DRUG_UNAVAILABLE');a.db.prepare('UPDATE material SET is_drug=1,is_active=0 WHERE id=?').run(a.drug.id);rejects(()=>a.rxDraft(),'DRUG_UNAVAILABLE');
});
test('an existing catalog entry with stock can be classified as a drug without rewriting units or ledger and requires renewed manager confirmation',t=>{
 const {setupInventory}=require('./helpers/v2-inventory'),a=setupInventory(t);const before=a.stock().quantity_scaled,m=a.db.prepare('SELECT * FROM material WHERE id=?').get(a.material.id);
 const update=a.inventory.record(a.i,command({action:'material',materialId:m.id,expectedRevision:m.revision,name:m.name,specification:m.specification,baseUnit:m.base_unit,purchaseUnit:m.purchase_unit,conversionNumerator:m.conversion_numerator,conversionDenominator:m.conversion_denominator,quantityScale:m.quantity_scale,requiresTrace:!!m.requires_trace,requiresExpiry:!!m.requires_expiry,isDrug:true,reason:'核实既有目录实际为药品，不改单位和原库存'}));
 let current=a.db.prepare('SELECT * FROM material WHERE id=?').get(m.id);assert.equal(current.is_drug,1);assert.equal(current.is_active,0);assert.equal(current.confirmed_at,null);assert.equal(a.stock().quantity_scaled,before);
 a.inventory.approve(a.m,command({action:'confirmMaterial',materialId:m.id,expectedRevision:update.revision,reason:'负责人重新核实分类、药名和规格'}));current=a.db.prepare('SELECT * FROM material WHERE id=?').get(m.id);assert.equal(current.is_active,1);assert.equal(a.stock().quantity_scaled,before);
});
test('issued prescription and drug snapshots are sealed; void retains original copy and new prescribing creates a new number',t=>{
 const a=setup(t);a.review();a.record();const p=a.rxDraft();a.rxIssue(p);
 rejects(()=>a.rx({action:'save',prescriptionId:p.id,expectedRevision:2,reason:'试图覆盖'}),'PRESCRIPTION_SEALED');assert.throws(()=>a.db.prepare("UPDATE prescription_item SET directions='changed' WHERE prescription_id=?").run(p.id),/prescription_frozen/);
 assert.throws(()=>a.db.prepare("UPDATE material SET base_unit='盒' WHERE id=?").run(a.drug.id),/prescription_material_frozen/);
 a.rx({action:'void',prescriptionId:p.id,expectedRevision:2,confirmed:true,medicationNotDispensed:true,reason:'医师核实后作废，保留原方'});const old=a.prescriptions.query(a.d,a.context).prescriptions[0];assert.equal(old.status,'已作废');assert.equal(old.contentIntact,true);
 rejects(()=>a.rx({action:'issue',prescriptionId:p.id,expectedRevision:3,reason:'试图重新启用'}),'PRESCRIPTION_STATE');const next=a.rxDraft();assert.notEqual(next.id,p.id);assert.notEqual(a.db.prepare('SELECT record_no FROM prescription WHERE id=?').get(next.id).record_no,old.record_no);
});
test('outside-only guard rejects inpatient route, review and dispense without inventing a pharmacy qualification',t=>{
 const a=setup(t);for(const extra of [{collectionRoute:'院内'},{action:'review'},{action:'dispense'}])rejects(()=>a.rxDraft(extra),'PHARMACY_NOT_ENABLED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM prescription').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM inventory_movement').get().n,0);
});
test('cross-role and unassigned dentist access and missing CSRF are denied before writes or export',t=>{
 const a=setup(t),p=a.rxDraft();for(const actor of [a.f,a.c,a.m,a.i]){rejects(()=>a.prescriptions.query(actor,a.context),'FORBIDDEN');rejects(()=>a.prescriptions.export(actor,p.id),'FORBIDDEN');}
 rejects(()=>a.prescriptions.query(a.other,a.context),'CLINICAL_SCOPE');rejects(()=>a.rxDraft({patientId:2}),'PATIENT_MISMATCH');rejects(()=>a.rx({action:'void',prescriptionId:p.id,expectedRevision:1,reason:'测试'}, {...a.d,csrf:'bad'}),'CSRF_INVALID');
});
test('same submission replays one prescription, while changed body under that key is refused',t=>{
 const a=setup(t),input=command({...a.context,action:'draft',collectionRoute:'院外',diagnosis:'演示诊断',guidanceNote:'演示指导',reason:'首次草稿',items:[{materialId:a.drug.id,expectedMaterialRevision:2,quantityScaled:7,directions:'演示用法'}]});const first=a.prescriptions.write(a.d,input),again=a.prescriptions.write(a.d,input);assert.equal(first.id,again.id);assert.equal(again.replayed,true);rejects(()=>a.prescriptions.write(a.d,{...input,diagnosis:'改动'}),'REQUEST_KEY_REUSED');assert.equal(a.db.prepare('SELECT count(*) n FROM prescription').get().n,1);
});
test('audit failure rolls back prescription header, items and successful submission receipt',t=>{
 const a=setup(t);a.db.exec("CREATE TEMP TRIGGER rx_audit_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='prescription' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'rx_audit_fault'); END");assert.throws(()=>a.rxDraft(),/rx_audit_fault/);assert.equal(a.db.prepare('SELECT count(*) n FROM prescription').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM prescription_item').get().n,0);
});
test('export is a protected escaped record of the issued snapshot and preserves void status',t=>{
 const a=setup(t);a.review();a.record();const p=a.rxDraft({guidanceNote:'<script>unsafe</script> & 医师指导'});rejects(()=>a.prescriptions.export(a.d,p.id),'PRESCRIPTION_STATE');a.rxIssue(p);const copy=a.prescriptions.export(a.d,p.id);assert.match(copy.html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.equal(copy.html.includes('<script>'),false);assert.match(copy.html,/院外取药/);assert.match(copy.html,/医师填写的演示用法/);
 a.rx({action:'void',prescriptionId:p.id,expectedRevision:2,confirmed:true,medicationNotDispensed:true,reason:'核实后作废'});assert.match(a.prescriptions.export(a.d,p.id).html,/状态：已作废/);
});
function legacyResource(folder){const file=path.join(folder,'known-88.db'),db=new DatabaseSync(file);db.exec(fs.readFileSync(path.join(DESIGN_DIR,'SQLite-建表设计.sql'),'utf8'));db.exec('PRAGMA application_id=0x51484432');upgradeResources(db,':memory:');db.close();return file;}
function folder(t){const f=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-rx-'));t.after(()=>{assert.ok(path.resolve(f).startsWith(path.join(os.tmpdir(),'clinic-rx-')));fs.rmSync(f,{recursive:true,force:true});});return f;}
test('recognized 88-table database upgrades once with a readable original backup; old material is not silently classified as a drug',t=>{
 const f=folder(t),file=legacyResource(f),db=openDatabase(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,108);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();const backups=fs.readdirSync(path.join(f,'backups'));assert.equal(backups.length,1);const old=new DatabaseSync(path.join(f,'backups',backups[0]),{readOnly:true});assert.equal(old.prepare('PRAGMA user_version').get().user_version,20261019);assert.equal(old.prepare('PRAGMA table_info(material)').all().some(c=>c.name==='is_drug'),false);old.close();openDatabase(file).close();assert.equal(fs.readdirSync(path.join(f,'backups')).length,1);
});
test('prescription migration failure rolls the schema and permissions back to the recognized 88-table version',t=>{
 const f=folder(t),file=legacyResource(f),db=new DatabaseSync(file);db.prepare("INSERT INTO access_permission(code,name,operation_kind,object_rule,config_version) VALUES('prescriptions.query','重复配置','查询','测试',1)").run();db.close();assert.throws(()=>openDatabase(file),/UNIQUE/);const old=new DatabaseSync(file);assert.equal(old.prepare('PRAGMA user_version').get().user_version,20261019);assert.equal(old.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='prescription'").get().n,0);assert.equal(old.prepare('PRAGMA table_info(material)').all().some(c=>c.name==='is_drug'),false);old.close();
});
