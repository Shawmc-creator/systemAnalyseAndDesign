'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8');
const start=source.indexOf('function defaultChangeSchedule('),end=source.indexOf('\nasync function beginAppointmentChange',start);
if(start<0||end<0)throw Error('找不到预约调整页面函数');
function harness(mode,schedules,appointment){
 const select={value:'',options:[],replaceChildren(){this.value='';this.options=[];}};
 const f={elements:{targetBranch:{value:mode==='transfer'?'2':'1'},schedule:select,start:{value:''},end:{value:''}}};
 const ctx={appointmentChange:{appointment,mode,schedules:[]},fixedNow:'2026-10-19T01:35:00Z',$:()=>f,api:async()=>({schedules}),date:x=>x,localInput:x=>new Date(Date.parse(x)+8*3600000).toISOString().slice(0,16),option:(el,id)=>{el.options.push(id);if(!el.value)el.value=String(id);}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.load=loadChangeSchedules;this.change=setChangeTime;',ctx);return {f,ctx};
}
const slots=[{id:1,starts_at:'2026-10-19T01:00:00Z',ends_at:'2026-10-19T10:00:00Z'},{id:2,starts_at:'2026-10-20T01:00:00Z',ends_at:'2026-10-20T10:00:00Z'}];
const appointment={schedule_id:2,planned_start:'2026-10-20T03:00:00Z',planned_end:'2026-10-20T03:45:00Z'};
test('同店改约默认选原排班并保留原时间与时长',async()=>{const h=harness('reschedule',slots,appointment);await h.ctx.load();assert.equal(h.f.elements.schedule.value,'2');assert.equal(h.f.elements.start.value,'2026-10-20T11:00');assert.equal(h.f.elements.end.value,'2026-10-20T11:45');});
test('转店优先选择覆盖原时段的目标排班',async()=>{const h=harness('transfer',[{...slots[0],id:3},{...slots[1],id:4}],appointment);await h.ctx.load();assert.equal(h.f.elements.schedule.value,'4');assert.equal(h.f.elements.start.value,'2026-10-20T11:00');});
test('没有适合原时段的排班时使用有效时段，不超过排班结束',async()=>{const h=harness('transfer',[{id:3,starts_at:'2026-10-19T01:00:00Z',ends_at:'2026-10-19T01:50:00Z'}],appointment);await h.ctx.load();assert.equal(h.f.elements.start.value,'2026-10-19T09:35');assert.equal(h.f.elements.end.value,'2026-10-19T09:50');});
test('目标门店没有可用排班时清空时间',async()=>{const h=harness('transfer',[],appointment);h.f.elements.start.value='2026-10-20T11:00';h.f.elements.end.value='2026-10-20T11:45';await h.ctx.load();assert.equal(h.f.elements.start.value,'');assert.equal(h.f.elements.end.value,'');});
