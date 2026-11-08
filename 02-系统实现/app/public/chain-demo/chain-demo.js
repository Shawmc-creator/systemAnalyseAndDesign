'use strict';
const $=s=>document.querySelector(s), state={csrf:null,role:null,branch:null,viewVersion:0,summaryVersion:0,clinicalVersion:0,financeVersion:0,prescriptionVersion:0,prescription:null,options:null,bills:[],patient:null,treatment:null,record:null,health:null,followups:null,followupBooking:null,inventory:null,purchases:null,pending:[],prices:[],approvalOptions:null};
let fixedNow='2026-10-19T01:35:00Z',clockMode='fixed';
function message(value,error=false){const n=$('#notice');n.hidden=false;n.textContent=value;n.classList.toggle('chain-error',error);}
function option(select,value,label){const el=document.createElement('option');el.value=String(value);el.textContent=label;select.append(el);}
function date(value){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(new Date(value));}
function localInput(value){const d=new Date(Date.parse(value)+8*3600000);return d.toISOString().slice(0,16);}
function isoLocal(value){return new Date(value+':00+08:00').toISOString().replace('.000Z','Z');}
function quantityText(value,scale){const digits=String(value).padStart(scale+1,'0');return scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;}
function quantityScaled(value,scale,zero=false){const match=/^(\d+)(?:\.(\d+))?$/.exec(value.trim());if(!match||(match[2]||'').length>scale)throw new Error('数量格式或小数位无效。');const n=BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]||'').padEnd(scale,'0')||'0');if((!zero&&n===0n)||n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('数量超出有效范围。');return Number(n);}
function clearPrescription(){state.prescriptionVersion++;state.prescription=null;$('#prescription-list').replaceChildren();$('#prescription-draft-form').hidden=true;$('#prescription-issue-form').hidden=true;$('#prescription-handover-form').hidden=true;$('#prescription-void-form').hidden=true;$('#prescription-empty').hidden=true;}
async function loadPrescription(){
 clearPrescription();const branch=state.branch,view=state.viewVersion,version=state.prescriptionVersion,visitId=Number($('#prescription-visit').value),visit=state.treatment?.visits.find(x=>x.id===visitId);if(!visit)throw Error('请选择本人本店接诊。');
 const data=await api('/api/prescriptions?branchId='+branch+'&visitId='+visitId+'&patientId='+visit.patient_id);if(state.branch!==branch||state.role!=='dentist'||state.viewVersion!==view||state.prescriptionVersion!==version||Number($('#prescription-visit').value)!==visitId)return;
 state.prescription={...data,branch,visitId,patientId:visit.patient_id};const list=$('#prescription-list');if(!data.prescriptions.length)list.textContent='本次就诊暂无院外处方。';
 for(const p of data.prescriptions){const line=document.createElement('p');line.textContent=p.record_no+'；'+p.status+'；诊断：'+p.diagnosis+'；指导：'+(p.guidance_note||'未填写')+(p.handed_over_at?'；处方文件已交付':'；处方文件未记录交付')+(p.contentIntact===false?'；处方内容待核对':'');list.append(line);for(const item of p.items){const detail=document.createElement('p');detail.textContent='　'+item.drug_name+' / '+quantityText(item.quantity_scaled,item.quantity_scale)+' '+item.unit+'；'+item.directions;list.append(detail);}}
 const draft=$('#prescription-draft-form');for(const row of draft.querySelectorAll('[data-prescription-item]')){const drug=row.querySelector('[name=drug]'),previous=drug.value;drug.replaceChildren();for(const d of data.drugs)option(drug,d.id,d.name+' / '+d.specification+' / '+d.base_unit);if(data.drugs.some(d=>String(d.id)===previous))drug.value=previous;}draft.hidden=visit.status!=='接诊中'||!data.drugs.length;$('#prescription-empty').hidden=!!data.drugs.length;
 const issue=$('#prescription-issue-form'),select=issue.elements.prescription;select.replaceChildren();for(const p of data.prescriptions.filter(x=>x.status==='草稿'&&x.canManage))option(select,p.id,p.record_no+' / '+p.diagnosis);issue.hidden=visit.status!=='接诊中'||!select.options.length;for(const kind of ['handover','void']){const form=$('#prescription-'+kind+'-form'),choices=form.elements.prescription;choices.replaceChildren();for(const p of data.prescriptions.filter(x=>x.status==='已开立'&&x.canManage&&(kind!=='handover'||!x.handed_over_at)))option(choices,p.id,p.record_no+' / '+p.diagnosis);form.hidden=!choices.options.length;}
}
$('#prescription-visit').onchange=clearPrescription;
$('#prescription-load').onclick=e=>act(e.currentTarget,loadPrescription);
$('#prescription-add-drug').onclick=()=>{const items=$('#prescription-items'),rows=items.querySelectorAll('[data-prescription-item]');if(rows.length>=20){message('每张处方最多填写 20 种药品。',true);return;}const row=rows[0].cloneNode(true);row.querySelector('[name=quantity]').value='';row.querySelector('[name=directions]').value='';items.append(row);};
$('#prescription-items').onclick=e=>{const button=e.target.closest('[data-remove-prescription-item]');if(!button)return;const items=$('#prescription-items'),rows=items.querySelectorAll('[data-prescription-item]');if(rows.length<=1){message('处方至少需要一项药品。',true);return;}button.closest('[data-prescription-item]').remove();};
$('#prescription-draft-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,rx=state.prescription;if(!rx||rx.branch!==state.branch||rx.visitId!==Number($('#prescription-visit').value))throw Error('请重新查询本次就诊与药品目录。');const rows=[...f.querySelectorAll('[data-prescription-item]')];const items=rows.map(row=>{const drug=rx.drugs.find(x=>x.id===Number(row.querySelector('[name=drug]').value));if(!drug)throw Error('请重新选择药品。');return {materialId:drug.id,expectedMaterialRevision:drug.revision,quantityScaled:quantityScaled(row.querySelector('[name=quantity]').value,drug.quantity_scale),directions:row.querySelector('[name=directions]').value};});
 await api('/api/prescriptions',command({action:'draft',visitId:rx.visitId,patientId:rx.patientId,collectionRoute:'院外',diagnosis:f.elements.diagnosis.value,guidanceNote:f.elements.guidance.value,reason:f.elements.reason.value,items}));f.reset();for(const row of [...f.querySelectorAll('[data-prescription-item]')].slice(1))row.remove();message('院外处方草稿已保存。');await loadPrescription();});};
$('#prescription-issue-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,rx=state.prescription,p=rx?.prescriptions.find(x=>x.id===Number(f.elements.prescription.value));if(!rx||rx.branch!==state.branch||rx.visitId!==Number($('#prescription-visit').value)||!p)throw Error('请重新查询本次就诊处方。');if(!rx.review)throw Error('请先完成本次健康资料复核。');
 await api('/api/prescriptions',command({action:'issue',visitId:rx.visitId,patientId:rx.patientId,prescriptionId:p.id,expectedRevision:p.revision,expectedPatientRevision:rx.patient.revision,expectedRecordRevision:rx.record.revision,expectedHealthReviewId:rx.review.id,confirmed:f.elements.confirmed.checked,reason:f.elements.reason.value}));f.reset();message('院外处方已开立；未记录发药或收款。');await loadPrescription();});};
for(const action of ['handover','void'])$('#prescription-'+action+'-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,rx=state.prescription,p=rx?.prescriptions.find(x=>x.id===Number(f.elements.prescription.value));if(!rx||rx.branch!==state.branch||rx.visitId!==Number($('#prescription-visit').value)||!p)throw Error('请重新查询本次就诊处方。');
 await api('/api/prescriptions',command({action,visitId:rx.visitId,patientId:rx.patientId,prescriptionId:p.id,expectedRevision:p.revision,confirmed:f.elements.confirmed.checked,reason:f.elements.reason.value,...(action==='handover'?{recipientVerified:f.elements.confirmed.checked,handedOverAt:fixedNow}:{medicationNotDispensed:f.elements.confirmed.checked})}));f.reset();message(action==='handover'?'已记录处方文件交付，未据此推定取药。':'处方已作废，原记录保留。');await loadPrescription();});};
