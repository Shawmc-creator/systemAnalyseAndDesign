'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verifyBundle}=require('./lib/v2-backup');
try{
 const base=path.resolve(__dirname,'../data/backups');let folder=process.argv[2];
 if(!folder){const names=fs.existsSync(base)?fs.readdirSync(base).filter(n=>n.startsWith('clinic-v2-bundle-')).sort().reverse():[];folder=names.map(n=>path.join(base,n)).find(p=>{try{return JSON.parse(fs.readFileSync(path.join(p,'manifest.json'),'utf8')).status==='complete';}catch{return false;}});}
 if(!folder)throw new Error('没有已完成的新版备份包，请先执行 npm run backup');
 console.log(JSON.stringify(verifyBundle(folder),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
