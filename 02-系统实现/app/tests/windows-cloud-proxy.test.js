'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),https=require('node:https');
const {spawn,spawnSync}=require('node:child_process');
const caddy=process.env.CADDY_TEST_EXE;
test('虚构演示通过 HTTPS 代理保护并可登录',{skip:!caddy,timeout:40000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-proxy-')),root=path.resolve(__dirname,'..'),dest=path.join(dir,'package');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const p=spawnSync(process.execPath,[path.join(root,'scripts/prepare-windows-demo-package.js'),dest],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
 const free=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});const backend=await free(),front=await free(),origin='https://127.0.0.1:'+front;
 const app=path.join(dest,'02-系统实现','app'),child=spawn(process.execPath,[path.join(app,'scripts/serve-chain-persistent-demo.js')],{cwd:app,env:{...process.env,CHAIN_DEMO_PORT:String(backend),CHAIN_DEMO_PUBLIC_ORIGIN:origin},stdio:'ignore',windowsHide:true});t.after(()=>child.kill());
 const hash=spawnSync(caddy,['hash-password','--plaintext','fictional-preview-password'],{encoding:'utf8',windowsHide:true});assert.equal(hash.status,0,hash.stderr);
 const conf=path.join(dir,'Caddyfile'),sample=fs.readFileSync(path.join(app,'cloud','Caddyfile.example'),'utf8').replace('demo.example.com {',origin+' {\n    tls internal').replace('REPLACE_WITH_CADDY_HASHED_PASSWORD',hash.stdout.trim()).replaceAll('127.0.0.1:3011','127.0.0.1:'+backend);fs.writeFileSync(conf,'{\n admin off\n skip_install_trust\n storage file_system {\n  root "'+dir.replaceAll('\\','/')+'/storage"\n }\n}\n'+sample);
 const validate=spawnSync(caddy,['validate','--config',conf,'--adapter','caddyfile'],{encoding:'utf8',windowsHide:true});assert.equal(validate.status,0,validate.stderr);
 const proxy=spawn(caddy,['run','--config',conf,'--adapter','caddyfile'],{cwd:dir,stdio:'ignore',windowsHide:true});t.after(()=>proxy.kill());
 const request=(route,options={})=>new Promise((resolve,reject)=>{const req=https.request(origin+route,{rejectUnauthorized:false,...options},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});req.on('error',reject);if(options.body)req.write(options.body);req.end();});
 let response;for(let i=0;i<80;i++){try{response=await request('/');break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.equal(response?.status,401);
 const auth='Basic '+Buffer.from('preview:fictional-preview-password').toString('base64'),body=JSON.stringify({username:'frontdesk',password:'Clinic123'});let login;for(let i=0;i<40;i++){login=await request('/api/login',{method:'POST',headers:{authorization:auth,origin,'content-type':'application/json'},body});if(login.status!==502)break;await new Promise(r=>setTimeout(r,250));}assert.equal(login.status,200,login.body);assert.match(login.headers['set-cookie'][0],/; Secure/i);
 const bad=await request('/api/login',{method:'POST',headers:{authorization:auth,origin:'https://other.example.org','content-type':'application/json'},body});assert.equal(bad.status,403);
 proxy.kill();child.kill();await Promise.all([proxy,child].map(p=>new Promise(resolve=>p.exitCode!==null||p.signalCode!==null?resolve():p.once('exit',resolve))));
});
