'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-settlements');
const headers=c=>({'Content-Type':'application/json',Cookie:'clinic_v2_session='+c.token,'X-Clinic-Role':c.role,'X-CSRF-Token':c.csrf});
test('HTTP经营医保权限、CSRF及页面资源可用；正式支付重试不重复，状态不声称真实联网',async t=>{
 const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port;
 for(const file of ['settlements.js','insurance.js'])assert.equal((await fetch(base+'/'+file)).status,200);
 const status=await(await fetch(base+'/api/v2/status')).json();assert.deepEqual(status.pendingCoreUsecases,[]);assert.equal(status.insuranceApi.networkConnected,false);assert.equal(status.settlementApi.mode,'isolatedSimulation');
 assert.equal((await fetch(base+'/api/v2/insurance/query')).status,401);assert.equal((await fetch(base+'/api/v2/settlements/query',{headers:headers(a.d)})).status,403);assert.equal((await fetch(base+'/api/v2/insurance/query',{headers:headers(a.f)})).status,200);
 const b=a.bill(),body=command({billId:b.id,expectedRevision:b.revision,channel:'微信',amountCents:60000,evidence:'HTTP隔离演示原单核对'}),post=async(c,extra={})=>fetch(base+'/api/v2/payment-orders/create',{method:'POST',headers:{...headers(c),...extra},body:JSON.stringify(body)});
 assert.equal((await post(a.c,{'X-CSRF-Token':'bad'})).status,403);assert.equal((await post(a.f)).status,403);assert.equal((await post(a.c)).status,200);assert.equal((await(await post(a.c)).json()).replayed,true);assert.equal(a.db.prepare('SELECT count(*) n FROM payment_order').get().n,1);
});
