'use strict';
const {id,fail,row}=require('./common');
const {ChainAuth}=require('./chain-auth');

// Isolated outpatient trial. Existing prescribing rules remain authoritative.
class ChainPrescriptionTrial {
 constructor(app){this.db=app.db;this.prescriptions=app.prescriptions;this.access=new ChainAuth(app.auth);
  if(this.db.prepare('PRAGMA database_list').all().some(d=>!['main','temp'].includes(d.name)||d.file!==''))throw new Error('连锁处方试验仅允许内存数据库');}
 scope(credentials,input,permission){
  const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),patientId=id(input.patientId,'患者');
  if(credentials.role!=='dentist')fail(403,'FORBIDDEN','需要牙医岗位');
  return ctx=>{this.access.authorizeBranch(credentials,permission,branch);const visit=row(this.db,'visit',visitId);
   if(visit.branch_id!==branch||visit.dentist_id!==ctx.session.staff_id||visit.patient_id!==patientId)fail(403,'PRESCRIPTION_BRANCH_SCOPE','仅可办理本人本店同一患者的就诊处方');
   ctx.authority={...ctx.authority,branchId:branch,visitId,patientId};};
 }
 query(credentials,input){const result=this.prescriptions.query(credentials,input,{scopeGuard:this.scope(credentials,input,'prescriptions.query')});
  return {...result,prescriptions:result.prescriptions.filter(p=>p.collection_route==='院外'),inHouseEnabled:false};}
 write(credentials,input){
  if(!input||!['draft','save','issue','handover','void'].includes(input.action))fail(422,'PRESCRIPTION_ACTION','仅支持院外处方草稿、开立、交付和作废');
  const visitId=id(input.visitId,'就诊'),patientId=id(input.patientId,'患者');
  if(input.collectionRoute!=null&&input.collectionRoute!=='院外')fail(409,'PHARMACY_NOT_ENABLED','连锁试验仅支持院外处方');
  const guard=this.scope(credentials,input,'prescriptions.write');
  return this.prescriptions.write(credentials,input,{scopeGuard:ctx=>{
   guard(ctx);
   if(input.action!=='draft'){const prescription=row(this.db,'prescription',id(input.prescriptionId,'处方'));
    if(prescription.visit_id!==visitId||prescription.patient_id!==patientId||prescription.prescriber_id!==ctx.session.staff_id||prescription.collection_route!=='院外')fail(403,'PRESCRIPTION_BRANCH_SCOPE','处方与本店本人接诊不一致');}
  }});
 }
}
module.exports={ChainPrescriptionTrial};
