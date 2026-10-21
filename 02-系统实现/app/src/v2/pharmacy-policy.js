'use strict';
const fs=require('node:fs'),path=require('node:path');
const {text,instant,fail,canonical,hash}=require('./common');
function normalizePolicy(input={enabled:false}){
 if(!input||typeof input.enabled!=='boolean')fail(422,'PHARMACY_POLICY','机构药学配置须明确是否启用');
 if(!input.enabled)return {enabled:false};
 const p={enabled:true,verificationBasis:text(input.verificationBasis,'机构药学条件核实依据',2000),verifiedBy:text(input.verifiedBy,'机构条件核实人',100),validFrom:instant(input.validFrom,'机构条件生效时间'),validUntil:instant(input.validUntil,'机构条件有效截止时间')};
 if(p.validUntil<=p.validFrom)fail(422,'PHARMACY_POLICY','机构条件截止时间须晚于生效时间');return p;
}
function loadPolicy(filename){const file=path.join(path.dirname(path.resolve(filename)),'pharmacy-config.json');return fs.existsSync(file)?normalizePolicy(JSON.parse(fs.readFileSync(file,'utf8'))):{enabled:false};}
function policyState(policy,now){return {...policy,active:!!(policy.enabled&&policy.validFrom<=now&&policy.validUntil>now),digest:hash(canonical(policy))};}
module.exports={normalizePolicy,loadPolicy,policyState};
