'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-settlements');
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
const personInput={action:'create',name:'新职员（隔离验收）',username:'new.staff',password:'Independent-2026!',role:'frontdesk',basis:'负责人核实实际在岗分工，仅用于隔离验收',reason:'新增独立人员及账号'};
function create(a,extra={}){return a.clinic.staff(a.m,command({...personInput,...extra}));}
function mutate(a,person,extra){const s=a.db.prepare('SELECT * FROM staff WHERE id=?').get(person.id);return a.clinic.staff(a.m,command({staffId:s.id,expectedRevision:s.revision,reason:'核实人员实际变化',...extra}));}
function reference(a,extra={}){return a.billing.draft(a.c,command({action:'reference',referenceId:'filling',unitPriceCents:29900,validFrom:a.auth.now(),reason:'核对本诊所拟用材料、牙位与项目范围，仅建拟价草稿',...extra}));}
test('manager creates an independent staff/account with verified role; responses and audit do not expose password hashes or raw passwords',t=>{
 const a=setup(t),s=create(a),q=a.clinic.query(a.m),p=q.staff.find(p=>p.id===s.id);assert.equal(p.name,personInput.name);assert.equal(p.login_name,'new.staff');assert.equal(a.auth.login({username:'new.staff',password:personInput.password}).user.roles[0].code,'frontdesk');assert.equal(JSON.stringify(q).includes('password_hash'),false);assert.equal(JSON.stringify(q).includes(personInput.password),false);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM operation_audit').all()).includes(personInput.password),false);assert.equal(a.db.prepare('SELECT password_hash FROM user_account WHERE staff_id=?').get(s.id).password_hash.startsWith('scrypt:'),true);
});
test('ordinary staff cannot maintain personnel or grant themselves roles; CSRF and request versions remain enforced',t=>{
 const a=setup(t);assert.throws(()=>a.clinic.query(a.f),e=>e.status===403);assert.throws(()=>a.clinic.staff(a.f,command(personInput)),e=>e.status===403);assert.throws(()=>a.clinic.staff({...a.m,csrf:''},command(personInput)),e=>e.code==='CSRF_INVALID');reject(()=>create(a,{role:'pharmacist'}),'CLINIC_ROLE');reject(()=>create(a,{basis:''}),'INVALID_INPUT');reject(()=>create(a,{password:'Clinic123!'}),'CLINIC_PASSWORD');
});
test('duplicate login or a failed audit rolls staff, account and role qualification back together; repeated original command is not duplicated',t=>{
 const a=setup(t),before=a.db.prepare('SELECT count(*) n FROM staff').get().n,input=command(personInput);a.db.exec("CREATE TEMP TRIGGER clinic_fault BEFORE INSERT ON operation_audit WHEN NEW.object_kind='staff' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'fault');END");assert.throws(()=>a.clinic.staff(a.m,input));assert.equal(a.db.prepare('SELECT count(*) n FROM staff').get().n,before);a.db.exec('DROP TRIGGER clinic_fault');a.clinic.staff(a.m,input);assert.equal(a.clinic.staff(a.m,input).replayed,true);assert.throws(()=>create(a),e=>e.code==='DATA_CONFLICT');assert.equal(a.db.prepare('SELECT count(*) n FROM staff').get().n,before+1);
});
test('revoking a verified role takes effect immediately while the original grant remains; a stale personnel version is rejected',t=>{
 const a=setup(t),s=create(a),a0=a.db.prepare('SELECT id FROM user_account WHERE staff_id=?').get(s.id),login=a.auth.login({username:'new.staff',password:personInput.password});mutate(a,s,{action:'grant',role:'assistant',basis:'核实新增助理分工'});const roles=a.auth.roles(a0.id);assert.equal(roles.length,2);const grant=roles.find(r=>r.code==='frontdesk');mutate(a,s,{action:'revoke',grantId:grant.grant_id});assert.equal(a.auth.roles(a0.id).some(r=>r.code==='frontdesk'),false);assert.ok(a.db.prepare('SELECT revoked_at FROM account_role WHERE id=?').get(grant.grant_id).revoked_at);assert.throws(()=>a.auth.authorize(login.token,'frontdesk','uc08.maintain'),e=>e.status===403);reject(()=>a.clinic.staff(a.m,command({action:'disable',staffId:s.id,expectedRevision:1,reason:'旧版提交'})),'VERSION_CONFLICT');
});
test('disable invalidates existing sessions, preserves historical staff identity and can be restored without restoring revoked roles',t=>{
 const a=setup(t),s=create(a),login=a.auth.login({username:'new.staff',password:personInput.password});mutate(a,s,{action:'disable'});assert.throws(()=>a.auth.session(login.token),e=>e.status===401);assert.throws(()=>a.auth.login({username:'new.staff',password:personInput.password}),e=>e.status===401);assert.equal(a.db.prepare('SELECT name FROM staff WHERE id=?').get(s.id).name,personInput.name);mutate(a,s,{action:'enable'});assert.equal(a.auth.login({username:'new.staff',password:personInput.password}).user.roles.length,1);assert.throws(()=>a.auth.session(login.token),e=>e.status===401);
});
test('current manager cannot disable or revoke their own management entry; a dentist with schedules or actual use must be coordinated first',t=>{
 const a=setup(t),self=a.clinic.query(a.m).staff.find(s=>s.login_name==='manager');reject(()=>mutate(a,self,{action:'disable'}),'SELF_LOCKOUT');const role=a.auth.roles(self.account_id).find(r=>r.code==='manager');reject(()=>mutate(a,self,{action:'revoke',grantId:role.grant_id}),'SELF_LOCKOUT');const d=a.clinic.query(a.m).staff.find(s=>s.login_name==='dentist');reject(()=>mutate(a,d,{action:'disable'}),'CLINIC_ACTIVE_SCHEDULE');
});
test('a new dental chair can be scheduled but is not a bookable timeslot merely because it exists',t=>{
 const a=setup(t),c=a.clinic.chair(a.m,command({action:'create',name:'三号诊椅（隔离）',reason:'实际资源条件核实'}));assert.ok(c.id);assert.equal(a.db.prepare('SELECT count(*) n FROM dated_schedule WHERE dental_chair_id=?').get(c.id).n,0);assert.equal(a.clinic.query(a.m).chairs.some(x=>x.id===c.id),true);reject(()=>a.clinic.chair(a.m,command({action:'create',name:'三号诊椅（隔离）',reason:'重复登记'})),'CLINIC_CHAIR_EXISTS');
});
test('chair retirement never cancels or releases existing clinical work; unused retirement keeps the old record',t=>{
 const a=setup(t);reject(()=>a.clinic.chair(a.m,command({action:'retire',chairId:1,expectedRevision:1,reason:'尚未协调'})),'CLINIC_ACTIVE_SCHEDULE');const c=a.clinic.chair(a.m,command({action:'create',name:'退役验收诊椅',reason:'新增资源核对'}));a.setClock('2026-10-19T01:36:00Z');a.clinic.chair(a.m,command({action:'retire',chairId:c.id,expectedRevision:1,reason:'不再用于后续接诊'}));assert.ok(a.db.prepare('SELECT available_until FROM dental_chair WHERE id=?').get(c.id).available_until);assert.equal(a.db.prepare('SELECT count(*) n FROM dental_chair WHERE id=?').get(c.id).n,1);
});
test('reference prices create only local drafts and never become confirmed prices automatically',t=>{
 const a=setup(t),x=a.clinic.references(a.c),p=reference(a);assert.equal(x.items.length,12);const price=a.db.prepare('SELECT * FROM service_price WHERE id=?').get(p.id);assert.equal(price.status,'价目草稿');assert.equal(price.unit_price_cents,29900);assert.equal(price.confirmed_by,null);assert.match(price.change_reason,/非正式价目/);reject(()=>reference(a),'SERVICE_EXISTS');assert.throws(()=>a.clinic.references(a.d),e=>e.status===403);
});
test('reference import is atomic, preserves fractional yuan accurately, and needs a waiver for zero',t=>{
 const a=setup(t),n=a.db.prepare('SELECT count(*) n FROM service').get().n;reject(()=>reference(a,{unitPriceCents:0}),'INVALID_INPUT');assert.equal(a.db.prepare('SELECT count(*) n FROM service').get().n,n);const cmd=command({action:'reference',referenceId:'cleaning',unitPriceCents:3990,validFrom:a.auth.now(),reason:'39.90元仅作本诊所拟价'}),p=a.billing.draft(a.c,cmd);assert.equal(a.billing.draft(a.c,cmd).replayed,true);assert.equal(a.db.prepare('SELECT unit_price_cents FROM service_price WHERE id=?').get(p.id).unit_price_cents,3990);
});
test('project stop prevents new price drafting and never rewrites original charges or approved price history',t=>{
 const a=setup(t),before=JSON.stringify(a.bill()),s=a.db.prepare('SELECT * FROM service WHERE id=?').get(a.serviceRecord.id);a.billing.manageService(a.m,command({action:'stop',serviceId:s.id,expectedRevision:s.revision,reason:'停止后续新使用，保留原费用'}));assert.equal(JSON.stringify(a.bill()),before);assert.equal(a.db.prepare('SELECT is_active FROM service WHERE id=?').get(s.id).is_active,0);reject(()=>a.billing.draft(a.c,command({action:'draft',serviceId:s.id,unitPriceCents:1,validFrom:a.auth.now(),reason:'试图新定价'})),'SERVICE_DISABLED');
});
test('a priced or clinically referenced project cannot change its name or unit and reinterpret old fees',t=>{
 const a=setup(t),s=a.db.prepare('SELECT * FROM service WHERE id=?').get(a.serviceRecord.id);reject(()=>a.billing.manageService(a.m,command({action:'edit',serviceId:s.id,expectedRevision:s.revision,name:'全程价改成分次',billingUnit:'疗程',reason:'试图追改目录'})),'SERVICE_IDENTITY_FROZEN');assert.equal(a.db.prepare('SELECT billing_unit FROM service WHERE id=?').get(s.id).billing_unit,s.billing_unit);
});
test('HTTP clinic endpoints and new browser assets exist with authorization; a non-manager cannot read personnel or assign grants',async t=>{
 const a=setup(t);await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port;
 for(const file of ['/clinic.js','/catalog.js','/app.js']){const r=await fetch(base+file);assert.equal(r.status,200);assert.equal((await r.text()).includes('function'),true);}
 const home=await (await fetch(base)).text();assert.match(home,/src="\/clinic.js"/);assert.match(home,/data-page="clinic"/);
 const r=await fetch(base+'/api/v2/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'Clinic123!'})}),login=await r.json(),headers={Cookie:r.headers.get('set-cookie').split(';')[0],'X-Clinic-Role':'frontdesk','X-CSRF-Token':login.csrf};assert.equal((await fetch(base+'/api/v2/clinic/query',{headers})).status,403);
});

test('the personnel page uses authorization validity, including expired qualifications and disabled accounts, rather than just an unrevoked grant',t=>{
 const a=setup(t),s=create(a),account=a.db.prepare('SELECT id FROM user_account WHERE staff_id=?').get(s.id),g=a.auth.roles(account.id)[0];
 const current=()=>a.clinic.query(a.m).grants.find(x=>x.id===g.grant_id);
 assert.equal(current().effective,true);
 a.db.prepare('UPDATE staff_role_qualification SET valid_until=? WHERE id=?').run('2026-10-19T01:36:00Z',g.qualification_id);
 a.setClock('2026-10-19T01:36:00Z');assert.equal(a.auth.roles(account.id).length,0);assert.equal(current().effective,false);assert.equal(current().revoked_at,null);
 const other=create(a,{username:'disabled.staff'});mutate(a,other,{action:'disable'});const account2=a.db.prepare('SELECT id FROM user_account WHERE staff_id=?').get(other.id);
 assert.equal(a.clinic.query(a.m).grants.filter(x=>x.account_id===account2.id).every(x=>!x.effective),true);
});

async function httpFixture(t,a){
 await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>a.server.close(r)));const base='http://127.0.0.1:'+a.server.address().port;
 async function login(username,role=username,password='Clinic123!'){
  const r=await fetch(base+'/api/v2/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));
  return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-Clinic-Role':role,'X-CSRF-Token':v.csrf};
 }
 async function request(headers,url,value,status=200){
  const r=await fetch(base+'/api/v2'+url,{method:value?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(value?{body:JSON.stringify(command(value))}:{})}),v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;
 }
 return {login,request};
}

