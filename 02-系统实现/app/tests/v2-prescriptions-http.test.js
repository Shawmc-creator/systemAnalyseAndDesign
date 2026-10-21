'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-prescriptions');
async function server(t){const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));a.base='http://127.0.0.1:'+a.server.address().port;return a;}
const headers=c=>({'Content-Type':'application/json',Cookie:'clinic_v2_session='+c.token,'X-Clinic-Role':c.role,'X-CSRF-Token':c.csrf});
test('HTTP prescription queries and copies require valid session, physician role and visit scope; drafts cannot be delivered',async t=>{
 const a=await server(t),p=a.rxDraft(),url=a.base+'/api/v2/prescriptions/'+p.id+'/export';assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:headers(a.f)})).status,403);assert.equal((await fetch(url,{headers:headers(a.other)})).status,403);assert.equal((await fetch(url,{headers:headers(a.d)})).status,409);
 a.review();a.record();a.rxIssue(p);const r=await fetch(url,{headers:headers(a.d)});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment/);assert.match(r.headers.get('content-security-policy'),/sandbox/);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(await r.text(),/状态：已开立/);
 assert.equal((await fetch(a.base+'/prescriptions.js')).status,200);const q=await(await fetch(a.base+'/api/v2/prescriptions/query?'+new URLSearchParams(a.context),{headers:headers(a.d)})).json();assert.equal(q.prescriptions[0].contentIntact,true);assert.equal(q.inHouseEnabled,false);
});
test('HTTP command rechecks CSRF and grants and rejects the inactive in-house path before stock or billing changes',async t=>{
 const a=await server(t),input=command({...a.context,action:'dispense',reason:'验证未启用院内路径'}),post=async h=>fetch(a.base+'/api/v2/prescriptions/write',{method:'POST',headers:h,body:JSON.stringify(input)});
 assert.equal((await post(headers(a.i))).status,403);assert.equal((await post({...headers(a.d),'X-CSRF-Token':'bad'})).status,403);const r=await post(headers(a.d));assert.equal(r.status,409);assert.equal((await r.json()).code,'PHARMACY_NOT_ENABLED');assert.equal(a.db.prepare('SELECT count(*) n FROM inventory_movement').get().n,0);assert.equal(a.db.prepare('SELECT count(*) n FROM bill_item').get().n,0);
});
