'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setupFees,command}=require('./helpers/v2-fees');
test('HTTP submit, return and resubmit expose exact snapshot evidence; replay, CSRF and roles preserve the original history',async t=>{
 const a=setupFees(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));
 const base='http://127.0.0.1:'+a.server.address().port+'/api/v2';
 async function login(username){const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})}),s=await r.json();return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf,'X-Clinic-Role':username};}
 async function send(route,headers,input){const r=await fetch(base+route,{method:input?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json()};}
 const c=await login('cashier'),m=await login('manager'),f=await login('frontdesk'),q=a.bills();
 const input=command({action:'submit',patientId:1,billId:a.billId,paymentId:a.payment.id,expectedFundsRevision:q.funds.revision,expectedBillRevision:q.items[0].revision,expectedPaymentRevision:1,adjustmentCents:-20000,refundCents:20000,reason:'HTTP第一轮申请原因',evidence:'HTTP原始证据'});
 assert.equal((await send('/fee-requests/apply',{...c,'X-CSRF-Token':''},input)).status,403);
 const first=await send('/fee-requests/apply',c,input);assert.equal(first.status,200);assert.equal((await send('/fee-requests/apply',c,input)).body.replayed,true);
 const returned=await send('/fee-request-decisions/approve',m,command({action:'return',patientId:1,requestId:first.body.id,expectedRevision:1,reviewNote:'HTTP负责人要求补充证据'}));assert.equal(returned.status,200);
 assert.equal((await send('/fee-requests/apply',c,command({...input,action:'resubmit',requestId:first.body.id,expectedRevision:2,refundCents:15000,adjustmentCents:-15000,evidence:'HTTP第二轮补齐证据'}))).status,200);
 const result=await send('/fee-requests/query?patientId=1',m);assert.equal(result.status,200);
 assert.deepEqual(result.body.items[0].history.map(h=>h.event_type),['提交','退回','提交']);assert.equal(result.body.items[0].history[0].evidence,'HTTP原始证据');assert.equal(result.body.items[0].history[2].proposed_refund_cents,15000);
 assert.equal((await send('/fee-requests/query?patientId=1',f)).status,403);
 assert.equal((await send('/services/options',m)).body.prices[0].history.length,2);
});
