'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/v2/calendar.js'),'utf8');
const context={esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 localDateTime:iso=>{assert.ok(iso,'must not format a missing time');return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replace(' ','T');},
 localDateTimeSeconds:iso=>{assert.ok(iso,'must not format a missing time');return iso;}};
vm.runInNewContext(source+'\nglobalThis.renderHistory=calendarHistoryEntry;globalThis.statusReason=calendarStatusReason;',context);
test('appointment history formats actual reschedule times without inventing new times for notification or cancellation',()=>{
 const original={old_start:'2026-10-19T01:30:00Z',old_end:'2026-10-19T02:00:00Z',occurred_at:'2026-10-19T01:00:00Z',reason:'已核对患者'};
 const changed=context.renderHistory({...original,change_kind:'改约',new_start:'2026-10-19T02:15:00Z',new_end:'2026-10-19T02:45:00Z'});
 assert.match(changed,/原安排 2026-10-19T09:30—2026-10-19T10:00 → 新安排 2026-10-19T10:15—2026-10-19T10:45/);
 for(const kind of ['通知','取消']){const html=context.renderHistory({...original,change_kind:kind,new_start:null,new_end:null,reason:'<脚本>'});assert.match(html,/原安排 2026-10-19T09:30—2026-10-19T10:00/);assert.doesNotMatch(html,/新安排|1970/);assert.match(html,/&lt;脚本&gt;/);}
 assert.equal(context.statusReason({status:'未到',status_reason:'<电话核实>'}),'<p>未到核实依据：&lt;电话核实&gt;</p>');
 assert.equal(context.statusReason({status:'已取消',status_reason:'患者取消'}),'<p>取消依据：患者取消</p>');
 assert.equal(context.statusReason({status:'已预约',status_reason:null}),'');
});
