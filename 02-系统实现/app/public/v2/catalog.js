'use strict';
async function catalogPriceEditor(data,price=null){
 const services=data.services.filter(s=>s.is_active);if(!services.length)throw new Error('请先建立收费项目');
 const current=await api('/status'),reason=price?.change_reason||'';
 openEditor(price?'修改拟用价目':'录入拟用价目',`${price?`<p>${esc(data.services.find(s=>s.id===price.service_id)?.name)}</p>`:select('serviceId','收费项目',options(services,s=>s.name))}${input('priceYuan','单价（元）',price?(price.unit_price_cents/100).toFixed(2):'')}${input('validFrom','生效时间',price?localDateTimeSeconds(price.valid_from):current.businessDate+'T00:00:00','datetime-local')}${input('validUntil','截止时间（可留空）',price?.valid_until?localDateTimeSeconds(price.valid_until):'','datetime-local',false)}${clinicalText('reason','价目制定依据',reason.split('\n免收依据：')[0])}${clinicalText('waiverBasis','零元项目免收依据（非零可留空）',reason.split('\n免收依据：')[1]||'',false)}`,async value=>{
  const cents=yuanCents(value.priceYuan);if(cents===0&&!value.waiverBasis.trim())throw new Error('零元项目需要填写免收依据');
  await command('/service-prices/draft',{action:'draft',serviceId:price?.service_id||Number(value.serviceId),...(price?{priceId:price.id,expectedRevision:price.revision}:{}),unitPriceCents:cents,validFrom:stamp(value.validFrom),validUntil:value.validUntil?stamp(value.validUntil):null,reason:value.reason,waiverBasis:value.waiverBasis},'price');
 });
}
function catalogReview(price,name,action){
 const title={approve:'负责人核对价目',return:'退回价目修订',stop:'停止用于新计费'}[action];
 openEditor(title,`<p>${esc(name)} · ${clinicalMoney(price.unit_price_cents)}</p>${clinicalText('reviewNote','实际核对意见')}${clinicalConfirm('已核对项目、单价及适用期间，并确认本次处理')}`,async value=>{
  await command('/service-prices/approve',{action,priceId:price.id,expectedRevision:price.revision,reviewNote:value.reviewNote},'price-'+action);
 });
}
async function renderCatalog(version){
 if(!['cashier','manager'].includes(state.role))throw new Error('当前岗位不能维护收费价目');
 const scope=homeScopeFor('catalog'),data=await api('/services/options'+(scope?.billItemId?'?billItemId='+scope.billItemId:scope?.priceId?'?priceId='+scope.priceId:''));if(version!==renderVersion)return;
 $('#filters').innerHTML=`<label>项目搜索<input id="catalog-search" placeholder="名称或项目编号"></label><label>分类<select id="catalog-category"><option value="">全部分类</option>${data.categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><button id="refresh-catalog">刷新价目</button>`;
 $('#page-actions').innerHTML=state.role==='cashier'?'<button id="create-service" class="primary">建立收费项目</button><button id="create-price">录入拟用价目</button><button id="reference-services">参考项目建草稿</button>':'';
 const name=id=>data.services.find(s=>s.id===id)?.name||'项目已保留';
 const buttons=p=>{
  if(state.role==='cashier'&&['价目草稿','已退回'].includes(p.status))return `<button data-edit-price="${p.id}">修改价目</button><button data-submit-price="${p.id}">提交负责人</button>`;
  if(state.role==='manager'&&p.status==='待负责人确认')return `<button data-approve-price="${p.id}">核对确认</button><button data-return-price="${p.id}">退回修订</button>`;
  if(state.role==='manager'&&p.status==='已确认可适用')return `<button data-stop-price="${p.id}">停止新计费</button>`;
  return '保留记录';
 };
 $('#content').innerHTML='<h2 class="subheading">收费项目</h2>'+(data.services.length?table(['项目','分类 / 计价单位','状态',...(state.role==='manager'?['办理']:[])],data.services.map(s=>`<tr data-catalog-service="${s.id}"><td>${esc(s.name)}<small>${esc(s.record_no)}</small></td><td>${esc(s.category)}<small>${esc(s.billing_unit)}</small></td><td>${s.is_active?'启用':'停用'}</td>${state.role==='manager'?`<td><button data-service-category="${s.id}">核对分类</button><button data-service-state="${s.id}">${s.is_active?'停用项目':'恢复项目'}</button></td>`:''}</tr>`)):empty('尚未建立收费项目，由收费人员核实后维护。'))+
  '<h2 class="subheading">价目及负责人确认</h2>'+(data.prices.length?table(['项目','单价','适用期间','状态','办理'],data.prices.map(p=>`<tr data-home-record="service_price:${p.id}" data-catalog-service="${p.service_id}"><td>${esc(name(p.service_id))}<small>${esc(p.change_reason)}</small>${p.review_note?`<small>核对意见：${esc(p.review_note)}</small>`:''}</td><td>${clinicalMoney(p.unit_price_cents)}</td><td>${esc(localDateTimeSeconds(p.valid_from))}<small>${p.valid_until?'至 '+esc(localDateTimeSeconds(p.valid_until)):'未设截止'}</small></td><td>${esc(p.status)}</td><td>${buttons(p)}</td></tr>`)):empty('实际计费使用已确认且适用日期相符的价目，已有账单保留原计价依据。'));
 if(state.role==='manager'){
  document.querySelectorAll('[data-service-category]').forEach(b=>b.onclick=()=>{const s=data.services.find(s=>s.id===Number(b.dataset.serviceCategory));openEditor('核对项目业务分类',`<p>${esc(s.name)}</p>${select('category','项目分类',data.categories.map(c=>`<option ${c===s.category?'selected':''}>${esc(c)}</option>`).join(''))}${clinicalText('reason','分类核实依据')}`,async v=>{await command('/services/manage',{action:'category',serviceId:s.id,expectedRevision:s.revision,category:v.category,reason:v.reason},'service-category-'+s.id);});});
  document.querySelectorAll('[data-service-state]').forEach(b=>b.onclick=()=>{const s=data.services.find(s=>s.id===Number(b.dataset.serviceState));openEditor(s.is_active?'停止新的项目使用':'恢复项目使用',`<p>${esc(s.name)} / ${esc(s.billing_unit)}</p>${clinicalText('reason','项目启停依据')}${clinicalConfirm('原计费及价目记录保留，不据此改写原费用')}`,async v=>{await command('/services/manage',{action:s.is_active?'stop':'enable',serviceId:s.id,expectedRevision:s.revision,reason:v.reason},'service-state-'+s.id);});});
 }
 $('#content').insertAdjacentHTML('beforeend','<h2 class="subheading">价目提交与审核历史</h2>'+data.prices.map(p=>`<details data-catalog-service="${p.service_id}" data-price-history="${p.id}"><summary>${esc(name(p.service_id))} · ${p.history?.length||0}次办理</summary>${p.history?.length?table(['阶段 / 办理人','当时价格 / 期间','当时状态及依据'],p.history.map(h=>`<tr><td>${esc(h.event_type)} · ${esc(h.actor_name)}<small>${esc(localDateTimeSeconds(h.occurred_at))}</small></td><td>${clinicalMoney(h.unit_price_cents)}<small>${esc(localDateTimeSeconds(h.valid_from))} 至 ${h.valid_until?esc(localDateTimeSeconds(h.valid_until)):'未设截止'}</small></td><td>${esc(h.status)}<small>制定依据：${esc(h.change_reason)}</small><small>本次依据：${esc(h.event_reason)}</small>${h.review_note?`<small>审核意见：${esc(h.review_note)}</small>`:''}</td></tr>`)):empty('尚无可展示的价目历史。')}<p class="muted">${esc(p.historyCoverage||'')}</p></details>`).join(''));
 function filterCatalog(){const q=$('#catalog-search').value.trim().toLowerCase(),category=$('#catalog-category').value,matching=new Set(data.services.filter(s=>(!q||(s.name+' '+s.record_no).toLowerCase().includes(q))&&(!category||s.category===category)).map(s=>s.id));document.querySelectorAll('#content [data-catalog-service]').forEach(el=>{el.hidden=!matching.has(Number(el.dataset.catalogService));});}
 $('#catalog-search').oninput=filterCatalog;$('#catalog-category').onchange=filterCatalog;
 $('#refresh-catalog').onclick=()=>clinicalAction(render);
 if(state.role==='manager'){
  $('#content').insertAdjacentHTML('beforeend','<h2 class="subheading">实际项目待核价</h2>'+(data.pendingItems.length?table(['患者 / 原账目','实际项目 / 数量','实际发生时间','办理'],data.pendingItems.map(i=>`<tr data-home-record="bill_item:${i.id}"><td>${esc(i.patient_name)}<small>${esc(i.patient_no)}</small><small>${esc(i.bill_no)}</small></td><td>${esc(i.service_name)} / ${quantityText(i.quantity,{quantity_scale:i.quantity_scale||0})}</td><td>${esc(localDateTimeSeconds(i.priced_at))}</td><td><button data-price-pending="${i.id}">核对适用价目</button></td></tr>`)):empty('没有待核价的实际项目。')));
  document.querySelectorAll('[data-price-pending]').forEach(b=>b.onclick=()=>clinicalAction(()=>{
   const item=data.pendingItems.find(i=>i.id===Number(b.dataset.pricePending)),prices=data.prices.filter(p=>p.service_id===item.service_id&&p.status==='已确认可适用'&&p.valid_from<=item.priced_at&&(!p.valid_until||p.valid_until>item.priced_at));
   if(!prices.length)throw new Error('没有覆盖原实际发生时间的已确认价目，请先由收费人员核对并提交价目，再由负责人确认');
   openEditor('按实际发生时间核价',`<p>${esc(item.patient_name)} · ${esc(item.patient_no)}<br>${esc(item.service_name)} / 数量${quantityText(item.quantity,{quantity_scale:item.quantity_scale||0})}</p>${select('priceId','覆盖原发生时间的已确认价目','<option value="">请选择核实后的价目</option>'+options(prices,p=>clinicalMoney(p.unit_price_cents)+' / '+localDateTimeSeconds(p.valid_from)))}${item.quoteOptions?.length?select('quoteItemId','已重新说明并接受的报价范围（原约定需变更时核对）','<option value="">继续核对原引用或原方案</option>'+options(item.quoteOptions,i=>i.record_no+' / V'+i.version_no+' / '+i.status+' / '+clinicalMoney(i.unit_price_cents)),false):''}${clinicalText('reviewNote','本次核价意见')}${clinicalConfirm('已核对原实际项目、数量及发生时间，确认引用此价目')}`,async value=>{await command('/service-prices/approve',{action:'pricePending',billItemId:item.id,expectedRevision:item.revision,priceId:Number(value.priceId),quoteItemId:value.quoteItemId?Number(value.quoteItemId):null,reviewNote:value.reviewNote},'price-pending');});
  }));
 }
 if(state.role==='cashier'){
  $('#create-service').onclick=()=>openEditor('建立收费项目',`${input('name','收费项目名称')}${input('billingUnit','计价单位（次、颗或明确疗程）')}${select('category','项目分类',data.categories.map(c=>`<option ${c==='其他'?'selected':''}>${esc(c)}</option>`).join(''))}${clinicalText('reason','建立依据与收费范围')}`,async value=>{await command('/service-prices/draft',{action:'service',...value},'service');});
  $('#create-price').onclick=()=>clinicalAction(()=>catalogPriceEditor(data));
  $('#reference-services').onclick=()=>clinicalAction(async()=>{
   const refs=await api('/clinic/reference-services');openEditor('从参考项目建立拟价草稿',`<p>${esc(refs.status)}</p>${select('referenceId','参考项目',refs.items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)} / ${esc(i.unit)}</option>`).join(''))}<p id="reference-scope" class="clinical-note"></p>${input('priceYuan','本诊所拟用单价（元）')}${input('validFrom','拟生效时间',state.status.businessDate+'T00:00:00','datetime-local')}${clinicalText('reason','本诊所拟价及项目范围核实依据')}${clinicalText('waiverBasis','零元免收依据（非零可空）','',false)}${clinicalConfirm('参考示例仅生成草稿，须核对本诊所价格及范围后提交负责人确认')}`,async v=>{await command('/service-prices/draft',{action:'reference',referenceId:v.referenceId,unitPriceCents:yuanCents(v.priceYuan),validFrom:stamp(v.validFrom),reason:v.reason,waiverBasis:v.waiverBasis},'reference-price');});
   function update(){const x=refs.items.find(i=>i.id===$('#editor [name=referenceId]').value);$('#reference-scope').textContent=x.scope;$('#editor [name=priceYuan]').value=(x.priceCents/100).toFixed(2);}$('#editor [name=referenceId]').onchange=update;update();
  });
 }
 document.querySelectorAll('[data-edit-price]').forEach(b=>b.onclick=()=>clinicalAction(()=>catalogPriceEditor(data,data.prices.find(p=>p.id===Number(b.dataset.editPrice)))));
 document.querySelectorAll('[data-submit-price]').forEach(b=>b.onclick=()=>{const p=data.prices.find(p=>p.id===Number(b.dataset.submitPrice));openEditor('提交价目确认',`<p>${esc(name(p.service_id))} · ${clinicalMoney(p.unit_price_cents)}</p>${clinicalConfirm('已核对拟用单价、单位及适用期间')}`,async()=>{await command('/service-prices/draft',{action:'submit',priceId:p.id,expectedRevision:p.revision},'price-submit');});});
 for(const action of ['approve','return','stop'])document.querySelectorAll(`[data-${action}-price]`).forEach(b=>b.onclick=()=>{const p=data.prices.find(p=>p.id===Number(b.dataset[action+'Price']));catalogReview(p,name(p.service_id),action);});
}
