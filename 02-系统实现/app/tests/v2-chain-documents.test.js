'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('本店文书上传、牙医确认及重启后下载，阻止越权与跨店',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-doc-test-')),snapshotPath=path.join(dir,'chain-demo.snapshot.sqlite');let demo;
 async function start(){demo=createChainDemo({snapshotPath});await new Promise(r=>demo.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+demo.server.address().port;}
 async function stop(){await new Promise(r=>demo.server.close(r));demo.db.close();}
 t.after(async()=>{if(demo?.server.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});});let base=await start();
 async function login(username,role){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'Clinic123'})});const data=await r.json();return {'content-type':'application/json',cookie:r.headers.get('set-cookie').split(';')[0],'x-clinic-role':role,'x-csrf-token':data.csrf};}
 let assistant=await login('assistant','assistant'),dentist=await login('dentist','dentist'),front=await login('frontdesk','frontdesk');
 const get=(url,h)=>fetch(base+url,{headers:h}),post=(url,value,h)=>fetch(base+url,{method:'POST',headers:h,body:JSON.stringify(value)});
 const options=await (await get('/api/documents/options?branchId=1',assistant)).json(),v=options.visits[0];assert.ok(v);assert.equal((await get('/api/documents/options?branchId=1',front)).status,403);
 const context={branchId:1,visitId:v.id,patientId:v.patient_id},query='/api/documents?branchId=1&visitId='+v.id+'&patientId='+v.patient_id;
 const upload={...context,commandVersion:1,requestKey:'doc-upload',documentType:'影像',source:'虚构演示',ownershipNote:'虚构患者核对',reason:'虚构上传',originalName:'演示.png',contentBase64:png};
 assert.equal((await post('/api/documents/upload',{...upload,branchId:2,requestKey:'wrong-branch'},assistant)).status,403);assert.equal((await post('/api/documents/upload',{...upload,contentBase64:Buffer.from('bad').toString('base64'),requestKey:'bad-file'},assistant)).status,422);
 const result=await post('/api/documents/upload',upload,assistant);assert.equal(result.status,200,await result.clone().text());const id=(await result.json()).id;assert.equal((await post('/api/documents/upload',upload,assistant)).status,200);
 let data=await (await get(query,dentist)).json();assert.equal(data.documents.length,1);assert.equal(data.documents[0].versions[0].status,'原件待确认');assert.ok(!JSON.stringify(data).includes('storage_key'));
 const verify={...context,versionId:id,expectedRevision:1,commandVersion:1,requestKey:'doc-verify',action:'confirm',confirmed:true,verificationNote:'虚构归属核对'};
 assert.equal((await post('/api/documents/verify',verify,assistant)).status,403);assert.equal((await post('/api/documents/verify',verify,dentist)).status,200);
 data=await (await get(query,assistant)).json();const doc=data.documents[0];const second=await post('/api/documents/upload',{...upload,requestKey:'doc-second-version',documentId:doc.id,expectedRevision:doc.revision,reason:'虚构补充原件'},assistant);assert.equal(second.status,200,await second.clone().text());data=await (await get(query,dentist)).json();assert.equal(data.documents[0].versions.length,2);assert.deepEqual(data.documents[0].versions.map(x=>x.status),['原件待确认','原件已确认']);
 assert.equal((await post('/api/documents/download',{...context,branchId:2,versionId:id},assistant)).status,403);await stop();base=await start();dentist=await login('dentist','dentist');
 data=await (await get(query,dentist)).json();assert.equal(data.documents[0].versions[1].status,'原件已确认');assert.equal(data.documents[0].versions[1].available,true);
 const download=await post('/api/documents/download',{...context,versionId:id},dentist);assert.equal(download.status,200);assert.equal((await download.json()).contentBase64,png);
});