async function api(url,body){if(body){const previous=fixedNow,role=state.role,branch=state.branch,view=state.viewVersion,csrf=state.csrf;await syncClock();if(state.role!==role||state.branch!==branch||state.viewVersion!==view||state.csrf!==csrf)throw Error('岗位或门店已切换，请重新操作。');const actualTimes=new Set(['agreedAt','arrivedAt','assessedAt','at','completedAt','contactedAt','countedAt','endedAt','handedOverAt','occurredAt','receivedAt','reportedAt','startedAt','verifiedAt']);const update=(value,key)=>{if(Array.isArray(value))return value.map(v=>update(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,update(v,k)]));return actualTimes.has(key)&&value===previous?fixedNow:value;};body=update(body);}const response=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(state.role?{'X-Clinic-Role':state.role}:{}),...(state.csrf?{'X-CSRF-Token':state.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.message||'操作失败');return data;}
function command(fields){return {commandVersion:1,requestKey:crypto.randomUUID(),branchId:state.branch,...fields};}
function askReason(title){return new Promise(resolve=>{const dialog=$('#reason-dialog'),form=$('#reason-form');$('#reason-title').textContent=title;form.reset();dialog.onclose=()=>resolve(dialog.returnValue==='confirm'?form.elements.reason.value.trim():null);dialog.showModal();});}
$('#refresh-dashboard').onclick=e=>act(e.currentTarget,dashboard);
$('#refresh-branch-summary').onclick=e=>act(e.currentTarget,branchSummary);
$('#reason-cancel').onclick=()=>$('#reason-dialog').close('cancel');
$('#reason-form').onsubmit=e=>{e.preventDefault();if(e.currentTarget.elements.reason.value.trim())$('#reason-dialog').close('confirm');};
async function syncClock(){const status=await api('/api/status');fixedNow=status.businessTime;clockMode=status.clockMode||'fixed';}
function liveDefaults(){if(clockMode!=='live')return;const local=localInput(fixedNow),today=local.slice(0,10),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10),month=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);const s=$('#schedule-form');s.elements.businessDate.value=tomorrow;s.elements.start.value=tomorrow+'T09:00';s.elements.end.value=tomorrow+'T18:00';const f=$('#followup-create-form');f.elements.start.value=tomorrow;f.elements.end.value=tomorrow;f.elements.next.value=today;$('#followup-contact-form').elements.nextDate.value=tomorrow;$('#followup-assess-form').elements.nextDate.value=tomorrow;$('#quote-issue-form').elements.validFrom.value=today;$('#quote-issue-form').elements.validUntil.value=month;$('#price-draft-form').elements.validFrom.value=local;$('#approval-form').elements.validUntil.value=tomorrow+'T09:00';}
async function act(button,fn){button.disabled=true;try{await fn();}catch(e){message(e.message||'网络中断，请刷新并核对操作结果后再试。',true);}finally{button.disabled=false;if(typeof renderHome==='function'&&state.role)renderHome();}}
async function branches(){state.role=$('#role').value;const data=await api('/api/branches');const select=$('#branch');select.replaceChildren();for(const b of data.items)option(select,b.id,b.name);state.branch=Number(select.value)||null;await refresh();}
async function refresh(){
 state.viewVersion++;
 state.summaryVersion++;
 state.clinicalVersion++;
 state.financeVersion++;
 $('#branch-summary').replaceChildren();
 resetCashPatient();
 clearVisitContext();
 clearScheduleEdit();clearAppointmentChange();$('#quote-issue-form').hidden=true;for(const kind of ['offset','request','refund'])$('#prepay-'+kind+'-form').hidden=true;prepayState=null;state.options=null;state.bills=[];state.record=null;state.health=null;state.followups=null;state.followupBooking=null;state.inventory=null;$('#appointments').replaceChildren();$('#bills').replaceChildren();$('#payment-form').hidden=true;$('#record-form').hidden=true;$('#health-area').hidden=true;$('#addendum-area').hidden=true;$('#followup-create-form').hidden=true;
 state.dashboard=null;state.directoryData=null;state.purchases=null;state.branchStaff=null;state.treatment=null;
 $('#clinical-result').hidden=true;$('#clinical-result').replaceChildren();$('#clinical-grants').replaceChildren();$('#prescription-list').replaceChildren();$('#prescription-draft-form').hidden=true;$('#prescription-issue-form').hidden=true;$('#prescription-handover-form').hidden=true;$('#prescription-void-form').hidden=true;$('#prescription-empty').hidden=true;
 $('#reception').hidden=state.role!=='frontdesk';$('#finance').hidden=state.role!=='cashier';$('#dentist').hidden=state.role!=='dentist';$('#manager').hidden=state.role!=='manager';
 $('#inventory').hidden=!['manager','assistant'].includes(state.role);
 $('#catalog-area').hidden=!['manager','assistant','cashier'].includes(state.role);$('#catalog-service-form').hidden=state.role!=='cashier';$('#catalog-material-form').hidden=state.role!=='assistant';$('#supplier-area').hidden=state.role!=='manager';$('#catalog-materials').replaceChildren();$('#catalog-services').replaceChildren();$('#supplier-list').replaceChildren();$('#catalog-service-edit').hidden=true;clearCatalogMaterial();clearSupplier();
 $('#branch-staff-area').hidden=state.role!=='manager';$('#branch-staff-list').replaceChildren();
 $('#insurance-area').hidden=!['frontdesk','cashier','manager'].includes(state.role);$('#insurance-identity-form').hidden=true;state.insuranceVisits=[];
 $('#assistant-resources-area').hidden=state.role!=='assistant';
 $('#documents-area').hidden=!['dentist','assistant'].includes(state.role);state.documents=null;$('#documents-list').replaceChildren();$('#documents-upload').hidden=true;
 if(!state.branch){message('当前岗位没有可用门店。',true);return;}
 if(state.role==='frontdesk')await Promise.all([reception(),resources(),followups(),patients()]);
 if(state.role==='cashier')await Promise.all([finance(),cashierPrices(),quoteList()]);
 if(state.role==='dentist')await Promise.all([treatment(),clinicalGrants(),followups(),quoteList()]);
 if(state.role==='manager')await Promise.all([manager(),resources(),inventory(),purchases(),dashboard(),schedules(),prepayReview()]);
 if(state.role==='manager')await branchStaff();
 if(state.role==='manager')await suppliers();
 if(state.role==='assistant')await Promise.all([inventory(),purchases(),resources()]);
 if(['dentist','assistant'].includes(state.role))await documentOptions();
 if(['frontdesk','cashier','manager'].includes(state.role))await insuranceOptions();
 renderWorkspace();
}
async function branchStaff(){const branch=state.branch,view=state.viewVersion,data=await api('/api/branch-staff?branchId='+branch);if(state.role!=='manager'||state.branch!==branch||state.viewVersion!==view)return;state.branchStaff=data;$('#branch-details-form').elements.name.value=data.branch.name;const seenAccounts=new Set();const box=$('#branch-staff-list');box.replaceChildren();const labels={frontdesk:'前台',dentist:'牙医',assistant:'助理',cashier:'收费人员',branch_manager:'负责人',manager:'负责人'};if(!data.staff.length)box.textContent='本店暂无人员。';for(const s of data.staff){const p=document.createElement('p');p.textContent=s.name+' / '+(s.login_name||'无账号')+' / '+(labels[s.role_code]||s.role_code)+' / '+(s.revoked_at?'已撤销':s.account_status||'账号待核对')+'　';if(!s.revoked_at){const b=document.createElement('button');b.type='button';b.textContent='撤销本店岗位';b.onclick=()=>act(b,async()=>{const reason=await askReason('填写撤销本店岗位的依据');if(!reason)return;if(state.branch!==branch||state.role!=='manager'||state.viewVersion!==view)throw Error('门店已变化，请重新操作。');await api('/api/branch-staff',command({action:'revoke',grantId:s.grant_id,reason}));message('本店岗位已撤销。');await Promise.all([branchStaff(),schedules()]);});p.append(b);}if(s.account_status&&!seenAccounts.has(s.id)){seenAccounts.add(s.id);const toggle=document.createElement('button');toggle.type='button';toggle.textContent=s.account_status==='启用'?'停用账号':'启用账号';toggle.onclick=()=>act(toggle,async()=>{const reason=await askReason('填写'+toggle.textContent+'依据（影响该人员全部门店）');if(!reason)return;if(state.branch!==branch||state.role!=='manager'||state.viewVersion!==view)throw Error('门店已变化，请重新操作。');await api('/api/branch-staff',command({action:s.account_status==='启用'?'disable':'enable',staffId:s.id,expectedRevision:s.staff_revision,reason}));message('账号状态已更新。');await Promise.all([branchStaff(),schedules()]);});p.append(toggle);}box.append(p);}
const staffRows=[...box.children];
box.replaceChildren();
if(data.staff.length)box.append(dataTable(['人员','账号','本店岗位','账号与岗位状态','操作'],data.staff.map((person,index)=>{
 const actions=document.createElement('div');actions.className='row-actions';
 actions.append(...staffRows[index].querySelectorAll('button'));
 return [person.name,person.login_name,labels[person.role_code]||person.role_code,person.revoked_at?'岗位已撤销':person.account_status||'待核对',actions];
})));
else box.textContent='本店暂无人员。';
const f=$('#branch-staff-grant-form'),select=f.elements.staff;select.replaceChildren();for(const s of data.candidates)option(select,s.id,s.name+' / '+s.login_name);const update=()=>{const person=data.candidates.find(x=>x.id===Number(select.value)),roles=f.elements.role;roles.replaceChildren();for(const r of person?.roles||[])option(roles,r,labels[r]||r);f.querySelector('button').disabled=!roles.options.length;};select.onchange=update;update();}
$('#branch-staff-grant-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/branch-staff',command({action:'grant',staffId:Number(f.elements.staff.value),role:f.elements.role.value,reason:f.elements.reason.value}));f.elements.reason.value='';message('已有人员已安排到本店岗位。');await Promise.all([branchStaff(),schedules()]);});};
$('#branch-staff-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/branch-staff',command({action:'create',name:f.elements.name.value,username:f.elements.username.value,password:f.elements.password.value,role:f.elements.role.value,basis:f.elements.basis.value,reason:f.elements.reason.value}));f.reset();message('本店人员与个人账号已建立。');await Promise.all([branchStaff(),schedules()]);});};
$('#branch-details-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,branch=state.branchStaff?.branch;if(!branch||branch.id!==state.branch)throw Error('请重新查看门店资料。');const name=f.elements.name.value.trim();await api('/api/branch-details',command({expectedName:branch.name,name,reason:f.elements.reason.value}));const selected=$('#branch').selectedOptions[0];if(selected)selected.textContent=name;f.elements.reason.value='';message('门店名称已更新。');await branchStaff();});};
async function insuranceOptions(){const branch=state.branch,role=state.role,view=state.viewVersion,data=await api('/api/insurance/options?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==view)return;state.insuranceVisits=data.visits;const form=$('#insurance-identity-form'),select=form.elements.visit;select.replaceChildren();for(const v of data.visits)option(select,v.id,v.patient_name+'（'+v.patient_no+'） / '+v.record_no);$('#insurance-status').textContent=data.enabled?'一店虚构医保演示已启用；当前不联网。':'本店未启用医保演示。';form.hidden=!data.enabled||!data.visits.length||role==='manager';const history=$('#insurance-history');history.replaceChildren();for(const i of data.identities||[]){const v=data.visits.find(x=>x.id===i.visitId),p=document.createElement('p');p.textContent=(v?.patient_name||'患者')+' / '+(v?.record_no||'就诊')+'：'+i.status+' / '+i.area+' / '+date(i.verifiedAt)+(i.personSuffix?' / 编号尾号 '+i.personSuffix:'')+'　';if(data.enabled&&role!=='manager'&&i.status==='核验通过'&&v&&!(data.cases||[]).some(c=>c.visit_id===v.id&&c.status!=='已撤销')){const b=document.createElement('button');b.type='button';b.textContent='登记本次医保办理';b.onclick=()=>act(b,async()=>{const evidence=await askReason('填写医保办理登记依据（仅虚构演示）');if(!evidence)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==view)throw Error('岗位或门店已变化，请重新操作。');await api('/api/insurance/register',command({visitId:v.id,patientId:v.patient_id,identityId:i.id,evidence}));message('已登记虚构医保办理，等待预结算。');await refreshInsuranceAndFinance();});p.append(b);}history.append(p);}for(const c of data.cases||[]){const v=data.visits.find(x=>x.id===c.visit_id),p=document.createElement('p');p.textContent='医保办理 '+c.business_no+' / '+(v?.patient_name||'患者')+' / '+c.status+' / 患者选择：'+c.patient_choice+(c.estimated_fund_cents==null?'':' / 基金 '+(c.estimated_fund_cents/100).toFixed(2)+' 元、个人账户 '+(c.estimated_account_cents/100).toFixed(2)+' 元、自付 '+(c.estimated_patient_cents/100).toFixed(2)+' 元');if(role==='cashier'&&c.status==='预结算完成'&&c.patient_choice!=='医保'){const button=document.createElement('button');button.type='button';button.textContent='记录患者选择医保';button.onclick=()=>act(button,async()=>{const evidence=await askReason('填写已向患者说明及患者选择依据');if(!evidence)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==view)throw Error('岗位或门店已变化');await api('/api/insurance/choice',command({caseId:c.id,expectedRevision:c.revision,choice:'医保',patientConfirmed:true,evidence}));message('已记录患者选择医保。');await refreshInsuranceAndFinance();});p.append(button);}if(role==='cashier'&&['待预结算','预结算完成'].includes(c.status)){const self=document.createElement('button');self.type='button';self.textContent='记录患者选择自费';self.onclick=()=>act(self,async()=>{const evidence=await askReason('填写患者选择自费的确认依据');if(!evidence)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==view)throw Error('岗位或门店已变化');await api('/api/insurance/choice',command({caseId:c.id,expectedRevision:c.revision,choice:'自费',patientConfirmed:true,evidence}));message('已记录患者选择自费；请核对账单。');await refreshInsuranceAndFinance();});p.append(self);}if(role==='cashier'&&c.status==='预结算完成'&&c.patient_choice==='医保'){const b=document.createElement('button');b.type='button';b.textContent='提交虚构医保结算';b.onclick=()=>act(b,async()=>{const evidence=await askReason('填写已核对原医保办理的依据');if(!evidence)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==view)throw Error('岗位或门店已变化');await api('/api/insurance/settle',command({action:'submit',caseId:c.id,expectedRevision:c.revision,businessNo:c.business_no,evidence}));message('已提交虚构结算，等待核实结果。');await refreshInsuranceAndFinance();});p.append(b);}history.append(p);}renderInsuranceExtra(data);renderInsuranceSettlement(data);}
$('#insurance-identity-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,v=state.insuranceVisits.find(x=>x.id===Number(f.elements.visit.value));if(!v)throw Error('请重新选择本店就诊。');await api('/api/insurance/identity',command({visitId:v.id,patientId:v.patient_id,outcome:f.elements.outcome.value,personNo:f.elements.personNo.value||null,area:f.elements.area.value,verifiedAt:fixedNow,validUntil:f.elements.outcome.value==='passed'?new Date(Date.parse(fixedNow)+30*86400000).toISOString().replace('.000Z','Z'):null,evidence:f.elements.evidence.value}));f.reset();message('虚构医保身份核验结果已登记；未连接医保平台。');await refreshInsuranceAndFinance();});};
function renderInsuranceExtra(data){state.insuranceData=data;const mapping=$('#insurance-mapping-form'),prepare=$('#insurance-prepare-form');mapping.hidden=state.role!=='manager'||!data.enabled;prepare.hidden=state.role!=='cashier'||!data.enabled;const services=mapping.elements.service;services.replaceChildren();for(const s of data.services||[])option(services,s.id,s.name);if(!mapping.elements.from.value)mapping.elements.from.value=localInput(fixedNow).slice(0,10);const cases=prepare.elements.namedItem('case');cases.replaceChildren();for(const c of data.cases.filter(c=>c.status==='待预结算'&&c.identity_id))option(cases,c.id,c.business_no);const updateBills=()=>{const c=data.cases.find(x=>x.id===Number(cases.value)),select=prepare.elements.bill;select.replaceChildren();for(const b of data.bills.filter(x=>x.patient_id===c?.patient_id))option(select,b.id,b.record_no+' / 应收 '+(b.summary.receivableCents/100).toFixed(2)+' 元');updateItems();};const updateItems=()=>{const c=data.cases.find(x=>x.id===Number(cases.value)),b=data.bills.find(x=>x.id===Number(prepare.elements.bill.value)),identity=data.identities.find(x=>x.id===c?.identity_id),box=$('#insurance-fee-items');box.replaceChildren();for(const item of b?.items||[]){const label=document.createElement('label'),sel=document.createElement('select');sel.dataset.itemId=item.id;sel.required=true;option(sel,'','请选择');option(sel,'self','明确自费');for(const m of data.mappings.filter(x=>x.service_id===item.service_id&&x.insured_area===identity?.area))option(sel,m.id,m.insurance_code);label.textContent=item.service_name+' / '+(item.amount_cents/100).toFixed(2)+' 元 ';label.append(sel);box.append(label);}prepare.querySelector('button').disabled=!c||!b||!b.items.length;};cases.onchange=updateBills;prepare.elements.bill.onchange=updateItems;updateBills();const settle=$('#insurance-settle-form'),settleCases=settle.elements.namedItem('case');settleCases.replaceChildren();for(const c of data.cases.filter(x=>x.status==='结算待核实'))option(settleCases,c.id,c.business_no);settle.hidden=state.role!=='cashier'||!data.enabled||!settleCases.options.length;const fillSettlement=()=>{const c=data.cases.find(x=>x.id===Number(settleCases.value));if(!c)return;settle.elements.fund.value=c.estimated_fund_cents;settle.elements.account.value=c.estimated_account_cents;settle.elements.patient.value=c.estimated_patient_cents;};settleCases.onchange=fillSettlement;fillSettlement();}
$('#insurance-mapping-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/insurance/mapping',command({action:'create',serviceId:Number(f.elements.service.value),code:f.elements.code.value,area:f.elements.area.value,validFrom:f.elements.from.value,evidence:f.elements.evidence.value}));message('虚构医保项目对应已保存。');await refreshInsuranceAndFinance();});};
$('#insurance-prepare-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=state.insuranceData,c=data?.cases.find(x=>x.id===Number(f.elements.namedItem('case').value)),b=data?.bills.find(x=>x.id===Number(f.elements.bill.value));if(!c||!b||b.patient_id!==c.patient_id)throw Error('请重新选择医保办理和本店账单。');const items=[...$('#insurance-fee-items').querySelectorAll('select')].map(s=>{if(!s.value)throw Error('请逐项选择医保编码或自费。');const m=data.mappings.find(x=>x.id===Number(s.value));return s.value==='self'?{billItemId:Number(s.dataset.itemId),isSelfPay:true}:{billItemId:Number(s.dataset.itemId),mappingId:m.id,expectedRevision:m.revision,isSelfPay:false};});await api('/api/insurance/prepare',command({action:'record',caseId:c.id,expectedRevision:c.revision,billId:b.id,expectedBillRevision:b.revision,identityId:c.identity_id,items,diagnosisCode:f.elements.diagnosis.value,reference:f.elements.reference.value,uploadedAt:fixedNow,validUntil:new Date(Date.parse(fixedNow)+86400000).toISOString().replace('.000Z','Z'),fundCents:Number(f.elements.fund.value),accountCents:Number(f.elements.account.value),patientCents:Number(f.elements.patient.value),evidence:f.elements.evidence.value}));message('虚构预结算结果已登记，请向患者说明并记录选择。');await refreshInsuranceAndFinance();});};
$('#insurance-settle-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,c=state.insuranceData?.cases.find(x=>x.id===Number(f.elements.namedItem('case').value));if(!c||c.status!=='结算待核实')throw Error('请选择待核实的医保办理。');await api('/api/insurance/settle',command({action:'verify',caseId:c.id,expectedRevision:c.revision,businessNo:c.business_no,outcome:'success',patientMatches:f.elements.confirmed.checked,reference:f.elements.reference.value,fundCents:Number(f.elements.fund.value),accountCents:Number(f.elements.account.value),patientCents:Number(f.elements.patient.value),confirmedAt:fixedNow,evidence:f.elements.evidence.value}));f.reset();message('虚构医保结算结果已登记；未连接医保平台。');await refreshInsuranceAndFinance();});};
function renderInsuranceSettlement(data){const box=$('#insurance-settlement-actions');box.replaceChildren();const fund=$('#insurance-fund-form'),reverse=$('#insurance-reverse-form'),select=fund.elements.settlement,pending=reverse.elements.reversal;select.replaceChildren();pending.replaceChildren();for(const c of data.cases){const s=c.settlement;if(!s)continue;const p=document.createElement('p');p.textContent='医保结算 '+s.external_reference+' / '+s.status+' / 基金 '+(s.fund_cents/100).toFixed(2)+' 元 / 个人账户 '+(s.account_cents/100).toFixed(2)+' 元　';if(state.role==='manager'&&data.enabled&&s.status==='有效'&&!data.reversals.some(r=>r.settlement_id===s.id&&['待办理','待核实'].includes(r.status))){const b=document.createElement('button');b.type='button';b.textContent='批准撤销';b.onclick=()=>act(b,async()=>{const reason=await askReason('填写撤销原因和负责人核对依据');if(!reason)return;if(state.insuranceData!==data)throw Error('门店已变化，请重新查询。');await api('/api/insurance/reverse',command({action:'initiate',settlementId:s.id,expectedRevision:s.revision,reason,evidence:reason,approvalBasis:reason}));message('已批准虚构撤销，等待收费人员核实结果。');await refreshInsuranceAndFinance();});p.append(b);}box.append(p);option(select,s.id,s.external_reference+' / '+s.status);}for(const r of data.reversals.filter(x=>['待办理','待核实'].includes(x.status)))option(pending,r.id,r.business_no);fund.hidden=state.role!=='cashier'||!data.enabled||!select.options.length;reverse.hidden=state.role!=='cashier'||!data.enabled||!pending.options.length;}
$('#insurance-fund-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,s=state.insuranceData?.cases.map(c=>c.settlement).find(x=>x?.id===Number(f.elements.settlement.value));if(!s)throw Error('请重新选择医保结算。');await api('/api/insurance/receipt',command({settlementId:s.id,expectedRevision:s.revision,flowType:f.elements.flow.value,amountCents:Number(f.elements.amount.value),occurredAt:fixedNow,reference:f.elements.reference.value,evidence:f.elements.evidence.value}));f.reset();message('虚构医保款项已登记。');await refreshInsuranceAndFinance();});};
$('#insurance-reverse-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,r=state.insuranceData?.reversals.find(x=>x.id===Number(f.elements.reversal.value));if(!r)throw Error('请选择待核实撤销记录。');await api('/api/insurance/reverse',command({action:'verify',reversalId:r.id,expectedRevision:r.revision,businessNo:r.business_no,outcome:'success',patientMatches:f.elements.confirmed.checked,reference:f.elements.reference.value,evidence:f.elements.evidence.value}));f.reset();message('虚构医保撤销结果已登记。');await refreshInsuranceAndFinance();});};
async function refreshInsuranceAndFinance(){await insuranceOptions();if(state.role==='cashier')await finance();}
async function documentOptions(){const branch=state.branch,role=state.role,view=state.viewVersion,data=await api('/api/documents/options?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==view)return;state.documentVisits=data.visits;const select=$('#documents-visit');select.replaceChildren();for(const v of data.visits)option(select,v.id,v.patient_name+'（'+v.patient_no+'） / '+v.record_no);$('#documents-load').disabled=!data.visits.length;}
function clearDocuments(){state.documents=null;$('#documents-list').replaceChildren();$('#documents-upload').hidden=true;}
$('#documents-visit').onchange=clearDocuments;
async function loadDocuments(){clearDocuments();const branch=state.branch,role=state.role,view=state.viewVersion,visitId=Number($('#documents-visit').value),visit=state.documentVisits?.find(v=>v.id===visitId);if(!visit)throw Error('请先选择本店就诊。');const data=await api('/api/documents?branchId='+branch+'&visitId='+visitId+'&patientId='+visit.patient_id);if(state.branch!==branch||state.role!==role||state.viewVersion!==view||Number($('#documents-visit').value)!==visitId)return;state.documents={...data,branch,visitId,patientId:visit.patient_id};const list=$('#documents-list');if(!data.documents.length)list.textContent='本次就诊暂无文件。';for(const d of data.documents){const heading=document.createElement('p');heading.textContent=d.record_no+' / '+d.document_type+' / 来源：'+d.source;list.append(heading);for(const v of d.versions){const p=document.createElement('p');p.textContent='版本 '+v.version_no+' / '+v.original_name+' / '+v.status+(v.available?'':'（原件不可读）')+'　';const download=document.createElement('button');download.type='button';download.textContent='下载原件';download.disabled=!v.available;download.onclick=()=>act(download,async()=>{const current=state.documents;if(!current||current.visitId!==visitId||state.branch!==branch)throw Error('请重新查询就诊文件。');const file=await api('/api/documents/download',command({visitId,patientId:visit.patient_id,versionId:v.id}));if(state.viewVersion!==view||state.role!==role||state.branch!==branch||state.documents!==current)throw Error('工作区已切换，请重新查询文件。');const bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:file.mediaType})),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});p.append(download);if(role==='dentist'&&v.status==='原件待确认'&&v.available){const confirm=document.createElement('button');confirm.type='button';confirm.textContent='确认患者归属';confirm.onclick=()=>act(confirm,async()=>{const note=await askReason('请填写核对患者和原件的依据');if(!note)return;if(!state.documents||state.viewVersion!==view||state.role!==role||state.branch!==branch||state.documents.visitId!==visitId)throw Error('就诊已变化，请重新查询。');await api('/api/documents/verify',command({visitId,patientId:visit.patient_id,versionId:v.id,expectedRevision:v.revision,action:'confirm',confirmed:true,verificationNote:note}));message('文件归属已确认。');await loadDocuments();});p.append(confirm);}list.append(p);}}$('#documents-upload').hidden=false;}
$('#documents-load').onclick=e=>act(e.currentTarget,async()=>{await loadDocuments();const select=$('#documents-upload').elements.existing;select.replaceChildren();option(select,'','新建文件');for(const d of state.documents?.documents||[])option(select,d.id,'补充 '+d.record_no+' / '+d.document_type);});
$('#documents-upload').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,d=state.documents,file=f.elements.file.files[0];if(!d||d.branch!==state.branch||d.visitId!==Number($('#documents-visit').value)||!file)throw Error('请重新选择就诊和文件。');const existing=f.elements.existing.value?d.documents.find(x=>x.id===Number(f.elements.existing.value)):null;if(f.elements.existing.value&&!existing)throw Error('文件已变化，请重新查询。');if(file.size>10*1024*1024)throw Error('文件不能超过 10 MB。');const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('读取文件失败。'));reader.readAsDataURL(file);});if(state.documents!==d||state.branch!==d.branch)throw Error('就诊已变化，请重新选择文件。');await api('/api/documents/upload',command({visitId:d.visitId,patientId:d.patientId,...(existing?{documentId:existing.id,expectedRevision:existing.revision}:{}),documentType:f.elements.type.value,originalName:file.name,contentBase64:encoded,source:f.elements.source.value,ownershipNote:f.elements.ownership.value,capturedAt:f.elements.captured.value?isoLocal(f.elements.captured.value):null,reason:f.elements.reason.value}));f.reset();message('文件已上传，等待牙医核对。');await loadDocuments();const select=f.elements.existing;select.replaceChildren();option(select,'','新建文件');for(const doc of state.documents?.documents||[])option(select,doc.id,'补充 '+doc.record_no+' / '+doc.document_type);});};
function patientLabel(p){return p.name+'（'+(p.birth_date?'出生 '+p.birth_date+'；':'出生日期未记录；')+p.record_no+'）';}
function visitPatientLabel(p){return patientLabel({name:p.patient_name,record_no:p.patient_no,birth_date:p.patient_birth_date});}
function applyPatientFilter(){const term=$('#patient-filter').value.trim().toLocaleLowerCase();for(const formId of ['#patient-edit-form','#appointment-form','#walkin-form']){const select=$(formId).elements.patient;let selected=null;for(const item of select.options){item.hidden=!!term&&!item.textContent.toLocaleLowerCase().includes(term);if(!item.hidden&&!selected)selected=item;}const current=select.selectedOptions[0];if(!current||current.hidden){select.value=selected?.value||'';if(select.onchange)select.onchange();}}}
$('#patient-filter').oninput=applyPatientFilter;
async function patients(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/patients?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.directoryData=data.patients;renderPatientDirectory();const form=$('#patient-edit-form'),select=form.elements.patient;select.replaceChildren();for(const p of data.patients)option(select,p.id,patientLabel(p));const fill=()=>{const p=data.patients.find(x=>x.id===Number(select.value));if(!p){for(const name of ['patientName','birthDate','phone','owner','unavailable'])form.elements[name].value='';delete form.dataset.revision;return;}form.elements.patientName.value=p.name;form.elements.birthDate.value=p.birth_date||'';form.elements.phone.value=p.phone||'';form.elements.owner.value=p.phone_owner||'';form.elements.unavailable.value=p.contact_unavailable_reason||'';form.dataset.revision=p.revision;};select.onchange=fill;form.hidden=!data.patients.length;applyPatientFilter();fill();}
function clearScheduleEdit(){const f=$('#schedule-form');delete f.dataset.id;delete f.dataset.revision;$('#schedule-submit').textContent='发布排班';$('#schedule-edit-cancel').hidden=true;}
$('#schedule-edit-cancel').onclick=clearScheduleEdit;
async function schedules(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/schedules?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;const form=$('#schedule-form'),list=$('#schedule-items');form.elements.dentist.replaceChildren();form.elements.chair.replaceChildren();for(const d of data.dentists)option(form.elements.dentist,d.id,d.name);for(const c of data.chairs)option(form.elements.chair,c.id,c.name);form.hidden=!data.dentists.length||!data.chairs.length;list.replaceChildren();if(!data.schedules.length)list.textContent='本店暂无排班。';for(const s of data.schedules){const p=document.createElement('p');p.textContent=(data.dentists.find(d=>d.id===s.dentist_id)?.name||'牙医 '+s.dentist_id)+' / '+(data.chairs.find(c=>c.id===s.dental_chair_id)?.name||'诊椅 '+s.dental_chair_id)+' / '+date(s.starts_at)+' 至 '+date(s.ends_at)+' / '+s.status+'　';if(s.status==='已确认'){const edit=document.createElement('button');edit.type='button';edit.textContent='调整排班';edit.onclick=()=>{form.dataset.id=s.id;form.dataset.revision=s.revision;form.elements.dentist.value=s.dentist_id;form.elements.chair.value=s.dental_chair_id;form.elements.businessDate.value=s.business_date;form.elements.start.value=localInput(s.starts_at);form.elements.end.value=localInput(s.ends_at);form.elements.reason.value='';$('#schedule-submit').textContent='保存排班调整';$('#schedule-edit-cancel').hidden=false;revealTask(form);};p.append(edit);const b=document.createElement('button');b.type='button';b.textContent='停诊';b.onclick=()=>act(b,async()=>{const reason=await askReason('填写停诊依据');if(!reason)return;await api('/api/setup',command({action:'close',scheduleId:s.id,expectedRevision:s.revision,reason}));message('排班已停诊。');await schedules();});p.append(b);}list.append(p);}
 const entries=[...list.children];
 if(data.schedules.length){
   list.replaceChildren();
   list.append(dataTable(['营业日期','牙医','诊椅','时段','状态','办理'],data.schedules.map((item,index)=>{
     const actions=document.createElement('div');actions.className='row-actions';actions.append(...entries[index].querySelectorAll('button'));
     return [item.business_date,data.dentists.find(d=>d.id===item.dentist_id)?.name,data.chairs.find(c=>c.id===item.dental_chair_id)?.name,localInput(item.starts_at).slice(11,16)+' – '+localInput(item.ends_at).slice(11,16),item.status,actions];
   })));
 }
}
async function dashboard(){state.summaryVersion++;$('#branch-summary').replaceChildren();const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/dashboard?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.dashboard=data;const box=$('#dashboard');box.replaceChildren();const p=document.createElement('p');p.textContent=data.businessDate+'：预约 '+(Object.entries(data.appointments).map(([k,v])=>k+' '+v+' 个').join('、')||'0 个')+'；到诊 '+data.arrivals+' 人次；已确认收款 '+(data.confirmedReceiptCents/100).toFixed(2)+' 元（'+data.confirmedReceiptCount+' 笔）；已确认退款 '+(data.confirmedRefundCents/100).toFixed(2)+' 元（'+data.confirmedRefundCount+' 笔）；收退差额 '+(data.netReceiptCents/100).toFixed(2)+' 元；库存记录 '+data.stockRecords+' 条；待审核盘点 '+data.pendingCounts+' 条；待确认采购 '+data.pendingPurchases+' 单。';box.append(p);
 const metrics=[
 ['营业日',data.businessDate],['今日到诊',data.arrivals+' 人次'],
 ['已确认收款','¥'+(data.confirmedReceiptCents/100).toFixed(2)],
 ['已确认退款','¥'+(data.confirmedRefundCents/100).toFixed(2)],
 ['收退差额','¥'+(data.netReceiptCents/100).toFixed(2)],
 ['待确认采购',data.pendingPurchases+' 单'],['待审核盘点',data.pendingCounts+' 条']
 ];
 const display=document.createElement('div');display.className='work-metrics';
 for(const [label,value] of metrics){const cell=document.createElement('div');const name=document.createElement('span');name.textContent=label;const n=document.createElement('strong');n.textContent=value;cell.append(name,n);display.append(cell);}
 box.replaceChildren(display);
}
async function branchSummary(){
 const box=$('#branch-summary'),role=state.role,branch=state.branch,viewVersion=state.viewVersion,summaryVersion=++state.summaryVersion;box.replaceChildren();
 const {items}=await api('/api/branches');
 const rows=await Promise.all(items.map(async b=>({name:b.name,data:await api('/api/dashboard?branchId='+encodeURIComponent(b.id))})));
 if(state.role!==role||state.branch!==branch||state.viewVersion!==viewVersion||state.summaryVersion!==summaryVersion)return;
 if(!rows.length){box.textContent='当前没有可查看的门店。';return;}
 if(rows.some(r=>r.data.businessDate!==rows[0].data.businessDate))throw new Error('各门店统计日期不一致，请重新查询。');
 const appointmentText=counts=>Object.entries(counts).map(([status,count])=>status+' '+count+' 个').join('、')||'0 个';
 const money=cents=>{const value=BigInt(cents);return (value/100n)+'.'+String(value%100n).padStart(2,'0');};
 let total=0n,refundTotal=0n,arrivals=0,pendingCounts=0,pendingPurchases=0;const appointments={};
 for(const row of rows){const d=row.data;total+=BigInt(d.confirmedReceiptCents);refundTotal+=BigInt(d.confirmedRefundCents);arrivals+=d.arrivals;pendingCounts+=d.pendingCounts;pendingPurchases+=d.pendingPurchases;
  for(const [status,count] of Object.entries(d.appointments))appointments[status]=(appointments[status]||0)+count;
  const p=document.createElement('p');p.textContent=row.name+'（'+d.businessDate+'）：预约 '+appointmentText(d.appointments)+'；到诊 '+d.arrivals+' 人次；已确认收款 ¥'+money(d.confirmedReceiptCents)+'；已确认退款 ¥'+money(d.confirmedRefundCents)+'；待审核盘点 '+d.pendingCounts+' 条；待确认采购 '+d.pendingPurchases+' 单。';box.append(p);}
 const sum=document.createElement('p');sum.textContent='已授权 '+rows.length+' 家门店合计（'+rows[0].data.businessDate+'）：预约 '+appointmentText(appointments)+'；到诊 '+arrivals+' 人次；已确认收款 ¥'+money(total)+'；已确认退款 ¥'+money(refundTotal)+'；待审核盘点 '+pendingCounts+' 条；待确认采购 '+pendingPurchases+' 单。';box.append(sum);
}
async function purchases(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/purchases?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.purchases=data;const list=$('#purchase-items');list.replaceChildren();if(!data.orders.length)list.textContent='本店暂无采购单。';
 for(const order of data.orders){const line=document.createElement('p');line.textContent=order.record_no+'；'+order.items.map(item=>{const m=data.materials.find(x=>x.id===item.material_id);return (m?.name||'材料 '+item.material_id)+' '+quantityText(item.ordered_quantity_scaled,m?.quantity_scale||0)+' '+(m?.base_unit||'')+'（'+item.status+'）';}).join('、')+'；'+order.status+'　';
  if(role==='manager'&&order.status==='待确认'){const button=document.createElement('button');button.type='button';button.textContent='确认采购';button.onclick=()=>act(button,async()=>{const note=await askReason('填写采购审核意见');if(!note)return;const supplier=data.suppliers.find(s=>s.id===order.supplier_id);if(!supplier)throw new Error('供应商已停用，请核对。');await api('/api/purchases',command({action:'approve',purchaseId:order.id,expectedRevision:order.revision,expectedSupplierRevision:supplier.revision,reviewNote:note}));message('采购已确认。');await Promise.all([purchases(),dashboard()]);});line.append(button);const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消采购';cancel.onclick=()=>act(cancel,async()=>{const note=await askReason('填写取消采购的依据');if(!note)return;await api('/api/purchases',command({action:'cancel',purchaseId:order.id,expectedRevision:order.revision,reviewNote:note}));message('采购已取消。');await Promise.all([purchases(),dashboard()]);});line.append(cancel);}list.append(line);for(const receipt of order.receipts){const detail=document.createElement('p');detail.textContent='验收 '+receipt.record_no+' / '+date(receipt.arrived_at)+' / '+receipt.status+' / 随货依据：'+receipt.delivery_evidence+'；'+receipt.items.map(i=>{const item=order.items.find(x=>x.id===i.purchase_order_item_id),m=data.materials.find(x=>x.id===item?.material_id);return (m?.name||'材料 '+item?.material_id)+'：到货 '+quantityText(i.arrived_quantity_scaled,m?.quantity_scale||0)+'、合格 '+quantityText(i.accepted_quantity_scaled,m?.quantity_scale||0)+'、拒收 '+quantityText(i.rejected_quantity_scaled,m?.quantity_scale||0)+'、待检 '+quantityText(i.pending_quantity_scaled,m?.quantity_scale||0)+' '+(m?.base_unit||'')+'；检验：'+i.inspection_note;}).join('；');list.append(detail);}}
 const form=$('#purchase-form');form.elements.supplier.replaceChildren();for(const s of data.suppliers)option(form.elements.supplier,s.id,s.name);for(const select of form.querySelectorAll('[name=material]')){const previous=select.value;select.replaceChildren();for(const m of data.materials)option(select,m.id,m.name+' / '+m.base_unit);if([...select.options].some(o=>o.value===previous))select.value=previous;}form.hidden=role!=='assistant'||!data.suppliers.length||!data.materials.length;
 const receive=$('#receive-form'),select=receive.elements.purchase,itemSelect=receive.elements.purchaseItem;select.replaceChildren();for(const p of data.orders.filter(p=>p.status==='已确认'&&p.items.some(i=>!['履行已完成','剩余已取消'].includes(i.status))))option(select,p.id,p.record_no);
 const refreshBatches=()=>{const p=data.orders.find(x=>x.id===Number(select.value)),item=p?.items.find(x=>x.id===Number(itemSelect.value));receive.elements.batch.replaceChildren();for(const b of data.batches.filter(x=>x.material_id===item?.material_id))option(receive.elements.batch,b.id,b.batch_no+' / '+b.status);};const refreshItems=()=>{const p=data.orders.find(x=>x.id===Number(select.value));itemSelect.replaceChildren();for(const i of p?.items.filter(x=>!['履行已完成','剩余已取消'].includes(x.status))||[]){const m=data.materials.find(x=>x.id===i.material_id);option(itemSelect,i.id,m?.name||'材料 '+i.material_id);}refreshBatches();};select.onchange=refreshItems;itemSelect.onchange=refreshBatches;refreshItems();receive.elements.location.replaceChildren();for(const l of data.locations)option(receive.elements.location,l.id,l.name);receive.hidden=role!=='assistant'||!select.options.length||!data.locations.length;
 const batchList=$('#purchase-batches');batchList.replaceChildren();if(!data.batches.length)batchList.textContent='本店暂无批次。';for(const b of data.batches){const p=document.createElement('p'),m=data.materials.find(x=>x.id===b.material_id);p.textContent=(m?.name||'材料 '+b.material_id)+' / '+b.batch_no+'；'+b.status+'；效期 '+(b.expiry_date||'未记录')+'　';if(role==='manager'&&b.status==='待检'){const button=document.createElement('button');button.type='button';button.textContent='确认放行';button.onclick=()=>act(button,async()=>{const reason=await askReason('填写批次放行依据');if(!reason)return;await api('/api/inventory/batch',command({action:'release',batchId:b.id,expectedRevision:b.revision,reason}));message('批次已放行。');await Promise.all([purchases(),inventory()]);});p.append(button);}batchList.append(p);}
 const batchForm=$('#batch-form');batchForm.elements.material.replaceChildren();for(const m of data.materials)option(batchForm.elements.material,m.id,m.name);batchForm.hidden=role!=='assistant'||!data.materials.length;
 const inspection=$('#inspect-form'),inspectionSelect=inspection.elements.namedItem('item');inspectionSelect.replaceChildren();for(const p of data.orders)for(const r of p.receipts)for(const i of r.items.filter(x=>x.pending_quantity_scaled>0))option(inspectionSelect,i.id,p.record_no+' / '+r.record_no+' / 待检 '+i.pending_quantity_scaled);inspection.hidden=role!=='assistant'||!inspectionSelect.options.length;
}
async function inventory(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/inventory?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.inventory=data;
 const catalog=$('#catalog-materials');catalog.replaceChildren();for(const m of data.materials){const p=document.createElement('p');p.textContent=m.name+' / '+m.specification+' / '+(m.is_active?'启用':m.confirmed_at?'停用':'待负责人确认')+'　';if(role==='manager'){const action=m.is_active?'deactivateMaterial':'confirmMaterial',b=document.createElement('button');b.type='button';b.textContent=m.is_active?'停用材料':m.confirmed_at?'重新启用':'确认材料';b.onclick=()=>act(b,async()=>{const reason=await askReason('填写材料及单位核对依据');if(!reason)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)throw Error('门店已变化，请重新查询。');await api('/api/catalog',command({action,materialId:m.id,expectedRevision:m.revision,reason}));message('统一材料状态已更新。');await Promise.all([inventory(),purchases()]);});p.append(b);}if(role==='assistant'){const b=document.createElement('button');b.type='button';b.textContent='修改材料';b.onclick=()=>{const f=$('#catalog-material-form');f.dataset.id=m.id;f.dataset.revision=m.revision;f.dataset.denominator=m.conversion_denominator;f.elements.name.value=m.name;f.elements.specification.value=m.specification;f.elements.unit.value=m.base_unit;f.elements.purchaseUnit.value=m.purchase_unit;f.elements.conversion.value=m.conversion_numerator;f.elements.denominator.value=m.conversion_denominator;f.elements.scale.value=m.quantity_scale;f.elements.trace.checked=!!m.requires_trace;f.elements.expiry.checked=!!m.requires_expiry;f.elements.drug.checked=!!m.is_drug;f.elements.reason.value='';$('#catalog-material-submit').textContent='保存材料修改';$('#catalog-material-cancel').hidden=false;revealTask(f);};p.append(b);}catalog.append(p);}
 const list=$('#inventory-items'),f=$('#issue-form'),select=f.elements.stock;list.replaceChildren();select.replaceChildren();if(!data.items.length)list.textContent='本店暂无已确认归属的库存。';
 for(const item of data.items){const p=document.createElement('p');p.textContent=item.materialName+'（'+item.specification+'）　批次 '+item.batchNo+'　'+item.locationName+'　库存 '+quantityText(item.quantityScaled,item.scale)+' '+item.unit+'　'+(item.available?'可领用':'不可领用')+'　效期 '+(item.expiryDate||'未记录');list.append(p);
  if(item.available&&item.quantityScaled>0)option(select,item.stockId,item.materialName+' / '+item.batchNo+' / '+item.locationName+'（'+quantityText(item.quantityScaled,item.scale)+' '+item.unit+'）');}

 if(data.items.length){
   list.replaceChildren();
   list.append(dataTable(['材料 / 规格','批次','库位','库存','效期','可用情况'],data.items.map(item=>[
     item.materialName+' / '+item.specification,item.batchNo,item.locationName,quantityText(item.quantityScaled,item.scale)+' '+item.unit,item.expiryDate||'未记录',item.available?'可领用':'不可领用'
   ])));
 }
 f.hidden=role!=='assistant'||!select.options.length;
 const returns=$('#inventory-return-form'),returnSelect=returns.elements.issue;returnSelect.replaceChildren();for(const i of data.issues||[])option(returnSelect,i.id,i.materialName+' / '+i.batchNo+' / 领用 '+i.id+' / 最多退回 '+quantityText(i.remainingScaled,i.scale)+' '+i.unit);returns.hidden=role!=='assistant'||!returnSelect.options.length;
 const movements=$('#inventory-movements');movements.replaceChildren();if(!data.movements?.length)movements.textContent='本店暂无领用或退回记录。';for(const m of data.movements||[]){const p=document.createElement('p');p.textContent=date(m.occurred_at)+'　'+m.materialName+' / '+m.batchNo+'　'+m.movement_type+' '+quantityText(Math.abs(m.delta_scaled),m.scale)+' '+m.unit+(m.original_movement_id?'（原领用 '+m.original_movement_id+'）':'')+'；依据：'+m.reason;movements.append(p);}
 const counts=$('#inventory-counts');counts.replaceChildren();if(!data.counts.length)counts.textContent='本店暂无盘点记录。';
 for(const c of data.counts){const line=document.createElement('p');line.textContent=c.materialName+' / '+c.batchNo+'；账面 '+quantityText(c.snapshot_quantity_scaled,c.scale)+' '+c.unit+'；实点 '+quantityText(c.counted_quantity_scaled,c.scale)+' '+c.unit+'；'+c.status+(c.review_note?'；意见：'+c.review_note:'')+'　';
  if(role==='manager'&&c.status==='待确认差异')for(const [action,label] of [['approve','确认差异'],['reject','拒绝调整']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>act(button,async()=>{const note=await askReason('填写盘点审核意见');if(!note)return;const result=await api('/api/inventory/count',command({action,countId:c.id,expectedRevision:c.revision,reviewNote:note}));message(result.code==='COUNT_RECHECK_REQUIRED'?'库存已变化，请助理重新实点。':'盘点审核已完成。');await Promise.all([inventory(),dashboard()]);});line.append(button);}counts.append(line);}
 const countForm=$('#count-form'),countStock=countForm.elements.stock;countStock.replaceChildren();for(const item of data.items)option(countStock,item.stockId,item.materialName+' / '+item.batchNo+' / '+item.locationName);countForm.hidden=role!=='assistant'||!countStock.options.length;
 const recount=$('#recount-form'),countSelect=recount.elements.count;countSelect.replaceChildren();for(const c of data.counts.filter(c=>c.status==='待重新核对'))option(countSelect,c.id,c.materialName+' / '+c.batchNo);recount.hidden=role!=='assistant'||!countSelect.options.length;
}
$('#catalog-service-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/catalog',command({action:'service',name:f.elements.name.value,billingUnit:f.elements.unit.value,category:f.elements.category.value,reason:f.elements.reason.value}));f.reset();message('统一收费项目已建立，请设置本店价目。');await cashierPrices();});};
function clearCatalogMaterial(){const f=$('#catalog-material-form');f.reset();delete f.dataset.id;delete f.dataset.revision;delete f.dataset.denominator;$('#catalog-material-submit').textContent='提交统一材料目录';$('#catalog-material-cancel').hidden=true;}
$('#catalog-material-cancel').onclick=clearCatalogMaterial;
$('#catalog-material-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,editing=!!f.dataset.id;await api('/api/catalog',command({action:'material',...(editing?{materialId:Number(f.dataset.id),expectedRevision:Number(f.dataset.revision)}:{}),name:f.elements.name.value,specification:f.elements.specification.value,baseUnit:f.elements.unit.value,purchaseUnit:f.elements.purchaseUnit.value,conversionNumerator:Number(f.elements.conversion.value),conversionDenominator:Number(f.elements.denominator.value),quantityScale:Number(f.elements.scale.value),requiresTrace:f.elements.trace.checked,requiresExpiry:f.elements.expiry.checked,isDrug:f.elements.drug.checked,reason:f.elements.reason.value}));clearCatalogMaterial();message(editing?'材料资料已保存；如涉及单位或药品信息，须由负责人重新确认。':'材料已提交，等待负责人确认。');await inventory();});};
function clearSupplier(){const f=$('#supplier-form');f.reset();delete f.dataset.id;delete f.dataset.revision;delete f.dataset.active;$('#supplier-submit').textContent='新增供应商';$('#supplier-cancel').hidden=true;}
$('#supplier-cancel').onclick=clearSupplier;
async function suppliers(){const branch=state.branch,view=state.viewVersion,data=await api('/api/suppliers?branchId='+branch);if(state.role!=='manager'||state.branch!==branch||state.viewVersion!==view)return;const list=$('#supplier-list');list.replaceChildren();if(!data.items.length)list.textContent='暂无供应商。';for(const s of data.items){const p=document.createElement('p');p.textContent=s.name+' / '+s.contact_name+' / '+s.phone+' / '+(s.is_active?'启用':'停用')+'　';const edit=document.createElement('button');edit.type='button';edit.textContent='修改';edit.onclick=()=>{const f=$('#supplier-form');f.dataset.id=s.id;f.dataset.revision=s.revision;f.dataset.active=s.is_active;f.elements.name.value=s.name;f.elements.contact.value=s.contact_name;f.elements.phone.value=s.phone;f.elements.address.value=s.address||'';f.elements.basis.value=s.settlement_basis;f.elements.reason.value='';$('#supplier-submit').textContent='保存供应商';$('#supplier-cancel').hidden=false;};p.append(edit);const toggle=document.createElement('button');toggle.type='button';toggle.textContent=s.is_active?'停用':'启用';toggle.onclick=()=>act(toggle,async()=>{const reason=await askReason('填写供应商启停依据');if(!reason)return;if(state.branch!==branch||state.role!=='manager'||state.viewVersion!==view)throw Error('门店已变化，请重新查询。');await api('/api/suppliers',command({supplierId:s.id,expectedRevision:s.revision,name:s.name,contactName:s.contact_name,phone:s.phone,address:s.address,settlementBasis:s.settlement_basis,isActive:!s.is_active,reason}));message('供应商状态已更新。');await Promise.all([suppliers(),purchases()]);});p.append(toggle);list.append(p);}}
$('#supplier-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,editing=!!f.dataset.id;await api('/api/suppliers',command({...(editing?{supplierId:Number(f.dataset.id),expectedRevision:Number(f.dataset.revision)}:{}),name:f.elements.name.value,contactName:f.elements.contact.value,phone:f.elements.phone.value,address:f.elements.address.value||null,settlementBasis:f.elements.basis.value,isActive:editing?f.dataset.active==='1':true,reason:f.elements.reason.value}));clearSupplier();message('供应商资料已保存。');await Promise.all([suppliers(),purchases()]);});};
async function clinicalGrants(){
 const branch=state.branch,viewVersion=state.viewVersion,data=await api('/api/clinical/grants?branchId='+branch);if(state.branch!==branch||state.role!=='dentist'||state.viewVersion!==viewVersion)return;const list=$('#clinical-grants');list.replaceChildren();const items=data.items.filter(x=>x.scope==='record');
 if(!items.length){list.textContent='当前没有可查阅的跨店病历授权。';return;}
 for(const g of items){const line=document.createElement('p');line.textContent=g.source_name+'　'+g.patient_name+'（'+g.patient_no+'）　就诊 '+g.visit_no+'　';const button=document.createElement('button');button.type='button';button.textContent='查看病历';
  button.onclick=()=>act(button,async()=>{if(state.branch!==branch||state.role!=='dentist'||state.viewVersion!==viewVersion)return;const clinicalVersion=++state.clinicalVersion;$('#clinical-result').hidden=true;$('#clinical-result').replaceChildren();const result=await api('/api/clinical',{scope:'record',sourceBranchId:g.source_branch_id,targetBranchId:branch,patientId:g.patient_id,visitId:g.visit_id});if(state.branch!==branch||state.role!=='dentist'||state.viewVersion!==viewVersion||state.clinicalVersion!==clinicalVersion)return;
   const out=$('#clinical-result');out.replaceChildren();for(const [label,value] of [['来源门店',g.source_name],['主诉',result.record.chief_complaint],['诊断',result.record.diagnosis],['诊疗建议',result.record.treatment_advice],...result.findings.map(x=>['检查所见'+(x.tooth_code?'（牙位 '+x.tooth_code+(x.surface_code?' '+x.surface_code:'')+'）':''),x.finding_text]),...result.addenda.map(x=>['签署后补充',x.content+'；原因：'+x.reason])]){const p=document.createElement('p');p.textContent=label+'：'+(value||'未记录');out.append(p);}out.hidden=false;message('已查阅授权范围内的病历。');});line.append(button);list.append(line);}
}
async function treatment(preferredVisitId=null){
 const version = (state.visitRequest || 0) + 1;
 state.visitRequest = version;

 const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/treatment/options?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion||state.visitRequest!==version)return;state.treatment=data;
 const context = $('#clinic-visit');
 const area = $('#dentist');
 if (area) area.dataset.caseReady = 'false';
 if (context) {
   const cases = data.visits.filter(v => ['接诊中','诊疗结束'].includes(v.status));
   const wanted = preferredVisitId ?? Number(context.value);
   const selected = cases.find(v => v.id === wanted) || cases.find(v => v.status === '接诊中') || cases[0];
   if (context.dataset.visit !== String(selected?.id ?? '')) resetClinicalDrafts();
   context.dataset.visit = String(selected?.id ?? '');
   context.replaceChildren();
   for (const v of cases) option(context,v.id,visitPatientLabel(v)+' / '+v.record_no+' / '+v.status);
   context.value = context.dataset.visit;
   context.disabled = !selected;
   preferredVisitId = selected?.id ?? null;
   $('#visit-context-note').textContent = selected ? '' : '当前门店暂无本人已接诊的就诊，请先从队列开始接诊。';
 }
 if(preferredVisitId==null&&!$('#record-form').elements.visit.value&&!$('#plan-visit').value)preferredVisitId=data.visits.find(v=>v.status==='接诊中')?.id??null;
 const form=$('#treatment-form'),visits=form.elements.visit,services=form.elements.service,previousVisit=preferredVisitId==null?visits.value:String(preferredVisitId);visits.replaceChildren();services.replaceChildren();
 const rxVisit=$('#prescription-visit'),oldRxVisit=preferredVisitId==null?rxVisit.value:String(preferredVisitId);rxVisit.replaceChildren();for(const v of data.visits.filter(v=>['接诊中','诊疗结束'].includes(v.status)))option(rxVisit,v.id,visitPatientLabel(v)+' / '+v.record_no);if([...rxVisit.options].some(x=>x.value===oldRxVisit))rxVisit.value=oldRxVisit;$('#prescription-load').disabled=!rxVisit.options.length;const waiting=$('#waiting-visits');waiting.replaceChildren();const waitingItems=data.visits.filter(v=>v.status==='候诊');if(!waitingItems.length)waiting.textContent='当前没有候诊患者。';
 for(const v of waitingItems){const line=document.createElement('p');line.textContent=visitPatientLabel(v)+' / '+v.record_no+'　';const button=document.createElement('button');button.type='button';button.textContent='开始接诊';button.onclick=()=>act(button,async()=>{await api('/api/treatment/start',command({visitId:v.id,expectedVisitRevision:v.revision,startedAt:fixedNow}));message('已开始接诊。');await Promise.all([treatment(v.id),followups()]);});line.append(button);waiting.append(line);}
 for(const v of data.visits.filter(v=>v.status==='接诊中'))option(visits,v.id,visitPatientLabel(v)+' / '+v.record_no);if([...visits.options].some(x=>x.value===previousVisit))visits.value=previousVisit;
 if (context && preferredVisitId != null) visits.value = String(preferredVisitId);
 const active=$('#active-visits');active.replaceChildren();const activeItems=data.visits.filter(v=>v.status==='接诊中');if(!activeItems.length)active.textContent='当前没有接诊中的患者。';
 for(const v of activeItems){const line=document.createElement('p');line.textContent=visitPatientLabel(v)+' / '+v.record_no+'　';const button=document.createElement('button');button.type='button';button.textContent='确认实际结束并交接';button.disabled=!v.occupancy_revision;button.onclick=()=>act(button,async()=>{const reason=await askReason('确认实际结束并填写交接依据');if(!reason)return;await api('/api/resources',command({action:'finish',visitId:v.id,expectedVisitRevision:v.revision,expectedOccupancyRevision:v.occupancy_revision,endedAt:fixedNow,confirmed:true,reason}));message('实际操作已结束，诊椅等待清洁核验。');await treatment();});line.append(button);active.append(line);}
 for(const s of data.services)option(services,s.id,s.name+' / '+s.billing_unit);
 form.hidden=!visits.value||!data.services.length;$('#dentist-empty').hidden=!form.hidden;
 const recordForm=$('#record-form'),recordVisits=recordForm.elements.visit,previousRecordVisit=preferredVisitId==null?recordVisits.value:String(preferredVisitId);recordVisits.replaceChildren();
 for(const v of data.visits.filter(v=>['接诊中','诊疗结束'].includes(v.status)))option(recordVisits,v.id,visitPatientLabel(v)+' / '+v.record_no+' / '+v.status);if([...recordVisits.options].some(x=>x.value===previousRecordVisit))recordVisits.value=previousRecordVisit;
 const planVisit=$('#plan-visit'),planForm=$('#plan-draft-form'),previousPlanVisit=preferredVisitId==null?planVisit.value:String(preferredVisitId);planVisit.replaceChildren();for(const v of data.visits.filter(v=>['接诊中','诊疗结束'].includes(v.status)))option(planVisit,v.id,visitPatientLabel(v)+' / '+v.record_no);if([...planVisit.options].some(x=>x.value===previousPlanVisit))planVisit.value=previousPlanVisit;$('#plan-edit-cancel').click();planForm.hidden=!planVisit.options.length||!data.services.length;planVisit.onchange=()=>{if(planForm.dataset.versionId)$('#plan-edit-cancel').click();act(planVisit,loadPlans);};visits.onchange=()=>act(visits,loadExecutionPlans);if(planVisit.options.length)await loadPlans();else $('#plan-list').textContent='当前没有可建立方案的就诊。';if(visits.value)await loadExecutionPlans();if(state.visitRequest!==version)return;if(state.branch!==branch||state.role!==role)return;
 recordForm.hidden=!recordVisits.options.length;$('#record-empty').hidden=!recordForm.hidden;$('#health-area').hidden=recordForm.hidden;if(recordForm.hidden){$('#addendum-area').hidden=true;$('#record-executions').textContent='当前没有可查看的接诊记录。';}recordVisits.onchange=()=>act(recordVisits,loadRecord);if(!recordForm.hidden)await loadRecord();
 if(area && state.visitRequest===version && state.viewVersion===viewVersion)area.dataset.caseReady=String(!!context?.value);
}
async function fetchPlans(visitId){return api('/api/plans?branchId='+state.branch+'&visitId='+visitId);}
async function loadExecutionPlans(){const f=$('#treatment-form'),branch=state.branch,visitId=Number(f.elements.visit.value);if(!visitId)return;const data=await fetchPlans(visitId);if(state.branch!==branch||state.role!=='dentist'||Number(f.elements.visit.value)!==visitId)return;const select=f.elements.planItem;select.replaceChildren();option(select,'','独立检查');for(const p of data.plans.filter(p=>p.is_latest&&p.status==='已确认'))for(const i of p.items.filter(i=>i.remaining>0))option(select,i.id,i.item_description+(i.tooth_code?' / 牙位 '+i.tooth_code+(i.surface_code?' '+i.surface_code:''):'')+' / 可执行 '+i.remaining);select.onchange=()=>{f.elements.basis.required=!select.value;f.elements.tooth.readOnly=!!select.value;f.elements.surface.readOnly=!!select.value;if(select.value){const item=data.plans.flatMap(p=>p.items).find(i=>i.id===Number(select.value));const service=state.treatment.services.find(s=>item?.item_description===s.record_no+'｜'+s.name+'（'+s.billing_unit+'）');f.elements.tooth.value=item?.tooth_code||'';f.elements.surface.value=item?.surface_code||'';if(service)f.elements.service.value=String(service.id);else message('原方案项目已变化，请核对项目后再执行。',true);}else{f.elements.tooth.value='';f.elements.surface.value='';}};select.onchange();}
function addPlanItem(item=null){const container=$('#plan-item-rows');if(container.children.length>=20){message('每个方案最多 20 个项目。',true);return;}const row=document.createElement('div');row.className='form-grid plan-item-row';const serviceLabel=document.createElement('label'),service=document.createElement('select');service.name='service';service.required=true;serviceLabel.textContent='项目';for(const x of state.treatment.services)option(service,x.id,x.name+' / '+x.billing_unit);serviceLabel.append(service);const qtyLabel=document.createElement('label'),qty=document.createElement('input');qty.name='quantity';qty.type='number';qty.min='1';qty.value='1';qty.required=true;qtyLabel.textContent='计划数量';qtyLabel.append(qty);const toothLabel=document.createElement('label'),tooth=document.createElement('input');tooth.name='tooth';tooth.maxLength=8;tooth.placeholder='如 16';toothLabel.textContent='牙位（可选）';toothLabel.append(tooth);const surfaceLabel=document.createElement('label'),surface=document.createElement('input');surface.name='surface';surface.maxLength=8;surface.placeholder='如 M、O、D';surfaceLabel.textContent='牙面（可选）';surfaceLabel.append(surface);const remove=document.createElement('button');remove.type='button';remove.textContent='删除项目';remove.onclick=()=>{if(container.children.length>1)row.remove();else message('方案至少需要一个项目。',true);};if(item){const matched=state.treatment.services.find(s=>item.item_description===s.record_no+'｜'+s.name+'（'+s.billing_unit+'）');if(matched)service.value=String(matched.id);else {option(service,'','原项目已停用，请选择项目');service.value='';}qty.value=item.planned_quantity;tooth.value=item.tooth_code||'';surface.value=item.surface_code||'';remove.disabled=true;}row.append(serviceLabel,qtyLabel,toothLabel,surfaceLabel,remove);container.append(row);}
function resetPlanItems(){$('#plan-item-rows').replaceChildren();if(state.treatment?.services.length)addPlanItem();}
$('#add-plan-item').onclick=()=>addPlanItem();
async function loadPlans(){const branch=state.branch,visitId=Number($('#plan-visit').value);if(!visitId)return;const data=await fetchPlans(visitId);if(state.branch!==branch||state.role!=='dentist'||Number($('#plan-visit').value)!==visitId)return;const list=$('#plan-list');list.replaceChildren();if(!data.plans.length)list.textContent='本次就诊暂无方案。';for(const p of data.plans){const box=document.createElement('div'),header=document.createElement('p');header.textContent=p.goal+' / 第 '+p.version_no+' 版 / '+p.status+'　';if(p.is_latest&&p.status!=='草稿'&&p.plan_status==='进行中'){const revise=document.createElement('button');revise.type='button';revise.textContent='调整方案';revise.onclick=()=>act(revise,async()=>{const reason=await askReason('填写方案调整原因');if(!reason)return;await api('/api/plans',command({action:'revise',visitId,versionId:p.version_id,expectedRevision:p.revision,reason}));message('已建立新方案草稿，请修改后重新说明并记录患者决定。');await Promise.all([loadPlans(),loadExecutionPlans()]);});header.append(revise);}if(p.is_latest&&p.status==='草稿'){const edit=document.createElement('button');edit.type='button';edit.textContent='修改草稿';edit.onclick=()=>{const f=$('#plan-draft-form');f.dataset.versionId=p.version_id;f.dataset.revision=p.revision;f.dataset.visitId=visitId;f.elements.goal.value=p.goal;f.elements.basis.value=p.diagnostic_basis;f.elements.schedule.value=p.planned_schedule;f.elements.reason.value='';$('#plan-item-rows').replaceChildren();for(const item of p.items)addPlanItem(item);$('#plan-submit').textContent='保存草稿修改';$('#plan-edit-cancel').hidden=false;revealTask(f);};header.append(edit);}if(p.is_latest&&['草稿','暂缓'].includes(p.status)){const b=document.createElement('button');b.type='button';b.textContent='已说明方案';b.onclick=()=>act(b,async()=>{const reason=await askReason('确认已向患者说明本方案，填写说明依据');if(!reason)return;await api('/api/plans',command({action:'publish',visitId,versionId:p.version_id,expectedRevision:p.revision,explanation:reason}));message('方案已说明，等待患者决定。');await loadPlans();});header.append(b);}if(p.is_latest&&['待确认','已确认'].includes(p.status)){const qb=document.createElement('button');qb.type='button';qb.textContent='编制报价';qb.onclick=()=>act(qb,async()=>{const scope=await askReason('填写报价包含范围');if(!scope)return;const reason=await askReason('填写编制报价依据');if(!reason)return;await api('/api/quotes',command({action:'draft',visitId,planVersionId:p.version_id,scopeNote:scope,reason}));message('报价草稿已建立，请收费人员核价出具。');await quoteList();});header.append(qb);}box.append(header);
 for(const item of p.items){const line=document.createElement('p');line.textContent=item.item_description+(item.tooth_code?'；牙位 '+item.tooth_code+(item.surface_code?' '+item.surface_code:''):'')+'；计划 '+item.planned_quantity+'；已完成 '+item.completed+'；剩余同意 '+item.remaining+'；最新决定 '+(item.latestDecision||'未决定')+'　';if(p.is_latest&&['待确认','已确认'].includes(p.status))for(const decision of ['同意','暂缓','拒绝',...(item.latestDecision==='同意'?['撤回']:[])]){const b=document.createElement('button');b.type='button';b.textContent='记录'+decision;b.onclick=()=>act(b,async()=>{const basis=await askReason('请如实填写患者对该项目'+decision+'的实际依据');if(!basis)return;await api('/api/plans',command({action:'decide',visitId,versionId:p.version_id,expectedRevision:p.revision,itemId:item.id,decision,explanationBasis:basis,scopeNote:'患者对方案项目 '+item.item_description+' 的决定'}));message('已记录患者对该项目的'+decision+'决定。');await Promise.all([loadPlans(),loadExecutionPlans()]);});line.append(b);}box.append(line);}list.append(box);}}
$('#plan-edit-cancel').onclick=()=>{const f=$('#plan-draft-form');f.reset();delete f.dataset.versionId;delete f.dataset.revision;delete f.dataset.visitId;$('#plan-submit').textContent='建立方案草稿';$('#plan-edit-cancel').hidden=true;resetPlanItems();};
$('#plan-draft-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,visitId=Number($('#plan-visit').value),items=[...$('#plan-item-rows').querySelectorAll('.plan-item-row')].map(row=>({serviceId:Number(row.querySelector('select').value),quantity:Number(row.querySelector('[name=quantity]').value),toothCode:row.querySelector('[name=tooth]').value.trim()||null,surfaceCode:row.querySelector('[name=surface]').value.trim().toUpperCase()||null}));const editing=!!f.dataset.versionId;if(editing&&Number(f.dataset.visitId)!==visitId)throw new Error('就诊已切换，请取消修改并重新选择方案。');await api('/api/plans',command({action:editing?'save':'draft',visitId,...(editing?{versionId:Number(f.dataset.versionId),expectedRevision:Number(f.dataset.revision)}:{}),items,goal:f.elements.goal.value,basis:f.elements.basis.value,schedule:f.elements.schedule.value,reason:f.elements.reason.value}));$('#plan-edit-cancel').click();message(editing?'方案草稿已修改。':'方案草稿已建立。');await loadPlans();});};
async function quoteList(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/quotes?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;const list=role==='cashier'?$('#cashier-quotes'):$('#dentist-quotes');list.replaceChildren();if(!data.quotes.length)list.textContent='本店暂无报价。';for(const q of data.quotes){const box=document.createElement('div'),head=document.createElement('p');head.textContent=q.patient_name+' / '+q.record_no+'（编号 '+q.id+'） / 第 '+q.version_no+' 版 / '+q.status+(!q.plan_is_latest?' / 来源方案已有新版':'')+(q.valid_until?' / 接受截止 '+q.valid_until:'')+'　';if(role==='cashier'&&q.status==='草稿'&&q.is_latest&&q.plan_is_latest){const issue=document.createElement('button');issue.type='button';issue.textContent='核价出具';issue.onclick=()=>{const f=$('#quote-issue-form');f.reset();f.dataset.visitId=q.source_visit_id;f.dataset.versionId=q.version_id;f.dataset.revision=q.revision;f.dataset.quoteRevision=q.quote_revision;f.hidden=false;};head.append(issue);}if(role==='dentist'&&q.status!=='草稿'&&q.is_latest&&q.plan_is_latest){const revise=document.createElement('button');revise.type='button';revise.textContent='建立报价新版';revise.onclick=()=>act(revise,async()=>{const scope=await askReason('填写新版报价范围');if(!scope)return;const reason=await askReason('填写报价改版依据');if(!reason)return;await api('/api/quotes',command({action:'revise',visitId:q.source_visit_id,versionId:q.version_id,expectedRevision:q.revision,expectedQuoteRevision:q.quote_revision,scopeNote:scope,reason}));message('新版报价草稿已建立，旧版保留至新版出具。');await quoteList();});head.append(revise);}box.append(head);for(const item of q.items){const line=document.createElement('p');line.textContent=item.description_snapshot+(item.tooth_code?' / 牙位 '+item.tooth_code+(item.surface_code?' '+item.surface_code:''):'')+' × '+item.quantity+' '+item.billing_unit_snapshot+' / '+(item.amount_cents==null?'待核价':'¥'+(item.amount_cents/100).toFixed(2))+' / 范围：'+item.scope_note+' / 费用决定：'+(item.decision||'未决定')+'　';if(q.plan_is_latest&&['已出具','部分接受','已接受'].includes(q.status))for(const decision of ['接受','暂缓','拒绝',...(item.decision==='接受'?['撤回']:[])]){const b=document.createElement('button');b.type='button';b.textContent='记录'+decision;b.onclick=()=>act(b,async()=>{const basis=await askReason('如实填写患者对该报价项目'+decision+'的依据');if(!basis)return;await api('/api/quotes',command({action:'decide',visitId:q.source_visit_id,versionId:q.version_id,expectedRevision:q.revision,expectedQuoteRevision:q.quote_revision,itemId:item.id,decision,confirmationBasis:basis}));message('已记录患者费用决定。');await quoteList();});line.append(b);}box.append(line);}list.append(box);}}
$('#quote-issue-cancel').onclick=()=>{$('#quote-issue-form').hidden=true;};
$('#quote-issue-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/quotes',command({action:'issue',visitId:Number(f.dataset.visitId),versionId:Number(f.dataset.versionId),expectedRevision:Number(f.dataset.revision),expectedQuoteRevision:Number(f.dataset.quoteRevision),validFrom:f.elements.validFrom.value,validUntil:f.elements.validUntil.value,reason:f.elements.reason.value}));f.hidden=true;message('本店报价已核价出具，等待患者费用决定。');await quoteList();});};
async function resources(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/resources?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;
 const list=role==='manager'?$('#manager-resources'):role==='assistant'?$('#assistant-resources'):$('#front-resources');list.replaceChildren();const targets=[...data.chairs.map(x=>({...x,kind:'chair'})),...(data.equipment||[]).map(x=>({...x,kind:'equipment'}))];if(!targets.length){list.textContent='本店暂无诊椅或设备。';return;}
 for(const target of targets){const line=document.createElement('p'),blocks=data.blocks.filter(b=>target.kind==='chair'?b.dental_chair_id===target.id:b.equipment_id===target.id);line.textContent=(target.kind==='chair'?'诊椅 ':'设备 ')+target.name+'：'+(target.busy?'使用中':blocks.length?'受限制':target.status==='停用'?'停用':'可用')+'　';
  if(['manager','assistant'].includes(role)){const blockButton=document.createElement('button');blockButton.type='button';blockButton.textContent='登记故障或维护';blockButton.onclick=()=>act(blockButton,async()=>{const reason=await askReason('填写实际故障或维护依据');if(!reason)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)throw Error('门店或岗位已变化，请重新操作。');await api('/api/resources',command({action:'block',...(target.kind==='chair'?{chairId:target.id}:{equipmentId:target.id}),reason}));message('已登记资源限制，请核对受影响预约。');await resources();});line.append(blockButton);}
  for(const block of blocks){const description=document.createElement('span');description.textContent=block.reason+'；受影响预约 '+(block.affected||[]).map(a=>a.record_no+' '+date(a.planned_start)).join('、')+((block.affected||[]).length?'':'无')+'　';line.append(description);
   if(role==='manager'||role==='assistant'&&!block.reason.startsWith('故障维护：')){const button=document.createElement('button');button.type='button';button.textContent='核验并解除此限制';button.onclick=()=>act(button,async()=>{const reason=await askReason('确认清洁或维修完成并填写核验依据');if(!reason)return;if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)throw Error('门店或岗位已变化，请重新操作。');await api('/api/resources',command({action:'restore',blockId:block.id,expectedRevision:block.revision,confirmed:true,verificationNote:reason}));message('已解除该项限制；请核对是否仍有其他限制。');await resources();});line.append(button);}}
  list.append(line);}
}
async function loadRecord(){
 const f=$('#record-form'),branch=state.branch,visitId=Number(f.elements.visit.value);state.record=null;$('#record-executions').replaceChildren();$('#execution-correct-form').hidden=true;f.querySelector('button').disabled=true;
 const data=await api('/api/record/draft?branchId='+branch+'&visitId='+visitId);if(state.branch!==branch||state.role!=='dentist'||Number(f.elements.visit.value)!==visitId)return;
 state.record={...data,visitId,branch};f.elements.chiefComplaint.value=data.record.chief_complaint||'';f.elements.diagnosis.value=data.record.diagnosis||'';f.elements.advice.value=data.record.treatment_advice||'';f.elements.newFinding.value='';f.elements.newTooth.value='';f.elements.newSurface.value='';
 const executions=$('#record-executions');executions.replaceChildren();if(!data.executions?.length)executions.textContent='本次就诊暂无实际诊疗记录。';for(const item of data.executions||[]){const p=document.createElement('p');p.textContent=date(item.completed_at)+' / '+item.service_name+(item.tooth_code?' / 牙位 '+item.tooth_code+(item.surface_code?' '+item.surface_code:''):'')+' / '+item.completed_quantity+' '+item.billing_unit+' / '+(item.is_current?'当前记录':'已被后续记录更正')+'：'+item.procedure_note+(item.correction_reason?'（更正原因：'+item.correction_reason+'）':'');if(item.is_current){const button=document.createElement('button');button.type='button';button.textContent='更正操作经过';button.onclick=()=>{const correct=$('#execution-correct-form');correct.reset();correct.dataset.executionId=item.id;correct.dataset.visitId=visitId;correct.dataset.branch=branch;correct.elements.note.value=item.procedure_note;correct.hidden=false;};p.append(' ',button);}executions.append(p);}const list=$('#record-findings');list.replaceChildren();for(const item of data.findings){const group=document.createElement('div');group.className='form-grid';const label=document.createElement('label'),input=document.createElement('textarea');label.textContent='检查所见 '+item.sequence_no;input.value=item.finding_text;input.maxLength=4000;input.required=true;input.dataset.findingId=String(item.id);label.append(input);group.append(label);for(const [name,title,value] of [['tooth','牙位',item.tooth_code],['surface','牙面',item.surface_code]]){const l=document.createElement('label'),field=document.createElement('input');l.textContent=title;field.maxLength=8;field.value=value||'';field.dataset.findingPosition=name;field.dataset.positionId=String(item.id);l.append(field);group.append(l);}list.append(group);}
 const editable=data.record.status==='草稿';f.querySelector('button').disabled=!editable;for(const area of f.querySelectorAll('textarea, [data-finding-position], [name=newTooth], [name=newSurface]'))area.readOnly=!editable;updateFollowupCreate();
 const supplement=$('#addendum-area');supplement.hidden=editable;const addenda=$('#addenda');addenda.replaceChildren();
 if(!editable){$('#signature-status').textContent=data.record.signature_valid?'原签署内容校验通过；补充单独记录，不覆盖原文。':'原签署内容校验未通过，不能追加。';$('#addendum-form').querySelector('button').disabled=!data.record.signature_valid;
  if(!data.addenda.length)addenda.textContent='暂无补充记录。';for(const item of data.addenda){const p=document.createElement('p');p.textContent=date(item.added_at)+'　'+item.content+'；原因：'+item.reason;addenda.append(p);}}
 await loadHealth(branch,visitId,editable);
}
function updateFollowupCreate(){const f=$('#followup-create-form'),can=state.record?.record.status==='已签署'&&state.record.record.signature_valid&&state.followups?.frontdesks?.length;f.hidden=!can;$('#followup-create-hint').hidden=!!can;}
function eligibleFollowupVisits(visits,item,now){return (visits||[]).filter(v=>item&&v.patient_id===item.patient_id&&v.id!==item.source_visit_id&&v.started_at>=item.created_at&&v.started_at<=now&&(!v.ended_at||v.ended_at>=now));}
async function followups(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/followups?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.followups=data;
 const list=role==='dentist'?$('#dentist-followups'):$('#front-followups');list.replaceChildren();if(!data.items.length)list.textContent='当前没有本人负责的复诊事项。';
 for(const item of data.items){const line=document.createElement('p');line.textContent=visitPatientLabel(item)+'　'+item.followup_type+'：'+item.purpose+'；目标 '+item.target_start+' 至 '+item.target_end+'；'+item.status+(item.next_contact_date?'；下次联系 '+item.next_contact_date:'')+'；'+(item.requires_assessment?'需要牙医评估':'无需临床评估')+(item.contactInfo?'；联系方式：'+(item.contactInfo.phone||'未记录')+'；联系偏好：'+(item.contactInfo.contact_preference||'未记录')+(item.contactInfo.contact_unavailable_reason?'；不可联系原因：'+item.contactInfo.contact_unavailable_reason:''):'');if(role==='frontdesk'&&item.status==='待联系'){const b=document.createElement('button');b.type='button';b.textContent='为该患者安排复诊';b.onclick=()=>{if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;const form=$('#appointment-form'),patient=form.elements.patient,schedules=state.options?.schedules||[];$('#patient-filter').value='';applyPatientFilter();patient.value=String(item.patient_id);if(!patient.value){message('未找到患者档案，请先刷新患者资料。',true);return;}const schedule=schedules.find(s=>s.ends_at>fixedNow&&localInput(s.starts_at).slice(0,10)>=item.target_start&&localInput(s.starts_at).slice(0,10)<=item.target_end);if(schedule){form.elements.schedule.value=String(schedule.id);form.elements.schedule.onchange?.();}form.elements.reason.value=item.purpose;state.followupBooking={id:item.id,patientId:item.patient_id,branch};message(schedule?'已选择复诊患者及目标日期内排班，请核对预约时间。':'已选择复诊患者，请先发布或选择目标日期内排班。');revealTask(form);};line.append(b);}list.append(line);
  for(const c of item.contacts){const detail=document.createElement('p');detail.textContent='联系记录：'+date(c.contacted_at)+' '+c.method+' '+c.result+'；'+c.note+(c.appointment_id?'；关联预约 '+c.appointment_id:'');list.append(detail);}for(const a of item.assessments||[]){const detail=document.createElement('p');detail.textContent='临床评估：'+date(a.assessed_at)+' '+a.method+'；'+a.result+'；处理意见：'+a.advice+(a.visit_id?'；关联本店复诊就诊 '+a.visit_id:'');list.append(detail);}}
 const active=data.items.filter(x=>['待联系','待到诊或评估'].includes(x.status));
 if(role==='dentist'){const f=$('#followup-create-form'),front=f.elements.frontdesk;front.replaceChildren();for(const person of data.frontdesks)option(front,person.id,person.name);updateFollowupCreate();const assess=$('#followup-assess-form'),select=assess.elements.followup;select.replaceChildren();for(const item of active)option(select,item.id,visitPatientLabel(item)+' / '+item.purpose+' / '+item.status);const updateVisits=()=>{const item=active.find(x=>x.id===Number(select.value)),visits=assess.elements.visit;const remote=Array.from(assess.elements.method.options||[]).find(x=>x.value==='远程沟通');if(remote)remote.disabled=!!item&&item.source_branch_id!==branch;if(remote?.disabled&&assess.elements.method.value==='远程沟通')assess.elements.method.value='到诊检查';visits.replaceChildren();for(const v of eligibleFollowupVisits(data.visits,item,fixedNow))option(visits,v.id,v.record_no+' / '+date(v.started_at));const inPerson=assess.elements.method.value==='到诊检查';$('#followup-visit-label').hidden=!inPerson;$('#followup-visit-empty').hidden=!inPerson||visits.options.length>0;visits.required=inPerson;};const updateOwner=()=>{const item=active.find(x=>x.id===Number(select.value)),owner=assess.elements.responsibleFrontdesk;owner.replaceChildren();option(owner,'','请选择');for(const person of data.frontdesks)option(owner,person.id,person.name);owner.value=data.frontdesks.some(p=>p.id===item?.responsible_frontdesk_id)?String(item.responsible_frontdesk_id):'';};select.onchange=()=>{updateVisits();updateOwner();};assess.elements.method.onchange=updateVisits;const updateAdvice=()=>{const continuing=assess.elements.advice.value==='继续跟进';$('#followup-next-label').hidden=!continuing;$('#followup-owner-label').hidden=!continuing;assess.elements.nextDate.required=continuing;assess.elements.responsibleFrontdesk.required=continuing;};assess.elements.advice.onchange=updateAdvice;updateAdvice();updateOwner();updateVisits();assess.hidden=!active.length;}
 else{const f=$('#followup-contact-form'),select=f.elements.followup,appointment=f.elements.appointment;select.replaceChildren();for(const item of active)option(select,item.id,visitPatientLabel(item)+' / '+item.purpose+' / '+item.status);f.hidden=!active.length;
  const updateAppointments=()=>{const item=active.find(x=>x.id===Number(select.value));appointment.replaceChildren();option(appointment,'','不关联');for(const a of data.appointments.filter(a=>item&&a.patient_id===item.patient_id&&localInput(a.planned_start).slice(0,10)>=item.target_start&&localInput(a.planned_start).slice(0,10)<=item.target_end))option(appointment,a.id,date(a.planned_start)+' / '+a.status);};select.onchange=updateAppointments;updateAppointments();}
}
function recordDirty(){const loaded=state.record,f=$('#record-form');if(!loaded)return false;return f.elements.chiefComplaint.value!==(loaded.record.chief_complaint||'')||f.elements.diagnosis.value!==(loaded.record.diagnosis||'')||f.elements.advice.value!==(loaded.record.treatment_advice||'')||!!f.elements.newFinding.value.trim()||!!f.elements.newTooth.value.trim()||!!f.elements.newSurface.value.trim()||loaded.findings.some(item=>$('#record-findings').querySelector('[data-finding-id="'+item.id+'"]').value!==item.finding_text||$('#record-findings').querySelector('[data-finding-position=tooth][data-position-id="'+item.id+'"]').value!==(item.tooth_code||'')||$('#record-findings').querySelector('[data-finding-position=surface][data-position-id="'+item.id+'"]').value!==(item.surface_code||''));}
function healthDirty(){const loaded=state.health,f=$('#health-form'),fields=$('#health-fields');if(!loaded)return false;return !!(f.elements.source.value.trim()||f.elements.reason.value.trim()||f.elements.conclusion.value.trim())||['病史','过敏','用药'].some(category=>{const old=loaded.items.find(i=>i.category===category);return fields.querySelector('select[data-category="'+category+'"]').value!==(old?.certainty||'')||fields.querySelector('textarea[data-category="'+category+'"]').value!==(old?.content||'');});}
async function loadHealth(branch,visitId,editable){
 state.health=null;const status=$('#health-status'),healthForm=$('#health-form'),signForm=$('#sign-form'),readonly=$('#health-readonly');healthForm.hidden=true;signForm.hidden=true;readonly.hidden=true;readonly.replaceChildren();status.textContent='正在核对健康资料。';
 try{const data=await api('/api/record/health?branchId='+branch+'&visitId='+visitId);if(state.branch!==branch||state.role!=='dentist'||Number($('#record-form').elements.visit.value)!==visitId)return;
  state.health={...data,branch,visitId};status.textContent=data.version?'当前健康版本 '+data.version.version_no+'；'+(data.review?'本次已复核。':'本次尚未复核。'):'尚无健康版本，请逐项询问并记录。';
  const fields=$('#health-fields');fields.replaceChildren();for(const category of ['病史','过敏','用药']){const old=data.items.find(i=>i.category===category),group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=category;group.append(legend);
   const selectionLabel=document.createElement('label'),select=document.createElement('select');selectionLabel.textContent='确认情况';select.dataset.category=category;select.required=true;option(select,'','请选择');for(const choice of ['有','无','未知'])option(select,choice,choice);select.value=old?.certainty||'';selectionLabel.append(select);group.append(selectionLabel);
   const contentLabel=document.createElement('label'),content=document.createElement('textarea');contentLabel.textContent='具体情况或未知说明';content.dataset.category=category;content.required=true;content.maxLength=2000;content.value=old?.content||'';contentLabel.append(content);group.append(contentLabel);fields.append(group);}
  healthForm.reset();for(const category of ['病史','过敏','用药']){const old=data.items.find(i=>i.category===category);fields.querySelector('select[data-category="'+category+'"]').value=old?.certainty||'';fields.querySelector('textarea[data-category="'+category+'"]').value=old?.content||'';}
  healthForm.hidden=!editable;signForm.hidden=!editable;if(!editable){status.textContent+=' 病历已签署。';for(const item of data.items){const p=document.createElement('p');p.textContent=item.category+'：'+item.certainty+'；'+item.content+'（来源：'+item.source+'）';readonly.append(p);}readonly.hidden=false;}
 }catch(e){if(state.branch===branch&&state.role==='dentist'&&Number($('#record-form').elements.visit.value)===visitId)status.textContent=e.message||'健康资料无法核对。';}
}
async function manager(){
 const branch=state.branch,role=state.role,viewVersion=state.viewVersion;const [pending,prices,approvals,options]=await Promise.all([api('/api/prices/pending?branchId='+branch),api('/api/prices?branchId='+branch),api('/api/approvals?branchId='+branch),api('/api/approvals/options?branchId='+branch)]);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;
 state.approvalOptions=options;const approvalForm=$('#approval-form'),visitSelect=approvalForm.elements.visit,targetSelect=approvalForm.elements.target,dentistSelect=approvalForm.elements.dentist;
 visitSelect.replaceChildren();targetSelect.replaceChildren();for(const v of options.visits)option(visitSelect,v.id,visitPatientLabel(v)+' / '+v.record_no);
 for(const b of options.branches.filter(b=>options.dentists.some(d=>d.branch_id===b.id)))option(targetSelect,b.id,b.name);
 const updateDentists=()=>{dentistSelect.replaceChildren();for(const d of options.dentists.filter(d=>d.branch_id===Number(targetSelect.value)))option(dentistSelect,d.id,d.name);};targetSelect.onchange=updateDentists;updateDentists();
 approvalForm.hidden=!visitSelect.options.length||!targetSelect.options.length;$('#approval-empty').hidden=!approvalForm.hidden;
 const grants=$('#manager-grants');grants.replaceChildren();if(!options.grants.length)grants.textContent='本店暂无跨店授权。';
 for(const g of options.grants){const line=document.createElement('p');line.textContent=g.source_branch_id+' 店 → '+g.target_branch_id+' 店；患者 '+g.patient_name+'，就诊 '+g.visit_id+'，牙医 '+g.dentist_name+'；范围 '+({record:'病历',health:'健康资料',all:'全部授权范围'}[g.scope]||g.scope)+'；'+(g.revoked_at?'已撤销':g.valid_until&&g.valid_until<=fixedNow?'已过期':'有效')+'　';
  if(g.can_revoke){const button=document.createElement('button');button.type='button';button.textContent='撤销授权';button.onclick=()=>act(button,async()=>{const reason=await askReason('请输入撤销授权的依据');if(!reason)return;await api('/api/grants',command({action:'revoke',grantId:g.id,reason}));message('授权已撤销。');await manager();});line.append(button);}grants.append(line);}
 state.pending=pending.items;state.prices=prices.prices;const items=$('#pending-items'),form=$('#pending-form'),select=form.elements.namedItem('item');items.replaceChildren();select.replaceChildren();
 for(const item of pending.items){const p=document.createElement('p');p.textContent=item.service_name+(item.tooth_code?' / 牙位 '+item.tooth_code+(item.surface_code?' '+item.surface_code:''):'')+'　患者编号 '+item.patient_id+'　发生时间 '+date(item.priced_at)+'　账单 '+item.bill_no;items.append(p);option(select,item.id,item.service_name+' / 患者 '+item.patient_id);}
 if(!pending.items.length)items.textContent='本店暂无待核价的独立检查。';
 const showPrices=()=>{const item=state.pending.find(x=>x.id===Number(select.value)),choices=form.elements.price,quoteChoices=form.elements.quoteItem;choices.replaceChildren();quoteChoices.replaceChildren();option(quoteChoices,'','沿用原报价或无报价');for(const q of item?.quoteOptions||[])option(quoteChoices,q.id,q.record_no+' / 第 '+q.version_no+' 版 / '+(q.decision||'未决定')+' / ¥'+(q.amount_cents/100).toFixed(2));
  for(const price of state.prices.filter(p=>item&&p.service_id===item.service_id&&p.status==='已确认可适用'&&p.valid_from<=item.priced_at&&(!p.valid_until||p.valid_until>item.priced_at)))option(choices,price.id,'¥'+(price.unit_price_cents/100).toFixed(2)+' / 自 '+date(price.valid_from));
  form.querySelector('button').disabled=!choices.options.length;};
 select.onchange=showPrices;form.hidden=!pending.items.length;showPrices();
 renderPrices($('#manager-prices'),prices,true);
 renderCatalogServices(prices.services,branch,viewVersion);
 const list=$('#approvals');list.replaceChildren();if(!approvals.items.length){list.textContent='本店暂无跨店查阅申请。';return;}
 for(const proposal of approvals.items){const line=document.createElement('p');line.textContent='申请 '+proposal.id+'：'+proposal.sourceBranchId+' 店 → '+proposal.targetBranchId+' 店；患者 '+proposal.patientId+'，就诊 '+proposal.visitId+'，牙医 '+proposal.dentistId+'；范围 '+({record:'病历',health:'健康资料',all:'全部授权范围'}[proposal.scope]||proposal.scope)+'；截止 '+date(proposal.validUntil)+'；依据：'+proposal.reason+'；状态 '+proposal.status+'　';
  if(proposal.status==='待确认'){const actions=proposal.targetBranchId===state.branch?[['approve','确认'],['reject','拒绝']]:[['withdraw','撤回']];for(const [action,label] of actions){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>act(button,async()=>{const reason=await askReason('请输入'+label+'依据');if(!reason)return;await api('/api/approvals',command({action,proposalId:proposal.id,reason}));message('申请已处理。');await manager();});line.append(button);}}
  list.append(line);}
}
function renderCatalogServices(services,branch,view){const box=$('#catalog-services');box.replaceChildren();for(const s of services){const p=document.createElement('p');p.textContent=s.name+' / '+s.billing_unit+' / '+s.category+' / '+(s.is_active?'启用':'停用')+'　';const edit=document.createElement('button');edit.type='button';edit.textContent='修改项目';edit.onclick=()=>{const f=$('#catalog-service-edit');f.dataset.id=s.id;f.dataset.revision=s.revision;f.elements.name.value=s.name;f.elements.unit.value=s.billing_unit;f.elements.category.value=s.category;f.elements.reason.value='';f.hidden=false;revealTask(f);};p.append(edit);const toggle=document.createElement('button');toggle.type='button';toggle.textContent=s.is_active?'停用项目':'启用项目';toggle.onclick=()=>act(toggle,async()=>{const reason=await askReason('填写项目启停依据');if(!reason)return;if(state.branch!==branch||state.role!=='manager'||state.viewVersion!==view)throw Error('门店已变化，请重新查询。');await api('/api/catalog',command({action:s.is_active?'stopService':'enableService',serviceId:s.id,expectedRevision:s.revision,reason}));message('项目状态已更新。');await manager();});p.append(toggle);box.append(p);}}
$('#catalog-service-cancel').onclick=()=>{$('#catalog-service-edit').hidden=true;};
$('#catalog-service-edit').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/catalog',command({action:'editService',serviceId:Number(f.dataset.id),expectedRevision:Number(f.dataset.revision),name:f.elements.name.value,billingUnit:f.elements.unit.value,category:f.elements.category.value,reason:f.elements.reason.value}));f.hidden=true;message('收费项目资料已更新。');await manager();});};
function renderPrices(container,data,isManager){
 container.replaceChildren();if(!data.prices.length){container.textContent='本店暂无价目。';return;}
 for(const p of data.prices){const service=data.services.find(s=>s.id===p.service_id),line=document.createElement('p');line.textContent=(service?.name||'项目 '+p.service_id)+'　¥'+(p.unit_price_cents/100).toFixed(2)+'　'+p.status+'　自 '+date(p.valid_from)+'　';
  const actions=isManager?(p.status==='待负责人确认'?[['approve','确认'],['return','退回']]:p.status==='已确认可适用'?[['stop','停止适用']]:[]):(['价目草稿','已退回'].includes(p.status)?[['submit','提交确认']]:[]);
  for(const [action,label] of actions){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>act(button,async()=>{let reviewNote;if(isManager){reviewNote=await askReason('请输入'+label+'意见');if(!reviewNote)return;}await api('/api/prices',command({action,priceId:p.id,expectedRevision:p.revision,...(isManager?{reviewNote}:{})}));message('价目已'+label+'。');if(isManager)await manager();else await cashierPrices();});line.append(button);}container.append(line);}
}
async function cashierPrices(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/prices?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;renderPrices($('#cashier-prices'),data,false);const select=$('#price-draft-form').elements.service;select.replaceChildren();for(const s of data.services.filter(s=>s.is_active))option(select,s.id,s.name+' / '+s.billing_unit);$('#price-draft-form').querySelector('button').disabled=!select.options.length;}
let appointmentChange=null;
function clearAppointmentChange(){appointmentChange=null;$('#appointment-change-form').hidden=true;}
$('#appointment-change-cancel').onclick=clearAppointmentChange;
function defaultChangeSchedule(schedules,appointment,mode){const available=schedules.filter(s=>s.ends_at>fixedNow);return (mode==='reschedule'&&available.find(s=>s.id===appointment.schedule_id))||available.find(s=>s.starts_at<=appointment.planned_start&&s.ends_at>=appointment.planned_end&&appointment.planned_start>=fixedNow)||available[0]||null;}
async function loadChangeSchedules(){const f=$('#appointment-change-form'),change=appointmentChange,target=Number(f.elements.targetBranch.value);if(!change)return;const data=await api('/api/reception/options?branchId='+target);if(appointmentChange!==change||target!==Number(f.elements.targetBranch.value))return;change.schedules=data.schedules;f.elements.schedule.replaceChildren();for(const s of data.schedules.filter(x=>x.ends_at>fixedNow))option(f.elements.schedule,s.id,date(s.starts_at)+' — '+date(s.ends_at)+'，'+s.dentist_name+' / '+s.chair_name);const preferred=defaultChangeSchedule(data.schedules,change.appointment,change.mode);if(preferred)f.elements.schedule.value=String(preferred.id);setChangeTime();}
function setChangeTime(){const f=$('#appointment-change-form'),s=appointmentChange?.schedules.find(x=>x.id===Number(f.elements.schedule.value)),a=appointmentChange?.appointment;if(!s){f.elements.start.value='';f.elements.end.value='';return;}const fits=a&&a.planned_start>=fixedNow&&a.planned_start>=s.starts_at&&a.planned_end<=s.ends_at;if(fits){f.elements.start.value=localInput(a.planned_start);f.elements.end.value=localInput(a.planned_end);return;}const start=s.starts_at>fixedNow?s.starts_at:fixedNow,end=Math.min(Date.parse(start)+1800000,Date.parse(s.ends_at));f.elements.start.value=localInput(start);f.elements.end.value=localInput(new Date(end).toISOString());}
async function beginAppointmentChange(a,mode){const originalBranch=state.branch,data=await api('/api/branches');if(state.role!=='frontdesk'||state.branch!==originalBranch)return;const f=$('#appointment-change-form');f.reset();appointmentChange={appointment:a,mode,branch:originalBranch,schedules:[]};f.elements.targetBranch.replaceChildren();for(const b of data.items.filter(x=>mode==='transfer'?x.id!==originalBranch:x.id===originalBranch))option(f.elements.targetBranch,b.id,b.name);if(!f.elements.targetBranch.options.length){clearAppointmentChange();throw new Error('当前岗位没有可办理的目标门店。');}const transfer=mode==='transfer';$('#appointment-change-title').textContent=transfer?'转店预约':'调整本店预约';for(const id of ['#transfer-method-label','#transfer-note-label','#transfer-confirm-label','#transfer-equipment-label'])$(id).hidden=!transfer;f.elements.contactMethod.required=transfer;f.elements.contactNote.required=transfer;f.elements.confirmed.required=transfer;f.elements.noEquipment.required=transfer;f.hidden=false;await loadChangeSchedules();}
$('#appointment-change-form').elements.targetBranch.onchange=e=>act(e.currentTarget,loadChangeSchedules);
$('#appointment-change-form').elements.schedule.onchange=setChangeTime;
$('#appointment-change-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,c=appointmentChange;if(!c||state.branch!==c.branch)throw new Error('门店已变化，请重新选择预约。');const s=c.schedules.find(x=>x.id===Number(f.elements.schedule.value));if(!s)throw new Error('请先选择有效排班。');const transfer=c.mode==='transfer';await api('/api/reception',command({action:transfer?'transfer':'reschedule',appointmentId:c.appointment.id,expectedRevision:c.appointment.revision,scheduleId:s.id,scheduleRevision:s.revision,startsAt:isoLocal(f.elements.start.value),endsAt:isoLocal(f.elements.end.value),reason:f.elements.reason.value,...(transfer?{targetBranchId:Number(f.elements.targetBranch.value),patientConfirmed:f.elements.confirmed.checked,equipmentIds:[],transferContact:{method:f.elements.contactMethod.value,note:f.elements.contactNote.value,contactedAt:fixedNow}}:{})}));clearAppointmentChange();message(transfer?'转店预约已办理，原预约已取消。':'预约已调整。');await Promise.all([reception(),followups()]);});};
async function reception(){
 const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/reception/options?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;state.options=data;
 const form=$('#appointment-form'),patients=form.elements.patient,schedules=form.elements.schedule;patients.replaceChildren();schedules.replaceChildren();
 for(const p of data.patients)option(patients,p.id,patientLabel(p));
 for(const s of data.schedules)option(schedules,s.id,date(s.starts_at)+' — '+date(s.ends_at)+'，'+s.dentist_name+' / '+s.chair_name);
 const future=data.schedules.find(s=>s.starts_at>fixedNow);if(future)schedules.value=String(future.id);
 const setTime=()=>{const s=data.schedules.find(x=>x.id===Number(schedules.value));if(s){form.elements.start.value=localInput(s.starts_at);form.elements.end.value=localInput(new Date(Date.parse(s.starts_at)+1800000).toISOString());}};
 schedules.onchange=setTime;setTime();form.querySelector('button').disabled=!data.schedules.length||!data.patients.length;
 const walk=$('#walkin-form');walk.elements.patient.replaceChildren();walk.elements.schedule.replaceChildren();for(const p of data.patients)option(walk.elements.patient,p.id,patientLabel(p));for(const s of data.schedules.filter(s=>localInput(s.starts_at).slice(0,10)===localInput(fixedNow).slice(0,10)&&Math.floor(Date.parse(s.ends_at)/60000)*60000>Math.ceil(Math.max(Date.parse(fixedNow),Date.parse(s.starts_at))/60000)*60000))option(walk.elements.schedule,s.id,date(s.starts_at)+' — '+date(s.ends_at)+'，'+s.dentist_name+' / '+s.chair_name);const walkTime=()=>{const s=data.schedules.find(x=>x.id===Number(walk.elements.schedule.value));if(!s)return;const start=Math.ceil(Math.max(Date.parse(s.starts_at),Date.parse(fixedNow))/60000)*60000,end=Math.min(start+1800000,Math.floor(Date.parse(s.ends_at)/60000)*60000);walk.elements.start.value=localInput(new Date(start).toISOString());walk.elements.end.value=localInput(new Date(end).toISOString());};walk.elements.schedule.onchange=walkTime;walkTime();walk.hidden=!walk.elements.patient.options.length||!walk.elements.schedule.options.length;$('#walkin-empty').hidden=!walk.hidden;
 applyPatientFilter();const queue=$('#front-visits');queue.replaceChildren();if(!data.visits.length)queue.textContent='本店暂无候诊或接诊中的患者。';for(const v of data.visits){const p=document.createElement('p'),patient=data.patients.find(x=>x.id===v.patient_id);p.textContent=(patient?patientLabel(patient):'患者 '+v.patient_id)+' / '+v.record_no+' / '+v.dentist_name+' / '+v.status+' / 到诊 '+date(v.arrived_at);queue.append(p);}

 renderAgenda(data);
}
let agendaWeekStart = '';
let agendaAllDates = false;
function shiftDay(isoDay, days) {
 const utc = new Date(isoDay + 'T00:00:00Z');
 utc.setUTCDate(utc.getUTCDate() + days);
 return utc.toISOString().slice(0,10);
}
function weekStart(isoDay) {
 const weekday = new Date(isoDay + 'T00:00:00Z').getUTCDay();
 return shiftDay(isoDay, -((weekday + 6) % 7));
}
function renderWeek(appointments) {
 const today = localInput(fixedNow).slice(0,10);
 const dayField = $('#agenda-day');
 agendaWeekStart = weekStart(dayField.value || agendaWeekStart || today);
 $('#agenda-week-title').textContent = agendaWeekStart + ' 至 ' + shiftDay(agendaWeekStart,6);
 const strip = $('#agenda-week');
 strip.replaceChildren();
 for (let index=0; index<7; index++) {
   const day = shiftDay(agendaWeekStart,index);
   const count = appointments.filter(a => localInput(a.planned_start).startsWith(day) && a.status === '已预约').length;
   const button = document.createElement('button');
   button.type = 'button';
   button.setAttribute('aria-label', day + '，已预约 ' + count + ' 人次');
   button.setAttribute('aria-pressed',String(day === dayField.value));
   const label = document.createElement('small');
   label.textContent = day === today ? '今天' : '周' + '一二三四五六日'[index];
   const dateLabel = document.createElement('strong');
   dateLabel.textContent = day.slice(5).replace('-','/');
   const countLabel = document.createElement('small');
   countLabel.textContent = count ? count + ' 个预约' : '无待诊预约';
   button.append(label,dateLabel,countLabel);
   button.onclick = () => { dayField.value=day; agendaAllDates=false; updateAgendaSelection(); };
   strip.append(button);
 }
}
function renderAgenda(data) {
 const list = $('#appointments');
 const status = $('#agenda-status');
 const lastStatus = status.value;
 status.replaceChildren();
 option(status, '', '全部状态');
 for (const value of new Set(data.appointments.map(a => a.status))) option(status, value, value);
 if ([...status.options].some(o => o.value === lastStatus)) status.value = lastStatus;
 renderWeek(data.appointments);
 $('#agenda-all').setAttribute('aria-pressed',String(agendaAllDates));
 const day = $('#agenda-day').value;
 const rows = data.appointments.filter(a =>
   (day ? localInput(a.planned_start).slice(0,10) === day : agendaAllDates || weekStart(localInput(a.planned_start).slice(0,10)) === agendaWeekStart) &&
   (!status.value || status.value === a.status)
 ).sort((a,b) => Date.parse(a.planned_start) - Date.parse(b.planned_start));
 list.replaceChildren();
 if (!rows.length) {
   list.textContent = data.appointments.length ? '当前日期范围和状态下没有预约，可切换日期或查看全部日期。' : '本店暂无预约，可选择「新建预约」。';
   return;
 }
 for (const a of rows) {
   const patient = data.patients.find(p => p.id === a.patient_id);
   const schedule = data.schedules.find(s => s.id === a.schedule_id);
   const line = document.createElement('article');
   line.className = 'agenda-row';
   const slot = document.createElement('div');
   const time = document.createElement('strong');
   time.textContent = localInput(a.planned_start).slice(11,16) + ' – ' + localInput(a.planned_end).slice(11,16);
   const dayLabel = document.createElement('small');
   dayLabel.textContent = localInput(a.planned_start).slice(0,10);
   slot.append(time,dayLabel);
   const person = document.createElement('div');
   const name = document.createElement('strong');
   name.textContent = patient?.name || ('患者 ' + a.patient_id);
   const identity = document.createElement('small');
   identity.textContent = patient ? (patient.birth_date || '出生日期未记录') + ' · ' + patient.record_no : '';
   person.append(name,identity);
   const resource = document.createElement('div');
   resource.textContent = schedule ? schedule.dentist_name + ' / ' + schedule.chair_name : '排班资料待核对';
   const badge = document.createElement('span');
   badge.className = 'agenda-badge';
   badge.dataset.booked = String(a.status === '已预约');
   badge.textContent = a.status;
   line.append(slot,person,resource,badge);
  if(a.status==='已预约'){for(const [mode,label] of [['reschedule','改约'],['transfer','转店']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>act(b,()=>beginAppointmentChange(a,mode));line.append(b);}if(a.planned_end<fixedNow){const missed=document.createElement('button');missed.type='button';missed.textContent='登记未到';missed.onclick=()=>act(missed,async()=>{const reason=await askReason('请填写核实未到的依据');if(!reason)return;await api('/api/reception',command({action:'noShow',appointmentId:a.id,expectedRevision:a.revision,reason}));message('已登记未到。');await Promise.all([reception(),followups()]);});line.append(missed);}const button=document.createElement('button');button.type='button';button.textContent='取消预约';button.onclick=()=>act(button,async()=>{const reason=await askReason('请输入取消原因');if(!reason)return;await api('/api/reception',command({action:'cancel',appointmentId:a.id,expectedRevision:a.revision,reason}));message('预约已取消。');await Promise.all([reception(),followups()]);});line.append(button);
   if(localInput(a.planned_start).slice(0,10)===localInput(fixedNow).slice(0,10)&&a.schedule_id&&a.occupancy_revision){const arrive=document.createElement('button');arrive.type='button';arrive.textContent='登记到诊';arrive.onclick=()=>act(arrive,async()=>{await api('/api/reception',command({action:'arrive',appointmentId:a.id,expectedRevision:a.revision,patientId:a.patient_id,dentistId:a.dentist_id,scheduleRevision:a.schedule_revision,occupancyRevision:a.occupancy_revision,arrivedAt:fixedNow}));message('已登记到诊。');await reception();});line.append(arrive);}}
  const actions = document.createElement('div');
  actions.className = 'agenda-actions';
  actions.append(...line.querySelectorAll('button'));
  line.append(actions);
  list.append(line);
 }
}
async function finance(){
 const patient=Number($('#finance-query').elements.patient.value);if(!Number.isInteger(patient)||patient<1)return;
 const branch=state.branch,viewVersion=state.viewVersion,financeVersion=++state.financeVersion,data=await api('/api/finance?branchId='+branch+'&patientId='+patient);if(state.branch!==branch||state.role!=='cashier'||state.viewVersion!==viewVersion||state.financeVersion!==financeVersion)return;state.patient=patient;state.bills=data.items;await prepayments();if(state.branch!==branch||state.role!=='cashier'||state.viewVersion!==viewVersion||state.financeVersion!==financeVersion||state.patient!==patient)return;
 const list=$('#bills'),select=$('#payment-form').elements.bill;list.replaceChildren();select.replaceChildren();
 if(!data.items.length){list.textContent='该患者在本店暂无账单。';$('#payment-form').hidden=true;return;}
 for(const b of data.items){const p=document.createElement('p');p.textContent=b.record_no+'　总应收 ¥'+(b.summary.receivableCents/100).toFixed(2)+'　医保模拟承担 ¥'+(b.summary.insuranceCents/100).toFixed(2)+(b.summary.insurancePending||b.summary.insuranceReversalPending?'　患者承担及待付待医保结果确认':'　患者承担 ¥'+(b.summary.patientDueCents/100).toFixed(2)+'　患者待付 ¥'+(b.summary.unpaidCents/100).toFixed(2))+'　待核价 '+b.summary.pendingPricingCount+' 项'+(b.summary.insurancePending?'　医保办理待核对':'')+(b.summary.insuranceReversalPending?'　医保撤销待核对':'');list.append(p);for(const line of b.lines){const detail=document.createElement('p');detail.textContent='　'+(line.service_name||'项目待核对')+(line.tooth_code?' / 牙位 '+line.tooth_code+(line.surface_code?' '+line.surface_code:''):'')+' × '+line.quantity+' '+(line.billing_unit||'')+' / '+line.pricing_status+' / '+(line.amount_cents==null?'金额待核价':'¥'+(line.amount_cents/100).toFixed(2))+(line.has_clinical_correction?' / 诊疗记录有后续更正':'')+(line.source_verified?'':' / 来源门店待核对');list.append(detail);}for(const payment of b.payments){const paid=document.createElement('p');paid.textContent='　收款 '+payment.record_no+' / '+payment.channel+' / ¥'+(payment.net_cents/100).toFixed(2)+' / '+payment.status;list.append(paid);}if(b.summary.unpaidCents>0&&!b.summary.pendingPricingCount&&!b.summary.insurancePending&&!b.summary.insuranceReversalPending)option(select,b.id,b.record_no+'（待付 ¥'+(b.summary.unpaidCents/100).toFixed(2)+'）');}
 $('#payment-form').hidden=select.options.length===0;
}
let prepayState=null;
async function prepayments(){const branch=state.branch,patient=state.patient,viewVersion=state.viewVersion,financeVersion=state.financeVersion;if(!patient)return;const data=await api('/api/prepayments?branchId='+branch+'&patientId='+patient);if(state.branch!==branch||state.patient!==patient||state.role!=='cashier'||state.viewVersion!==viewVersion||state.financeVersion!==financeVersion)return;prepayState={...data,branch,patient};const account=data.accounts.find(x=>x.patient_id===patient),items=$('#prepay-items');items.replaceChildren();if(!account?.payments.length)items.textContent='本店暂无已确认的原付款。';for(const p of account?.payments||[]){const line=document.createElement('p');line.textContent=p.record_no+' / '+p.channel+' / 已到账 ¥'+(p.net_cents/100).toFixed(2)+' / 可用 ¥'+(p.available_cents/100).toFixed(2)+'　';if(p.available_cents>0){for(const [kind,label] of [['offset','抵扣账单'],['request','申请退款']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{const form=$('#prepay-'+kind+'-form');form.reset();form.dataset.paymentId=p.id;form.dataset.fundsRevision=account.revision;if(kind==='offset'){const select=form.elements.bill;select.replaceChildren();for(const bill of state.bills.filter(x=>x.summary.unpaidCents>0&&!x.summary.pendingPricingCount&&!x.summary.insurancePending&&!x.summary.insuranceReversalPending))option(select,bill.id,bill.record_no+' / 待付 ¥'+(bill.summary.unpaidCents/100).toFixed(2));if(!select.options.length){message('本店没有可抵扣的已核价账单。',true);return;}}form.hidden=false;};line.append(b);}}items.append(line);}
 const adjust=$('#adjustment-form'),billSelect=adjust.elements.bill;billSelect.replaceChildren();for(const bill of account?.bills||[])if(bill.items.some(i=>i.remaining_cents>0)&&bill.uses.length)option(billSelect,bill.id,bill.record_no);const updateAdjustment=()=>{const b=account?.bills.find(x=>x.id===Number(billSelect.value)),is=adjust.elements.namedItem('item'),us=adjust.elements.use;is.replaceChildren();us.replaceChildren();for(const i of b?.items.filter(x=>x.remaining_cents>0)||[])option(is,i.id,i.name+' / 可调整 ¥'+(i.remaining_cents/100).toFixed(2));for(const u of b?.uses||[])option(us,u.kind+':'+u.id,u.record_no+' / '+u.channel+' / 可释放 ¥'+(u.remaining_cents/100).toFixed(2));};billSelect.onchange=updateAdjustment;updateAdjustment();adjust.hidden=!billSelect.options.length;$('#adjustment-empty').hidden=!adjust.hidden;
 const requests=$('#prepay-requests');requests.replaceChildren();if(!data.requests.length)requests.textContent='暂无预付款退款申请。';for(const r of data.requests){const line=document.createElement('p');line.textContent=r.record_no+' / '+r.status+' / ¥'+(r.proposed_refund_cents/100).toFixed(2)+' / '+r.channel+(r.bill_no?' / 账单 '+r.bill_no:' / 未用预付')+' / '+r.reason+'　';if(r.status==='已同意'&&!r.refunds.length&&account){const b=document.createElement('button');b.type='button';b.textContent='记录系统外退款';b.onclick=()=>{const f=$('#prepay-refund-form');f.reset();f.dataset.requestId=r.id;f.dataset.revision=r.revision;f.dataset.fundsRevision=account.revision;f.hidden=false;};line.append(b);}for(const refund of r.refunds){const label=document.createElement('span');label.textContent='退款 '+refund.record_no+' / '+refund.status+' / ¥'+((refund.actual_cents||0)/100).toFixed(2);line.append(label);}requests.append(line);}}
async function prepayReview(){const branch=state.branch,role=state.role,viewVersion=state.viewVersion,data=await api('/api/prepayments?branchId='+branch);if(state.branch!==branch||state.role!==role||state.viewVersion!==viewVersion)return;const list=$('#prepay-review');list.replaceChildren();const pending=data.requests.filter(r=>r.status==='待审核');if(!pending.length)list.textContent='本店暂无待审核的退款申请。';for(const r of pending){const line=document.createElement('p'),account=data.accounts.find(a=>a.patient_id===r.patient_id);line.textContent=r.patient_name+' / '+r.record_no+' / ¥'+(r.proposed_refund_cents/100).toFixed(2)+(r.bill_no?' / 账单 '+r.bill_no+' / 项目 '+(r.item_name||'待核对')+' / 原付款 '+(r.source_record_no||'待核对'):' / 未用预付')+' / 原因：'+r.reason+' / 依据：'+r.evidence+'　';for(const [action,label] of [['approve','同意'],['reject','拒绝']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=!account;b.onclick=()=>act(b,async()=>{const note=await askReason('填写退款'+label+'意见');if(!note)return;await api('/api/prepayments',command({action,patientId:r.patient_id,requestId:r.id,expectedRevision:r.revision,expectedFundsRevision:account.revision,reviewNote:note}));message('退款申请已'+label+'。');await prepayReview();});line.append(b);}list.append(line);}}
for(const kind of ['offset','request','refund'])$('#prepay-'+kind+'-cancel').onclick=()=>{$('#prepay-'+kind+'-form').hidden=true;};
$('#prepay-receive-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,account=prepayState?.accounts.find(a=>a.patient_id===state.patient),channel=f.elements.channel.value;await api('/api/prepayments',command({action:'receive',patientId:state.patient,expectedFundsRevision:account?.revision??null,amountCents:Number(f.elements.amount.value),channel,receivedAt:fixedNow,verified:f.elements.verified.checked,evidence:f.elements.evidence.value,...(channel==='现金'?{}:{externalReference:f.elements.reference.value}),...(f.elements.quoteId.value?{quoteId:Number(f.elements.quoteId.value)}:{})}));f.reset();message('已登记系统外预付款。');await finance();});};
$('#prepay-offset-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,bill=state.bills.find(x=>x.id===Number(f.elements.bill.value));if(!bill)throw new Error('请重新查询账单。');await api('/api/prepayments',command({action:'offset',patientId:state.patient,paymentId:Number(f.dataset.paymentId),expectedFundsRevision:Number(f.dataset.fundsRevision),billId:bill.id,expectedBillRevision:bill.revision,amountCents:Number(f.elements.amount.value),reason:f.elements.reason.value}));f.hidden=true;message('预付款已抵扣本店账单。');await finance();});};
$('#adjustment-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,account=prepayState?.accounts.find(x=>x.patient_id===state.patient),bill=account?.bills.find(b=>b.id===Number(f.elements.bill.value)),item=bill?.items.find(i=>i.id===Number(f.elements.namedItem('item').value)),use=bill?.uses.find(u=>u.kind+':'+u.id===f.elements.use.value);if(!account||!bill||!item||!use)throw new Error('请重新查询并核对账单来源。');await api('/api/prepayments',command({action:'requestAdjustment',patientId:state.patient,expectedFundsRevision:account.revision,paymentId:use.patient_payment_id,expectedPaymentRevision:use.payment_revision,billId:bill.id,expectedBillRevision:bill.revision,billItemId:item.id,expectedItemRevision:item.revision,kind:use.kind,allocationId:use.id,expectedAllocationRevision:use.revision,amountCents:Number(f.elements.amount.value),reason:f.elements.reason.value,evidence:f.elements.evidence.value}));f.reset();message('费用调整及退款申请已提交负责人审核。');await finance();});};
$('#prepay-request-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/prepayments',command({action:'request',patientId:state.patient,paymentId:Number(f.dataset.paymentId),expectedFundsRevision:Number(f.dataset.fundsRevision),amountCents:Number(f.elements.amount.value),reason:f.elements.reason.value,evidence:f.elements.evidence.value}));f.hidden=true;message('退款申请已提交负责人审核。');await finance();});};
$('#prepay-refund-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,r=prepayState?.requests.find(x=>x.id===Number(f.dataset.requestId));if(!r)throw new Error('请重新查询退款申请。');await api('/api/prepayments',command({action:'refund',patientId:state.patient,requestId:r.id,expectedRevision:Number(f.dataset.revision),expectedFundsRevision:Number(f.dataset.fundsRevision),confirmed:f.elements.confirmed.checked,recipientVerification:f.elements.recipient.value,evidence:f.elements.evidence.value,...(r.channel==='现金'?{}:{externalReference:f.elements.reference.value})}));f.hidden=true;message('已记录系统外退款结果。');await finance();});};
$('#login-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=await api('/api/login',{username:f.elements.username.value,password:f.elements.password.value});state.csrf=data.csrf;const roles=$('#role');roles.replaceChildren();for(const role of data.user.roles)if(['frontdesk','cashier','dentist','manager','assistant'].includes(role.code))option(roles,role.code,role.name);if(data.user.username==='manager'&&data.user.roles.some(r=>r.code==='manager'))roles.value='manager';if(data.user.username==='assistant'&&data.user.roles.some(r=>r.code==='assistant'))roles.value='assistant';$('#user-info').textContent='登录人员：'+data.user.name;$('#login').hidden=true;$('#work').hidden=false;f.elements.password.value='';liveDefaults();await branches();$('#notice').hidden=true;});};
$('#role').onchange=e=>act(e.currentTarget,branches);
$('#branch').onchange=e=>act(e.currentTarget,async()=>{state.branch=Number(e.currentTarget.value);await refresh();});
$('#switch-account').onclick=e=>act(e.currentTarget,async()=>{await api('/api/logout',{});location.reload();});
$('#patient-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/setup',command({action:'patient',fields:{name:f.elements.patientName.value,birth_date:f.elements.birthDate.value,phone:f.elements.phone.value,phone_owner:f.elements.phone.value.trim()?f.elements.owner.value:"",contact_unavailable_reason:f.elements.phone.value.trim()?"":f.elements.unavailable.value},reason:f.elements.reason.value}));f.reset();message('患者档案已建立，请核对后预约。');await Promise.all([reception(),patients()]);});};
$('#patient-edit-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/setup',command({action:'patient-update',patientId:Number(f.elements.patient.value),expectedRevision:Number(f.dataset.revision),fields:{name:f.elements.patientName.value,birth_date:f.elements.birthDate.value,phone:f.elements.phone.value,phone_owner:f.elements.owner.value,contact_unavailable_reason:f.elements.unavailable.value},reason:f.elements.reason.value}));message('患者资料已更新。');f.elements.reason.value='';await Promise.all([reception(),patients()]);});};
$('#schedule-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;const editing=Boolean(f.dataset.id);await api('/api/setup',command({action:editing?'change':'publish',...(editing?{scheduleId:Number(f.dataset.id),expectedRevision:Number(f.dataset.revision)}:{}),dentistId:Number(f.elements.dentist.value),chairId:Number(f.elements.chair.value),businessDate:f.elements.businessDate.value,startsAt:isoLocal(f.elements.start.value),endsAt:isoLocal(f.elements.end.value),reason:f.elements.reason.value}));clearScheduleEdit();message(editing?'排班已调整。':'排班已发布。');await schedules();});};
$('#walkin-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,s=state.options?.schedules.find(x=>x.id===Number(f.elements.schedule.value));if(!s)throw new Error('请重新选择排班。');await api('/api/reception',command({action:'walkIn',patientId:Number(f.elements.patient.value),scheduleId:s.id,scheduleRevision:s.revision,arrivedAt:fixedNow,startsAt:isoLocal(f.elements.start.value),endsAt:isoLocal(f.elements.end.value)}));message('现场到诊已登记，请通知牙医接诊。');await reception();});};
$('#appointment-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,s=state.options.schedules.find(x=>x.id===Number(f.elements.schedule.value)),patientId=Number(f.elements.patient.value),booking=state.followupBooking,view=state.viewVersion,branch=state.branch;if(!s)throw Error('请先选择有效排班。');const receipt=await api('/api/reception',command({action:'create',patientId,scheduleId:s.id,scheduleRevision:s.revision,startsAt:isoLocal(f.elements.start.value),endsAt:isoLocal(f.elements.end.value),reason:f.elements.reason.value}));if(state.branch!==branch||state.role!=='frontdesk'||state.viewVersion!==view)return;f.elements.reason.value='';state.followupBooking=null;await Promise.all([reception(),followups()]);if(state.branch!==branch||state.role!=='frontdesk'||state.viewVersion!==view)return;if(booking&&booking.branch===branch&&booking.patientId===patientId){const contact=$('#followup-contact-form');contact.elements.followup.value=String(booking.id);contact.elements.followup.onchange?.();const appointment=contact.elements.appointment;if([...appointment.options].some(o=>o.value===String(receipt.id))){appointment.value=String(receipt.id);contact.elements.nextStep.value='arrange';message('预约已创建；请填写实际联系结果并保存关联。');revealTask(contact);return;}}message('预约已创建。');});};
let patientSearchVersion = 0;
function resetCashPatient() {
 state.cashSelection=(state.cashSelection||0)+1;
 patientSearchVersion++;
 state.financeVersion++;
 state.patient=null;
 state.bills=[];
 prepayState=null;
 $('#finance').dataset.patientReady='false';
 $('#finance-query').elements.patient.value='';
 $('#finance-patient-results').replaceChildren();
 $('#finance-patient-search').reset();
 $('#cash-by-number').reset();
 $('#cash-by-number').closest('details').open=false;
 $('#bill-patient-context').textContent='请先查找并选择患者。';
 for (const id of ['payment','prepay-receive','prepay-offset','prepay-request','prepay-refund','adjustment']) {
   const form=$('#'+id+'-form');
   form.reset();
   if(id!=='prepay-receive') form.hidden=true;
 }
}
async function selectCashPatient(patient) {
 const view=state.viewVersion;
 resetCashPatient();
 const version=state.cashSelection;
 $('#finance-query').elements.patient.value=patient.id;
 $('#bill-patient-context').textContent='正在查询 '+patient.name+' 的本店账单…';
 try {
   await finance();
   if(view!==state.viewVersion || version!==state.cashSelection)return;
   $('#bill-patient-context').textContent=patient.record_no ? patient.name+' · '+patient.record_no : patient.name;
   $('#finance').dataset.patientReady='true';
 } catch(error) {
   if(view===state.viewVersion && version===state.cashSelection)resetCashPatient();
   throw error;
 }
}
$('#cash-by-number').onsubmit=e=>{
 e.preventDefault();
 const id=Number(e.currentTarget.elements.id.value);
 if(Number.isSafeInteger(id)&&id>0)act(e.submitter,()=>selectCashPatient({id,name:'患者编号 '+id}));
};
$('#finance-patient-search').onsubmit=e=>{
 e.preventDefault();
 const term=e.currentTarget.elements.query.value.trim();
 const version=++patientSearchVersion,view=state.viewVersion,branch=state.branch;
 const list=$('#finance-patient-results');
 list.replaceChildren();
 act(e.submitter,async()=>{
   const data=await api('/api/finance/patients?branchId='+branch+'&q='+encodeURIComponent(term));
   if(version!==patientSearchVersion||view!==state.viewVersion||state.role!=='cashier')return;
   if(!data.items.length)list.textContent='未找到匹配患者。';
   for(const patient of data.items){
     const row=document.createElement('p');
     row.textContent=patient.name+' / '+patient.record_no+' / '+patient.phone_hint+'　';
     const button=document.createElement('button');
     button.type='button'; button.textContent='选择患者';
     button.onclick=()=>act(button,()=>selectCashPatient(patient));
     row.append(button);list.append(row);
   }
 });
};
$('#payment-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,b=state.bills.find(x=>x.id===Number(f.elements.bill.value)),channel=f.elements.channel.value;const value=command({patientId:state.patient,billId:b.id,expectedBillRevision:b.revision,expectedFundsRevision:b.fundsRevision,amountCents:Number(f.elements.amount.value),verified:f.elements.verified.checked,receivedAt:fixedNow,evidence:f.elements.evidence.value,channel,...(channel==='现金'?{}:{externalReference:f.elements.reference.value})});await api('/api/finance/payment',value);f.reset();message('已登记系统外收款。');await finance();});};
$('#execution-correct-cancel').onclick=()=>{$('#execution-correct-form').hidden=true;};
$('#execution-correct-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;if(Number(f.dataset.branch)!==state.branch||state.role!=='dentist'||Number(f.dataset.visitId)!==Number($('#record-form').elements.visit.value))throw new Error('门店或就诊已变更，请重新选择记录。');await api('/api/treatment/correct',command({visitId:Number(f.dataset.visitId),originalExecutionId:Number(f.dataset.executionId),procedureNote:f.elements.note.value,reason:f.elements.reason.value}));f.hidden=true;message('已追加诊疗经过更正；原记录和费用保留。');await loadRecord();});};
$('#treatment-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,v=state.treatment.visits.find(x=>x.id===Number(f.elements.visit.value));await api('/api/treatment/check',command({patientId:v.patient_id,visitId:v.id,expectedVisitRevision:v.revision,serviceId:Number(f.elements.service.value),quantity:Number(f.elements.quantity.value),toothCode:f.elements.tooth.value.trim()||null,surfaceCode:f.elements.surface.value.trim().toUpperCase()||null,completedAt:fixedNow,...(f.elements.planItem.value?{planItemId:Number(f.elements.planItem.value)}:{independentCheck:true,independentBasis:f.elements.basis.value}),procedureNote:f.elements.note.value}));f.reset();message('实际诊疗已登记，并已生成账单明细。');await treatment();});};
$('#record-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,loaded=state.record;if(!loaded||loaded.branch!==state.branch||loaded.visitId!==Number(f.elements.visit.value))throw new Error('请重新选择就诊并核对草稿。');
 if((f.elements.newTooth.value.trim()||f.elements.newSurface.value.trim())&&!f.elements.newFinding.value.trim())throw new Error('请填写对应的检查所见，或清空新增牙位和牙面。');const findings=loaded.findings.map(item=>({id:item.id,toothCode:$('#record-findings').querySelector('[data-finding-position=tooth][data-position-id="'+item.id+'"]').value.trim()||null,surfaceCode:$('#record-findings').querySelector('[data-finding-position=surface][data-position-id="'+item.id+'"]').value.trim().toUpperCase()||null,text:$('#record-findings').querySelector('[data-finding-id="'+item.id+'"]').value}));if(f.elements.newFinding.value.trim())findings.push({toothCode:f.elements.newTooth.value.trim()||null,surfaceCode:f.elements.newSurface.value.trim().toUpperCase()||null,text:f.elements.newFinding.value.trim()});
 await api('/api/record/draft',command({visitId:loaded.visitId,recordId:loaded.record.id,expectedRevision:loaded.record.revision,chiefComplaint:f.elements.chiefComplaint.value,diagnosis:f.elements.diagnosis.value,treatmentAdvice:f.elements.advice.value,findings}));message('病历草稿已保存。');await loadRecord();if(state.prescription?.visitId===loaded.visitId&&state.prescription.branch===state.branch)await loadPrescription();});};
$('#health-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,loaded=state.health;if(!loaded||loaded.branch!==state.branch||loaded.visitId!==Number($('#record-form').elements.visit.value))throw new Error('请重新选择就诊并核对健康资料。');if(recordDirty())throw new Error('病历有未保存的修改，请先保存病历草稿。');
 const fields=$('#health-fields'),items=['病史','过敏','用药'].map(category=>{const old=loaded.items.find(i=>i.category===category);return {category,certainty:fields.querySelector('select[data-category="'+category+'"]').value,content:fields.querySelector('textarea[data-category="'+category+'"]').value,source:f.elements.source.value,reportedAt:fixedNow,occurredAt:old?.occurred_at||null};});
 await api('/api/record/health',command({action:'health',visitId:loaded.visitId,expectedHealthVersionId:loaded.version?.id??null,items,reason:f.elements.reason.value,conclusion:f.elements.conclusion.value}));message('健康资料已复核。');await loadRecord();if(state.prescription?.visitId===loaded.visitId&&state.prescription.branch===state.branch)await loadPrescription();});};
$('#sign-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,record=state.record,health=state.health;if(!record||!health||record.visitId!==health.visitId||record.branch!==state.branch)throw new Error('请重新核对病历和健康资料。');if(recordDirty())throw new Error('病历有未保存的修改，请先保存病历草稿。');if(healthDirty())throw new Error('健康资料有未保存的修改，请先保存并复核。');
 await api('/api/record/health',command({action:'sign',visitId:record.visitId,recordId:record.record.id,expectedRevision:record.record.revision,confirmed:f.elements.confirmed.checked}));message('病历已签署；实际操作结束和诊椅清洁仍须另行确认。');await loadRecord();});};
