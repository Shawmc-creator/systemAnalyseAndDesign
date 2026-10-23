'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupFees,command}=require('./helpers/v2-fees');
const {insert,fact}=require('../src/v2/common');
const {CONFIG}=require('../src/v2/financial-history-schema');
const all=(a,t)=>a.db.prepare('SELECT * FROM '+t+' ORDER BY id').all();
function payload(a,extra={}){const q=a.bills();return command({action:'submit',patientId:1,billId:a.billId,paymentId:a.payment.id,expectedFundsRevision:q.funds.revision,expectedBillRevision:q.items[0].revision,expectedPaymentRevision:1,adjustmentCents:-20000,refundCents:20000,reason:'本次更正依据',evidence:'原单核对证据',...extra});}
function secondCashier(a){const now=a.auth.now(),role=a.db.prepare("SELECT id FROM access_role WHERE code='cashier'").get();
 const q=insert(a.db,'staff_role_qualification',{staff_id:5,role_id:role.id,valid_from:now,valid_until:null,verified_by:1,verification_basis:'隔离验收收费兼岗资格',revoked_at:null,revoked_by:null,revocation_reason:null,created_at:now});
 insert(a.db,'account_role',{account_id:5,role_id:role.id,qualification_id:q,granted_by:1,granted_at:now,valid_until:null,grant_reason:'隔离验收兼岗',revoked_by:null,revoked_at:null,revocation_reason:null});
 const s=a.auth.login({username:'assistant',password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:'cashier'};
}

test('fee typed history preserves every submitted amount, evidence and reviewer while the current row changes',t=>{
 const a=setupFees(t),r=a.request();a.approve(r.id,{action:'return',reviewNote:'第一轮缺少证据，请补齐'});
 a.request({action:'resubmit',requestId:r.id,expectedRevision:2,adjustmentCents:-15000,refundCents:15000,evidence:'第二轮补充的原单证据'});
 const history=all(a,'fee_request_history');assert.deepEqual(history.map(h=>h.event_type),['提交','退回','提交']);
 assert.deepEqual(history.map(h=>h.event_no),[1,2,3]);assert.equal(history[0].proposed_refund_cents,20000);assert.equal(history[2].proposed_refund_cents,15000);
 assert.equal(history[1].review_note,'第一轮缺少证据，请补齐');assert.equal(history[2].review_note,null);assert.equal(history[2].submission_no,2);
 assert.equal(a.feeInfo().items[0].history[2].evidence,'第二轮补充的原单证据');
});
test('price submission, return, revised resubmission, approval and stop retain old price and validity snapshots',t=>{
 const a=setupFees(t),service=a.service(),p=a.price(service.id,{},false);
 a.billing.approve(a.m,command({action:'return',priceId:p.id,expectedRevision:2,reviewNote:'核对原目录及适用期间后修订'}));
 a.billing.draft(a.c,command({action:'draft',priceId:p.id,expectedRevision:3,serviceId:service.id,unitPriceCents:25000,validFrom:'2026-10-19T00:00:00+08:00',reason:'按新证据修订价格'}));
 a.billing.draft(a.c,command({action:'submit',priceId:p.id,expectedRevision:4}));
 a.billing.approve(a.m,command({action:'approve',priceId:p.id,expectedRevision:5,reviewNote:'修订证据核实，确认适用'}));
 a.billing.approve(a.m,command({action:'stop',priceId:p.id,expectedRevision:6,reviewNote:'停止用于后续新计费，保留原收费'}));
 const history=a.unit.financialHistory.list('service_price',p.id);assert.deepEqual(history.map(h=>h.event_type),['提交','退回','提交','确认','停止适用']);
 assert.deepEqual(history.map(h=>h.unit_price_cents),[20000,20000,25000,25000,25000]);assert.equal(history[2].confirmed_by,null);
 assert.equal(history[2].review_note,null);assert.equal(history[3].confirmed_by,1);assert.equal(history[4].confirmed_at,history[3].confirmed_at);
});
test('same submission replays without appending history; a reused key with changed evidence is rejected',t=>{
 const a=setupFees(t),input=payload(a),first=a.fees.apply(a.c,input),again=a.fees.apply(a.c,input);
 assert.equal(first.id,again.id);assert.equal(again.replayed,true);assert.equal(all(a,'fee_request_history').length,1);
 assert.throws(()=>a.fees.apply(a.c,{...input,evidence:'改写同一提交内容'}),e=>e.code==='REQUEST_KEY_REUSED');
});
test('a history insertion failure rolls approval, adjustments, purpose release and funds revision back atomically',t=>{
 const a=setupFees(t),r=a.request(),before=a.bills();
 a.db.exec("CREATE TEMP TRIGGER history_fault BEFORE INSERT ON fee_request_history WHEN NEW.event_type='同意' BEGIN SELECT RAISE(ABORT,'history_write_fault'); END");
 assert.throws(()=>a.approve(r.id),/history_write_fault/);assert.equal(a.db.prepare('SELECT status FROM fee_request').get().status,'待审核');
 assert.equal(all(a,'fee_adjustment').length,0);assert.equal(all(a,'fee_request_history').length,1);assert.deepEqual(a.bills().funds,before.funds);
 a.db.exec('DROP TRIGGER history_fault');a.approve(r.id);assert.equal(all(a,'fee_request_history').at(-1).event_no,2);
});
test('an audit failure after snapshot insertion leaves no orphan business history or approved money change',t=>{
 const a=setupFees(t),r=a.request();
 a.db.exec("CREATE TEMP TRIGGER audit_history_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='fee_request' AND NEW.event_type='变更' AND NEW.after_revision=2 BEGIN SELECT RAISE(ABORT,'audit_history_fault'); END");
 assert.throws(()=>a.approve(r.id),/audit_history_fault/);assert.equal(all(a,'fee_request_history').length,1);assert.equal(all(a,'fee_adjustment_item').length,0);
});
test('typed financial histories cannot be updated or deleted, including older snapshots after resubmission',t=>{
 const a=setupFees(t);a.request();
 for(const table of ['fee_request_history','service_price_history']){
  assert.throws(()=>a.db.exec('UPDATE '+table+" SET event_reason='改写旧事实'"),/financial_history_frozen/);
  assert.throws(()=>a.db.exec('DELETE FROM '+table),/financial_history_frozen/);
 }
});
test('history FK, contiguous sequence and exact snapshot guards reject fabricated parent contents and event stages',t=>{
 const a=setupFees(t);a.request();const {id,...h}=all(a,'fee_request_history')[0];
 for(const patch of [{fee_request_id:99999},{event_no:3},{proposed_refund_cents:1},{event_type:'同意'}])
  assert.throws(()=>insert(a.db,'fee_request_history',{...h,event_no:2,operation_no:'new-operation',...patch}),/financial_history_context|FOREIGN KEY/);
 assert.equal(all(a,'fee_request_history').length,1);
});
test('a command that changes a request without its typed snapshot is rejected and the projection is restored',t=>{
 const a=setupFees(t),r=a.request();
 assert.throws(()=>a.unit.command(a.c,'uc24.apply',command({}),(ctx,now)=>{a.db.prepare("UPDATE fee_request SET evidence='未追加快照的修改',revision=revision+1 WHERE id=?").run(r.id);return {kind:'fee_request',key:r.id,revision:2};}),e=>e.code==='FINANCIAL_HISTORY_MISSING');
 assert.equal(a.feeInfo().items[0].evidence,'核对原单及实际业务依据');
});
test('only the current submitting cashier can withdraw; a resubmission transfers that authority to its actual submitter',t=>{
 const a=setupFees(t),other=secondCashier(a),r=a.request();
 assert.throws(()=>a.request({action:'withdraw',requestId:r.id,expectedRevision:1},other),e=>e.code==='FEE_WITHDRAW_OWNER');
 assert.equal(a.feeInfo(other).items[0].canWithdraw,false);a.approve(r.id,{action:'return',reviewNote:'请实际补充并重提'});
 a.request({action:'resubmit',requestId:r.id,expectedRevision:2},other);
 assert.throws(()=>a.request({action:'withdraw',requestId:r.id,expectedRevision:3}),e=>e.code==='FEE_WITHDRAW_OWNER');
 a.request({action:'withdraw',requestId:r.id,expectedRevision:3},other);
 assert.equal(a.feeInfo().items[0].status,'已撤回');assert.equal(all(a,'fee_request_history').at(-1).actor_id,5);
});
test('approved cash can only refund through original cash channel; refusal does not occupy funds',t=>{
 const a=setupFees(t),r=a.request();a.approve(r.id);
 assert.throws(()=>a.begin(r.id,{channel:'微信'}),e=>e.code==='REFUND_ORIGINAL_CHANNEL');
 assert.equal(all(a,'patient_refund').length,0);assert.equal(a.bills().funds.refundHeldCents,0);a.begin(r.id);
});
test('legacy resubmission ownership comes from its actual audit submitter rather than the original creator',t=>{
 const a=setupFees(t),other=secondCashier(a),r=a.request();a.approve(r.id,{action:'return',reviewNote:'补充核实'});
 a.request({action:'resubmit',requestId:r.id,expectedRevision:2},other);
 const list=a.unit.financialHistory.list.bind(a.unit.financialHistory);
 // Simulate the legacy query branch without deleting any frozen historical fact.
 a.unit.financialHistory.list=(kind,key)=>kind==='fee_request'&&key===r.id?[]:list(kind,key);
 assert.equal(a.fees.submitter(a.db.prepare('SELECT * FROM fee_request WHERE id=?').get(r.id)),5);
 assert.throws(()=>a.request({action:'withdraw',requestId:r.id,expectedRevision:3}),e=>e.code==='FEE_WITHDRAW_OWNER');
 a.request({action:'withdraw',requestId:r.id,expectedRevision:3},other);
 assert.equal(a.db.prepare('SELECT status FROM fee_request WHERE id=?').get(r.id).status,'已撤回');
});
test('approval history and actual refund remain separate; unknown holds budget and partial success consumes only actual amount',t=>{
 const a=setupFees(t),r=a.request();a.approve(r.id);const h=all(a,'fee_request_history');assert.equal(h.at(-1).approved_refund_cents,20000);assert.equal(all(a,'patient_refund').length,0);
 const refund=a.begin(r.id);a.finish(refund.id,{outcome:'unknown',actualCents:null});assert.equal(a.bills().funds.refundHeldCents,20000);
 a.finish(refund.id,{actualCents:15000});assert.equal(a.bills().funds.refundedCents,15000);assert.equal(a.bills().funds.refundHeldCents,0);
 assert.equal(a.feeInfo().items[0].remainingApprovedRefundCents,5000);assert.deepEqual(all(a,'fee_request_history'),h);
});
test('history fields and explicit parent FKs correspond to the document mapping, and financial snapshots are not exposed to front desk or dentist',t=>{
 const a=setupFees(t);a.request();
 const model=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../../01-需求文档/设计交付/核心业务数据模型.json'),'utf8');
 for(const [kind,c]of Object.entries(CONFIG)){
  const t=JSON.parse(model).tables.find(t=>t.table===c.table),columns=a.db.prepare('PRAGMA table_info('+c.table+')').all();
  assert.deepEqual(columns.map(f=>f.name).sort(),t.fields.map(f=>f.name).sort());
  for(const f of t.fields.filter(f=>f.foreign_key))assert.ok(a.db.prepare('PRAGMA foreign_key_list('+c.table+')').all().some(k=>k.from===f.name&&k.table===f.foreign_key));
 }
 assert.throws(()=>a.feeInfo(a.f),e=>e.code==='FORBIDDEN');assert.ok(a.billing.catalog(a.d).prices.every(p=>!Object.hasOwn(p,'history')));
});
