'use strict';
// Branch-local demonstration only. This records a reconciliation, never moves money.
const {id,text,day,hash,canonical,fail}=require('./common');
const {ChainAuth}=require('./chain-auth');
const {safe}=require('./inventory-gates');
function installDayCloseSchema(db){
 const names=['chain_day_close','chain_day_close_no_update','chain_day_close_no_delete'],found=db.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name IN (?,?,?)").all(...names);
 if(found.length===names.length){const byName=Object.fromEntries(found.map(x=>[x.name,x]));if(byName.chain_day_close.type!=='table'||['chain_day_close_no_update','chain_day_close_no_delete'].some(n=>byName[n].type!=='trigger'||byName[n].tbl_name!=='chain_day_close'||!byName[n].sql.includes("RAISE(ABORT,'day_close_frozen')")))throw Error('日终核对保护结构异常');return;}if(found.length)throw Error('日终核对结构不完整，拒绝自动补建');
 db.exec(`CREATE TABLE chain_day_close (
   id INTEGER PRIMARY KEY,branch_id INTEGER NOT NULL REFERENCES clinic_branch(id),business_date TEXT NOT NULL,channel TEXT NOT NULL,
   cutoff_at TEXT NOT NULL,receipt_count INTEGER NOT NULL,refund_count INTEGER NOT NULL,receipt_cents INTEGER NOT NULL,refund_cents INTEGER NOT NULL,
   expected_cents INTEGER NOT NULL,actual_cents INTEGER NOT NULL,difference_cents INTEGER NOT NULL,source_digest TEXT NOT NULL,
   evidence TEXT NOT NULL,operator_id INTEGER NOT NULL REFERENCES staff(id),account_id INTEGER NOT NULL REFERENCES user_account(id),
   request_key TEXT NOT NULL,payload_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(account_id,request_key)
  ) STRICT;
  CREATE TRIGGER chain_day_close_no_update BEFORE UPDATE ON chain_day_close BEGIN SELECT RAISE(ABORT,'day_close_frozen'); END;
  CREATE TRIGGER chain_day_close_no_delete BEFORE DELETE ON chain_day_close BEGIN SELECT RAISE(ABORT,'day_close_frozen'); END;`);
}
class ChainDayClose{
 constructor(app){this.db=app.db;this.auth=app.auth;this.unit=app.unit;this.access=new ChainAuth(app.auth);if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chain_day_close'").get())throw Error('日终核对结构未安装');}
 permission(c,b){if(c.role!=='manager'||!c.csrf)fail(403,'FORBIDDEN','需要负责人岗位和安全令牌');const ctx=this.access.authorizeBranch(c,'clinic.manage',b);ctx.authority={...ctx.authority,branchId:b};return ctx;}
 sources(branch,channel,now){
  if(!['现金','银行卡','微信','支付宝'].includes(channel))fail(422,'INVALID_INPUT','请选择收款渠道');
  const businessDate=day(now),start=new Date(businessDate+'T00:00:00+08:00').toISOString().replace('.000Z','Z');
  const payments=this.db.prepare(`SELECT p.id,p.revision,p.received_at,p.received_cents,p.change_cents,f.branch_id funds_branch
   FROM patient_payment p LEFT JOIN patient_funds f ON f.id=p.patient_funds_id
   WHERE p.branch_id=? AND p.channel=? AND p.status='到账已确认' AND p.received_at>=? AND p.received_at<=? ORDER BY p.id`).all(branch,channel,start,now);
  const refunds=this.db.prepare(`SELECT r.id,r.revision,r.verified_at,r.actual_cents,p.branch_id payment_branch,f.branch_id funds_branch
   FROM patient_refund r JOIN patient_payment p ON p.id=r.patient_payment_id JOIN patient_funds f ON f.id=r.patient_funds_id
   WHERE f.branch_id=? AND p.channel=? AND r.status='已确认退款' AND r.verified_at>=? AND r.verified_at<=? ORDER BY r.id`).all(branch,channel,start,now);
  if(payments.some(p=>p.funds_branch!==branch)||refunds.some(r=>r.payment_branch!==branch||r.funds_branch!==branch||r.actual_cents==null))fail(409,'FINANCE_BRANCH_UNKNOWN','收退款归属待核对');
  const receipts=safe(payments.reduce((n,p)=>n+BigInt(p.received_cents)-BigInt(p.change_cents),0n)),returned=safe(refunds.reduce((n,r)=>n+BigInt(r.actual_cents),0n));
  return {businessDate,channel,cutoffAt:now,receiptCount:payments.length,refundCount:refunds.length,receiptCents:receipts,refundCents:returned,expectedCents:safe(BigInt(receipts)-BigInt(returned)),sourceDigest:hash(canonical({branch,channel,businessDate,payments,refunds}))};
 }
 preview(c,branch,channel){branch=id(branch,'门店');this.db.exec('BEGIN');try{const ctx=this.permission(c,branch),summary=this.sources(branch,channel,this.auth.now()),items=this.db.prepare('SELECT id,business_date,channel,cutoff_at,receipt_cents,refund_cents,expected_cents,actual_cents,difference_cents,evidence,created_at FROM chain_day_close WHERE branch_id=? ORDER BY id DESC LIMIT 30').all(branch);this.unit.audit(ctx,'查询','CHAIN_DAY_CLOSE_PREVIEW',{kind:'branch_day_close',key:branch},null,'查询本店收退款核对');this.db.exec('COMMIT');return {...summary,items};}catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 record(c,input){const branch=id(input.branchId,'门店'),channel=input.channel,key=text(input.requestKey,'提交号',100),evidence=text(input.evidence,'实际核对依据',1000);if(input.commandVersion!==1||input.confirmed!==true||!Number.isSafeInteger(input.actualCents))fail(422,'INVALID_INPUT','请填写实际净额并确认核对');
  const payload=hash(canonical(input));this.db.exec('BEGIN IMMEDIATE');try{const ctx=this.permission(c,branch),old=this.db.prepare('SELECT id,payload_digest,branch_id,difference_cents FROM chain_day_close WHERE account_id=? AND request_key=?').get(ctx.session.account_id,key);
   if(old){if(old.payload_digest!==payload||old.branch_id!==branch)fail(409,'REQUEST_KEY_REUSED','提交号已用于其他核对');this.db.exec('COMMIT');return {id:old.id,differenceCents:old.difference_cents,replayed:true};}
   const now=this.auth.now(),summary=this.sources(branch,channel,now);if(input.sourceDigest!==summary.sourceDigest||input.businessDate!==summary.businessDate)fail(409,'SOURCE_CHANGED','收退款数据已变化，请重新查询核对');
   const difference=safe(BigInt(input.actualCents)-BigInt(summary.expectedCents));
   const result=this.db.prepare(`INSERT INTO chain_day_close(branch_id,business_date,channel,cutoff_at,receipt_count,refund_count,receipt_cents,refund_cents,expected_cents,actual_cents,difference_cents,source_digest,evidence,operator_id,account_id,request_key,payload_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(branch,summary.businessDate,channel,now,summary.receiptCount,summary.refundCount,summary.receiptCents,summary.refundCents,summary.expectedCents,input.actualCents,difference,summary.sourceDigest,evidence,ctx.session.staff_id,ctx.session.account_id,key,payload,now);
   const resultId=Number(result.lastInsertRowid);this.unit.audit(ctx,'变更','CHAIN_DAY_CLOSE_RECORDED',{kind:'branch_day_close',key:resultId},null,'记录本店渠道日终核对');this.db.exec('COMMIT');return {id:resultId,differenceCents:difference};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
}
class ChainDayCloseTrial extends ChainDayClose{
 constructor(app){if(app.db.prepare('PRAGMA database_list').all().some(x=>!['main','temp'].includes(x.name)||x.file!==''))throw Error('日终演示只允许内存数据库');installDayCloseSchema(app.db);super(app);}
}
module.exports={ChainDayClose,ChainDayCloseTrial,installDayCloseSchema};