$('#addendum-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,record=state.record;if(!record||record.branch!==state.branch||record.visitId!==Number($('#record-form').elements.visit.value))throw new Error('请重新选择就诊并核对病历。');
 await api('/api/record/addendum',command({visitId:record.visitId,recordId:record.record.id,expectedRevision:record.record.revision,confirmed:f.elements.confirmed.checked,content:f.elements.content.value,reason:f.elements.reason.value}));f.reset();message('补充记录已独立签署并追加。');await loadRecord();});};
$('#followup-create-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,record=state.record;if(!record||record.record.status!=='已签署'||record.branch!==state.branch)throw new Error('请选择已签署的来源就诊。');
 await api('/api/followups',command({action:'create',visitId:record.visitId,type:f.elements.type.value,purpose:f.elements.purpose.value,targetStart:f.elements.start.value,targetEnd:f.elements.end.value,nextContactDate:f.elements.next.value,responsibleFrontdeskId:Number(f.elements.frontdesk.value),requiresAssessment:f.elements.assessment.checked}));f.elements.purpose.value='';message('复诊要求已发布，责任前台可联系。');await followups();});};
$('#followup-contact-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=state.followups,item=data.items.find(x=>x.id===Number(f.elements.followup.value)),a=data.appointments.find(x=>x.id===Number(f.elements.appointment.value));if(!item)throw new Error('请重新选择复诊事项。');
 const value=command({action:'contact',followupId:item.id,expectedRevision:item.revision,method:f.elements.method.value,contactedAt:fixedNow,result:f.elements.result.value,nextStep:f.elements.nextStep.value,nextContactDate:f.elements.nextDate.value,note:f.elements.note.value,goalAchieved:f.elements.goalAchieved.checked,completionBasis:f.elements.completionBasis.value,...(a?{appointmentId:a.id,expectedAppointmentRevision:a.revision}:{})});await api('/api/followups',value);f.elements.note.value='';f.elements.completionBasis.value='';f.elements.goalAchieved.checked=false;message('实际联系已记录。');await followups();});};
