'use strict';
// Launches only the restartable local demonstration, never the clinic database.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const {CHAIN_DEMO_BUILD}=require('../src/v2/chain-demo-server');const live=process.argv.includes('--live'),mode=live?'live':'fixed';const root=path.resolve(__dirname,'..'),port=live?3019:3011,base='http://127.0.0.1:'+port;
async function status(){try{const r=await fetch(base+'/api/status',{signal:AbortSignal.timeout(1000)});return r.ok?await r.json():null;}catch{return null;}}
function current(s){return s?.application==='qinghe-chain-demo'&&s.mode==='persistent-snapshot'&&s.buildVersion===CHAIN_DEMO_BUILD&&s.clockMode===mode;}
function occupied(){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});let done=false;function end(v){if(!done){done=true;socket.destroy();resolve(v);}}socket.once('connect',()=>end(true));socket.once('error',()=>end(false));socket.setTimeout(500,()=>end(false));});}
function openBrowser(){if(process.argv.includes('--no-browser'))return;const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/c','start','',base],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>console.log('请打开 '+base));child.unref();}
(async()=>{if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24 或以上版本');for(const p of ['scripts/serve-chain-persistent-demo.js','public/chain-demo/chain-demo.html','public/chain-demo/chain-demo.js','public/chain-demo/chain-demo.css'])if(!fs.existsSync(path.join(root,p)))throw Error('演示文件缺失：'+p);
 if(process.argv.includes('--check')){console.log('连锁演示启动文件检查通过。');return;}
 const running=await status();
 if(current(running)){console.log('连锁演示已运行：'+base);openBrowser();return;}
 if(running?.application==='qinghe-chain-demo'&&running.mode==='persistent-snapshot')throw Error('检测到旧版连锁演示（'+running.buildVersion+'），请先停止旧服务，再重新启动；演示数据会保留。');
 if(await occupied())throw Error('端口 '+port+' 被其他程序或旧版演示占用，请关闭后重试。');
 const lock=path.join(root,'data',live?'chain-live-demo':'chain-demo','chain-demo.snapshot.sqlite.lock');
 if(fs.existsSync(lock)){
  if(process.platform!=='win32')throw Error('演示快照存在锁文件，请核实旧演示进程是否已停止：'+lock);
  const {execFileSync}=require('node:child_process');
  try{const output=execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & {"+fs.readFileSync(path.join(root,'scripts/recover-chain-demo-lock.ps1'),'utf8')+"} -Mode "+mode+' -AppDirectory '+"'"+root.replaceAll("'","''")+"'"],{windowsHide:true,encoding:'utf8',timeout:15000});if(output.trim())console.log(output.trim());}
  catch{throw Error('未能安全恢复数据锁，请检查旧演示进程后重新双击对应启动器。演示快照已保留。');}
 }
 const folder=path.join(root,'data');fs.mkdirSync(folder,{recursive:true});const out=fs.openSync(path.join(folder,live?'chain-live-launch.stdout.log':'chain-launch.stdout.log'),'a'),err=fs.openSync(path.join(folder,live?'chain-live-launch.stderr.log':'chain-launch.stderr.log'),'a');let child,error;
 try{child=spawn(process.execPath,[live?'scripts/serve-chain-live-demo.js':'scripts/serve-chain-persistent-demo.js'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err],env:{...process.env,CHAIN_DEMO_PORT:String(port)}});}finally{fs.closeSync(out);fs.closeSync(err);}
 child.on('error',e=>{error=e;});child.unref();for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));if(error)throw error;if(current(await status())){console.log('连锁演示已就绪：'+base);openBrowser();return;}if(child.exitCode!==null)break;}
 throw Error('连锁演示未能启动，请检查 '+path.join(folder,live?'chain-live-launch.stderr.log':'chain-launch.stderr.log'));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
