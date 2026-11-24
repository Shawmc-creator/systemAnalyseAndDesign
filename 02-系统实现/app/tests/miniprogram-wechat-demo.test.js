'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {configFromEnv,validateWechatDemoConfig}=require('../src/v2/mini-program-demo-login');

test('微信体验配置须完整，公开 API 使用 HTTPS 域名',()=>{
  assert.equal(configFromEnv({}),null);
  assert.throws(()=>configFromEnv({CHAIN_MINIPROGRAM_API_ORIGIN:'https://demo.example.test'}));
  assert.throws(()=>validateWechatDemoConfig({
    origin:'https://192.0.2.1',appId:'wx0123456789abcdef',appSecret:'fixture-secret',identityKey:Buffer.alloc(32)
  }));
});

test('微信体验档案分别关联，预约可被前台查询，重启后保留原档案',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-course-demo-'));
  const snapshotPath=path.join(directory,'chain-demo.snapshot.sqlite');
  const host='demo.example.test';
  const proxyHeaders={host,'x-forwarded-proto':'https'};
  const prefix='/api/miniprogram';
  const identities=new Map([['codeA','mock-openid-A'],['codeB','mock-openid-B'],['codeAagain','mock-openid-A']]);
  const config={
    origin:'https://'+host,appId:'wx0123456789abcdef',appSecret:'fixture-secret',identityKey:Buffer.alloc(32,9),
    async fetchImpl(url,options){
      assert.equal(url.origin,'https://api.weixin.qq.com');
      assert.equal(url.pathname,'/sns/jscode2session');
      assert.equal(url.searchParams.get('appid'),config.appId);
      assert.equal(url.searchParams.get('secret'),config.appSecret);
      assert.equal(options.redirect,'error');
      const code=url.searchParams.get('js_code');
      const openid=identities.get(code);
      identities.delete(code);
      return {
        ok:true,
        async json(){return openid?{openid,session_key:'do-not-return'}:{errcode:code==='busy'?-1:40029};}
      };
    }
  };
  let demo,base;
  async function start(){
    demo=createChainDemo({snapshotPath,fixedClock:'2026-10-19T03:00:00Z',wechatDemoConfig:config});
    await new Promise((resolve,reject)=>demo.server.once('error',reject).listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+demo.server.address().port;
  }
  async function stop(){
    if(!demo)return;
    if(demo.server.listening)await new Promise(resolve=>demo.server.close(resolve));
    demo.db.close();
    demo=null;
  }
  t.after(async()=>{await stop();fs.rmSync(directory,{recursive:true,force:true});});
  // Match the actual proxy's Host header. Node fetch sets Host itself.
  const request=(route,options={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+route,options,res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('error',reject);
      res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);
    req.end(options.body);
  });
  const post=(route,data,headers)=>request(route,{
    method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)
  });
  const patientHeaders=token=>({...proxyHeaders,authorization:'Bearer '+token});
  const options=async token=>(await (await request(prefix+'/options',{headers:patientHeaders(token)})).json());
  async function login(code){
    const response=await post(prefix+'/session',{code},proxyHeaders);
    assert.equal(response.status,200,await response.clone().text());
    const value=await response.json();
    assert.deepEqual(Object.keys(value).sort(),['expiresInSeconds','token']);
    return value.token;
  }

  await start();
  assert.equal((await request(prefix+'/status')).status,404);
  const health=await request(prefix+'/status',{headers:proxyHeaders});
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{application:'qinghe-miniprogram-demo',status:'ready'});
  const before=fs.statSync(snapshotPath).mtimeMs;
  assert.equal((await post(prefix+'/session',{code:'busy'},proxyHeaders)).status,503);
  assert.equal((await post(prefix+'/session',{code:'codeA'},{host})).status,404);
  assert.equal((await post(prefix+'/session',{openid:'mock-openid-A'},proxyHeaders)).status,422);
  assert.equal(fs.statSync(snapshotPath).mtimeMs,before);
  const tokenA=await login('codeA');
  assert.equal((await post(prefix+'/session',{code:'codeA'},proxyHeaders)).status,401);
  const tokenB=await login('codeB');
  const schedule=(await options(tokenA)).schedules.find(entry=>entry.branch_id===2&&entry.slots.length);
  const slot=schedule.slots[0];
  const response=await post(prefix+'/appointment',{
    action:'create',branchId:2,scheduleId:schedule.id,scheduleRevision:schedule.revision,
    ...slot,reason:'口腔检查',requestKey:'wechat-test-book'
  },patientHeaders(tokenA));
  assert.equal(response.status,200,await response.clone().text());
  const booked=await response.json();
  assert.ok((await options(tokenA)).bookings.some(entry=>entry.id===booked.id));
  assert.ok(!(await options(tokenB)).bookings.some(entry=>entry.id===booked.id));
  const cancel={action:'cancel',branchId:2,appointmentId:booked.id,expectedRevision:booked.revision,requestKey:'wechat-test-cancel'};
  assert.equal((await post(prefix+'/appointment',cancel,patientHeaders(tokenB))).status,403);
  const staff=await post('/api/login',{username:'frontdesk',password:'Clinic123'},{});
  const reception=await fetch(base+'/api/reception/options?branchId=2',{
    headers:{cookie:staff.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk'}
  });
  assert.ok((await reception.json()).appointments.some(entry=>entry.id===booked.id));
  const mappings=demo.db.prepare('SELECT subject_digest FROM mini_program_demo_patient').all();
  assert.equal(mappings.length,2);
  assert.ok(mappings.every(entry=>/^[0-9a-f]{64}$/.test(entry.subject_digest)));

  await stop();
  await start();
  assert.equal((await request(prefix+'/options',{headers:patientHeaders(tokenA)})).status,401);
  const fresh=await login('codeAagain');
  assert.ok((await options(fresh)).bookings.some(entry=>entry.id===booked.id));
  assert.equal(demo.db.prepare('SELECT count(*) AS count FROM mini_program_demo_patient').get().count,2);
  assert.equal((await post(prefix+'/appointment',cancel,patientHeaders(fresh))).status,200);
  assert.equal((await options(fresh)).bookings.find(entry=>entry.id===booked.id).status,'已取消');
});
