'use strict';
// Package code only: never include the current databases, snapshots or documents.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const app=path.resolve(__dirname,'..'),assignment=path.resolve(app,'../..');
const destination=process.argv[2];
function directory(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory())throw Error('源目录无效或是符号链接：'+p);}
function file(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isFile())throw Error('源文件无效或是符号链接：'+p);}
function copyFile(from,to){file(from);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}
function copyTree(from,to){directory(from);fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const source=path.join(from,entry.name),target=path.join(to,entry.name);if(entry.isSymbolicLink())throw Error('不打包符号链接：'+source);if(entry.isDirectory())copyTree(source,target);else if(entry.isFile())copyFile(source,target);else throw Error('源目录包含不支持的文件：'+source);}}
function main(){
 if(process.argv.length!==3||!destination||!path.isAbsolute(destination))throw Error('用法：node scripts/prepare-windows-demo-package.js <尚不存在的输出目录绝对路径>');
 const dest=path.resolve(destination);if(fs.existsSync(dest)||dest===assignment||dest.startsWith(assignment+path.sep)||assignment.startsWith(dest+path.sep))throw Error('输出须是作业目录之外尚不存在的新目录');directory(path.dirname(dest));
 const target=path.join(dest,'02-系统实现','app');fs.mkdirSync(target,{recursive:true});
 try{
  for(const dir of ['src','public'])copyTree(path.join(app,dir),path.join(target,dir));
  for(const name of ['start-chain-demo.js','serve-chain-persistent-demo.js','serve-chain-live-demo.js','seed-chain-cases.cjs','recover-chain-demo-lock.ps1','check-cloud-demo.js'])copyFile(path.join(app,'scripts',name),path.join(target,'scripts',name));
  copyFile(path.join(app,'config','reference-services.example.json'),path.join(target,'config','reference-services.example.json'));
  copyFile(path.join(assignment,'01-需求文档','数据层设计','SQLite-建表设计.sql'),path.join(dest,'01-需求文档','数据层设计','SQLite-建表设计.sql'));
  copyFile(path.join(assignment,'01-需求文档','数据层设计','SQLite-独立报价设计补充.sql'),path.join(dest,'01-需求文档','数据层设计','SQLite-独立报价设计补充.sql'));
  for(const name of ['连锁基础表候选结构.sql','连锁业务表归属候选映射.json'])copyFile(path.join(assignment,'01-需求文档','设计交付',name),path.join(dest,'01-需求文档','设计交付',name));
  copyFile(path.join(app,'package.json'),path.join(target,'package.json'));
  copyFile(path.join(app,'cloud','Caddyfile.example'),path.join(target,'cloud','Caddyfile.example'));
  copyFile(path.join(assignment,'07-启动连锁演示.cmd'),path.join(dest,'07-启动连锁演示.cmd'));
  copyFile(path.join(assignment,'08-启动实时日期演示.cmd'),path.join(dest,'08-启动实时日期演示.cmd'));
  const instructions='青禾牙科连锁演示（仅供虚构数据教学）\r\n\r\n安装 Node.js 24 或以上版本后，双击 07-启动连锁演示.cmd。\r\n初次启动将生成新的虚构数据；访问 http://127.0.0.1:3011/ 。\r\n08-启动实时日期演示.cmd 对应 http://127.0.0.1:3019/。\r\n演示账号为 frontdesk、dentist、cashier、assistant、manager，密码 Clinic123。\r\n本包不包含来源电脑的数据库和患者文书，不可用于真实诊疗。\r\n服务仅监听本机；仅可在配置 HTTPS 和访问密码后通过反向代理开放虚构演示。\r\n请勿直接开放 3011、3019 端口。参考 cloud/Caddyfile.example 和云服务器衔接说明。\r\n生成后的 data 目录保存演示数据，更新程序前请另行备份；不要把数据提交到 GitHub。\r\n';
  fs.writeFileSync(path.join(dest,'使用说明.txt'),instructions,{encoding:'utf8',flag:'wx'});
  const manifest={format:'windows-chain-demo-package-1',createdAt:new Date().toISOString(),packageId:crypto.randomUUID(),contents:'仅演示程序，无数据库、文书和运行环境',publicAccess:'需另行配置HTTPS反向代理和访问密码'};
  fs.writeFileSync(path.join(dest,'package-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(JSON.stringify({directory:dest,notice:'已生成不含数据的本机 Windows 演示包；需要 Node.js 24+，不能直接对公网开放'},null,2));
 }catch(error){throw Error(error.message+'；未完成的目录保留在 '+dest);}
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
