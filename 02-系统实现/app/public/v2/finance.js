'use strict';
const financeView={patientId:null,bills:null,fees:null,billPage:1,requestPage:1,search:''};
function resetFinance(){Object.assign(financeView,{patientId:null,bills:null,fees:null,billPage:1,requestPage:1,search:''});}
function signedYuan(value){const negative=value.startsWith('-'),cents=yuanCents(negative?value.slice(1):value);return negative?-cents:cents;}
function financeRefs(billId,paymentId){
 const q=financeView.bills,f=financeView.fees,bill=q?.items.find(b=>b.id===billId)||f.items.find(r=>r.bill_id===billId)?.billSource,payment=f.funds.payments.find(p=>p.id===paymentId);
 return {patientId:financeView.patientId,expectedFundsRevision:f.funds.revision,billId:billId||null,expectedBillRevision:bill?.revision,paymentId:paymentId||null,expectedPaymentRevision:payment?.revision};
}
async function financeReceive(payment=null){
 const q=financeView.bills,now=(await api('/status')).now;
 const bills=q.items.filter(b=>b.summary.unpaidCents>0);
 const targets='<option value="">请选择本次用途</option><option value="prepayment">暂不分配账目用途</option>'+options(bills,b=>`${b.record_no} / 未付${clinicalMoney(b.summary.unpaidCents)}`);
 openEditor(payment?'核实原付款结果':'登记实际收款',`<p>${esc(q.patient.name)} · ${esc(q.patient.recordNo)}</p>`+
  (payment?`<p>原款 ${esc(payment.recordNo)} · ${esc(payment.channel)} · 净额${clinicalMoney(payment.netCents)}</p>${select('outcome','本次实际核实结果','<option value="">请选择核实结果</option><option value="received">确认已到账</option><option value="notReceived">确认未到账</option>')}`:
  `${select('channel','实际收款渠道','<option value="">请选择实际渠道</option>'+options(['现金','银行卡','微信','支付宝'].map(x=>({id:x,name:x})),x=>x.name))}${input('receivedYuan','实际收款金额（元）')}${input('changeYuan','现金实际找零（元，非现金填0）','0')}${select('verification','到账情况','<option value="">请选择实际情况</option><option value="confirmed">已核实到账</option><option value="pending">到账结果待核实</option>')}`)+
  `<p>非现金款项请在实际收款渠道核对到账后登记，结果不明确时保留待核实。</p>${input('receivedAt','实际到账时间（仅已核实到账填写）',localDateTimeSeconds(now),'datetime-local',false)}${input('externalReference','渠道交易号（非现金确认到账必填）',payment?.externalReference||'','text',false)}${clinicalText('transactionEvidence','实际到账或核实依据')}${select('target','本次用途（待核实或未到账时暂不分配）',targets)}${input('allocateYuan','用于所选账目的金额（元；暂不分配填0）','0')}`+
  `<label><input type="checkbox" name="keepAsPrepayment">已向患者核对，净到账额中未用于本次账目的部分保留预付</label>${clinicalConfirm('已核对患者、原款、实际金额、渠道和到账结果；不以付款截图代替到账核实')}`,async value=>{
   const confirmed=payment?value.outcome==='received':value.verification==='confirmed',bill=bills.find(b=>b.id===Number(value.target)),amount=yuanCents(value.allocateYuan);
   if(!confirmed&&(bill||amount))throw new Error('到账尚未确认，不能分配账目用途');
   if(value.target==='prepayment'&&amount!==0)throw new Error('暂不分配用途时，用途金额应为0');
   if(bill&&amount===0)throw new Error('请选择真实用于该账目的金额');
   await command('/patient-payments/receive',{patientId:q.patient.id,expectedFundsRevision:q.funds.revision,
    ...(payment?{action:'verify',paymentId:payment.id,expectedPaymentRevision:payment.revision,outcome:value.outcome}:{action:'receive',channel:value.channel,receivedCents:yuanCents(value.receivedYuan),changeCents:yuanCents(value.changeYuan),verification:value.verification}),
    receivedAt:value.receivedAt?stamp(value.receivedAt):null,externalReference:value.externalReference||null,transactionEvidence:value.transactionEvidence,keepAsPrepayment:value.keepAsPrepayment==='on',
    allocations:bill?[{billId:bill.id,expectedRevision:bill.revision,amountCents:amount,reason:'已核对原款并按患者本次付款用途分配'}]:[]},'finance-receive');
  });
}
function financeOffset(payment){
 const q=financeView.bills,bills=q.items.filter(b=>b.summary.unpaidCents>0);
 if(!bills.length)throw new Error('本页没有尚未支付的已核价账目，可切换账目页后再核对');
 openEditor('使用原款可用余额抵扣',`<p>${esc(payment.recordNo)} · 可用${clinicalMoney(payment.availableCents)}</p>${select('billId','目标账目','<option value="">请选择核对后的账目</option>'+options(bills,b=>b.record_no+' / 未付'+clinicalMoney(b.summary.unpaidCents)))}${input('amountYuan','本次抵扣金额（元）')}${clinicalText('reason','实际抵扣依据')}${clinicalConfirm('已核对原款剩余额及目标账目，使用既有资金抵扣')}`,async value=>{
  const bill=bills.find(b=>b.id===Number(value.billId));
  await command('/patient-payments/allocate',{action:'offset',patientId:q.patient.id,expectedFundsRevision:q.funds.revision,paymentId:payment.id,expectedPaymentRevision:payment.revision,allocations:[{billId:bill.id,expectedRevision:bill.revision,amountCents:yuanCents(value.amountYuan),reason:value.reason}]},'finance-offset');
 });
}
function financeApply(request=null){
 const q=financeView.bills,f=financeView.fees,bills=q.items,payments=f.funds.payments.filter(p=>p.status==='到账已确认');
 const sources=request?`<p>保留原账目 ${request.bill_id||'无'} 与原付款 ${request.patient_payment_id||'无'}，重新核对现状后提交。</p>`:
  `${select('billId','原账目（无应收调整时可不选）','<option value="none">不涉及账目调整</option>'+options(bills,b=>b.record_no))}${select('paymentId','原付款（申请退款时应核对原款）','<option value="none">仅涉及原账目</option>'+options(payments,p=>p.recordNo+' / '+p.channel+' / 净额'+clinicalMoney(p.netCents)))}`;
 openEditor(request?'修订并重新提交费用申请':'提交费用调整或普通退费申请',sources+`${input('adjustmentYuan','拟调整应收（元，减少填负数；仅退预付填0）',request?(request.proposed_adjustment_cents/100).toFixed(2):'0')}${input('refundYuan','拟退回原款（元；仅调整填0）',request?(request.proposed_refund_cents/100).toFixed(2):'0')}${clinicalText('reason','实际申请原因',request?.reason||'')}${clinicalText('evidence','原单核对与申请依据',request?.evidence||'')}${clinicalConfirm('已核对原账目、原付款与申请范围，提交负责人审核')}`,async value=>{
  const billId=request?request.bill_id:value.billId==='none'?null:Number(value.billId),paymentId=request?request.patient_payment_id:value.paymentId==='none'?null:Number(value.paymentId);
  await command('/fee-requests/apply',{action:request?'resubmit':'submit',...(request?{requestId:request.id,expectedRevision:request.revision}:{}),...financeRefs(billId,paymentId),adjustmentCents:signedYuan(value.adjustmentYuan),refundCents:yuanCents(value.refundYuan),reason:value.reason,evidence:value.evidence},'finance-apply');
 });
}
function financeWithdraw(request){
 openEditor('撤回待审核申请',`<p>${esc(request.record_no)}</p>${clinicalText('reason','撤回原因')}${clinicalConfirm('确认撤回此待审核申请，保留原款和申请历史')}`,async value=>{
  await command('/fee-requests/apply',{action:'withdraw',requestId:request.id,expectedRevision:request.revision,...financeRefs(request.bill_id,request.patient_payment_id),reason:value.reason},'finance-withdraw');
 });
}
function financeReview(request,action){
 const f=financeView.fees;
 let body=`<p>${esc(f.patient.name)} · ${esc(f.patient.recordNo)}<br>${esc(request.record_no)}</p><div class="clinical-note">${esc(request.reason)}<br>${esc(request.evidence)}</div><p>申请应收调整${clinicalMoney(request.proposed_adjustment_cents)}，申请退回${clinicalMoney(request.proposed_refund_cents)}。</p>`;
 const lines=request.billSource?.items.filter(i=>i.pricing_status==='已核价')||[],purposes=[];
 for(const payment of f.funds.payments.filter(p=>!request.patient_payment_id||p.id===request.patient_payment_id))for(const [kind,list]of [['allocation',payment.allocations],['offset',payment.offsets]])for(const p of list.filter(p=>p.amount_cents>0&&p.bill_id===request.bill_id)){
  const remaining=list.filter(n=>n.original_id===p.id).reduce((sum,n)=>sum+BigInt(n.amount_cents),BigInt(p.amount_cents));
  if(remaining>0n)purposes.push({...p,kind,payment,remaining:Number(remaining)});
 }
 if(action==='approve'){
  body+=input('adjustmentYuan','批准应收调整（元，减少填负数）',(request.proposed_adjustment_cents/100).toFixed(2))+input('refundYuan','批准退回原款（元）',(request.proposed_refund_cents/100).toFixed(2));
  for(const line of lines)body+=`<fieldset><legend>${esc(line.service_name)} · 原数量${quantityText(line.quantity,{quantity_scale:line.quantity_scale||0})} · 原单价${clinicalMoney(line.unit_price_cents)}</legend>${input('line'+line.id,'该项应收调整（元，不调整填0）','0')}${input('lineNote'+line.id,'该项调整依据（不调整可留空）','','text',false)}</fieldset>`;
  if(purposes.length)body+='<h3>原付款用途释放</h3><p>应收减少后，须核对是否释放已分配或抵扣的原款。释放不会产生实际退款。</p>';
  for(const p of purposes)body+=input('release'+p.kind+p.id,`${p.payment.recordNo} / ${p.kind==='offset'?'抵扣':'付款分配'} #${p.id}，剩余${clinicalMoney(p.remaining)}；本次释放（元）`,'0');
 }
 body+=clinicalText('reviewNote','负责人审核意见')+clinicalConfirm('已核对申请及原单现状，批准范围、明细和原款用途按本次填写共同办理');
 openEditor({approve:'审核费用及普通退款',return:'退回申请补充',reject:'拒绝本次申请'}[action],body,async value=>{
  const payload={action,patientId:f.patientId,requestId:request.id,expectedRevision:request.revision,reviewNote:value.reviewNote};
  if(action==='approve')Object.assign(payload,{...financeRefs(request.bill_id,request.patient_payment_id),adjustmentCents:signedYuan(value.adjustmentYuan),refundCents:yuanCents(value.refundYuan),
   items:lines.map(line=>({billItemId:line.id,expectedRevision:line.revision,amountCents:signedYuan(value['line'+line.id]),note:value['lineNote'+line.id]})).filter(i=>i.amountCents!==0),
   releases:purposes.map(p=>({kind:p.kind,id:p.id,expectedRevision:p.revision,amountCents:yuanCents(value['release'+p.kind+p.id]),reason:value.reviewNote})).filter(p=>p.amountCents>0)});
  await command('/fee-request-decisions/approve',payload,'finance-review');
 });
}
function financeRefund(request,previous=null){
 const f=financeView.fees,payments=f.funds.payments.filter(p=>p.status==='到账已确认'&&p.availableCents>0&&(!request.patient_payment_id||p.id===request.patient_payment_id)&&(!request.bill_id||request.patient_payment_id||[...p.allocations,...p.offsets].some(a=>a.bill_id===request.bill_id&&a.amount_cents>0)));
 if(!payments.length)throw new Error('没有本申请范围内的可退原款，请刷新并核对其他用途或退款占用');
 openEditor(previous?'按失败原办理重新受理':'建立普通退款办理',`<p>${esc(request.record_no)} · 批准剩余${clinicalMoney(request.remainingApprovedRefundCents)}</p>${previous?`<p>承接最近失败办理 ${esc(previous.record_no)}。</p>`:''}${select('paymentId','核对原付款','<option value="">请选择实际原付款</option>'+options(payments,p=>p.recordNo+' / '+p.channel+' / 可退'+clinicalMoney(p.availableCents)))}${input('amountYuan','本次拟退金额（元）')}${select('channel','实际退款渠道','<option value="">请选择实际渠道</option>'+options(['现金','银行卡','微信','支付宝'].map(x=>({id:x,name:x})),x=>x.name))}${clinicalText('recipientVerification','接收方身份、账户及原付款核实依据')}${clinicalConfirm('已核对原款、批准范围与接收方；先取得办理号，再办理和核实实际退款')}`,async value=>{
  await command('/patient-refunds/refund',{action:'initiate',requestId:request.id,expectedApprovalRevision:request.revision,...financeRefs(request.bill_id,Number(value.paymentId)),amountCents:yuanCents(value.amountYuan),channel:value.channel,recipientVerification:value.recipientVerification,...(previous?{previousAttemptId:previous.id}:{})},'finance-refund');
 });
 const paymentSelector=$('#editor [name=paymentId]'),channelSelector=$('#editor [name=channel]');
 const syncChannel=()=>{const original=payments.find(p=>p.id===Number(paymentSelector.value));channelSelector.innerHTML=original?`<option value="${esc(original.channel)}">${esc(original.channel)}（原付款渠道）</option>`:'<option value="">先选择原付款</option>';};paymentSelector.onchange=syncChannel;syncChannel();
}
function financeVerifyRefund(refund){
 const f=financeView.fees;
 openEditor('按原办理号核实退款结果',`<p>${esc(refund.record_no)} · ${esc(refund.channel)} · 申请${clinicalMoney(refund.requested_cents)}</p>${select('outcome','实际核实结果','<option value="">请选择实际结果</option><option value="unknown">结果仍不明确，继续核实</option><option value="success">已核实实际退回</option><option value="failed">已核实失败且未退回</option>')}${input('actualYuan','实际退回金额（元，结果不明可留空）','','text',false)}${input('externalReference','退款交易号（非现金成功必填）',refund.external_reference||'','text',false)}${clinicalText('transactionEvidence','渠道结果及实际核实依据')}${clinicalText('verificationNote','核实结论')}<label><input type="checkbox" name="recipientMatches">已核实实际接收方与原办理信息一致</label>${clinicalConfirm('已按原办理号核对，本次不另行重复线下退款')}`,async value=>{
  const result=await command('/patient-refunds/refund',{action:'verify',patientId:f.patientId,refundId:refund.id,expectedRevision:refund.revision,expectedFundsRevision:f.funds.revision,outcome:value.outcome,actualCents:yuanCents(value.actualYuan,true),recipientMatches:value.recipientMatches==='on',externalReference:value.externalReference||null,transactionEvidence:value.transactionEvidence,verificationNote:value.verificationNote},'finance-refund-verify');
  if(result.code==='REFUND_REVIEW_REQUIRED')notice('本次报告金额、接收信息或凭据不符，退款仍保留待核实状态和原额度占用。',true);
 });
}
async function renderFinance(version){
 if(!['cashier','manager'].includes(state.role)){resetFinance();throw new Error('当前岗位不能进入收费与退费页面');}
 const manager=state.role==='manager';
 if(!financeView.patientId){
  const data=await api('/finance/patients?q='+encodeURIComponent(financeView.search));if(version!==renderVersion)return;
  $('#page-actions').innerHTML='';$('#filters').innerHTML=`<label>姓名、电话或完整患者号<input id="finance-search" value="${esc(financeView.search)}"></label><button id="find-finance-patient">查找患者</button>`;
  $('#content').innerHTML=data.items.length?table(['患者身份','联系电话','办理'],data.items.map(p=>`<tr><td>${esc(p.name)}<small>${esc(p.record_no)}</small></td><td>${esc(p.phone||'未提供')}<small>${esc(p.phone_owner)}</small></td><td><button data-finance-patient="${p.id}">${manager?'审核费用申请':'核对账目与原款'}</button></td></tr>`)):empty(manager?'没有符合条件的费用申请患者。':'没有找到患者，请重新核对身份线索。');
  $('#find-finance-patient').onclick=()=>{financeView.search=$('#finance-search').value;clinicalAction(render);};
  document.querySelectorAll('[data-finance-patient]').forEach(b=>b.onclick=()=>{financeView.patientId=Number(b.dataset.financePatient);financeView.billPage=financeView.requestPage=1;clinicalAction(render);});return;
 }
 const id=financeView.patientId,[fees,bills]=await Promise.all([api('/fee-requests/query?patientId='+id+'&page='+financeView.requestPage),manager?null:api('/patient-bills/query?patientId='+id+'&page='+financeView.billPage)]);if(version!==renderVersion)return;
 financeView.fees=fees;financeView.bills=bills;
 const f=fees.funds;$('#filters').innerHTML='';$('#page-actions').innerHTML='<button id="back-finance">返回患者查找</button><button id="refresh-finance">刷新核对</button>'+(!manager?'<button id="receive-money" class="primary">登记实际收款</button><button id="receive-electronic-prepayment">建立电子预收原单</button>'+ (f.id?'<button id="apply-fee">费用与普通退费申请</button>':''):'');
 let html=`<section class="clinical-summary"><h2>${esc(fees.patient.name)} <small>${esc(fees.patient.recordNo)}</small></h2><p>已确认原收 ${clinicalMoney(f.confirmedReceivedCents)} · 待核实 ${clinicalMoney(f.pendingPaymentCents)} · 已退 ${clinicalMoney(f.refundedCents)}</p><p>可用原款 ${clinicalMoney(f.availableCents)} · 退款占用 ${clinicalMoney(f.refundHeldCents)}</p></section>`;
 if(bills){
  html+=`<h2 class="subheading">账目与实际费用</h2><p>合计应收${clinicalMoney(bills.totals.receivableCents)} · 未付${clinicalMoney(bills.totals.unpaidCents)} · 待核价${bills.totals.pendingPricingCount}项</p>`;
  for(const bill of bills.items){html+=`<section class="clinical-plan"><h3>${esc(bill.record_no)}</h3><p>应收${clinicalMoney(bill.summary.receivableCents)} · 医保承担${clinicalMoney(bill.summary.insuranceCents)} · 患者承担${clinicalMoney(bill.summary.patientDueCents)} · 已分配${clinicalMoney(bill.summary.allocatedCents)} · 预付抵扣${clinicalMoney(bill.summary.offsetCents)} · 未付${clinicalMoney(bill.summary.unpaidCents)}${bill.summary.pendingPricingCount?' · 有待核价项目':''}</p>${bill.summary.unpaidCents>0&&!bill.summary.pendingPricingCount?`<button data-electronic-order="${bill.id}">建立电子支付原单</button>`:''}`+table(['实际项目','数量 / 单价','核价情况'],bill.items.map(i=>`<tr><td>${esc(i.service_name)}${i.has_clinical_correction?'<small>临床已有独立更正，请核对费用申请</small>':''}</td><td>${quantityText(i.quantity,{quantity_scale:i.quantity_scale||0})} / ${clinicalMoney(i.unit_price_cents)}</td><td>${esc(i.pricing_status)}<small>${esc(i.pricing_note)}</small></td></tr>`))+'</section>';}
  if(!bills.items.length)html+=empty('没有符合本页条件的实际费用，方案预计费用不形成应收。');
  html+=financePagination('bill',financeView.billPage,bills.total,bills.pageSize);
 }
 if(bills?.paymentOrders?.length)html+='<h2 class="subheading">电子支付原单与预收</h2>'+table(['原单 / 用途','金额 / 结果','办理'],bills.paymentOrders.map(o=>`<tr><td>${esc(o.business_no)}<small>${o.bill_id?'账目#'+o.bill_id:'患者预收，未指定账目'} / ${esc(o.channel)}</small></td><td>${clinicalMoney(o.amount_cents)}<small>${esc(o.status)}</small></td><td>${!['已成功','已失败','已关闭'].includes(o.status)?`<button data-finance-order-result="${o.id}">核实原支付结果</button>`:''}</td></tr>`));
 html+='<h2 class="subheading">原付款与用途</h2>'+(f.payments.length?table(['原款 / 渠道','原登记金额 / 找零','到账 / 可用','用途','办理'],f.payments.map(p=>`<tr><td>${esc(p.recordNo)}<small>${esc(p.channel)} / ${esc(p.externalReference||'无渠道号')}</small></td><td>${clinicalMoney(p.receivedCents)}<small>找零${clinicalMoney(p.changeCents)} / 登记净额${clinicalMoney(p.netCents)}</small></td><td>${esc(p.status)}<small>可用${clinicalMoney(p.availableCents)} / 退款占用${clinicalMoney(p.refundHeldCents)}</small></td><td>分配${clinicalMoney(p.allocatedCents)}<small>抵扣${clinicalMoney(p.offsetCents)} / 已退${clinicalMoney(p.refundedCents)}</small></td><td>${!manager&&p.status==='待核实'?`<button data-verify-payment="${p.id}">核实原付款</button>`:''}${!manager&&p.availableCents>0?`<button data-offset-payment="${p.id}">抵扣账目</button>`:''}</td></tr>`)):empty('尚无实际付款记录。'));
 html+='<h2 class="subheading">费用申请与普通退款</h2>';
 for(const r of fees.items){html+=`<section class="clinical-plan"><h3>${esc(r.record_no)} · ${esc(r.status)}</h3><p>${esc(r.reason)}</p><p>申请应收调整${clinicalMoney(r.proposed_adjustment_cents)} / 退回${clinicalMoney(r.proposed_refund_cents)}</p>${r.review_note?`<p>负责人意见：${esc(r.review_note)}</p>`:''}`;
  if(r.status==='已同意')html+=`<p>批准应收调整${clinicalMoney(r.approved_adjustment_cents)} / 退回${clinicalMoney(r.approved_refund_cents)} · 待办理批准余额${clinicalMoney(r.remainingApprovedRefundCents)}</p>`;
  html+='<div class="actions">';
  if(manager&&r.status==='待审核')for(const action of ['approve','return','reject'])html+=`<button data-fee-review="${r.id}" data-review-action="${action}">${{approve:'审核批准',return:'退回补充',reject:'拒绝申请'}[action]}</button>`;
  if(!manager&&r.status==='待审核'&&r.canWithdraw)html+=`<button data-fee-withdraw="${r.id}">撤回申请</button>`;
  if(!manager&&r.status==='已退回')html+=`<button data-fee-resubmit="${r.id}">修订重提</button>`;
  const last=r.refunds.at(-1);
  if(!manager&&r.status==='已同意'&&r.remainingApprovedRefundCents>0&&!r.refunds.some(x=>['待办理','待核实'].includes(x.status)))html+=`<button data-initiate-refund="${r.id}">${last?.status==='已失败'?'承接失败办理重新受理':'建立退款办理'}</button>`;
  html+='</div>';
  if(r.adjustment)html+=`<p>已另行登记费用调整，原收费明细保留。</p>`;
  if(r.refunds.length)html+=table(['办理号 / 渠道','拟退 / 实退','结果','办理'],r.refunds.map(x=>`<tr><td>${esc(x.record_no)}<small>${esc(x.channel)} / ${esc(x.external_reference||'无渠道号')}</small></td><td>${clinicalMoney(x.requested_cents)} / ${clinicalMoney(x.actual_cents)}</td><td>${esc(x.status)}<small>${esc(x.verification_note||'按办理号核实')}</small></td><td>${!manager&&['待办理','待核实'].includes(x.status)?`<button data-verify-refund="${x.id}">核实原退款</button>`:''}</td></tr>`));
  if(r.history.length)html+='<details data-fee-history="'+r.id+'"><summary>申请与审核完整快照（'+r.history.length+'次）</summary>'+table(['提交批次 / 阶段','当时申请及证据','当时审核结果'],r.history.map(h=>`<tr><td>第${h.submission_no}次提交 · ${esc(h.event_type)}<small>${esc(h.actor_name)} · ${esc(localDateTimeSeconds(h.occurred_at))}</small></td><td>拟调整${clinicalMoney(h.proposed_adjustment_cents)} / 拟退${clinicalMoney(h.proposed_refund_cents)}<small>${esc(h.proposalReason)}</small><small>证据：${esc(h.evidence)}</small></td><td>${esc(h.status)}<small>批准调整${clinicalMoney(h.approved_adjustment_cents)} / 退款上限${clinicalMoney(h.approved_refund_cents)}</small><small>${esc(h.review_note||h.event_reason)}</small></td></tr>`))+'</details>';
  if(r.legacyHistory?.length)html+='<details><summary>早期审计记录（无完整快照）</summary>'+r.legacyHistory.map(h=>`<p>${esc(localDateTimeSeconds(h.occurredAt))} · ${esc(h.reason)}</p>`).join('')+'</details>';
  html+='<p class="muted">'+esc(r.historyCoverage||'')+'</p></section>';
 }
 if(!fees.items.length)html+=empty('尚无费用调整或普通退款申请。');html+=financePagination('request',financeView.requestPage,fees.total,fees.pageSize);$('#content').innerHTML=html;
 $('#back-finance').onclick=()=>{resetFinance();clinicalAction(render);};$('#refresh-finance').onclick=()=>clinicalAction(render);
 if(!manager){$('#receive-money').onclick=()=>clinicalAction(()=>financeReceive());if($('#apply-fee'))$('#apply-fee').onclick=()=>clinicalAction(()=>financeApply());}
 const bind=(selector,fn)=>document.querySelectorAll(selector).forEach(b=>b.onclick=()=>clinicalAction(()=>fn(b)));
 if($('#receive-electronic-prepayment'))$('#receive-electronic-prepayment').onclick=()=>clinicalAction(electronicPrepayment);bind('[data-finance-order-result]',b=>electronicResult(bills.paymentOrders.find(o=>o.id===Number(b.dataset.financeOrderResult))));
 bind('[data-electronic-order]',b=>electronicOrder(bills.items.find(x=>x.id===Number(b.dataset.electronicOrder))));
 bind('[data-verify-payment]',b=>financeReceive(f.payments.find(p=>p.id===Number(b.dataset.verifyPayment))));bind('[data-offset-payment]',b=>financeOffset(f.payments.find(p=>p.id===Number(b.dataset.offsetPayment))));
 bind('[data-fee-review]',b=>financeReview(fees.items.find(r=>r.id===Number(b.dataset.feeReview)),b.dataset.reviewAction));bind('[data-fee-withdraw]',b=>financeWithdraw(fees.items.find(r=>r.id===Number(b.dataset.feeWithdraw))));bind('[data-fee-resubmit]',b=>financeApply(fees.items.find(r=>r.id===Number(b.dataset.feeResubmit))));
 bind('[data-initiate-refund]',b=>{const r=fees.items.find(r=>r.id===Number(b.dataset.initiateRefund)),last=r.refunds.at(-1);return financeRefund(r,last?.status==='已失败'?last:null);});bind('[data-verify-refund]',b=>financeVerifyRefund(fees.items.flatMap(r=>r.refunds).find(r=>r.id===Number(b.dataset.verifyRefund))));
 bind('[data-finance-page]',b=>{financeView[b.dataset.financePage==='bill'?'billPage':'requestPage']=Number(b.dataset.pageNumber);return render();});
}
function financePagination(kind,page,total,size){return total>size?`<p>第${page}页 / 共${Math.ceil(total/size)}页 ${page>1?`<button data-finance-page="${kind}" data-page-number="${page-1}">上一页</button>`:''}${page*size<total?`<button data-finance-page="${kind}" data-page-number="${page+1}">下一页</button>`:''}</p>`:'';}