$('#followup-assess-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,item=state.followups?.items.find(x=>x.id===Number(f.elements.followup.value));if(!item)throw new Error('请重新选择复诊事项。');
 await api('/api/followups',command({action:'assess',followupId:item.id,expectedRevision:item.revision,method:f.elements.method.value,...(f.elements.method.value==='到诊检查'?{visitId:Number(f.elements.visit.value)}:{}),advice:f.elements.advice.value,...(f.elements.advice.value==='继续跟进'?{nextDate:f.elements.nextDate.value,responsibleFrontdeskId:Number(f.elements.responsibleFrontdesk.value)}:{}),assessmentCompleted:f.elements.confirmed.checked,assessedAt:fixedNow,result:f.elements.result.value}));const continued=f.elements.advice.value==='继续跟进';f.reset();message(continued?'实际评估已记录，事项已交回前台继续跟进。':'实际评估已记录，复诊事项已完成。');await followups();});};
$('#issue-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,item=state.inventory?.items.find(x=>x.stockId===Number(f.elements.stock.value));if(!item)throw new Error('请重新查询本店库存。');
 await api('/api/inventory/issue',command({stockId:item.stockId,expectedStockRevision:item.revision,quantityScaled:quantityScaled(f.elements.quantity.value,item.scale),reason:f.elements.reason.value}));f.reset();message('材料领用已登记。');await inventory();});};
