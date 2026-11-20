'use strict';
const {createAssignmentTemplate}=require('./lib/chain-assignment-template');
if(process.argv.length!==4){console.error('用法：node scripts/prepare-chain-assignment.js <已验证备份包目录> <映射模板 JSON 绝对路径>');process.exitCode=1;}
else try{console.log(JSON.stringify(createAssignmentTemplate(process.argv[2],process.argv[3]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
