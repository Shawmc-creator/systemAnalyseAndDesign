'use strict';
const { fail } = require('./common');

function leafQuantity(db, itemId) {
  const rows = db.prepare(`SELECT e.completed_quantity FROM treatment_execution e
    WHERE e.plan_item_id=? AND NOT EXISTS (SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=e.id)`).all(itemId);
  return rows.reduce((total, r) => total + BigInt(r.completed_quantity), 0n);
}
function decisionFor(db, itemId, at) {
  return db.prepare(`SELECT d.*,s.scope_quantity FROM patient_decision d JOIN decision_plan_item s ON s.decision_id=d.id
    WHERE s.plan_item_id=? AND d.decided_at<=? ORDER BY d.decided_at DESC,d.id DESC LIMIT 1`).get(itemId, at);
}
function consentFor(db,itemId,at){
  const item=db.prepare('SELECT planned_quantity FROM plan_item WHERE id=?').get(itemId);
  let limit=0n,approval=null;
  const decisions=db.prepare(`SELECT d.*,s.scope_quantity FROM patient_decision d JOIN decision_plan_item s ON s.decision_id=d.id
    WHERE s.plan_item_id=? AND d.decided_at<=? ORDER BY d.decided_at,d.id`).all(itemId,at);
  for(const d of decisions){
    if(d.decision==='同意') {limit=BigInt(d.scope_quantity??item.planned_quantity);approval=d;}
    else {
      // Withdrawing an unperformed quantity keeps the patient's already completed facts and the remaining consent.
      const done=db.prepare(`SELECT e.completed_quantity FROM treatment_execution e WHERE e.plan_item_id=? AND e.completed_at<=? AND e.created_at<=?
        AND NOT EXISTS(SELECT 1 FROM treatment_execution n WHERE n.original_execution_id=e.id AND n.created_at<=?)`).all(itemId,d.decided_at,d.created_at,d.created_at)
        .reduce((n,e)=>n+BigInt(e.completed_quantity),0n);
      const next=d.scope_quantity==null?done:limit-BigInt(d.scope_quantity);
      limit=next>done?next:done;
    }
  }
  return {limit,approval,latest:decisions.at(-1)||null};
}
function treatmentSnapshot(db) {
  return db.prepare(`SELECT d.id,
    (SELECT count(*) FROM decision_plan_item s WHERE s.decision_id=d.id) items,
    (SELECT count(*) FROM decision_file_version f WHERE f.decision_id=d.id) files FROM patient_decision d`).all();
}
function validateTreatment(db, before) {
  for (const d of before) {
    const items = db.prepare('SELECT count(*) n FROM decision_plan_item WHERE decision_id=?').get(d.id).n;
    const files = db.prepare('SELECT count(*) n FROM decision_file_version WHERE decision_id=?').get(d.id).n;
    if (items !== d.items || files !== d.files) fail(409, 'DECISION_SEALED', '既有患者决定的项目与原件集合不能扩大；请追加新的决定');
  }
  if (db.prepare(`SELECT d.id FROM patient_decision d WHERE NOT EXISTS
    (SELECT 1 FROM decision_plan_item s WHERE s.decision_id=d.id)`).get()) fail(409, 'DECISION_SCOPE_EMPTY', '患者决定须明确到至少一个方案项目');
  if (db.prepare(`SELECT v.id FROM plan_version v WHERE v.status<>'草稿' AND NOT EXISTS
    (SELECT 1 FROM plan_item i WHERE i.plan_version_id=v.id)`).get()) fail(409, 'PLAN_EMPTY', '已说明的方案必须有明确项目');
  for (const item of db.prepare('SELECT id,planned_quantity FROM plan_item').all()) {
    if (leafQuantity(db, item.id) > BigInt(item.planned_quantity)) fail(409, 'PLAN_QUANTITY_EXCEEDED', '有效执行量超过该方案项目的计划量');
  }
  if (db.prepare(`SELECT e.id FROM treatment_execution e WHERE e.original_execution_id IS NULL AND NOT EXISTS
    (SELECT 1 FROM bill_item b WHERE b.treatment_execution_id=e.id)`).get()) fail(409, 'EXECUTION_BILL_MISSING', '首次执行须同时形成已核价或待核价的应收依据');
}
module.exports = { leafQuantity, decisionFor, consentFor, treatmentSnapshot, validateTreatment };
