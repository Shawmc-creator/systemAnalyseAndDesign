'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {createChainDemo}=require('../src/v2/chain-demo-server');
test('收费患者检索仅显示身份，账单明细按门店读取并标识来源',async t=>{
 const demo=createChainDemo();await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>demo.server.close(r));demo.db.close();});const base=`http://127.0.0.1:${demo.server.address().port}`;
 async function login(name,role){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,password:'Clinic123!'})}),v=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-clinic-role':role,'x-csrf-token':v.csrf};}
 const cash=await login('cashier','cashier'),front=await login('frontdesk','frontdesk'),get=(url,h=cash)=>fetch(base+url,{headers:h});const patient=demo.db.prepare('SELECT * FROM patient WHERE id=1').get();
 assert.equal((await get('/api/finance/patients?branchId=1&q='+encodeURIComponent(patient.name),front)).status,403);assert.equal((await get('/api/finance/patients?branchId=1&q=x')).status,422);
 const result=await (await get('/api/finance/patients?branchId=1&q='+encodeURIComponent(patient.name))).json();assert.ok(result.items.some(p=>p.id===1));assert.equal(JSON.stringify(result).includes(patient.phone),false);assert.equal(Object.hasOwn(result.items[0],'diagnosis'),false);
 const details=await (await get('/api/finance?branchId=1&patientId=1')).json();assert.ok(details.items[0].lines.length);assert.ok(details.items[0].lines[0].service_name);assert.equal(details.items[0].lines[0].source_verified,true);assert.ok(details.items[0].payments.length);assert.equal((await (await get('/api/finance?branchId=2&patientId=1')).json()).items.length,0);
});
