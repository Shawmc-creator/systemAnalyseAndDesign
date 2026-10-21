'use strict';
const documentView={selected:null,data:null};
function resetDocuments(){documentView.selected=null;documentView.data=null;}
function openDocuments(context){documentView.selected=context;state.page='documents';return render();}
async function documentBytes(file){
 if(!file||!file.size||file.size>10*1024*1024)throw new Error('请选择不超过10MB的PNG、JPEG或PDF文件');
 const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {originalName:file.name,contentBase64:btoa(raw),mediaType:file.type||undefined};
}
function documentFileField(){return '<label>选择原文件（PNG、JPEG、PDF，最大10MB）<input name="file" type="file" accept="image/png,image/jpeg,application/pdf" required></label>';}
function documentUpload(doc=null,restoreVersion=null){
 const d=documentView.data;
 const meta=doc?'':select('documentType','资料类别',options(['影像','同意文书','诊疗附件'].map(x=>({id:x,name:x})),x=>x.name))+input('source','来源（设备、外院或文书提供人）')+clinicalText('ownershipNote','患者及本次诊疗归属核对依据')+select('planVersionId','关联方案版本','<option value="">仅关联本次就诊</option>'+options(d.plans,p=>p.goal+' · 第'+p.version_no+'版'),false);
 openEditor(restoreVersion?'恢复原版本文件':doc?'补充文件新版本':'上传影像或诊疗文书',`<p>${esc(d.patient.name)} · ${esc(d.patient.record_no)}<small>就诊 ${esc(d.visit.record_no)}</small></p>${meta}${documentFileField()}${restoreVersion?'<p>恢复文件须与原版本的SHA-256、大小及类型一致。</p>':input('capturedAt','实际拍摄 / 形成时间（未知留空）','','datetime-local',false)}${clinicalText('reason',restoreVersion?'恢复核对结论':'首次归档或补充原因')}${clinicalConfirm('已核对所选文件与患者身份、就诊及相关方案归属')}`,async value=>{
  const file=await documentBytes($('#editor [name=file]').files[0]);
  await command(restoreVersion?'/documents/verify':'/documents/upload',restoreVersion?{action:'restore',versionId:restoreVersion.id,expectedRevision:restoreVersion.revision,verificationNote:value.reason,...file}:{...documentView.selected,...file,...(doc?{documentId:doc.id,expectedRevision:doc.revision}:{documentType:value.documentType,source:value.source,ownershipNote:value.ownershipNote,planVersionId:value.planVersionId?Number(value.planVersionId):null}),capturedAt:value.capturedAt?stamp(value.capturedAt):null,reason:value.reason},'document-upload');
 });
}
function documentVerify(version,action){
 openEditor({confirm:'确认原件及诊疗归属',return:'退回核对',missing:'登记原件缺失或损坏'}[action],`<p>${esc(version.original_name)} · 第${version.version_no}版</p>${clinicalText('verificationNote','核对结论与依据')}${clinicalConfirm(action==='confirm'?'已查看原件内容，并核对患者及本次诊疗归属':'已核实当前情况，保留原版本记录')}`,async value=>{
  await command('/documents/verify',{action,versionId:version.id,expectedRevision:version.revision,verificationNote:value.verificationNote,confirmed:value.confirmed==='on'},'document-verify');
 });
}
async function documentCorrect(version){
 const data=await api('/documents/worklist?date='+state.date),candidates=data.items.filter(v=>v.id!==documentView.selected.visitId);
 if(!candidates.length)throw new Error('当前日期没有其他已授权就诊可供更正，请先核实正确患者的到诊记录');
 openEditor('更正待确认原件的就诊归属',`<p>原文件：${esc(version.original_name)}。原索引和原版本保留，更正后须重新确认。</p>${select('visitId','核实后的正确患者及就诊','<option value="">请选择正确患者</option>'+options(candidates,v=>v.patient_name+' / '+v.patient_no+' / '+v.record_no))}${clinicalText('reason','归属更正依据')}${clinicalConfirm('已核对原件内容、正确患者身份与就诊记录')}`,async value=>{
  const target=candidates.find(v=>v.id===Number(value.visitId));
  await command('/documents/correct',{versionId:version.id,expectedRevision:version.revision,visitId:target.id,patientId:target.patient_id,reason:value.reason},'document-correct');
 });
}
async function documentDownload(version){
 const response=await fetch('/api/v2/documents/versions/'+version.id+'/download',{headers:{'X-Clinic-Role':state.role},credentials:'same-origin'});
 if(!response.ok){const error=await response.json();throw new Error(error.message);}
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=version.original_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function renderDocuments(version){
 if(!['dentist','assistant'].includes(state.role))throw new Error('当前岗位无诊疗附件管理权限');
 if(!documentView.selected){
  const data=await api('/documents/worklist?date='+state.date);if(version!==renderVersion)return;
  $('#page-actions').innerHTML='';filterDate();
  $('#content').innerHTML=data.items.length?table(['患者身份','就诊 / 接诊牙医','状态','办理'],data.items.map(v=>`<tr><td>${esc(v.patient_name)}<small>${esc(v.patient_no)}</small></td><td>${esc(v.record_no)}<small>${esc(v.dentist_name)}</small></td><td>${esc(v.status)}</td><td><button data-open-document="${v.id}">查看影像与文书</button></td></tr>`)):empty('该日期没有可管理附件的就诊。先由前台核对患者并登记到诊。');
  document.querySelectorAll('[data-open-document]').forEach(b=>b.onclick=()=>clinicalAction(()=>{const v=data.items.find(v=>v.id===Number(b.dataset.openDocument));return openDocuments({visitId:v.id,patientId:v.patient_id});}));
  $('#refresh').onclick=()=>{state.date=$('#filter-date').value;clinicalAction(render);};
  if($('#tomorrow'))$('#tomorrow').onclick=()=>{state.date=new Date(Date.parse(state.status.businessDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);clinicalAction(render);};return;
 }
 const data=await api('/documents/query?'+new URLSearchParams(documentView.selected));if(version!==renderVersion)return;documentView.data=data;
 $('#filters').innerHTML='';$('#page-actions').innerHTML='<button id="documents-back">返回就诊名单</button><button id="documents-upload" class="primary">上传影像或文书</button>';
 const dentist=state.role==='dentist';
 let html=`<section class="clinical-summary"><h2>${esc(data.patient.name)}<small>${esc(data.patient.record_no)}</small></h2><p>${esc(data.visit.record_no)} · ${esc(data.visit.status)}</p><p>上传后待牙医核对；新版本保留原件，文书归档不自动表示患者同意治疗。</p></section>`;
 for(const doc of data.documents){
  html+=`<section class="clinical-plan"><h3>${esc(doc.document_type)} · ${esc(doc.record_no)}</h3><p>来源：${esc(doc.source)}</p><p>${esc(doc.ownership_note)}</p><p>${doc.plan_version_id?'关联方案版本 #'+doc.plan_version_id:'关联本次就诊'}</p><button data-doc-append="${doc.id}">补充新版本</button>`+table(['版本 / 文件','形成与上传','核对情况','办理'],doc.versions.map(v=>`<tr><td>第${v.version_no}版 · ${esc(v.original_name)}<small>${Math.ceil(v.size_bytes/1024)}KB · ${esc(v.media_type)}</small><small>${esc(v.change_reason)}</small><details><summary>内容摘要</summary><small>${esc(v.sha256)}</small></details></td><td>${v.captured_at?esc(localDateTimeSeconds(v.captured_at)):'实际形成时间未提供'}<small>上传：${esc(v.uploaded_by_name)} · ${esc(localDateTimeSeconds(v.created_at))}</small></td><td>${esc(v.status)}<small>${v.available?'原件校验通过':'原件缺失或内容校验不符'}</small><small>${esc(v.verification_note||'')}</small>${v.confirmed_by_name?'<small>确认：'+esc(v.confirmed_by_name)+'</small>':''}</td><td class="actions">${v.available?`<button data-doc-download="${v.id}">下载原件</button>`:''}${dentist&&v.status==='原件待确认'?`${v.available?`<button data-doc-confirm="${v.id}">确认归属</button>`:''}<button data-doc-return="${v.id}">退回核对</button>`:''}${dentist&&v.id===doc.versions[0].id&&!doc.versions.some(x=>['原件已确认','缺失或不可读'].includes(x.status))&&['原件待确认','退回核对'].includes(v.status)&&v.available?`<button data-doc-correct="${v.id}">更正就诊归属</button>`:''}${dentist&&v.status==='原件已确认'&&!v.available?`<button data-doc-missing="${v.id}">登记缺失</button>`:''}${dentist&&v.status==='缺失或不可读'?`<button data-doc-restore="${v.id}">恢复原文件</button>`:''}</td></tr>`))+'</section>';
 }
 $('#content').innerHTML=html+(data.documents.length?'':empty('本次就诊尚无影像或文书。可上传设备导出的PNG/JPEG影像及PDF文书。'));
 $('#documents-back').onclick=()=>{resetDocuments();clinicalAction(render);};$('#documents-upload').onclick=()=>documentUpload();
 document.querySelectorAll('[data-doc-append]').forEach(b=>b.onclick=()=>documentUpload(data.documents.find(d=>d.id===Number(b.dataset.docAppend))));
 const versions=data.documents.flatMap(d=>d.versions);
 for(const action of ['download','confirm','return','missing','restore','correct'])document.querySelectorAll('[data-doc-'+action+']').forEach(b=>b.onclick=()=>clinicalAction(()=>{
  const v=versions.find(v=>v.id===Number(b.getAttribute('data-doc-'+action)));
  if(action==='download')return documentDownload(v);if(action==='correct')return documentCorrect(v);if(action==='restore')return documentUpload(data.documents.find(d=>d.id===v.clinical_document_id),v);return documentVerify(v,action);
 }));
}
