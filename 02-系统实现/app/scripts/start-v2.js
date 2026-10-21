'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const businessDemo=process.argv.includes('--business-demo'),port=businessDemo?3002:3001;
const appRoot=path.resolve(__dirname,'..'),base='http://127.0.0.1:'+port;
const {VERSION}=require('../src/v2/database');
async function status(){try{const r=await fetch(base+'/api/v2/status',{signal:AbortSignal.timeout(1000)});return r.ok?await r.json():null;}catch{return null;}}
const current=s=>s?.application==='qinghe-dental-v2'&&s.schemaVersion===VERSION&&s.insuranceApi?.implemented?.includes('fundReceipts')&&(businessDemo?s.settlementApi?.mode==='isolatedSimulation':s.settlementApi?.mode==='officialTerminalVerification');
function occupied(){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});let done=false;const end=value=>{if(!done){done=true;s.destroy();resolve(value);}};s.once('connect',()=>end(true));s.once('error',()=>end(false));s.setTimeout(500,()=>end(false));});}
function openBrowser(){if(process.argv.includes('--no-browser'))return;const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/c','start','',base],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>console.log('Open '+base+' in your browser.'));child.unref();}
(async()=>{
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 or later is required.');
 if(process.argv.includes('--check')){console.log('Startup check passed: Node.js 24+, current v2 entry, port '+port+'.');return;}
 if(current(await status())){console.log('Current clinic service is already running: '+base);openBrowser();return;}
 if(await occupied())throw new Error('Port '+port+' is occupied by another or outdated service. Close that service and retry.');
 const data=path.join(appRoot,'data');fs.mkdirSync(data,{recursive:true});
 const logPrefix=businessDemo?'clinic-business-demo':'clinic-v2-server';
 const out=fs.openSync(path.join(data,logPrefix+'.stdout.log'),'a'),err=fs.openSync(path.join(data,logPrefix+'.stderr.log'),'a');let child,startError;
 try{child=spawn(process.execPath,businessDemo?['scripts/serve-v2-business-demo.js']:['src/v2/server.js','--demo'],{cwd:appRoot,detached:true,windowsHide:true,stdio:['ignore',out,err],env:{...process.env,CLINIC_V2_PORT:String(port),CLINIC_DEMO_PORT:String(port)}});}finally{fs.closeSync(out);fs.closeSync(err);}
 child.on('error',e=>{startError=e;});child.unref();
 for(let i=0;i<20;i++){
  await new Promise(r=>setTimeout(r,250));if(startError)throw startError;
  if(current(await status())){console.log('Clinic ready: '+base+' (PID '+child.pid+')');openBrowser();return;}
  if(child.exitCode!==null)break;
 }
 throw new Error('Service did not become ready. See '+path.join(data,logPrefix+'.stderr.log'));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
