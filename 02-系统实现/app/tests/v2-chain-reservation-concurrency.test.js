'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {assertCandidateReservation}=require('../src/v2/chain-reception-rules');
test('两连接写锁串行化后，第二次核对看到已提交的患者占用',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-lock-test-')), file=path.join(folder,'test.db');
 const a=new DatabaseSync(file), b=new DatabaseSync(file);
 try {
  a.exec(`CREATE TABLE clinic_branch(id INTEGER PRIMARY KEY,status TEXT);
   CREATE TABLE dental_chair(id INTEGER PRIMARY KEY,branch_id INTEGER);
   CREATE TABLE dated_schedule(id INTEGER PRIMARY KEY,branch_id INTEGER,dentist_id INTEGER,dental_chair_id INTEGER,starts_at TEXT,ends_at TEXT,status TEXT);
   CREATE TABLE appointment(id INTEGER PRIMARY KEY,patient_id INTEGER,branch_id INTEGER);
   CREATE TABLE visit(id INTEGER PRIMARY KEY,patient_id INTEGER,started_at TEXT);
   CREATE TABLE resource_occupancy(id INTEGER PRIMARY KEY,dated_schedule_id INTEGER,appointment_id INTEGER,visit_id INTEGER,starts_at TEXT,ends_at TEXT,released_at TEXT);
   INSERT INTO clinic_branch VALUES(1,'active'),(2,'active'); INSERT INTO dental_chair VALUES(1,1),(2,2);
   INSERT INTO dated_schedule VALUES(1,1,1,1,'2026-10-29T01:00:00Z','2026-10-29T09:00:00Z','已确认'),(2,2,2,2,'2026-10-29T01:00:00Z','2026-10-29T09:00:00Z','已确认');`);
  const input={branchId:1,patientId:3,scheduleId:1,startsAt:'2026-10-29T02:00:00Z',endsAt:'2026-10-29T03:00:00Z'};
  a.exec('BEGIN IMMEDIATE'); assertCandidateReservation(a,input);
  assert.throws(()=>b.exec('BEGIN IMMEDIATE'),/locked/);
  a.exec("INSERT INTO appointment VALUES(1,3,1); INSERT INTO resource_occupancy VALUES(1,1,1,NULL,'2026-10-29T02:00:00Z','2026-10-29T03:00:00Z',NULL); COMMIT");
  b.exec('BEGIN IMMEDIATE');
  assert.throws(()=>assertCandidateReservation(b,{...input,branchId:2,scheduleId:2}),/已有占用/);
  b.exec('ROLLBACK');
 } finally {if(a.isTransaction)a.exec('ROLLBACK');if(b.isTransaction)b.exec('ROLLBACK');a.close();b.close();fs.rmSync(folder,{recursive:true,force:true});}
});
