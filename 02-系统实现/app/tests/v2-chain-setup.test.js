'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createChainDemo}=require('../src/v2/chain-demo-server');const {ChainSetupTrial}=require('../src/v2/chain-setup-trial');const {ChainReceptionTrial}=require('../src/v2/chain-reception-trial');
test('患者资料和排班调整保留历史，版本冲突及无门店权限拒绝',t=>{
 const demo=createChainDemo();t.after(()=>demo.db.close());const setup=new ChainSetupTrial(demo.app);
 function login(username,role){const p=demo.app.auth.login({username,password:'Clinic123!'});return {token:p.token,csrf:p.csrf,role};}
 const front=login('frontdesk','frontdesk'),manager=login('manager','manager'),other=login('assistant','manager');
 const opts=setup.options(manager,2),dentist=opts.dentists[0].id,chair=opts.chairs[0].id;
 const fields={name:'虚构新患者',phone:'13800004444',phone_owner:'本人'};
 const created=setup.command(front,{action:'patient',branchId:2,fields,reason:'建档',requestKey:'direct-new',commandVersion:1});
 const edit={action:'patient-update',branchId:2,patientId:created.id,expectedRevision:1,fields:{phone:'13800005555'},reason:'核对号码',requestKey:'direct-edit',commandVersion:1};
 demo.db.exec("CREATE TEMP TRIGGER patient_edit_audit_failure BEFORE INSERT ON operation_audit WHEN NEW.object_kind='patient' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'audit failed'); END");assert.throws(()=>setup.command(front,edit));assert.equal(demo.db.prepare('SELECT revision FROM patient WHERE id=?').get(created.id).revision,1);assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM patient_change WHERE patient_id=?').get(created.id).n,0);demo.db.exec('DROP TRIGGER patient_edit_audit_failure');
 assert.equal(setup.command(front,edit).revision,2);assert.equal(setup.command(front,edit).replayed,true);assert.throws(()=>setup.command(front,{...edit,requestKey:'stale'}),/变化|版本/);
 assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM patient_change WHERE patient_id=?').get(created.id).n,1);assert.equal(setup.patients(front,2).patients.find(p=>p.id===created.id).phone,'13800005555');assert.throws(()=>setup.patients(manager,2));
 const schedule={action:'publish',branchId:2,dentistId:dentist,chairId:chair,businessDate:'2026-10-22',startsAt:'2026-10-22T01:00:00Z',endsAt:'2026-10-22T09:00:00Z',reason:'排班',requestKey:'direct-schedule',commandVersion:1};
 const published=setup.command(manager,schedule),change={...schedule,action:'change',scheduleId:published.id,expectedRevision:1,startsAt:'2026-10-22T02:00:00Z',requestKey:'direct-change'};
 assert.throws(()=>setup.command(other,{...change,branchId:1}));demo.db.exec("CREATE TEMP TRIGGER schedule_edit_audit_failure BEFORE INSERT ON operation_audit WHEN NEW.object_kind='dated_schedule' AND NEW.event_type='变更' BEGIN SELECT RAISE(ABORT,'audit failed'); END");assert.throws(()=>setup.command(manager,change));assert.equal(demo.db.prepare('SELECT revision FROM dated_schedule WHERE id=?').get(published.id).revision,1);assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM schedule_change WHERE dated_schedule_id=?').get(published.id).n,0);demo.db.exec('DROP TRIGGER schedule_edit_audit_failure');assert.equal(setup.command(manager,change).revision,2);assert.equal(setup.command(manager,change).replayed,true);assert.equal(demo.db.prepare('SELECT change_kind FROM schedule_change WHERE dated_schedule_id=?').get(published.id).change_kind,'调整');
 const reception=new ChainReceptionTrial(demo.app),appointment=reception.command(front,{action:'create',branchId:2,patientId:created.id,scheduleId:published.id,scheduleRevision:2,startsAt:'2026-10-22T03:00:00Z',endsAt:'2026-10-22T03:30:00Z',reason:'预约',requestKey:'direct-book',commandVersion:1});
 assert.throws(()=>setup.command(manager,{...change,expectedRevision:2,requestKey:'occupied-change'}),/占用/);
 reception.command(front,{action:'cancel',branchId:2,appointmentId:appointment.id,expectedRevision:1,reason:'取消',requestKey:'direct-cancel',commandVersion:1});
 assert.equal(setup.command(manager,{action:'close',branchId:2,scheduleId:published.id,expectedRevision:2,reason:'停诊',requestKey:'direct-close',commandVersion:1}).revision,3);
 assert.throws(()=>setup.command(manager,{...change,requestKey:'stale-schedule'}),/变化|版本/);assert.equal(demo.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