$('#inventory-return-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,issue=state.inventory?.issues?.find(x=>x.id===Number(f.elements.issue.value));if(!issue)throw new Error('请重新查询本店原领用。');await api('/api/inventory/issue',command({action:'return',stockId:issue.stockId,originalMovementId:issue.id,expectedStockRevision:issue.stockRevision,quantityScaled:quantityScaled(f.elements.quantity.value,issue.scale),reason:f.elements.reason.value}));f.reset();message('未用材料已退回原批次库存。');await inventory();});};
$('#count-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,item=state.inventory?.items.find(x=>x.stockId===Number(f.elements.stock.value));if(!item)throw new Error('请重新查询库存。');await api('/api/inventory/count',command({action:'count',stockId:item.stockId,expectedStockRevision:item.revision,countedQuantityScaled:quantityScaled(f.elements.quantity.value,item.scale,true),countedAt:fixedNow,reason:f.elements.reason.value}));f.reset();message('盘点已提交负责人审核。');await inventory();});};
$('#recount-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,count=state.inventory?.counts.find(c=>c.id===Number(f.elements.namedItem('count').value)),item=state.inventory?.items.find(x=>x.stockId===count?.batch_stock_id);if(!count||!item)throw new Error('请重新查询盘点和库存。');await api('/api/inventory/count',command({action:'recount',countId:count.id,expectedRevision:count.revision,expectedStockRevision:item.revision,countedQuantityScaled:quantityScaled(f.elements.quantity.value,item.scale,true),countedAt:fixedNow,reason:f.elements.reason.value}));f.reset();message('已提交重新实点。');await inventory();});};
$('#purchase-add-line').onclick=()=>{const box=$('#purchase-lines'),rows=box.querySelectorAll('[data-purchase-line]');if(rows.length>=20){message('一张采购单最多填写 20 项材料。');return;}const line=rows[0].cloneNode(true);line.querySelectorAll('input').forEach(input=>input.value='');const select=line.querySelector('select');if(select.options.length>rows.length)select.selectedIndex=rows.length;box.append(line);};
$('#purchase-lines').onclick=e=>{if(!e.target.closest('[data-remove-line]'))return;const rows=document.querySelectorAll('#purchase-lines [data-purchase-line]');if(rows.length>1)e.target.closest('[data-purchase-line]').remove();else message('采购单至少需要一项材料。');};
$('#purchase-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=state.purchases,s=data.suppliers.find(x=>x.id===Number(f.elements.supplier.value));if(!s)throw new Error('请重新查询采购目录。');const items=[...f.querySelectorAll('[data-purchase-line]')].map(line=>{const m=data.materials.find(x=>x.id===Number(line.querySelector('[name=material]').value));if(!m)throw new Error('请重新查询采购目录。');return {materialId:m.id,expectedMaterialRevision:m.revision,quantityScaled:quantityScaled(line.querySelector('[name=quantity]').value,m.quantity_scale),unitPriceCents:Number(line.querySelector('[name=price]').value)};});await api('/api/purchases',command({action:'create',supplierId:s.id,expectedSupplierRevision:s.revision,items,agreedAt:fixedNow,deliveryTerms:f.elements.terms.value,reason:f.elements.reason.value}));f.reset();[...f.querySelectorAll('[data-purchase-line]')].slice(1).forEach(line=>line.remove());message('采购已提交负责人确认。');await purchases();});};
$('#receive-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=state.purchases,p=data.orders.find(x=>x.id===Number(f.elements.purchase.value)),item=p?.items.find(x=>x.id===Number(f.elements.purchaseItem.value)),m=data.materials.find(x=>x.id===item?.material_id);if(!p||!item||!m)throw new Error('请重新查询采购单。');await api('/api/purchases',command({action:'receive',purchaseId:p.id,expectedPurchaseRevision:p.revision,purchaseItemId:item.id,expectedItemRevision:item.revision,batchId:Number(f.elements.batch.value),locationId:Number(f.elements.location.value),quantityScaled:quantityScaled(f.elements.quantity.value,m.quantity_scale),acceptedScaled:quantityScaled(f.elements.accepted.value,m.quantity_scale,true),rejectedScaled:quantityScaled(f.elements.rejected.value,m.quantity_scale,true),pendingScaled:quantityScaled(f.elements.pending.value,m.quantity_scale,true),arrivedAt:fixedNow,deliveryEvidence:f.elements.evidence.value,inspectionNote:f.elements.note.value}));f.reset();message('实际到货及验收结果已登记。');await Promise.all([purchases(),inventory()]);});};
$('#batch-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/inventory/batch',command({action:'create',materialId:Number(f.elements.material.value),batchNo:f.elements.batchNo.value,expiryDate:f.elements.expiry.value||null,sourceNote:f.elements.source.value}));f.reset();message('待检批次已登记。');await purchases();});};
$('#inspect-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,data=state.purchases,itemId=Number(f.elements.namedItem('item').value);let found;for(const p of data.orders)for(const r of p.receipts)for(const i of r.items)if(i.id===itemId)found={p,r,i};if(!found)throw new Error('请重新查询待检条目。');const m=data.materials.find(x=>x.id===found.p.items.find(x=>x.id===found.i.purchase_order_item_id)?.material_id);if(!m)throw new Error('材料信息待核对。');await api('/api/purchases',command({action:'inspect',purchaseId:found.p.id,receiptId:found.r.id,expectedReceiptRevision:found.r.revision,receiptItemId:found.i.id,expectedItemRevision:found.i.revision,acceptedScaled:quantityScaled(f.elements.accepted.value,m.quantity_scale,true),rejectedScaled:quantityScaled(f.elements.rejected.value,m.quantity_scale,true),inspectionNote:f.elements.note.value}));f.reset();message('后续检验结果已登记。');await Promise.all([purchases(),inventory()]);});};
$('#pending-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,item=state.pending.find(x=>x.id===Number(f.elements.namedItem('item').value));await api('/api/prices/pending',command({billItemId:item.id,priceId:Number(f.elements.price.value),expectedRevision:item.revision,expectedBillRevision:item.bill_revision,...(f.elements.quoteItem.value?{quoteItemId:Number(f.elements.quoteItem.value)}:{}),reviewNote:f.elements.note.value}));f.reset();message('核价已确认。');await manager();});};
$('#price-draft-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget;await api('/api/prices',command({action:'draft',serviceId:Number(f.elements.service.value),unitPriceCents:Number(f.elements.amount.value),validFrom:isoLocal(f.elements.validFrom.value),reason:f.elements.reason.value}));f.elements.amount.value='';f.elements.reason.value='';message('价目草稿已保存，请提交负责人确认。');await cashierPrices();});};
$('#approval-form').onsubmit=e=>{e.preventDefault();act(e.submitter,async()=>{const f=e.currentTarget,v=state.approvalOptions.visits.find(x=>x.id===Number(f.elements.visit.value));await api('/api/approvals',command({action:'propose',sourceBranchId:state.branch,targetBranchId:Number(f.elements.target.value),dentistId:Number(f.elements.dentist.value),patientId:v.patient_id,visitId:v.id,scope:f.elements.scope.value,validUntil:isoLocal(f.elements.validUntil.value),reason:'已核实患者同意：'+f.elements.reason.value}));f.reset();message('跨店查阅申请已提交。');await manager();});};


function updateAgendaSelection() {
 clearAppointmentChange();
 if (state.role === 'frontdesk' && state.options) renderAgenda(state.options);
}
$('#agenda-day').onchange = () => { agendaAllDates=false; updateAgendaSelection(); };
for (const [selector,offset] of [['#agenda-prev',-7],['#agenda-next',7]]) {
 $(selector).onclick = () => {
   $('#agenda-day').value='';
   agendaWeekStart=shiftDay(agendaWeekStart || weekStart(localInput(fixedNow).slice(0,10)),offset);
   agendaAllDates=false;
   updateAgendaSelection();
 };
}
$('#agenda-status').onchange = updateAgendaSelection;
$('#agenda-today').onclick = () => {
 agendaAllDates=false;
 $('#agenda-day').value = localInput(fixedNow).slice(0,10);
 updateAgendaSelection();
};
$('#agenda-all').onclick = () => {
 agendaAllDates=true;
 $('#agenda-day').value = '';
 updateAgendaSelection();
};


const areaIds = ['reception','dentist','documents-area','finance','insurance-area','manager','inventory','assistant-resources-area','catalog-area','branch-staff-area'];
const F=['frontdesk'], D=['dentist'], C=['cashier'], A=['assistant'], M=['manager'];
const pages = [
 {key:'home',label:'岗位首页',group:'工作台',roles:[...F,...D,...C,...A,...M]},
 {key:'agenda',label:'预约日程',group:'患者服务',roles:F,area:'reception',panel:'预约日程'},
 {key:'arrival',label:'到诊与候诊',group:'患者服务',roles:F,area:'reception',panel:'到诊与候诊'},
 {key:'patients',label:'患者档案',group:'患者服务',roles:F,area:'reception',panel:'患者档案'},
 {key:'contact',label:'复诊联系',group:'患者服务',roles:F,area:'reception',panel:'复诊联系'},
 {key:'queue',label:'接诊队列',group:'临床诊疗',roles:D,area:'dentist',panel:'接诊队列'},
 {key:'record',label:'病历与签署',group:'临床诊疗',roles:D,area:'dentist',panel:'病历与签署'},
 {key:'plan',label:'治疗方案',group:'临床诊疗',roles:D,area:'dentist',panel:'方案与报价'},
 {key:'treatment',label:'实际诊疗',group:'临床诊疗',roles:D,area:'dentist',panel:'诊疗记录'},
 {key:'prescription',label:'院外处方',group:'临床诊疗',roles:D,area:'dentist',panel:'院外处方'},
 {key:'assessment',label:'复诊与随访',group:'临床诊疗',roles:D,area:'dentist',panel:'复诊随访'},
 {key:'documents',label:'影像与文书',group:'临床诊疗',roles:[...D,...A],area:'documents-area'},
 {key:'cross-record',label:'跨店病历',group:'临床诊疗',roles:D,area:'dentist',panel:'跨店查阅'},
 {key:'bills',label:'账单与收款',group:'费用办理',roles:C,area:'finance',panel:'账单与收款'},
 {key:'quotes',label:'报价与确认',group:'费用办理',roles:[...C,...D],area:'finance',panel:'报价'},
 {key:'prepayment',label:'预付款',group:'费用办理',roles:C,area:'finance',panel:'预付款'},
 {key:'refund',label:'退费办理',group:'费用办理',roles:C,area:'finance',panel:'退费'},
 {key:'prices',label:'门店价目',group:'费用办理',roles:C,area:'finance',panel:'门店价目'},
 {key:'insurance',label:'医保办理',group:'费用办理',roles:[...F,...C,...M],area:'insurance-area'},
 {key:'analytics',label:'经营与门店汇总',group:'门店运营',roles:M,area:'manager',panel:'经营概览'},
 {key:'schedule',label:'排班与设备',group:'门店运营',roles:M,area:'manager',panel:'排班与设备'},
 {key:'review',label:'费用审核与核价',group:'门店运营',roles:M,area:'manager',panel:'费用审核'},
 {key:'price-review',label:'价目审核',group:'门店运营',roles:M,area:'manager',panel:'价目审核'},
 {key:'authorization',label:'跨店查阅授权',group:'门店运营',roles:M,area:'manager',panel:'跨店授权'},
 {key:'stock',label:'库存与领用',group:'物资管理',roles:[...A,...M],area:'inventory',panel:'库存与领用'},
 {key:'purchase',label:'采购与验收',group:'物资管理',roles:[...A,...M],area:'inventory',panel:'采购与收货'},
 {key:'count',label:'库存盘点',group:'物资管理',roles:[...A,...M],area:'inventory',panel:'盘点'},
 {key:'resources',label:'诊椅与设备',group:'物资管理',roles:A,area:'assistant-resources-area'},
 {key:'services',label:'收费项目目录',group:'基础设置',roles:[...C,...M],area:'catalog-area',panel:'收费项目'},
 {key:'materials',label:'材料与药品目录',group:'基础设置',roles:[...A,...M],area:'catalog-area',panel:'材料目录'},
 {key:'suppliers',label:'供应商',group:'基础设置',roles:M,area:'catalog-area',panel:'供应商'},
 {key:'staff',label:'人员与门店岗位',group:'基础设置',roles:M,area:'branch-staff-area',panel:'人员与岗位'},
 {key:'branch-info',label:'门店资料',group:'基础设置',roles:M,area:'branch-staff-area',panel:'门店资料'}
];
function resolvePage(page) {
 return page.key==='quotes'&&state.role==='dentist' ? {...page,area:'dentist',panel:'本店报价'} : page;
}
const work=$('#work');
const sidebar=document.createElement('aside');
sidebar.className='workspace-sidebar';
sidebar.innerHTML='<div class="workspace-brand"><span class="workspace-logo">青</span><div><strong>青禾牙科</strong><small>连锁诊所工作台</small></div></div><nav aria-label="工作区域"></nav>';
work.prepend(sidebar);
const pageHeader=document.createElement('header');
pageHeader.className='workspace-heading';
pageHeader.innerHTML='<div><span></span><h2 tabindex="-1"></h2></div>';
const contextBar=work.querySelector('.filters');
contextBar.append($('#user-info'));
contextBar.after(pageHeader);
const home=document.createElement('section');
home.id='workspace-home';
home.className='clinical-summary';
home.innerHTML='<div class="home-heading"><div><h2>今日工作</h2><p id="home-business-day"></p></div><button type="button" id="home-refresh">刷新待办</button></div><div id="home-metrics" class="work-metrics"></div><div class="home-columns"><section><h3>待处理事项</h3><div id="home-tasks"></div></section><section><h3>业务办理</h3><div id="home-links"></div></section></div>';
pageHeader.after(home);
let currentPage='home';
let previousContext='';
function availablePages() {
 return pages.filter(page=>page.roles.includes(state.role)).map(resolvePage)
   .filter(page=>!page.area||!document.getElementById(page.area).hidden);
}
function openPage(key,focus=false) {
 const page=availablePages().find(p=>p.key===key);
 if(!page)return;
 currentPage=key;
 home.hidden=key!=='home';
 for(const id of areaIds)document.getElementById(id).classList.toggle('workspace-inactive',id!==page.area);
 if(page.area){
   const area=document.getElementById(page.area);
   for(const panel of area.querySelectorAll(':scope > .task-panel'))panel.hidden=panel.dataset.panel!==page.panel;
   if(page.area==='finance')$('#finance-selector').hidden=!['bills','prepayment','refund'].includes(key);
   if(page.area==='dentist')$('#visit-selector').hidden=['quotes','cross-record'].includes(key);
   if(page.area==='reception'){
     const selected=area.querySelector(':scope > .task-panel:not([hidden])');
     const filter=$('#patient-filter').parentElement;
     const drawer=selected?.querySelector('details');
     if(key==='patients'){filter.hidden=true;}
     else if(drawer){drawer.querySelector('summary').after(filter);filter.hidden=false;}
   }
 }
 pageHeader.querySelector('span').textContent=page.group;
 pageHeader.querySelector('h2').textContent=page.label;
 for(const button of sidebar.querySelectorAll('[data-page]')){
   const active=button.dataset.page===key;
   button.classList.toggle('active',active);
   button.setAttribute('aria-current',active?'page':'false');
 }
 if(key==='home')renderHome();
 if(focus)pageHeader.querySelector('h2').focus({preventScroll:true});
 window.scrollTo({top:0,behavior:'auto'});
}
function revealTask(form) {
 const panel=form.closest('.task-panel');
 const area=form.closest('#work > section');
 const page=availablePages().find(p=>p.area===area?.id&&p.panel===panel?.dataset.panel);
 if(page)openPage(page.key);
 const drawer=form.closest('details');
 if(drawer)drawer.open=true;
 form.scrollIntoView({block:'center'});
}
function renderWorkspace() {
 if(work.hidden)return;
 const context=state.role+'/'+state.branch;
 if(context!==previousContext){
   previousContext=context;
   currentPage='home';
   $('#agenda-day').value='';
   agendaWeekStart='';
   agendaAllDates=false;
 }
 const nav=sidebar.querySelector('nav');
 nav.replaceChildren();
 let group;
 for(const page of availablePages()){
   if(page.group!==group){
     group=page.group;
     const heading=document.createElement('p');
     heading.className='workspace-nav-group';
     heading.textContent=group;
     nav.append(heading);
   }
   const button=document.createElement('button');
   button.type='button';button.dataset.page=page.key;button.textContent=page.label;
   button.onclick=()=>openPage(page.key,true);
   nav.append(button);
 }
 openPage(availablePages().some(p=>p.key===currentPage)?currentPage:'home');
}
const workspaceObserver=new MutationObserver(renderWorkspace);
for(const id of areaIds)workspaceObserver.observe(document.getElementById(id),{attributes:true,attributeFilter:['hidden']});
workspaceObserver.observe(work,{attributes:true,attributeFilter:['hidden']});

function makeCatalogPanel(name,ids){
 const panel=document.createElement('div');
 panel.className='task-panel';panel.dataset.panel=name;
 for(const id of ids)panel.append(document.getElementById(id));
 $('#catalog-area').append(panel);
}
makeCatalogPanel('收费项目',['catalog-services','catalog-service-form','catalog-service-edit']);
makeCatalogPanel('材料目录',['catalog-materials','catalog-material-form']);
makeCatalogPanel('供应商',['supplier-area']);

function addHomeLink(container,label,key,note) {
 const button=document.createElement('button');
 button.type='button';
 const title=document.createElement('strong');title.textContent=label;button.append(title);
 if(note){const subtitle=document.createElement('small');subtitle.textContent=note;button.append(subtitle);}
 button.onclick=()=>openPage(key,true);
 container.append(button);
}
function renderHome(){
 if(work.hidden)return;
 $('#home-business-day').textContent=$('#branch').selectedOptions[0]?.textContent+' · '+localInput(fixedNow).slice(0,10);
 const links=$('#home-links'),tasks=$('#home-tasks'),metrics=$('#home-metrics');
 links.replaceChildren();tasks.replaceChildren();metrics.replaceChildren();
 const metric=(label,value,key)=>{const b=document.createElement('button');b.type='button';const s=document.createElement('span');s.textContent=label;const n=document.createElement('strong');n.textContent=String(value);b.append(s,n);b.onclick=()=>openPage(key);metrics.append(b);};
 const task=(label,key,note)=>addHomeLink(tasks,label,key,note);
 if(state.role==='frontdesk'){
   const options=state.options;
   if(options){
     metric('今日有效预约',options.appointments.filter(a=>a.status==='已预约'&&localInput(a.planned_start).startsWith(localInput(fixedNow).slice(0,10))).length,'agenda');
     metric('候诊',options.visits.filter(v=>v.status==='候诊').length,'arrival');
     metric('接诊中',options.visits.filter(v=>v.status==='接诊中').length,'arrival');
     const pending=(state.followups?.items||[]).filter(f=>f.status==='待联系');
     metric('待联系复诊',pending.length,'contact');
     for(const f of pending.slice(0,5))task(f.patient_name+' · '+f.purpose,'contact',f.target_start+' 至 '+f.target_end);
     for(const v of options.visits.filter(v=>v.status==='候诊').slice(0,4))task(v.patient_name+' 等待接诊','arrival',v.dentist_name);
   }
 } else if(state.role==='dentist'){
   if(state.treatment){
     const visits=state.treatment.visits;
     metric('候诊',visits.filter(v=>v.status==='候诊').length,'queue');
     metric('接诊中',visits.filter(v=>v.status==='接诊中').length,'record');
     metric('复诊随访事项',state.followups?.items.length||0,'assessment');
     for(const v of visits.filter(v=>['候诊','接诊中'].includes(v.status)).slice(0,5))task(v.patient_name+' · '+v.status,'queue',v.record_no);
   }
 } else if(state.role==='manager'){
   const d=state.dashboard;
   if(d){
     metric('今日到诊',d.arrivals,'analytics');
     metric('今日确认收款','¥'+(d.confirmedReceiptCents/100).toFixed(2),'analytics');
     metric('待确认采购',d.pendingPurchases,'purchase');
     metric('待处理盘点',d.pendingCounts,'count');
     if(d.pendingPurchases)task(d.pendingPurchases+' 张采购单待确认','purchase');
     if(d.pendingCounts)task(d.pendingCounts+' 项盘点待处理','count');
   }
 } else if(state.role==='assistant'){
   if(state.inventory){
     metric('材料库存批次',state.inventory.items.length,'stock');
     metric('待复核盘点',state.inventory.counts.filter(c=>c.status==='待重新核对').length,'count');
   }
   if(state.purchases){
     metric('采购单',state.purchases.orders.length,'purchase');
     for(const order of state.purchases.orders.filter(o=>o.status==='已确认'&&o.items.some(i=>!['履行已完成','剩余已取消'].includes(i.status))).slice(0,5))task('采购到货待办理','purchase',order.record_no);
   }
 } else {
   task('查找患者并核对本店费用','bills','核对档案号后办理收款、预付款和退费');
   task('核价出具和患者费用决定','quotes','在报价列表中核对方案和版本');
 }
 if(!tasks.children.length){const p=document.createElement('p');p.className='muted';p.textContent='当前没有显示需优先处理的事项。可从右侧进入业务。';tasks.append(p);}
 for(const page of availablePages().filter(p=>p.key!=='home'))addHomeLink(links,page.label,page.key);
}
$('#home-refresh').onclick=e=>act(e.currentTarget,refresh);

function resetClinicalDrafts() {
 state.record=null;
 state.health=null;
 clearPrescription();
 for(const form of $('#dentist').querySelectorAll('form'))form.reset();
 for(const row of [...$('#prescription-items').querySelectorAll('[data-prescription-item]')].slice(1))row.remove();
 $('#plan-edit-cancel').click();
 $('#execution-correct-form').hidden=true;
}
function clearVisitContext() {
 state.visitRequest=(state.visitRequest || 0)+1;
 $('#clinic-visit').replaceChildren();
 $('#clinic-visit').dataset.visit='reset';
 $('#dentist').dataset.caseReady='false';
}
$('#clinic-visit').onchange=e=>{
 $('#dentist').dataset.caseReady='false';
 act(e.currentTarget,()=>treatment(Number(e.target.value)));
};


function dataTable(headers,rows) {
 const wrapper=document.createElement('div');wrapper.className='data-table-wrap';
 const table=document.createElement('table');table.className='work-table';
 const head=table.createTHead().insertRow();
 for(const header of headers){const th=document.createElement('th');th.scope='col';th.textContent=header;head.append(th);}
 const body=table.createTBody();
 for(const values of rows){
   const row=body.insertRow();
   for(const value of values){
     const cell=row.insertCell();
     if(value instanceof Node)cell.append(value);
     else cell.textContent=value==null||value===''?'—':String(value);
   }
 }
 wrapper.append(table);return wrapper;
}
function renderPatientDirectory(){
 const list=$('#patient-directory');
 const term=$('#patient-directory-search').value.trim().toLocaleLowerCase();
 const patients=(state.directoryData||[]).filter(p=>[p.name,p.record_no,p.phone].some(v=>String(v||'').toLocaleLowerCase().includes(term)));
 list.replaceChildren();
 if(!patients.length){list.textContent=term?'没有匹配的患者，请调整搜索条件。':'当前尚未建立患者档案。';return;}
 const rows=patients.map(patient=>{
   const actions=document.createElement('div');actions.className='row-actions';
   for(const [label,key] of [['查看资料','patients'],['安排预约','agenda']]){
     const button=document.createElement('button');button.type='button';button.textContent=label;
     button.onclick=()=>{
       $('#patient-filter').value='';applyPatientFilter();
       const form=key==='patients'?$('#patient-edit-form'):$('#appointment-form');
       form.elements.patient.value=String(patient.id);
       form.elements.patient.onchange?.();
       if(key==='patients')$('#patient-edit-drawer').open=true;
       openPage(key);
       revealTask(form);
     };
     actions.append(button);
   }
   return [patient.name,patient.record_no,patient.birth_date,patient.phone||patient.contact_unavailable_reason,actions];
 });
 list.append(dataTable(['患者姓名','档案号','出生日期','联系方式','办理'],rows));
}
$('#patient-directory-search').oninput=renderPatientDirectory;


for(const [id,label] of [
 ['catalog-service-form','新增收费项目'],['catalog-material-form','新增材料或药品'],
 ['supplier-form','新增供应商'],['schedule-form','发布排班'],
 ['purchase-form','新建采购单'],['batch-form','登记待检批次'],
 ['receive-form','办理到货验收'],['inspect-form','登记后续检验'],
 ['issue-form','登记材料领用'],['inventory-return-form','退回未用材料'],
 ['count-form','登记库存盘点'],['recount-form','重新实点']
]){
 const form=document.getElementById(id);
 const drawer=document.createElement('details');drawer.className='entry-drawer';
 const summary=document.createElement('summary');summary.textContent=label;
 form.before(drawer);drawer.append(summary,form);
}
