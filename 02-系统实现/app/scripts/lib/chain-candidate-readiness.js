'use strict';
// Read-only review of a migration candidate. A passing structure check is not
// authority to switch the application to this database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {Auth}=require('../../src/v2/auth');
const {hasBranchRole}=require('../../src/v2/chain-access');
const {instant}=require('../../src/v2/common');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const mapping=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json'),'utf8'));
function inspectCandidate(filename,{at=new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}={}){
 const now=instant(at,'核对时间'),file=path.resolve(filename),assets=path.join(path.dirname(file),'chain-migration-candidate.files');
 if(path.basename(file)!=='chain-migration-candidate.sqlite'||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.existsSync(assets)||fs.lstatSync(assets).isSymbolicLink())throw Error('候选数据库或原件目录不存在或不合法');
 const db=new DatabaseSync(file,{readOnly:true});try{
  db.exec('PRAGMA query_only=ON; PRAGMA foreign_keys=ON; BEGIN');
  if(db.prepare("SELECT value FROM chain_migration_candidate_meta WHERE name='status'").get()?.value!=='candidate-not-runtime')throw Error('不是已识别的迁移候选数据库');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('候选数据库完整性检查失败');
  const missingColumns=[],unassigned=[];
  for(const row of mapping.rows){if(!['新增门店外键','来源与负责门店'].includes(row.mode))continue;const fields=row.mode==='新增门店外键'?[row.field]:row.fields;
   if(!/^\w+$/.test(row.table)||fields.some(x=>!/^\w+$/.test(x)))throw Error('候选映射字段无效');const cols=new Set(db.prepare(`PRAGMA table_info(${quote(row.table)})`).all().map(x=>x.name));
   for(const field of fields){if(!cols.has(field)){missingColumns.push(row.table+'.'+field);continue;}const count=db.prepare(`SELECT count(*) n FROM ${quote(row.table)} WHERE ${quote(field)} IS NULL`).get().n;if(count)unassigned.push({table:row.table,field,count});}
  }
  const required=['clinic_chain','clinic_branch','branch_staff_role','cross_branch_record_access','patient_verified_identity'],missingTables=required.filter(name=>!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const triggers=['patient_identity_immutable','patient_identity_no_delete','chain_price_branch_insert','chain_price_branch_confirm','chain_price_branch_frozen','chain_bill_item_price_branch_insert','chain_bill_item_price_branch_update'];
  const missingTriggers=triggers.filter(name=>!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name));
  const documents=db.prepare('SELECT storage_key,size_bytes,sha256 FROM document_version').all();let unavailableDocuments=0;
  for(const d of documents){if(!/^[a-f0-9-]{36}\.blob$/.test(d.storage_key)){unavailableDocuments++;continue;}const f=path.join(assets,d.storage_key);try{if(fs.lstatSync(f).isSymbolicLink())throw Error();const bytes=fs.readFileSync(f);if(bytes.length!==d.size_bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==d.sha256)unavailableDocuments++;}catch{unavailableDocuments++;}}
  const auth=new Auth(db),roles={branch_manager:'manager',frontdesk:'frontdesk',dentist:'dentist',cashier:'cashier'};
  const branches=db.prepare("SELECT id,name FROM clinic_branch WHERE status='active' ORDER BY id").all().map(branch=>{const staff=db.prepare("SELECT DISTINCT s.id,a.id account_id FROM staff s JOIN user_account a ON a.staff_id=s.id AND a.status='启用' JOIN branch_staff_role r ON r.staff_id=s.id AND r.branch_id=?").all(branch.id);
   const missingRoles=Object.entries(roles).filter(([branchRole,accountRole])=>!staff.some(s=>hasBranchRole(db,{staffId:s.id,branchId:branch.id,role:branchRole,at:now})&&auth.roles(s.account_id,now).some(r=>r.code===accountRole))).map(([role])=>role);return {...branch,missingRoles};});
  const blockers=[];if(missingTables.length)blockers.push('缺少连锁业务表');if(missingColumns.length)blockers.push('缺少门店归属字段');if(unassigned.length)blockers.push('存在未核对的历史门店归属');if(missingTriggers.length)blockers.push('缺少身份或门店价目保护');if(unavailableDocuments)blockers.push('存在缺失或不匹配的文书原件');if(!branches.length||branches.some(b=>b.missingRoles.length))blockers.push('存在尚未安排必要岗位的门店');
  blockers.push('正式连锁持久化运行入口尚未接入');db.exec('COMMIT');return {checkedAt:now,branches,missingTables,missingColumns,unassigned,missingTriggers,documents:documents.length,unavailableDocuments,blockers,readyForRuntime:false,notice:'结构核对不证明历史归属真实，不会启用或修改候选数据库。'};
 }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
}
module.exports={inspectCandidate};
