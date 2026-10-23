'use strict';
const inventoryView={tab:'stock',page:1,material:'',status:'',options:null};
function resetInventory(){Object.assign(inventoryView,{tab:'stock',page:1,material:'',status:'',options:null});}
function scaledQuantity(value,scale){
 value=value.trim();if(!/^\d+(?:\.\d+)?$/.test(value))throw new Error('数量请填写非负数字');
 const [whole,fraction='']=value.split('.');if(fraction.length>scale)throw new Error('该材料数量最多保留'+scale+'位小数');
 const n=BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0')||'0');if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('数量超出可处理范围');return Number(n);
}
function quantityText(value,material){
 const n=BigInt(value),scale=material.quantity_scale,negative=n<0n,a=negative?-n:n,base=10n**BigInt(scale),fraction=scale?(a%base).toString().padStart(scale,'0').replace(/0+$/,''):'';
 return (negative?'-':'')+(a/base).toString()+(fraction?'.'+fraction:'');
}
const quantityLabel=(value,material)=>quantityText(value,material)+' '+material.base_unit;
async function inventoryMaterial(material=null){
 const billingServices=(await api('/inventory/options')).billingServices||[];
 openEditor(material?'维护材料资料':'建立材料资料',`${input('name','材料名称',material?.name)}${input('specification','规格',material?.specification)}<div class="form-grid">${input('baseUnit','库存基本单位',material?.base_unit)}${input('purchaseUnit','采购单位',material?.purchase_unit)}${input('conversionNumerator','1采购单位折合基本单位的分子',material?.conversion_numerator||1,'number')}${input('conversionDenominator','换算分母',material?.conversion_denominator||1,'number')}${input('quantityScale','数量允许的小数位（0—6）',material?.quantity_scale??0,'number')}</div>${select('requiresTrace','是否需要批次追溯',options([{id:'yes',name:'需要'},{id:'no',name:'不作逐批追溯要求'}],x=>x.name,material?.requires_trace===0?'no':'yes'))}${select('requiresExpiry','有效期是否适用',options([{id:'yes',name:'需要核实有效期'},{id:'no',name:'实物无适用有效期'}],x=>x.name,material?.requires_expiry===0?'no':'yes'))}${select('isDrug','目录分类',options([{id:'no',name:'诊疗材料'},{id:'yes',name:'处方药品（须核实名称及规格）'}],x=>x.name,material?.is_drug?'yes':'no'))}${select('billingServiceId','药品对应收费项目（院外取药或普通材料可留空）','<option value="">未对应院内收费项目</option>'+options(billingServices,s=>s.name+' / '+s.billing_unit,material?.billing_service_id),false)}${clinicalText('reason','实物资料与单位核对依据')}${clinicalConfirm('已核对实物、基本单位及换算，提交负责人确认使用要求')}`,async value=>{
  await command('/material-batches/record',{action:'material',...(material?{materialId:material.id,expectedRevision:material.revision}:{}),name:value.name,specification:value.specification,baseUnit:value.baseUnit,purchaseUnit:value.purchaseUnit,conversionNumerator:Number(value.conversionNumerator),conversionDenominator:Number(value.conversionDenominator),quantityScale:Number(value.quantityScale),requiresTrace:value.requiresTrace==='yes',requiresExpiry:value.requiresExpiry==='yes',isDrug:value.isDrug==='yes',billingServiceId:value.billingServiceId?Number(value.billingServiceId):null,reason:value.reason},'inventory-material');
 });
}
function inventoryMaterialApprove(material,active=true){
 openEditor(active?'核对并启用材料':'停用材料',`<p>${esc(material.name)} / ${esc(material.specification)}<br>目录分类：${material.is_drug?'处方药品':'诊疗材料'}${material.is_drug?'<br>对应收费项目：'+esc(inventoryView.options?.billingServices?.find(s=>s.id===material.billing_service_id)?.name||'未设置，仅可选择院外取药'):''}<br>1 ${esc(material.purchase_unit)} = ${material.conversion_numerator}/${material.conversion_denominator} ${esc(material.base_unit)}；数量精度${material.quantity_scale}位。</p>${clinicalText('reason','负责人核对依据')}${clinicalConfirm('已核对材料单位、换算及使用要求，确认本次处理')}`,async value=>{
  await command('/material-batches/approve',{action:active?'confirmMaterial':'deactivateMaterial',materialId:material.id,expectedRevision:material.revision,reason:value.reason},'inventory-material-review');
 });
}
function inventoryLocation(){
 openEditor('登记实际存放位置',`${input('name','存放位置名称')}${input('purpose','实际存放用途')}${clinicalText('reason','登记依据')}`,async value=>{await command('/material-batches/record',{action:'location',...value},'inventory-location');});
}
function inventoryBatch(material=null){
 const materials=inventoryView.options.materials.filter(m=>m.is_active&&m.confirmed_at);if(!materials.length)throw new Error('请先建立材料，并由负责人确认单位和使用要求');
 openEditor('登记实物批次',`${select('materialId','已确认材料','<option value="">请选择核对后的材料</option>'+options(materials,m=>m.name+' / '+m.specification,material?.id))}${input('batchNo','实际批号或可核对的实物批次标识')}${input('expiryDate','实物有效期（无适用效期的材料可留空）','','date',false)}${clinicalText('sourceNote','实物来源与到货依据')}<p>登记后为待检，不因此产生可领用库存。</p>`,async value=>{
  await command('/material-batches/record',{action:'batch',materialId:Number(value.materialId),batchNo:value.batchNo,expiryDate:value.expiryDate||null,sourceNote:value.sourceNote},'inventory-batch');
 });
}
function inventoryBatchAction(batch,action){
 const labels={isolate:'立即隔离批次',release:'核实并放行批次',restore:'核验后恢复使用',disable:'停用批次',verifyExpiry:'核实实物有效期'};
 openEditor(labels[action],`<p>${esc(batch.batch_no)} · ${esc(batch.status)}</p>${action==='verifyExpiry'?input('expiryDate','核实后的实物有效期',batch.expiry_date||'','date'):''}${clinicalText('reason','实际核对及处理依据')}${clinicalConfirm('已核对该实物批次，按本次实际情况处理')}`,async value=>{
  await command(action==='isolate'?'/material-batches/record':'/material-batches/approve',{action,batchId:batch.id,expectedRevision:batch.revision,reason:value.reason,...(action==='verifyExpiry'?{expiryDate:value.expiryDate}:{})},'inventory-batch-state');
 });
}
function originalIssues(entry){return entry.movements.filter(m=>m.movement_type==='领用').map(m=>({...m,remaining:Number(entry.movements.filter(r=>r.original_movement_id===m.id&&r.movement_type==='未用退回').reduce((n,r)=>n-BigInt(r.delta_scaled),-BigInt(m.delta_scaled))-entry.usages.filter(u=>u.inventory_movement_id===m.id).reduce((n,u)=>n+BigInt(u.quantity_scaled),0n))})).filter(m=>m.remaining>0);}
async function inventoryMovement(entry,action,count=null){
 const {stock,material,batch,location}=entry,current=await api('/status'),issues=['return','use'].includes(action)?originalIssues(entry):[];
 if(['return','use'].includes(action)&&!issues.length)throw new Error('没有尚可追溯使用或退回的原领用余额');
 let visits=[],body=`<p>${esc(material.name)} · ${esc(batch.batch_no)} · ${esc(location.name)}<br>账面${esc(quantityLabel(stock.quantity_scaled,material))}，当前可领用${esc(quantityLabel(entry.availableQuantityScaled,material))}。</p>`;
 if(['return','use'].includes(action))body+=select('originalMovementId','核对原领用','<option value="">请选择本次实际来源</option>'+options(issues,m=>`原领用 #${m.id} / 尚可追溯${quantityLabel(m.remaining,material)}`));
 body+=input('quantity','本次'+(['count','recount'].includes(action)?'实际盘点数量':'实际数量')+'（'+material.base_unit+'）',['count','recount'].includes(action)?quantityText(count?.counted_quantity_scaled??stock.quantity_scaled,material):'');
 if(['count','recount'].includes(action))body+=input('countedAt','实际盘点时间',localDateTimeSeconds(current.now),'datetime-local');
 if(action==='use'){
  visits=(await api('/inventory/usage-options?date='+current.businessDate)).visits;
  body+=input('usageDate','查找实际接诊日期',current.businessDate,'date')+'<button id="find-usage-visits" type="button">查找该日实际接诊</button>'+select('visitId','核对实际使用患者和就诊','<option value="">请选择实际接诊</option>'+options(visits,v=>v.patient_name+' / '+v.patient_no+' / '+v.record_no))+input('usedAt','实际使用时间',localDateTimeSeconds(current.now),'datetime-local')+'<p>记录用料去向，领用时已扣库，本次不再次扣库。</p>';
 }
 body+=clinicalText('reason','实际用途、去向或盘点依据')+clinicalConfirm('已核对实物、数量和原始来源，按实际情况登记');
 openEditor({issue:'登记实际领用',return:'登记未用实物退回',use:'记录实际用料去向',count:'登记实物盘点',recount:'重新核对盘点'}[action],body,async value=>{
  const qty=scaledQuantity(value.quantity,material.quantity_scale),visit=visits.find(v=>v.id===Number(value.visitId));if(action==='use'&&!visit)throw new Error('请先选择真实的患者接诊记录');
  await command('/inventory-commands/record',{action,stockId:stock.id,expectedStockRevision:stock.revision,reason:value.reason,...(['count','recount'].includes(action)?{countedQuantityScaled:qty,countedAt:stamp(value.countedAt),...(count?{countId:count.id,expectedRevision:count.revision}:{})}:{quantityScaled:qty}),...(['return','use'].includes(action)?{originalMovementId:Number(value.originalMovementId)}:{}),...(visit?{visitId:visit.id,patientId:visit.patient_id,usedAt:stamp(value.usedAt)}:{})},'inventory-movement');
 });
 if(action==='use')$('#find-usage-visits').onclick=()=>clinicalAction(async()=>{visits=(await api('/inventory/usage-options?date='+$('#editor [name=usageDate]').value)).visits;$('#editor [name=visitId]').innerHTML='<option value="">请选择实际接诊</option>'+options(visits,v=>v.patient_name+' / '+v.patient_no+' / '+v.record_no);});
}
function inventoryCountReview(count,entry,approve){
 const m=entry.material;
 openEditor(approve?'核对盘点差异':'不予调整盘点',`<p>${esc(m.name)} · ${esc(entry.batch.batch_no)} / ${esc(entry.location.name)}<br>原快照${esc(quantityLabel(count.snapshot_quantity_scaled,m))}，实点${esc(quantityLabel(count.counted_quantity_scaled,m))}，当前账面${esc(quantityLabel(entry.stock.quantity_scaled,m))}。</p>${clinicalText('reviewNote','负责人核对依据')}${clinicalConfirm('已核对实物、快照及盘点期间变动，确认本次处理')}`,async value=>{
  const r=await command('/inventory-commands/approve',{action:approve?'approveCount':'reject',countId:count.id,expectedRevision:count.revision,reviewNote:value.reviewNote},'inventory-count-review');if(r.code==='COUNT_RECHECK_REQUIRED')notice('盘点期间库存已变化，原差异未调整，请助理重新核对实物后提交。',true);
 });
}
function inventorySupplier(supplier=null){
 openEditor(supplier?'维护基础供应商资料':'登记基础供应商',`${input('name','供应商名称',supplier?.name)}${input('contactName','联系人',supplier?.contact_name)}${input('phone','联系电话',supplier?.phone)}${input('address','联系地址（可留空）',supplier?.address||'','text',false)}${clinicalText('settlementBasis','供货约定及供应商核验依据',supplier?.settlement_basis||'')}${select('isActive','是否继续供货',options([{id:'yes',name:'启用'},{id:'no',name:'停用'}],x=>x.name,supplier?.is_active===0?'no':'yes'))}${clinicalText('reason','资料建立或变更依据')}`,async value=>{
  await command('/purchases/supplier',{...(supplier?{supplierId:supplier.id,expectedRevision:supplier.revision}:{}),name:value.name,contactName:value.contactName,phone:value.phone,address:value.address||null,settlementBasis:value.settlementBasis,isActive:value.isActive==='yes',reason:value.reason},'inventory-supplier');
 });
}
function purchaseItemRow(materials,item=null){
 return `<fieldset class="purchase-item-row" data-id="${item?.id||''}"><legend>采购项目</legend>${select('materialId','核对已确认材料','<option value="">请选择材料</option>'+options(materials,m=>m.name+' / 基本单位'+m.base_unit+' / 采购单位'+m.purchase_unit,item?.material_id))}${input('quantity','约定采购数量（按材料基本单位填写）')}${input('priceYuan','每采购单位单价（元）')}</fieldset>`;
}
async function inventoryPurchase(data){
 const materials=inventoryView.options.materials.filter(m=>m.is_active&&m.confirmed_at),suppliers=data.suppliers.filter(s=>s.is_active),current=await api('/status');
 if(!materials.length||!suppliers.length)throw new Error('请先确认材料单位，并由负责人登记可供货的供应商');
 openEditor('提出基础采购需求',`${select('supplierId','供货供应商','<option value="">请选择核实后的供应商</option>'+options(suppliers,s=>s.name))}${input('agreedAt','供货约定记录时间',localDateTimeSeconds(current.now),'datetime-local')}${clinicalText('deliveryTerms','交付日期、地点及实际约定')}${clinicalText('reason','采购需求依据')}<div id="purchase-item-rows">${purchaseItemRow(materials)}</div><button id="add-purchase-item" type="button">增加采购材料</button>${clinicalConfirm('已核对需求及材料单位，提交负责人确认；此时不增加库存')}`,async value=>{
  const supplier=suppliers.find(s=>s.id===Number(value.supplierId)),items=[...document.querySelectorAll('.purchase-item-row')].map(el=>{const m=materials.find(m=>m.id===Number(el.querySelector('[name=materialId]').value));return {materialId:m.id,expectedMaterialRevision:m.revision,orderedQuantityScaled:scaledQuantity(el.querySelector('[name=quantity]').value,m.quantity_scale),unitPriceCents:yuanCents(el.querySelector('[name=priceYuan]').value)};});
  await command('/purchases/draft',{action:'create',supplierId:supplier.id,expectedSupplierRevision:supplier.revision,agreedAt:stamp(value.agreedAt),deliveryTerms:value.deliveryTerms,reason:value.reason,items},'inventory-purchase');
 });$('#add-purchase-item').onclick=()=>$('#purchase-item-rows').insertAdjacentHTML('beforeend',purchaseItemRow(materials));
}
function inventoryPurchaseItem(purchase,item){
 const m=inventoryView.options.materials.find(m=>m.id===item.material_id);
 openEditor('核对待确认采购项目',`<p>${esc(m.name)} · 基本单位${esc(m.base_unit)}，采购单位${esc(item.purchase_unit)}。</p>${input('quantity','约定数量（基本单位）',quantityText(item.ordered_quantity_scaled,m))}${input('priceYuan','每采购单位单价（元）',(item.unit_price_cents/100).toFixed(2))}${clinicalText('reason','实际修订依据')}`,async value=>{
  await command('/purchases/draft',{action:'updateItem',purchaseId:purchase.id,expectedRevision:purchase.revision,itemId:item.id,expectedItemRevision:item.revision,materialId:m.id,expectedMaterialRevision:m.revision,orderedQuantityScaled:scaledQuantity(value.quantity,m.quantity_scale),unitPriceCents:yuanCents(value.priceYuan),reason:value.reason},'inventory-purchase-item');
 });
}
function inventoryPurchaseReview(purchase,data,approve){
 const supplier=data.suppliers.find(s=>s.id===purchase.supplier_id);
 openEditor(approve?'负责人确认采购':'取消待确认采购',`<p>${esc(purchase.record_no)} · ${esc(supplier.name)}</p><p>${esc(purchase.delivery_terms)}</p>${clinicalText('reviewNote','供应商、数量和交付安排核对意见')}${clinicalConfirm('已核对材料、单位、数量和供货安排，确认本次办理')}`,async value=>{
  await command('/purchases/approve',{action:approve?'approve':'cancel',purchaseId:purchase.id,expectedRevision:purchase.revision,expectedSupplierRevision:supplier.revision,reviewNote:value.reviewNote},'inventory-purchase-review');
 });
}
function receiptRow(purchase){
 return `<fieldset class="receipt-item-row"><legend>本次实物验收项目</legend>${select('purchaseItemId','原采购项目','<option value="">请选择本次实际到货项目</option>'+options(purchase.items.filter(i=>!['剩余已取消','履行已完成'].includes(i.status)),i=>inventoryView.options.materials.find(m=>m.id===i.material_id)?.name||'原材料'))}${select('batchId','实物批次','<option value="">先核对原采购项目，再选择批次</option>')}${select('locationId','实际存放位置','<option value="">请选择实物位置</option>'+options(inventoryView.options.locations.filter(l=>l.is_active),l=>l.name))}<div class="form-grid">${input('arrived','实际到货数量（基本单位）')}${input('accepted','本次合格数量','0')}${input('rejected','本次拒收数量','0')}${input('pending','本次待检数量','0')}</div>${clinicalText('inspectionNote','实际检验结论、差异及实物情况')}</fieldset>`;
}
async function inventoryReceive(purchase){
 const current=await api('/status');if(!purchase.items.some(i=>!['剩余已取消','履行已完成'].includes(i.status)))throw new Error('本采购已经完成约定合格量，请查询原验收记录');
 openEditor('登记本次实际到货验收',`<p>${esc(purchase.record_no)}。分批到货分别验收，仅合格量入库；入库后仍须核对批次放行。</p>${input('arrivedAt','实际到货时间',localDateTimeSeconds(current.now),'datetime-local')}${input('deliveryEvidence','本次随货单号及实际来源依据')}<div id="receipt-item-rows">${receiptRow(purchase)}</div><button id="add-receipt-item" type="button">增加到货批次或项目</button>${clinicalConfirm('已逐项核对原采购与实物，合格、拒收和待检之和等于实际到货')}`,async value=>{
  const items=[...document.querySelectorAll('.receipt-item-row')].map(el=>{const get=n=>el.querySelector('[name='+n+']').value,item=purchase.items.find(i=>i.id===Number(get('purchaseItemId'))),m=inventoryView.options.materials.find(m=>m.id===item.material_id);return {purchaseItemId:item.id,expectedItemRevision:item.revision,batchId:Number(get('batchId')),locationId:Number(get('locationId')),arrivedQuantityScaled:scaledQuantity(get('arrived'),m.quantity_scale),acceptedQuantityScaled:scaledQuantity(get('accepted'),m.quantity_scale),rejectedQuantityScaled:scaledQuantity(get('rejected'),m.quantity_scale),pendingQuantityScaled:scaledQuantity(get('pending'),m.quantity_scale),inspectionNote:get('inspectionNote')};});
  await command('/purchase-receipts/receive',{action:'receive',purchaseId:purchase.id,expectedPurchaseRevision:purchase.revision,arrivedAt:stamp(value.arrivedAt),deliveryEvidence:value.deliveryEvidence,items},'inventory-receive');
 });
 const bind=el=>el.querySelector('[name=purchaseItemId]').onchange=()=>{const item=purchase.items.find(i=>i.id===Number(el.querySelector('[name=purchaseItemId]').value));el.querySelector('[name=batchId]').innerHTML='<option value="">请选择核实后的实物批次</option>'+options(inventoryView.options.batches.filter(b=>b.material_id===item?.material_id),b=>b.batch_no+' / '+b.status+' / '+(b.expiry_date||'效期未填'));};
 document.querySelectorAll('.receipt-item-row').forEach(bind);$('#add-receipt-item').onclick=()=>{$('#receipt-item-rows').insertAdjacentHTML('beforeend',receiptRow(purchase));bind($('#receipt-item-rows .receipt-item-row:last-child'));};
}
function inventoryInspection(purchase,receipt,line,manager){
 const item=purchase.items.find(i=>i.id===line.purchase_order_item_id),m=inventoryView.options.materials.find(m=>m.id===item.material_id);
 openEditor(manager?'记录负责人基础验收协调':'登记待检实物后续结论',`<p>${esc(m.name)} · 原到货${esc(quantityLabel(line.arrived_quantity_scaled,m))}<br>合格${esc(quantityLabel(line.accepted_quantity_scaled,m))} / 拒收${esc(quantityLabel(line.rejected_quantity_scaled,m))} / 待检${esc(quantityLabel(line.pending_quantity_scaled,m))}</p><p>${esc(line.inspection_note)}</p>`+(manager?clinicalText('reviewNote','实际差异协调结果、责任与后续安排'):`${input('accepted','本次待检转合格数量（基本单位）','0')}${input('rejected','本次待检转拒收数量','0')}${clinicalText('inspectionNote','本次实际后续检验结论')}`)+clinicalConfirm(manager?'已核对实际差异，记录与供应商协调及后续安排':'已核对原待检量，本次仅追加真实检验结论'),async value=>{
  if(manager)await command('/purchases/approve',{action:'receiptNote',receiptItemId:line.id,expectedItemRevision:line.revision,expectedRevision:receipt.revision,reviewNote:value.reviewNote},'inventory-receipt-note');
  else await command('/purchase-receipts/receive',{action:'inspectPending',receiptId:receipt.id,expectedRevision:receipt.revision,receiptItemId:line.id,expectedItemRevision:line.revision,newAcceptedQuantityScaled:scaledQuantity(value.accepted,m.quantity_scale),newRejectedQuantityScaled:scaledQuantity(value.rejected,m.quantity_scale),inspectionNote:value.inspectionNote},'inventory-inspection');
 });
}
async function renderInventory(version){
 if(!['assistant','manager'].includes(state.role)){resetInventory();throw new Error('当前岗位不能办理物资采购和库存');}
 const manager=state.role==='manager',params=new URLSearchParams({page:inventoryView.page});if(inventoryView.material)params.set('materialId',inventoryView.material);if(inventoryView.status)params.set('status',inventoryView.status);
 const [opts,data]=await Promise.all([api('/inventory/options'),inventoryView.tab==='purchases'?api('/purchases/query?page='+inventoryView.page):inventoryView.tab==='stock'?api('/batch-stock/query?'+params):null]);if(version!==renderVersion)return;inventoryView.options=opts;
 $('#filters').innerHTML='<div class="actions"><button data-inventory-tab="stock">批次库存与用料</button><button data-inventory-tab="materials">材料与批次资料</button><button data-inventory-tab="purchases">基础采购与验收</button></div><button id="refresh-inventory">刷新核对</button>';
 $('#page-actions').innerHTML=inventoryView.tab==='materials'&&!manager?'<button id="new-material" class="primary">建立材料</button><button id="new-batch">登记批次</button><button id="new-location">登记存放位置</button>':inventoryView.tab==='purchases'?(manager?'<button id="new-supplier">登记供应商</button>':'<button id="new-purchase" class="primary">提出采购</button>'):'';
 const material=id=>opts.materials.find(m=>m.id===id),batch=id=>opts.batches.find(b=>b.id===id),bind=(selector,fn)=>document.querySelectorAll(selector).forEach(b=>b.onclick=()=>clinicalAction(()=>fn(b)));
 let html='';
 if(inventoryView.tab==='materials'){
  html='<h2 class="subheading">材料与单位</h2>'+(opts.materials.length?table(['材料 / 规格','基本单位及换算','使用要求','确认情况','办理'],opts.materials.map(m=>`<tr><td>${esc(m.name)}<small>${esc(m.specification)}</small></td><td>${esc(m.base_unit)}<small>1 ${esc(m.purchase_unit)} = ${m.conversion_numerator}/${m.conversion_denominator} ${esc(m.base_unit)}；精度${m.quantity_scale}位</small></td><td>${m.requires_expiry?'需核实效期':'无适用效期'}<small>${m.requires_trace?'需批次追溯':'保留实物批次来源'}</small></td><td>${m.is_active&&m.confirmed_at?'已确认启用':'待确认或已停用'}</td><td>${manager?`<button data-material-review="${m.id}" data-enable="${m.is_active?'no':'yes'}">${m.is_active?'停用':'核对启用'}</button>`:`<button data-material-edit="${m.id}">维护资料</button>`}</td></tr>`)):empty('助理先登记实物材料及单位，负责人确认后用于采购。'));
  html+='<h2 class="subheading">实物批次</h2>'+(opts.batches.length?table(['材料 / 批号','有效期','状态','办理'],opts.batches.map(b=>`<tr><td>${esc(material(b.material_id).name)}<small>${esc(b.batch_no)}</small></td><td>${esc(b.expiry_date||(material(b.material_id).requires_expiry?'效期待核实':'无适用效期'))}</td><td>${esc(b.status)}</td><td>${!manager&&['待检','可用'].includes(b.status)?`<button data-batch-action="isolate" data-batch="${b.id}">发现异常隔离</button>`:''}${manager&&['待检','隔离','可用'].includes(b.status)?`<button data-batch-action="verifyExpiry" data-batch="${b.id}">核实效期</button>${['待检','隔离'].includes(b.status)?`<button data-batch-action="${b.status==='隔离'?'restore':'release'}" data-batch="${b.id}">核验放行</button>`:''}<button data-batch-action="disable" data-batch="${b.id}">停用</button>`:''}</td></tr>`)):empty('材料确认后，按真实到货来源登记批次。'));
  html+='<h2 class="subheading">实际存放位置</h2>'+(opts.locations.length?table(['位置','用途'],opts.locations.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.purpose)}</td></tr>`)):empty('请登记实际存放位置。'));$('#content').innerHTML=html;
  if(!manager){$('#new-material').onclick=()=>clinicalAction(()=>inventoryMaterial());$('#new-batch').onclick=()=>clinicalAction(()=>inventoryBatch());$('#new-location').onclick=()=>inventoryLocation();}
  bind('[data-material-edit]',b=>inventoryMaterial(material(Number(b.dataset.materialEdit))));bind('[data-material-review]',b=>inventoryMaterialApprove(material(Number(b.dataset.materialReview)),b.dataset.enable==='yes'));bind('[data-batch-action]',b=>inventoryBatchAction(batch(Number(b.dataset.batch)),b.dataset.batchAction));
 }else if(inventoryView.tab==='stock'){
  $('#filters').insertAdjacentHTML('beforeend',`<label>材料<select id="stock-material"><option value="">全部材料</option>${options(opts.materials,m=>m.name,Number(inventoryView.material))}</select></label><label>批次状态<select id="stock-status"><option value="">全部状态</option>${options(['待检','可用','隔离','停用','过期'].map(x=>({id:x,name:x})),x=>x.name,inventoryView.status)}</select></label><button id="filter-stock">筛选库存</button>`);
  for(const [index,e]of data.items.entries()){
   html+=`<section class="clinical-plan"><h2>${esc(e.material.name)} <small>${esc(e.batch.batch_no)} / ${esc(e.location?.name||'尚无分处库存')}</small></h2><p>账面${esc(quantityLabel(e.stock?.quantity_scaled||0,e.material))} · 当前可领用${esc(quantityLabel(e.availableQuantityScaled,e.material))} · ${esc(e.availability)}</p><div class="actions">`;
   if(e.stock&&!manager){if(e.availableQuantityScaled>0)html+=`<button data-stock-action="issue" data-entry="${index}">登记领用</button>`;if(originalIssues(e).length)html+=`<button data-stock-action="use" data-entry="${index}">实际用料去向</button>${e.availability==='可用'?`<button data-stock-action="return" data-entry="${index}">未用退回</button>`:''}`;html+=`<button data-stock-action="count" data-entry="${index}">实际盘点</button>`;}
   html+='</div>';
   if(e.movements?.length)html+='<details><summary>不可覆盖的库存流水</summary>'+table(['实际时间','变动','数量 / 余额','实际依据'],e.movements.map(m=>`<tr><td>${esc(localDateTimeSeconds(m.occurred_at))}</td><td>${esc(m.movement_type)}<small>流水 #${m.id}</small></td><td>${esc(quantityLabel(m.delta_scaled,e.material))}<small>余额${esc(quantityLabel(m.after_scaled,e.material))}</small></td><td>${esc(m.reason)}</td></tr>`))+'</details>';
   if(e.usages?.length)html+='<details><summary>实际使用去向</summary>'+table(['实际就诊','数量','使用时间'],e.usages.map(u=>`<tr><td>${esc(u.visit_no)}</td><td>${esc(quantityLabel(u.quantity_scaled,e.material))}</td><td>${esc(localDateTimeSeconds(u.used_at))}</td></tr>`))+'</details>';
   for(const c of e.counts||[])html+=`<p>盘点 #${c.id} · ${esc(c.status)} · 实点${esc(quantityLabel(c.counted_quantity_scaled,e.material))} ${manager&&c.status==='待确认差异'?`<button data-count-review="${c.id}" data-entry="${index}" data-approve="yes">核对确认</button><button data-count-review="${c.id}" data-entry="${index}" data-approve="no">不予调整</button>`:!manager&&c.status==='待重新核对'?`<button data-recount="${c.id}" data-entry="${index}">重新实点</button>`:''}</p>`+workflowHistory(c.history,[['snapshot_quantity_scaled','当次库存快照',q=>quantityLabel(q,e.material)],['counted_quantity_scaled','当次实点',q=>quantityLabel(q,e.material)],['status','状态'],['review_note','负责人意见']],'盘点与审核历史');
   html+='</section>';
  }
  if(!data.items.length)html=empty('当前没有符合条件的批次库存。采购确认不增加库存，需登记实际合格到货。');html+=inventoryPages(data);$('#content').innerHTML=html;
  $('#filter-stock').onclick=()=>{inventoryView.material=$('#stock-material').value;inventoryView.status=$('#stock-status').value;inventoryView.page=1;clinicalAction(render);};
  bind('[data-stock-action]',b=>inventoryMovement(data.items[Number(b.dataset.entry)],b.dataset.stockAction));bind('[data-recount]',b=>{const e=data.items[Number(b.dataset.entry)];return inventoryMovement(e,'recount',e.counts.find(c=>c.id===Number(b.dataset.recount)));});bind('[data-count-review]',b=>{const e=data.items[Number(b.dataset.entry)];return inventoryCountReview(e.counts.find(c=>c.id===Number(b.dataset.countReview)),e,b.dataset.approve==='yes');});
 }else{
  html='<h2 class="subheading">基础采购与到货验收</h2>';
  for(const p of data.items){html+=`<section class="clinical-plan"><h2>${esc(p.record_no)} <small>${esc(data.suppliers.find(s=>s.id===p.supplier_id)?.name)} / ${esc(p.status)}</small></h2><p>${esc(p.request_reason)}</p><p>${esc(p.delivery_terms)}</p>`;
   if(p.historicalReadOnly)html+='<p>本单含历史复杂处理，仅供查阅。新的业务按当前基础采购办理。</p>';
   else if(manager&&p.status==='待确认')html+=`<button data-purchase-review="${p.id}" data-approve="yes">负责人核对确认</button><button data-purchase-review="${p.id}" data-approve="no">取消待确认采购</button>`;
   else if(!manager&&p.status==='已确认')html+=`<button data-receive-purchase="${p.id}">登记本次到货验收</button>`;
   html+=table(['材料','约定基本数量','采购单位单价','履行情况'],p.items.map(i=>`<tr><td>${esc(material(i.material_id).name)}</td><td>${esc(quantityLabel(i.ordered_quantity_scaled,material(i.material_id)))}</td><td>${clinicalMoney(i.unit_price_cents)} / ${esc(i.purchase_unit)}</td><td>${esc(i.status)}${!manager&&!p.historicalReadOnly&&p.status==='待确认'&&p.created_by===state.user.staffId?`<button data-purchase-item="${i.id}" data-purchase="${p.id}">核对修订</button>`:''}</td></tr>`));
   for(const r of p.receipts){html+=`<h3>实际验收 ${esc(r.record_no)}</h3><p>${esc(r.delivery_evidence)} · ${esc(r.status)}</p>`+table(['材料 / 批号','到货 / 合格 / 拒收 / 待检','检验与协调依据','办理'],r.items.map(i=>{const m=material(p.items.find(x=>x.id===i.purchase_order_item_id).material_id);return `<tr><td>${esc(m.name)}<small>${esc(batch(i.material_batch_id)?.batch_no)}</small></td><td>${[i.arrived_quantity_scaled,i.accepted_quantity_scaled,i.rejected_quantity_scaled,i.pending_quantity_scaled].map(q=>esc(quantityText(q,m))).join(' / ')} ${esc(m.base_unit)}</td><td>${esc(i.inspection_note)}${workflowHistory(i.history,[['arrived_quantity_scaled','到货',q=>quantityLabel(q,m)],['accepted_quantity_scaled','合格',q=>quantityLabel(q,m)],['rejected_quantity_scaled','拒收',q=>quantityLabel(q,m)],['pending_quantity_scaled','待检',q=>quantityLabel(q,m)],['newly_accepted_scaled','本次入库',q=>quantityLabel(q,m)],['inspection_note','检验依据']],'验收历次结论')}</td><td>${!p.historicalReadOnly&&(manager||i.pending_quantity_scaled>0)?`<button data-inspect-receipt="${i.id}" data-receipt="${r.id}" data-purchase="${p.id}">${manager?'记录差异协调':'追加待检结论'}</button>`:''}</td></tr>`;}));}html+='</section>';
  }
  if(!data.items.length)html+=empty('暂无采购。助理根据实际需求提出，负责人核对后再登记到货验收。');html+=inventoryPages(data)+'<h2 class="subheading">供应商联系资料</h2>'+(data.suppliers.length?table(['供应商','联系人 / 电话','状态','办理'],data.suppliers.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.contact_name)} / ${esc(s.phone)}</td><td>${s.is_active?'可供货':'已停用'}</td><td>${manager?`<button data-edit-supplier="${s.id}">核对资料</button>`:'按实际交付联系'}</td></tr>`)):empty('请负责人登记实际供货供应商。'));$('#content').innerHTML=html;
  if(manager)$('#new-supplier').onclick=()=>inventorySupplier();else $('#new-purchase').onclick=()=>clinicalAction(()=>inventoryPurchase(data));
  bind('[data-edit-supplier]',b=>inventorySupplier(data.suppliers.find(s=>s.id===Number(b.dataset.editSupplier))));bind('[data-purchase-review]',b=>inventoryPurchaseReview(data.items.find(p=>p.id===Number(b.dataset.purchaseReview)),data,b.dataset.approve==='yes'));bind('[data-receive-purchase]',b=>inventoryReceive(data.items.find(p=>p.id===Number(b.dataset.receivePurchase))));bind('[data-purchase-item]',b=>{const p=data.items.find(p=>p.id===Number(b.dataset.purchase));return inventoryPurchaseItem(p,p.items.find(i=>i.id===Number(b.dataset.purchaseItem)));});bind('[data-inspect-receipt]',b=>{const p=data.items.find(p=>p.id===Number(b.dataset.purchase)),r=p.receipts.find(r=>r.id===Number(b.dataset.receipt));return inventoryInspection(p,r,r.items.find(i=>i.id===Number(b.dataset.inspectReceipt)),manager);});
 }
 bind('[data-inventory-tab]',b=>{inventoryView.tab=b.dataset.inventoryTab;inventoryView.page=1;return render();});bind('[data-inventory-page]',b=>{inventoryView.page=Number(b.dataset.inventoryPage);return render();});$('#refresh-inventory').onclick=()=>clinicalAction(render);
}
function inventoryPages(data){return data.total>data.pageSize?`<p>第${data.page}页 / 共${Math.ceil(data.total/data.pageSize)}页 ${data.page>1?`<button data-inventory-page="${data.page-1}">上一页</button>`:''}${data.page*data.pageSize<data.total?`<button data-inventory-page="${data.page+1}">下一页</button>`:''}</p>`:'';}
