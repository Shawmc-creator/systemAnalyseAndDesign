'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {setupFollowups,command}=require('./helpers/v2-followups');
const {setupInventory}=require('./helpers/v2-inventory');
const {setup:setupPharmacy}=require('./helpers/v2-pharmacy');
const {setup:setupInsurance}=require('./helpers/v2-settlements');
const {setup}=require('./helpers/v2-treatment');
const {CONFIG,upgradeWorkflowHistory,VERSION:WORKFLOW_VERSION}=require('../src/v2/workflow-history-schema');
const {openDatabase,VERSION}=require('../src/v2/database');
const {removeWorkflowHistoryFixture}=require('./helpers/v2-workflow-legacy');
const list=(a,kind,id)=>a.unit.workflowHistory.list(kind,id);
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('draft follow-up is not a publication; actual source signing, contact, continuation and completion retain ordered snapshots',t=>{
 const a=setupFollowups(t),f=a.createFollowup();assert.equal(list(a,'followup_requirement',f.id).length,0);
 a.signSource();a.contact(f.id);a.assess(f.id,{advice:'继续跟进',nextDate:'2026-10-20',responsibleStaffId:4});a.assess(f.id);
 const h=list(a,'followup_requirement',f.id);assert.deepEqual(h.map(x=>x.event_type),['发布','联系更新','继续跟进','完成']);
 assert.deepEqual(h.map(x=>x.event_no),[1,2,3,4]);assert.equal(h[0].published_by,4);assert.equal(h[0].status,'待联系');assert.equal(h[3].status,'已完成');assert.equal(h[0].closure_basis,null);
 assert.equal(a.queue(a.d).items[0].history.length,4);
 assert.throws(()=>a.db.prepare('UPDATE followup_history SET purpose=? WHERE id=?').run('覆盖旧目的',h[0].id),/workflow_history_frozen/);
 assert.throws(()=>a.db.prepare('DELETE FROM followup_history WHERE id=?').run(h[0].id),/workflow_history_frozen/);
});
test('cancelling the actual follow-up appointment restores contact and records history without deleting the original contact',t=>{
 const a=setupFollowups(t);a.signSource();const f=a.createFollowup(),b=a.book();a.contact(f.id,{appointmentId:b.id,expectedAppointmentRevision:1,nextStep:'arrange'});
 const ap=a.db.prepare('SELECT * FROM appointment WHERE id=?').get(b.id),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(b.id);
 a.reception.appointment(a.f,command({action:'cancel',appointmentId:b.id,expectedRevision:ap.revision,occupancyRevision:o.revision,reason:'患者取消本次复诊'}));
 assert.equal(list(a,'followup_requirement',f.id).at(-1).event_type,'继续跟进');assert.equal(a.followup(f.id).status,'待联系');assert.equal(a.db.prepare('SELECT count(*) n FROM contact_history').get().n,1);
});
test('stock count preserves stale snapshot, recount and final decision while replay never duplicates the stock movement',t=>{
 const a=setupInventory(t),c=a.count(90);a.move('issue');a.approveCount(c.id);a.move('recount',{countId:c.id,expectedRevision:2,countedAt:a.auth.now(),countedQuantityScaled:88});
 const input=command({action:'approveCount',countId:c.id,expectedRevision:3,reviewNote:'重新实点后确认实际差异'});
 a.inventory.approveCount(a.m,input);assert.equal(a.inventory.approveCount(a.m,input).replayed,true);
 const h=list(a,'stock_count',c.id);assert.deepEqual(h.map(x=>x.event_type),['提交','版本不符','重新实点','同意']);assert.equal(h[0].snapshot_quantity_scaled,100);assert.equal(h[2].snapshot_quantity_scaled,90);assert.equal(h[3].counted_quantity_scaled,88);assert.equal(a.stock().quantity_scaled,88);
 assert.equal(a.db.prepare('SELECT count(*) n FROM inventory_movement WHERE stock_count_id=?').get(c.id).n,1);
 assert.throws(()=>a.db.prepare('DELETE FROM stock_count_history WHERE id=?').run(h[0].id),/workflow_history_frozen/);
});
test('receipt history separates initial arrival, later pending acceptance and manager coordination; no stock is invented for a note',t=>{
 const a=setupInventory(t,{receive:false}),r=a.receive({items:[a.line({acceptedQuantityScaled:40,pendingQuantityScaled:60})]});
 a.inspect(r.id,{newAcceptedQuantityScaled:30,newRejectedQuantityScaled:10});
 const item=a.db.prepare('SELECT * FROM purchase_receipt_item').get(),header=a.db.prepare('SELECT * FROM purchase_receipt').get();
 a.purchases.approve(a.m,command({action:'receiptNote',receiptId:r.id,expectedRevision:header.revision,receiptItemId:item.id,expectedItemRevision:item.revision,reviewNote:'实际联系供货方处理剩余待检'}));
 const h=list(a,'purchase_receipt_item',item.id);assert.deepEqual(h.map(x=>x.event_type),['首次确认','待检后确认','差异更正']);assert.deepEqual(h.map(x=>x.accepted_quantity_scaled),[40,70,70]);assert.deepEqual(h.map(x=>x.newly_accepted_scaled),[40,30,0]);assert.equal(h[2].inventory_movement_id,null);assert.equal(a.stock().quantity_scaled,70);
 assert.equal(a.purchases.query(a.i).items[0].receipts[0].items[0].history.length,3);
 assert.throws(()=>a.db.prepare('UPDATE receipt_item_history SET inspection_note=? WHERE id=?').run('抹掉原检验',h[0].id),/workflow_history_frozen/);
});
test('a failed receipt history write rolls back the header, line, stock, movement and successful request',t=>{
 const a=setupInventory(t,{receive:false}),before=a.db.prepare('SELECT count(*) n FROM request_submission').get().n;
 a.db.exec("CREATE TEMP TRIGGER receipt_history_fault BEFORE INSERT ON receipt_item_history BEGIN SELECT RAISE(ABORT,'receipt_history_fault'); END");
 assert.throws(()=>a.receive(),/receipt_history_fault/);
 for(const table of ['purchase_receipt','purchase_receipt_item','batch_stock','inventory_movement','receipt_item_history'])assert.equal(a.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 assert.equal(a.db.prepare('SELECT count(*) n FROM request_submission').get().n,before);
});
test('failed follow-up history write rolls back contact, closure and the original requirement revision',t=>{
 const a=setupFollowups(t);a.signSource();const f=a.createFollowup(),before=a.followup(f.id);
 a.db.exec("CREATE TEMP TRIGGER followup_history_fault BEFORE INSERT ON followup_history BEGIN SELECT RAISE(ABORT,'followup_history_fault'); END");assert.throws(()=>a.contact(f.id),/followup_history_fault/);
 assert.deepEqual(a.followup(f.id),before);assert.equal(a.db.prepare('SELECT count(*) n FROM contact_history').get().n,0);assert.equal(list(a,'followup_requirement',f.id).length,1);
});
test('repeated pharmacist reviews preserve earlier return reasons through physician response and reapproval',t=>{
 const a=setupPharmacy(t),p=a.inDraft();a.rxIssue(p);a.approveRx({action:'return',reviewNote:'第一次审方退回核实'});
 a.prescriptions.write(a.d,command({...a.context,action:'respond',prescriptionId:p.id,expectedRevision:a.rxInfo().revision,confirmed:true,reason:'医师重新核实原处方'}));
 a.approveRx({reviewNote:'第二次实际审核通过'});const h=list(a,'prescription',p.id);assert.deepEqual(h.map(x=>x.review_note),['第一次审方退回核实','第二次实际审核通过']);assert.deepEqual(h.map(x=>x.actor_id),[6,6]);
 assert.throws(()=>a.db.prepare('DELETE FROM prescription_review_history WHERE id=?').run(h[0].id),/workflow_history_frozen/);
});
test('confirmed wrong ownership is corrected with a new verified index while old confirmation and consent links remain intact',t=>{
 const a=setup(t),plan=a.draft();a.publish(plan.id);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const doc=a.documents.upload(a.d,command({...a.context,documentType:'诊疗附件',source:'隔离原件',ownershipNote:'初次核对',reason:'归档',originalName:'原件.png',contentBase64:bytes.toString('base64')}));
 a.documents.verify(a.d,command({versionId:doc.id,expectedRevision:1,action:'confirm',verificationNote:'原确认意见',confirmed:true}));const decision=a.decide(plan.id,2,{documentVersionIds:[doc.id]});
 const old=a.db.prepare('SELECT * FROM document_version WHERE id=?').get(doc.id),schedule=a.db.prepare('SELECT dated_schedule_id FROM resource_occupancy WHERE visit_id=?').get(a.v.id).dated_schedule_id;
 const ap=a.reception.appointment(a.f,command({action:'create',patientId:2,scheduleId:schedule,scheduleRevision:1,startsAt:'2026-10-19T10:30:00+08:00',endsAt:'2026-10-19T11:00:00+08:00',reason:'第二患者预约'}));
 const visit=a.reception.arrive(a.f,command({patientId:2,dentistId:4,appointmentId:ap.id,expectedRevision:1,occupancyRevision:1,scheduleRevision:1,arrivedAt:a.auth.now()}));
 const input=command({versionId:doc.id,expectedRevision:2,visitId:visit.id,patientId:2,reason:'核对原件后确认正确归属',confirmed:true}),next=a.documents.correct(a.d,input);assert.equal(a.documents.correct(a.d,input).replayed,true);
 const h=list(a,'document_version',doc.id);assert.equal(h.length,1);assert.equal(h[0].original_confirmation_note,'原确认意见');assert.equal(h[0].original_confirmed_by,old.confirmed_by);assert.equal(h[0].corrected_document_version_id,next.id);
 assert.equal(a.db.prepare('SELECT document_version_id FROM decision_file_version WHERE decision_id=?').get(decision.id).document_version_id,doc.id);
 assert.equal(a.db.prepare('SELECT status FROM document_version WHERE id=?').get(doc.id).status,'退回核对');assert.equal(a.db.prepare('SELECT status FROM document_version WHERE id=?').get(next.id).status,'原件已确认');assert.deepEqual(a.documents.download(a.d,next.id).bytes,bytes);
 assert.equal(JSON.stringify(a.documents.query(a.d,a.context)).includes('corrected_document_version_id'),false,'cross-patient target index is not disclosed in old patient query');
});
test('insurance fees, successful estimate, patient choice and actual settlement reference the exact immutable original request',t=>{
 const a=setupInsurance(t);a.ready();const c=a.caseRow(),h=list(a,'insurance_case',c.id);assert.deepEqual(h.map(x=>x.event_type),['提交','结果','患者选择']);assert.equal(h[1].request_id,h[0].id);assert.equal(h[2].request_id,h[0].id);assert.equal(h[1].estimated_fund_cents,35000);assert.equal(h[2].patient_choice,'医保');
 assert.equal(a.db.prepare('SELECT preestimate_request_id FROM insurance_fee').get().preestimate_request_id,h[0].id);a.submit();const settled=a.settle();assert.equal(a.db.prepare('SELECT preestimate_request_id FROM insurance_settlement WHERE id=?').get(settled.id).preestimate_request_id,h[0].id);
 assert.equal(a.insurance.query(a.c).cases[0].preestimateHistory.length,3);assert.equal(a.insurance.query(a.f).cases[0].preestimateHistory,undefined);assert.throws(()=>a.db.prepare('DELETE FROM insurance_preestimate_history WHERE id=?').run(h[0].id),/workflow_history_frozen/);
});
test('a successful estimate cannot fabricate amounts inconsistent with the frozen submitted fee lines',t=>{
 const a=setupInsurance(t);a.ready();const h=list(a,'insurance_case',a.caseRow().id),r=h[1];
 const fields=Object.keys(r).filter(k=>!['id','actor_name'].includes(k)),values=fields.map(k=>k==='event_no'?4:k==='operation_no'?'fabricated-result':k==='estimated_fund_cents'?1:r[k]);
 assert.throws(()=>a.db.prepare('INSERT INTO insurance_preestimate_history('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...values),/workflow_history_context/);
});
test('insurance fees and settlements cannot omit their exact original request',t=>{
 const a=setupInsurance(t);a.ready();const fee=a.db.prepare('SELECT * FROM insurance_fee').get(),fields=Object.keys(fee).filter(k=>k!=='id');
 assert.throws(()=>a.db.prepare('INSERT INTO insurance_fee('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>k==='preestimate_request_id'?null:fee[k])),/workflow_history_context|insurance_contract_context|NOT NULL/);
 a.submit();const settled=a.settle(),s=a.db.prepare('SELECT * FROM insurance_settlement WHERE id=?').get(settled.id);assert.throws(()=>a.db.prepare('UPDATE insurance_settlement SET preestimate_request_id=NULL WHERE id=?').run(s.id),/workflow_history_frozen|immutable_fact/);
});
test('all six history tables match the document field types, nullability, primary keys and explicit foreign keys',t=>{
 const db=openDatabase();t.after(()=>db.close());const model=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../01-需求文档/设计交付/核心业务数据模型.json'),'utf8').replace(/^\uFEFF/,''));
 for(const c of Object.values(CONFIG)){
  const table=model.tables.find(t=>t.table===c.table),columns=db.prepare('PRAGMA table_info('+c.table+')').all(),fks=db.prepare('PRAGMA foreign_key_list('+c.table+')').all();assert.equal(columns.length,table.fields.length);
  for(const f of table.fields){const actual=columns.find(c=>c.name===f.name);assert.equal(actual.type,f.type);assert.equal(!(actual.notnull||actual.pk),f.nullable);if(f.foreign_key)assert.ok(fks.some(k=>k.from===f.name&&k.table===f.foreign_key&&k.to==='id'));}
 }
});
function previous(t){
 const a=setupInventory(t),folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-workflow-history-')),file=path.join(folder,'previous.db'),open=[];
 t.after(()=>{for(const db of open)if(db.isOpen)db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-workflow-history-'));fs.rmSync(folder,{recursive:true,force:true});});
 a.db.prepare('VACUUM INTO ?').run(file);const db=new DatabaseSync(file);removeWorkflowHistoryFixture(db);db.exec('PRAGMA user_version=2026102302');
 const originals=new Map(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>[r.name,JSON.stringify(db.prepare('SELECT * FROM '+r.name+' ORDER BY rowid').all())]));db.close();return {folder,file,originals,track:d=>{open.push(d);return d;}};
}
test('102-table upgrade preserves all original columns and facts, creates empty histories and takes exactly one readable backup',t=>{
 const f=previous(t),db=f.track(openDatabase(f.file));assert.equal(db.prepare('PRAGMA user_version').get().user_version,VERSION);
 for(const[name,rows]of f.originals){const original=JSON.parse(rows),columns=original.length?Object.keys(original[0]):[];const current=db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(r=>columns.length?Object.fromEntries(columns.map(c=>[c,r[c]])):r);assert.equal(JSON.stringify(current),rows,name);}
 for(const c of Object.values(CONFIG))assert.equal(db.prepare('SELECT count(*) n FROM '+c.table).get().n,0,'no fabricated old histories');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const backups=fs.readdirSync(path.join(f.folder,'backups'));assert.equal(backups.length,1);const b=new DatabaseSync(path.join(f.folder,'backups',backups[0]),{readOnly:true});assert.equal(b.prepare('PRAGMA user_version').get().user_version,2026102302);b.close();openDatabase(f.file).close();assert.equal(fs.readdirSync(path.join(f.folder,'backups')).length,1);
});
test('failure in a later history table rolls back earlier new tables, added columns, triggers and schema version',t=>{
 const f=previous(t),db=f.track(new DatabaseSync(f.file));db.exec('CREATE TABLE stock_count_history(id INTEGER PRIMARY KEY)');assert.throws(()=>upgradeWorkflowHistory(db,':memory:'),/already exists/);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,2026102302);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='followup_history'").get().n,0);assert.equal(db.prepare('PRAGMA table_info(followup_requirement)').all().some(c=>c.name==='published_at'),false);
 db.exec('DROP TABLE stock_count_history');upgradeWorkflowHistory(db,':memory:');assert.equal(db.prepare('PRAGMA user_version').get().user_version,WORKFLOW_VERSION);
});
