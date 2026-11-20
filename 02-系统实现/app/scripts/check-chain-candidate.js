'use strict';
const {inspectCandidate}=require('./lib/chain-candidate-readiness');
if(process.argv.length!==3){console.error('用法：node scripts/check-chain-candidate.js <候选数据库绝对路径>');process.exitCode=1;}
else try{const result=inspectCandidate(process.argv[2]);console.log(JSON.stringify(result,null,2));if(!result.readyForRuntime)process.exitCode=2;}catch(error){console.error(error.message);process.exitCode=1;}
