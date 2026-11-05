'use strict';
const {fail,text,dateOnly,instant,day,row,revision,insert,fact,recordNo}=require('./common');
const {encodePassword}=require('./auth');
const references=require('../../config/reference-services.example.json');
class Clinic{
 constructor(db,unit){this.db=db;this.unit=unit;}
 account(staffId){return this.db.prepare('SELECT * FROM user_account WHERE staff_id=?').get(staffId);}
 futureSchedule(staffId,chairId,now){return this.db.prepare("SELECT id FROM dated_schedule WHERE status='已确认' AND ends_at>? AND (dentist_id=? OR dental_chair_id=?) LIMIT 1").get(now,staffId||-1,chairId||-1);}
 actualUse(staffId,chairId){return this.db.prepare('SELECT o.id FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id WHERE o.released_at IS NULL AND (s.dentist_id=? OR s.dental_chair_id=?) LIMIT 1').get(staffId||-1,chairId||-1);}
 touch(person,now){this.db.prepare('UPDATE staff SET updated_at=?,revision=revision+1 WHERE id=?').run(now,person.id);return {kind:'staff',key:person.id,beforeRevision:person.revision,revision:person.revision+1};}
 effectiveManagers(now){return this.db.prepare("SELECT DISTINCT a.id FROM user_account a JOIN account_role g ON g.account_id=a.id JOIN access_role r ON r.id=g.role_id JOIN staff_role_qualification q ON q.id=g.qualification_id JOIN staff s ON s.id=a.staff_id WHERE r.code='manager' AND a.status='启用' AND s.employed_from<=? AND (s.employed_until IS NULL OR s.employed_until>=?) AND g.granted_at<=? AND (g.valid_until IS NULL OR g.valid_until>?) AND (g.revoked_at IS NULL OR g.revoked_at>?) AND q.valid_from<=? AND (q.valid_until IS NULL OR q.valid_until>?) AND (q.revoked_at IS NULL OR q.revoked_at>?)").all(day(now),day(now),now,now,now,now,now,now);}
 protectAccount(a,ctx,now){if(a.id===ctx.session.account_id)fail(409,'SELF_LOCKOUT','不能停用当前本人账号；由另一负责人核实办理');if(this.effectiveManagers(now).some(m=>m.id===a.id)&&this.effectiveManagers(now).length<=1)fail(409,'LAST_MANAGER','须先建立另一名有效负责人，不能移除最后的管理入口');}
 grant(person,a,input,ctx,now){
  const role=this.db.prepare('SELECT * FROM access_role WHERE code=?').get(input.role||'');if(!role||role.code==='pharmacist')fail(422,'CLINIC_ROLE','请选择既有日常岗位；药学资格仍在院内药学页面按条件办理');
  const basis=text(input.basis,'岗位任职及授权核实依据',2000),end=input.validUntil?instant(input.validUntil,'任职授权截止'):null;if(end&&end<=now)fail(422,'CLINIC_VALIDITY','授权截止须晚于当前时间');
  if(person.employed_from>day(now)||(person.employed_until&&person.employed_until<day(now)))fail(409,'STAFF_UNAVAILABLE','仅当前在岗职员可授予当前任职权限');
  if(this.db.prepare('SELECT id FROM account_role WHERE account_id=? AND role_id=? AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>?)').get(a.id,role.id,now))fail(409,'CLINIC_ROLE_EXISTS','该账号已有尚未结束的同岗位授权');
  const q=insert(this.db,'staff_role_qualification',{staff_id:person.id,role_id:role.id,valid_from:now,valid_until:end,verified_by:ctx.session.staff_id,verification_basis:basis,revoked_at:null,revoked_by:null,revocation_reason:null,created_at:now});
  const key=insert(this.db,'account_role',{account_id:a.id,role_id:role.id,qualification_id:q,granted_by:ctx.session.account_id,granted_at:now,valid_until:end,grant_reason:basis,revoked_by:null,revoked_at:null,revocation_reason:null});ctx.authority.newGrant={grantId:key,qualificationId:q,role:role.code};
 }
 staff(credentials,input,{scopeGuard=null,afterCreate=null}={}){return this.unit.command(credentials,'clinic.manage',input,(ctx,now)=>{
  const reason=text(input.reason,'基础资料变更依据',2000);
  if(input.action==='create'){
   const from=dateOnly(input.employedFrom||day(now));if(from>day(now))fail(422,'STAFF_START','当前建档入职日期不能在未来');
   const login=text(input.username,'个人账号登录名',64).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login))fail(422,'CLINIC_LOGIN','登录名为3至64位字母、数字、点、下划线或连字符');
   if(typeof input.password!=='string'||input.password.length<10||input.password.length>128)fail(422,'CLINIC_PASSWORD','初始口令须为10至128字符，不能共用演示口令');
   if(input.password==='Clinic123!')fail(422,'CLINIC_PASSWORD','新个人账号请设置独立口令，不沿用公开演示口令');
   const id=insert(this.db,'staff',fact(now,{name:text(input.name,'职员姓名',80),employed_from:from,employed_until:null,created_by:ctx.session.staff_id,record_no:recordNo('STAFF')}));
   const a=insert(this.db,'user_account',{staff_id:id,login_name:login,password_hash:encodePassword(input.password),status:'启用',auth_version:1,password_changed_at:now,created_at:now,updated_at:now,disabled_at:null,disabled_reason:null,revision:1});
   this.grant(row(this.db,'staff',id),row(this.db,'user_account',a),input,ctx,now);if(afterCreate)afterCreate(ctx,now,id);return {kind:'staff',key:id,revision:1,reason};
  }
  const person=row(this.db,'staff',input.staffId);revision(person,input.expectedRevision);const a=this.account(person.id);if(!a)fail(409,'CLINIC_ACCOUNT','此人员缺少个人账号，先由维护人员核对历史数据');
  if(input.action==='grant')this.grant(person,a,input,ctx,now);
  else if(input.action==='revoke'){
   const g=row(this.db,'account_role',input.grantId),role=row(this.db,'access_role',g.role_id);if(g.account_id!==a.id||g.revoked_at)fail(409,'CLINIC_GRANT','请核对该人员未撤销的原授权');
   if(role.code==='pharmacist')fail(409,'CLINIC_ROLE','药学资格仍从院内药学页面核实撤销');
   if(role.code==='manager')this.protectAccount(a,ctx,now);
   if(role.code==='dentist'&&(this.futureSchedule(person.id,null,now)||this.actualUse(person.id,null)))fail(409,'CLINIC_ACTIVE_SCHEDULE','先协调该牙医的有效排班、预约及在诊占用，再撤销牙医岗位');
   this.db.prepare('UPDATE account_role SET revoked_at=?,revoked_by=?,revocation_reason=? WHERE id=?').run(now,ctx.session.account_id,reason,g.id);
   this.db.prepare('UPDATE staff_role_qualification SET revoked_at=?,revoked_by=?,revocation_reason=? WHERE id=?').run(now,ctx.session.staff_id,reason,g.qualification_id);
  }else if(input.action==='disable'){
   this.protectAccount(a,ctx,now);if(a.status!=='启用')fail(409,'CLINIC_ACCOUNT_STATE','账号已停用');
   if(this.futureSchedule(person.id,null,now)||this.actualUse(person.id,null))fail(409,'CLINIC_ACTIVE_SCHEDULE','先协调该人员的有效排班和在诊占用，再停用账号');
   this.db.prepare("UPDATE user_account SET status='停用',disabled_at=?,disabled_reason=?,auth_version=auth_version+1,updated_at=?,revision=revision+1 WHERE id=?").run(now,reason,now,a.id);
   this.db.prepare("UPDATE login_session SET revoked_at=?,revocation_reason='负责人停用账号' WHERE account_id=? AND revoked_at IS NULL").run(now,a.id);
  }else if(input.action==='enable'){
   if(a.status!=='停用')fail(409,'CLINIC_ACCOUNT_STATE','账号并未停用');
   this.db.prepare("UPDATE user_account SET status='启用',disabled_at=NULL,disabled_reason=NULL,auth_version=auth_version+1,updated_at=?,revision=revision+1 WHERE id=?").run(now,a.id);
  }else fail(422,'INVALID_ACTION','职员账号操作无效');
  return {...this.touch(person,now),reason};
 },scopeGuard);}
 chair(credentials,input){return this.unit.command(credentials,'clinic.manage',input,(ctx,now)=>{
  const reason=text(input.reason,'诊椅资料或停用依据',2000),old=input.chairId?row(this.db,'dental_chair',input.chairId):null;if(old)revision(old,input.expectedRevision);
  if(input.action==='create'){
   const name=text(input.name,'诊椅名称',80);if(this.db.prepare('SELECT id FROM dental_chair WHERE name=? AND available_until IS NULL').get(name))fail(409,'CLINIC_CHAIR_EXISTS','已有同名可用诊椅，请核对原记录');
   const key=insert(this.db,'dental_chair',fact(now,{name,available_from:now,available_until:null,created_by:ctx.session.staff_id,record_no:recordNo('CHAIR')}));return {kind:'dental_chair',key,revision:1,reason};
  }
  if(!old)fail(422,'CLINIC_CHAIR','请选择原诊椅');
  if(input.action!=='retire')fail(422,'INVALID_ACTION','诊椅操作无效');if(old.available_until)fail(409,'CLINIC_CHAIR_RETIRED','诊椅已退役；临时清洁故障请使用资源停用与恢复');
  if(now<=old.available_from)fail(409,'CLINIC_CHAIR_TIME','退役时间须晚于启用时间，请核对实际资源记录');
  if(this.futureSchedule(null,old.id,now)||this.actualUse(null,old.id))fail(409,'CLINIC_ACTIVE_SCHEDULE','先协调有效排班、预约与实际使用，不能通过退役诊椅取消患者安排');
  this.db.prepare('UPDATE dental_chair SET available_until=?,updated_at=?,revision=revision+1 WHERE id=?').run(now,now,old.id);return {kind:'dental_chair',key:old.id,beforeRevision:old.revision,revision:old.revision+1,reason};
 });}
 query(credentials){return this.unit.query(credentials,'clinic.manage',()=>{
  // Use exactly the same validity rules as login/authorization, including qualifications and employment.
  const effective=new Set(this.db.prepare('SELECT id FROM user_account').all().flatMap(a=>this.unit.auth.roles(a.id).map(r=>r.grant_id)));
  return {
  staff:this.db.prepare('SELECT s.*,a.id account_id,a.login_name,a.status account_status FROM staff s LEFT JOIN user_account a ON a.staff_id=s.id ORDER BY s.id').all(),
  roles:this.db.prepare('SELECT id,code,name FROM access_role ORDER BY id').all(),
  grants:this.db.prepare('SELECT g.*,q.verification_basis,q.valid_from,q.valid_until qualification_until FROM account_role g JOIN staff_role_qualification q ON q.id=g.qualification_id ORDER BY g.id').all().map(g=>({...g,effective:effective.has(g.id)})),
  chairs:this.db.prepare('SELECT * FROM dental_chair ORDER BY id').all(),
  permissions:this.db.prepare('SELECT r.code role,p.name,p.usecase_no FROM role_permission rp JOIN access_role r ON r.id=rp.role_id JOIN access_permission p ON p.id=rp.permission_id WHERE p.code NOT LIKE \'uc29.%\' AND p.code NOT LIKE \'uc30.%\' AND p.code NOT LIKE \'uc31.%\' AND p.code<>\'uc28.approve\' ORDER BY r.id,p.code').all(),
  note:'既有岗位权限矩阵只读；任职授权须实际核实，不因创建账号自动取得医疗资格。临时资源限制仍从诊椅与设备页面办理。'
 };});}
 references(credentials){const p=credentials.role==='manager'?'uc05.approve':'uc05.draft';return this.unit.query(credentials,p,()=>references);}
}
module.exports={Clinic};
