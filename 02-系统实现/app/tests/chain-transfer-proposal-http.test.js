'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChainDemo}=require('../src/v2/chain-demo-server');
test('交接申请接口保留原预约，撤回后目标店可见状态',async()=>{
 const demo=createChainDemo();await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+demo.server.address().port;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})}),user=await login.json();
  const headers={'content-type':'application/json',cookie:login.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk','x-csrf-token':user.csrf};
  const a=demo.db.prepare("SELECT id,revision FROM appointment WHERE branch_id=2 AND status='已预约' LIMIT 1").get();assert.ok(a);
  const post=data=>fetch(base+'/api/transfer-proposals',{method:'POST',headers,body:JSON.stringify(data)});
  const response=await post({action:'propose',branchId:2,targetBranchId:1,appointmentId:a.id,expectedRevision:a.revision,patientConfirmed:true,contactedAt:demo.app.auth.now(),method:'电话',contactNote:'虚构患者同意',reason:'虚构转店申请',requestKey:'http-transfer-propose',commandVersion:1});assert.equal(response.status,200,await response.clone().text());const p=await response.json();
  const list=await fetch(base+'/api/transfer-proposals?branchId=1',{headers});assert.equal((await list.json()).items.find(x=>x.id===p.id).status,'待目标店确认');
  const withdrawn=await post({action:'withdraw',branchId:2,proposalId:p.id,reason:'患者改变计划',requestKey:'http-transfer-withdraw',commandVersion:1});assert.equal(withdrawn.status,200,await withdrawn.clone().text());
  const updated=await fetch(base+'/api/transfer-proposals?branchId=1',{headers});assert.equal((await updated.json()).items.find(x=>x.id===p.id).status,'已撤回');assert.equal(demo.db.prepare('SELECT status FROM appointment WHERE id=?').get(a.id).status,'已预约');
 }finally{await new Promise(r=>demo.server.close(r));demo.db.close();}
});
