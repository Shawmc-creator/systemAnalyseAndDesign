'use strict';
// Persistent development workspace for two scoped query services. This is not
// a production server and deliberately cannot open the migration candidate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {inspectCandidate}=require('../../scripts/lib/chain-candidate-readiness');
const {Auth}=require('./auth'),{UnitOfWork}=require('./unit-of-work'),{Billing}=require('./billing');
const {DocumentStore}=require('./document-store'),{ChainFinanceQuery}=require('./chain-finance-query'),{ChainClinicalQuery}=require('./chain-clinical-query');
const {ChainGrants}=require('./chain-grants-trial'),{ChainApproval}=require('./chain-approval-trial');
const {Reception}=require('./reception'),{ChainReception}=require('./chain-reception-trial'),{ChainFollowup}=require('./chain-followup-trial'),{ChainTransfer}=require('./chain-transfer-proposal');
const {ChainCash}=require('./chain-cash-trial'),{ChainTreatment}=require('./chain-treatment-trial'),{ChainRecord}=require('./chain-record-trial'),{ChainStartVisit}=require('./chain-start-visit-trial');
const {Clinical}=require('./clinical'),{Documents}=require('./documents'),{Prescriptions}=require('./prescriptions'),{Treatment}=require('./treatment'),{Quotes}=require('./quotes');
const {Inventory}=require('./inventory'),{Pharmacy}=require('./pharmacy');
const {Purchases}=require('./purchases'),{ChainInventory}=require('./chain-inventory-trial'),{ChainPurchase}=require('./chain-purchase-trial'),{ChainPrice}=require('./chain-price-trial'),{ChainPendingPrice}=require('./chain-pending-price-trial'),{ChainResources}=require('./chain-resources-trial');
const {ChainPrescription}=require('./chain-prescription-trial'),{ChainPlan}=require('./chain-plan-trial'),{ChainQuote}=require('./chain-quote-trial'),{ChainDocumentsTrial}=require('./chain-documents-trial'),{ChainHealthSign}=require('./chain-health-sign-trial'),{ChainAddendum}=require('./chain-addendum-trial');
const {ChainPrepay}=require('./chain-prepay-trial');
const {ChainDayClose,installDayCloseSchema}=require('./chain-day-close-trial');
const {ChainSetup}=require('./chain-setup-trial');
const {ChainCrossBranchOptionsCore}=require('./chain-cross-branch-options');
const dbName='chain-query-workspace.sqlite',filesName='clinical-files';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function createWorkspace(candidate,directory){
 if(!path.isAbsolute(directory))throw Error('工作副本目录须使用绝对路径');
 const source=path.resolve(candidate),dest=path.resolve(directory),sourceDir=path.dirname(source);
 if(dest===sourceDir||dest.startsWith(sourceDir+path.sep)||fs.existsSync(dest)||!fs.existsSync(path.dirname(dest))||fs.lstatSync(path.dirname(dest)).isSymbolicLink())throw Error('工作副本目录无效、位于候选目录内或已经存在');
 const review=inspectCandidate(source);if(review.missingTables.length||review.missingColumns.length||review.unassigned.length||review.missingTriggers.length||review.unavailableDocuments)throw Error('候选库结构、归属或原件未通过核对');
 const image=fs.readFileSync(source),sourceHash=digest(image),assetSource=path.join(sourceDir,'chain-migration-candidate.files');
 fs.mkdirSync(dest);fs.mkdirSync(path.join(dest,filesName));
 const target=path.join(dest,dbName);fs.writeFileSync(target,image,{flag:'wx',mode:0o600});
 const db=new DatabaseSync(target);try{
  if(db.prepare("SELECT value FROM chain_migration_candidate_meta WHERE name='status'").get()?.value!=='candidate-not-runtime')throw Error('候选标记不正确');
  for(const item of db.prepare('SELECT DISTINCT storage_key,size_bytes,sha256 FROM document_version').all()){
   if(!/^[a-f0-9-]{36}\.blob$/.test(item.storage_key))throw Error('原件索引无效');const file=path.join(assetSource,item.storage_key);
   if(fs.lstatSync(file).isSymbolicLink())throw Error('原件不能使用符号链接');const bytes=fs.readFileSync(file);if(bytes.length!==item.size_bytes||digest(bytes)!==item.sha256)throw Error('原件在复制期间发生变化');
   fs.writeFileSync(path.join(dest,filesName,item.storage_key),bytes,{flag:'wx',mode:0o600});
  }
  db.exec("CREATE TABLE chain_query_workspace_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT");
  const add=db.prepare('INSERT INTO chain_query_workspace_meta VALUES(?,?)');add.run('format','chain-query-workspace-1');add.run('source_sha256',sourceHash);
 }finally{db.close();}
 return {directory:dest,database:target,sourceSha256:sourceHash,notice:'仅供连锁查询接线开发，不是正式业务数据库。'};
}
function openWorkspace(directory,{clock}={}){
 if(!path.isAbsolute(directory))throw Error('工作副本目录须使用绝对路径');const folder=path.resolve(directory),file=path.join(folder,dbName),assets=path.join(folder,filesName);
 if(!fs.existsSync(folder)||fs.lstatSync(folder).isSymbolicLink()||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.existsSync(assets)||fs.lstatSync(assets).isSymbolicLink())throw Error('工作副本目录或文件无效');
 const db=new DatabaseSync(file);try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=3000');
  if(db.prepare("SELECT value FROM chain_query_workspace_meta WHERE name='format'").get()?.value!=='chain-query-workspace-1'||db.prepare("SELECT value FROM chain_migration_candidate_meta WHERE name='status'").get()?.value!=='candidate-not-runtime'||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('工作副本标记或完整性无效');
  db.exec('BEGIN IMMEDIATE');try{installDayCloseSchema(db);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  const auth=new Auth(db,clock),unit=new UnitOfWork(db,auth),billing=new Billing(db,unit),store=new DocumentStore(assets);
  const clinical=new Clinical(db,unit),documents=new Documents(db,unit,clinical,store),treatment=new Treatment(db,unit,clinical,billing,documents);
  const inventory=new Inventory(db,unit),prescriptions=new Prescriptions(db,unit,clinical);prescriptions.pharmacy=new Pharmacy(db,unit,prescriptions,inventory,billing,{enabled:false});
  const context={db,auth,unit,billing,inventory,purchases:new Purchases(db,unit,inventory),reception:new Reception(db,unit),documents,treatment,prescriptions,quotes:new Quotes(db,unit,clinical,billing)},record=new ChainRecord({db,auth,unit});
  return {db,auth,unit,setup:new ChainSetup(context),crossOptions:new ChainCrossBranchOptionsCore(context),finance:new ChainFinanceQuery(context),clinical:new ChainClinicalQuery(auth,store),grants:new ChainGrants(context),approval:new ChainApproval(context),reception:new ChainReception(context),followup:new ChainFollowup(context),transfer:new ChainTransfer(context),cash:new ChainCash(context),prepay:new ChainPrepay(context),dayClose:new ChainDayClose(context),treatment:new ChainTreatment(context),record,startVisit:new ChainStartVisit(context),prescription:new ChainPrescription(context),plan:new ChainPlan(context),quote:new ChainQuote(context),documents:new ChainDocumentsTrial(context),healthSign:new ChainHealthSign(context,record),addendum:new ChainAddendum(context,record),inventory:new ChainInventory(context),purchases:new ChainPurchase(context),prices:new ChainPrice(context),pendingPrices:new ChainPendingPrice(context),resources:new ChainResources(context),close:()=>db.close()};
 }catch(error){db.close();throw error;}
}
module.exports={createWorkspace,openWorkspace};
