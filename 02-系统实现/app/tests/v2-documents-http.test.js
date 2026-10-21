'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function http(t){const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));a.base='http://127.0.0.1:'+a.server.address().port;return a;}
const headers=a=>({'Content-Type':'application/json','Cookie':'clinic_v2_session='+a.token,'X-Clinic-Role':a.role,'X-CSRF-Token':a.csrf});
test('HTTP upload accepts bounded file bodies, download requires role/session and never serves storage paths publicly',async t=>{
 const a=await http(t),input=command({...a.context,documentType:'影像',source:'设备导出',ownershipNote:'核对患者号',reason:'归档',originalName:'牙科影像.png',contentBase64:PNG.toString('base64')});
 const upload=await fetch(a.base+'/api/v2/documents/upload',{method:'POST',headers:headers(a.d),body:JSON.stringify(input)});assert.equal(upload.status,200);const v=await upload.json();
 const get='/api/v2/documents/versions/'+v.id+'/download',download=await fetch(a.base+get,{headers:headers(a.d)});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),PNG);assert.equal(download.headers.get('content-type'),'image/png');assert.match(download.headers.get('content-disposition'),/attachment;/);assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.equal(download.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(a.base+get)).status,401);assert.equal((await fetch(a.base+get,{headers:headers(a.f)})).status,403);
 const row=a.db.prepare('SELECT * FROM document_version WHERE id=?').get(v.id);assert.equal((await fetch(a.base+'/clinical-files/'+row.storage_key)).status,404);
 const list=await fetch(a.base+'/api/v2/documents/query?'+new URLSearchParams(a.context),{headers:headers(a.d)});assert.equal(list.status,200);assert.equal((await list.text()).includes(row.storage_key),false);
 const work=await (await fetch(a.base+'/api/v2/documents/worklist?date=2026-10-19',{headers:headers(a.d)})).json();assert.equal(work.items.some(v=>v.id===a.v.id),true);
 const source=await fetch(a.base+'/documents.js');assert.equal(source.status,200);
});
test('document upload authenticates before accepting bytes and does not increase the ordinary JSON command limit',async t=>{
 const a=await http(t),body=JSON.stringify(command({...a.context,documentType:'诊疗附件',source:'患者提供',ownershipNote:'核对患者',reason:'文件容量验证',originalName:'长文书.pdf',contentBase64:Buffer.from('%PDF-1.4\n'+' '.repeat(100000)+'\n%%EOF\n').toString('base64')}));
 const response=await fetch(a.base+'/api/v2/documents/upload',{method:'POST',headers:headers(a.d),body});assert.equal(response.status,200);
 const denied=await fetch(a.base+'/api/v2/documents/upload',{method:'POST',headers:headers(a.f),body});assert.equal(denied.status,403);
 const ordinary=await fetch(a.base+'/api/v2/clinical-records/record',{method:'POST',headers:headers(a.d),body});assert.equal(ordinary.status,413);
 const csrf=await fetch(a.base+'/api/v2/documents/upload',{method:'POST',headers:{...headers(a.d),'X-CSRF-Token':'bad'},body});assert.equal(csrf.status,403);
});
