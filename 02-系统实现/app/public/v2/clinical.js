'use strict';
const clinicalView={selected:null,detail:null,treatment:null,catalog:null};
function resetClinical(){clinicalView.selected=null;clinicalView.detail=null;clinicalView.treatment=null;clinicalView.catalog=null;}
const clinicalText=(name,title,value='',required=true)=>`<label>${esc(title)}<textarea name="${name}" ${required?'required':''}>${esc(value||'')}</textarea></label>`;
const clinicalConfirm=label=>`<label><input type="checkbox" name="confirmed" required>${esc(label)}</label>`;
const clinicalMoney=cents=>cents==null?'未填写':(cents/100).toFixed(2)+'元';
function yuanCents(value,optional=false){
 if(optional && value.trim()==='')return null;
 if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('金额请填写非负数字，最多两位小数');
 const [whole,fraction='']=value.split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('金额超出可处理范围');return Number(cents);
}
function clinicalAction(task){Promise.resolve().then(task).catch(e=>notice(e.message,true));}
function clinicalContext(){const d=clinicalView.detail;return {visitId:d.visit.id,patientId:d.patient.id};}
function findingRow(f={}){
 return `<fieldset class="finding-row" data-id="${f.id||''}"><legend>检查所见</legend><div class="form-grid">${input('toothCode','牙位（可留空）',f.tooth_code||'','text',false)}${input('surfaceCode','牙面（可留空）',f.surface_code||'','text',false)}<div class="full">${clinicalText('findingText','实际所见',f.finding_text||'')}</div></div></fieldset>`;
}
async function clinicalStart(){
 const d=clinicalView.detail,now=(await api('/status')).now;
 openEditor('核对并开始接诊',`<p>${esc(d.patient.name)} · ${esc(d.patient.record_no)}</p>${input('startedAt','实际开始时间',localDateTimeSeconds(now),'datetime-local')}${clinicalConfirm('已核对患者身份，且本次诊椅、器械和必要设备已经就绪')}`,async value=>{
  await command('/clinical-records/record',{action:'start',...clinicalContext(),expectedVisitRevision:d.visit.revision,startedAt:stamp(value.startedAt)},'clinical-start');
 });
}
async function clinicalHealth(reviewOnly=false){
 const d=clinicalView.detail,latest=d.healthVersions[0],now=(await api('/status')).now;
 let body=`<p>${esc(d.patient.name)} · ${esc(d.patient.record_no)}</p>`;
 if(!reviewOnly)for(const [index,category] of ['病史','过敏','用药'].entries()){
  const old=latest?.items.find(i=>i.category===category);
  body+=`<fieldset><legend>${category}</legend>${select('certainty'+index,'本次核实情况',options(['未知','无','有'].map(x=>({id:x,name:x})),x=>x.name,old?.certainty||'未知'))}${clinicalText('content'+index,'实际报告内容',old?.content||'')}${input('source'+index,'资料来源',old?.source||'患者当面报告')}</fieldset>`;
 }
 body+=clinicalText('conclusion','当次健康复核结论')+(!reviewOnly?input('reason','形成或更新资料的原因'):'')+clinicalConfirm('已逐项询问并核对本次资料，未确认的信息如实保留');
 openEditor(reviewOnly?'复核已有健康资料':'记录健康资料并复核',body,async value=>{
  const input={action:reviewOnly?'review':'record',...clinicalContext(),expectedHealthVersionId:latest?.id||null,conclusion:value.conclusion};
  if(!reviewOnly){input.reason=value.reason;input.effectiveAt=now;input.items=['病史','过敏','用药'].map((category,i)=>({category,certainty:value['certainty'+i],content:value['content'+i],source:value['source'+i],reportedAt:now}));}
  await command('/health-versions/health',input,'clinical-health');
 });
}
function clinicalRecord(){
 const d=clinicalView.detail,r=d.record;
 openEditor('填写本次病历草稿',`${clinicalText('chiefComplaint','主诉',r.chief_complaint)}${clinicalText('diagnosis','检查诊断',r.diagnosis)}${clinicalText('treatmentAdvice','处理意见及诊后安排',r.treatment_advice)}<div id="finding-rows">${(d.findings.length?d.findings:[{}]).map(findingRow).join('')}</div><button type="button" id="add-finding">增加一条检查所见</button>`,async value=>{
  const findings=[...document.querySelectorAll('#finding-rows .finding-row')].map(el=>({...(el.dataset.id?{id:Number(el.dataset.id)}:{}),toothCode:el.querySelector('[name=toothCode]').value,surfaceCode:el.querySelector('[name=surfaceCode]').value,text:el.querySelector('[name=findingText]').value}));
  await command('/clinical-records/record',{action:'save',...clinicalContext(),recordId:r.id,expectedRevision:r.revision,chiefComplaint:value.chiefComplaint,diagnosis:value.diagnosis,treatmentAdvice:value.treatmentAdvice,findings},'clinical-record');
 });
 $('#add-finding').onclick=()=>$('#finding-rows').insertAdjacentHTML('beforeend',findingRow());
}
function clinicalSign(addendum=false){
 const d=clinicalView.detail,r=d.record;
 const preview=addendum?clinicalText('content','独立补充正文')+clinicalText('reason','补充或更正依据'):
  `<div class="clinical-note"><strong>主诉</strong><p>${esc(r.chief_complaint||'未填写')}</p><strong>诊断</strong><p>${esc(r.diagnosis||'未填写')}</p><strong>处理意见</strong><p>${esc(r.treatment_advice||'未填写')}</p><p>检查所见 ${d.findings.length} 条；当次健康复核 ${d.reviews.length} 次。</p></div>`;
 openEditor(addendum?'追加独立病历补充':'核对并签署病历',preview+clinicalConfirm(addendum?'已核对补充内容及依据，保留原签署正文':'已核对本次正文、检查所见和健康复核，确认签署；实际操作结束和清洁交接分别办理'),async value=>{
  await command('/clinical-record-signatures/sign',{action:addendum?'addendum':'sign',recordId:r.id,expectedRevision:r.revision,confirmed:value.confirmed==='on',...(addendum?{content:value.content,reason:value.reason}:{})},'clinical-sign');
 });
}
function planItemRow(item={}){
 return `<fieldset class="plan-item-row" data-id="${item.id||''}"><legend>计划项目</legend>${clinicalText('description','计划项目说明',item.item_description||'')}<div class="form-grid">${input('toothCode','牙位（可留空）',item.tooth_code||'','text',false)}${input('surfaceCode','牙面（可留空）',item.surface_code||'','text',false)}${input('quantity','计划数量',item.planned_quantity||1,'number')}${input('estimatedYuan','预计费用（元，可留空）',item.estimated_cents==null?'':(item.estimated_cents/100).toFixed(2),'text',false)}</div></fieldset>`;
}
function clinicalPlanEditor(plan=null,version=null,revise=false){
 const d=clinicalView.detail;
 const items=revise?version.items.filter(i=>i.effectiveQuantity<i.planned_quantity).map(i=>({...i,id:null,planned_quantity:i.planned_quantity-i.effectiveQuantity,estimated_cents:null})):version?.items||[{}];
 openEditor(revise?'形成新的方案版本':version?'编辑方案草稿':'建立治疗方案',`${!version?clinicalText('goal','治疗目标'):''}${clinicalText('diagnosticBasis','诊断及检查依据',version?.diagnostic_basis||d.record.diagnosis||'')}${clinicalText('plannedSchedule','预计分次安排',version?.planned_schedule||'')}${clinicalText('reason',revise?'改版原因':'方案形成或修改依据')}<p>预计费用用于方案说明，实际收费由已完成项目形成。</p><div id="plan-item-rows">${items.map(planItemRow).join('')}</div><button id="add-plan-item" type="button">增加计划项目</button>`,async value=>{
  const items=[...document.querySelectorAll('#plan-item-rows .plan-item-row')].map(el=>({...(el.dataset.id?{id:Number(el.dataset.id)}:{}),description:el.querySelector('[name=description]').value,toothCode:el.querySelector('[name=toothCode]').value||null,surfaceCode:el.querySelector('[name=surfaceCode]').value||null,quantity:Number(el.querySelector('[name=quantity]').value),estimatedCents:yuanCents(el.querySelector('[name=estimatedYuan]').value,true)}));
  await command('/treatment-plans/plan',{...clinicalContext(),action:revise?'revise':version?'save':'draft',...(version?{versionId:version.id,expectedRevision:version.revision,...(revise?{expectedPlanRevision:plan.revision}:{})}:{goal:value.goal}),diagnosticBasis:value.diagnosticBasis,plannedSchedule:value.plannedSchedule,reason:value.reason,items},'clinical-plan');
 });
 $('#add-plan-item').onclick=()=>$('#plan-item-rows').insertAdjacentHTML('beforeend',planItemRow());
}
async function clinicalDecision(plan,version){
 const [status,attachments]=await Promise.all([api('/status'),api('/documents/query?'+new URLSearchParams(clinicalContext()))]),now=status.now;
 const files=attachments.documents.filter(d=>!d.plan_version_id||d.plan_version_id===version.id).flatMap(d=>d.versions.filter(v=>v.status==='原件已确认'&&v.available));
 const fileFields=files.length?'<fieldset><legend>关联已确认原件（按实际依据选择，可不选）</legend>'+files.map(f=>`<label><input type="checkbox" name="decisionFile" value="${f.id}">${esc(f.original_name)} · 第${f.version_no}版</label>`).join('')+'</fieldset>':'<p>本次就诊尚无可关联的已确认原件。文书上传并由牙医确认后可选。</p>';
 openEditor('记录患者对明确项目的决定',`<p>${esc(plan.goal)} · 第${version.version_no}版</p><fieldset><legend>请明确选择本次决定涉及的项目</legend>${version.items.map(i=>`<label><input type="checkbox" name="decisionItem" value="${i.id}">${esc(i.item_description)} · ${esc(i.tooth_code||'未指定牙位')}</label>`).join('')}</fieldset>${select('decision','患者的实际决定','<option value="">请选择实际决定</option>'+options(['同意','暂缓','拒绝','撤回'].map(x=>({id:x,name:x})),x=>x.name))}${input('decidedAt','实际决定时间',localDateTimeSeconds(now),'datetime-local')}${clinicalText('explanationBasis','实际告知内容及患者决定依据')}${clinicalText('scopeNote','本次决定范围说明')}${fileFields}${clinicalConfirm('已向患者说明相关项目及费用，并按患者真实决定记录')}`,async value=>{
  const itemIds=[...document.querySelectorAll('#editor [name=decisionItem]:checked')].map(x=>Number(x.value));
  if(!itemIds.length)throw new Error('请明确选择至少一个项目');
  await command('/treatment-plans/plan',{action:'decide',...clinicalContext(),versionId:version.id,expectedRevision:version.revision,decision:value.decision,itemIds,documentVersionIds:[...document.querySelectorAll('#editor [name=decisionFile]:checked')].map(x=>Number(x.value)),wholeScope:false,decidedAt:stamp(value.decidedAt),explanationBasis:value.explanationBasis,scopeNote:value.scopeNote},'clinical-decision');
 });
}
function clinicalPlanAction(plan,version,action){
 const labels={publish:'向患者说明方案',resubmit:'重新说明方案',stop:'停止后续执行',completeVersion:'核对本版已完成',close:'结束治疗方案'};
 openEditor(labels[action],`<p>${esc(plan.goal)} · 第${version.version_no}版</p>${action==='close'?select('outcome','结束结果',options([{id:'complete',name:'整体完成'},{id:'terminate',name:'终止后续'}],x=>x.name)):''}${['stop','close'].includes(action)?clinicalText('reason','实际处理依据'):''}${clinicalConfirm('已核对当前方案范围及真实办理结果')}`,async value=>{
  await command('/treatment-plans/plan',{action,...clinicalContext(),versionId:version.id,expectedRevision:version.revision,expectedPlanRevision:plan.revision,reason:value.reason,...(action==='close'?{outcome:value.outcome}:{})},'clinical-plan-action');
 });
}
async function clinicalExecution(original=null){
 const d=clinicalView.detail,now=(await api('/status')).now,services=clinicalView.catalog.services.filter(s=>s.is_active);
 if(!services.length)throw new Error('尚未建立收费项目，请由收费人员维护项目、负责人核对价目后再登记');
 const scope=[];
 for(const p of clinicalView.treatment.plans)if(p.status==='进行中')for(const v of p.versions)if(v.status==='已确认'&&v.id===p.versions.at(-1).id)for(const i of v.items)if(i.latestDecision?.decision==='同意'&&i.effectiveQuantity<i.planned_quantity)scope.push(i);
 const choices='<option value="">请选择实际执行依据</option><option value="independent">本次独立检查或咨询</option>'+options(scope,i=>`${i.item_description} / ${i.tooth_code||'未指定牙位'} / 剩余${i.planned_quantity-i.effectiveQuantity}`);
 openEditor(original?'追加实际执行更正':'登记实际完成项目',`${select('serviceId','实际收费项目',options(services,s=>s.name,original?.service_id))}${original?'<p>更正保留原执行与原应收，费用变动另由收费岗位核对。</p>':select('planItemId','实际执行依据',choices)+clinicalText('independentBasis','独立检查咨询的实际依据（关联方案时可留空）','',false)}<div class="form-grid">${input('toothCode','牙位（可留空）',original?.tooth_code||'','text',false)}${input('surfaceCode','牙面（可留空）',original?.surface_code||'','text',false)}${input('quantity','实际完成数量',original?.completed_quantity||1,'number')}${input('completedAt','实际完成时间',localDateTimeSeconds(original?.completed_at||now),'datetime-local')}</div>${clinicalText('procedureNote','实际操作经过',original?.procedure_note||'')}${original?clinicalText('reason','更正依据'):''}${clinicalConfirm('已按本次实际发生的项目、数量和时间核对记录')}`,async value=>{
  const independent=value.planItemId==='independent';
  await command('/executions/execute',{...clinicalContext(),expectedVisitRevision:d.visit.revision,serviceId:Number(value.serviceId),quantity:Number(value.quantity),toothCode:value.toothCode||null,surfaceCode:value.surfaceCode||null,completedAt:stamp(value.completedAt),procedureNote:value.procedureNote,
   ...(original?{originalExecutionId:original.id,planItemId:original.plan_item_id,reason:value.reason}:{planItemId:independent?null:Number(value.planItemId),independentCheck:independent,independentBasis:value.independentBasis})},'clinical-execution');
 });
 const chooser=$('#editor [name=planItemId]');if(chooser)chooser.onchange=()=>{const item=scope.find(i=>i.id===Number(chooser.value));if(item){$('#editor [name=toothCode]').value=item.tooth_code||'';$('#editor [name=surfaceCode]').value=item.surface_code||'';}};
}
async function renderClinical(version){
 if(state.role!=='dentist'){resetClinical();throw new Error('当前岗位不能进入牙医工作台');}
 if(!clinicalView.selected){
  const data=await api('/clinical-worklist/query?date='+state.date);if(version!==renderVersion)return;
  $('#page-actions').innerHTML='';filterDate();
  $('#content').innerHTML=data.items.length?table(['患者身份','实际到诊','就诊 / 病历状态','办理'],data.items.map(v=>`<tr><td>${esc(v.patient_name)}<small>${esc(v.patient_no)}</small></td><td>${time(v.arrived_at)}<small>${esc(v.record_no)}</small></td><td>${esc(v.status)}<small>${esc(v.record_status)}</small></td><td><button class="primary" data-open-clinical="${v.id}">${v.status==='候诊'?'核对并接诊':'查看本次病历'}</button></td></tr>`)):empty('该日期没有分配给当前牙医的到诊记录。前台完成实际到诊登记后，患者会进入接诊名单。');
  document.querySelectorAll('[data-open-clinical]').forEach(b=>b.onclick=()=>{const row=data.items.find(v=>v.id===Number(b.dataset.openClinical));clinicalView.selected={visitId:row.id,patientId:row.patient_id};clinicalAction(render);});
  $('#refresh').onclick=()=>{state.date=$('#filter-date').value;clinicalAction(render);};
  if($('#tomorrow'))$('#tomorrow').onclick=()=>{state.date=new Date(Date.parse(state.status.businessDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);clinicalAction(render);};
  return;
 }
 const q=new URLSearchParams(clinicalView.selected),[d,t,catalog]=await Promise.all([api('/patient-clinical-data/query?'+q),api('/treatment-plans/query?'+q),api('/services/options')]);
 if(version!==renderVersion)return;clinicalView.detail=d;clinicalView.treatment=t;clinicalView.catalog=catalog;
 const active=d.visit.status==='接诊中',signed=d.record.status==='已签署',latest=d.healthVersions[0];
 $('#filters').innerHTML='';$('#page-actions').innerHTML='<button id="back-clinical">返回接诊名单</button>';
 const actionButtons=d.visit.status==='候诊'?'<button class="primary" id="start-clinical">核对并开始接诊</button>':
  `${!signed&&active?'<button id="edit-health">记录健康资料</button>'+ (latest?'<button id="review-health">复核已有资料</button>':'')+'<button id="edit-record">编辑病历草稿</button><button class="primary" id="sign-record">核对并签署</button>':''}${signed?'<button id="record-addendum">追加独立补充</button>':''}${d.occupancy&&d.visit.started_at?'<button id="end-physical">确认实际操作结束</button>':''}`;
 let html=`<section class="clinical-summary"><h2>${esc(d.patient.name)} <small>${esc(d.patient.record_no)}</small></h2><p>就诊 ${esc(d.visit.record_no)} · ${esc(d.visit.status)} · 病历${esc(d.record.status)}</p><p>实际资源：${d.physicalEnd?'已结束操作并交接清洁':d.visit.started_at?'实际使用未交接结束':'尚未开始实际使用'}</p><div class="actions"><button id="clinical-documents">影像与诊疗文书</button><button id="clinical-prescriptions">处方与用药指导</button>${actionButtons}${d.visit.started_at?'<button id="create-followup">提出复诊或随访要求</button>':''}</div></section>`;
 html+='<h2 class="subheading">健康资料与当次复核</h2>'+(latest?table(['类别','核实情况','实际内容及来源'],latest.items.map(i=>`<tr><td>${esc(i.category)}</td><td>${esc(i.certainty)}</td><td class="clinical-note">${esc(i.content)}<small>${esc(i.source)}</small></td></tr>`)):empty('尚未记录健康资料，开始接诊后逐项核实。'))+`<p>当次复核：${d.reviews.length?esc(d.reviews.at(-1).conclusion)+' · '+esc(localDateTimeSeconds(d.reviews.at(-1).reviewed_at)):'尚未完成'}</p>`;
 html+='<h2 class="subheading">本次病历</h2><div class="clinical-note">'+[['主诉',d.record.chief_complaint],['诊断',d.record.diagnosis],['处理意见',d.record.treatment_advice]].map(([n,v])=>`<strong>${n}</strong><p>${esc(v||'未填写')}</p>`).join('')+'</div>';
 if(d.findings.length)html+=table(['牙位 / 牙面','检查所见'],d.findings.map(f=>`<tr><td>${esc(f.tooth_code||'未指定')} / ${esc(f.surface_code||'未指定')}</td><td class="clinical-note">${esc(f.finding_text)}</td></tr>`));
 if(signed)html+=`<p>签署时间：${esc(localDateTimeSeconds(d.record.signed_at))}；正文校验：${d.signedIntegrity?'通过':'未通过，请核对记录'}。</p>`;
 for(const a of d.addenda)html+=`<div class="clinical-note"><strong>独立补充 · ${esc(localDateTimeSeconds(a.added_at))}</strong><p>${esc(a.content)}</p><p>依据：${esc(a.reason)}</p></div>`;
 html+='<h2 class="subheading">治疗方案与患者决定</h2>'+(!signed&&active?'<button id="create-plan">建立治疗方案</button>':'');
 for(const plan of t.plans){html+=`<section class="clinical-plan"><h3>${esc(plan.goal)} · ${esc(plan.status)}</h3>`;for(const v of plan.versions){const isLatest=v.id===plan.versions.at(-1).id;html+=`<details ${isLatest?'open':''}><summary>第${v.version_no}版 · ${esc(v.status)}</summary><p>${esc(v.diagnostic_basis)}</p><p>${esc(v.planned_schedule)}</p>`+table(['项目 / 牙位','计划 / 已完成','预计费用','患者当前决定'],v.items.map(i=>`<tr><td>${esc(i.item_description)}<small>${esc(i.tooth_code||'未指定牙位')}</small></td><td>${i.planned_quantity} / ${i.effectiveQuantity}</td><td>${clinicalMoney(i.estimated_cents)}</td><td>${esc(i.latestDecision?.decision||'未记录')}<small>${esc(i.latestDecision?.scope_note||'')}</small></td></tr>`));
   if(plan.status==='进行中'&&isLatest){html+='<div class="actions">';if(v.status==='草稿')html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="edit">编辑草稿</button><button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="publish">说明方案</button>`;if(v.status==='暂缓')html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="resubmit">重新说明</button>`;if(['待确认','已确认'].includes(v.status))html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="decide">记录患者决定</button>`;if(v.status!=='草稿')html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="revise">形成新版本</button>`;if(v.status==='已确认')html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="completeVersion">核对本版完成</button><button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="stop">停止后续执行</button>`;html+=`<button data-plan="${plan.id}" data-version="${v.id}" data-plan-action="close">结束方案</button></div>`;}
   if(['已确认','本版执行完成'].includes(v.status)&&plan.status!=='已终止')html+=`<button data-plan-followup="${v.id}">由本版方案提出诊后要求</button>`;
   if(v.decisions.length)html+='<details><summary>患者决定历史</summary>'+v.decisions.map(x=>`<p>${esc(x.decision)} · ${esc(localDateTimeSeconds(x.decided_at))} · ${esc(x.explanation_basis)} · ${esc(x.scope_note)}</p>`).join('')+'</details>';html+='</details>';}
  html+='</section>';
 }
 if(!t.plans.length)html+=empty('尚无治疗方案。需要治疗时先说明方案并记录患者决定；独立检查咨询单独记实际依据。');
 html+='<h2 class="subheading">实际完成项目与费用来源</h2>'+(active&&!signed?'<button id="create-execution">登记实际完成项目</button>':'')+(t.executions.length?table(['实际项目','数量 / 实际时间','经过与计费','记录'],t.executions.map(e=>`<tr><td>${esc(e.service_name)}<small>${esc(e.tooth_code||'未指定牙位')}</small></td><td>${e.completed_quantity}<small>${esc(localDateTimeSeconds(e.completed_at))}</small></td><td class="clinical-note">${esc(e.procedure_note)}<small>${esc(e.pricing_status||'原记录保留，费用另行核对')}</small></td><td>${e.is_effective?`<button data-correct-execution="${e.id}">追加更正</button>`:'已由后续记录更正'}</td></tr>`)):empty('尚未登记实际完成项目。方案预计费用不形成实际收费。'));
 $('#content').innerHTML=html;
 const bind=(selector,fn)=>{const el=$(selector);if(el)el.onclick=()=>clinicalAction(fn);};
 bind('#clinical-prescriptions',()=>openPrescriptions(clinicalContext()));bind('#clinical-documents',()=>openDocuments(clinicalContext()));bind('#back-clinical',()=>{resetClinical();return render();});bind('#start-clinical',clinicalStart);bind('#edit-health',()=>clinicalHealth());bind('#review-health',()=>clinicalHealth(true));bind('#edit-record',clinicalRecord);bind('#sign-record',()=>clinicalSign());bind('#record-addendum',()=>clinicalSign(true));bind('#create-plan',()=>clinicalPlanEditor());bind('#create-execution',()=>clinicalExecution());
 bind('#end-physical',()=>finishEditor({...d.occupancy,visit_id:d.visit.id,visit_revision:d.visit.revision,visit_no:d.visit.record_no}));
 bind('#create-followup',()=>followupEditor(null,{patientId:d.patient.id,sourceVisitId:d.visit.id}));
 document.querySelectorAll('[data-plan-followup]').forEach(b=>b.onclick=()=>clinicalAction(()=>followupEditor(null,{patientId:d.patient.id,sourcePlanVersionId:Number(b.dataset.planFollowup)})));
 document.querySelectorAll('[data-plan-action]').forEach(b=>b.onclick=()=>clinicalAction(()=>{const p=t.plans.find(p=>p.id===Number(b.dataset.plan)),v=p.versions.find(v=>v.id===Number(b.dataset.version)),action=b.dataset.planAction;return action==='edit'||action==='revise'?clinicalPlanEditor(p,v,action==='revise'):action==='decide'?clinicalDecision(p,v):clinicalPlanAction(p,v,action);}));
 document.querySelectorAll('[data-correct-execution]').forEach(b=>b.onclick=()=>clinicalAction(()=>clinicalExecution(t.executions.find(e=>e.id===Number(b.dataset.correctExecution)))));
}
