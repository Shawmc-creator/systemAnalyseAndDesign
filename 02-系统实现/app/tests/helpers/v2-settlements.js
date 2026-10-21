'use strict';
const {setup:base,command}=require('./v2-prescriptions');
const policy={enabled:true,institutionCode:'DEMO-CLINIC',verificationBasis:'隔离演示，不代表真实定点资质',verifiedBy:'演示验收',validFrom:'2026-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'};
function setup(t,options={}){
 const a=base(t,{insurancePolicy:policy,integrationSimulation:true,...options});
 a.review();a.record();a.serviceRecord=a.service();a.price(a.serviceRecord.id,{unitPriceCents:60000});a.execute(a.serviceRecord.id,{independentCheck:true,independentBasis:'隔离演示的实际独立检查依据'});
 const record=a.clinical.recordFor(a.v.id);a.clinical.sign(a.d,command({action:'sign',recordId:record.id,expectedRevision:record.revision,confirmed:true}));
 a.bill=()=>a.bills().items[0];a.caseRow=()=>a.db.prepare('SELECT * FROM insurance_case ORDER BY id DESC LIMIT 1').get();
 a.verifyIdentity=(extra={})=>a.insurance.identity(a.f,command({patientId:1,personNo:'DEMO-PERSON-0001',area:'DEMO-AREA',outcome:'passed',verifiedAt:a.auth.now(),validUntil:'2026-10-20T01:35:00Z',evidence:'隔离演示医保核验结果',...extra}));
 a.map=(extra={})=>a.insurance.mapping(a.m,command({action:'create',serviceId:a.serviceRecord.id,code:'DEMO-SERVICE',area:'DEMO-AREA',validFrom:'2026-01-01',evidence:'隔离演示映射，不代表真实医保目录',...extra}));
 a.register=(extra={})=>a.insurance.register(a.f,command({patientId:1,visitId:a.v.id,billId:a.bill().id,identityId:a.identity?.id||null,evidence:'患者选择核对医保门诊办理',...extra}));
 a.prepareInput=(extra={})=>{const c=a.caseRow(),b=a.bill();return {caseId:c.id,expectedRevision:c.revision,billId:b.id,expectedBillRevision:b.revision,identityId:a.identity.id,diagnosisCode:'DEMO-DIAGNOSIS',fundCents:35000,accountCents:5000,patientCents:20000,validUntil:'2026-10-19T03:35:00Z',uploadedAt:a.auth.now(),reference:'DEMO-PRE-'+c.id,evidence:'平台预估分摊演示记录',items:b.items.map(i=>({billItemId:i.id,mappingId:a.mapping.id,expectedRevision:1})),...extra};};
 a.prepare=(extra={})=>a.insurance.prepare(a.c,command(a.prepareInput(extra)));
 a.ready=()=>{a.identity=a.verifyIdentity();a.mapping=a.map();a.register();a.prepare();const c=a.caseRow();a.insurance.choice(a.c,command({caseId:c.id,expectedRevision:c.revision,choice:'医保',patientConfirmed:true,evidence:'向演示患者说明预估分摊并确认医保路径'}));};
 a.submit=()=>{const c=a.caseRow();return a.insurance.settle(a.c,command({action:'submit',caseId:c.id,expectedRevision:c.revision,businessNo:c.business_no,evidence:'已在隔离平台提交同一原单，尚未确认成功'}));};
 a.settleInput=(extra={})=>{const c=a.caseRow();return {action:'verify',caseId:c.id,expectedRevision:c.revision,businessNo:c.business_no,outcome:'success',patientMatches:true,reference:'DEMO-SETTLE-'+c.id,confirmedAt:a.auth.now(),fundCents:35000,accountCents:5000,patientCents:20000,evidence:'核实医保正式原单结果（隔离演示）',...extra};};
 a.settle=(extra={})=>a.insurance.settle(a.c,command(a.settleInput(extra)));
 a.order=(extra={})=>{const b=a.bill();return a.settlements.order(a.c,command({billId:b.id,expectedRevision:b.revision,amountCents:b.summary.unpaidCents,channel:'微信',evidence:'患者确认该笔原账单应付',...extra}));};
 a.orderResult=(orderId,extra={})=>{const o=a.db.prepare('SELECT * FROM payment_order WHERE id=?').get(orderId),q=a.bills();return {orderId,expectedRevision:o.revision,businessNo:o.business_no,outcome:'success',amountCents:o.amount_cents,patientMatches:true,merchantMatches:true,reference:'DEMO-TRADE-'+o.id,receivedAt:a.auth.now(),expectedBillRevision:q.items[0].revision,expectedFundsRevision:q.funds.revision,evidence:'核查渠道原单金额、收款方和真实到账（隔离演示）',...extra};};
 return a;
}
module.exports={setup,command,policy};
