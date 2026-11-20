'use strict';

const {createHmac,randomBytes}=require('node:crypto');
const {isIP}=require('node:net');
const {fail,fact,insert,recordNo}=require('./common');

const sessionSeconds=3600;

function validateWechatDemoConfig({origin,appId,appSecret,identityKey,fetchImpl=fetch}){
  let url;
  try{url=new URL(origin);}catch{throw Error('小程序联调需要完整的 HTTPS 域名');}
  if(url.origin!==origin||url.protocol!=='https:'||url.port||!url.hostname.includes('.')||isIP(url.hostname)){
    throw Error('小程序联调需要 HTTPS 域名且不含路径或端口');
  }
  if(!/^wx[0-9a-f]{16}$/.test(appId)||typeof appSecret!=='string'||!appSecret.trim()||
    !Buffer.isBuffer(identityKey)||identityKey.length!==32){
    throw Error('小程序联调需要有效的 AppID、AppSecret 和 32 字节身份密钥');
  }
  return {origin,host:url.host,appId,appSecret,identityKey,fetchImpl};
}

function configFromEnv(env){
  const {CHAIN_MINIPROGRAM_API_ORIGIN:origin,CHAIN_MINIPROGRAM_APPID:appId,
    CHAIN_MINIPROGRAM_APPSECRET:appSecret,CHAIN_MINIPROGRAM_IDENTITY_KEY:hex}=env;
  if(![origin,appId,appSecret,hex].some(Boolean))return null;
  if(!/^[0-9a-f]{64}$/i.test(hex||''))throw Error('小程序身份密钥须为 64 个十六进制字符');
  return {origin,appId,appSecret,identityKey:Buffer.from(hex,'hex')};
}

class MiniProgramDemoLogin{
  constructor(app,config,booking){
    this.app=app;
    this.config=config;
    this.booking=booking;
    this.sessions=new Map();
    this.loginAttempts=[];
    app.db.exec(`CREATE TABLE IF NOT EXISTS mini_program_demo_patient(
      subject_digest TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL UNIQUE REFERENCES patient(id),
      created_at TEXT NOT NULL
    ) STRICT`);
  }

  async exchange(code){
    if(typeof code!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(code)){
      fail(422,'WECHAT_CODE_INVALID','微信登录凭证无效，请重新登录');
    }
    const now=Date.now();
    this.loginAttempts=this.loginAttempts.filter(at=>now-at<60000);
    if(this.loginAttempts.length>=60)fail(429,'WECHAT_LOGIN_BUSY','登录请求较多，请稍后重试');
    this.loginAttempts.push(now);
    const {appId,appSecret,fetchImpl}=this.config;
    const endpoint=new URL('https://api.weixin.qq.com/sns/jscode2session');
    endpoint.search=new URLSearchParams({appid:appId,secret:appSecret,js_code:code,grant_type:'authorization_code'});
    let result;
    try{
      const response=await fetchImpl(endpoint,{redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('WeChat API unavailable');
      result=await response.json();
    }catch{
      fail(503,'WECHAT_LOGIN_UNAVAILABLE','暂时无法连接微信登录，请稍后重试');
    }
    if(result?.errcode===-1||result?.errcode===45011)fail(503,'WECHAT_LOGIN_BUSY','微信登录服务繁忙，请稍后重试');
    if(result?.errcode||typeof result?.openid!=='string'||!result.openid||result.openid.length>128){
      fail(401,'WECHAT_LOGIN_REJECTED','微信登录未通过，请稍后重试');
    }
    return createHmac('sha256',this.config.identityKey).update(appId+'\0'+result.openid).digest('hex');
  }

  findOrCreatePatient(subjectDigest){
    const {db,auth}=this.app;
    db.exec('BEGIN IMMEDIATE');
    try{
      const existing=db.prepare('SELECT patient_id FROM mini_program_demo_patient WHERE subject_digest=?').get(subjectDigest);
      if(existing){db.exec('COMMIT');return existing.patient_id;}
      const now=auth.now();
      const patientId=insert(db,'patient',fact(now,{
        name:'小程序虚构患者 '+randomBytes(3).toString('hex'),
        contact_unavailable_reason:'课程演示档案，未登记联系方式',
        record_no:recordNo('P'),created_by:this.booking.actor(now)
      }));
      db.prepare('INSERT INTO mini_program_demo_patient(subject_digest,patient_id,created_at) VALUES(?,?,?)').run(subjectDigest,patientId,now);
      db.exec('COMMIT');
      return patientId;
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }

  async login(code){
    const digest=await this.exchange(code);
    const now=Date.now();
    for(const [token,session] of this.sessions){
      if(session.expires<=now||session.digest===digest)this.sessions.delete(token);
    }
    if(this.sessions.size>=100)fail(429,'WECHAT_SESSION_BUSY','体验会话已满，请稍后重试');
    const patientId=this.findOrCreatePatient(digest);
    const token=randomBytes(32).toString('hex');
    this.sessions.set(token,{patientId,digest,expires:now+sessionSeconds*1000});
    return {token,expiresInSeconds:sessionSeconds};
  }

  authorize(token){
    const session=this.sessions.get(token);
    if(!session||session.expires<=Date.now())fail(401,'WECHAT_SESSION_EXPIRED','体验会话已过期，请重新登录');
    return session;
  }
}

module.exports={MiniProgramDemoLogin,configFromEnv,validateWechatDemoConfig};
