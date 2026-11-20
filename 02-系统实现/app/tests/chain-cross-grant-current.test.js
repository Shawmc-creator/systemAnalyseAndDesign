'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {ChainCrossBranchOptions}=require('../src/v2/chain-cross-branch-options');
test('牙医授权列表显示当前有效授权，不采用过期或撤销记录的截止时间',()=>{
 const demo=createChainDemo(),db=demo.db;
 try{
  const login=demo.app.auth.login({username:'manager',password:'Clinic123'}),dentist=login.user.staffId;
  const visit=db.prepare('SELECT id,patient_id FROM visit WHERE branch_id=1 LIMIT 1').get();
  const add=db.prepare(`INSERT INTO cross_branch_record_access(dentist_id,patient_id,visit_id,source_branch_id,target_branch_id,scope,valid_from,valid_until,granted_by,granted_at,evidence,revoked_at,revoked_by) VALUES(?,?,?,1,2,'record',?,?,?,?,?,?,?)`);
  const args=[dentist,visit.patient_id,visit.id];
  add.run(...args,'2026-10-19T01:00:00Z','2026-10-19T01:10:00Z',dentist,'2026-10-19T01:00:00Z','虚构旧授权',null,null);
  add.run(...args,'2026-10-19T01:10:00Z','2026-10-20T01:00:00Z',dentist,'2026-10-19T01:10:00Z','虚构新授权',null,null);
  const data=new ChainCrossBranchOptions(demo.app).forDentist({token:login.token,csrf:login.csrf,role:'dentist'},2);
  const row=data.items.find(x=>x.visit_id===visit.id&&x.scope==='record');assert.ok(row);assert.equal(row.valid_until,'2026-10-20T01:00:00Z');
 }finally{db.close();}
});
