'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('Windows 演示包不包含本机数据，并可独立启动虚构演示',async t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-windows-package-')),dest=path.join(parent,'package');
 t.after(()=>{if(path.basename(parent).startsWith('clinic-windows-package-'))fs.rmSync(parent,{recursive:true,force:true});});
 const pack=spawnSync(process.execPath,[path.join(root,'scripts/prepare-windows-demo-package.js'),dest],{encoding:'utf8'});assert.equal(pack.status,0,pack.stderr);
 const app=path.join(dest,'02-系统实现','app');assert.equal(fs.existsSync(path.join(app,'data')),false);assert.equal(fs.readdirSync(path.join(dest,'01-需求文档','数据层设计')).length,2);
 assert.ok(fs.existsSync(path.join(app,'cloud/Caddyfile.miniprogram.example')));
 assert.notEqual(spawnSync(process.execPath,[path.join(root,'scripts/prepare-windows-demo-package.js'),dest],{encoding:'utf8'}).status,0);
 const check=spawnSync(process.execPath,[path.join(app,'scripts/start-chain-demo.js'),'--check'],{cwd:app,encoding:'utf8'});assert.equal(check.status,0,check.stderr);
 const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const child=spawn(process.execPath,[path.join(app,'scripts/serve-chain-persistent-demo.js')],{cwd:app,env:{...process.env,CHAIN_DEMO_PORT:String(port),CHAIN_DEMO_PUBLIC_ORIGIN:'https://demo.example.org'},stdio:['ignore','pipe','pipe'],windowsHide:true});let errorOutput='';child.stderr.on('data',data=>{errorOutput+=data;});child.stdout.resume();t.after(()=>child.kill());
 let response;for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{response=await fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(500)});if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.ok(response?.ok,'独立演示未能启动：'+errorOutput);const status=await response.json();assert.equal(status.application,'qinghe-chain-demo');assert.equal(status.publicOrigin,'https://demo.example.org');
 assert.equal((await fetch('http://127.0.0.1:'+port+'/api/miniprogram/status')).status,404);
 const page=await fetch('http://127.0.0.1:'+port+'/');assert.equal(page.status,200);const login=await fetch('http://127.0.0.1:'+port+'/api/login',{method:'POST',headers:{'content-type':'application/json','origin':'https://demo.example.org'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})});assert.equal(login.status,200);const other=await fetch('http://127.0.0.1:'+port+'/api/login',{method:'POST',headers:{'content-type':'application/json','origin':'https://other.example.org'},body:JSON.stringify({username:'frontdesk',password:'Clinic123'})});assert.equal(other.status,403);
 child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);});
});
