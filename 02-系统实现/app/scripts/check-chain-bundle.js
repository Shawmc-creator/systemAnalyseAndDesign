'use strict';
const fs=require('node:fs');const {inspectBundle}=require('./lib/chain-bundle-preflight');
const [bundle,assignment]=process.argv.slice(2);
if(!bundle||!assignment||process.argv.length!==4){console.error('用法：node scripts/check-chain-bundle.js <已验证备份包目录> <人工核实的门店映射.json>');process.exitCode=1;}
else try{const result=inspectBundle(bundle,JSON.parse(fs.readFileSync(assignment,'utf8').replace(/^\uFEFF/,'')));console.log(JSON.stringify(result,null,2));if(!result.readyForReview)process.exitCode=2;}catch(e){console.error(e.message);process.exitCode=1;}
