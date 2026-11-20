'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {inspectBundle}=require('./chain-bundle-preflight');
const {verifyBundle}=require('./v2-backup');
const {trialAssignment}=require('./chain-assignment-trial');
const mappingPath=path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json');
function buildCandidate(bundle,assignment,output){
 if(!path.isAbsolute(output)||path.basename(output)!=='chain-migration-candidate.sqlite')throw Error('候选文件须使用绝对路径，文件名为 chain-migration-candidate.sqlite');
 const destination=path.resolve(output),parent=path.dirname(destination),backup=path.resolve(bundle),assets=path.join(parent,'chain-migration-candidate.files');
 if(destination.startsWith(backup+path.sep)||destination===backup||!fs.existsSync(parent)||fs.lstatSync(parent).isSymbolicLink()||fs.existsSync(destination)||fs.existsSync(assets))throw Error('候选文件目录无效、位于备份内或文件已存在');
 const preflight=inspectBundle(backup,assignment);if(!preflight.readyForReview)throw Error('备份、门店归属或关联核对未通过，拒绝生成候选数据库');
 verifyBundle(backup);const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8')),entry=manifest.files.find(x=>x.path==='clinic-v2.db'),bytes=fs.readFileSync(path.join(backup,'clinic-v2.db'));
 if(!entry||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('备份数据库在核对期间变化');
 const mapping=JSON.parse(fs.readFileSync(mappingPath,'utf8'));
 const result=trialAssignment(bytes,mapping,assignment,{allowListedImmutable:preflight.assignmentTrial.method==='受限触发器事务试验',materialize:{chainName:assignment.chainName,branches:assignment.branches,staffRoles:assignment.staffRoles}});
 const image=result.image;delete result.image;let wrote=false,assetsCreated=false;const copied=[];
 try{fs.mkdirSync(assets);assetsCreated=true;for(const item of manifest.files.filter(x=>x.path.startsWith('clinical-files/'))){
   if(!/^clinical-files\/[a-f0-9-]{36}\.blob$/.test(item.path))throw Error('文书原件索引无效');const name=item.path.slice('clinical-files/'.length),source=path.join(backup,'clinical-files',name),target=path.join(assets,name);
   if(fs.lstatSync(source).isSymbolicLink())throw Error('文书原件不能使用符号链接');const data=fs.readFileSync(source);if(data.length!==item.bytes||crypto.createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('备份文书原件在核对期间变化');
   const fd=fs.openSync(target,'wx',0o600);copied.push(target);try{fs.writeFileSync(fd,data);}finally{fs.closeSync(fd);}
  }
  const fd=fs.openSync(destination,'wx',0o600);wrote=true;try{fs.writeFileSync(fd,image);}finally{fs.closeSync(fd);}const check=new DatabaseSync(destination,{readOnly:true});try{
  if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length||check.prepare("SELECT value FROM chain_migration_candidate_meta WHERE name='status'").get()?.value!=='candidate-not-runtime')throw Error('候选文件完整性核验失败');
  for(const v of check.prepare('SELECT storage_key,size_bytes,sha256 FROM document_version').all()){if(!/^[a-f0-9-]{36}\.blob$/.test(v.storage_key))throw Error('候选文书原件索引无效');const data=fs.readFileSync(path.join(assets,v.storage_key));if(data.length!==v.size_bytes||crypto.createHash('sha256').update(data).digest('hex')!==v.sha256)throw Error('候选文书原件不匹配');}
 }finally{check.close();}return {...result,path:destination,assetDirectory:assets,clinicalFiles:copied.length,sourceSha256:entry.sha256,notice:'候选数据库仅供复核，当前应用尚不能直接使用；不验证门店归属真实性。'};
 }catch(error){if(wrote&&fs.existsSync(destination))fs.unlinkSync(destination);for(const file of copied)if(fs.existsSync(file))fs.unlinkSync(file);if(assetsCreated)fs.rmdirSync(assets);throw error;}
}
module.exports={buildCandidate};
