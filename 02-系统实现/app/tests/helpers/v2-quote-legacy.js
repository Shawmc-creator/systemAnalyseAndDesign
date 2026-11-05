'use strict';
// Reconstruct only isolated, pre-quotation test fixtures. Never accepts a live filename.
function removeQuotesFixture(db){
 if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='treatment_quote'").get())return;
 if(db.prepare('SELECT count(*) n FROM treatment_quote').get().n)throw new Error('Quotation facts cannot be removed from a legacy fixture');
 const fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys,guards=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('tr_access_permission_delete_forbidden_delete','tr_role_permission_delete_forbidden_delete')").all();
 db.exec('PRAGMA foreign_keys=OFF;BEGIN');try{
  for(const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'quote_%'").all())db.exec('DROP TRIGGER "'+t.name+'"');
  for(const g of guards)db.exec('DROP TRIGGER "'+g.name+'"');
  db.exec("DROP INDEX payment_quote_lookup;DROP INDEX bill_item_quote_lookup;ALTER TABLE patient_payment DROP COLUMN quote_id;ALTER TABLE bill_item DROP COLUMN quote_item_id;DROP TABLE quote_decision;DROP TABLE quote_item;DROP TABLE quote_version;DROP TABLE treatment_quote;DELETE FROM role_permission WHERE permission_id IN (SELECT id FROM access_permission WHERE code LIKE 'quote.%');DELETE FROM access_permission WHERE code LIKE 'quote.%';PRAGMA user_version=2026102601");
  for(const g of guards)db.exec(g.sql);db.exec('COMMIT');
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys='+fk);}
}
module.exports={removeQuotesFixture};
