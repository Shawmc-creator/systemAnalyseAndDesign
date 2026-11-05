'use strict';
const {command}=require('../../tests/helpers/v2-treatment');
function prepareHomeDemo(a){
 if(a.db.location()!==null)throw new Error('岗位待办示例仅允许隔离内存库');
 const s=a.billing.draft(a.c,command({action:'service',name:'待核定的示例项目（非正式价目）',billingUnit:'次',reason:'虚构岗位交接演示'}));
 const p=a.billing.draft(a.c,command({action:'draft',serviceId:s.id,unitPriceCents:15000,validFrom:a.auth.now(),reason:'虚构拟价，待负责人核对'}));a.billing.draft(a.c,command({action:'submit',priceId:p.id,expectedRevision:1}));
 a.inventory.record(a.i,command({action:'batch',materialId:a.drug.id,batchNo:'HOME-DEMO-PENDING',expiryDate:'2027-10-19',sourceNote:'虚构待核批次；未登记实物到货，不生成库存'}));
 const funds=a.billing.fundsSummary(1);a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:funds.revision,receivedCents:10000,changeCents:0,channel:'微信',verification:'pending',transactionEvidence:'隔离示例：原渠道到账结果尚未明确；不计已收款',allocations:[]}));
 const q=a.quotes.query(a.c).quotes[0],v=q.versions.at(-1);a.quotes.prepare(a.d,command({action:'revise',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,reason:'虚构患者补充后续范围，新版仍在编制，旧出具版仍可核对'}));
 a.followups.propose(a.d,command({action:'create',patientId:1,sourceVisitId:a.v.id,type:'复诊',purpose:'虚构的后续联系与复诊安排，不是真实医嘱',targetStart:'2026-10-19',targetEnd:'2026-10-21',requiresAssessment:true,responsibleFrontdeskId:2,nextContactDate:'2026-10-19'}));
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 for(const returned of [true,false]){
  const result=a.documents.upload(a.i,command({patientId:1,visitId:a.v.id,documentType:'诊疗附件',source:'虚构流程占位附件，不能用于诊断',ownershipNote:'仅用于岗位归档与退回交接演示',reason:'虚构附件的首次归档',originalName:returned?'归档交接示例-待补充.png':'归档交接示例-待核对.png',contentBase64:png}));
  if(returned)a.documents.verify(a.d,command({action:'return',versionId:result.id,expectedRevision:result.revision,verificationNote:'隔离演示：请补充原附件归属说明',confirmed:true}));
 }
 return {manager:a.home.query(a.m),frontdesk:a.home.query(a.f),dentist:a.home.query(a.d),cashier:a.home.query(a.c),assistant:a.home.query(a.i)};
}
module.exports={prepareHomeDemo};
