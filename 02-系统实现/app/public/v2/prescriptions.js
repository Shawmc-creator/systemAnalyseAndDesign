'use strict';
const prescriptionView={selected:null,data:null};
function resetPrescriptions(){prescriptionView.selected=null;prescriptionView.data=null;}
function openPrescriptions(context){prescriptionView.selected=context;state.page='prescriptions';return render();}
function prescriptionItemRow(item={}){
 const m=prescriptionView.data.drugs.find(d=>d.id===item.material_id);
 return `<fieldset class="rx-item"><legend>处方药品明细</legend>${select('materialId','药品（核对名称及规格）','<option value="">请选择经核实的药品</option>'+options(prescriptionView.data.drugs,d=>d.name+' / '+d.specification+' / '+d.base_unit,m?.id))}${input('quantity','开立数量（所选药品基本单位）',item.quantity_scaled==null?'':quantityText(item.quantity_scaled,{quantity_scale:item.quantity_scale}),'text')}${clinicalText('directions','医师明确的用法、用量及疗程说明',item.directions||'')}<button type="button" class="rx-remove">移除本条草稿明细</button></fieldset>`;
}
function prescriptionEditor(rx=null,route=null){
 route=rx?.collection_route||route||'院外';
 const d=prescriptionView.data;if(!d.drugs.length)throw new Error('尚无已核实启用的处方药品。请在材料目录明确药品分类，并由负责人核对启用');
 openEditor(rx?'修订'+route+'处方草稿':'建立'+route+'处方草稿',`<p>${esc(d.patient.name)} · ${esc(d.patient.record_no)}<br>${esc(d.visit.record_no)}</p>${clinicalText('diagnosis','本次处方诊断',rx?.diagnosis||d.record.diagnosis||'')}${clinicalText('guidanceNote','用药指导及注意事项',rx?.guidance_note||'')}<p>取药路径：${esc(route)}。${route==='院内'?'开立后交药学岗位审方，实际交付后才扣库存并形成费用。':'开方不代表诊所已发药，不形成药品出库或药费。'}</p><div id="rx-items">${(rx?.items||[{}]).map(prescriptionItemRow).join('')}</div><button type="button" id="rx-add-item">增加药品明细</button>${clinicalText('reason','处方建立或修订依据')}`,async value=>{
  const items=[...document.querySelectorAll('#rx-items .rx-item')].map(el=>{
   const m=d.drugs.find(m=>m.id===Number(el.querySelector('[name=materialId]').value));if(!m)throw new Error('请核对并选择已启用的处方药品');
   return {materialId:m.id,expectedMaterialRevision:m.revision,quantityScaled:scaledQuantity(el.querySelector('[name=quantity]').value,m.quantity_scale),directions:el.querySelector('[name=directions]').value};
  });
  if(!items.length)throw new Error('请至少填写一条药品明细');
  await command('/prescriptions/write',{...prescriptionView.selected,action:rx?'save':'draft',...(rx?{prescriptionId:rx.id,expectedRevision:rx.revision}:{}),collectionRoute:route,diagnosis:value.diagnosis,guidanceNote:value.guidanceNote,items,reason:value.reason},'prescription-editor');
 });
 const bindRemove=()=>document.querySelectorAll('#rx-items .rx-remove').forEach(b=>b.onclick=()=>b.closest('.rx-item').remove());bindRemove();
 $('#rx-add-item').onclick=()=>{if(document.querySelectorAll('#rx-items .rx-item').length>=20)return notice('每张处方最多20条明细',true);$('#rx-items').insertAdjacentHTML('beforeend',prescriptionItemRow());bindRemove();};
}
function prescriptionDetails(rx){
 return `<p>诊断：${esc(rx.diagnosis)}</p>`+table(['药品及规格','数量','医师明确的用法、用量和疗程'],rx.items.map(i=>`<tr><td>${esc(i.drug_name)}</td><td>${esc(quantityText(i.quantity_scaled,{quantity_scale:i.quantity_scale}))} ${esc(i.unit)}${i.dispensedQuantityScaled!=null?'<small>已实际发 '+esc(quantityText(i.dispensedQuantityScaled,{quantity_scale:i.quantity_scale}))+' '+esc(i.unit)+'</small>':''}</td><td class="clinical-note">${esc(i.directions)}</td></tr>`))+`<div class="clinical-note"><strong>用药指导及注意事项</strong><p>${esc(rx.guidance_note)}</p></div>`;
}
function prescriptionIssue(rx){
 const d=prescriptionView.data;
 if(!d.review)throw new Error('请先回到牙医接诊页面，完成本次健康资料复核');
 openEditor('核对并确认开立'+rx.collection_route+'处方',`<p>${esc(d.patient.name)} · ${esc(d.patient.record_no)}</p>${prescriptionDetails(rx)}${workflowHistory(rx.reviewHistory,[['review_status','结论'],['review_note','意见']],'逐次审方记录')}<h3>本次健康复核依据</h3>${table(['类别','核实情况','内容'],d.health.map(h=>`<tr><td>${esc(h.category)}</td><td>${esc(h.certainty)}</td><td class="clinical-note">${esc(h.content)}</td></tr>`))}<p>复核结论：${esc(d.review.conclusion)}</p>${clinicalText('reason','医师开立核对依据')}${clinicalConfirm('已核对患者、诊断、病史、过敏和既往用药，并逐项核对本次药品、规格、数量、用法及注意事项；确认开立')}`,async value=>{
  await command('/prescriptions/write',{...prescriptionView.selected,action:'issue',prescriptionId:rx.id,expectedRevision:rx.revision,expectedPatientRevision:d.patient.revision,expectedRecordRevision:d.record.revision,expectedHealthReviewId:d.review.id,confirmed:value.confirmed==='on',reason:value.reason},'prescription-issue');
 });
}
function prescriptionVoid(rx){
 openEditor('作废处方并保留原方',`<p>${esc(rx.record_no)} · ${esc(rx.patient_name)}</p><p>作废保留原处方、药品明细及开立时间；需要重新开方时另建新处方。</p>${clinicalText('reason','医师核实后的作废依据')}${clinicalConfirm('已核实作废条件与患者取药情况，并确认保留原处方记录')}`,async value=>{
  await command('/prescriptions/write',{...prescriptionView.selected,action:'void',prescriptionId:rx.id,expectedRevision:rx.revision,confirmed:value.confirmed==='on',reason:value.reason},'prescription-void');
 });
}
async function prescriptionExport(rx){
 const response=await fetch('/api/v2/prescriptions/'+rx.id+'/export',{headers:{'X-Clinic-Role':state.role},credentials:'same-origin'});
 if(!response.ok){const error=await response.json();throw new Error(error.message);}
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=rx.record_no+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function renderPrescriptions(version){
 if(state.role!=='dentist')throw new Error('当前岗位无处方开立或查阅权限');
 if(!prescriptionView.selected){
  const data=await api('/prescriptions/worklist?date='+state.date);if(version!==renderVersion)return;
  $('#page-actions').innerHTML='';filterDate();$('#content').innerHTML=data.items.length?table(['患者身份','就诊','处方数量','办理'],data.items.map(v=>`<tr><td>${esc(v.patient_name)}<small>${esc(v.patient_no)}</small></td><td>${esc(v.record_no)}<small>${esc(v.status)}</small></td><td>${v.prescription_count}</td><td><button data-open-prescription="${v.id}">查看处方与取药</button></td></tr>`)):empty('该日期没有已授权的到诊记录。请先由前台核对患者身份并登记到诊。');
  document.querySelectorAll('[data-open-prescription]').forEach(b=>b.onclick=()=>clinicalAction(()=>{const v=data.items.find(v=>v.id===Number(b.dataset.openPrescription));return openPrescriptions({visitId:v.id,patientId:v.patient_id});}));
  $('#refresh').onclick=()=>{state.date=$('#filter-date').value;clinicalAction(render);};if($('#tomorrow'))$('#tomorrow').onclick=()=>{state.date=new Date(Date.parse(state.status.businessDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);clinicalAction(render);};return;
 }
 const data=await api('/prescriptions/query?'+new URLSearchParams(prescriptionView.selected));if(version!==renderVersion)return;prescriptionView.data=data;
 $('#filters').innerHTML='';$('#page-actions').innerHTML='<button id="rx-back">返回就诊名单</button><button id="rx-clinical">查看本次病历与健康复核</button>'+(data.visit.status==='接诊中'?'<button id="rx-new" class="primary">建立院外处方草稿</button>'+(data.inHouseEnabled?'<button id="rx-new-inhouse">建立院内处方草稿</button>':''):'');
 let html=`<section class="clinical-summary"><h2>${esc(data.patient.name)}<small>${esc(data.patient.record_no)}</small></h2><p>${esc(data.visit.record_no)} · ${esc(data.visit.status)}</p><p>本次病历诊断：${esc(data.record.diagnosis||'尚未记录')}</p><p>健康复核：${data.review?esc(data.review.conclusion):'尚未完成，开立前须核对'}</p><p>${data.inHouseEnabled?'可按实际需要选择院外取药，或院内审方发药。开方与实际交付分别留痕。':'机构条件未启用或不在有效期内，当前仅办理院外取药。'}</p></section>`;
 for(const rx of data.prescriptions){
  html+=`<section class="clinical-plan"><h3>${esc(rx.record_no)} · ${esc(rx.status)}</h3><p>开立人：${esc(rx.prescriber_name)} · ${esc(rx.collection_route)}取药${rx.collection_route==='院内'?' · '+esc(rx.review_status):''}${rx.issued_at?' · '+esc(localDateTimeSeconds(rx.issued_at)):''}</p>${prescriptionDetails(rx)}${rx.status==='已作废'?`<p>作废依据：${esc(rx.void_reason)}<small>${esc(localDateTimeSeconds(rx.voided_at))}</small></p>`:''}<div class="actions">${rx.canManage&&rx.status==='草稿'&&data.visit.status==='接诊中'?`<button data-rx-edit="${rx.id}">修订草稿</button><button class="primary" data-rx-issue="${rx.id}">核对并确认开立</button>`:''}${rx.status!=='草稿'&&rx.contentIntact?`<button data-rx-export="${rx.id}">下载处方副本（可打印）</button>`:''}${rx.canManage&&rx.status==='已开立'&&!rx.items.some(i=>i.dispensedQuantityScaled>0)?`<button data-rx-void="${rx.id}" class="danger">核实作废</button>`:''}${rx.canManage&&rx.status==='已开立'&&rx.review_status==='待医师处理'?`<button data-rx-respond="${rx.id}">核实回复并重新送审</button>`:''}</div>${rx.review_note?'<p>药学 / 医师核实意见：'+esc(rx.review_note)+'</p>':''}${rx.history?.length?'<details><summary>交接历史</summary>'+rx.history.map(h=>'<p>'+esc(localDateTimeSeconds(h.occurred_at))+' · '+esc(h.reason)+'</p>').join('')+'</details>':''}${rx.status!=='草稿'?'<p>正文校验：'+(rx.contentIntact?'通过':'不符，请核对原记录')+'</p>':''}</section>`;
 }
 $('#content').innerHTML=html+(data.prescriptions.length?'':empty('本次尚无处方。需要用药时由牙医结合诊断及本次健康复核，明确填写药品与用法。'));
 $('#rx-back').onclick=()=>{resetPrescriptions();clinicalAction(render);};$('#rx-clinical').onclick=()=>{clinicalView.selected=prescriptionView.selected;state.page='clinical';clinicalAction(render);};if($('#rx-new'))$('#rx-new').onclick=()=>clinicalAction(()=>prescriptionEditor());if($('#rx-new-inhouse'))$('#rx-new-inhouse').onclick=()=>clinicalAction(()=>prescriptionEditor(null,'院内'));
 for(const [action,fn]of [['edit',prescriptionEditor],['issue',prescriptionIssue],['export',prescriptionExport],['void',prescriptionVoid],['respond',prescriptionRespond]])document.querySelectorAll('[data-rx-'+action+']').forEach(b=>b.onclick=()=>clinicalAction(()=>fn(data.prescriptions.find(p=>p.id===Number(b.getAttribute('data-rx-'+action))))));
}

function prescriptionRespond(rx){
 openEditor('核实原处方并重新送药学审核',`${prescriptionDetails(rx)}<p>药学意见：${esc(rx.review_note||'')}</p>${clinicalText('reason','医师核实后的处理说明')}${clinicalConfirm('已核实原处方内容无需修改，说明依据并重新送审；需要改变正文时另行开方')}`,async value=>{await command('/prescriptions/write',{...prescriptionView.selected,action:'respond',prescriptionId:rx.id,expectedRevision:rx.revision,confirmed:value.confirmed==='on',reason:value.reason},'prescription-respond');});
}
