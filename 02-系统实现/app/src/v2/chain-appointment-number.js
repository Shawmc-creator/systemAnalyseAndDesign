'use strict';

const {day}=require('./common');

// Called inside the appointment transaction. Cancelled appointments keep
// their number, and a repeated month/day in another year continues the sequence.
function chainAppointmentNumber(db,branchId,start){
 const {branch_code:code}=db.prepare('SELECT branch_code FROM clinic_branch WHERE id=?').get(branchId);
 const prefix=code+'-'+day(start).slice(5).replace('-','')+'-';
 const {sequence}=db.prepare(`SELECT max(CAST(substr(record_no,length(?)+1) AS INTEGER)) sequence
  FROM appointment WHERE substr(record_no,1,length(?))=?
  AND length(record_no)>=length(?)+3 AND substr(record_no,length(?)+1) NOT GLOB '*[^0-9]*'`).get(prefix,prefix,prefix,prefix,prefix);
 return prefix+String((sequence||0)+1).padStart(3,'0');
}

module.exports={chainAppointmentNumber};
