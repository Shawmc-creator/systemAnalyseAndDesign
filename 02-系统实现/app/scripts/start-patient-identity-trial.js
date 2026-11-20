'use strict';
// Launch only the explicitly fictitious in-memory identity trial.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),port=3029,base='http://127.0.0.1:'+port;
async function ready(){try{const status=await fetch(base+'/api/status',{signal:AbortSignal.timeout(1000)});if(!status.ok)return false;const s=await status.json();if(s.application!=='qinghe-chain-demo'||s.mode!=='memory')return false;return (await fetch(base+'/identity-trial',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}}
function occupied(){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});let done=false;function finish(x){if(!done){done=true;s.destroy();resolve(x);}}s.once('connect',()=>finish(true));s.once('error',()=>finish(false));s.setTimeout(500,()=>finish(false));});}
function open(){if(process.argv.includes('--no-browser'))return;const p=spawn(process.env.ComSpec||'cmd.exe',['/d','/c','start','',base+'/identity-trial'],{detached:true,windowsHide:true,stdio:'ignore'});p.on('error',()=>{});p.unref();}
(async()=>{if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24 或以上版本');
 if(await ready()){console.log('虚构身份演示已运行：'+base+'/identity-trial');open();return;}if(await occupied())throw Error('端口 3029 已被其他程序占用');
 const dir=path.join(root,'data');fs.mkdirSync(dir,{recursive:true});const out=fs.openSync(path.join(dir,'identity-trial.stdout.log'),'a'),err=fs.openSync(path.join(dir,'identity-trial.stderr.log'),'a');let p;
 try{p=spawn(process.execPath,['scripts/serve-patient-identity-trial.js'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
 let error;p.on('error',e=>{error=e;});p.unref();for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));if(error)throw error;if(await ready()){console.log('虚构身份演示已就绪：'+base+'/identity-trial');open();return;}}
 throw Error('身份演示未能启动，请检查 data/identity-trial.stderr.log');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
