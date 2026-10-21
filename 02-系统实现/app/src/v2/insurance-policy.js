'use strict';
const fs=require('node:fs'),path=require('node:path');
const {text,instant,fail}=require('./common');
function normalizeInsurancePolicy(policy={enabled:false}){if(!policy||typeof policy!=='object'||typeof policy.enabled!=='boolean')throw new Error('医保机构配置格式错误');if(!policy.enabled)return {enabled:false};return {enabled:true,institutionCode:text(policy.institutionCode,'定点机构编码',100),verificationBasis:text(policy.verificationBasis,'机构定点及办理条件核验依据',2000),verifiedBy:text(policy.verifiedBy,'条件核实责任人',100),validFrom:instant(policy.validFrom,'机构条件生效时间'),validUntil:instant(policy.validUntil,'机构条件截止时间')};}
function loadInsurancePolicy(filename){const file=path.join(path.dirname(path.resolve(filename)),'insurance-config.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{enabled:false};}
function policyState(policy,now,simulation=false){const active=policy.enabled&&policy.validFrom<=now&&policy.validUntil>now;return {enabled:policy.enabled,active:!!active,institutionCode:active?policy.institutionCode:null,mode:simulation?'隔离演示':'人工核实官方平台结果',networkConnected:false,note:simulation?'隔离演示数据；未调用真实支付或医保平台':'未配置地区医保接口；通过独立官方终端办理后核实原单，系统不自动发起联网结算'};}
function requireActive(policy,now,simulation){const s=policyState(policy,now,simulation);if(!s.active)fail(409,'INSURANCE_DISABLED','医保办理条件未启用或已过期；请核实机构定点与办理条件');return s;}
module.exports={normalizeInsurancePolicy,loadInsurancePolicy,policyState,requireActive};
