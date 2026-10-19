'use strict';
const {setup,command}=require('./v2-treatment');
const materialInput={name:'隔离测试材料',specification:'软件流程演示规格',baseUnit:'个',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,reason:'明确实物单位与追溯要求'};
function setupInventory(t,options={}) {
  const a=setup(t);
  const login=name=>{const s=a.auth.login({username:name,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:'assistant'};};
  a.i=login('assistant');a.i2=login('assistant2');
  a.materialFields={...materialInput,...options.material};
  a.material=a.inventory.record(a.i,command({action:'material',...a.materialFields}));
  a.inventory.approve(a.m,command({action:'confirmMaterial',materialId:a.material.id,expectedRevision:1,reason:'负责人核实单位与追溯'}));
  a.location=a.inventory.record(a.i,command({action:'location',name:'演示耗材库',purpose:'合格批次储存',reason:'明确位置'}));
  a.batch=a.inventory.record(a.i,command({action:'batch',materialId:a.material.id,batchNo:'TEST-20261019',expiryDate:options.expiry===undefined?'2027-10-19':options.expiry,sourceNote:'本次供应商实物批号'}));
  a.supplier=a.purchases.supplier(a.m,command({name:'隔离测试供应商',contactName:'测试联系人',phone:'13800000003',settlementBasis:'只用于软件测试的核验依据',isActive:true,reason:'负责人已核对供应商'}));
  a.purchase=a.purchases.draft(a.i,command({action:'create',supplierId:a.supplier.id,expectedSupplierRevision:1,agreedAt:a.auth.now(),deliveryTerms:'分批验收，合格后按约定结算',reason:'真实需求的软件夹具',
    items:[{materialId:a.material.id,expectedMaterialRevision:2,orderedQuantityScaled:options.ordered||100,unitPriceCents:options.price===undefined?1000:options.price}]}));
  a.purchases.approve(a.m,command({action:'approve',purchaseId:a.purchase.id,expectedRevision:1,expectedSupplierRevision:1,reviewNote:'按明确数量和单位价格确认'}));
  a.orderItem=()=>a.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').get(a.purchase.id);
  a.stock=()=>a.db.prepare('SELECT * FROM batch_stock WHERE material_batch_id=? AND stock_location_id=?').get(a.batch.id,a.location.id);
  a.receive=(extra={})=>a.purchases.receive(a.i,command({action:'receive',purchaseId:a.purchase.id,expectedPurchaseRevision:a.db.prepare('SELECT revision FROM purchase_order WHERE id=?').get(a.purchase.id).revision,
    arrivedAt:a.auth.now(),deliveryEvidence:'独立随货单-1',items:[{purchaseItemId:a.orderItem().id,expectedItemRevision:a.orderItem().revision,batchId:a.batch.id,locationId:a.location.id,
      arrivedQuantityScaled:100,acceptedQuantityScaled:100,rejectedQuantityScaled:0,pendingQuantityScaled:0,inspectionNote:'实际逐项验收结论'}],...extra}));
  a.line=(extra={})=>({purchaseItemId:a.orderItem().id,expectedItemRevision:a.orderItem().revision,batchId:a.batch.id,locationId:a.location.id,arrivedQuantityScaled:100,acceptedQuantityScaled:100,rejectedQuantityScaled:0,pendingQuantityScaled:0,inspectionNote:'实物检验依据',...extra});
  a.release=()=>a.inventory.approve(a.m,command({action:'release',batchId:a.batch.id,expectedRevision:a.db.prepare('SELECT revision FROM material_batch WHERE id=?').get(a.batch.id).revision,reason:'负责人核实认可的合格范围与有效期'}));
  a.move=(action,extra={},credentials=a.i)=>a.inventory.recordMovement(credentials,command({action,stockId:a.stock().id,expectedStockRevision:a.stock().revision,quantityScaled:10,reason:'如实办理的测试依据',...extra}));
  a.count=(qty)=>a.move('count',{countedQuantityScaled:qty,countedAt:a.auth.now()});
  a.approveCount=(countId,extra={})=>a.inventory.approveCount(a.m,command({action:'approveCount',countId,expectedRevision:a.db.prepare('SELECT revision FROM stock_count WHERE id=?').get(countId).revision,reviewNote:'负责人核实当前差异',...extra}));
  a.inspect=(receiptId,extra={})=>{
    const r=a.db.prepare('SELECT * FROM purchase_receipt_item WHERE purchase_receipt_id=?').get(receiptId),h=a.db.prepare('SELECT * FROM purchase_receipt WHERE id=?').get(receiptId);
    return a.purchases.receive(a.i,command({action:'inspectPending',receiptId,expectedRevision:h.revision,receiptItemId:r.id,expectedItemRevision:r.revision,newAcceptedQuantityScaled:40,newRejectedQuantityScaled:0,inspectionNote:'后续检验已完成',...extra}));
  };
  if(options.receive!==false) {a.receipt=a.receive();if(options.release!==false)a.release();}
  return a;
}
module.exports={setupInventory,command,materialInput};
