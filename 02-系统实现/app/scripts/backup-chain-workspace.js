'use strict';
const path=require('node:path'),{backupWorkspace,verifyWorkspaceBackup,restoreWorkspaceBackup}=require('./lib/chain-workspace-backup');
async function main(){
 const args=process.argv.slice(2);if(args[0]==='--verify'&&args.length===2&&path.isAbsolute(args[1]))return verifyWorkspaceBackup(args[1]);
 if(args[0]==='--restore'&&args.length===3&&args.slice(1).every(path.isAbsolute))return restoreWorkspaceBackup(args[1],args[2]);
 if(args.length!==2||args.some(x=>!path.isAbsolute(x)))throw Error('用法：node scripts/backup-chain-workspace.js <工作副本绝对目录> <已有备份目录>；核验：--verify <备份包绝对目录>；恢复：--restore <备份包绝对目录> <不存在的新目录>');
 return backupWorkspace(args[0],args[1]);
}
main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
