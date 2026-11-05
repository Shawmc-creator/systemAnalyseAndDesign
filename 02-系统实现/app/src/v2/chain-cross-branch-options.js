'use strict';
const {id,fail}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {hasBranchRole,canReadCrossBranch}=require('./chain-access');

// Lists only identities needed for the in-memory consent workflow; no medical content.
class ChainCrossBranchOptions{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('跨店选项仅允许内存数据库');}
 forManager(credentials,branchId){if(credentials.role!=='manager')fail(403,'FORBIDDEN','需要负责人岗位');const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'clinic.manage',branch);ctx.authority={...ctx.authority,branchId:branch};const now=this.auth.now();
  const visits=this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,p.name patient_name,p.record_no patient_no FROM visit v JOIN patient p ON p.id=v.patient_id
   WHERE v.branch_id=? ORDER BY v.id`).all(branch);
  const branches=this.db.prepare(`SELECT b.id,b.name FROM clinic_branch b JOIN clinic_branch s ON b.chain_id=s.chain_id WHERE s.id=? AND b.id<>s.id AND b.status='active' ORDER BY b.id`).all(branch);
  const dentists=this.db.prepare(`SELECT DISTINCT r.branch_id,s.id,s.name,a.id account_id FROM branch_staff_role r JOIN staff s ON s.id=r.staff_id
   JOIN user_account a ON a.staff_id=s.id AND a.status='启用' JOIN clinic_branch b ON b.id=r.branch_id JOIN clinic_branch origin ON origin.chain_id=b.chain_id
   WHERE origin.id=? AND b.id<>origin.id AND r.role_code='dentist' AND b.status='active' ORDER BY b.id,s.id`).all(branch)
   .filter(d=>hasBranchRole(this.db,{staffId:d.id,branchId:d.branch_id,role:'dentist',at:now})&&this.auth.roles(d.account_id,now).some(r=>r.code==='dentist'))
   .map(({account_id,...d})=>d);
  const grants=this.db.prepare(`SELECT a.id,a.source_branch_id,a.target_branch_id,a.patient_id,a.visit_id,a.dentist_id,a.scope,a.valid_until,a.revoked_at,
   p.name patient_name,s.name dentist_name FROM cross_branch_record_access a JOIN patient p ON p.id=a.patient_id JOIN staff s ON s.id=a.dentist_id
   WHERE a.source_branch_id=? OR a.target_branch_id=? ORDER BY a.id DESC`).all(branch,branch).map(g=>({...g,can_revoke:!g.revoked_at&&(!g.valid_until||g.valid_until>now)&&
    hasBranchRole(this.db,{staffId:ctx.session.staff_id,branchId:g.source_branch_id,role:'branch_manager',at:now})&&hasBranchRole(this.db,{staffId:ctx.session.staff_id,branchId:g.target_branch_id,role:'branch_manager',at:now})}));
  this.unit.audit(ctx,'查询','CHAIN_APPROVAL_OPTIONS',{kind:'branch_approval_options',key:'branch:'+branch},null,'查询授权申请的本店就诊、目标牙医与已有授权');
  this.db.exec('COMMIT');return {visits,branches,dentists,grants};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 forDentist(credentials,branchId){if(credentials.role!=='dentist')fail(403,'FORBIDDEN','需要牙医岗位');const branch=id(branchId,'门店');this.db.exec('BEGIN');try{
  const ctx=this.access.authorizeBranch(credentials,'uc09.query',branch);ctx.authority={...ctx.authority,branchId:branch};const now=this.auth.now();
  const rows=this.db.prepare(`SELECT a.source_branch_id,a.target_branch_id,a.patient_id,a.visit_id,a.scope,a.valid_until,
   p.name patient_name,p.record_no patient_no,v.record_no visit_no,b.name source_name FROM cross_branch_record_access a
   JOIN visit v ON v.id=a.visit_id AND v.patient_id=a.patient_id AND v.branch_id=a.source_branch_id
   JOIN patient p ON p.id=a.patient_id JOIN clinic_branch b ON b.id=a.source_branch_id
   WHERE a.dentist_id=? AND a.target_branch_id=? AND a.scope IN ('record','health','all')`).all(ctx.session.staff_id,branch);
  const items=[];const seen=new Set();for(const grant of rows){for(const scope of grant.scope==='all'?['record','health']:[grant.scope]){
   const k=[grant.source_branch_id,grant.patient_id,grant.visit_id,scope].join(':');
   if(!seen.has(k)&&canReadCrossBranch(this.db,{staffId:ctx.session.staff_id,targetBranchId:branch,sourceBranchId:grant.source_branch_id,patientId:grant.patient_id,visitId:grant.visit_id,scope,at:now})){seen.add(k);items.push({...grant,scope});}
  }}
  this.unit.audit(ctx,'查询','CHAIN_CLINICAL_GRANT_LIST',{kind:'branch_clinical_grants',key:'branch:'+branch},null,'查询本人可用的跨店查阅范围');
  this.db.exec('COMMIT');return {items};
 }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
}
module.exports={ChainCrossBranchOptions};
