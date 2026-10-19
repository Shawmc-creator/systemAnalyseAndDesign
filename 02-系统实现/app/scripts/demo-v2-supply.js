'use strict';
const {createApplication}=require('../src/v2/server');
const a=createApplication({demo:true,clock:()=>new Date('2026-10-19T01:00:00Z')});
let serial=0;const command=value=>({...value,commandVersion:1,requestKey:'supply-demo-'+(++serial)});
const steps=[],keep=(name,result)=>{steps.push({name,result});return result;};
try {
  const login=username=>{const s=a.auth.login({username,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:username==='assistant'?'assistant':username};};
  const m=login('manager'),c=login('cashier'),i=login('assistant');
  const material=a.inventory.record(i,command({action:'material',name:'供货结算流程材料（虚构）',specification:'软件演示规格',baseUnit:'个',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,reason:'明确材料数量口径'}));
  a.inventory.approve(m,command({action:'confirmMaterial',materialId:material.id,expectedRevision:1,reason:'负责人核实材料单位'}));
  const location=a.inventory.record(i,command({action:'location',name:'演示耗材库',purpose:'分批分处保管',reason:'明确存放位置'}));
  const batch=a.inventory.record(i,command({action:'batch',materialId:material.id,batchNo:'SUPPLY-DEMO-001',expiryDate:'2027-10-19',sourceNote:'虚构供货批号'}));
  const supplier=a.purchases.supplier(m,command({name:'供货流程演示供应商',contactName:'虚拟联系人',phone:'13800000003',settlementBasis:'仅为隔离软件演示的核实依据',isActive:true,reason:'负责人核实供应商与结算信息'}));
  const purchase=a.purchases.draft(i,command({action:'create',supplierId:supplier.id,expectedSupplierRevision:1,agreedAt:a.auth.now(),deliveryTerms:'分批验收，差异单独核实，采购预付另经授权',reason:'虚构的软件演示需求',items:[{materialId:material.id,expectedMaterialRevision:2,orderedQuantityScaled:100,unitPriceCents:1000}]}));
  keep('确认采购100个，每盒10个、每盒10元，约定总额100元；尚未付款',a.purchases.approve(m,command({action:'approve',purchaseId:purchase.id,expectedRevision:1,expectedSupplierRevision:1,reviewNote:'核准数量、单位和交付条件'})));
  const q=()=>a.supplierPayments.query(c,{supplierId:supplier.id});
  const po=()=>a.db.prepare('SELECT * FROM purchase_order WHERE id=?').get(purchase.id),item=()=>a.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').get(purchase.id);
  const target=(kind,id,amount)=>({kind,id,expectedRevision:a.db.prepare('SELECT revision FROM '+(kind==='order'?'purchase_order':'purchase_receipt')+' WHERE id=?').get(id).revision,amountCents:amount});
  const payment=keep('负责人授权原采购预付100元，分配给收费人员，保留100元占用',a.supplierPayments.authorize(m,command({action:'authorize',supplierId:supplier.id,expectedSupplierRevision:1,expectedFundsRevision:q().funds.revision,requestedCents:10000,channel:'现金',cashierId:3,reviewNote:'按确认采购的约定范围预付',allocations:[target('order',purchase.id,10000)]})));
  const pay=(action,extra={})=>a.supplierPayments.pay(c,command({action,supplierId:supplier.id,expectedFundsRevision:q().funds.revision,paymentId:payment.id,expectedRevision:a.db.prepare('SELECT revision FROM supplier_payment WHERE id=?').get(payment.id).revision,transactionEvidence:'隔离软件演示：按原办理号核实线下实际结果',...extra}));
  keep('收费人员接收唯一办理号，开始线下办理',pay('initiate'));
  keep('结果尚不明确，保留原100元占用',pay('verify',{outcome:'unknown'}));keep('未知期间实付0、占用100元',q().totals);
  const verified=command({action:'verify',supplierId:supplier.id,expectedFundsRevision:q().funds.revision,paymentId:payment.id,expectedRevision:3,outcome:'success',actualCents:10000,recipientMatches:true,transactionEvidence:'虚构演示中已核实原办理实际付款100元'});
  keep('核实原办理成功，预付100元',a.supplierPayments.pay(c,verified));keep('同号重试不再付款',a.supplierPayments.pay(c,verified));
  const receive=(evidence,accepted,rejected,extra={})=>a.purchases.receive(i,command({action:'receive',purchaseId:purchase.id,expectedPurchaseRevision:po().revision,arrivedAt:a.auth.now(),deliveryEvidence:evidence,
    items:[{purchaseItemId:item().id,expectedItemRevision:item().revision,batchId:batch.id,locationId:location.id,arrivedQuantityScaled:accepted+rejected,acceptedQuantityScaled:accepted,rejectedQuantityScaled:rejected,pendingQuantityScaled:0,inspectionNote:'虚构实物验收结论',...extra}]}));
  const firstReceipt=keep('首次到货100个：合格80个、拒收20个；合格价款80元',receive('SUPPLY-DEMO-DELIVERY-1',80,20));
  a.inventory.approve(m,command({action:'release',batchId:batch.id,expectedRevision:1,reason:'核实已认可合格范围及实际效期'}));
  const reallocate=(sourceAllocationId,receiptId,amount)=>{
    const source=a.db.prepare('SELECT * FROM supplier_allocation WHERE id=?').get(sourceAllocationId);
    keep('负责人批准原预付转实际验收结算'+amount/100+'元',a.supplierPayments.authorize(m,command({action:'authorizeReallocation',supplierId:supplier.id,expectedSupplierRevision:1,expectedFundsRevision:q().funds.revision,paymentId:payment.id,expectedRevision:a.db.prepare('SELECT revision FROM supplier_payment WHERE id=?').get(payment.id).revision,
      reviewNote:'以原付款释放原采购用途并转本次真实验收',releases:[{allocationId:source.id,expectedRevision:source.revision,amountCents:amount,reason:'原预付转验收'}],allocations:[target('receipt',receiptId,amount)]})));
    const authorization=q().authorizations[0];keep('收费人员按批准转移用途，实际付款笔数仍为1',a.supplierPayments.pay(c,command({action:'reallocate',supplierId:supplier.id,expectedFundsRevision:q().funds.revision,authorizationId:authorization.id})));
  };
  const originalAllocation=q().items[0].allocations.find(x=>x.allocation_state==='已生效');reallocate(originalAllocation.id,firstReceipt.id,8000);
  const source=a.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_receipt_id=?').get(firstReceipt.id);
  const propose=(action,note)=>a.purchases.receive(i,command({action:'proposeIssue',purchaseItemId:item().id,expectedItemRevision:item().revision,expectedPurchaseRevision:po().revision,receiptItemId:source.id,expectedReceiptItemRevision:source.revision,
    resolutionAction:action,quantityScaled:20,resolutionNote:note,reason:'隔离演示中如实核实的供货差异'}));
  const replacement=keep('助理提出原拒收20个换货，保留拒收事实',propose('replace','拒收20个，由供应商另行换货'));
  keep('负责人确认换货范围',a.purchaseIssues.approve(m,command({action:'approve',issueId:replacement.id,expectedRevision:1,expectedFundsRevision:q().funds.revision,reviewNote:'核准原拒收范围，不新增采购合同数量'})));
  const secondReceipt=keep('实际换货20个验收合格并关联原差异',receive('SUPPLY-DEMO-REPLACEMENT-2',20,0,{replacementIssueId:replacement.id,expectedReplacementRevision:2}));
  reallocate(originalAllocation.id,secondReceipt.id,2000);
  keep('全部验收后：原实付100元，验收结算100元，不再付款',q().totals);
  const returned=keep('再提出原合格批次退供20个，原合格80个仍保留',propose('return','实际退供20个，减少价款20元'));
  const receiptAllocation=q().items[0].allocations.find(x=>x.purchase_receipt_id===firstReceipt.id&&x.amount_cents>0&&x.allocation_state==='已生效');
  keep('负责人批准减少20元并共同释放原结算用途20元，尚未收到退款',a.purchaseIssues.approve(m,command({action:'approve',issueId:returned.id,expectedRevision:1,expectedFundsRevision:q().funds.revision,reviewNote:'核实退供及相应价款减少',releases:[{allocationId:receiptAllocation.id,expectedRevision:1,amountCents:2000,reason:'释放已核准退供减少的原用途'}]})));
  const stock=()=>a.db.prepare('SELECT * FROM batch_stock WHERE material_batch_id=?').get(batch.id);
  keep('助理实际交还供应商20个并登记退供出库',a.purchases.receive(i,command({action:'returnGoods',issueId:returned.id,expectedRevision:2,stockId:stock().id,expectedStockRevision:stock().revision,quantityScaled:20,returnedAt:a.auth.now(),handoverEvidence:'虚构软件演示中核实供应商接收20个的交接证据'})));
  const refund=command({action:'refund',supplierId:supplier.id,expectedFundsRevision:q().funds.revision,paymentId:payment.id,expectedRevision:4,issueId:returned.id,expectedIssueRevision:3,receivedCents:2000,channel:'现金',senderMatches:true,receivedAt:a.auth.now(),transactionEvidence:'虚构软件演示中已核实实际收到供应商退回20元'});
  keep('收费人员核实实际收到供应商退回20元',a.supplierPayments.pay(c,refund));keep('同号重试不重复登记退回款',a.supplierPayments.pay(c,refund));
  const final=q();keep('最终：库存80个，原实付100元、退回20元、净付及验收应付80元', {quantityScaled:stock().quantity_scaled,totals:final.totals,orderDueCents:final.orders[0].dueCents,
    receiptDueCents:final.orders[0].receipts.reduce((n,r)=>n+r.dueCents,0),paymentCount:final.items.length,originalAcceptedQuantity:source.accepted_quantity_scaled,originalRejectedQuantity:source.rejected_quantity_scaled,patientPaymentCount:a.db.prepare('SELECT count(*) n FROM patient_payment').get().n});
  keep('外键与完整性检查',{foreignKeyErrors:a.db.prepare('PRAGMA foreign_key_check').all(),integrity:a.db.prepare('PRAGMA integrity_check').get().integrity_check});
  process.stdout.write(JSON.stringify({scenario:'供货预付—未知核实—验收—原款转结算—拒收换货—退供—实际供应商退回款',isolatedInMemory:true,touchesLiveData:false,externalPaymentExecution:false,moneyUnit:'整数分',simulatedBusinessDate:'2026-10-19',steps},null,2)+'\n');
} finally {a.db.close();}
