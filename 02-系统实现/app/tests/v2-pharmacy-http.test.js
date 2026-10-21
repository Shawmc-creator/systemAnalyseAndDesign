'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-pharmacy');
const headers=c=>({'Content-Type':'application/json',Cookie:'clinic_v2_session='+c.token,'X-Clinic-Role':c.role,'X-CSRF-Token':c.csrf});
async function serve(t){const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));a.base='http://127.0.0.1:'+a.server.address().port;return a;}
test('HTTP pharmacy separates personnel management, pharmacy-only clinical access and existing outside prescriptions',async t=>{
 const a=await serve(t),p=a.inDraft();assert.equal((await fetch(a.base+'/api/v2/pharmacy/query?prescriptionId='+p.id,{headers:headers(a.ph)})).status,403);a.rxIssue(p);
 const get=async(path,c)=>fetch(a.base+'/api/v2'+path,{headers:headers(c)});
 assert.equal((await get('/pharmacy/management',a.m)).status,200);assert.equal((await get('/pharmacy/management',a.ph)).status,403);assert.equal((await get('/pharmacy/query?prescriptionId='+p.id,a.m)).status,403);assert.equal((await get('/pharmacy/query?prescriptionId='+p.id,a.i)).status,403);assert.equal((await get('/pharmacy/query?prescriptionId='+p.id,a.ph)).status,200);assert.equal((await get('/prescriptions/query?'+new URLSearchParams(a.context),a.ph)).status,403);
 const outside=a.rxDraft({items:[{materialId:a.drug.id,expectedMaterialRevision:4,quantityScaled:10,directions:'演示院外用法'}]});assert.equal((await get('/pharmacy/query?prescriptionId='+outside.id,a.ph)).status,403);assert.equal((await fetch(a.base+'/pharmacy.js')).status,200);
});
test('HTTP review and actual dispensing require CSRF, preserve a single receipt and reject unsigned clinical bypasses',async t=>{
 const a=await serve(t),p=a.inDraft();a.rxIssue(p);const review=command({action:'approve',prescriptionId:p.id,patientId:1,expectedRevision:2,expectedLatestHealthVersionId:1,confirmed:true,reviewNote:'演示HTTP药学审核'}),post=async(path,c,body,h={})=>fetch(a.base+'/api/v2'+path,{method:'POST',headers:{...headers(c),...h},body:JSON.stringify(body)});
 assert.equal((await post('/pharmacy/review',a.ph,review,{'X-CSRF-Token':'bad'})).status,403);assert.equal((await post('/pharmacy/review',a.d,review)).status,403);
 assert.equal((await post('/pharmacy/review',a.ph,review)).status,200);const repeat=await post('/pharmacy/review',a.ph,review);assert.equal((await repeat.json()).replayed,true);
 const give=a.giveInput();assert.equal((await post('/pharmacy/dispense',a.ph,give)).status,200);const same=await post('/pharmacy/dispense',a.ph,give);assert.equal((await same.json()).replayed,true);assert.equal(a.stock().quantity_scaled,875);assert.equal(a.db.prepare('SELECT count(*) n FROM dispense_record').get().n,1);assert.equal(a.bills().totals.receivableCents,250);
});
