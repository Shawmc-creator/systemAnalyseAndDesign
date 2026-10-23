'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
const {signaturePayload}=require('../src/v2/clinical-gates');
function record(a){return a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(a.v.id);}
function health(a,reviewOnly=false){return a.clinical.health(a.d,command({...a.context,action:reviewOnly?'review':'record',expectedHealthVersionId:reviewOnly?a.db.prepare('SELECT id FROM health_version').get().id:null,
 conclusion:'当次已询问，未确认信息保留未知',reason:'隔离验收资料',items:['病史','过敏','用药'].map(category=>({category,certainty:'未知',content:'未取得明确报告',source:'虚构验收患者报告',reportedAt:a.auth.now()}))}));}
function save(a,extra={}){const r=record(a);return a.clinical.record(a.d,command({...a.context,action:'save',recordId:r.id,expectedRevision:r.revision,chiefComplaint:'隔离验收主诉',diagnosis:'未确定事项如实记录',treatmentAdvice:'由接诊牙医记录实际意见',findings:[{text:'当次检查所见'}],...extra}));}
function sign(a){const r=record(a);return a.clinical.sign(a.d,command({action:'sign',recordId:r.id,expectedRevision:r.revision,confirmed:true}));}
function finish(a){const v=a.db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id);
 return a.resources.finish(a.d,command({visitId:v.id,expectedVisitRevision:v.revision,expectedOccupancyRevision:o.revision,endedAt:a.auth.now(),confirmed:true,reason:'牙医确认本次实际操作结束，交助理清洁'}));}
function scope(a,quantity=2,planned=4){const v=a.draft([{description:'需逐次确认范围的项目',quantity:planned}]);a.publish(v.id);const i=a.info().plans[0].versions[0].items[0];
 a.decide(v.id,2,{wholeScope:false,itemIds:[i.id],itemScopes:[{itemId:i.id,quantity}]});return {v,i,s:a.service()};}
function decide(a,v,i,extra){return a.decide(v.id,a.db.prepare('SELECT revision FROM plan_version WHERE id=?').get(v.id).revision,{wholeScope:false,itemIds:[i.id],...extra});}

