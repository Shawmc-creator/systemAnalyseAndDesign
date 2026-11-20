'use strict';
const fs=require('node:fs');const {buildCandidate}=require('./lib/chain-candidate-builder');
const [bundle,assignment,output]=process.argv.slice(2);
if(!bundle||!assignment||!output||process.argv.length!==5){console.error('用法：node scripts/prepare-chain-candidate.js <备份包目录> <门店映射.json> <候选数据库绝对路径>');process.exitCode=1;}
else try{const result=buildCandidate(bundle,JSON.parse(fs.readFileSync(assignment,'utf8').replace(/^\uFEFF/,'')),output);console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}
