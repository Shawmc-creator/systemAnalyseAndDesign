'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {createChainDemo}=require('../src/v2/chain-demo-server');
test('隔离演示快照保留数据，拒绝并发打开和错误文件',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-persist-'));t.after(()=>{if(!path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'chain-persist-'))throw Error('临时目录不符');fs.rmSync(folder,{recursive:true,force:true});});
 const file=path.join(folder,'chain-demo.snapshot.sqlite');let demo=createChainDemo({snapshotPath:file});await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${demo.server.address().port}`;const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})});assert.equal(login.status,200);const session=await login.json(),headers={cookie:login.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':'frontdesk','x-csrf-token':session.csrf};
 const patient={action:'patient',branchId:2,fields:{name:'虚构持久演示患者',phone:'13800006666',phone_owner:'本人'},reason:'测试跨重启',requestKey:'persistence-test-patient',commandVersion:1};
 const r=await fetch(base+'/api/setup',{method:'POST',headers,body:JSON.stringify(patient)});assert.equal(r.status,200,await r.clone().text());const id=(await r.json()).id;
 const managerLogin=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'manager',password:'Clinic123'})});const managerData=await managerLogin.json(),managerHeaders={cookie:managerLogin.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':'manager','x-csrf-token':managerData.csrf};
 const options=await (await fetch(base+'/api/schedules?branchId=2',{headers:managerHeaders})).json();const schedule={action:'publish',branchId:2,dentistId:options.dentists[0].id,chairId:options.chairs[0].id,businessDate:'2026-10-22',startsAt:'2026-10-22T01:00:00Z',endsAt:'2026-10-22T09:00:00Z',reason:'虚构排班',requestKey:'persistent-schedule',commandVersion:1};
 const sr=await fetch(base+'/api/setup',{method:'POST',headers:managerHeaders,body:JSON.stringify(schedule)});assert.equal(sr.status,200,await sr.clone().text());const scheduleId=(await sr.json()).id;
 const book={action:'create',branchId:2,patientId:id,scheduleId,scheduleRevision:1,startsAt:'2026-10-22T02:00:00Z',endsAt:'2026-10-22T02:30:00Z',reason:'虚构预约',requestKey:'persistent-book',commandVersion:1};
 const br=await fetch(base+'/api/reception',{method:'POST',headers,body:JSON.stringify(book)});assert.equal(br.status,200,await br.clone().text());const appointmentId=(await br.json()).id;
 const dl=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'dentist',password:'Clinic123'})}),ds=await dl.json(),dh={cookie:dl.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':'dentist','x-csrf-token':ds.csrf};
 const care=await (await fetch(base+'/api/treatment/options?branchId=1',{headers:dh})).json(),current=care.visits.find(x=>x.status==='接诊中');
 const plan={action:'draft',branchId:1,visitId:current.id,serviceId:care.services[0].id,quantity:1,goal:'虚构持续方案',basis:'演示依据',schedule:'演示安排',reason:'演示方案',requestKey:'persist-plan',commandVersion:1};
 const pr=await fetch(base+'/api/plans',{method:'POST',headers:dh,body:JSON.stringify(plan)});assert.equal(pr.status,200,await pr.clone().text());const planId=(await pr.json()).id;
 const publish=await fetch(base+'/api/plans',{method:'POST',headers:dh,body:JSON.stringify({action:'publish',branchId:1,visitId:current.id,versionId:planId,expectedRevision:1,explanation:'演示已说明',requestKey:'persist-plan-publish',commandVersion:1})});assert.equal(publish.status,200);
 const qr=await fetch(base+'/api/quotes',{method:'POST',headers:dh,body:JSON.stringify({action:'draft',branchId:1,visitId:current.id,planVersionId:planId,scopeNote:'演示范围',reason:'演示报价',requestKey:'persist-quote-draft',commandVersion:1})});assert.equal(qr.status,200,await qr.clone().text());const quoteId=(await qr.json()).id;
 assert.throws(()=>createChainDemo({snapshotPath:file}),/正被占用/);
 await new Promise(resolve=>demo.server.close(resolve));demo.db.close();assert.equal(fs.existsSync(file+'.lock'),false);
 demo=createChainDemo({snapshotPath:file});await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));try{
  assert.equal(demo.db.prepare('SELECT name FROM patient WHERE id=?').get(id).name,'虚构持久演示患者');assert.equal(demo.db.prepare('SELECT status FROM plan_version WHERE id=?').get(planId).status,'待确认');assert.equal(demo.db.prepare('SELECT status FROM quote_version WHERE id=?').get(quoteId).status,'草稿');
  const page=await fetch(`http://127.0.0.1:${demo.server.address().port}/`);assert.match(await page.text(),/重新启动后演示数据保留/);
  assert.equal(demo.db.prepare('SELECT branch_id,status FROM appointment WHERE id=?').get(appointmentId).branch_id,2);assert.equal(demo.db.prepare('SELECT status FROM appointment WHERE id=?').get(appointmentId).status,'已预约');
  assert.equal(demo.db.prepare('SELECT branch_id FROM dated_schedule WHERE id=?').get(scheduleId).branch_id,2);
  const restarted=`http://127.0.0.1:${demo.server.address().port}`;const second=await fetch(restarted+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'assistant',password:'Clinic123'})});const auth=await second.json(),onlyBranch2={cookie:second.headers.get('set-cookie').split(';')[0],'x-clinic-role':'manager','x-csrf-token':auth.csrf};
  assert.equal((await fetch(restarted+'/api/schedules?branchId=1',{headers:onlyBranch2})).status,403);assert.equal((await fetch(restarted+'/api/schedules?branchId=2',{headers:onlyBranch2})).status,200);
  assert.equal(demo.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await new Promise(resolve=>demo.server.close(resolve));demo.db.close();}
 const before=fs.readFileSync(file);fs.writeFileSync(file,'invalid');assert.throws(()=>createChainDemo({snapshotPath:file}));assert.equal(fs.readFileSync(file,'utf8'),'invalid');assert.equal(fs.existsSync(file+'.lock'),false);fs.writeFileSync(file,before);
});

