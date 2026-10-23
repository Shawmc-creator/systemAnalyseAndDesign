'use strict';
const {CONFIG}=require('../../src/v2/workflow-history-schema');
// Only for isolated migration fixtures: reconstruct the schema before this migration.
function removeWorkflowHistoryFixture(db){
 const fk=db.prepare('PRAGMA foreign_keys').get().foreign_keys;db.exec('PRAGMA foreign_keys=OFF');
 for(const name of ['insurance_fee_original_request','insurance_settlement_original_request','insurance_settlement_request_frozen'])db.exec('DROP TRIGGER '+name);
 for(const c of Object.values(CONFIG))db.exec('DROP TABLE '+c.table);
 for(const[table,columns]of Object.entries({followup_requirement:['published_by','published_at'],insurance_case:['current_preestimate_id'],insurance_fee:['preestimate_request_id'],insurance_settlement:['preestimate_request_id']}))
  for(const column of columns)db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
 db.exec('PRAGMA foreign_keys='+fk);
}
module.exports={removeWorkflowHistoryFixture};
