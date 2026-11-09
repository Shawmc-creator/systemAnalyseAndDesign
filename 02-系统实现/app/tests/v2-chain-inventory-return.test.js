'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('未用材料按原领用退回本店库存，拒绝超量、越权及跨店',async t=>{
 const demo=createChainDemo();await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>demo.server.close(r));demo.db.close();});const base='http://127.0.0.1:'+demo.server.address().port;
 async function login(username,role){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'Clinic123'})});const data=await r.json();return {'content-type':'application/json',cookie:r.headers.get('set-cookie').split(';')[0],'x-clinic-role':role,'x-csrf-token':data.csrf};}
 const assistant=await login('assistant','assistant'),dentist=await login('dentist','dentist');
 const list=async branch=>await (await fetch(base+'/api/inventory?branchId='+branch,{headers:assistant})).json(),post=(body,headers=assistant)=>fetch(base+'/api/inventory/issue',{method:'POST',headers,body:JSON.stringify(body)});
 let a=await list(1),b=await list(2);const stock=a.items[0],other=b.items[0];
 const issue={branchId:1,stockId:stock.stockId,expectedStockRevision:stock.revision,quantityScaled:10,reason:'虚构领用',requestKey:'return-test-issue',commandVersion:1};assert.equal((await post(issue)).status,200);
 a=await list(1);const original=a.issues.find(x=>x.stockId===stock.stockId);assert.ok(original);assert.equal(original.remainingScaled,10);
 const ret={action:'return',branchId:1,stockId:stock.stockId,originalMovementId:original.id,expectedStockRevision:original.stockRevision,quantityScaled:4,reason:'虚构未用退回',requestKey:'return-test',commandVersion:1};
 assert.equal((await post(ret,dentist)).status,403);assert.equal((await post({...ret,branchId:2,stockId:other.stockId,expectedStockRevision:other.revision,requestKey:'cross-return'})).status,409);
 assert.equal((await post({...ret,quantityScaled:11,requestKey:'excess-return'})).status,409);const first=await post(ret);assert.equal(first.status,200,await first.clone().text());assert.equal((await post(ret)).status,200);
 a=await list(1);b=await list(2);assert.equal(a.items[0].quantityScaled,94);assert.equal(b.items[0].quantityScaled,60);assert.equal(a.issues.find(x=>x.id===original.id).remainingScaled,6);assert.ok(a.movements.some(x=>x.movement_type==='未用退回'&&x.original_movement_id===original.id));assert.equal(b.movements.length,0);
 assert.equal((await post({...ret,expectedStockRevision:a.items[0].revision,quantityScaled:7,requestKey:'excess-after-return'})).status,409);
});
