'use strict';

// Allocate inside the patient creation or migration transaction so that
// independent front desks and the mini program share one sequence.
function nextChainPatientNumber(db){
 const {last}=db.prepare(`SELECT COALESCE(MAX(CAST(substr(record_no,3) AS INTEGER)),0) AS last
  FROM patient WHERE record_no GLOB 'P-[0-9]*' AND substr(record_no,3) NOT GLOB '*[^0-9]*'`).get();
 return 'P-'+String(last+1).padStart(4,'0');
}

module.exports={nextChainPatientNumber};