test('快照写入失败时不返回成功，停止服务并保留旧快照',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-persist-fail-'));t.after(()=>{if(!path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'chain-persist-fail-'))throw Error('临时目录不符');fs.rmSync(folder,{recursive:true,force:true});});
 const file=path.join(folder,'chain-demo.snapshot.sqlite'),demo=createChainDemo({snapshotPath:file});await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${demo.server.address().port}`,login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})}),auth=await login.json(),headers={cookie:login.headers.get('set-cookie').split(';')[0],'content-type':'application/json','x-clinic-role':'frontdesk','x-csrf-token':auth.csrf},before=fs.readFileSync(file);
 const original=fs.renameSync;let response;try{fs.renameSync=()=>{throw Error('simulated disk failure');};response=await fetch(base+'/api/setup',{method:'POST',headers,body:JSON.stringify({action:'patient',branchId:1,fields:{name:'不能声称保存成功',phone:'13800008888',phone_owner:'本人'},reason:'模拟保存失败',requestKey:'save-fail',commandVersion:1})});}finally{fs.renameSync=original;}
 assert.equal(response.status,503);assert.equal((await response.json()).code,'SNAPSHOT_WRITE_FAILED');await new Promise(resolve=>demo.server.listening?demo.server.once('close',resolve):resolve());demo.db.close();assert.deepEqual(fs.readFileSync(file),before);
 const reopened=createChainDemo({snapshotPath:file});assert.equal(reopened.db.prepare('SELECT count(*) n FROM patient WHERE name=?').get('不能声称保存成功').n,0);await new Promise(resolve=>{reopened.server.listen(0,'127.0.0.1',()=>reopened.server.close(resolve));});reopened.db.close();
});
