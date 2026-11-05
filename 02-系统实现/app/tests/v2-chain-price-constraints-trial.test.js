'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setupFees}=require('./helpers/v2-fees');
const {installTrialSchema}=require('../src/v2/chain-schema-trial');
const {installTrialPriceConstraints}=require('../src/v2/chain-price-constraints-trial');

test('统一项目可按店确认不同价目，同店期间重叠及跨店价目计费被拒绝',t=>{
 const a=setupFees(t),db=a.db,now=a.auth.now(),manager=a.auth.session(a.m.token).staff_id,cashier=a.auth.session(a.c.token).staff_id;
 installTrialSchema(db,{includeBusinessFields:true});
 db.exec("INSERT INTO clinic_chain(id,name) VALUES(1,'演示'); INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店'),(2,1,'B','二店'); UPDATE service_price SET branch_id=1; UPDATE bill SET branch_id=1");
 const original=db.prepare('SELECT * FROM service_price WHERE status=?').get('已确认可适用');
 const oldTriggers=()=>db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'tr_service_price_price_overlap_%' ORDER BY name").all().map(x=>[x.name,x.sql]);
 const before=oldTriggers();
 assert.throws(()=>installTrialPriceConstraints(db,{testFailAfterDrop:true}),/模拟价目约束失败/);
 assert.deepEqual(oldTriggers(),before);
 installTrialPriceConstraints(db);
 const make=branch=>Number(db.prepare(`INSERT INTO service_price(service_id,unit_price_cents,valid_from,valid_until,change_reason,confirmed_at,review_note,created_by,confirmed_by,status,created_at,updated_at,revision,branch_id)
  VALUES(?,30000,?,NULL,'演示拟价',NULL,NULL,?,NULL,'价目草稿',?,?,1,?)`).run(original.service_id,original.valid_from,cashier,now,now,branch).lastInsertRowid);
 const approved=price=>{db.prepare("UPDATE service_price SET status='待负责人确认' WHERE id=?").run(price);
  db.prepare("UPDATE service_price SET status='已确认可适用',confirmed_by=?,confirmed_at=?,review_note='演示核对' WHERE id=?").run(manager,now,price);};
 const priceB=make(2);approved(priceB);
 const priceA=make(1);assert.throws(()=>approved(priceA),/price_overlap/);
 assert.throws(()=>make(null),/price_branch_required/);
 assert.throws(()=>db.prepare('UPDATE service_price SET branch_id=2 WHERE id=?').run(original.id),/price_branch_frozen/);
 const line=db.prepare('SELECT * FROM bill_item WHERE bill_id=?').get(a.billId);
 assert.throws(()=>db.prepare(`INSERT INTO bill_item(bill_id,treatment_execution_id,service_price_id,quantity,quantity_scale,unit_price_cents,priced_at,pricing_note,pricing_status,priced_by,created_at,updated_at,revision)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(line.bill_id,line.treatment_execution_id,priceB,line.quantity,line.quantity_scale,30000,line.priced_at,'演示','已核价',manager,now,now),/price_branch_mismatch/);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
