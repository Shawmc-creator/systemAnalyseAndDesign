'use strict';
// Deliberately fictitious verifier. This process never opens a disk database,
// accepts only two fixed non-personal proof strings, and is not a real IdP.
const crypto=require('node:crypto'),{createChainDemo}=require('../src/v2/chain-demo-server');
const issuer='fictional-local-demo',verifier={async verify({proof,nonce}){
 if(!['fictional-patient-1','fictional-patient-2'].includes(proof))throw Error('无效演示身份');
 return {verified:true,issuer,subject:proof,nonce};
}};
const port=Number(process.env.CHAIN_IDENTITY_TRIAL_PORT||3029);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('演示端口无效');
const demo=createChainDemo({identityTrialConfig:{issuer,verifier,bindingKey:crypto.randomBytes(32)}});
demo.server.listen(port,'127.0.0.1',()=>console.log('虚构身份隔离演示：http://127.0.0.1:'+port+'/identity-trial；关闭后数据清除，不可用于真实患者。'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>demo.server.close(()=>{demo.db.close();process.exit(0);}));
