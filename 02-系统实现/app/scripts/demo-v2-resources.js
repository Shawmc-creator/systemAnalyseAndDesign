'use strict';
const assert=require('node:assert/strict');
const {createApplication}=require('../src/v2/server');
let clock=new Date('2026-10-19T01:00:00Z'),serial=0;
const a=createApplication({demo:true,clock:()=>clock}),steps=[];
const cmd=value=>({...value,commandVersion:1,requestKey:'resource-demo-'+(++serial)});
const keep=(name,result)=>{steps.push({name,result});return result;};
function refused(name,code,fn){assert.throws(fn,e=>{assert.equal(e.code,code);keep(name,{code:e.code,message:e.message});return true;});}
function login(name){const s=a.auth.login({username:name,password:'Clinic123!'});return {token:s.token,csrf:s.csrf,role:name};}
try {
  const m=login('manager'),f=login('frontdesk'),d=login('dentist'),s=login('assistant');
  const schedule=a.reception.schedule(m,cmd({action:'publish',dentistId:4,chairId:1,businessDate:'2026-10-19',startsAt:'2026-10-19T09:00:00+08:00',endsAt:'2026-10-19T18:00:00+08:00',reason:'演示接诊安排'}));
  const other=a.reception.schedule(m,cmd({action:'publish',dentistId:1,chairId:2,businessDate:'2026-10-19',startsAt:'2026-10-19T09:00:00+08:00',endsAt:'2026-10-19T18:00:00+08:00',reason:'另一牙医与诊椅'}));
  const booking=(patientId,start,end,scheduleId=schedule.id)=>a.reception.appointment(f,cmd({action:'create',patientId,scheduleId,scheduleRevision:1,startsAt:start,endsAt:end,equipmentIds:[1],reason:'演示实际就诊需求'}));
  const first=keep('患者甲预留一号诊椅及共享设备09:30—10:00',booking(1,'2026-10-19T09:30:00+08:00','2026-10-19T10:00:00+08:00'));
  refused('其他诊椅在同一时段也不能重复预留共享设备','EQUIPMENT_CONFLICT',()=>booking(2,'2026-10-19T09:45:00+08:00','2026-10-19T10:15:00+08:00',other.id));
  const second=keep('患者乙预留10:00—11:00，保留先后接诊安排',booking(2,'2026-10-19T10:00:00+08:00','2026-10-19T11:00:00+08:00'));
  const arrive=(b,patientId)=>{const o=a.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(b.id);return a.reception.arrive(f,cmd({patientId,dentistId:4,appointmentId:b.id,expectedRevision:1,occupancyRevision:o.revision,scheduleRevision:1,arrivedAt:a.auth.now()}));};
  const start=v=>a.clinical.record(d,cmd({action:'start',visitId:v.id,expectedVisitRevision:1,startedAt:a.auth.now()}));
  clock=new Date('2026-10-19T01:35:00Z');
  const v1=arrive(first,1);keep('牙医确认患者甲实际开始，设备转为使用中',start(v1));
  clock=new Date('2026-10-19T02:05:00Z');const v2=arrive(second,2);
  refused('患者甲实际操作延时，计划结束时间到达仍不能接诊乙','RESOURCE_STILL_IN_USE',()=>start(v2));
  const record=a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(v1.id);
  a.clinical.health(d,cmd({action:'record',visitId:v1.id,patientId:1,expectedHealthVersionId:null,conclusion:'软件演示，当次未知事项保留',reason:'首次报告',items:['病史','过敏','用药'].map(category=>({category,certainty:'未知',content:'虚拟患者未能确认',source:'隔离演示报告',reportedAt:a.auth.now()}))}));
  a.clinical.record(d,cmd({action:'save',visitId:v1.id,recordId:record.id,expectedRevision:1,chiefComplaint:'虚拟软件场景主诉',diagnosis:'仅用于软件演示的记录',treatmentAdvice:'由接诊牙医按实际情况记录',findings:[{text:'隔离演示检查所见'}]}));
  keep('签署病历并结束临床记录，不替代资源交接',a.clinical.sign(d,cmd({action:'sign',recordId:record.id,expectedRevision:2,confirmed:true})));
  refused('签署后仍需明确确认实际操作结束','RESOURCE_STILL_IN_USE',()=>start(v2));
  const finish=v=>{const visit=a.db.prepare('SELECT * FROM visit WHERE id=?').get(v.id),o=a.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(v.id);return a.resources.finish(d,cmd({visitId:v.id,expectedVisitRevision:visit.revision,expectedOccupancyRevision:o.revision,endedAt:a.auth.now(),confirmed:true,reason:'牙医确认实际操作结束并交接清洁'}));};
  const clean=keep('牙医交接实际结束，自动形成诊椅清洁待核验',finish(v1));
  refused('未完成清洁时患者乙继续候诊','RESOURCE_BLOCKED',()=>start(v2));
  clock=new Date('2026-10-19T02:10:00Z');
  const restore=b=>a.resources.block(s,cmd({action:'restore',blockId:b.id,expectedRevision:1,confirmed:true,verificationNote:'助理已完成实际清洁、器械与设备准备核验'}));
  keep('助理实际清洁核验后恢复资源',restore(clean));
  keep('牙医开始患者乙接诊，共享设备正常转入下一次使用',start(v2));
  clock=new Date('2026-10-19T02:25:00Z');const nextClean=keep('乙的实际操作结束，病历草稿仍可后续完成',finish(v2));
  keep('助理完成乙使用后的清洁核验',restore(nextClean));
  const final=a.resources.query(f,{date:'2026-10-19'});
  assert.equal(final.chairs[0].busy,false);assert.equal(final.chairs[0].blocked,false);
  keep('最终资源状态与原使用历史分别可查',final);
  const integrity=a.db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeys=a.db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(integrity,'ok');assert.deepEqual(foreignKeys,[]);
  process.stdout.write(JSON.stringify({scenario:'设备预留冲突—实际延时—签署不释放—操作结束—清洁核验—下一患者',isolatedInMemory:true,touchesLiveData:false,documentUsecases:['UC-02','UC-03','UC-06','UC-09','UC-24'],integrity,foreignKeys,steps},null,2)+'\n');
} finally {a.db.close();}
