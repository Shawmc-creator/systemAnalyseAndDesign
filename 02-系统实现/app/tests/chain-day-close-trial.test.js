'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createChainDemo}=require('../src/v2/chain-demo-server'),{ChainDayCloseTrial}=require('../src/v2/chain-day-close-trial');
test('门店渠道核对保留原记录、限制权限并拒绝过期汇总',()=>{
 const d=createChainDemo(),app=d.app,service=new ChainDayCloseTrial(app);
 try{
  const m=app.auth.login({username:'manager',password:'Clinic123'}),c={token:m.token,csrf:m.csrf,role:'manager'};
  const p=service.preview(c,1,'现金');
  assert.equal(p.expectedCents,p.receiptCents-p.refundCents);
  const input={branchId:1,channel:'现金',businessDate:p.businessDate,sourceDigest:p.sourceDigest,actualCents:p.expectedCents-100,evidence:'虚构实盘核对',confirmed:true,requestKey:'test-day-close',commandVersion:1};
  const saved=service.record(c,input);assert.equal(saved.differenceCents,-100);
  assert.equal(service.record(c,input).replayed,true);
  assert.throws(()=>service.record(c,{...input,requestKey:'invalid-source',sourceDigest:'0'.repeat(64)}),e=>e.code==='SOURCE_CHANGED');
  assert.throws(()=>service.record(c,{...input,requestKey:'no-confirm',confirmed:false}),e=>e.code==='INVALID_INPUT');
  assert.throws(()=>d.db.prepare('UPDATE chain_day_close SET actual_cents=0 WHERE id=?').run(saved.id),/day_close_frozen/);
  const a=app.auth.login({username:'assistant',password:'Clinic123'}),branch2={token:a.token,csrf:a.csrf,role:'manager'};
  assert.throws(()=>service.preview(branch2,1,'现金'),e=>e.code==='BRANCH_FORBIDDEN');
  assert.equal(service.preview(branch2,2,'现金').items.length,0);
  assert.equal(service.preview(c,1,'现金').items[0].id,saved.id);
 }finally{d.db.close();}
});
