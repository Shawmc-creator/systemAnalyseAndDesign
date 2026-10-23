'use strict';
const {insert,row,canonical,hash,fail}=require('./common');
const {CONFIG}=require('./financial-history-schema');

// Maps the two existing domain objects to their typed, append-only historical storage.
class FinancialHistoryRepository{
 constructor(db){this.db=db;}
 append(kind,objectId,eventType,eventReason,ctx,input,now){
  const config=CONFIG[kind];if(!config)throw new Error('Unsupported financial history owner');
  const current=row(this.db,kind,objectId),last=this.db.prepare(`SELECT coalesce(max(event_no),0) n FROM ${config.table} WHERE ${config.ownerField}=?`).get(objectId).n;
  const operationNo=hash(canonical({accountId:ctx.session.account_id,requestKey:input.requestKey,kind,objectId}));
  const id=insert(this.db,config.table,{[config.ownerField]:objectId,event_no:last+1,operation_no:operationNo,event_type:eventType,event_reason:eventReason,
   actor_id:ctx.session.staff_id,occurred_at:now,...Object.fromEntries(config.fields.map(f=>[f,current[f]]))});
  ctx.authority.financialHistory={table:config.table,id,operationNo};return id;
 }
 list(kind,objectId){const c=CONFIG[kind];return this.db.prepare(`SELECT h.*,s.name actor_name FROM ${c.table} h JOIN staff s ON s.id=h.actor_id WHERE h.${c.ownerField}=? ORDER BY h.event_no`).all(objectId);}
}
function snapshotFinancialHistory(db){
 return Object.fromEntries(Object.entries(CONFIG).map(([kind,c])=>[kind,{last:db.prepare(`SELECT coalesce(max(id),0) n FROM ${c.table}`).get().n,
  objects:new Map(db.prepare(`SELECT * FROM ${kind}`).all().map(r=>[r.id,{status:r.status,payload:canonical(Object.fromEntries(c.fields.map(f=>[f,r[f]])))}]))}]));
}
function validateFinancialHistory(db,before){
 for(const [kind,c]of Object.entries(CONFIG)){
  for(const current of db.prepare(`SELECT * FROM ${kind}`).all()){
   const old=before[kind].objects.get(current.id),payload=canonical(Object.fromEntries(c.fields.map(f=>[f,current[f]])));
   const changed=!old||old.payload!==payload;
   // Price drafts are not business submissions. Previous submitted/reviewed snapshots stay frozen while editing them.
   if(!changed||(kind==='service_price'&&['价目草稿','已退回'].includes(current.status)&&(!old||old.status===current.status)))continue;
   const history=db.prepare(`SELECT * FROM ${c.table} WHERE ${c.ownerField}=? ORDER BY event_no DESC LIMIT 1`).get(current.id);
   if(!history||history.id<=before[kind].last||canonical(Object.fromEntries(c.fields.map(f=>[f,history[f]])))!==payload)
    fail(409,'FINANCIAL_HISTORY_MISSING','本次业务结果缺少对应的完整历史快照，已回滚');
  }
  for(const h of db.prepare(`SELECT * FROM ${c.table} WHERE id>?`).all(before[kind].last)){
   const old=before[kind].objects.get(h[c.ownerField]);
   if(old&&old.payload===canonical(Object.fromEntries(c.fields.map(f=>[f,h[f]]))))fail(409,'FINANCIAL_HISTORY_DUPLICATE','原业务未发生有效变更，不能重复追加办理历史');
  }
 }
}
module.exports={FinancialHistoryRepository,snapshotFinancialHistory,validateFinancialHistory};
