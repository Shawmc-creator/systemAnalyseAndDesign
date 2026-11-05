'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {verifyBundle}=require('./v2-backup');
const {verifySerialized}=require('./chain-trial-verification');
const {checkLegacyAssignments}=require('./chain-preflight');
const {checkRelationships}=require('./chain-relationship-preflight');
const {checkIdentity}=require('./chain-identity-preflight');
const {trialAssignment}=require('./chain-assignment-trial');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inspectBundle(directory,assignment){
 const verified=verifyBundle(directory),folder=verified.directory,manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
 const item=manifest.files.find(x=>x.path==='clinic-v2.db'),bytes=fs.readFileSync(path.join(folder,'clinic-v2.db'));
 if(!item||bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw new Error('备份数据库在核验期间变化，请重新核对');
 const schema=verifySerialized(bytes),candidate=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json'),'utf8'));
 const image=Buffer.from(bytes);if(image[18]===2&&image[19]===2){image[18]=1;image[19]=1;}
 const db=new DatabaseSync(':memory:');try{db.deserialize(image);db.exec('PRAGMA foreign_keys=ON; PRAGMA query_only=ON; BEGIN');
  const mapping=checkLegacyAssignments(db,candidate,assignment),relations=checkRelationships(db,assignment),identity=checkIdentity(db);db.exec('COMMIT');
  const mappingReady=mapping.assignmentComplete&&relations.consistent&&identity.consistent;let assignmentTrial=null;
  if(mappingReady){try{assignmentTrial={passed:true,...trialAssignment(bytes,candidate,assignment)};}catch(strictError){
   if(!/^门店赋值被现有数据库约束拒绝：/.test(strictError.message))throw strictError;
   try{assignmentTrial={passed:true,strictFailure:strictError.message,...trialAssignment(bytes,candidate,assignment,{allowListedImmutable:true})};}
   catch(retryError){if(!/^(门店赋值被现有数据库约束拒绝：|保护触发器与已核对基线不一致：)/.test(retryError.message))throw retryError;assignmentTrial={passed:false,strictFailure:strictError.message,reason:retryError.message};}
  }}const readyForReview=mappingReady&&assignmentTrial?.passed===true;
  return {backup:{schemaVersion:verified.schemaVersion,tables:verified.tables,files:verified.files,clinicalFiles:verified.clinicalFiles,databaseSha256:item.sha256},schema,mapping,relations,identity,assignmentTrial,readyForReview,notice:'仅供人工复核；未执行迁移，未证明门店归属真实，也未验证所有业务关联。'};
 }finally{db.close();}
}
module.exports={inspectBundle};
