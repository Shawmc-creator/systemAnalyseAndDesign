'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setup}=require('./helpers/v2-treatment');
const {installTrialSchema}=require('../src/v2/chain-schema-trial');
const {assertCandidateReservation,assertCandidateSchedule}=require('../src/v2/chain-reception-rules');

test('在现有表、占用触发器和两家虚构门店上核验跨店预约规则',t=>{
 const a=setup(t), db=a.db;
 installTrialSchema(db);
 db.exec(`ALTER TABLE dental_chair ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE dated_schedule ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE appointment ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 INSERT INTO clinic_chain(id,name) VALUES(1,'隔离演示');
 INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店'),(2,1,'B','二店');
 UPDATE dental_chair SET branch_id=CASE id WHEN 1 THEN 1 ELSE 2 END;
 UPDATE dated_schedule SET branch_id=1; UPDATE appointment SET branch_id=1; UPDATE visit SET branch_id=1;`);
 const old=db.prepare('SELECT s.* FROM dated_schedule s JOIN resource_occupancy o ON o.dated_schedule_id=s.id WHERE o.visit_id=? AND o.released_at IS NULL').get(a.v.id);
 const manager=a.auth.session(a.m.token).staff_id;
 db.prepare(`INSERT INTO dated_schedule(dentist_id,dental_chair_id,business_date,starts_at,ends_at,confirmed_at,
 created_by,confirmed_by,status,created_at,updated_at,revision,branch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(manager,2,old.business_date,old.starts_at,old.ends_at,old.confirmed_at,manager,manager,'已确认',old.created_at,old.updated_at,1,2);
 const target=db.prepare('SELECT id FROM dated_schedule WHERE branch_id=2').get().id;
 db.exec('BEGIN IMMEDIATE');
 try {
  const base={branchId:2,patientId:1,scheduleId:target,startsAt:'2026-10-19T03:00:00Z',endsAt:'2026-10-19T03:30:00Z'};
  assert.throws(()=>assertCandidateReservation(db,base),/已有占用/);
  assert.doesNotThrow(()=>assertCandidateReservation(db,{...base,patientId:2}));
  assert.throws(()=>assertCandidateSchedule(db,{branchId:2,chairId:2,dentistId:old.dentist_id,startsAt:old.starts_at,endsAt:old.ends_at,scheduleId:target}),/已有排班/);
  const occupancy=db.prepare('SELECT id,appointment_id FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(a.v.id);
  assert.throws(()=>assertCandidateReservation(db,{...base,excludedOccupancyId:occupancy.id,originalAppointmentId:occupancy.appointment_id}),/原预留/);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.exec('ROLLBACK');}
});
