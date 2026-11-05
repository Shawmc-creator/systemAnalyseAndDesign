'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/v2-treatment');
const source=fs.readFileSync(path.join(__dirname,'../public/v2/clinical.js'),'utf8');
const context={esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),localDateTimeSeconds:x=>x};
vm.runInNewContext(source+'\nglobalThis.showHistory=clinicalDecisionHistory;',context);
test('recorded item scope survives a later withdrawal and is shown accurately in decision history',t=>{
 const a=setup(t),v=a.draft([{description:'46修复',toothCode:'46',surfaceCode:'O',quantity:3},{description:'47检查',toothCode:'47',quantity:1}]);
 a.publish(v.id);const [first,second]=a.info().plans[0].versions[0].items;
 a.decide(v.id,2,{wholeScope:false,itemIds:[first.id],itemScopes:[{itemId:first.id,quantity:2}],scopeNote:'先治疗两次'});
 a.decide(v.id,3,{decision:'撤回',wholeScope:false,itemIds:[first.id],itemScopes:[{itemId:first.id,quantity:1}],scopeNote:'撤回一次'});
 const version=a.info().plans[0].versions[0], [accept,withdraw]=version.decisions;
 assert.deepEqual(accept.itemScopes.map(x=>({...x})),[{itemId:first.id,quantity:2}]);
 assert.deepEqual(withdraw.itemScopes.map(x=>({...x})),[{itemId:first.id,quantity:1}]);
 const firstHtml=context.showHistory(accept,version.items),nextHtml=context.showHistory(withdraw,version.items);
 assert.match(firstHtml,/46修复 · 46 \/ O：累计同意上限 2/);assert.doesNotMatch(firstHtml,/47检查/);
 assert.match(nextHtml,/撤回未执行量 1/);assert.equal(version.items.find(x=>x.id===second.id).latestDecision,null);
});
test('history identifies whole scope and safely escapes text or flags missing source items',()=>{
 const html=context.showHistory({decision:'拒绝',decided_at:'时间',explanation_basis:'<告知>',scope_note:'范围',itemScopes:[{itemId:1,quantity:null},{itemId:99,quantity:1}],documentVersionIds:[2]},[{id:1,item_description:'<项目>',tooth_code:null}]);
 assert.match(html,/&lt;项目&gt; · 未指定牙位：整项范围/);assert.match(html,/&lt;告知&gt;/);assert.match(html,/项目 #99（请核对原记录）：限定数量 1/);assert.match(html,/原件版本编号：2/);
});
