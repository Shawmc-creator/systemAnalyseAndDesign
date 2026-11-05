'use strict';
const workspaceView={patientId:null,visitId:null,tab:'summary',data:null,search:'',dentition:'permanent',tooth:null};
const workspaceLabels={summary:'摘要',information:'基本资料',clinical:'临床与牙位',plans:'治疗方案',quotes:'独立报价',documents:'影像文书',fees:'费用',prescriptions:'处方',followups:'复诊随访',appointments:'预约到诊',finance:'账单收款',history:'办理历史'};
function resetWorkspace(){Object.assign(workspaceView,{patientId:null,visitId:null,tab:'summary',data:null,search:'',dentition:'permanent',tooth:null});}
function workspaceMatches(context){return state.page==='workspace'&&workspaceView.patientId===context.patientId&&workspaceView.visitId===context.visitId;}
function openWorkspace(patientId,visitId=null,tab='summary',focus={}){
 if(workspaceView.patientId!==patientId){resetClinical();resetDocuments();resetPrescriptions();resetFinance();resetFollowups();resetQuotes();workspaceView.tooth=null;}
 if(focus.quoteId)quoteView.selected=focus.quoteId;
 workspaceView.patientId=patientId;workspaceView.visitId=visitId;workspaceView.tab=tab;state.page='workspace';return render();
}
function selectWorkspaceTab(tab){workspaceView.tab=tab;return render();}
function workspaceInfo(d){const p=d.patient;return '<section class="clinical-summary"><h2>身份与联系资料</h2>'+table(['资料','已记录内容'],[['患者号',p.record_no],['姓名',p.name],['出生日期',p.birth_date||'未提供'],['联系电话',p.phone?`${p.phone}（${p.phone_owner||'归属未提供'}）`:p.contact_unavailable_reason||'未提供'],['联系偏好',p.contact_preference||'未提供'],...(d.canEditPatient?[['联系地址',p.address||'未提供']]:[])].map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`))+(d.canEditPatient?'<button id="workspace-edit-patient">核对并修改基本资料</button>':'')+'</section>';}
function workspaceHistory(d){return '<h2>历次可见就诊</h2>'+(d.visits.length?table(['到诊 / 就诊号','牙医','实际阶段','办理'],d.visits.map(v=>`<tr><td>${esc(localDateTimeSeconds(v.arrived_at))}<small>${esc(v.record_no)}</small></td><td>${esc(v.dentist_name)}</td><td>${esc(v.status)}${v.record_status?`<small>病历${esc(v.record_status)}</small>`:''}</td><td><button data-workspace-visit="${v.id}">查看本次</button></td></tr>`)):empty('该患者尚无可见的到诊记录。'))+(d.patientChanges.length?'<h2>基本资料变更</h2>'+table(['时间','资料','原内容 / 新内容','依据'],d.patientChanges.map(c=>`<tr><td>${esc(localDateTimeSeconds(c.occurred_at))}</td><td>${esc({name:'姓名',birth_date:'出生日期',phone:'电话',phone_owner:'电话归属',address:'地址',contact_preference:'联系偏好',contact_unavailable_reason:'无法联系原因'}[c.field_name]||c.field_name)}</td><td>${esc(c.old_value||'未提供')} → ${esc(c.new_value||'未提供')}</td><td>${esc(c.reason)}</td></tr>`)):'');}
function workspaceAppointments(d){return '<h2>患者预约及到诊记录</h2>'+(state.role==='frontdesk'?'<button id="workspace-book" class="primary">为此患者预约</button>':'')+(d.appointments.length?table(['日期与时段','牙医 / 诊椅','实际阶段','查看'],d.appointments.map(a=>`<tr><td>${esc(localDateTime(a.planned_start))}—${time(a.planned_end)}<small>${esc(a.reason)}</small></td><td>${esc(a.dentist_name||'历史安排')}<small>${esc(a.chair_name||'历史安排')}</small></td><td>${esc(a.visit_status||a.status)}</td><td>${a.visit_id?`<button data-workspace-visit="${a.visit_id}">查看本次到诊</button>`:'尚未登记到诊'}</td></tr>`)):empty('尚无预约记录。'))+(d.appointmentCount>d.appointments.length?'<p>显示最近100条预约，完整安排请按日期在预约日历中查询。</p>':'');}
async function workspaceSummary(d,version){
 const v=d.selectedVisit;let html='<div class="workspace-summary-grid"><section class="clinical-summary"><h2>当前就诊</h2>'+(v?`<p>${esc(v.status)} · ${esc(v.dentist_name)}</p><p>实际到诊 ${esc(localDateTimeSeconds(v.arrived_at))}</p><p>${v.started_at?'实际开始 '+esc(localDateTimeSeconds(v.started_at)):'尚未开始实际接诊'}</p><p>${v.ended_at?'实际结束 '+esc(localDateTimeSeconds(v.ended_at)):'实际结束尚未确认'}</p>`:'<p>尚未登记实际到诊。</p>')+'</section><section class="clinical-summary"><h2>后续预约</h2>';
 const upcoming=d.appointments.filter(a=>a.status==='已预约'&&a.planned_end>=d.now).sort((a,b)=>a.planned_start.localeCompare(b.planned_start));html+=upcoming.length?upcoming.slice(0,3).map(a=>`<p>${esc(localDateTime(a.planned_start))}—${time(a.planned_end)}<br>${esc(a.dentist_name)} · ${esc(a.chair_name)}</p>`).join(''):'<p>尚无有效的后续预约。</p>';html+='</section></div>';
 if(state.role==='dentist'&&v){const c=await api('/patient-clinical-data/query?'+new URLSearchParams({patientId:d.patient.id,visitId:v.id}));if(version!==renderVersion)return;
  const visitHealth=clinicalVisitHealth(c),health=visitHealth.latest;html+='<section class="clinical-summary"><h2>本次临床摘要</h2><p>病历'+esc(c.record.status)+'；'+(visitHealth.signed?'签署所据':'本次')+'健康复核：'+esc(visitHealth.review?.conclusion||(visitHealth.signed?'无法找到，请核对原记录':'尚未完成'))+'</p><p>主诉：'+esc(c.record.chief_complaint||'未填写')+'</p><p>诊断：'+esc(c.record.diagnosis||'未填写')+'</p><h3>患者最新过敏及用药资料</h3>'+(health?'<p>最新资料不代表已在本次就诊复核；当次依据请查看临床与牙位。</p>'+health.items.filter(i=>['过敏','用药'].includes(i.category)).map(i=>`<p>${esc(i.category)} · ${esc(i.certainty)}：${esc(i.content)}<small>${esc(i.source)}</small></p>`).join(''):empty('健康资料尚未核实，不能按“无过敏”或“未用药”处理。'))+'</section>';
 }
 html+='<div class="actions">'+d.tabs.filter(t=>!['summary','information','history'].includes(t)).map(t=>`<button data-workspace-tab="${t}">${esc(workspaceLabels[t])}</button>`).join('')+'</div>';$('#content').innerHTML=html;
}
function toothEntries(c,t){return [...c.findings.map(f=>({kind:'检查所见',id:f.id,tooth:f.tooth_code,surface:f.surface_code,text:f.finding_text,source:'本次病历 '+c.record.record_no})),...t.plans.flatMap(p=>{const v=p.versions.at(-1);return v?v.items.map(i=>({kind:'治疗方案',id:i.id,tooth:i.tooth_code,surface:i.surface_code,text:i.item_description,source:'方案 #'+p.id+' / V'+v.version_no+' / '+v.status})):[];}),...t.executions.map(e=>({kind:'实际执行',id:e.id,tooth:e.tooth_code,surface:e.surface_code,text:e.service_name+' / '+e.completed_quantity+(e.billing_unit||'（单位未提供）'),source:localDateTimeSeconds(e.completed_at)+' / '+(e.is_effective?'当前有效':'已由后续更正，原事实保留')}))];}
function renderToothChart(target,c,t){
 const entries=toothEntries(c,t),primary=workspaceView.dentition==='primary',rows=primary?[[55,54,53,52,51,61,62,63,64,65],[85,84,83,82,81,71,72,73,74,75]]:[[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]];
 target.innerHTML=`<section class="clinical-plan tooth-panel"><div class="tooth-toolbar"><h2>牙位与来源明细</h2><div class="actions"><button data-dentition="permanent" aria-pressed="${!primary}">恒牙</button><button data-dentition="primary" aria-pressed="${primary}">乳牙</button><button id="clear-tooth">显示全部明细</button></div></div><p class="muted">按FDI牙位选择查看；“所见、方案、实际”分别引用原记录。选择牙位只筛选显示。</p><div class="tooth-chart" aria-label="${primary?'乳牙':'恒牙'}牙位选择">${rows.map((r,index)=>`<div class="tooth-arch" aria-label="${index?'下颌':'上颌'}">${r.map(n=>{const e=entries.filter(e=>e.tooth===String(n));return `<button data-tooth="${n}" class="tooth ${workspaceView.tooth===String(n)?'selected':''}" aria-pressed="${workspaceView.tooth===String(n)}" aria-label="牙位${n}，所见${e.filter(x=>x.kind==='检查所见').length}，方案${e.filter(x=>x.kind==='治疗方案').length}，实际${e.filter(x=>x.kind==='实际执行').length}"><strong>${n}</strong><span>${['检查所见','治疗方案','实际执行'].map((k,i)=>e.some(x=>x.kind===k)?`<i class="tooth-kind kind-${i}">${['所','案','实'][i]}</i>`:'').join('')||'—'}</span></button>`;}).join('')}</div>`).join('')}</div><h3>${workspaceView.tooth?'牙位 '+esc(workspaceView.tooth):'全部牙位（含未指定牙位）'}</h3><div class="tooth-details"></div></section>`;
 const filtered=workspaceView.tooth?entries.filter(e=>e.tooth===workspaceView.tooth):entries;
 target.querySelector('.tooth-details').innerHTML=filtered.length?table(['记录类型','牙位 / 牙面','原记录内容','来源'],filtered.map(e=>`<tr><td>${esc(e.kind)}</td><td>${esc(e.tooth||'未指定')} / ${esc(e.surface||'未指定')}</td><td>${esc(e.text)}</td><td>${esc(e.source)}</td></tr>`)):empty('当前选择下没有已记录的所见、方案或实际执行。');
 target.querySelectorAll('[data-tooth]').forEach(b=>b.onclick=()=>{workspaceView.tooth=b.dataset.tooth;renderToothChart(target,c,t);});target.querySelectorAll('[data-dentition]').forEach(b=>b.onclick=()=>{workspaceView.dentition=b.dataset.dentition;workspaceView.tooth=null;renderToothChart(target,c,t);});target.querySelector('#clear-tooth').onclick=()=>{workspaceView.tooth=null;renderToothChart(target,c,t);};
}
function mountWorkspace(d){
 const oldContent=document.createElement('div');oldContent.className='workspace-body';while($('#content').firstChild)oldContent.append($('#content').firstChild);
 const header=document.createElement('div');header.className='patient-banner';if(d.selectedVisit)header.dataset.homeRecord='visit:'+d.selectedVisit.id;const v=d.selectedVisit;
 header.innerHTML=`<div class="patient-banner-line"><div><h2>${esc(d.patient.name)}</h2><p>${esc(d.patient.record_no)} · 出生日期 ${esc(d.patient.birth_date||'未提供')} · ${esc(d.patient.phone||d.patient.contact_unavailable_reason||'电话未提供')}</p></div>${d.visits.length?select('workspaceVisit','当前查看的就诊',options(d.visits,x=>localDateTime(x.arrived_at)+' / '+x.dentist_name+' / '+x.status,v?.id)):''}</div><nav class="workspace-tabs" aria-label="患者工作区分区">${d.tabs.map(tab=>`<button data-workspace-tab="${tab}" aria-pressed="${workspaceView.tab===tab}">${esc(workspaceLabels[tab])}</button>`).join('')}</nav>`;
 $('#content').append(header,oldContent);$('#page-actions').insertAdjacentHTML('afterbegin','<button id="workspace-back">返回患者列表</button>');
 $('#workspace-back').onclick=()=>{workspaceView.patientId=null;workspaceView.visitId=null;workspaceView.data=null;return clinicalAction(render);};
 const visitSelect=header.querySelector('[name=workspaceVisit]');if(visitSelect)visitSelect.onchange=()=>{workspaceView.visitId=Number(visitSelect.value);clinicalAction(render);};
 document.querySelectorAll('[data-workspace-tab]').forEach(b=>b.onclick=()=>clinicalAction(()=>selectWorkspaceTab(b.dataset.workspaceTab)));
 document.querySelectorAll('[data-workspace-visit]').forEach(b=>b.onclick=()=>{workspaceView.visitId=Number(b.dataset.workspaceVisit);workspaceView.tab=state.role==='dentist'?'clinical':'summary';clinicalAction(render);});
 if($('#workspace-edit-patient'))$('#workspace-edit-patient').onclick=()=>patientEditor(d.patient);
 if($('#workspace-book'))$('#workspace-book').onclick=()=>clinicalAction(()=>bookingEditor(null,{patient:d.patient}));
 for(const selector of ['#back-clinical','#documents-back','#rx-back','#back-finance'])if($(selector))$(selector).hidden=true;
}
async function renderWorkspace(version){
 $('#page-actions').innerHTML='';$('#filters').innerHTML='';$('#content').innerHTML=empty('正在核对患者及所选就诊…');
 if(!workspaceView.patientId){
  const data=await api('/workspace/candidates?q='+encodeURIComponent(workspaceView.search));if(version!==renderVersion)return;
  $('#page-actions').innerHTML='';$('#filters').innerHTML=`<label>姓名、电话或完整患者号<input id="workspace-search" value="${esc(workspaceView.search)}"></label><button id="workspace-search-button">查找患者</button>`;
  $('#content').innerHTML=data.items.length?table(['患者身份','出生日期 / 联系电话','办理'],data.items.map(p=>`<tr><td>${esc(p.name)}<small>${esc(p.record_no)}</small></td><td>${esc(p.birth_date||'出生日期未提供')}<small>${esc(p.phone||p.contact_unavailable_reason||'未提供电话')}</small></td><td><button data-open-workspace="${p.id}">进入患者工作区</button></td></tr>`)):empty(state.role==='dentist'?'没有符合线索且在本人接诊或明确交接范围内的患者。':'没有符合条件的患者，请核对身份线索。');
  if(data.hasMore)$('#content').insertAdjacentHTML('beforeend','<p>候选较多，请补充姓名、电话或完整患者号缩小范围。</p>');
  $('#workspace-search-button').onclick=()=>{workspaceView.search=$('#workspace-search').value;clinicalAction(render);};$('#workspace-search').onkeydown=e=>{if(e.key==='Enter')$('#workspace-search-button').click();};return;
 }
 $('#content').innerHTML=empty('正在核对患者及所选就诊…');
 const params=new URLSearchParams({patientId:workspaceView.patientId});if(workspaceView.visitId)params.set('visitId',workspaceView.visitId);
 const d=await api('/workspace/query?'+params);if(version!==renderVersion)return;workspaceView.data=d;workspaceView.visitId=d.selectedVisit?.id||null;
 if(!d.tabs.includes(workspaceView.tab))workspaceView.tab='summary';const tab=workspaceView.tab,context={patientId:d.patient.id,visitId:d.selectedVisit?.id};
 $('#filters').innerHTML='';$('#page-actions').innerHTML='';
 if(tab==='summary')await workspaceSummary(d,version);
 else if(tab==='information')$('#content').innerHTML=workspaceInfo(d);
 else if(tab==='history')$('#content').innerHTML=workspaceHistory(d);
 else if(tab==='appointments')$('#content').innerHTML=workspaceAppointments(d);
 else if(['clinical','plans'].includes(tab)){
  clinicalView.selected=context;await renderClinical(version);if(version!==renderVersion)return;
  $('#content').querySelectorAll('[data-clinical-section]').forEach(el=>{el.hidden=el.dataset.clinicalSection!==tab;});
  if(tab==='clinical'){const chart=document.createElement('div');$('#content').prepend(chart);renderToothChart(chart,clinicalView.detail,clinicalView.treatment);}
 }
 else if(tab==='documents'){documentView.selected=context;await renderDocuments(version);}
 else if(tab==='prescriptions'){prescriptionView.selected=context;await renderPrescriptions(version);}
 else if(tab==='quotes')await renderQuotes(version);
 else if(tab==='followups')await renderFollowups(version);
 else if(tab==='finance'){financeView.patientId=d.patient.id;await renderFinance(version);}
 else if(tab==='fees')$('#content').innerHTML='<h2>实际项目核价状态</h2><p>此处展示获准就诊的原实际项目。正式账款、付款及退款由收费岗位核实。</p>'+(d.feeSources.length?table(['实际时间 / 就诊','项目 / 牙位','数量','原记录及核价'],d.feeSources.map(e=>`<tr><td>${esc(localDateTimeSeconds(e.completed_at))}<small>就诊 #${e.visit_id}</small></td><td>${esc(e.service_name)}<small>${esc(e.tooth_code||'未指定牙位')} ${esc(e.surface_code||'')}</small></td><td>${e.completed_quantity}${esc(e.billing_unit||'（单位未提供）')}</td><td>${e.is_effective?'当前有效':'已由后续更正'}<small>${esc(e.pricing_status||'原费用另行核对')}</small></td></tr>`)):empty('尚无可见的实际项目。报价金额不会自动形成实际项目。'));
 if(version!==renderVersion)return;mountWorkspace(d);
}
