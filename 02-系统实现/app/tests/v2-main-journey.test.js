'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setupFollowups, command} = require('./helpers/v2-followups');

test('预约到诊、方案报价、实际治疗收费和复诊评估贯通同一患者的原业务', t => {
  // Each test owns an isolated memory database and fictional appointments.
  const a = setupFollowups(t);
  const firstVisit = a.db.prepare('SELECT * FROM visit WHERE id=?').get(a.v.id);
  const firstAppointment = a.db.prepare('SELECT * FROM appointment WHERE id=?').get(firstVisit.appointment_id);
  assert.equal(firstAppointment.patient_id, 1);
  assert.equal(firstVisit.patient_id, firstAppointment.patient_id);

  const service = a.service();
  a.price(service.id, {unitPriceCents: 20000});
  const plan = a.draft([{description:'46牙计划治疗（虚构）',toothCode:'46',surfaceCode:'O',quantity:2,estimatedCents:40000}]);
  a.publish(plan.id);
  a.decide(plan.id);
  const planItem = a.db.prepare('SELECT * FROM plan_item WHERE plan_version_id=?').get(plan.id);
  const made = a.quotes.prepare(a.d, command({action:'create',patientId:1,visitId:a.v.id,sourcePlanVersionId:plan.id,reason:'患者费用说明',items:[{planItemId:planItem.id,serviceId:service.id,toothCode:'46',surfaceCode:'O',quantity:2,scopeNote:'计划内两次治疗，不含其他项目'}]}));
  let quote = a.quotes.query(a.c).quotes.find(q => q.versions.some(v => v.id === made.id));
  let version = quote.versions.find(v => v.id === made.id);
  const price = a.db.prepare("SELECT id FROM service_price WHERE service_id=? AND status='已确认可适用'").get(service.id);
  a.quotes.issue(a.c, command({versionId:version.id,expectedRevision:version.revision,expectedQuoteRevision:quote.revision,validFrom:'2026-10-19',validUntil:'2026-10-22',prices:[{itemId:version.items[0].id,priceId:price.id}],reason:'核对正式价目并出具'}));
  quote = a.quotes.query(a.c).quotes.find(q => q.id === quote.id); version = quote.versions.find(v => v.id === made.id);
  assert.equal(version.items[0].amount_cents, 40000);
  assert.equal(a.bills().total, 0, '报价不生成实际账款');
  a.quotes.decide(a.c, command({versionId:version.id,expectedRevision:version.revision,expectedQuoteRevision:quote.revision,decision:'接受',decidedAt:a.auth.now(),confirmationBasis:'虚构患者明确费用决定',itemIds:[version.items[0].id]}));

  a.execute(service.id, {planItemId:planItem.id,toothCode:'46',surfaceCode:'O',quantity:1});
  let bills = a.bills(), bill = bills.items[0];
  assert.equal(bill.summary.receivableCents, 20000, '仅计算实际完成的一次治疗');
  assert.equal(bill.items[0].quote_item_id, version.items[0].id);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 0);

  const followup = a.createFollowup();
  a.signSource();
  assert.equal(a.followup(followup.id).status, '待联系');
  assert.equal(a.db.prepare('SELECT released_at FROM resource_occupancy WHERE visit_id=?').get(a.v.id).released_at !== null, true);

  const receipt = command({action:'receive',patientId:1,expectedFundsRevision:bills.funds.revision,channel:'现金',receivedCents:20000,changeCents:0,verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'隔离演示实际现金',allocations:[{billId:bill.id,expectedRevision:bill.revision,amountCents:20000,reason:'支付本次实际治疗'}]});
  const paid = a.payments.receive(a.c, receipt);
  assert.equal(a.payments.receive(a.c, receipt).replayed, true);
  bills = a.bills();
  assert.equal(bills.totals.unpaidCents, 0);
  assert.equal(bills.funds.confirmedReceivedCents, 20000);
  assert.equal(a.db.prepare('SELECT count(*) n FROM patient_payment').get().n, 1);
  assert.equal(bills.funds.payments[0].id, paid.id);
  assert.equal(a.followup(followup.id).status, '待联系', '结清不代替复诊联系');

  a.advance('2026-10-20T01:00:00Z');
  const nextAppointment = a.book();
  a.contact(followup.id, {nextStep:'arrange',appointmentId:nextAppointment.id,expectedAppointmentRevision:1});
  assert.equal(a.followup(followup.id).status, '待到诊或评估');
  assert.throws(() => a.assess(followup.id, {method:'到诊检查',visitId:firstVisit.id}), e => e.code === 'FOLLOWUP_VISIT_NOT_ACTUAL');
  a.advance('2026-10-20T03:05:00Z');
  const nextVisit = a.startFollowupVisit(nextAppointment.id);
  a.assess(followup.id, {method:'到诊检查',visitId:nextVisit.id});
  assert.equal(a.followup(followup.id).status, '已完成');
  assert.equal(a.db.prepare('SELECT visit_id FROM clinical_assessment').get().visit_id, nextVisit.id);
  assert.equal(a.db.prepare('SELECT patient_id FROM visit WHERE id=?').get(nextVisit.id).patient_id, firstVisit.patient_id);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(), []);
});
