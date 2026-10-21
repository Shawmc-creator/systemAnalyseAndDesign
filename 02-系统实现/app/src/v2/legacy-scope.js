'use strict';
const {canonical,fail}=require('./common');
// Old rows remain readable for receipts and inventory provenance. No new legacy workflow is executable.
const TABLES=['purchase_issue','supplier_funds','supplier_payment','supplier_allocation','supplier_refund'];
function historicalPurchase(db,purchaseId){
 return !!db.prepare(`SELECT 1 FROM purchase_issue i JOIN purchase_order_item p ON p.id=i.purchase_order_item_id WHERE p.purchase_order_id=?
   UNION ALL SELECT 1 FROM supplier_allocation a LEFT JOIN purchase_receipt r ON r.id=a.purchase_receipt_id WHERE a.purchase_order_id=? OR r.purchase_order_id=? LIMIT 1`).get(purchaseId,purchaseId,purchaseId);
}
function writablePurchase(db,purchaseId){if(historicalPurchase(db,purchaseId))fail(409,'HISTORICAL_PURCHASE_READ_ONLY','该采购含已停用流程的历史记录，仅供查阅；新的采购请按当前基础采购流程建立');}
function acceptanceLimit(db,item){
 const original=BigInt(item.ordered_quantity_scaled);
 if(!historicalPurchase(db,item.purchase_order_id||db.prepare('SELECT purchase_order_id FROM purchase_order_item WHERE id=?').get(item.id).purchase_order_id))return original;
 const accepted=db.prepare('SELECT accepted_quantity_scaled FROM purchase_receipt_item WHERE purchase_order_item_id=?').all(item.id).reduce((n,r)=>n+BigInt(r.accepted_quantity_scaled),0n);
 return accepted>original?accepted:original;
}
const snapshot=db=>canonical(TABLES.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
function validate(db,before){if(snapshot(db)!==before)fail(409,'FEATURE_REMOVED','复杂供货退换与资金分配已移出当前需求范围，历史记录不可改写');}
module.exports={historicalPurchase,writablePurchase,acceptanceLimit,snapshot,validate};
