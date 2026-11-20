'use strict';
const base='http://127.0.0.1:3011';
async function login(username,role,password){const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});if(!r.ok)throw Error(username+' 登录失败');const d=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-clinic-role':role,'x-csrf-token':d.csrf,'content-type':'application/json'};}
async function get(url,h){const r=await fetch(base+url,{headers:h});if(!r.ok)throw Error(url+' HTTP '+r.status);return r.json();}
(async()=>{const f=await login('frontdesk2','frontdesk','Clinic1234'),d=await login('manager','dentist','Clinic123');
try{const data=await get('/api/followups?branchId=2',f),followup=data.items.find(x=>x.patient_name==='虚构示例复诊患者'&&x.status==='待联系');if(!followup)throw Error('未找到二店虚构复诊待办');
const detail=await get('/api/record/draft?branchId=2&visitId='+followup.source_visit_id,d);
const rx=await get('/api/prescriptions?branchId=2&visitId='+followup.source_visit_id+'&patientId='+followup.patient_id,d);
if(detail.record.status!=='已签署'||!rx.prescriptions.some(p=>p.status==='草稿'))throw Error('虚构病历或处方草稿缺失');
console.log('二店前台可见虚构复诊待联系；二店牙医可见已签署虚构病历和院外处方草稿。');
}finally{for(const h of [f,d])await fetch(base+'/api/logout',{method:'POST',headers:h,body:'{}'});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
