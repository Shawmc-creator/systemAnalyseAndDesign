'use strict';
// Read-only checks for a fictional demonstration deployment. No ports are opened.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const origin=process.env.CHAIN_DEMO_PUBLIC_ORIGIN||'',config=process.argv[2],checks=[];
function check(name,ok,detail){checks.push({name,ok,detail});}
let validOrigin=false;try{const u=new URL(origin);validOrigin=u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password&&u.hostname!=='localhost';}catch{}
check('Node.js 版本',Number(process.versions.node.split('.')[0])>=24,process.version);
check('公开 HTTPS 来源',validOrigin,validOrigin?origin:'请设置 CHAIN_DEMO_PUBLIC_ORIGIN，例如 https://demo.example.com');
const caddy=spawnSync('caddy',['version'],{encoding:'utf8',windowsHide:true});const hasCaddy=!caddy.error&&caddy.status===0;check('Caddy',hasCaddy,hasCaddy?caddy.stdout.trim():'未找到 Caddy，请安装后重试');
let readyConfig=false;if(config&&path.isAbsolute(config)&&fs.existsSync(config)&&fs.statSync(config).isFile()){
 const text=fs.readFileSync(config,'utf8'),content=text.split(/\r?\n/).filter(line=>!line.trim().startsWith('#')).join('\n');readyConfig=!content.includes('REPLACE_WITH_CADDY_HASHED_PASSWORD')&&!content.includes('demo.example.com')&&/\bbasic_auth\s*\{/.test(content)&&/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(content)&&/\breverse_proxy\s+127\.0\.0\.1:3011\b/.test(content);
 if(readyConfig&&validOrigin){const domain=new URL(origin).host;readyConfig=text.split(/\r?\n/).some(line=>line.trim()===domain+' {');}
}
check('独立代理配置',readyConfig,readyConfig?'已检查域名、bcrypt 密码哈希和本机反代；仍须人工核对完整配置':'请提供含实际域名、bcrypt 密码哈希及本机反代的 Caddyfile 绝对路径');
if(hasCaddy&&readyConfig){const result=spawnSync('caddy',['validate','--config',config],{encoding:'utf8',windowsHide:true});check('Caddy 配置校验',result.status===0,result.status===0?'通过':'未通过，请在服务器运行 caddy validate 查看错误');}
else check('Caddy 配置校验',false,'Caddy 和代理配置就绪后才能校验');
(async()=>{try{const r=await fetch('http://127.0.0.1:3011/api/status',{signal:AbortSignal.timeout(1500)});const s=await r.json();const ok=r.ok&&s.application==='qinghe-chain-demo'&&s.mode==='persistent-snapshot'&&s.publicOrigin===origin&&validOrigin;check('本机演示服务',ok,ok?'服务运行且公开来源匹配':'服务未启动或访问来源不匹配，请重新启动演示');}catch{check('本机演示服务',false,'未连接到本机演示服务');}
 console.log(JSON.stringify({ready:checks.every(x=>x.ok),checks,notice:'仅检查本机准备；证书签发、远程访问、服务器安全及正式系统仍需另行核对'},null,2));if(checks.some(x=>!x.ok))process.exitCode=2;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
