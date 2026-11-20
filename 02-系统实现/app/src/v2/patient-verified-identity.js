'use strict';
// Adapter boundary only. A trusted identity provider must perform its own
// signature, expiry, audience, nonce and replay verification before returning.
// This module is not registered as an HTTP login endpoint.
const {createHmac}=require('node:crypto');
const {fail}=require('./common');

class PatientVerifiedIdentity {
 constructor({db,verifier,issuer,bindingKey}){
  this.db=db;this.verifier=verifier;this.issuer=issuer;this.bindingKey=bindingKey;
 }
 async resolve({proof,nonce}){const binding=await this.resolveBinding({proof,nonce});return {patientId:binding.patientId};}
 async verifiedSubjectHash({proof,nonce}){
  if(!this.verifier||typeof this.verifier.verify!=='function'||typeof this.issuer!=='string'||!this.issuer||!Buffer.isBuffer(this.bindingKey)||this.bindingKey.length<32)
   fail(503,'PATIENT_IDENTITY_UNAVAILABLE','患者身份核验尚未配置');
  if(!this.db?.prepare||!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='patient_verified_identity'").get())
   fail(503,'PATIENT_IDENTITY_UNAVAILABLE','患者身份关联尚未配置');
  if(typeof proof!=='string'||!proof||proof.length>16384||typeof nonce!=='string'||!nonce||nonce.length>256)
   fail(422,'PATIENT_IDENTITY_INPUT','身份核验材料无效');
  let result;
  try{result=await this.verifier.verify({proof,nonce});}catch{fail(401,'PATIENT_IDENTITY_INVALID','身份核验未通过');}
  if(!result||result.verified!==true||result.issuer!==this.issuer||result.nonce!==nonce||typeof result.subject!=='string'||!result.subject||result.subject.length>1024)
   fail(401,'PATIENT_IDENTITY_INVALID','身份核验未通过');
  return createHmac('sha256',this.bindingKey).update(this.issuer+'\0'+result.subject).digest('hex');
 }
 async resolveBinding({proof,nonce}){
  const subjectHash=await this.verifiedSubjectHash({proof,nonce});
  const binding=this.db.prepare("SELECT id,patient_id FROM patient_verified_identity WHERE issuer=? AND subject_hash=? AND revoked_at IS NULL").get(this.issuer,subjectHash);
  if(!binding)fail(403,'PATIENT_IDENTITY_UNBOUND','身份尚未与患者档案核实关联，请联系诊所');
  return {patientId:binding.patient_id,bindingId:binding.id};
 }
}
module.exports={PatientVerifiedIdentity};
