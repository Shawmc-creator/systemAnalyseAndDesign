'use strict';
const crypto=require('node:crypto');
const {id,text,instant,fail,insert,fact,row,revision,hash,canonical}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {snapshotFinancialHistory,validateFinancialHistory}=require('./financial-history');
const {mapError}=require('./unit-of-work');

// Demonstration service only. Catalog is shared; prices and approvals are per
// branch. This class is not connected to the live single-store server.
class ChainPriceTrial{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.billing=app.billing;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('价目试验仅允许内存数据库');}
 list(credentials,branchId){
  branchId=id(branchId,'门店');const permission=credentials.role==='manager'?'uc05.approve':'uc05.draft';
  this.db.exec('BEGIN');try{
   const ctx=this.access.authorizeBranch(credentials,permission,branchId);ctx.authority={...ctx.authority,branchId};
   const services=this.db.prepare('SELECT id,name,billing_unit,category,is_active,revision FROM service ORDER BY id').all();
   const prices=this.db.prepare('SELECT id,service_id,branch_id,unit_price_cents,valid_from,valid_until,status,revision FROM service_price WHERE branch_id=? ORDER BY id').all(branchId);
   this.unit.audit(ctx,'查询','CHAIN_PRICE_LIST',{kind:'branch_price_query',key:'branch:'+branchId},null,'按门店查询价目');
   this.db.exec('COMMIT');return {branchId,services,prices};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
 command(credentials,input){
  if(!credentials.csrf)fail(403,'CSRF_INVALID','缺少安全令牌');
  if(!input||input.commandVersion!==1||!['draft','submit','approve','return','stop'].includes(input.action))fail(422,'INVALID_ACTION','价目操作无效');
  const branch=id(input.branchId,'门店'),key=text(input.requestKey,'提交号',100),permission=['draft','submit'].includes(input.action)?'uc05.draft':'uc05.approve';
  const digest=hash(canonical({permission,input}));this.db.exec('BEGIN IMMEDIATE');
  try{
   const ctx=this.access.authorizeBranch(credentials,permission,branch);ctx.authority={...ctx.authority,branchId:branch};
   const old=this.db.prepare('SELECT * FROM request_submission WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.permission_id!==ctx.permission.id||old.payload_digest!==digest||old.result_kind!=='service_price')fail(409,'REQUEST_KEY_REUSED','提交号已用于其他操作');
    if(!this.db.prepare('SELECT 1 FROM service_price WHERE id=? AND branch_id=?').get(Number(old.result_key),branch))fail(409,'PRICE_BRANCH','原价目门店待核对');
    this.db.exec('COMMIT');return {...this.unit.result(old),replayed:true};}
   const now=this.auth.now(),before=snapshotFinancialHistory(this.db);let priceId,rev,prior=null,reason;
   if(input.action==='draft'){
    const service=row(this.db,'service',id(input.serviceId,'收费项目'));if(!service.is_active)fail(409,'SERVICE_DISABLED','收费项目已停用');
    const amount=this.billing.amount(input.unitPriceCents,true),start=instant(input.validFrom,'拟生效时间'),end=input.validUntil==null?null:instant(input.validUntil,'拟截止时间');
    if(end&&end<=start)fail(422,'PRICE_INTERVAL','截止时间须晚于生效时间');
    reason=text(input.reason,'拟价依据',2000)+(amount===0?'\n免收依据：'+text(input.waiverBasis,'免收依据',1000):'');
    priceId=insert(this.db,'service_price',fact(now,{branch_id:branch,service_id:service.id,unit_price_cents:amount,valid_from:start,valid_until:end,
     change_reason:reason,confirmed_at:null,review_note:null,created_by:ctx.session.staff_id,confirmed_by:null,status:'价目草稿'}));rev=1;
   }else{
    const price=row(this.db,'service_price',id(input.priceId,'价目'));
    if(price.branch_id!==branch)fail(403,'PRICE_BRANCH','价目不属于当前门店');revision(price,input.expectedRevision);prior=price.revision;
    if(input.action==='submit'){
     if(!['价目草稿','已退回'].includes(price.status))fail(409,'INVALID_STATE','当前价目不能提交');
     this.db.prepare("UPDATE service_price SET status='待负责人确认',review_note=NULL,confirmed_at=NULL,confirmed_by=NULL,updated_at=?,revision=revision+1 WHERE id=?").run(now,price.id);
     reason=price.change_reason;this.unit.financialHistory.append('service_price',price.id,'提交',reason,ctx,input,now);
    }else{
     reason=text(input.reviewNote,'负责人处理意见',2000);
     if(['approve','return'].includes(input.action)&&price.status!=='待负责人确认')fail(409,'INVALID_STATE','只有待确认价目可确认或退回');
     if(input.action==='stop'&&price.status!=='已确认可适用')fail(409,'INVALID_STATE','只有已确认价目可以停用');
     if(input.action==='approve'&&!row(this.db,'service',price.service_id).is_active)fail(409,'SERVICE_DISABLED','收费项目已停用');
     const status={approve:'已确认可适用',return:'已退回',stop:'不再用于新计费'}[input.action];
     this.db.prepare('UPDATE service_price SET status=?,confirmed_at=?,confirmed_by=?,review_note=?,updated_at=?,revision=revision+1 WHERE id=?')
      .run(status,input.action==='return'?null:input.action==='stop'?price.confirmed_at:now,input.action==='return'?null:input.action==='stop'?price.confirmed_by:ctx.session.staff_id,reason,now,price.id);
     this.unit.financialHistory.append('service_price',price.id,{approve:'确认',return:'退回',stop:'停止适用'}[input.action],reason,ctx,input,now);
    }
    priceId=price.id;rev=price.revision+1;
   }
   validateFinancialHistory(this.db,before);
   const sid=insert(this.db,'request_submission',{account_id:ctx.session.account_id,permission_id:ctx.permission.id,request_key:key,payload_digest:digest,
    command_version:1,status:'已提交',created_at:now,committed_at:now,result_kind:'service_price',result_key:String(priceId),result_revision:rev,result_code:'COMMITTED',correlation_id:crypto.randomUUID()});
   this.unit.audit(ctx,'变更','COMMITTED',{kind:'service_price',key:priceId,revision:rev,beforeRevision:prior},sid,reason);
   this.db.exec('COMMIT');return {...this.unit.result(this.db.prepare('SELECT * FROM request_submission WHERE id=?').get(sid)),replayed:false};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw mapError(e);}
 }
}
module.exports={ChainPriceTrial};
