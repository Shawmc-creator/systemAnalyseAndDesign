'use strict';
const { DatabaseSync }=require('node:sqlite');
const { verifySerialized }=require('./lib/chain-trial-verification');
if(process.argv.length!==3){console.error('用法：node scripts/check-chain-snapshot-trial.js <已备份的隔离数据库快照>');process.exitCode=1;}
else {
 try {
  const source=new DatabaseSync(process.argv[2],{readOnly:true}); let bytes;
  try { source.exec('PRAGMA query_only=ON'); bytes=source.serialize(); } finally { source.close(); }
  const result=verifySerialized(bytes);
  console.log(JSON.stringify({...result,notice:'仅验证内存候选基础结构；未迁移门店归属、业务约束或运行数据库。'},null,2));
 } catch(error) { console.error(error.message); process.exitCode=1; }
}