test('UC-06 incomplete draft saves without manufacturing findings or diagnosis; signature still requires completeness',t=>{
 const a=setup(t);save(a,{chiefComplaint:'仅先记主诉',diagnosis:'',treatmentAdvice:'',findings:[]});
 assert.equal(record(a).diagnosis,null);assert.equal(record(a).status,'草稿');assert.equal(a.db.prepare('SELECT count(*) n FROM clinical_finding').get().n,0);
 assert.throws(()=>sign(a),e=>e.code==='INVALID_INPUT');assert.equal(record(a).status,'草稿');
});
test('UC-24 actual end precedes signing; ended unsigned draft remains editable and can be completed and signed',t=>{
 const a=setup(t);a.setClock('2026-10-19T01:40:00Z');const end=finish(a),ended=a.db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id);
 assert.equal(ended.status,'诊疗结束');assert.equal(ended.ended_at,a.auth.now());assert.equal(record(a).status,'草稿');
 assert.equal(a.db.prepare('SELECT count(*) n FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id).n,0);
 assert.equal(a.db.prepare('SELECT status FROM resource_block WHERE id=?').get(end.id).status,'生效中');
 a.setClock('2026-10-19T01:45:00Z');health(a);save(a);sign(a);
 assert.equal(record(a).signed_at,a.auth.now());assert.equal(a.db.prepare('SELECT ended_at FROM visit WHERE id=?').get(a.v.id).ended_at,ended.ended_at);
 assert.equal(a.clinical.detail(a.d,a.context).signedIntegrity,true);
 assert.throws(()=>a.execute(a.service().id,{independentCheck:true,independentBasis:'检查'}),e=>e.code==='VERSION_CONFLICT'||e.code==='VISIT_NOT_ACTIVE');
});
test('UC-09 signature freezes exactly the selected latest review and does not set actual end or release resources',t=>{
 const a=setup(t);health(a);const selected=health(a,true);save(a);sign(a);const signed=record(a);
 assert.equal(signed.signed_health_review_id,selected.id);assert.deepEqual(signaturePayload(a.db,signed).healthReviews.map(r=>r.id),[selected.id]);
 assert.equal(a.db.prepare('SELECT ended_at FROM visit WHERE id=?').get(a.v.id).ended_at,null);
 a.setClock('2026-10-19T01:50:00Z');finish(a);
 assert.equal(a.db.prepare('SELECT ended_at FROM visit WHERE id=?').get(a.v.id).ended_at,a.auth.now());assert.notEqual(a.auth.now(),signed.signed_at);
 assert.equal(a.clinical.detail(a.d,a.context).signedIntegrity,true);
});
test('UC-09 repeated signature with a new submission returns original result without incrementing versions',t=>{
 const a=setup(t);health(a);save(a);const first=sign(a),before=record(a);
 const again=a.clinical.sign(a.d,command({action:'sign',recordId:before.id,expectedRevision:before.signed_revision,confirmed:true}));
 assert.equal(again.id,first.id);assert.equal(again.code,'ALREADY_SIGNED');assert.deepEqual(record(a),before);
});
test('UC-07 requires explicit quantity or explicit whole-item scope, rejects missing and contradictory choices atomically',t=>{
 const a=setup(t),v=a.draft();a.publish(v.id);const i=a.info().plans[0].versions[0].items[0];
 for(const extra of [{itemIds:[i.id]},{itemIds:[i.id],itemScopes:[{itemId:i.id,quantity:0}]},{itemIds:[i.id],itemScopes:[{itemId:i.id,quantity:4}]},{itemIds:[i.id],itemScopes:[{itemId:i.id,wholeItem:true,quantity:1}]}])
  assert.throws(()=>a.decide(v.id,2,{wholeScope:false,...extra}),e=>['DECISION_QUANTITY','INVALID_INPUT'].includes(e.code));
 assert.equal(a.db.prepare('SELECT count(*) n FROM patient_decision').get().n,0);assert.equal(a.db.prepare('SELECT revision FROM plan_version WHERE id=?').get(v.id).revision,2);
});
test('UC-08 quantity within plan but outside patient consent rolls execution and charges back',t=>{
 const a=setup(t),{i,s}=scope(a,2,4);a.price(s.id);
 assert.throws(()=>a.execute(s.id,{planItemId:i.id,quantity:3}),e=>e.code==='CONSENT_QUANTITY_EXCEEDED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM bill_item').get().n,0);
 a.execute(s.id,{planItemId:i.id,quantity:2});assert.equal(a.info().plans[0].versions[0].items[0].remainingConsentQuantity,0);
 assert.throws(()=>a.execute(s.id,{planItemId:i.id}),e=>e.code==='CONSENT_REQUIRED');
});
test('UC-07 repeated consent replaces the effective ceiling rather than adding quantities',t=>{
 const a=setup(t),{v,i,s}=scope(a,2,4);decide(a,v,i,{itemScopes:[{itemId:i.id,quantity:1}]});
 assert.equal(a.info().plans[0].versions[0].items[0].consentedQuantity,1);
 assert.throws(()=>a.execute(s.id,{planItemId:i.id,quantity:2}),e=>e.code==='CONSENT_QUANTITY_EXCEEDED');
 a.execute(s.id,{planItemId:i.id});assert.equal(a.info().plans[0].versions[0].items[0].effectiveQuantity,1);
});
test('UC-07 partial withdrawal preserves performed facts and only removes the withdrawn unperformed quota',t=>{
 const a=setup(t),{v,i,s}=scope(a,3,4);a.execute(s.id,{planItemId:i.id});
 decide(a,v,i,{decision:'撤回',itemScopes:[{itemId:i.id,quantity:1}]});
 const info=a.info().plans[0].versions[0];assert.equal(info.status,'已确认');assert.equal(info.items[0].effectiveQuantity,1);assert.equal(info.items[0].remainingConsentQuantity,1);
 a.execute(s.id,{planItemId:i.id});assert.throws(()=>a.execute(s.id,{planItemId:i.id}),e=>e.code==='CONSENT_REQUIRED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM patient_decision').get().n,2);
});
test('UC-08 correcting execution cannot inflate original consent quantity or overwrite original bill',t=>{
 const a=setup(t),{i,s}=scope(a,1,4);a.price(s.id);const original=a.execute(s.id,{planItemId:i.id});
 assert.throws(()=>a.execute(s.id,{planItemId:i.id,originalExecutionId:original.id,quantity:2,reason:'核对数量'}),e=>e.code==='CONSENT_QUANTITY_EXCEEDED');
 assert.equal(a.db.prepare('SELECT count(*) n FROM treatment_execution').get().n,1);assert.equal(a.bills().totals.receivableCents,20000);
});
test('UC-07 completion uses consented quantities and explicit declined items instead of forcing unconsented treatment',t=>{
 const a=setup(t),v=a.draft([{description:'已同意的项目',quantity:4},{description:'患者拒绝的项目',quantity:2}]);a.publish(v.id);
 const [first,second]=a.info().plans[0].versions[0].items;
 decide(a,v,first,{itemScopes:[{itemId:first.id,quantity:1}]});decide(a,v,second,{decision:'拒绝',wholeItems:true});
 a.execute(a.service().id,{planItemId:first.id});
 const done=a.plan({action:'completeVersion',versionId:v.id,expectedRevision:4});assert.equal(done.revision,5);
 assert.equal(a.info().plans[0].versions[0].status,'本版执行完成');
});
module.exports={health,save,sign,finish};
