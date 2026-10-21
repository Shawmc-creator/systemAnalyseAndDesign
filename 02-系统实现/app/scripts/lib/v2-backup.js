'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const {VERSION}=require('../../src/v2/database');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const allowed=name=>name==='clinic-v2.db'||/^(insurance|pharmacy)-config\.json$/.test(name)||/^clinical-files\/[a-f0-9-]{36}\.blob$/.test(name);
function localFile(folder,name){
 if(!allowed(name))throw new Error('备份文件索引无效：'+name);
 const base=path.resolve(folder),dest=path.resolve(base,...name.split('/'));
 if(!dest.startsWith(base+path.sep))throw new Error('备份路径超出目录');
 let p=base;for(const part of name.split('/')){p=path.join(p,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw new Error('备份文件不能使用符号链接');}return dest;
}
function inspect(db){
 if(db.prepare('PRAGMA application_id').get().application_id!==0x51484432||db.prepare('PRAGMA user_version').get().user_version!==VERSION)throw new Error('仅支持当前新版数据库；请先使用正常启动入口完成版本核对');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('备份数据库完整性检查未通过');
 return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT count(*) n FROM "'+name+'"').get().n]));
}
function verifyBundle(directory){
 const folder=path.resolve(directory);if(fs.lstatSync(folder).isSymbolicLink())throw new Error('备份目录不能使用符号链接');
 const manifestFile=path.join(folder,'manifest.json');if(fs.lstatSync(manifestFile).isSymbolicLink())throw new Error('备份清单不能使用符号链接');
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(manifest.format!=='qinghe-clinic-v2-bundle-1'||manifest.status!=='complete'||manifest.schemaVersion!==VERSION||!Array.isArray(manifest.files))throw new Error('此目录不是已完成的新版备份包');
 const files=new Map();for(const item of manifest.files){if(files.has(item.path))throw new Error('备份清单存在重复文件');const file=localFile(folder,item.path),bytes=fs.readFileSync(file);if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw new Error('备份文件摘要不匹配：'+item.path);files.set(item.path,item);}
 if(!files.has('clinic-v2.db'))throw new Error('备份缺少当前数据库');
 const db=new DatabaseSync(localFile(folder,'clinic-v2.db'),{readOnly:true});let counts;
 try{counts=inspect(db);if(JSON.stringify(counts)!==JSON.stringify(manifest.tableCounts))throw new Error('备份表行数与清单不一致');
  for(const v of db.prepare('SELECT storage_key,size_bytes,sha256 FROM document_version').all()){
   const item=files.get('clinical-files/'+v.storage_key);if(!item||item.bytes!==v.size_bytes||item.sha256!==v.sha256)throw new Error('备份缺少与数据库版本一致的影像文书原件');
  }
 }finally{db.close();}
 return {passed:true,directory:folder,schemaVersion:VERSION,tables:Object.keys(counts).length,files:files.size,clinicalFiles:[...files.keys()].filter(p=>p.startsWith('clinical-files/')).length};
}
async function createBundle({source,outputDir}={}){
 source=path.resolve(source);if(!fs.existsSync(source))throw new Error('当前数据库不存在：'+source);
 const name='clinic-v2-bundle-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID(),folder=path.join(path.resolve(outputDir),name);
 fs.mkdirSync(folder,{recursive:true});const manifest={format:'qinghe-clinic-v2-bundle-1',status:'incomplete',createdAt:new Date().toISOString(),schemaVersion:VERSION,files:[]};
 const writeManifest=()=>fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});writeManifest();
 function copy(bytes,rel,expected){if(expected&&(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256))throw new Error('源影像文书缺失、损坏或并发变化：'+rel);const dest=localFile(folder,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o600});manifest.files.push({path:rel,bytes:bytes.length,sha256:sha(bytes)});}
 try{
  const db=new DatabaseSync(source,{readOnly:true});try{inspect(db);await backup(db,path.join(folder,'clinic-v2.db'));}finally{db.close();}
  const saved=new DatabaseSync(path.join(folder,'clinic-v2.db'),{readOnly:true});let versions;
  try{manifest.tableCounts=inspect(saved);versions=saved.prepare('SELECT storage_key,size_bytes,sha256 FROM document_version ORDER BY id').all();}finally{saved.close();}
  const dbBytes=fs.readFileSync(path.join(folder,'clinic-v2.db'));manifest.files.push({path:'clinic-v2.db',bytes:dbBytes.length,sha256:sha(dbBytes)});
  const copied=new Set();for(const v of versions){const rel='clinical-files/'+v.storage_key;if(copied.has(rel))continue;const bytes=fs.readFileSync(localFile(path.dirname(source),rel));copy(bytes,rel,{bytes:v.size_bytes,sha256:v.sha256});copied.add(rel);}
  for(const config of ['insurance-config.json','pharmacy-config.json']){const file=path.join(path.dirname(source),config);if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink())throw new Error('机构配置不能为符号链接');const bytes=fs.readFileSync(file);JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));copy(bytes,config);}}
  manifest.status='complete';writeManifest();return verifyBundle(folder);
 }catch(error){manifest.status='failed';manifest.failure='备份未完成，不能用于恢复；请核实数据库和原件后重新备份';writeManifest();throw new Error(error.message+'\n未完成备份保留在：'+folder);}
}
module.exports={createBundle,verifyBundle};
