'use strict';
// Exercise the actual HTTP handler without opening a network socket.
const assert=require('node:assert/strict'),{Readable}=require('node:stream'),path=require('node:path');
const {createWorkspace,openWorkspace}=require('../../src/v2/chain-query-workspace');
const {createWorkspaceServer}=require('../../src/v2/chain-workspace-server');
async function exerciseCrossStore({folder,candidate,sourceSchedule,targetSchedule,sourceVisit}){
 const directory=path.join(folder,'cross-http-workspace');createWorkspace(candidate,directory);
 const clock=()=>new Date('2026-10-19T01:35:00Z'),app=openWorkspace(directory,{clock}),server=createWorkspaceServer(app);server.address=()=>({port:3021});
 async function request(method,url,value,credentials){return new Promise((resolve,reject)=>{const req=Readable.from(value?[Buffer.from(JSON.stringify(value))]:[]);req.method=method;req.url=url;req.headers={host:'127.0.0.1:3021',...(value?{'content-type':'application/json'}:{}),...(credentials?{cookie:credentials.cookie,'x-clinic-role':credentials.role,'x-csrf-token':credentials.csrf}:{})};const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){try{resolve({status:this.status,headers:this.headers,data:JSON.parse(body)});}catch(error){reject(error);}}};server.emit('request',req,res);});}
 async function login(username,role){const r=await request('POST','/api/login',{username,password:'Clinic123!'});assert.equal(r.status,200,JSON.stringify(r.data));return {cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.data.csrf,role};}
 const sourceFront=await login('frontdesk','frontdesk'),targetFront=await login('assistant2','frontdesk'),sourceManager=await login('manager','manager'),targetManager=await login('assistant2','manager'),doctor=await login('dentist','dentist');
 const post=async(url,value,c)=>{const r=await request('POST',url,value,c);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 try{
  const appointment=await post('/api/reception',{action:'create',branchId:1,patientId:2,scheduleId:sourceSchedule.id,scheduleRevision:sourceSchedule.revision,startsAt:'2026-10-19T07:00:00Z',endsAt:'2026-10-19T07:30:00Z',equipmentIds:[],reason:'虚构跨店预约',requestKey:'virtual-cross-book',commandVersion:1},sourceFront);
  const proposal=await post('/api/transfer-proposals',{action:'propose',branchId:1,targetBranchId:2,appointmentId:appointment.id,expectedRevision:1,patientConfirmed:true,contactedAt:'2026-10-19T01:35:00Z',method:'电话',contactNote:'虚构患者同意转店',reason:'虚构跨店交接',requestKey:'virtual-cross-propose',commandVersion:1},sourceFront);
  const unauthorized=await request('GET','/api/reception/options?branchId=1',null,targetFront);assert.equal(unauthorized.status,403);
  const moved=await post('/api/reception',{action:'transfer',branchId:1,targetBranchId:2,transferProposalId:proposal.id,appointmentId:appointment.id,expectedRevision:1,patientConfirmed:true,scheduleId:targetSchedule.id,scheduleRevision:targetSchedule.revision,startsAt:'2026-10-21T01:00:00Z',endsAt:'2026-10-21T01:30:00Z',equipmentIds:[],reason:'虚构目标店确认',transferContact:{method:'电话',note:'虚构患者确认时段',contactedAt:'2026-10-19T01:35:00Z'},requestKey:'virtual-cross-accept',commandVersion:1},targetFront);
  assert.equal(app.db.prepare('SELECT status FROM appointment WHERE id=?').get(appointment.id).status,'已取消');assert.equal(app.db.prepare('SELECT branch_id FROM appointment WHERE id=?').get(moved.id).branch_id,2);
  const approval=await post('/api/approvals',{action:'propose',sourceBranchId:1,targetBranchId:2,dentistId:4,patientId:1,visitId:sourceVisit,scope:'record',validUntil:'2026-10-22T01:00:00Z',reason:'虚构患者同意',requestKey:'virtual-record-propose',commandVersion:1},sourceManager);
  assert.equal((await request('POST','/api/approvals',{action:'approve',proposalId:approval.id,reason:'虚构本人确认',requestKey:'virtual-invalid-self',commandVersion:1},sourceManager)).status,409);
  const grant=await post('/api/approvals',{action:'approve',proposalId:approval.id,reason:'虚构目标负责人核实',requestKey:'virtual-record-approve',commandVersion:1},targetManager);
  const query={targetBranchId:2,sourceBranchId:1,patientId:1,visitId:sourceVisit,scope:'record'};assert.equal((await post('/api/clinical',query,doctor)).record.visit_id,sourceVisit);
  await post('/api/grants',{action:'revoke',grantId:grant.id,reason:'虚构患者撤回',requestKey:'virtual-record-revoke',commandVersion:1},sourceManager);
  assert.equal((await request('POST','/api/clinical',query,doctor)).status,403);
 }finally{app.close();}
 const reopened=openWorkspace(directory,{clock});try{assert.equal(reopened.db.prepare("SELECT count(*) n FROM appointment WHERE branch_id=2 AND status='已预约'").get().n,1);assert.equal(reopened.db.prepare("SELECT count(*) n FROM cross_branch_record_access WHERE revoked_at IS NOT NULL").get().n,1);}finally{reopened.close();}
}
module.exports={exerciseCrossStore};
