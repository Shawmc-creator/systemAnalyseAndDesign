'use strict';
// Isolated identity-session building block. No HTTP endpoint, cookie or real
// provider is configured here. Callers must enforce TLS, CSRF and origin checks.
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {fail}=require('./common');
const digest=s=>createHash('sha256').update(s).digest('hex');
class PatientIdentitySessionTrial{
 constructor({db,identity,clock=()=>Date.now()}){this.db=db;this.identity=identity;this.clock=clock;this.challenges=new Map();this.sessions=new Map();}
 clean(now){for(const [k,v] of this.challenges)if(v.expires<=now)this.challenges.delete(k);for(const [k,v] of this.sessions)if(v.expires<=now)this.sessions.delete(k);}
 challenge(){const now=this.clock();this.clean(now);if(this.challenges.size>=500)fail(429,'PATIENT_AUTH_BUSY','请稍后重试');const nonce=randomBytes(32).toString('hex');this.challenges.set(digest(nonce),{expires:now+120000});return {nonce,expiresInSeconds:120};}
 async login({proof,nonce}){if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');const now=this.clock(),key=digest(nonce),challenge=this.challenges.get(key);this.challenges.delete(key);if(!challenge||challenge.expires<=now)fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');this.clean(now);if(this.sessions.size>=500)fail(429,'PATIENT_AUTH_BUSY','请稍后重试');
  const binding=await this.identity.resolveBinding({proof,nonce});
  const completedAt=this.clock();if(challenge.expires<=completedAt)fail(401,'PATIENT_AUTH_CHALLENGE','身份核验请求已失效');this.clean(completedAt);if(this.sessions.size>=500)fail(429,'PATIENT_AUTH_BUSY','请稍后重试');
  const active=this.db.prepare('SELECT patient_id FROM patient_verified_identity WHERE id=? AND revoked_at IS NULL').get(binding.bindingId);if(!active||active.patient_id!==binding.patientId)fail(401,'PATIENT_AUTH_REVOKED','患者身份关联已失效');
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');this.sessions.set(digest(token),{patientId:binding.patientId,bindingId:binding.bindingId,csrf:digest(csrf),expires:this.clock()+1800000});return {token,csrf,expiresInSeconds:1800};}
 authorize(token,csrf){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail(401,'PATIENT_SESSION_INVALID','请重新登录');const key=digest(token),session=this.sessions.get(key);if(!session||session.expires<=this.clock()){this.sessions.delete(key);fail(401,'PATIENT_SESSION_INVALID','请重新登录');}
  const active=this.db.prepare('SELECT patient_id FROM patient_verified_identity WHERE id=? AND revoked_at IS NULL').get(session.bindingId);if(!active||active.patient_id!==session.patientId){this.sessions.delete(key);fail(401,'PATIENT_AUTH_REVOKED','患者身份关联已失效');}
  if(csrf!==undefined){if(typeof csrf!=='string'||!/^[a-f0-9]{64}$/.test(csrf)||!timingSafeEqual(Buffer.from(session.csrf,'hex'),Buffer.from(digest(csrf),'hex')))fail(403,'CSRF_INVALID','安全令牌无效');}
  return {patientId:session.patientId,bindingId:session.bindingId};}
 logout(token,csrf){if(typeof csrf!=='string')fail(403,'CSRF_INVALID','安全令牌无效');this.authorize(token,csrf);this.sessions.delete(digest(token));}
}
module.exports={PatientIdentitySessionTrial};
