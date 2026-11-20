'use strict';
// Backup a marked development workspace. This does not promote it to production.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function regular(file){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())throw Error('备份文件无效或是符号链接');}
function folder(dir){const st=fs.lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory())throw Error('目录无效或是符号链接');}
function inspect(db){
 if(db.prepare("SELECT value FROM chain_query_workspace_meta WHERE name='format'").get()?.value!=='chain-query-workspace-1'||db.prepare("SELECT value FROM chain_migration_candidate_meta WHERE name='status'").get()?.value!=='candidate-not-runtime')throw Error('仅支持已标记的连锁开发工作副本');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('数据库完整性检查未通过');
 return db.prepare('SELECT DISTINCT storage_key,size_bytes,sha256 FROM document_version ORDER BY storage_key').all();
}
function verifyWorkspaceBackup(directory){
 const dir=path.resolve(directory);folder(dir);const manifestFile=path.join(dir,'manifest.json');regular(manifestFile);const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(m.format!=='chain-workspace-backup-1'||m.status!=='complete'||!Array.isArray(m.files))throw Error('不是完整的连锁工作副本备份');
 const items=new Map();for(const item of m.files){if(!item||typeof item.path!=='string'||!(item.path==='chain-query-workspace.sqlite'||/^clinical-files\/[a-f0-9-]{36}\.blob$/.test(item.path))||items.has(item.path))throw Error('备份文件索引无效');const file=path.join(dir,...item.path.split('/'));if(item.path.startsWith('clinical-files/'))folder(path.join(dir,'clinical-files'));regular(file);const data=fs.readFileSync(file);if(data.length!==item.bytes||sha(data)!==item.sha256)throw Error('备份文件摘要不匹配：'+item.path);items.set(item.path,item);}
 if(!items.has('chain-query-workspace.sqlite'))throw Error('备份缺少数据库');const db=new DatabaseSync(path.join(dir,'chain-query-workspace.sqlite'),{readOnly:true});let docs;try{docs=inspect(db);}finally{db.close();}
 for(const d of docs){const file=items.get('clinical-files/'+d.storage_key);if(!file||file.bytes!==d.size_bytes||file.sha256!==d.sha256)throw Error('备份缺少与数据库一致的文书原件');}
 return {directory:dir,files:items.size,clinicalFiles:docs.length,notice:'开发工作副本备份，不可作为正式业务数据库直接使用'};
}
async function backupWorkspace(source,outputRoot){
 if(!path.isAbsolute(source)||!path.isAbsolute(outputRoot))throw Error('工作副本和备份目录须使用绝对路径');
 const src=path.resolve(source),out=path.resolve(outputRoot);folder(src);folder(out);
 if(out===src||out.startsWith(src+path.sep)||src.startsWith(out+path.sep))throw Error('备份目录须与工作副本目录分离');
 const original=path.join(src,'chain-query-workspace.sqlite'),assets=path.join(src,'clinical-files');regular(original);folder(assets);
 const dir=path.join(out,'chain-workspace-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID());fs.mkdirSync(dir,{mode:0o700});
 const m={format:'chain-workspace-backup-1',status:'incomplete',createdAt:new Date().toISOString(),files:[]};const write=()=>fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(m,null,2),{mode:0o600});write();
 try{
  const db=new DatabaseSync(original,{readOnly:true});try{inspect(db);await backup(db,path.join(dir,'chain-query-workspace.sqlite'));}finally{db.close();}
  const copy=new DatabaseSync(path.join(dir,'chain-query-workspace.sqlite'),{readOnly:true});let docs;try{docs=inspect(copy);}finally{copy.close();}
  const dbBytes=fs.readFileSync(path.join(dir,'chain-query-workspace.sqlite'));m.files.push({path:'chain-query-workspace.sqlite',bytes:dbBytes.length,sha256:sha(dbBytes)});
  fs.mkdirSync(path.join(dir,'clinical-files'),{mode:0o700});const copied=new Set();for(const d of docs){if(!/^[a-f0-9-]{36}\.blob$/.test(d.storage_key))throw Error('文书原件索引无效');if(copied.has(d.storage_key))continue;const sourceFile=path.join(assets,d.storage_key);regular(sourceFile);const bytes=fs.readFileSync(sourceFile);if(bytes.length!==d.size_bytes||sha(bytes)!==d.sha256)throw Error('影像文书原件缺失、损坏或已变化');fs.writeFileSync(path.join(dir,'clinical-files',d.storage_key),bytes,{flag:'wx',mode:0o600});m.files.push({path:'clinical-files/'+d.storage_key,bytes:bytes.length,sha256:sha(bytes)});copied.add(d.storage_key);}
  m.status='complete';write();return verifyWorkspaceBackup(dir);
 }catch(error){m.status='failed';write();throw Error(error.message+'；未完成的备份保留在 '+dir);}
}
function restoreWorkspaceBackup(source,destination){
 if(!path.isAbsolute(source)||!path.isAbsolute(destination))throw Error('备份包和恢复目录须使用绝对路径');
 const src=path.resolve(source),dest=path.resolve(destination);verifyWorkspaceBackup(src);
 if(dest===src||dest.startsWith(src+path.sep)||src.startsWith(dest+path.sep)||fs.existsSync(dest))throw Error('恢复目录须是备份包外尚不存在的新目录');
 folder(path.dirname(dest));const manifest=JSON.parse(fs.readFileSync(path.join(src,'manifest.json'),'utf8'));fs.mkdirSync(dest,{mode:0o700});fs.mkdirSync(path.join(dest,'clinical-files'),{mode:0o700});
 try{
  for(const item of manifest.files){const from=path.join(src,...item.path.split('/')),to=path.join(dest,...item.path.split('/'));regular(from);const bytes=fs.readFileSync(from);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('备份文件在恢复期间发生变化');fs.writeFileSync(to,bytes,{flag:'wx',mode:0o600});}
  fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});verifyWorkspaceBackup(dest);
  return {directory:dest,notice:'已恢复到独立开发工作副本；不适用于正式诊疗'};
 }catch(error){throw Error(error.message+'；未完成恢复保留在 '+dest);}
}
module.exports={backupWorkspace,verifyWorkspaceBackup,restoreWorkspaceBackup};
