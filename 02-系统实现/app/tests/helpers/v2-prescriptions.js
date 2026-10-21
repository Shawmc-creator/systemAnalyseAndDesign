'use strict';
const {setup:base,command}=require('./v2-treatment');
function setup(t,options={}){
 const a=base(t,options),s=a.auth.login({username:'assistant',password:'Clinic123!'});a.i={token:s.token,csrf:s.csrf,role:'assistant'};
 a.drug=a.inventory.record(a.i,command({action:'material',name:'流程演示药品（非真实药物）',specification:'演示规格，不用于实际治疗',baseUnit:'片',purchaseUnit:'盒',conversionNumerator:10,conversionDenominator:1,quantityScale:0,requiresTrace:true,requiresExpiry:true,isDrug:true,reason:'隔离验收药品目录'}));
 a.inventory.approve(a.m,command({action:'confirmMaterial',materialId:a.drug.id,expectedRevision:1,reason:'演示药品目录及基本单位核对'}));
 a.review=()=>a.clinical.health(a.d,command({...a.context,action:'record',expectedHealthVersionId:a.db.prepare('SELECT id FROM health_version WHERE patient_id=1 ORDER BY version_no DESC LIMIT 1').get()?.id||null,effectiveAt:a.auth.now(),reason:'演示健康复核',conclusion:'已核对本次病史、过敏和既往用药信息',items:['病史','过敏','用药'].map(category=>({category,certainty:'无',content:'流程演示记录，非真实患者资料',source:'隔离验收',reportedAt:a.auth.now()}))}));
 a.record=()=>{const r=a.clinical.recordFor(a.v.id);return a.clinical.record(a.d,command({...a.context,action:'save',recordId:r.id,expectedRevision:r.revision,chiefComplaint:'流程演示主诉',diagnosis:'流程演示诊断',treatmentAdvice:'流程演示处理意见',findings:[{text:'流程演示检查所见'}]}));};
 a.rx=(fields={},actor=a.d)=>a.prescriptions.write(actor,command({...a.context,...fields}));
 a.rxDraft=(extra={})=>a.rx({action:'draft',collectionRoute:'院外',diagnosis:'流程演示诊断',guidanceNote:'由实际医师填写注意事项；演示文本不用于用药',reason:'医师建立草稿',items:[{materialId:a.drug.id,expectedMaterialRevision:2,quantityScaled:7,directions:'医师填写的演示用法、用量和疗程字段，不用于实际用药'}],...extra});
 a.rxIssue=(p,extra={})=>a.rx({action:'issue',prescriptionId:p.id,expectedRevision:p.revision,expectedPatientRevision:a.db.prepare('SELECT revision FROM patient WHERE id=1').get().revision,expectedRecordRevision:a.clinical.recordFor(a.v.id).revision,expectedHealthReviewId:a.db.prepare('SELECT id FROM health_review WHERE visit_id=? ORDER BY id DESC LIMIT 1').get(a.v.id)?.id||null,confirmed:true,reason:'医师核对患者与本次处方，确认开立',...extra});
 return a;
}
module.exports={setup,command};
