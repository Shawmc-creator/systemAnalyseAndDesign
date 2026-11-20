'use strict';
const {cloneInMemory,snapshot,compareOriginal}=require('./chain-trial-verification');
const {checkLegacyAssignments}=require('./chain-preflight');
const {checkRelationships}=require('./chain-relationship-preflight');
const {checkIdentity}=require('./chain-identity-preflight');
const {installTrialSchema}=require('../../src/v2/chain-schema-trial');
const {rebuildTrialUniqueConstraints}=require('../../src/v2/chain-unique-trial');
const {installTrialPriceConstraints}=require('../../src/v2/chain-price-constraints-trial');
const {ensurePatientIdentityTrial}=require('../../src/v2/patient-identity-schema-trial');
const {Auth}=require('../../src/v2/auth');
const {instant}=require('../../src/v2/common');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function trialAssignment(bytes,candidate,assignment,{allowListedImmutable=false,materialize=null}={}){
 const db=cloneInMemory(bytes);try{
  const map=checkLegacyAssignments(db,candidate,assignment),relations=checkRelationships(db,assignment);
  if(!map.assignmentComplete||!relations.consistent||!checkIdentity(db).consistent)throw new Error('门店映射不完整或核心关联存在冲突，拒绝赋值试验');
  if(materialize){if(typeof materialize.chainName!=='string'||!materialize.chainName.trim()||materialize.chainName.length>200||!Array.isArray(materialize.branches)||materialize.branches.length!==assignment.branchIds.length||!Array.isArray(materialize.staffRoles))throw new Error('候选数据库需要完整的连锁、门店及岗位资料');
   const ids=new Set(),codes=new Set();for(const b of materialize.branches){if(!b||!assignment.branchIds.includes(b.id)||ids.has(b.id)||typeof b.code!=='string'||!b.code.trim()||b.code.length>100||codes.has(b.code.trim())||typeof b.name!=='string'||!b.name.trim()||b.name.length>200)throw new Error('门店资料不完整或重复');ids.add(b.id);codes.add(b.code.trim());}}
  const before=snapshot(db);installTrialSchema(db,{includeBusinessFields:true});rebuildTrialUniqueConstraints(db);compareOriginal(db,before);
  const entries=[];for(const row of candidate.rows){if(!['新增门店外键','来源与负责门店'].includes(row.mode))continue;
   const cols=row.mode==='新增门店外键'?[row.field]:row.fields;if(!/^\w+$/.test(row.table)||cols.some(c=>!/^\w+$/.test(c)))throw new Error('候选字段无效');
   for(const [id,values] of Object.entries(assignment.tables[row.table]||{}))entries.push({table:row.table,cols,id:Number(id),values});
  }
  // Only these exact baseline guards are eligible for the isolated transaction.
  // Other triggers remain enabled; unexpected SQL or tables fail closed.
  const policies=[
   {table:'patient_change',suffix:'immutable_fact',when:'((1) AND 1)',code:'immutable_fact'},
   {table:'treatment_execution',suffix:'immutable_fact',when:'((1) AND 1)',code:'immutable_fact'},
   {table:'patient_payment',suffix:'terminal_frozen',when:"((OLD.status IN ('到账已确认','未到账已核实')) AND 1)",code:'terminal_frozen',terminal:true}
  ];
  const guarded=[];if(allowListedImmutable)for(const policy of policies){
   const table=policy.table;if(!entries.some(e=>e.table===table))continue;const name='tr_'+table+'_'+policy.suffix+'_update';
   const expected=`CREATE TRIGGER "${name}" BEFORE UPDATE ON "${table}" WHEN ${policy.when} BEGIN SELECT RAISE(ABORT,'${policy.code}'); END`;
   const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?").get(name,table);
   if(!trigger||trigger.sql!==expected)throw new Error('保护触发器与已核对基线不一致：'+name);
   guarded.push({...policy,name,sql:trigger.sql});
  }
  const apply=(failAfter)=>{db.exec('BEGIN IMMEDIATE');try{
   for(const trigger of guarded)db.exec('DROP TRIGGER '+quote(trigger.name));
   db.prepare('INSERT INTO clinic_chain(id,name) VALUES(1,?)').run(materialize?materialize.chainName.trim():'仅供迁移试验的连锁');
   for(const branch of assignment.branchIds){const b=materialize?.branches.find(x=>x.id===branch);db.prepare('INSERT INTO clinic_branch(id,chain_id,branch_code,name) VALUES(?,1,?,?)').run(branch,b?b.code.trim():'TRIAL-'+branch,b?b.name.trim():'试验门店 '+branch);}
   for(let i=0;i<entries.length;i++){const e=entries[i];let result;try{result=db.prepare(`UPDATE ${quote(e.table)} SET ${e.cols.map(c=>quote(c)+'=?').join(',')} WHERE id=?`).run(...e.cols.map(c=>e.values[c]),e.id);}catch(error){throw new Error('门店赋值被现有数据库约束拒绝：'+e.table+'（'+error.message+'）');}if(result.changes!==1)throw new Error('门店赋值未找到唯一记录：'+e.table);
    if(failAfter===i+1)throw new Error('模拟赋值失败');}
   if(failAfter===0)throw new Error('模拟赋值失败');
   for(const trigger of guarded)db.exec(trigger.sql);
   if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('赋值后外键或完整性检查失败');
   compareOriginal(db,before);db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}};
  try{apply(entries.length?1:0);throw new Error('模拟失败未发生');}catch(e){if(e.message!=='模拟赋值失败')throw e;}
  compareOriginal(db,before);if(db.prepare('SELECT COUNT(*) n FROM clinic_branch').get().n!==0)throw new Error('模拟失败后的门店未回滚');
  for(const e of entries){const v=db.prepare(`SELECT ${e.cols.map(quote).join(',')} FROM ${quote(e.table)} WHERE id=?`).get(e.id);if(e.cols.some(c=>v[c]!==null))throw new Error('模拟失败后的门店归属未回滚');}
  apply(null);
  let verifiedGuards=0;for(const trigger of guarded){const eligible=trigger.terminal?db.prepare(`SELECT id FROM ${quote(trigger.table)} WHERE status IN ('到账已确认','未到账已核实') LIMIT 1`).get():entries.find(x=>x.table===trigger.table);if(!eligible)continue;db.exec('SAVEPOINT verify_immutable');let blocked=false;try{db.prepare(`UPDATE ${quote(trigger.table)} SET id=id WHERE id=?`).run(eligible.id);}catch(error){if(error.message!==trigger.code)throw error;blocked=true;}finally{db.exec('ROLLBACK TO verify_immutable; RELEASE verify_immutable');}if(!blocked)throw new Error('历史保护未恢复：'+trigger.table);verifiedGuards++;}
  for(const e of entries){const v=db.prepare(`SELECT ${e.cols.map(quote).join(',')} FROM ${quote(e.table)} WHERE id=?`).get(e.id);if(e.cols.some(c=>v[c]!==e.values[c]))throw new Error('门店赋值结果核对失败');}
  const result={assignedRecords:entries.length,assignedTables:new Set(entries.map(e=>e.table)).size,trialBranches:assignment.branchIds.length,rollbackVerified:true,originalFieldsPreserved:true,foreignKeysVerified:true,guardedTriggerRestoreVerified:verifiedGuards,guardedTriggerCount:guarded.length,method:allowListedImmutable?'受限触发器事务试验':'保留触发器直接赋值',notice:materialize?'候选数据库仅供审核，不验证映射真实性或系统运行隔离。':'仅在内存使用虚拟门店验证赋值；未产生迁移数据库，不验证映射真实性或系统运行隔离。'};
  if(materialize){installTrialPriceConstraints(db);ensurePatientIdentityTrial(db);
   const auth=new Auth(db),seen=new Set(),roles={frontdesk:'frontdesk',dentist:'dentist',assistant:'assistant',cashier:'cashier',branch_manager:'manager',pharmacist:'pharmacist'};
   db.exec('BEGIN IMMEDIATE');try{for(const r of materialize.staffRoles){if(!r||!assignment.branchIds.includes(r.branchId)||!Number.isSafeInteger(r.staffId)||r.staffId<1||!Number.isSafeInteger(r.grantedBy)||r.grantedBy<1||!Object.hasOwn(roles,r.role)||typeof r.evidence!=='string'||!r.evidence.trim()||r.evidence.length>2000)throw Error('门店岗位记录无效');
    const from=instant(r.validFrom,'岗位生效时间'),at=instant(r.grantedAt,'岗位授权时间'),until=r.validUntil==null?null:instant(r.validUntil,'岗位截止时间'),key=[r.branchId,r.staffId,r.role].join(':');
    if(at>from||(until&&until<=from)||seen.has(key))throw Error('门店岗位时间或重复记录无效');seen.add(key);
    const staff=db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(r.staffId),grantor=db.prepare("SELECT id FROM user_account WHERE staff_id=? AND status='启用'").get(r.grantedBy);
    const grantorAtBranch=materialize.staffRoles.some(x=>x&&x.branchId===r.branchId&&x.staffId===r.grantedBy&&x.role==='branch_manager'&&instant(x.validFrom,'授权人岗位生效时间')<=at&&(x.validUntil==null||instant(x.validUntil,'授权人岗位截止时间')>at));
    if(!staff||!auth.roles(staff.id,from).some(x=>x.code===roles[r.role])||!grantor||!auth.roles(grantor.id,at).some(x=>x.code==='manager')||!grantorAtBranch)throw Error('门店岗位人员或授权人的账号资格未核实');
    db.prepare('INSERT INTO branch_staff_role(branch_id,staff_id,role_code,valid_from,valid_until,granted_by,granted_at,evidence) VALUES(?,?,?,?,?,?,?,?)').run(r.branchId,r.staffId,r.role,from,until,r.grantedBy,at,r.evidence.trim());
   }db.exec('COMMIT');}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
   if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('候选价目或身份结构完整性检查失败');db.exec("CREATE TABLE chain_migration_candidate_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; INSERT INTO chain_migration_candidate_meta VALUES('status','candidate-not-runtime')");result.priceBranchConstraints=true;result.patientIdentitySchema=true;result.branchRoles=materialize.staffRoles.length;result.image=db.serialize();}
  return result;
 }finally{db.close();}
}
module.exports={trialAssignment};
