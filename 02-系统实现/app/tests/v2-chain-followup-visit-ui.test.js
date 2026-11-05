'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8'),start=source.indexOf('function eligibleFollowupVisits('),end=source.indexOf('\n',start);
if(start<0||end<0)throw Error('找不到复诊就诊筛选函数');const ctx={};vm.runInNewContext(source.slice(start,end)+'\nthis.select=eligibleFollowupVisits;',ctx);
test('复诊评估只显示同一患者、要求形成后且当前进行中的其他接诊',()=>{
 const item={patient_id:1,source_visit_id:7,created_at:'2026-10-19T01:00:00Z'},now='2026-10-19T01:35:00Z',base={id:8,patient_id:1,started_at:'2026-10-19T01:30:00Z',ended_at:null};
 const visits=[base,{...base,id:7},{...base,id:9,patient_id:2},{...base,id:10,started_at:'2026-10-19T00:30:00Z'},{...base,id:11,started_at:'2026-10-19T02:00:00Z'},{...base,id:12,ended_at:'2026-10-19T01:34:00Z'}];
 assert.deepEqual(Array.from(ctx.select(visits,item,now),x=>x.id),[8]);assert.equal(ctx.select(visits,null,now).length,0);
});
test('牙医选择到诊检查时显示候选就诊或空提示，切换远程后隐藏',async()=>{
 const start=source.indexOf('async function followups()'),end=source.indexOf('\nfunction recordDirty()',start);assert.ok(start>=0&&end>start);
 const selector=()=>({value:'',options:[],replaceChildren(){this.options=[];this.value='';}}),followup=selector(),visit=selector(),method={value:'远程沟通'},frontdesk=selector();
 const advice={value:'完成'},nextDate={value:'2026-10-20'},responsibleFrontdesk=selector(),assess={elements:{followup,visit,method,advice,nextDate,responsibleFrontdesk},hidden:false},create={elements:{frontdesk}},list={children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);},textContent:''},label={hidden:false},empty={hidden:false},nextLabel={hidden:false},ownerLabel={hidden:false};
 const nodes={'#dentist-followups':list,'#followup-create-form':create,'#followup-assess-form':assess,'#followup-visit-label':label,'#followup-visit-empty':empty,'#followup-next-label':nextLabel,'#followup-owner-label':ownerLabel};
 const item={id:1,patient_id:1,patient_name:'虚构',patient_no:'P1',source_visit_id:7,created_at:'2026-10-19T01:00:00Z',status:'待联系',next_contact_date:'2026-10-20',contacts:[],assessments:[{method:'到诊检查',assessed_at:'2026-10-19T01:35:00Z',result:'虚构复诊结果',advice:'完成',visit_id:8}]},now='2026-10-19T01:35:00Z';
 const data={items:[item],frontdesks:[],visits:[{id:8,patient_id:1,record_no:'V8',started_at:'2026-10-19T01:30:00Z',ended_at:null}]};
 const c={state:{branch:1,role:'dentist',viewVersion:0},fixedNow:now,api:async()=>data,$:s=>nodes[s],option:(s,value)=>{s.options.push(value);if(!s.value)s.value=String(value);},visitPatientLabel:p=>p.patient_name+'（'+p.patient_no+'）',updateFollowupCreate:()=>{},date:x=>x,document:{createElement:()=>({textContent:''})},eligibleFollowupVisits:ctx.select};
 vm.runInNewContext(source.slice(start,end)+'\nthis.run=followups;',c);await c.run();assert.ok(list.children.some(x=>x.textContent.includes('虚构复诊结果')));assert.ok(list.children.some(x=>x.textContent.includes('下次联系 2026-10-20')));assert.equal(label.hidden,true);method.value='到诊检查';method.onchange();assert.equal(label.hidden,false);assert.equal(empty.hidden,true);assert.deepEqual(visit.options,[8]);assert.equal(visit.required,true);
 data.visits=[];method.onchange();assert.equal(empty.hidden,false);method.value='远程沟通';method.onchange();assert.equal(label.hidden,true);assert.equal(empty.hidden,true);assert.equal(visit.required,false);
 assert.equal(nextLabel.hidden,true);advice.value='继续跟进';advice.onchange();assert.equal(nextLabel.hidden,false);assert.equal(ownerLabel.hidden,false);assert.equal(responsibleFrontdesk.required,true);assert.equal(nextDate.required,true);advice.value='完成';advice.onchange();assert.equal(nextLabel.hidden,true);assert.equal(ownerLabel.hidden,true);assert.equal(nextDate.required,false);
});
