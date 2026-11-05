'use strict';
let quoteView={data:null,selected:null};
function resetQuotes(){quoteView={data:null,selected:null};}
const quoteCurrent=q=>q.versions.filter(v=>v.issued_at).at(-1);
const quoteStatus=v=>v.effectiveStatus||v.status;
const quoteAmount=v=>v.items.some(i=>i.amount_cents===null)?'待核价':clinicalMoney(v.items.reduce((n,i)=>n+i.amount_cents,0));
function quoteDraftEditor(q=null,v=null,revise=false){
 const d=quoteView.data,activeServices=d.services.filter(s=>s.is_active),visits=d.visits.filter(x=>(!q||x.patient_id===q.patient_id)&&(state.page!=='workspace'||x.patient_id===workspaceView.patientId));
 if(!activeServices.length)throw new Error('请先由收费岗位维护项目、负责人确认价目');
 if(!q&&!visits.length)throw new Error('当前牙医尚无负责的就诊，请先完成到诊分配');
 let count=0,sourcePlanId=v?.source_plan_version_id||null;
 const rowHTML=(i={})=>{const n=++count;return `<fieldset data-quote-row="${n}"><legend>报价项目 ${n}</legend><div class="form-grid">${select('plan_'+n,'对应原方案项目','<option value="">独立检查咨询，无原方案项目</option>'+options(d.plans.find(p=>p.id===sourcePlanId)?.items||[],p=>p.description+' / '+(p.tooth_code||'未指定牙位')+' / 计划'+p.planned_quantity,i.plan_item_id),false)}${select('service_'+n,'实际收费项目','<option value="">请选择对应项目</option>'+options(activeServices,s=>s.name+' / '+s.billing_unit,i.service_id))}${input('tooth_'+n,'FDI牙位',i.tooth_code||'','text',false)}${input('surface_'+n,'牙面',i.surface_code||'','text',false)}${input('qty_'+n,'数量',i.quantity||i.planned_quantity||1,'number')}<div class="full">${clinicalText('scope_'+n,'包含与不包含的范围、材料或疗程',i.scope_note||'')}</div></div><button type="button" data-remove-quote-row="${n}">移除此项</button></fieldset>`;};
 const allowedPlans=d.plans.filter(p=>(!q||p.treatment_plan_id===q.treatment_plan_id)&&(state.page!=='workspace'||p.patient_id===workspaceView.patientId)),sourceOptions='<option value="">独立检查咨询，无治疗方案</option>'+options(allowedPlans,p=>'方案 #'+p.treatment_plan_id+' / V'+p.version_no+' / '+p.goal,v?.source_plan_version_id);
 openEditor(revise?'建立新报价版本':q?'继续编制报价':'编制独立报价',`<p>逐项核对实际治疗范围；金额由收费人员选择正式价目后出具。</p>${q?`<p>${esc(q.patient_name)} · ${esc(q.patient_no)} · ${esc(q.record_no)}</p>`:''}${select('visitId','核对患者及负责的来源就诊','<option value="">请选择来源就诊</option>'+options(visits,x=>x.patient_name+' / '+x.patient_no+' / 就诊#'+x.id))}${select('sourcePlanVersionId','引用治疗方案版本',sourceOptions,false)}<div id="quote-draft-items">${v?v.items.map(rowHTML).join(''):rowHTML()}</div><button type="button" id="quote-add-item">增加报价项目</button>${clinicalText('reason','编制或改版依据')}${clinicalConfirm('已核对患者、原方案版本、项目数量和费用范围；报价不代替医疗知情同意')}`,async value=>{
  const visit=visits.find(x=>x.id===Number(value.visitId));if(!visit)throw new Error('请选择核对后的来源就诊');
  const source=value.sourcePlanVersionId?Number(value.sourcePlanVersionId):null;
  const plan=d.plans.find(p=>p.id===source);if(plan&&plan.patient_id!==visit.patient_id)throw new Error('来源方案与所选患者不一致');
  if(q&&visit.patient_id!==q.patient_id)throw new Error('改版须保留原患者');
  const items=Array.from(document.querySelectorAll('#quote-draft-items [data-quote-row]')).map(el=>{const n=el.dataset.quoteRow;return {planItemId:value['plan_'+n]?Number(value['plan_'+n]):null,serviceId:Number(value['service_'+n]),toothCode:value['tooth_'+n]||null,surfaceCode:value['surface_'+n]||null,quantity:Number(value['qty_'+n]),scopeNote:value['scope_'+n]};});
  await command('/quotes/prepare',{action:revise?'revise':q?'edit':'create',patientId:visit.patient_id,visitId:visit.id,sourcePlanVersionId:source,items,reason:value.reason,...(q?{versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision}:{})},'quote-prepare');
  if(!q)quoteView.selected=null;
 });
 const area=$('#quote-draft-items');
 area.onclick=event=>{const b=event.target.closest('[data-remove-quote-row]');if(b)b.closest('fieldset').remove();};
 area.onchange=event=>{if(!event.target.name?.startsWith('plan_'))return;const n=event.target.name.slice(5),p=d.plans.find(p=>p.id===sourcePlanId)?.items.find(i=>i.id===Number(event.target.value));if(p){$('#editor [name=tooth_'+n+']').value=p.tooth_code||'';$('#editor [name=surface_'+n+']').value=p.surface_code||'';$('#editor [name=qty_'+n+']').value=String(p.planned_quantity);}};
 $('#quote-add-item').onclick=()=>{if(area.querySelectorAll('fieldset').length>=100)return;area.insertAdjacentHTML('beforeend',rowHTML());};
 const sourceSelect=$('#editor [name=sourcePlanVersionId]'),visitSelect=$('#editor [name=visitId]');
 const fillSource=()=>{
  sourcePlanId=sourceSelect.value?Number(sourceSelect.value):null;const p=d.plans.find(x=>x.id===sourcePlanId);if(p){visitSelect.value=String(p.source_visit_id);area.innerHTML=p.items.map(i=>rowHTML({...i,plan_item_id:i.id,service_id:null,scope_note:i.description})).join('');}
  else area.innerHTML=rowHTML();
 };
 if(sourceSelect)sourceSelect.onchange=fillSource;
 if(v?.source_plan_version_id){const p=d.plans.find(x=>x.id===v.source_plan_version_id);if(p)visitSelect.value=String(p.source_visit_id);}
 else if(state.page==='workspace'&&visits.some(v=>v.id===workspaceView.visitId))visitSelect.value=String(workspaceView.visitId);else if(visits.length===1)visitSelect.value=String(visits[0].id);
}
function quoteIssue(q,v){
 const d=quoteView.data,end=new Date(Date.parse(d.businessDate+'T12:00:00Z')+30*86400000).toISOString().slice(0,10);
 openEditor('逐项核价并出具报价',`<p>${esc(q.patient_name)} · ${esc(q.patient_no)} · V${v.version_no}</p>${v.items.map(i=>`<fieldset><legend>${esc(i.description_snapshot)} · ${esc(i.tooth_code||'未指定牙位')} · ${i.quantity}${esc(i.billing_unit_snapshot)}</legend><p>${esc(i.scope_note)}</p>${select('price_'+i.id,'出具时采用的已确认价目','<option value="">请明确选择适用价目</option>'+options(d.prices.filter(p=>p.service_id===i.service_id),p=>clinicalMoney(p.unit_price_cents)+' / 价目#'+p.id))}</fieldset>`).join('')}<div class="form-grid">${input('validFrom','生效日期',d.businessDate,'date')}${input('validUntil','患者接受截止日期（含当天）',end,'date')}</div>${clinicalText('reason','核价出具依据')}${clinicalConfirm('已核实本版各项范围、正式价目和有效期；出具后内容冻结，修改须另建版本')}`,async value=>{
  await command('/quotes/issue',{versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,validFrom:value.validFrom,validUntil:value.validUntil,prices:v.items.map(i=>({itemId:i.id,priceId:Number(value['price_'+i.id])})),reason:value.reason},'quote-issue');
 });
}
function quoteDecide(q,v){
 const d=quoteView.data;
 openEditor('登记患者逐项费用决定',`<p>${esc(q.patient_name)} · ${esc(q.patient_no)} · V${v.version_no}</p><fieldset><legend>选择患者本次作出决定的项目</legend>${v.items.map(i=>`<label><input type="checkbox" name="quoteDecisionItem" value="${i.id}">${esc(i.description_snapshot)} / ${esc(i.tooth_code||'未指定牙位')} / ${clinicalMoney(i.amount_cents)} / 原决定：${esc(i.latestDecision?.decision_type||'未决定')}</label>`).join('')}</fieldset>${select('decision','本次实际决定','<option value="">请选择患者明确决定</option>'+['接受','暂缓','拒绝','撤回'].map(x=>`<option>${x}</option>`).join(''))}${input('decidedAt','患者实际决定时间',localDateTimeSeconds(d.now),'datetime-local')}${clinicalText('confirmationBasis','费用范围说明及患者实际决定依据')}${clinicalConfirm('已向患者说明所选项目费用并核实其明确决定；此记录不替代治疗方案和医疗知情同意')}`,async value=>{
  const itemIds=Array.from(document.querySelectorAll('#editor [name=quoteDecisionItem]:checked')).map(e=>Number(e.value));
  await command('/quotes/decide',{versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,itemIds,decision:value.decision,decidedAt:stamp(value.decidedAt),confirmationBasis:value.confirmationBasis},'quote-decision');
 });
}
function quoteReceive(q){
 const now=quoteView.data.now;
 openEditor('登记与报价有关的实际预付款',`<p>${esc(q.patient_name)} · ${esc(q.patient_no)} · ${esc(q.record_no)}</p><p>本次仅登记原款和报价意向；实际费用形成后再按原款办理抵扣。</p>${select('channel','实际渠道','<option value="">请选择实际渠道</option>'+['现金','银行卡','微信','支付宝'].map(x=>`<option>${x}</option>`).join(''))}${input('receivedYuan','实际收款金额（元）')}${input('changeYuan','现金实际找零（元，非现金填0）','0')}${select('verification','实际到账情况','<option value="">请选择核实结果</option><option value="confirmed">已核实到账</option><option value="pending">待核实</option>')}${input('receivedAt','实际到账时间（已到账时填写）',localDateTimeSeconds(now),'datetime-local',false)}${input('externalReference','渠道交易号（非现金已到账必填）','','text',false)}${clinicalText('transactionEvidence','实际到账或待核实依据')}<label><input type="checkbox" name="keepAsPrepayment" required>已与患者核对：未用于实际账目的原款保留预付</label>${clinicalConfirm('已核对真实收款；报价本身不形成欠款或营业收入')}`,async value=>{
  await command('/patient-payments/receive',{action:'receive',patientId:q.patient_id,expectedFundsRevision:q.funds.revision,quoteId:q.id,channel:value.channel,receivedCents:yuanCents(value.receivedYuan),changeCents:yuanCents(value.changeYuan),verification:value.verification,receivedAt:value.receivedAt?stamp(value.receivedAt):null,externalReference:value.externalReference||null,transactionEvidence:value.transactionEvidence,keepAsPrepayment:value.keepAsPrepayment==='on',allocations:[]},'quote-prepayment');
 });
}
async function renderQuotes(version){
 const d=await api('/quotes/query'+(state.page==='workspace'?'?patientId='+workspaceView.patientId+(homeScopeFor('quotes')?.quoteId?'&quoteId='+homeScopeFor('quotes').quoteId:''):''));if(version!==renderVersion)return;quoteView.data=d;
 $('#filters').innerHTML='';$('#page-actions').innerHTML=state.role==='dentist'?'<button id="create-quote" class="primary">编制报价</button>':'';
 if($('#create-quote'))$('#create-quote').onclick=()=>clinicalAction(()=>quoteDraftEditor());
 const q=d.quotes.find(q=>q.id===quoteView.selected);
 if(!q){
  quoteView.selected=null;
  $('#content').innerHTML=d.quotes.length?table(['患者','报价与原方案','当前版本 / 金额','查看'],d.quotes.map(q=>{const v=q.versions.at(-1),issued=quoteCurrent(q);return `<tr><td>${esc(q.patient_name)}<small>${esc(q.patient_no)}</small></td><td>${esc(q.record_no)}<small>${q.treatment_plan_id?'原方案 #'+q.treatment_plan_id:'独立检查咨询'}</small></td><td>V${v.version_no} · ${esc(quoteStatus(v))}<small>${quoteAmount(v)}${v.status==='草稿'&&issued?'；旧出具版 V'+issued.version_no+' 仍保留效力':''}</small></td><td><button data-open-quote="${q.id}">查看及办理</button></td></tr>`;})):empty('暂无独立报价。牙医先按患者和治疗范围编制，收费人员核价出具后逐项登记患者决定。');
  document.querySelectorAll('[data-open-quote]').forEach(b=>b.onclick=()=>{quoteView.selected=Number(b.dataset.openQuote);clinicalAction(render);});return;
 }
 let html=`<button id="back-quotes">返回报价列表</button><section class="clinical-summary"><h2>${esc(q.patient_name)} · ${esc(q.patient_no)}</h2><p>${esc(q.record_no)} · ${q.treatment_plan_id?'治疗方案 #'+q.treatment_plan_id:'独立检查咨询'}</p></section>`;
 const latest=q.versions.at(-1),issued=quoteCurrent(q);
 for(const v of [...q.versions].reverse()){
  html+=`<section class="clinical-plan" data-home-record="quote_version:${v.id}"><h2>V${v.version_no} · ${esc(quoteStatus(v))} · ${quoteAmount(v)}</h2><p>原方案版本：${v.source_plan_version_id||'无'}；生效日期：${esc(v.valid_from||'未出具')}；接受截止：${esc(v.valid_until||'未出具')}</p><p>编制依据：${esc(v.change_reason)}</p>`;
  html+=table(['项目 / 范围','牙位牙面 / 数量','价目快照 / 金额','患者费用决定'],v.items.map(i=>`<tr><td>${esc(i.description_snapshot)}<small>${esc(i.scope_note)}</small></td><td>${esc(i.tooth_code||'—')} ${esc(i.surface_code||'')}<small>${i.quantity}${esc(i.billing_unit_snapshot)}</small></td><td>${i.unit_price_cents===null?'待核价':clinicalMoney(i.unit_price_cents)}<small>${i.amount_cents===null?'金额未知':clinicalMoney(i.amount_cents)}</small></td><td>${esc(i.latestDecision?.decision_type||'未决定')}${i.decisions.length?`<details><summary>决定历史</summary>${i.decisions.map(x=>`<p>${esc(x.decision_type)} · ${esc(localDateTimeSeconds(x.decided_at))}<br>${esc(x.confirmation_basis)}</p>`).join('')}</details>`:''}</td></tr>`));
  if(v.id===latest.id&&state.role==='dentist')html+=`<button data-quote-prepare="${v.id}">${v.status==='草稿'?'继续编制':'建立新版本'}</button>`;
  if(v.status==='草稿'&&state.role==='cashier')html+=`<button data-quote-issue="${v.id}">逐项核价并出具</button>`;
  if(v.id===issued?.id&&['已出具','已接受','部分接受'].includes(v.status))html+=`<button data-quote-decide="${v.id}">登记患者逐项决定</button>`;
  html+='</section>';
 }
 html+='<h2>实际费用与原款</h2><p>报价金额、患者决定和实际收款分别核对。治疗后的应收与抵扣以实际账目为准。</p>';
 if(state.role==='cashier'&&issued&&['已出具','已接受','部分接受'].includes(issued.status)&&d.businessDate>=issued.valid_from&&(d.businessDate<=issued.valid_until||['已接受','部分接受'].includes(issued.status)))html+='<button id="quote-prepay">登记相关实际预付款</button>';
 html+=q.payments.length?table(['原款','实际净额','到账结果'],q.payments.map(p=>`<tr><td>${esc(p.record_no)}</td><td>${clinicalMoney(p.net_cents)}</td><td>${esc(p.status)}</td></tr>`)):empty('尚无引用本报价意向的实际付款。');
 html+=q.charges.length?table(['实际费用','原报价项目','核价结果'],q.charges.map(i=>`<tr><td>费用 #${i.id} / 账目 #${i.bill_id}</td><td>#${i.quote_item_id}</td><td>${esc(i.pricing_status)} · ${i.amount_cents===null?'待核价':clinicalMoney(i.amount_cents)}<small>${esc(i.pricing_note)}</small></td></tr>`)):empty('尚无引用本报价项目的实际费用。');
 $('#content').innerHTML=html;$('#back-quotes').onclick=()=>{quoteView.selected=null;clinicalAction(render);};
 for(const [attribute,fn]of [['prepare',v=>quoteDraftEditor(q,v,v.status!=='草稿')],['issue',v=>quoteIssue(q,v)],['decide',v=>quoteDecide(q,v)]])document.querySelectorAll('[data-quote-'+attribute+']').forEach(b=>b.onclick=()=>clinicalAction(()=>fn(q.versions.find(v=>v.id===Number(b.getAttribute('data-quote-'+attribute))))));
 if($('#quote-prepay'))$('#quote-prepay').onclick=()=>clinicalAction(()=>quoteReceive(q));
}
