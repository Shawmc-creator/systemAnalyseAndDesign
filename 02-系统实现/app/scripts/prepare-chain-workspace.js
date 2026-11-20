'use strict';
const {createWorkspace}=require('../src/v2/chain-query-workspace');
if(process.argv.length!==4){console.error('用法：node scripts/prepare-chain-workspace.js <候选数据库绝对路径> <新工作副本绝对目录>');process.exitCode=1;}
else try{console.log(JSON.stringify(createWorkspace(process.argv[2],process.argv[3]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
