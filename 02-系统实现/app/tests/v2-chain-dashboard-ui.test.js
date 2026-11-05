'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8');
const start=source.indexOf('async function branchSummary()'),end=source.indexOf('\nasync function ',start+1);
if(start<0||end<0)throw Error('找不到门店汇总页面函数');
function harness(api){
 const box={children:[],textContent:'',replaceChildren(){this.children=[];this.textContent='';},append(item){this.children.push(item);}};
 const state={role:'manager',branch:1,viewVersion:0,summaryVersion:0};
 const context={state,api,document:{createElement:()=>({textContent:''})},$:()=>box};
 vm.runInNewContext(source.slice(start,end)+'\nthis.run=branchSummary;',context);
 return {box,state,run:context.run};
}
const data=(arrivals,cents)=>({businessDate:'2026-10-19',appointments:{'已预约':arrivals},arrivals,confirmedReceiptCents:cents,confirmedRefundCents:0,confirmedRefundCount:0,netReceiptCents:cents,pendingCounts:1,pendingPurchases:2});
test('门店汇总逐店请求并只汇总授权列表',async()=>{
 const calls=[];const h=harness(async url=>{calls.push(url);if(url==='/api/branches')return {items:[{id:1,name:'一店'},{id:2,name:'二店'}]};return data(url.endsWith('=1')?2:3,url.endsWith('=1')?10001:299);});
 await h.run();assert.deepEqual(calls,['/api/branches','/api/dashboard?branchId=1','/api/dashboard?branchId=2']);
 assert.match(h.box.children[0].textContent,/一店（2026-10-19）：预约 已预约 2 个；到诊 2 人次；已确认收款 ¥100\.01/);
 assert.match(h.box.children[2].textContent,/已授权 2 家门店合计（2026-10-19）：预约 已预约 5 个；到诊 5 人次；已确认收款 ¥103\.00；已确认退款 ¥0\.00；待审核盘点 2 条；待确认采购 4 单/);
});
test('单店权限只显示单店，查询失败不保留旧汇总',async()=>{
 let fail=false;const h=harness(async url=>{if(url==='/api/branches')return {items:[{id:2,name:'二店'}]};if(fail)throw Error('无权访问');return data(1,500);});
 await h.run();assert.equal(h.box.children.length,2);assert.match(h.box.children[1].textContent,/已授权 1 家门店/);
 fail=true;await assert.rejects(h.run(),/无权访问/);assert.equal(h.box.children.length,0);
});
test('查询期间切换岗位或门店，不显示上一个上下文的结果',async()=>{
 let release;const h=harness(url=>url==='/api/branches'?Promise.resolve({items:[{id:1,name:'一店'}]}):new Promise(resolve=>{release=resolve;}));
 const pending=h.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');h.state.branch=2;release(data(1,500));await pending;assert.equal(h.box.children.length,0);
});
test('统计日期不一致时拒绝显示混合汇总',async()=>{
 const h=harness(async url=>url==='/api/branches'?{items:[{id:1,name:'一店'},{id:2,name:'二店'}]}:{...data(1,500),businessDate:url.endsWith('=1')?'2026-10-19':'2026-10-20'});
 await assert.rejects(h.run(),/统计日期不一致/);assert.equal(h.box.children.length,0);
});
test('查询期间切换门店后又切回，旧请求仍不能显示',async()=>{
 let release;const h=harness(url=>url==='/api/branches'?Promise.resolve({items:[{id:1,name:'一店'}]}):new Promise(resolve=>{release=resolve;}));
 const pending=h.run();await new Promise(resolve=>setImmediate(resolve));h.state.branch=2;h.state.viewVersion++;h.state.branch=1;h.state.viewVersion++;release(data(1,500));await pending;assert.equal(h.box.children.length,0);
});
test('查询期间概览被刷新，旧汇总不会重新出现',async()=>{
 let release;const h=harness(url=>url==='/api/branches'?Promise.resolve({items:[{id:1,name:'一店'}]}):new Promise(resolve=>{release=resolve;}));
 const pending=h.run();await new Promise(resolve=>setImmediate(resolve));h.state.summaryVersion++;release(data(1,500));await pending;assert.equal(h.box.children.length,0);
});
