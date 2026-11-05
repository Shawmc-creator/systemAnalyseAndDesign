'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
function fixture(t,{plan=true,items=1}={}){
 const a=setup(t),s=a.service();a.price(s.id);let pv=null;
 if(plan){pv=a.draft(Array.from({length:items},(_,i)=>({description:'隔离报价范围'+i,toothCode:String(46-i),surfaceCode:'O',quantity:3,estimatedCents:80000})));a.publish(pv.id);a.decide(pv.id);}
 const planItems=pv?a.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=? ORDER BY sequence_no').all(pv.id):Array.from({length:items},()=>({id:null,tooth_code:null,surface_code:null}));
 a.quoteItems=planItems.map(i=>({planItemId:i.id,serviceId:s.id,toothCode:i.tooth_code,surfaceCode:i.surface_code,quantity:3,scopeNote:'含本项操作；材料另行说明，不含其他疗程'}));a.sid=s.id;
 a.make=(extra={})=>a.quotes.prepare(a.d,command({action:'create',patientId:1,visitId:a.v.id,sourcePlanVersionId:pv?.id||null,items:a.quoteItems,reason:'隔离测试如实编制',...extra}));
 a.qread=(cred=a.c)=>a.quotes.query(cred).quotes[0];
 a.issue=(v,extra={})=>{const q=a.qread(),version=q.versions.find(x=>x.id===v);return a.quotes.issue(a.c,command({versionId:v,expectedRevision:version.revision,expectedQuoteRevision:q.revision,validFrom:'2026-10-19',validUntil:'2026-10-20',prices:version.items.map(i=>({itemId:i.id,priceId:a.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用'").get(i.service_id).id})),reason:'隔离核实价目出具',...extra}));};
 a.qdecide=(decision='接受',extra={})=>{const q=a.qread(),v=q.versions.filter(v=>v.issued_at).at(-1);return a.quotes.decide(a.c,command({versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,decision,decidedAt:a.auth.now(),confirmationBasis:'隔离患者当面明确决定',itemIds:v.items.map(i=>i.id),...extra}));};
 a.quote=a.make();return a;
}
test('draft leaves money unknown and makes no bill; explicit approved issue freezes snapshots; fees and clinical consent stay separate',t=>{
 const a=fixture(t);let q=a.qread(),v=q.versions[0];assert.equal(v.items[0].amount_cents,null);assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);
 a.issue(v.id);q=a.qread();v=q.versions[0];assert.equal(v.items[0].amount_cents,60000);assert.equal(v.items[0].unit_price_cents,20000);assert.equal(v.status,'已出具');assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);
 a.qdecide();assert.equal(a.qread().versions[0].status,'已接受');assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n,0);
 assert.throws(()=>a.db.prepare('UPDATE quote_item SET quantity=4 WHERE id=?').run(v.items[0].id),/quote_item_frozen/);
 assert.throws(()=>a.db.prepare('UPDATE quote_version SET source_plan_version_id=NULL WHERE id=?').run(v.id),/quote_version_frozen/);
});
test('partial decisions append evidence, support defer and withdrawal, never overwrite original decisions',t=>{
 const a=fixture(t,{items:2});a.issue(a.quote.id);let v=a.qread().versions[0];a.qdecide('接受',{itemIds:[v.items[0].id]});assert.equal(a.qread().versions[0].status,'部分接受');
 a.qdecide('暂缓',{itemIds:[v.items[1].id]});a.qdecide('撤回',{itemIds:[v.items[0].id]});v=a.qread().versions[0];assert.equal(v.status,'已出具');assert.deepEqual(v.items[0].decisions.map(d=>d.decision_type),['接受','撤回']);
 assert.throws(()=>a.db.exec("UPDATE quote_decision SET confirmation_basis='覆盖'"),/quote_decision_frozen/);assert.throws(()=>a.db.exec('DELETE FROM quote_decision'),/quote_decision_frozen/);
});
test('draft revision preserves effective old acceptance until new issue, then old version is retained as superseded',t=>{
 const a=fixture(t);a.issue(a.quote.id);a.qdecide();let q=a.qread(),old=q.versions[0];const r=a.quotes.prepare(a.d,command({action:'revise',versionId:old.id,expectedRevision:old.revision,expectedQuoteRevision:q.revision,reason:'患者修改范围'}));
 assert.equal(a.qread().versions[0].status,'已接受');assert.equal(a.qread().versions[1].items[0].amount_cents,null);
 a.issue(r.id);q=a.qread();assert.equal(q.versions[0].status,'已替代');assert.equal(q.versions[0].items[0].decisions[0].decision_type,'接受');assert.equal(q.versions[1].status,'已出具');
 assert.throws(()=>a.quotes.decide(a.c,command({versionId:old.id,expectedRevision:q.versions[0].revision,expectedQuoteRevision:q.revision,decision:'接受'})),e=>e.code==='QUOTE_NOT_CURRENT');
});
test('expiry prevents new and backdated acceptance but preserves already accepted historical scope',t=>{
 const a=fixture(t,{items:2});a.issue(a.quote.id);let v=a.qread().versions[0];a.qdecide('接受',{itemIds:[v.items[0].id]});a.setClock('2026-10-21T01:35:00Z');
 const fresh=a.auth.login({username:'cashier',password:'Clinic123!'});a.c={token:fresh.token,csrf:fresh.csrf,role:'cashier'};
 assert.throws(()=>a.qdecide('接受',{itemIds:[v.items[1].id],decidedAt:'2026-10-19T01:35:00Z'}),e=>e.code==='QUOTE_EXPIRED');v=a.qread().versions[0];assert.equal(v.status,'部分接受');assert.equal(v.items[0].latestDecision.decision_type,'接受');
});
test('approved quote relates actual work and charges; fee acceptance does not replace medical consent',t=>{
 const a=fixture(t);a.issue(a.quote.id);a.qdecide();const i=a.qread().versions[0].items[0];a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});const b=a.db.prepare('SELECT * FROM bill_item').get();assert.equal(b.quote_item_id,i.id);assert.equal(b.amount_cents,20000);assert.equal(b.pricing_status,'已核价');
});
test('unaccepted quote holds pricing, still saves actual work; approved pricing cannot bypass fee decision',t=>{
 const a=fixture(t);a.issue(a.quote.id);const i=a.qread().versions[0].items[0];a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});let b=a.db.prepare('SELECT * FROM bill_item').get();assert.equal(b.pricing_status,'待核价');assert.equal(b.amount_cents,null);assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,1);
 const price=a.db.prepare('SELECT id FROM service_price').get();assert.throws(()=>a.billing.approve(a.m,command({action:'pricePending',billItemId:b.id,expectedRevision:b.revision,priceId:price.id,reviewNote:'不能绕过'})),e=>e.code==='QUOTE_PRICE_REVIEW');
 a.qdecide();a.billing.approve(a.m,command({action:'pricePending',billItemId:b.id,expectedRevision:b.revision,priceId:price.id,reviewNote:'实际核对患者后确认价目'}));b=a.db.prepare('SELECT * FROM bill_item').get();assert.equal(b.pricing_status,'已核价');
});
test('quote-linked payment is a single real prepayment with no artificial bill, acceptance or revenue',t=>{
 const a=fixture(t);a.issue(a.quote.id);const q=a.qread(),input=command({action:'receive',patientId:1,expectedFundsRevision:null,quoteId:q.id,receivedCents:10000,changeCents:0,channel:'现金',verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'隔离实际现金核实',keepAsPrepayment:true,allocations:[]});
 const r=a.payments.receive(a.c,input);assert.equal(a.payments.receive(a.c,input).replayed,true);assert.equal(a.db.prepare('SELECT quote_id FROM patient_payment WHERE id=?').get(r.id).quote_id,q.id);assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);assert.equal(a.billing.fundsSummary(1).availableCents,10000);assert.equal(a.qread().versions[0].status,'已出具');
 a.qdecide('撤回');assert.equal(a.db.prepare('SELECT status FROM patient_payment').get().status,'到账已确认');assert.equal(a.db.prepare('SELECT count(*) n FROM patient_refund').get().n,0);
});
test('role, cross-patient, source and price misuse roll back without successful receipt',t=>{
 const a=fixture(t);assert.throws(()=>a.quotes.query(a.f),e=>e.code==='FORBIDDEN');assert.throws(()=>a.quotes.prepare(a.c,command({action:'create',reason:'越权'})),e=>e.code==='FORBIDDEN');assert.throws(()=>a.issue(a.quote.id,{prices:[]}),e=>e.code==='QUOTE_PRICES');
 assert.throws(()=>a.make({patientId:2}),e=>e.code==='QUOTE_PATIENT');assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_quote').get().n,1);assert.equal(a.qread().versions[0].status,'草稿');
 assert.equal(a.quotes.query(a.other).quotes.length,0);assert.throws(()=>a.quotes.query(a.other,{quoteId:a.qread().id}),e=>e.code==='QUOTE_SCOPE_ACCESS');
});
test('independent check quote is explicitly linked to its actual charge and does not require a treatment plan',t=>{
 const a=fixture(t,{plan:false});a.issue(a.quote.id);a.qdecide();const i=a.qread().versions[0].items[0];a.execute(a.sid,{independentCheck:true,independentBasis:'真实独立检查依据',quoteItemId:i.id});assert.equal(a.db.prepare('SELECT quote_item_id FROM bill_item').get().quote_item_id,i.id);
});
test('dentist can list owned quotes and source items without receiving bank references or unrelated patients clinical records',t=>{
 const a=fixture(t);const d=a.quotes.query(a.d);assert.equal(d.quotes[0].id,a.qread().id);assert.equal(d.plans[0].items[0].description,'隔离报价范围0');assert.equal('diagnostic_basis'in d.plans[0],false);assert.equal('funds'in d.quotes[0],false);
});
test('issue cannot use an unapproved price or a price for another project; failure leaves draft items and old version unchanged',t=>{
 const a=fixture(t),s=a.service(),p=a.price(s.id,{},false),q=a.qread(),v=q.versions[0];
 assert.throws(()=>a.issue(v.id,{prices:[{itemId:v.items[0].id,priceId:p.id}]}),e=>e.code==='QUOTE_PRICE');assert.equal(a.qread().versions[0].items[0].amount_cents,null);assert.equal(a.qread().revision,q.revision);
});
test('quote source must be the exact same plan version and patient; guessed line identifiers are rejected atomically',t=>{
 const a=fixture(t),other=a.draft();a.publish(other.id);const item=a.db.prepare('SELECT id FROM plan_item WHERE plan_version_id=?').get(other.id);
 assert.throws(()=>a.make({items:[{...a.quoteItems[0],planItemId:item.id}]}),e=>e.code==='QUOTE_SOURCE');assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_quote').get().n,1);
});
test('issue and decision honor optimistic revisions and request-key replay; duplicate submissions append no extra decisions',t=>{
 const a=fixture(t);assert.throws(()=>a.issue(a.quote.id,{expectedRevision:20}),e=>e.code==='VERSION_CONFLICT');a.issue(a.quote.id);const q=a.qread(),v=q.versions[0],c=command({versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,decision:'接受',decidedAt:a.auth.now(),confirmationBasis:'患者已明确接受',itemIds:v.items.map(i=>i.id)});
 a.quotes.decide(a.c,c);assert.equal(a.quotes.decide(a.c,c).replayed,true);assert.equal(a.db.prepare('SELECT count(*) n FROM quote_decision').get().n,1);assert.throws(()=>a.quotes.decide(a.c,command({...c,requestKey:'separate-stale-decision'})),e=>e.code==='VERSION_CONFLICT');
});
test('acceptance cannot be backfilled after treatment to silently price the original work, and new clinical work retains medical consent rules',t=>{
 const a=fixture(t);a.issue(a.quote.id);const i=a.qread().versions[0].items[0];a.setClock('2026-10-19T01:36:00Z');a.qdecide();a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O',completedAt:'2026-10-19T01:35:00Z'});assert.equal(a.db.prepare('SELECT pricing_status FROM bill_item').get().pricing_status,'待核价');
 const pv=a.db.prepare('SELECT * FROM plan_version').get();a.plan({action:'decide',versionId:pv.id,expectedRevision:pv.revision,decision:'撤回',wholeScope:true,decidedAt:a.auth.now(),explanationBasis:'患者明确撤回医疗治疗同意',scopeNote:'全部原范围'});assert.throws(()=>a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'}),e=>/CONSENT/.test(e.code)||e.code==='PLAN_NOT_EXECUTABLE');
});
test('accepted quote quantity limits pricing without discarding actual treatment outside its monetary scope',t=>{
 const a=fixture(t);const q=a.qread(),v=q.versions[0];a.quotes.prepare(a.d,command({action:'edit',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,items:[{...a.quoteItems[0],quantity:1}],reason:'仅先确认一次费用范围'}));a.issue(v.id);a.qdecide();const i=a.qread().versions[0].items[0];a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});const b=a.db.prepare('SELECT * FROM bill_item ORDER BY id').all();assert.deepEqual(b.map(x=>x.pricing_status),['已核价','待核价']);assert.match(b[1].pricing_note,/数量/);assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,2);
});
test('a changed actual price holds fees until a new version is explained and accepted; manager can choose the new scope for pending pricing',t=>{
 const a=fixture(t);a.issue(a.quote.id);a.qdecide();const oldPrice=a.db.prepare('SELECT * FROM service_price').get();a.billing.approve(a.m,command({action:'stop',priceId:oldPrice.id,expectedRevision:oldPrice.revision,reviewNote:'原项目价格调整'}));a.price(a.sid,{unitPriceCents:25000});
 const old=a.qread().versions[0].items[0];a.execute(a.sid,{planItemId:old.plan_item_id,toothCode:'46',surfaceCode:'O'});let b=a.db.prepare('SELECT * FROM bill_item').get();assert.equal(b.pricing_status,'待核价');assert.match(b.pricing_note,/金额不一致/);
 let q=a.qread(),v=q.versions[0];const r=a.quotes.prepare(a.d,command({action:'revise',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,reason:'已向患者说明最新费用'}));a.issue(r.id);a.qdecide();const current=a.qread().versions.at(-1).items[0],price=a.db.prepare("SELECT id FROM service_price WHERE status='已确认可适用'").get();assert.ok(a.billing.catalog(a.m).pendingItems[0].quoteOptions.some(i=>i.id===current.id));
 a.billing.approve(a.m,command({action:'pricePending',billItemId:b.id,expectedRevision:b.revision,priceId:price.id,quoteItemId:current.id,reviewNote:'按实际发生时点及已重新确认的费用核价'}));b=a.db.prepare('SELECT * FROM bill_item').get();assert.equal(b.pricing_status,'已核价');assert.equal(b.quote_item_id,current.id);assert.equal(b.amount_cents,25000);
});
test('quote payment belongs to the same patient and cannot repoint an existing original payment to another quote',t=>{
 const a=fixture(t);a.issue(a.quote.id);const q=a.qread();assert.throws(()=>a.payments.receive(a.c,command({action:'receive',patientId:2,expectedFundsRevision:null,quoteId:q.id})),e=>e.code==='QUOTE_PATIENT');assert.equal(a.db.prepare('SELECT count(*) n FROM patient_funds').get().n,0);
 const c=command({action:'receive',patientId:1,expectedFundsRevision:null,quoteId:q.id,receivedCents:10000,changeCents:0,channel:'现金',verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'实际现金',keepAsPrepayment:true,allocations:[]}),p=a.payments.receive(a.c,c);assert.throws(()=>a.db.prepare('UPDATE patient_payment SET quote_id=NULL WHERE id=?').run(p.id),/quote_identity_frozen/);
});
test('HTTP quote endpoints require login, role and CSRF; normal issued quote round trip and static page script work',async t=>{
 const a=fixture(t);await new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>a.server.close(resolve)));const base='http://127.0.0.1:'+a.server.address().port;
 assert.equal((await fetch(base+'/api/v2/quotes/query')).status,401);assert.equal((await fetch(base+'/quotes.js')).status,200);
 const headers={'Content-Type':'application/json',Cookie:'clinic_v2_session='+a.c.token,'X-Clinic-Role':'cashier'};
 assert.equal((await fetch(base+'/api/v2/quotes/query',{headers})).status,200);assert.equal((await fetch(base+'/api/v2/quotes/issue',{method:'POST',headers,body:JSON.stringify(command({}))})).status,403);
 const q=a.qread(),v=q.versions[0],price=a.db.prepare('SELECT id FROM service_price').get();const r=await fetch(base+'/api/v2/quotes/issue',{method:'POST',headers:{...headers,'X-CSRF-Token':a.c.csrf},body:JSON.stringify(command({versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,validFrom:'2026-10-19',validUntil:'2026-10-20',prices:[{itemId:v.items[0].id,priceId:price.id}],reason:'HTTP隔离验收'}))});assert.equal(r.status,200);assert.equal((await r.json()).kind,'quote_version');assert.equal(a.qread().versions[0].status,'已出具');
});
test('a draft can explicitly follow a revised source-plan version; issued content still cannot be repointed',t=>{
 const a=fixture(t),old=a.db.prepare('SELECT * FROM plan_version').get(),plan=a.db.prepare('SELECT * FROM treatment_plan').get();
 const next=a.plan({action:'revise',versionId:old.id,expectedRevision:old.revision,expectedPlanRevision:plan.revision,diagnosticBasis:'同患者新检查依据',plannedSchedule:'重新核对安排',reason:'患者修改治疗范围'});a.publish(next.id);
 assert.throws(()=>a.issue(a.quote.id),e=>e.code==='QUOTE_SOURCE');const q=a.qread(),v=q.versions[0],i=a.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=?').get(next.id);
 a.quotes.prepare(a.d,command({action:'edit',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,sourcePlanVersionId:next.id,items:[{...a.quoteItems[0],planItemId:i.id}],reason:'按最新已说明的方案重新编制'}));a.issue(v.id);assert.equal(a.qread().versions[0].source_plan_version_id,next.id);assert.throws(()=>a.db.prepare('UPDATE quote_version SET source_plan_version_id=? WHERE id=?').run(old.id,v.id),/quote_version_frozen/);
});
test('an unissued draft cannot become a referenced charge and prevent further draft editing',t=>{
 const a=fixture(t),q=a.qread(),v=q.versions[0],i=v.items[0];assert.throws(()=>a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O',quoteItemId:i.id}),e=>e.code==='QUOTE_NOT_ISSUED');assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,0);
 a.quotes.prepare(a.d,command({action:'edit',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,items:a.quoteItems,reason:'继续正常编制'}));assert.equal(a.qread().versions[0].revision,2);
});
test('correcting an execution retains its consumed quote quantity through the original charge link',t=>{
 const a=fixture(t),q=a.qread(),v=q.versions[0];a.quotes.prepare(a.d,command({action:'edit',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,items:[{...a.quoteItems[0],quantity:1}],reason:'先确认一次'}));a.issue(v.id);a.qdecide();const i=a.qread().versions[0].items[0],first=a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});
 a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O',originalExecutionId:first.id,reason:'追加真实操作说明的更正'});a.execute(a.sid,{planItemId:i.plan_item_id,toothCode:'46',surfaceCode:'O'});const b=a.db.prepare('SELECT pricing_status FROM bill_item ORDER BY id').all();assert.deepEqual(b.map(x=>x.pricing_status),['已核价','待核价']);
});