test('HTTP personnel workflow creates a usable personal account, restricts management by role, disables sessions and preserves the original identity',async t=>{
 const a=setup(t),h=await httpFixture(t,a),manager=await h.login('manager');
 const s=await h.request(manager,'/clinic/staff',{...personInput,username:'http.staff'}),staff=await h.login('http.staff','frontdesk',personInput.password);
 assert.equal((await h.request(staff,'/clinic/query',null,403)).code,'FORBIDDEN');
 const before=await h.request(manager,'/clinic/query'),p=before.staff.find(p=>p.id===s.id);assert.ok(p);assert.equal(before.grants.find(g=>g.account_id===p.account_id).effective,true);
 await h.request(manager,'/clinic/staff',{action:'disable',staffId:s.id,expectedRevision:p.revision,reason:'隔离HTTP验收停用'});
 assert.equal((await h.request(staff,'/auth/me',null,401)).code,'SESSION_INVALID');
 const after=await h.request(manager,'/clinic/query'),original=after.staff.find(p=>p.id===s.id);assert.equal(original.name,p.name);assert.equal(original.account_status,'停用');assert.equal(after.grants.find(g=>g.account_id===p.account_id).effective,false);
});

test('HTTP reference pricing requires submission and manager confirmation; category and stop affect the catalog without altering existing fees',async t=>{
 const a=setup(t),h=await httpFixture(t,a),cashier=await h.login('cashier'),manager=await h.login('manager'),oldBill=JSON.stringify(a.bill());
 const refs=await h.request(cashier,'/clinic/reference-services');assert.equal(refs.items.length,12);
 const p=await h.request(cashier,'/service-prices/draft',{action:'reference',referenceId:'filling',unitPriceCents:29900,validFrom:a.auth.now(),reason:'隔离HTTP验收，核实本诊所拟价与单牙单面范围'});
 let catalog=await h.request(cashier,'/services/options'),price=catalog.prices.find(x=>x.id===p.id),service=catalog.services.find(s=>s.id===price.service_id);assert.equal(price.status,'价目草稿');assert.equal(service.category,'牙体牙髓');
 assert.equal((await h.request(manager,'/service-prices/approve',{action:'approve',priceId:p.id,expectedRevision:price.revision,reviewNote:'尚未提交不能审批'},409)).code,'INVALID_STATE');
 assert.equal((await h.request(cashier,'/services/manage',{action:'stop',serviceId:service.id,expectedRevision:service.revision,reason:'收费岗位不得启停目录'},403)).code,'FORBIDDEN');
 await h.request(cashier,'/service-prices/draft',{action:'submit',priceId:p.id,expectedRevision:price.revision});
 price=a.db.prepare('SELECT * FROM service_price WHERE id=?').get(p.id);
 assert.equal((await h.request(cashier,'/service-prices/approve',{action:'approve',priceId:p.id,expectedRevision:price.revision,reviewNote:'收费岗位不能自批'},403)).code,'FORBIDDEN');
 await h.request(manager,'/service-prices/approve',{action:'approve',priceId:p.id,expectedRevision:price.revision,reviewNote:'负责人核实该项目范围、计价单位与本诊所价格'});
 await h.request(manager,'/services/manage',{action:'category',serviceId:service.id,expectedRevision:service.revision,category:'其他',reason:'隔离验收目录分类变更'});
 service=a.db.prepare('SELECT * FROM service WHERE id=?').get(service.id);
 await h.request(manager,'/services/manage',{action:'stop',serviceId:service.id,expectedRevision:service.revision,reason:'核实停止新项目使用，保留原账目'});
 catalog=await h.request(manager,'/services/options');price=catalog.prices.find(x=>x.id===p.id);assert.equal(price.status,'已确认可适用');assert.deepEqual(price.history.map(h=>h.event_type),['提交','确认']);assert.equal(catalog.services.find(s=>s.id===service.id).is_active,0);assert.equal(JSON.stringify(a.bill()),oldBill);
});
