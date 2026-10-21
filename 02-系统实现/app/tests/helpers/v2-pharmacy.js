'use strict';
const {setup:base,command}=require('./v2-prescriptions');
const POLICY={enabled:true,verificationBasis:'隔离流程测试中的机构条件，不代表实际资质',verifiedBy:'演示核实人',validFrom:'2026-10-18T00:00:00Z',validUntil:'2027-10-18T00:00:00Z'};
function setup(t,options={}){
 const a=base(t,{pharmacyPolicy:options.policy||POLICY});
 const service=a.billing.draft(a.c,command({action:'service',name:'演示药品对应收费项目',billingUnit:'片',reason:'隔离演示目录'}));a.drugService=service.id;
 if(options.price!==false)a.price(service.id,{unitPriceCents:options.priceCents??200});
 a.inventory.record(a.i,command({action:'material',materialId:a.drug.id,expectedRevision:2,name:'流程演示药品（非真实药物）',specification:'演示规格，不用于实际治疗',baseUnit:'片',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:2,requiresTrace:true,requiresExpiry:true,isDrug:true,billingServiceId:service.id,reason:'核实院内药品基本单位和收费项目对应'}));
 a.inventory.approve(a.m,command({action:'confirmMaterial',materialId:a.drug.id,expectedRevision:3,reason:'演示药品与收费项目核对'}));
 const loc=a.inventory.record(a.i,command({action:'location',name:'演示药品存放位',purpose:'仅流程测试',reason:'核对位置'}));
 a.batch=a.inventory.record(a.i,command({action:'batch',materialId:a.drug.id,batchNo:'PHARMACY-DEMO',expiryDate:'2027-10-19',sourceNote:'隔离演示供货批次'}));
 const supplier=a.purchases.supplier(a.m,command({name:'演示供货方',contactName:'虚构联系人',phone:'13800000003',settlementBasis:'演示来源核对',isActive:true,reason:'演示基础资料'}));
 const order=a.purchases.draft(a.i,command({action:'create',supplierId:supplier.id,expectedSupplierRevision:1,agreedAt:a.auth.now(),deliveryTerms:'隔离演示验收',reason:'演示药品需求',items:[{materialId:a.drug.id,expectedMaterialRevision:4,orderedQuantityScaled:1000,unitPriceCents:1000}]}));
 a.purchases.approve(a.m,command({action:'approve',purchaseId:order.id,expectedRevision:1,expectedSupplierRevision:1,reviewNote:'演示采购核对'}));
 const oi=a.db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').get(order.id);
 a.purchases.receive(a.i,command({action:'receive',purchaseId:order.id,expectedPurchaseRevision:2,arrivedAt:a.auth.now(),deliveryEvidence:'演示到货单',items:[{purchaseItemId:oi.id,expectedItemRevision:oi.revision,batchId:a.batch.id,locationId:loc.id,arrivedQuantityScaled:1000,acceptedQuantityScaled:1000,rejectedQuantityScaled:0,pendingQuantityScaled:0,inspectionNote:'演示合格验收'}]}));
 a.inventory.approve(a.m,command({action:'release',batchId:a.batch.id,expectedRevision:1,reason:'演示批次核实放行'}));
 a.stock=()=>a.db.prepare('SELECT * FROM batch_stock WHERE material_batch_id=?').get(a.batch.id);
 if(options.qualify!==false)a.qualification=a.pharmacy.qualify(a.m,command({action:'grant',accountId:6,validFrom:a.auth.now(),validUntil:'2027-10-18T00:00:00Z',confirmed:true,reason:'仅隔离测试：已核实的虚构药学资格，不用于真实任职'}));
 const s=a.auth.login({username:'assistant2',password:'Clinic123!'});a.ph={token:s.token,csrf:s.csrf,role:'pharmacist'};
 a.review();a.record();
 a.inDraft=()=>a.rxDraft({collectionRoute:'院内',items:[{materialId:a.drug.id,expectedMaterialRevision:4,quantityScaled:250,directions:'由实际医师填写的用法字段，演示不用于用药'}]});
 a.rxInfo=()=>a.db.prepare('SELECT * FROM prescription ORDER BY id DESC LIMIT 1').get();
 a.approveRx=(extra={})=>a.pharmacy.review(a.ph,command({action:'approve',prescriptionId:a.rxInfo().id,patientId:1,expectedRevision:a.rxInfo().revision,expectedLatestHealthVersionId:a.db.prepare('SELECT max(id) id FROM health_version WHERE patient_id=1').get().id,confirmed:true,reviewNote:'演示：核对患者、处方、健康资料及供药条件',...extra}));
 a.giveInput=(extra={})=>command({prescriptionId:a.rxInfo().id,patientId:1,expectedRevision:a.rxInfo().revision,itemId:a.db.prepare('SELECT id FROM prescription_item WHERE prescription_id=?').get(a.rxInfo().id).id,stockId:a.stock().id,expectedStockRevision:a.stock().revision,quantityScaled:125,dispensedAt:a.auth.now(),expectedLatestHealthVersionId:a.db.prepare('SELECT max(id) id FROM health_version WHERE patient_id=1').get().id,confirmed:true,guidanceNote:'演示：按实际核对交付数量及医师处方交代用法',expectedPriceId:a.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 1").get(a.drugService,a.auth.now(),a.auth.now())?.id||null,...extra});
 a.give=(extra={},actor=a.ph)=>a.pharmacy.dispense(actor,a.giveInput(extra));
 return a;
}
module.exports={setup,POLICY,command};
