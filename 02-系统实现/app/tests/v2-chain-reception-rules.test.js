'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {assertCandidateReservation,assertCandidateSchedule}=require('../src/v2/chain-reception-rules');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE clinic_branch(id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE dental_chair(id INTEGER PRIMARY KEY,branch_id INTEGER);
 CREATE TABLE dated_schedule(id INTEGER PRIMARY KEY,branch_id INTEGER,dentist_id INTEGER,dental_chair_id INTEGER,starts_at TEXT,ends_at TEXT,status TEXT);
 CREATE TABLE appointment(id INTEGER PRIMARY KEY,patient_id INTEGER,branch_id INTEGER);
 CREATE TABLE visit(id INTEGER PRIMARY KEY,patient_id INTEGER,started_at TEXT);
 CREATE TABLE resource_occupancy(id INTEGER PRIMARY KEY,dated_schedule_id INTEGER,appointment_id INTEGER,visit_id INTEGER,starts_at TEXT,ends_at TEXT,released_at TEXT);
 INSERT INTO clinic_branch VALUES(1,'active'),(2,'active');
 INSERT INTO dental_chair VALUES(1,1),(2,2);
 INSERT INTO dated_schedule VALUES(1,1,10,1,'2026-10-29T01:00:00Z','2026-10-29T09:00:00Z','已确认'),(2,2,20,2,'2026-10-29T01:00:00Z','2026-10-29T09:00:00Z','已确认');
 INSERT INTO appointment VALUES(1,30,1);
 INSERT INTO resource_occupancy VALUES(1,1,1,NULL,'2026-10-29T02:00:00Z','2026-10-29T03:00:00Z',NULL);
 BEGIN IMMEDIATE;`);
 return db;
}
const req={branchId:2,patientId:40,scheduleId:2,startsAt:'2026-10-29T02:00:00Z',endsAt:'2026-10-29T03:00:00Z'};
test('不同门店不同患者牙医诊椅可同时预约；同患者与同牙医跨店冲突',()=>{
 const db=fixture();try{
  assert.equal(assertCandidateReservation(db,req).branchId,2);
  assert.throws(()=>assertCandidateReservation(db,{...req,patientId:30}),/已有占用/);
  db.exec('UPDATE dated_schedule SET dentist_id=10 WHERE id=2');
  assert.throws(()=>assertCandidateReservation(db,req),/已有占用/);
 }finally{db.close();}
});
test('左闭右开时段、门店归属和无事务拒绝',()=>{
 const db=fixture();try{
  assert.doesNotThrow(()=>assertCandidateReservation(db,{...req,patientId:30,startsAt:'2026-10-29T03:00:00Z',endsAt:'2026-10-29T04:00:00Z'}));
  assert.throws(()=>assertCandidateReservation(db,{...req,branchId:1}),/不适用/);
  db.exec('COMMIT'); assert.throws(()=>assertCandidateReservation(db,req),/写事务/);
 }finally{db.close();}
});
test('不允许利用他人、他店或实际使用中的预留来绕过冲突',()=>{
 const db=fixture();try{
  assert.throws(()=>assertCandidateReservation(db,{...req,excludedOccupancyId:1,originalAppointmentId:1}),/原预留/);
  db.exec("INSERT INTO visit VALUES(7,30,'2026-10-29T02:00:00Z'); UPDATE resource_occupancy SET visit_id=7 WHERE id=1");
  assert.throws(()=>assertCandidateReservation(db,{...req,branchId:1,scheduleId:1,patientId:30,excludedOccupancyId:1,originalAppointmentId:1}),/原预留/);
 }finally{db.close();}
});
test('来源不明的重叠占用先核实，已释放占用不构成冲突',()=>{
 const db=fixture();try{
  db.exec('UPDATE resource_occupancy SET appointment_id=NULL');
  assert.throws(()=>assertCandidateReservation(db,req),/来源不明/);
  db.exec("UPDATE resource_occupancy SET released_at='2026-10-29T01:30:00Z'");
  assert.doesNotThrow(()=>assertCandidateReservation(db,req));
 }finally{db.close();}
});
test('排班核验牙医跨店冲突、本店诊椅和原排班归属',()=>{
 const db=fixture();try{
  const input={branchId:2,chairId:2,dentistId:10,startsAt:'2026-10-29T02:00:00Z',endsAt:'2026-10-29T03:00:00Z'};
  assert.throws(()=>assertCandidateSchedule(db,input),/已有排班/);
  assert.throws(()=>assertCandidateSchedule(db,{...input,dentistId:99,chairId:1}),/不属于/);
  assert.throws(()=>assertCandidateSchedule(db,{...input,scheduleId:1}),/原排班/);
  assert.doesNotThrow(()=>assertCandidateSchedule(db,{...input,dentistId:20,scheduleId:2}));
  assert.doesNotThrow(()=>assertCandidateSchedule(db,{...input,dentistId:10,startsAt:'2026-10-29T09:00:00Z',endsAt:'2026-10-29T10:00:00Z'}));
 }finally{db.close();}
});
test('实际接诊未结束时，即使预计时间已过也不释放患者与牙医',()=>{
 const db=fixture();try{
  db.exec("INSERT INTO visit VALUES(7,30,'2026-10-29T02:00:00Z'); UPDATE resource_occupancy SET visit_id=7 WHERE id=1");
  const after={...req,patientId:30,startsAt:'2026-10-29T04:00:00Z',endsAt:'2026-10-29T05:00:00Z'};
  assert.throws(()=>assertCandidateReservation(db,after),/已有占用/);
  db.exec('UPDATE dated_schedule SET dentist_id=10 WHERE id=2');
  assert.throws(()=>assertCandidateReservation(db,{...after,patientId:40}),/已有占用/);
 }finally{db.close();}
});
