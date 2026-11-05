'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8');
const start=source.indexOf('async function clinicalGrants()'),end=source.indexOf('\nasync function treatment(',start);
if(start<0||end<0)throw Error('找不到跨店授权页面函数');
function harness(api){
 const element=()=>({children:[],textContent:'',hidden:false,replaceChildren(){this.children=[];this.textContent='';},append(x){this.children.push(x);}});
 const list=element(),out=element(),state={role:'dentist',branch:2,viewVersion:1,clinicalVersion:0};
 const context={state,api,$:s=>s==='#clinical-grants'?list:out,document:{createElement:element},act:async(_,fn)=>fn(),message:()=>{}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.run=clinicalGrants;',context);return {state,list,out,run:context.run};
}
const grant={scope:'record',source_name:'一店',patient_name:'虚构患者',patient_no:'P1',visit_no:'V1',source_branch_id:1,patient_id:1,visit_id:1};
const record=text=>({record:{chief_complaint:text},findings:[],addenda:[]});
test('切换门店后旧授权列表即使返回也不显示',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));const pending=h.run();h.state.branch=1;h.state.viewVersion++;h.state.branch=2;h.state.viewVersion++;resolve({items:[grant]});await pending;assert.equal(h.list.children.length,0);
});
test('切换岗位或门店后旧病历响应不能显示',async()=>{
 let resolve;const h=harness((url)=>url.startsWith('/api/clinical/grants')?Promise.resolve({items:[grant]}):new Promise(r=>{resolve=r;}));await h.run();const button=h.list.children[0].children[0],pending=button.onclick();h.state.viewVersion++;resolve(record('旧病历'));await pending;assert.equal(h.out.children.length,0);assert.equal(h.out.hidden,true);
});
test('先请求后返回的病历不会覆盖较新的选择',async()=>{
 const pending=[];const h=harness(url=>url.startsWith('/api/clinical/grants')?Promise.resolve({items:[grant,{...grant,visit_id:2,visit_no:'V2'}]}):new Promise(r=>pending.push(r)));await h.run();
 const a=h.list.children[0].children[0].onclick(),b=h.list.children[1].children[0].onclick();pending[1](record('第二条'));await b;pending[0](record('第一条'));await a;
 assert.ok(h.out.children.some(x=>x.textContent.includes('第二条')));assert.ok(!h.out.children.some(x=>x.textContent.includes('第一条')));
});
