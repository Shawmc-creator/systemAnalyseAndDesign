const assert=require('node:assert/strict');
const base=process.env.CLINIC_URL||'http://127.0.0.1:3000';
async function login(username){const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Clinic123!'})});assert.equal(res.status,200);const b=await res.json();return {...b,cookie:res.headers.get('set-cookie').split(';')[0]};}
async function get(route,s){return fetch(base+route,{headers:{Cookie:s.cookie}});}
(async()=>{
 const sessions={};for(const name of ['manager','frontdesk','dentist','cashier','assistant','assistant2'])sessions[name]=await login(name);
 for(const route of ['/','/app.js','/styles.css'])assert.equal((await fetch(base+route)).status,200);
 assert.equal((await get('/api/invoices',sessions.frontdesk)).status,403);
 assert.equal((await get('/api/materials',sessions.frontdesk)).status,403);
 for(const role of ['assistant','manager'])assert.equal((await get('/api/materials',sessions[role])).status,200);
 for(const route of ['/api/invoices','/api/price-versions','/api/reconciliations'])assert.equal((await get(route,sessions.cashier)).status,200);
 assert.equal((await get('/api/encounters',sessions.dentist)).status,200);
 for(const route of ['/api/approvals','/api/notifications','/api/appointment-change-requests'])assert.equal((await get(route,sessions.manager)).status,410);
 assert.equal((await fetch(base+'/api/patient/me')).status,410);
 console.log('六人员登录、岗位权限、材料、价目、现金核对及网页资源检查通过。');
})().catch(e=>{console.error(e);process.exitCode=1;});
