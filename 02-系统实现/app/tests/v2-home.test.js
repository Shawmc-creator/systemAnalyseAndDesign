'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
const {BUILD}=require('../src/v2/release');
const section=(a,c,k)=>a.home.query(c).sections.find(s=>s.id===k);
function login(a,name,role=name){const s=a.auth.login({username:name,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role};}
test('home aggregates original work without new tables, successful submissions or business writes',t=>{
 const a=setup(t),names=a.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'operation_audit' ORDER BY name").all().map(r=>r.name),before=names.map(n=>JSON.stringify(a.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()));for(const c of [a.f,a.d,a.c,a.m])a.home.query(c);assert.deepEqual(names.map(n=>JSON.stringify(a.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all())),before);assert.equal(names.length+1,112);assert.equal(a.db.prepare('PRAGMA user_version').get().user_version,2026102602);
});
test('front desk counts scheduled and onsite patients once and never sees clinical, price or fee-approval queues',t=>{
 const a=require('./helpers/v2-settlements').setup(t);require('../scripts/lib/v2-quote-demo').prepareQuoteDemo(a);require('../scripts/lib/v2-workspace-demo').prepareWorkspaceDemo(a);const h=a.home.query(a.f);assert.equal(h.sections.find(s=>s.id==='arrivals').total,2);assert.equal(h.sections.find(s=>s.id==='waiting').total,1);assert.ok(!h.sections.some(s=>['records','prices','feeRequests','quoteDrafts'].includes(s.id)));assert.equal(JSON.stringify(h).includes('流程演示诊断'),false);assert.equal(JSON.stringify(h).includes('13800000001'),false);
});
test('dentist home is scoped to permitted visits and retains actual handover even after the planned end',t=>{
 const a=setup(t);assert.equal(section(a,a.d,'clinical').total,1);assert.equal(section(a,a.other,'clinical').total,0);assert.equal(section(a,a.d,'records').total,1);a.setClock('2026-10-19T03:00:00Z');assert.equal(section(a,a.d,'handover').total,1);assert.equal(a.db.prepare('SELECT released_at FROM resource_occupancy WHERE visit_id=?').get(a.v.id).released_at,null);
});
test('signing removes the draft-record task while actual resource use remains an independent task',t=>{
 const a=require('./helpers/v2-prescriptions').setup(t);assert.equal(section(a,a.d,'records').total,1);a.review();a.record();const r=a.clinical.recordFor(a.v.id);a.clinical.sign(a.d,command({action:'sign',recordId:r.id,expectedRevision:r.revision,confirmed:true}));assert.equal(section(a,a.d,'records').total,0);assert.equal(section(a,a.d,'handover').total,1);assert.equal(a.db.prepare('SELECT status FROM visit WHERE id=?').get(a.v.id).status,'接诊中');
});
test('cashier queues original unknown payment without counting it as confirmed funds or settling the bill',t=>{
 const a=setup(t),s=a.service();a.price(s.id);a.execute(s.id,{independentCheck:true,independentBasis:'隔离检查事实'});const q=a.bills(),p=a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:q.funds.revision,channel:'微信',receivedCents:10000,changeCents:0,verification:'pending',transactionEvidence:'原渠道结果待核实',allocations:[]}));
 const h=section(a,a.c,'payments');assert.equal(h.total,1);assert.equal(h.items[0].source.id,p.id);assert.equal(a.billing.fundsSummary(1).confirmedReceivedCents,0);assert.equal(section(a,a.c,'unpaid').total,1);assert.equal(JSON.stringify(a.home.query(a.c)).includes('external_reference'),false);
});
test('a resolved task opens the exact original payment; after verification the old task is rejected as changed',t=>{
 const a=setup(t),p=a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:null,channel:'现金',receivedCents:10000,changeCents:0,verification:'pending',transactionEvidence:'待现场核实',allocations:[]}));
 let r=a.home.resolve(a.c,{section:'payments',key:'patient_payment:'+p.id});assert.equal(r.item.target.paymentId,p.id);assert.equal(r.item.target.patientId,1);assert.equal(r.item.target.tab,'finance');const funds=a.billing.fundsSummary(1);a.payments.receive(a.c,command({action:'verify',patientId:1,paymentId:p.id,expectedPaymentRevision:1,expectedFundsRevision:funds.revision,outcome:'received',receivedAt:a.auth.now(),transactionEvidence:'已核实真实现金',keepAsPrepayment:true,allocations:[]}));assert.equal(section(a,a.c,'payments').total,0);assert.throws(()=>a.home.resolve(a.c,{section:'payments',key:'patient_payment:'+p.id}),e=>e.code==='HOME_TASK_CHANGED');
});
test('pending electronic order remains its own original business number and does not imply a successful payment',t=>{
 const a=require('./helpers/v2-settlements').setup(t),o=a.order();a.settlements.verifyOrder(a.c,command(a.orderResult(o.id,{outcome:'unknown'})));const s=section(a,a.c,'orders');assert.equal(s.total,1);assert.equal(s.items[0].source.id,o.id);assert.equal(s.items[0].target.orderId,o.id);assert.equal(s.items[0].status,'待核实');assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);
});
test('manager views fee approval with a stable original request; approval and actual refund are different queues',t=>{
 const a=require('./helpers/v2-fees').setupFees(t),r=a.request();const h=section(a,a.m,'feeRequests');assert.equal(h.total,1);assert.equal(h.items[0].target.requestId,r.id);assert.equal(h.items[0].target.page,'finance');assert.ok(!a.home.query(a.m).sections.some(s=>s.id==='clinical'));a.approve(r.id);assert.equal(section(a,a.m,'feeRequests').total,0);const f=a.begin(r.id);assert.equal(section(a,a.c,'refunds').items[0].target.refundId,f.id);assert.equal(a.db.prepare('SELECT status FROM patient_refund WHERE id=?').get(f.id).status,'待办理');
});
test('an older quote remains eligible for patient decision while the next version is only a draft',t=>{
 const a=setup(t),q=require('../scripts/lib/v2-quote-demo').prepareQuoteDemo(a),v=q.versions[0];a.quotes.prepare(a.d,command({action:'revise',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,reason:'另行编制，尚未出具'}));const h=a.home.query(a.c),draft=h.sections.find(s=>s.id==='quoteDrafts'),old=h.sections.find(s=>s.id==='quoteDecisions');assert.equal(draft.total,1);assert.equal(old.total,1);assert.notEqual(draft.items[0].key,old.items[0].key);assert.equal(old.items[0].target.quoteVersionId,v.id);assert.equal(a.db.prepare('SELECT count(*) n FROM quote_decision').get().n,0);
});
test('expired unaccepted quote leaves the acceptance queue without deleting quote facts',t=>{
 const a=setup(t);require('../scripts/lib/v2-quote-demo').prepareQuoteDemo(a);assert.equal(section(a,a.c,'quoteDecisions').total,1);a.setClock('2026-11-19T01:35:00Z');a.c=login(a,'cashier');assert.equal(section(a,a.c,'quoteDecisions').total,0);assert.equal(a.db.prepare('SELECT count(*) n FROM quote_version').get().n,1);assert.equal(a.db.prepare('SELECT count(*) n FROM quote_decision').get().n,0);
});
test('followup drafts do not appear as front desk contact work; only assigned, due published requirements do',t=>{
 const a=require('./helpers/v2-followups').setupFollowups(t),r=a.createFollowup({nextContactDate:'2026-10-20'});assert.equal(section(a,a.f,'followups').total,0);assert.equal(section(a,a.d,'followups').total,1);a.signSource();assert.equal(section(a,a.f,'followups').total,0);a.advance('2026-10-20T01:00:00Z');assert.equal(section(a,a.f,'followups').total,1);const task=section(a,a.f,'followups').items[0];assert.equal(task.target.followupId,r.id);assert.equal(task.target.page,'followups');
});
test('inventory tasks exclude completed purchasing and follow original count differences',t=>{
 const a=require('./helpers/v2-inventory').setupInventory(t,{receive:false});assert.equal(section(a,a.i,'purchases').total,1);a.receive();assert.equal(section(a,a.i,'purchases').total,0);const c=a.count(90);assert.equal(section(a,a.m,'counts').total,1);assert.equal(section(a,a.m,'counts').items[0].target.countId,c.id);a.approveCount(c.id);assert.equal(section(a,a.m,'counts').total,0);
});
test('elapsed expected restoration stays queued until the original resource is actually verified restored',t=>{
 const a=setup(t),b=a.resources.block(a.m,command({action:'block',chairId:2,startsAt:'2026-10-19T01:00:00Z',endsAt:'2026-10-19T01:20:00Z',reason:'准备未核验'}));assert.equal(section(a,a.f,'resources').total,1);a.resources.block(a.m,command({action:'restore',blockId:b.id,expectedRevision:1,confirmed:true,verificationNote:'已实际核验恢复'}));assert.equal(section(a,a.f,'resources').total,0);
});
test('pharmacy home separates review and actual unfilled quantity, without dispensing or charging on reads',t=>{
 const a=require('./helpers/v2-pharmacy').setup(t),p=a.inDraft();a.rxIssue(p);assert.equal(section(a,a.ph,'rxReview').total,1);assert.equal(section(a,a.ph,'dispense').total,0);a.approveRx();assert.equal(section(a,a.ph,'rxReview').total,0);assert.equal(section(a,a.ph,'dispense').total,1);a.give();assert.equal(section(a,a.ph,'dispense').total,1);a.give();assert.equal(section(a,a.ph,'dispense').total,0);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,2);
});
test('disabled institution never masquerades as active pharmacy authorization on home',t=>{
 const a=require('./helpers/v2-pharmacy').setup(t),p=a.inDraft();a.rxIssue(p);a.pharmacy.policy={enabled:false};const s=section(a,a.ph,'rxReview');assert.equal(s.total,1);assert.match(s.note,/未启用/);assert.throws(()=>a.approveRx(),e=>e.code==='PHARMACY_NOT_ENABLED');assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,0);
});
test('patient self-pay, confirmed insurance and actual fund receipts are not combined into a false successful collection',t=>{
 const a=require('./helpers/v2-settlements').setup(t);a.ready();a.submit();a.settle();assert.match(section(a,a.c,'insuranceFunds').items[0].note,/400\.00/);assert.match(section(a,a.c,'unpaid').items[0].note,/200\.00/);assert.equal(a.db.prepare('SELECT count(*) n FROM insurance_fund_receipt').get().n,0);const s=a.db.prepare('SELECT id FROM insurance_settlement').get();a.insurance.receipt(a.c,command({settlementId:s.id,expectedRevision:1,flowType:'拨付',amountCents:40000,occurredAt:a.auth.now(),reference:'HOME-INS-RECEIPT',evidence:'隔离官方实际回款核验'}));assert.equal(section(a,a.c,'insuranceFunds').total,0);
});
test('home source selection can reach an older item beyond the first preview and retains full section totals',t=>{
 const a=setup(t),s=a.service();for(let n=0;n<22;n++){const p=a.billing.draft(a.c,command({action:'draft',serviceId:s.id,unitPriceCents:1000+n,validFrom:'2026-10-19T00:00:00+08:00',reason:'待逐笔核实的独立价目提案'}));a.billing.draft(a.c,command({action:'submit',priceId:p.id,expectedRevision:1}));}
 const preview=section(a,a.m,'prices');assert.equal(preview.total,22);assert.equal(preview.items.length,8);const last=a.home.query(a.m,{section:'prices',page:2,pageSize:20}).sections[0];assert.equal(last.items.length,2);const source=last.items[1];assert.equal(a.home.resolve(a.m,{section:'prices',key:source.key}).item.source.id,source.source.id);assert.deepEqual(a.billing.catalog(a.m,{priceId:source.source.id}).prices.map(p=>p.id),[source.source.id]);
});
test('role selection, session revocation, sections, keys and date scope are rechecked at every read',t=>{
 const a=setup(t);assert.throws(()=>a.home.query(a.f,{section:'prices'}),e=>e.code==='HOME_SECTION');assert.throws(()=>a.home.resolve(a.f,{section:'prices',key:'service_price:1'}),e=>e.code==='HOME_TASK_CHANGED');assert.throws(()=>a.home.resolve(a.d,{section:'records',key:'javascript:bad'}),e=>e.code==='HOME_KEY');for(const q of [{date:'2026-10-18'},{page:0},{pageSize:51}])assert.throws(()=>a.home.query(a.d,q),e=>e.status===422);a.auth.logout(a.d.token);assert.throws(()=>a.home.query(a.d),e=>e.status===401);
});
test('home HTTP is read-only, protected by current role, serves its script and advertises a distinct UI build',async t=>{
 const a=setup(t);await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>a.server.close(resolve)));const base='http://127.0.0.1:'+a.server.address().port;assert.equal((await fetch(base+'/api/v2/home/query')).status,401);assert.equal((await fetch(base+'/home.js')).status,200);const headers={Cookie:'clinic_v2_session='+a.d.token,'X-Clinic-Role':'dentist'},res=await fetch(base+'/api/v2/home/query',{headers});assert.equal(res.status,200);const h=await res.json(),item=h.sections.find(s=>s.id==='records').items[0],target=await fetch(base+'/api/v2/home/target?'+new URLSearchParams({section:'records',key:item.key}),{headers});assert.equal(target.status,200);assert.equal((await target.json()).item.target.visitId,a.v.id);assert.equal((await fetch(base+'/api/v2/home/query',{method:'POST',headers})).status,404);assert.equal((await (await fetch(base+'/api/v2/status')).json()).buildVersion,BUILD);
});
test('approved insurance reversal remains a cashier verification task without being treated as a successful reversal',t=>{
 const a=require('./helpers/v2-settlements').setup(t);a.ready();a.submit();const s=a.settle(),r=a.insurance.reverse(a.m,command({action:'initiate',settlementId:s.id,expectedRevision:1,reason:'隔离核实原结算需撤销',approvalBasis:'负责人核对原单与撤销依据',evidence:'仅模拟批准，不表示平台已经撤销'}));assert.equal(a.bill().summary.insuranceReversalPending,true);const q=section(a,a.c,'insuranceReversals');assert.equal(q.total,1);assert.equal(q.items[0].status,'待办理');assert.equal(q.items[0].target.reversalId,r.id);const opened=a.home.resolve(a.c,{section:'insuranceReversals',key:q.items[0].key}).item.target;assert.equal(a.insurance.query(a.c,{patientId:opened.patientId,caseId:opened.caseId}).cases[0].id,opened.caseId);assert.equal(a.db.prepare('SELECT status FROM insurance_settlement WHERE id=?').get(s.id).status,'有效');assert.ok(!a.home.query(a.m).sections.some(s=>s.id==='insuranceReversals'));
});
test('original finance and followup filters keep a selected source distinct instead of returning a different first-page record',t=>{
 const a=require('./helpers/v2-fees').setupFees(t),r=a.request();assert.equal(a.fees.query(a.m,{patientId:1,requestId:r.id}).items[0].id,r.id);assert.equal(a.billing.query(a.c,{patientId:1,billId:a.billId}).items[0].id,a.billId);assert.throws(()=>a.billing.query(a.c,{patientId:2,billId:a.billId}),e=>e.code==='PATIENT_MISMATCH');assert.equal(a.followups.query(a.f,{patientId:1,followupId:999}).items.length,0);
});
test('revoking a pharmacy qualification immediately invalidates its home queues while retaining the original prescription',t=>{
 const a=require('./helpers/v2-pharmacy').setup(t),p=a.inDraft();a.rxIssue(p);assert.equal(section(a,a.ph,'rxReview').total,1);a.pharmacy.qualify(a.m,command({action:'revoke',qualificationId:a.qualification.id,confirmed:true,reason:'隔离核实资格撤销'}));assert.throws(()=>a.home.query(a.ph),e=>e.code==='FORBIDDEN');assert.equal(a.rxInfo().status,'已开立');assert.equal(a.rxInfo().review_status,'院内待审');
});
