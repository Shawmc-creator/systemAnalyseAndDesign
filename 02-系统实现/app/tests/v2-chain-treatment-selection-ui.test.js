'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8'),start=source.indexOf('async function treatment('),end=source.indexOf('\nasync function fetchPlans(',start);
test('开始新接诊后方案、病历、诊疗和处方切换到该患者',async()=>{
 function select(){return {value:'',options:[],replaceChildren(){this.options=[];this.value='';}};}function element(){return {children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);}};}
 const visits=select(),services=select(),recordVisits=select(),plan=select(),rx=select(),waiting=element(),active=element(),elements={'#treatment-form':{elements:{visit:visits,service:services}},'#record-form':{elements:{visit:recordVisits}},'#plan-visit':plan,'#plan-draft-form':{dataset:{}},'#prescription-visit':rx,'#waiting-visits':waiting,'#active-visits':active,'#plan-edit-cancel':{click(){}}};
 for(const key of ['#prescription-load','#dentist-empty','#record-empty','#health-area','#addendum-area','#record-executions','#plan-list'])elements[key]=element();
 let newStarted=false;const old={id:1,status:'诊疗结束',record_no:'旧接诊'},next={id:2,status:'候诊',record_no:'新接诊',revision:1};const state={branch:1,role:'dentist',viewVersion:1};
 const ctx={state,$:s=>elements[s],document:{createElement:element},option:(sel,id)=>{sel.options.push({value:String(id)});if(!sel.value)sel.value=String(id);},visitPatientLabel:v=>v.record_no,api:async url=>{if(url.includes('/start')){newStarted=true;return {};}return {visits:[old,{...next,status:newStarted?'接诊中':'候诊'}],services:[{id:1,name:'检查',billing_unit:'次'}]};},act:(_,fn)=>fn(),command:x=>x,message:()=>{},fixedNow:'2026-10-19T01:35:00Z',followups:async()=>{},loadPlans:async()=>{},loadExecutionPlans:async()=>{},loadRecord:async()=>{}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.run=treatment;',ctx);await ctx.run();assert.equal(plan.value,'1');assert.equal(recordVisits.value,'1');await waiting.children[0].children[0].onclick();for(const s of [plan,recordVisits,visits,rx])assert.equal(s.value,'2');
});
