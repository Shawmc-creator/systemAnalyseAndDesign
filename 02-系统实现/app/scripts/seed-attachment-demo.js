const assert = require('node:assert/strict');
const base = process.env.CLINIC_URL || 'http://127.0.0.1:3000';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function call(path,session,method='GET',body){const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',Cookie:session.cookie,'X-CSRF-Token':session.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json().catch(()=>({}));assert.ok(response.ok,data.error||`HTTP ${response.status}`);return data;}
(async()=>{
  const response=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'dentist',password:'Clinic123!'})});assert.equal(response.status,200);const login=await response.json();const session={cookie:response.headers.get('set-cookie').split(';')[0],csrf:login.csrf};
  const encounters=await call('/api/encounters',session);const target=encounters.encounters.find(e=>['signed','amended'].includes(e.status))||encounters.encounters[0];assert.ok(target,'没有可关联的就诊记录');let detail=(await call(`/api/encounters/${target.id}`,session)).encounter;
  const examples=[
    {category:'xray',filename:'46牙治疗前根尖片-演示.png',description:'治疗前根尖片，观察龋坏深度和根尖情况'},
    {category:'photo',filename:'46牙充填后口内照-演示.png',description:'充填完成后的口内照片，用于治疗前后对照'}
  ];
  for(const item of examples){if(!detail.attachments.some(a=>a.original_name===item.filename)){await call('/api/attachments',session,'POST',{patientId:target.patient_id,encounterId:target.id,mimeType:'image/png',dataBase64:png,...item});detail=(await call(`/api/encounters/${target.id}`,session)).encounter;}}
  console.log(JSON.stringify({result:'附件演示数据已就绪',encounter:target.encounter_no,attachments:detail.attachments.map(a=>a.original_name)},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
