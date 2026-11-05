'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8');
function extract(name){const start=source.indexOf('async function '+name+'('),end=name==='cashierPrices'?source.indexOf('\n',start):name==='manager'?source.indexOf('\n}',start)+2:source.indexOf('\nasync function ',start+1);if(start<0||end<0)throw Error('找不到页面函数 '+name);return source.slice(start,end);}
for(const [name,role] of [['reception','frontdesk'],['manager','manager'],['cashierPrices','cashier']])test(name+' 旧门店请求不会覆盖切回后的页面',async()=>{
 const queue=[],state={branch:1,role,viewVersion:0},context={state,api:()=>new Promise(r=>queue.push(r)),$:()=>{throw Error('旧请求不应更新页面');}};
 vm.runInNewContext(extract(name)+'\nthis.run='+name,context);const pending=context.run();state.branch=2;state.viewVersion++;state.branch=1;state.viewVersion++;for(const r of queue)r({});await pending;
});
test('收费查询返回顺序颠倒时较早患者不会覆盖当前患者',async()=>{
 const queue=[],field={value:'1'},state={branch:1,role:'cashier',viewVersion:1,financeVersion:0,patient:null,bills:[]};
 const context={state,api:()=>new Promise(r=>queue.push(r)),$:s=>{if(s==='#finance-query')return {elements:{patient:field}};throw Error('旧请求不应更新页面');},prepayments:()=>{throw Error('旧请求不应查询预付');}};
 vm.runInNewContext(extract('finance')+'\nthis.run=finance',context);const old=context.run();field.value='2';const newer=context.run();queue[0]({items:[]});await old;assert.equal(state.patient,null);state.viewVersion++;queue[1]({items:[]});await newer;assert.equal(state.patient,null);
});
for(const [name,role] of [['patients','frontdesk'],['schedules','manager'],['purchases','assistant'],['inventory','assistant'],['treatment','dentist'],['quoteList','cashier'],['resources','frontdesk'],['followups','frontdesk'],['prepayReview','manager']])test(name+' 切店后切回时丢弃旧结果',async()=>{
 const start=source.indexOf('async function '+name+'('),guardEnd=source.indexOf('return;',start);if(start<0||guardEnd<0)throw Error('找不到页面核对');
 const snippet=source.slice(start,guardEnd+7)+"throw Error('旧请求未被拦截');}";
 let release;const state={branch:1,role,viewVersion:0},context={state,api:()=>new Promise(r=>{release=r;})};vm.runInNewContext(snippet+'\nthis.run='+name,context);
 const pending=context.run();state.branch=2;state.viewVersion++;state.branch=1;state.viewVersion++;release({});await pending;
});
