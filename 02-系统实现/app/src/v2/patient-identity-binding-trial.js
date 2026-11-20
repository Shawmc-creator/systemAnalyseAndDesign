'use strict';
// Isolated integration component; no HTTP binding or real provider.
const {randomBytes,createHash}=require('node:crypto');
const {id,text,fail}=require('./common');
const {ChainAuth}=require('./chain-auth');
const digest=s=>createHash('sha256').update(s).digest('hex');
class PatientIdentityBindingTrial{
 constructor({app,identity,clock=()=>Date.now()}){this.app=app;this.db=app.db;this.access=new ChainAuth(app.auth);this.identity=identity;this.clock=clock;this.challenges=new Map();}
 authorize(credentials,branchId){if(credentials.role!=='frontdesk'||!credentials.csrf)fail(403,'FORBIDDEN','需要已授权前台及安全令牌');return this.access.authorizeBranch(credentials,'uc08.maintain',id(branchId,'门店'));}
 list(credentials,{branchId,patientId}){id(patientId,'患者');this.db.exec('BEGIN');try{const ctx=this.authorize(credentials,branchId);if(!this.db.prepare('SELECT id FROM patient WHERE id=?').get(patientId))fail(404,'PATIENT_MISSING','患者档案不存在');const items=this.db.prepare('SELECT id,patient_id,issuer,verified_by,verified_at,revoked_at,revoked_by,revocation_reason FROM patient_verified_identity WHERE patient_id=? ORDER BY id DESC').all(patientId);ctx.authority={...ctx.authority,branchId,patientId};this.app.unit.audit(ctx,'查询','PATIENT_IDENTITY_LIST',{kind:'patient',key:patientId},null,'查询患者身份关联');this.db.exec('COMMIT');return {items};}catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 challenge(credentials,branchId){const ctx=this.authorize(credentials,branchId),now=this.clock();for(const [k,v] of this.challenges)if(v.expires<=now)this.challenges.delete(k);if(this.challenges.size>=500)fail(429,'PATIENT_AUTH_BUSY','请稍后重试');const nonce=randomBytes(32).toString('hex');this.challenges.set(digest(nonce),{branchId,accountId:ctx.session.account_id,sessionId:ctx.session.id,expires:now+120000});return {nonce,expiresInSeconds:120};}
 async bind(credentials,{branchId,patientId,proof,nonce,confirmed,basis}){
  const ctx=this.authorize(credentials,branchId);id(patientId,'患者');basis=text(basis,'现场核实依据',1000);if(confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认已核对患者和档案');
  if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');
  const key=digest(nonce),challenge=this.challenges.get(key);this.challenges.delete(key);
  if(!challenge||challenge.expires<=this.clock()||challenge.branchId!==branchId||challenge.accountId!==ctx.session.account_id||challenge.sessionId!==ctx.session.id)fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');
  const subjectHash=await this.identity.verifiedSubjectHash({proof,nonce});if(challenge.expires<=this.clock())fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');
  this.db.exec('BEGIN IMMEDIATE');try{
   const current=this.authorize(credentials,branchId),now=this.app.auth.now();if(current.session.id!==challenge.sessionId)fail(401,'PATIENT_AUTH_CHALLENGE','工作人员会话已变化');
   if(!this.db.prepare('SELECT id FROM patient WHERE id=?').get(patientId))fail(404,'PATIENT_MISSING','患者档案不存在');
   if(this.db.prepare('SELECT 1 FROM patient_verified_identity WHERE issuer=? AND subject_hash=? AND revoked_at IS NULL').get(this.identity.issuer,subjectHash))fail(409,'PATIENT_IDENTITY_BOUND','该身份已有有效关联，请先核对');
   const key=Number(this.db.prepare('INSERT INTO patient_verified_identity(patient_id,issuer,subject_hash,verified_by,verification_basis,verified_at) VALUES(?,?,?,?,?,?)').run(patientId,this.identity.issuer,subjectHash,current.session.staff_id,basis,now).lastInsertRowid);
   current.authority={...current.authority,branchId,patientId};this.app.unit.audit(current,'变更','PATIENT_IDENTITY_BOUND',{kind:'patient_verified_identity',key},null,'核验后关联患者身份');
   this.db.exec('COMMIT');return {id:key,patientId};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 revoke(credentials,{branchId,bindingId,reason,confirmed}){
  id(bindingId,'身份关联');reason=text(reason,'撤销原因',1000);if(confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认撤销关联');
  this.db.exec('BEGIN IMMEDIATE');try{const ctx=this.authorize(credentials,branchId),now=this.app.auth.now(),binding=this.db.prepare('SELECT id,patient_id,revoked_at FROM patient_verified_identity WHERE id=?').get(bindingId);if(!binding||binding.revoked_at)fail(409,'PATIENT_IDENTITY_INACTIVE','关联不存在或已撤销');
   this.db.prepare('UPDATE patient_verified_identity SET revoked_at=?,revoked_by=?,revocation_reason=? WHERE id=? AND revoked_at IS NULL').run(now,ctx.session.staff_id,reason,bindingId);
   ctx.authority={...ctx.authority,branchId,patientId:binding.patient_id};this.app.unit.audit(ctx,'变更','PATIENT_IDENTITY_REVOKED',{kind:'patient_verified_identity',key:bindingId},null,reason);this.db.exec('COMMIT');return {id:bindingId,patientId:binding.patient_id};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
}
module.exports={PatientIdentityBindingTrial};
