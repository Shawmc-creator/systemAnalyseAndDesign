'use strict';
// Adds only an explicitly fictitious draft to the fixed-time local demo.
const base='http://127.0.0.1:3011';
(async()=>{
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'dentist',password:'Clinic123'})});
 if(!login.ok)throw Error('演示牙医账号无法登录，未增加数据');
 const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie,'x-clinic-role':'dentist','x-csrf-token':session.csrf,'content-type':'application/json'};
 const get=async url=>{const r=await fetch(base+url,{headers});if(!r.ok)throw Error((await r.json()).message);return r.json();};
 try {
  const {visits}=await get('/api/treatment/options?branchId=1');
  const visit=visits.find(v=>v.patient_id===1&&v.status==='接诊中');
  if(!visit)throw Error('原虚构演示接诊不可用，未增加处方');
  const query='/api/prescriptions?branchId=1&visitId='+visit.id+'&patientId='+visit.patient_id,data=await get(query);
  if(data.prescriptions.some(p=>String(p.reason||'').includes('虚构示例')))return console.log('已存在虚构示例处方');
  const drug=data.drugs.find(d=>String(d.name||'').includes('虚构演示'));
  if(!drug)throw Error('没有虚构演示药品，未增加处方');
  const input={action:'draft',branchId:1,visitId:visit.id,patientId:visit.patient_id,collectionRoute:'院外',diagnosis:'虚构示例：口腔检查',guidanceNote:'虚构示例，不用于实际用药',reason:'虚构示例处方草稿',items:[{materialId:drug.id,expectedMaterialRevision:drug.revision,quantityScaled:1,directions:'虚构示例，不用于实际用药'}],requestKey:'fixed-demo-fictional-rx-20261112',commandVersion:1};
  const response=await fetch(base+'/api/prescriptions',{method:'POST',headers,body:JSON.stringify(input)});if(!response.ok)throw Error((await response.json()).message);console.log('已新增虚构示例处方草稿');
 } finally {await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
