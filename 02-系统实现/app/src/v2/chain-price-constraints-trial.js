'use strict';
// Candidate schema rules for isolated in-memory databases only. Existing
// single-store price services still need branch-aware queries and writes.
function installTrialPriceConstraints(db,{testFailAfterDrop=false}={}){
 const databases=db.prepare('PRAGMA database_list').all();
 if(!databases.some(d=>d.name==='main'&&d.file==='')||databases.some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('价目约束试验仅允许独立内存数据库');
 if(db.isTransaction||db.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)throw new Error('价目约束试验要求外键已开启且无活动事务');
 for(const table of ['service_price','bill','treatment_execution'])if(!db.prepare(`PRAGMA table_info("${table}")`).all().some(c=>c.name==='branch_id'))throw new Error('候选门店字段尚未建立');
 const names=['tr_service_price_price_overlap_insert','tr_service_price_price_overlap_update'];
 const triggers=names.map(name=>db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)?.sql);
 if(triggers.some(s=>!s||s.split('x.service_id=NEW.service_id').length!==2))throw new Error('原价目重叠触发器与预期不符');
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const name of names)db.exec(`DROP TRIGGER "${name}"`);
  if(testFailAfterDrop)throw new Error('模拟价目约束失败');
  for(const sql of triggers)db.exec(sql.replace('x.service_id=NEW.service_id','x.service_id=NEW.service_id AND x.branch_id IS NEW.branch_id'));
  db.exec(`CREATE TRIGGER chain_price_branch_insert BEFORE INSERT ON service_price WHEN NEW.branch_id IS NULL
    BEGIN SELECT RAISE(ABORT,'price_branch_required'); END;
   CREATE TRIGGER chain_price_branch_confirm BEFORE UPDATE ON service_price WHEN NEW.status='已确认可适用' AND NEW.branch_id IS NULL
    BEGIN SELECT RAISE(ABORT,'price_branch_required'); END;
   CREATE TRIGGER chain_price_branch_frozen BEFORE UPDATE OF branch_id ON service_price WHEN OLD.branch_id IS NOT NULL AND NEW.branch_id IS NOT OLD.branch_id
    BEGIN SELECT RAISE(ABORT,'price_branch_frozen'); END;
   CREATE TRIGGER chain_bill_item_price_branch_insert BEFORE INSERT ON bill_item WHEN NEW.service_price_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill b JOIN service_price p ON p.id=NEW.service_price_id WHERE b.id=NEW.bill_id AND b.branch_id IS NOT NULL AND p.branch_id=b.branch_id
      AND (NEW.treatment_execution_id IS NULL OR EXISTS (SELECT 1 FROM treatment_execution e WHERE e.id=NEW.treatment_execution_id AND e.branch_id=b.branch_id)))
    BEGIN SELECT RAISE(ABORT,'price_branch_mismatch'); END;
   CREATE TRIGGER chain_bill_item_price_branch_update BEFORE UPDATE OF service_price_id,bill_id,treatment_execution_id ON bill_item WHEN NEW.service_price_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bill b JOIN service_price p ON p.id=NEW.service_price_id WHERE b.id=NEW.bill_id AND b.branch_id IS NOT NULL AND p.branch_id=b.branch_id
      AND (NEW.treatment_execution_id IS NULL OR EXISTS (SELECT 1 FROM treatment_execution e WHERE e.id=NEW.treatment_execution_id AND e.branch_id=b.branch_id)))
    BEGIN SELECT RAISE(ABORT,'price_branch_mismatch'); END;`);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('价目约束外键检查失败');
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
module.exports={installTrialPriceConstraints};
