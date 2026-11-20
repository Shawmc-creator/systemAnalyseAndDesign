'use strict';
const base='http://127.0.0.1:3011';
(async()=>{for(const [name,permitted,forbidden] of [['frontdesk1',1,2],['frontdesk2',2,1]]){
 const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,password:'Clinic1234'})});if(!r.ok)throw Error(name+' 登录失败');
 const data=await r.json(),headers={cookie:r.headers.get('set-cookie').split(';')[0],'x-clinic-role':'frontdesk','x-csrf-token':data.csrf,'content-type':'application/json'};
 try{const own=await fetch(base+'/api/reception/options?branchId='+permitted,{headers}),other=await fetch(base+'/api/reception/options?branchId='+forbidden,{headers});console.log(name,'本店',own.status,'他店',other.status);if(own.status!==200||other.status!==403)throw Error('门店权限不符');}finally{await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'});}
}})().catch(e=>{console.error(e.message);process.exitCode=1;});
