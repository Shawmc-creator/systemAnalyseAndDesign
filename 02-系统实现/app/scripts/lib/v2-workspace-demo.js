'use strict';
const {command}=require('../../tests/helpers/v2-treatment');
function prepareWorkspaceDemo(a){
 if(a.db.location()!==null)throw new Error('工作区和日历演示仅允许内存库');
 const s=a.reception.schedule(a.m,command({action:'publish',businessDate:'2026-10-19',dentistId:1,chairId:2,startsAt:'2026-10-19T09:00:00+08:00',endsAt:'2026-10-19T18:00:00+08:00',reason:'隔离演示另一牙医与诊椅的当日安排'}));
 for(const [start,end]of [['10:15','10:40'],['11:00','11:45']])a.reception.appointment(a.f,command({action:'create',patientId:2,scheduleId:s.id,scheduleRevision:1,startsAt:'2026-10-19T'+start+':00+08:00',endsAt:'2026-10-19T'+end+':00+08:00',reason:'虚构患者的后续预约，用于日历筛选与改约演示'}));
 a.reception.arrive(a.f,command({patientId:2,dentistId:1,scheduleId:s.id,scheduleRevision:1,arrivedAt:a.auth.now(),startsAt:a.auth.now(),endsAt:'2026-10-19T02:00:00Z'}));
 const cancelled=a.reception.appointment(a.f,command({action:'create',patientId:2,scheduleId:s.id,scheduleRevision:1,startsAt:'2026-10-19T13:00:00+08:00',endsAt:'2026-10-19T13:30:00+08:00',reason:'虚构患者拟约后取消的示例'}));a.reception.appointment(a.f,command({action:'cancel',appointmentId:cancelled.id,expectedRevision:1,reason:'虚构患者明确取消，原安排和通知依据保留'}));
 a.reception.schedule(a.m,command({action:'draft',businessDate:'2026-10-20',dentistId:1,chairId:2,startsAt:'2026-10-20T09:00:00+08:00',endsAt:'2026-10-20T18:00:00+08:00',reason:'虚构演示：负责人尚未确认的明日排班草稿'}));
 return a.calendar.query(a.f,{from:'2026-10-19'});
}
module.exports={prepareWorkspaceDemo};
