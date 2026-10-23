'use strict';
const followupView={page:1,status:'',overdue:false};
function resetFollowups(){Object.assign(followupView,{page:1,status:'',overdue:false});}
async function followupEditor(existing=null,source=null){
 const [opts,current]=await Promise.all([api('/followups/options'),api('/status')]),staff=opts.staff.filter(s=>s.roles.includes('frontdesk'));
 if(!staff.length)throw new Error('没有具备当前有效资格的前台责任人，请先核对岗位安排');
 openEditor(existing?'调整诊后要求':'提出复诊或随访要求',`<p>来源${existing?.source_visit_id||source?.sourceVisitId?'就诊 #'+(existing?.source_visit_id||source.sourceVisitId):'方案版本 #'+(existing?.source_plan_version_id||source.sourcePlanVersionId)}。来源签署或确认后才进入前台联系。</p>${select('type','实际诊后要求类型','<option value="">请选择类型</option>'+options(['复诊','随访'].map(x=>({id:x,name:x})),x=>x.name,existing?.followup_type))}${clinicalText('purpose','诊后目标与需告知患者的事项',existing?.purpose||'')}${input('targetStart','目标日期开始',existing?.target_start||current.businessDate,'date')}${input('targetEnd','目标日期截止',existing?.target_end||current.businessDate,'date')}${select('requiresAssessment','是否需要牙医临床评估','<option value="">请明确评估要求</option>'+options([{id:'yes',name:'需要牙医评估'},{id:'no',name:'仅需前台确认联系目标'}],x=>x.name,existing?(existing.requires_assessment?'yes':'no'):''))}${select('responsibleFrontdeskId','联系责任人','<option value="">请选择在岗前台</option>'+options(staff,s=>s.name,existing?.responsible_frontdesk_id))}${input('nextContactDate','下一次联系日期',existing?.next_contact_date||current.businessDate,'date')}${existing?clinicalText('reason','调整依据'):''}${clinicalConfirm('已核对来源、患者、诊后目标和联系责任')}`,async value=>{
  await command('/followup-requirements/propose',{action:existing?'update':'create',...(existing?{patientId:existing.patient_id,followupId:existing.id,expectedRevision:existing.revision}:source),type:value.type,purpose:value.purpose,targetStart:value.targetStart,targetEnd:value.targetEnd,requiresAssessment:value.requiresAssessment==='yes',responsibleFrontdeskId:Number(value.responsibleFrontdeskId),nextContactDate:value.nextContactDate,reason:value.reason},'followup-propose');
 });
}
function followupProposeAction(f,action){
 openEditor(action==='publish'?'核对并发布诊后要求':'撤销诊后要求',`<p>${esc(f.patient.name)} · ${esc(f.patient.recordNo)}<br>${esc(f.purpose)}</p>${action==='cancel'?clinicalText('reason','牙医撤销依据'):''}${clinicalConfirm('已核对来源及当前办理情况，确认本次处理')}`,async value=>{
  await command('/followup-requirements/propose',{action,patientId:f.patient_id,followupId:f.id,expectedRevision:f.revision,reason:value.reason},'followup-state');
 });
}
async function followupContact(f){
 const [context,current]=await Promise.all([api('/followups/context?followupId='+f.id),api('/status')]);
 const steps=[{id:'continue',name:'继续联系并保留下一次安排'},{id:'arrange',name:'关联已实际建立的复诊预约'},{id:'assess',name:'交牙医完成实际评估'},...(!f.requires_assessment?[{id:'complete',name:'已达成无需临床评估的联系目标'}]:[])];
 openEditor('记录实际联系及后续安排',`<p>${esc(f.patient.name)} · ${esc(f.patient.recordNo)}<br>${esc(f.patient.phone||f.patient.contactUnavailableReason||'尚无有效联系电话')} · ${esc(f.patient.phoneOwner||'')}<br>${esc(f.purpose)}</p>${input('method','实际联系方式')}${input('contactedAt','实际联系时间',localDateTimeSeconds(current.now),'datetime-local')}${select('result','真实联系结果','<option value="">请选择实际结果</option>'+options(['已联系','未联系上','拒绝','待跟进'].map(x=>({id:x,name:x})),x=>x.name))}${clinicalText('note','实际联系内容及患者回复')}${select('nextStep','本次后续办理','<option value="">请选择后续安排</option>'+options(steps,s=>s.name))}${select('appointmentId','已建立的有效复诊预约','<option value="none">不新增预约关联，保留已有有效关联</option>'+options(context.appointments,a=>`${localDateTimeSeconds(a.planned_start)} / ${a.record_no} / ${a.status}`))}${context.total>100?'<p>候选超过100项，请先核对目标日期范围。</p>':''}${input('nextContactDate','继续跟进时的下次联系日期',current.businessDate,'date',false)}${clinicalText('completionBasis','仅完成联系目标时填写完成依据','',false)}<label><input type="checkbox" name="goalAchieved">已核实无需临床评估的联系目标确已达成</label>${clinicalConfirm('本次仅记录已经发生的联系；临床结论交由牙医评估')}`,async value=>{
  const appointment=context.appointments.find(a=>a.id===Number(value.appointmentId));
  await command('/followup-contacts/contact',{action:'record',patientId:f.patient_id,followupId:f.id,expectedRevision:f.revision,method:value.method,contactedAt:stamp(value.contactedAt),result:value.result,note:value.note,nextStep:value.nextStep,appointmentId:appointment?.id||null,expectedAppointmentRevision:appointment?.revision,nextContactDate:value.nextContactDate||null,completionBasis:value.completionBasis,goalAchieved:value.goalAchieved==='on'},'followup-contact');
 });
}
async function followupTransfer(f){
 const opts=await api('/followups/options'),staff=opts.staff.filter(s=>s.roles.includes('frontdesk')&&s.id!==f.responsible_frontdesk_id);
 if(!staff.length)throw new Error('没有其他具备当前有效前台资格的责任人可接收');
 openEditor('转交诊后联系责任',`<p>${esc(f.patient.name)} · ${esc(f.purpose)}</p>${select('responsibleFrontdeskId','接收责任人','<option value="">请选择接收人</option>'+options(staff,s=>s.name))}${clinicalText('reason','实际转交及交接依据')}${clinicalConfirm('已核对接收人和未完成事项，确认责任交接')}`,async value=>{
  await command('/followup-contacts/contact',{action:'transfer',patientId:f.patient_id,followupId:f.id,expectedRevision:f.revision,responsibleFrontdeskId:Number(value.responsibleFrontdeskId),reason:value.reason},'followup-transfer');
 });
}
async function followupAssess(f){
 const [context,opts,current]=await Promise.all([api('/followups/context?followupId='+f.id),api('/followups/options'),api('/status')]);
 openEditor('记录实际诊后评估',`<p>${esc(f.patient.name)} · ${esc(f.patient.recordNo)}<br>${esc(f.purpose)}</p>${select('method','本次实际评估方式','<option value="">请选择实际方式</option>'+options(['到诊检查','远程沟通'].map(x=>({id:x,name:x})),x=>x.name))}${select('visitId','到诊检查对应的实际复诊','<option value="none">远程沟通不关联就诊</option>'+options(context.visits,v=>`${v.record_no} / ${localDateTimeSeconds(v.started_at)} / ${v.status}`))}${input('assessedAt','实际评估时间',localDateTimeSeconds(current.now),'datetime-local')}${clinicalText('result','实际取得的信息、临床评估及信息边界')}${select('advice','实际处理意见','<option value="">请选择处理意见</option>'+options(['完成','继续跟进','另行处置'].map(x=>({id:x,name:x})),x=>x.name))}${input('nextDate','继续或另行处置的下次日期',current.businessDate,'date',false)}${select('responsibleStaffId','继续或另行处置的责任人','<option value="none">本次完成，不另派后续责任</option>'+options(opts.staff,s=>s.name+' / '+s.roles.map(r=>r==='dentist'?'牙医':'前台').join('、')))}${select('responsibleFrontdeskId','后续联系前台',options(opts.staff.filter(s=>s.roles.includes('frontdesk')),s=>s.name,f.responsible_frontdesk_id))}<label><input type="checkbox" name="assessmentCompleted">已核实本次实际评估足以完成原诊后要求</label>${clinicalConfirm('已按实际评估记录；远程沟通不代替未进行的到诊检查')}`,async value=>{
  const actual=value.method==='到诊检查';if(actual&&value.visitId==='none')throw new Error('到诊检查须选择已经实际开始的复诊就诊');if(!actual&&value.visitId!=='none')throw new Error('远程沟通不应关联到诊记录');
  await command('/followup-assessments/assess',{patientId:f.patient_id,followupId:f.id,expectedRevision:f.revision,method:value.method,visitId:actual?Number(value.visitId):null,assessedAt:stamp(value.assessedAt),result:value.result,advice:value.advice,nextDate:value.nextDate||null,responsibleStaffId:value.responsibleStaffId==='none'?null:Number(value.responsibleStaffId),responsibleFrontdeskId:Number(value.responsibleFrontdeskId),assessmentCompleted:value.assessmentCompleted==='on'},'followup-assess');
 });
 $('#editor [name=method]').onchange=()=>{if($('#editor [name=method]').value==='远程沟通')$('#editor [name=visitId]').value='none';};
}
async function followupBooking(f){
 state.date=f.target_start<state.status.businessDate?state.status.businessDate:f.target_start;
 await bookingEditor();if(!$('#editor').open)return;
 const patient=$('#editor [name=patientId]');patient.innerHTML=options([{id:f.patient_id,name:f.patient.name,record_no:f.patient.recordNo,phone:f.patient.phone}],p=>`${p.name} / ${p.phone||'未提供电话'} / ${p.record_no}`,f.patient_id);
 $('#editor .context').insertAdjacentHTML('beforeend',`<p>复诊目标日期：${esc(f.target_start)}至${esc(f.target_end)}。创建预约后，请返回记录实际联系并关联此预约。</p>`);
 $('#search-booking-patient').hidden=true;$('#editor [name=patientSearch]').closest('label').hidden=true;
}
async function renderFollowups(version){
 if(!['frontdesk','dentist'].includes(state.role)){resetFollowups();throw new Error('请使用前台或牙医岗位办理复诊随访');}
 const clinical=state.role==='dentist',params=new URLSearchParams({page:followupView.page,overdueOnly:followupView.overdue});if(followupView.status)params.set('status',followupView.status);
 const data=await api('/followup-requirements/query?'+params);if(version!==renderVersion)return;
 $('#page-actions').innerHTML='';$('#filters').innerHTML=`<label>办理状态<select id="followup-status"><option value="">全部可见状态</option>${options((clinical?['待发布','待联系','待到诊或评估','已完成','已撤销']:['待联系','待到诊或评估','已完成','已撤销']).map(x=>({id:x,name:x})),x=>x.name,followupView.status)}</select></label><label><input id="followup-overdue" type="checkbox" ${followupView.overdue?'checked':''}>仅看逾期未完成</label><button id="refresh-followups">查询</button>`;
 let html=clinical?'<p>从牙医接诊的来源就诊或明确治疗方案版本提出诊后要求，再在本页跟进。</p>':'<p>记录已经发生的联系及患者回复。需要复诊时先创建真实预约，再关联联系记录；临床评估由牙医办理。</p>';
 for(const f of data.items){const open=['待联系','待到诊或评估'].includes(f.status);html+=`<section class="clinical-plan"><h2>${esc(f.patient.name)} <small>${esc(f.patient.recordNo)}</small></h2><p>${esc(f.record_no)} · ${esc(f.followup_type)} · ${esc(f.status)}</p><p>${esc(f.purpose)}</p><p>目标日期 ${esc(f.target_start)}—${esc(f.target_end)} · 下次联系 ${esc(f.next_contact_date||'按当前评估安排')} · ${f.requires_assessment?'须牙医评估':'无需临床评估的联系目标'}</p>${f.sourceNeedsReview?'<p class="notice error">来源状态变化，请牙医核对原诊后要求。</p>':''}${!f.responsibleAvailable?'<p class="notice error">原联系责任人的资格已变化，请牙医核对并重新安排责任。</p>':''}<div class="actions">`;
  if(clinical&&!['已完成','已撤销'].includes(f.status))html+=`<button data-followup-edit="${f.id}">调整要求与责任</button>`;
  if(clinical&&f.status==='待发布')html+=`<button data-followup-publish="${f.id}">核对来源并发布</button>`;
  if(clinical&&open)html+=`<button data-followup-assess="${f.id}">记录实际评估</button><button data-followup-cancel="${f.id}">有据撤销</button>`;
  if(!clinical&&open)html+=`<button data-followup-contact="${f.id}" class="primary">记录实际联系</button><button data-followup-book="${f.id}">建立复诊预约</button><button data-followup-transfer="${f.id}">转交联系责任</button>`;
  html+='</div>';html+=workflowHistory(f.history,[['purpose','目的'],['status','状态'],['responsible_frontdesk_id','联系责任人编号'],['next_contact_date','下次联系'],['target_start','目标开始'],['target_end','目标截止'],['closure_basis','关闭依据']],'诊后要求变更历史');
  if(f.contacts.length)html+='<h3>实际联系记录</h3>'+table(['时间 / 方式','结果及实际内容','关联预约'],f.contacts.map(c=>`<tr><td>${esc(localDateTimeSeconds(c.contacted_at))}<small>${esc(c.method)}</small></td><td>${esc(c.result)}<small>${esc(c.note)}</small></td><td>${c.appointment_id?'预约 #'+c.appointment_id+' / '+esc(c.appointment_status):'未关联预约'}<small>${c.planned_start?esc(localDateTimeSeconds(c.planned_start)):''}${c.actual_visit_id?' / 已到诊 #'+c.actual_visit_id:''}</small></td></tr>`));
  if(f.assessments.length)html+='<h3>牙医评估记录</h3>'+table(clinical?['实际时间 / 方式','评估及信息边界','处理意见']:['评估时间 / 方式','后续办理'],f.assessments.map(a=>clinical?`<tr><td>${esc(localDateTimeSeconds(a.assessed_at))}<small>${esc(a.method)}</small></td><td class="clinical-note">${esc(a.result)}</td><td>${esc(a.advice)}<small>${esc(a.next_date||'')}</small></td></tr>`:`<tr><td>${esc(localDateTimeSeconds(a.assessedAt))}<small>${esc(a.method)}</small></td><td>${esc(a.advice)}<small>${esc(a.nextDate||'')}</small></td></tr>`));
  if(f.closure_basis)html+=`<p>关闭依据：${esc(f.closure_basis)}</p>`;html+='</section>';
 }
 if(!data.items.length)html+=empty('当前没有符合条件且属于本岗位责任范围的诊后事项。');
 if(data.total>data.pageSize)html+=`<p>第${data.page}页 / 共${Math.ceil(data.total/data.pageSize)}页 ${data.page>1?'<button id="followup-prev">上一页</button>':''}${data.page*data.pageSize<data.total?'<button id="followup-next">下一页</button>':''}</p>`;
 $('#content').innerHTML=html;$('#refresh-followups').onclick=()=>{followupView.status=$('#followup-status').value;followupView.overdue=$('#followup-overdue').checked;followupView.page=1;clinicalAction(render);};
 for(const [key,fn]of [['edit',followupEditor],['publish',f=>followupProposeAction(f,'publish')],['cancel',f=>followupProposeAction(f,'cancel')],['assess',followupAssess],['contact',followupContact],['transfer',followupTransfer],['book',followupBooking]])document.querySelectorAll(`[data-followup-${key}]`).forEach(b=>b.onclick=()=>clinicalAction(()=>fn(data.items.find(f=>f.id===Number(b.dataset['followup'+key[0].toUpperCase()+key.slice(1)])))));
 if($('#followup-prev'))$('#followup-prev').onclick=()=>{followupView.page--;clinicalAction(render);};if($('#followup-next'))$('#followup-next').onclick=()=>{followupView.page++;clinicalAction(render);};
}
