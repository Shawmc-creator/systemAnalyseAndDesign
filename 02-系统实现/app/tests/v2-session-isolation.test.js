'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApplication}=require('../src/v2/server');
test('normal and isolated demo sessions coexist on the same host and each logout affects only its own session',async t=>{
 const normal=createApplication({demo:true}),demo=createApplication({demo:true,integrationSimulation:true,sessionCookieName:'clinic_v2_demo_session'});
 await Promise.all([normal,demo].map(a=>new Promise(resolve=>a.server.listen(0,'127.0.0.1',resolve))));
 t.after(async()=>{await Promise.all([normal,demo].map(a=>new Promise(resolve=>a.server.close(resolve))));normal.db.close();demo.db.close();});
 const base=a=>'http://127.0.0.1:'+a.server.address().port+'/api/v2',login=async(a,username)=>{const r=await fetch(base(a)+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()};};
 const real=await login(normal,'frontdesk'),sample=await login(demo,'manager');assert.match(real.cookie,/^clinic_v2_session=/);assert.match(sample.cookie,/^clinic_v2_demo_session=/);
 const both=real.cookie+'; '+sample.cookie,me=async a=>fetch(base(a)+'/auth/me',{headers:{Cookie:both}});
 assert.equal((await (await me(normal)).json()).user.name,'陈前台');assert.equal((await (await me(demo)).json()).user.name,'林医生');
 const logout=await fetch(base(demo)+'/auth/logout',{method:'POST',headers:{Cookie:both,'Content-Type':'application/json','X-CSRF-Token':sample.data.csrf},body:'{}'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/^clinic_v2_demo_session=;/);
 assert.equal((await me(normal)).status,200);assert.equal((await me(demo)).status,401);
});
