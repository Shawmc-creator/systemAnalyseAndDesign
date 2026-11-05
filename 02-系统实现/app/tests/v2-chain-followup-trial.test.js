'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setupFollowups}=require('./helpers/v2-followups');
const {installTrialSchema}=require('../src/v2/chain-schema-trial');
const {ChainReceptionTrial}=require('../src/v2/chain-reception-trial');

function fixture(t) {
 const a=setupFollowups(t), f=a.createFollowup();a.signSource();a.advance('2026-10-20T01:00:00Z');
 const booking=a.book();a.contact(f.id,{nextStep:'arrange',appointmentId:booking.id,expectedAppointmentRevision:1});
 const db=a.db;installTrialSchema(db);
 db.exec(`ALTER TABLE dental_chair ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE clinical_equipment ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE dated_schedule ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE appointment ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id);
 ALTER TABLE followup_requirement ADD COLUMN responsible_branch_id INTEGER REFERENCES clinic_branch(id);
 INSERT INTO clinic_chain(id,name) VALUES(1,'隔离'); INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(1,1,'A','一店'),(2,1,'B','二店');
 UPDATE dental_chair SET branch_id=1; UPDATE clinical_equipment SET branch_id=1;
 UPDATE dated_schedule SET branch_id=1; UPDATE appointment SET branch_id=1; UPDATE visit SET branch_id=1;
 UPDATE followup_requirement SET responsible_branch_id=1;`);
 const staff=a.auth.session(a.f.token).staff_id,manager=a.auth.session(a.m.token).staff_id,now=a.auth.now();
 db.prepare("INSERT INTO branch_staff_role(branch_id,staff_id,role_code,valid_from,granted_by,granted_at,evidence) VALUES(1,?,'frontdesk','2026-10-01T00:00:00Z',?,?,'隔离授权')").run(staff,manager,now);
 return {a,f,booking,service:new ChainReceptionTrial(a)};
}
test('取消关联复诊时原联系保留、待联系恢复并写入历史及审计，失败整体回滚',t=>{
 const {a,f,booking,service}=fixture(t),db=a.db;
 const req={action:'cancel',branchId:1,appointmentId:booking.id,expectedRevision:1,reason:'患者取消',requestKey:'chain-followup-cancel',commandVersion:1};
 const schedule=db.prepare('SELECT dated_schedule_id id FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(booking.id).id;
 assert.throws(()=>service.command(a.f,{action:'reschedule',branchId:1,appointmentId:booking.id,expectedRevision:1,
  scheduleId:schedule,scheduleRevision:1,startsAt:'2026-10-23T03:00:00Z',endsAt:'2026-10-23T03:30:00Z',reason:'改约',requestKey:'chain-followup-window',commandVersion:1}),/目标日期/);
 assert.equal(db.prepare('SELECT status FROM appointment WHERE id=?').get(booking.id).status,'已预约');
 db.exec("UPDATE followup_requirement SET responsible_branch_id=NULL");
 assert.throws(()=>service.command(a.f,req),/负责门店不一致/);
 db.exec('UPDATE followup_requirement SET responsible_branch_id=1');
 db.exec("CREATE TEMP TRIGGER fail_followup_audit BEFORE INSERT ON operation_audit WHEN NEW.object_kind='followup_requirement' BEGIN SELECT RAISE(ABORT,'followup audit failure'); END");
 assert.throws(()=>service.command(a.f,req),/followup audit failure/);
 assert.equal(a.followup(f.id).status,'待到诊或评估');
 assert.equal(db.prepare('SELECT status FROM appointment WHERE id=?').get(booking.id).status,'已预约');
 db.exec('DROP TRIGGER fail_followup_audit');
 service.command(a.f,req);
 assert.equal(a.followup(f.id).status,'待联系');
 assert.equal(db.prepare('SELECT appointment_id FROM contact_history WHERE followup_requirement_id=?').get(f.id).appointment_id,booking.id);
 assert.ok(db.prepare("SELECT id FROM operation_audit WHERE object_kind='followup_requirement' AND outcome_code='FOLLOWUP_CONTACT_RESTORED' AND json_extract(authority_snapshot,'$.branchId')=1").get());
 assert.ok(db.prepare("SELECT id FROM followup_history WHERE followup_requirement_id=? AND event_type='继续跟进'").get(f.id));
 assert.equal(service.command(a.f,req).replayed,true);
});
test('未到须超过截止时间，核实后恢复原复诊联系',t=>{
 const {a,f,booking,service}=fixture(t);
 const req={action:'noShow',branchId:1,appointmentId:booking.id,expectedRevision:1,reason:'已核实未到',requestKey:'chain-followup-noshow',commandVersion:1};
 assert.throws(()=>service.command(a.f,req),/尚未超过/);
 a.advance('2026-10-20T04:00:00Z');service.command(a.f,req);
 assert.equal(a.followup(f.id).status,'待联系');
 assert.equal(a.db.prepare('SELECT status FROM appointment WHERE id=?').get(booking.id).status,'未到');
});
test('复诊转店须实际联系和双店权限，原联系保留并原子关联目标预约',t=>{
 const {a,f,booking,service}=fixture(t),db=a.db;
 const now=a.auth.now(),manager=a.auth.session(a.m.token).staff_id,front=a.auth.session(a.f.token).staff_id;
 db.exec('UPDATE dental_chair SET branch_id=2 WHERE id=2');
 const grant=db.prepare("INSERT INTO branch_staff_role(branch_id,staff_id,role_code,valid_from,granted_by,granted_at,evidence) VALUES(2,?,?,'2026-10-01T00:00:00Z',?,?,'隔离授权')");
 grant.run(front,'frontdesk',manager,now);grant.run(manager,'dentist',manager,now);
 db.prepare(`INSERT INTO dated_schedule(dentist_id,dental_chair_id,business_date,starts_at,ends_at,confirmed_at,created_by,confirmed_by,status,created_at,updated_at,revision,branch_id)
 VALUES(?,2,'2026-10-20','2026-10-20T01:00:00Z','2026-10-20T10:00:00Z',?,?,?,'已确认',?,?,1,2)`).run(manager,now,manager,manager,now,now);
 const schedule=db.prepare('SELECT id FROM dated_schedule WHERE branch_id=2').get().id;
 const req={action:'transfer',branchId:1,targetBranchId:2,appointmentId:booking.id,expectedRevision:1,patientConfirmed:true,
  scheduleId:schedule,scheduleRevision:1,startsAt:'2026-10-20T04:00:00Z',endsAt:'2026-10-20T04:30:00Z',reason:'患者确认转店',
  transferContact:{method:'电话',contactedAt:now,note:'患者已确认目标门店及时段'},requestKey:'chain-followup-transfer',commandVersion:1};
 assert.throws(()=>service.command(a.f,{...req,transferContact:undefined,requestKey:'no-contact'}),/实际联系/);
 assert.throws(()=>service.command(a.f,{...req,startsAt:'2026-10-23T04:00:00Z',endsAt:'2026-10-23T04:30:00Z',requestKey:'out-of-window'}),/目标日期/);
 db.prepare("UPDATE branch_staff_role SET revoked_at=?,revoked_by=? WHERE staff_id=? AND branch_id=2 AND role_code='frontdesk'").run(now,manager,front);
 assert.throws(()=>service.command(a.f,{...req,requestKey:'no-target-access'}),/无权/);
 db.prepare("UPDATE branch_staff_role SET revoked_at=NULL,revoked_by=NULL WHERE staff_id=? AND branch_id=2 AND role_code='frontdesk'").run(front);
 db.exec("CREATE TEMP TRIGGER fail_transfer_followup_audit BEFORE INSERT ON operation_audit WHEN NEW.outcome_code='FOLLOWUP_TRANSFERRED' BEGIN SELECT RAISE(ABORT,'followup transfer audit failure'); END");
 assert.throws(()=>service.command(a.f,req),/followup transfer audit failure/);
 assert.equal(a.followup(f.id).responsible_branch_id,1);
 assert.equal(db.prepare('SELECT status FROM appointment WHERE id=?').get(booking.id).status,'已预约');
 assert.equal(db.prepare('SELECT count(*) n FROM contact_history WHERE followup_requirement_id=?').get(f.id).n,1);
 db.exec('DROP TRIGGER fail_transfer_followup_audit');
 const moved=service.command(a.f,req);
 assert.equal(a.followup(f.id).responsible_branch_id,2);
 const contacts=db.prepare('SELECT appointment_id,note FROM contact_history WHERE followup_requirement_id=? ORDER BY id').all(f.id);
 assert.deepEqual(contacts.map(c=>c.appointment_id),[booking.id,moved.id]);
 assert.equal(contacts[1].note,req.transferContact.note);
 assert.equal(db.prepare('SELECT branch_id FROM appointment WHERE id=?').get(moved.id).branch_id,2);
 assert.ok(db.prepare("SELECT id FROM operation_audit WHERE outcome_code='FOLLOWUP_TRANSFERRED' AND json_extract(authority_snapshot,'$.transfer.targetBranchId')=2").get());
 assert.equal(service.command(a.f,req).replayed,true);
});
