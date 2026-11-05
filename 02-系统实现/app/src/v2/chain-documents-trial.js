'use strict';
const {id,fail,row}=require('./common');
const {ChainAuth}=require('./chain-auth');
class ChainDocumentsTrial{
 constructor(app){this.db=app.db;this.documents=app.documents;this.unit=app.unit;this.access=new ChainAuth(app.auth);}
 scope(credentials,input,permission,versionId=null){const branch=id(input.branchId,'门店'),visitId=id(input.visitId,'就诊'),patientId=id(input.patientId,'患者');
  if(!['assistant','dentist'].includes(credentials.role))fail(403,'FORBIDDEN','需要牙医或助理岗位');
  return ctx=>{this.access.authorizeBranch(credentials,permission,branch);const v=row(this.db,'visit',visitId);
   if(v.branch_id!==branch||v.patient_id!==patientId||(credentials.role==='dentist'&&v.dentist_id!==ctx.session.staff_id))fail(403,'DOCUMENT_BRANCH_SCOPE','仅可办理有权限的本店就诊文件');
   if(versionId){const version=row(this.db,'document_version',id(versionId,'文件版本')),doc=row(this.db,'clinical_document',version.clinical_document_id);if(doc.visit_id!==visitId||doc.patient_id!==patientId)fail(403,'DOCUMENT_BRANCH_SCOPE','文件不属于所选就诊');}
   if(input.documentId){const doc=row(this.db,'clinical_document',id(input.documentId,'文件'));if(doc.visit_id!==visitId||doc.patient_id!==patientId)fail(403,'DOCUMENT_BRANCH_SCOPE','文件不属于所选就诊');}
   ctx.authority={...ctx.authority,branchId:branch,visitId,patientId};};}
 options(credentials,branchId){const branch=id(branchId,'门店');if(!['assistant','dentist'].includes(credentials.role))fail(403,'FORBIDDEN','需要牙医或助理岗位');
  return this.unit.query(credentials,'uc23.upload',ctx=>{this.access.authorizeBranch(credentials,'uc23.upload',branch);ctx.authority={...ctx.authority,branchId:branch};return {visits:this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.status,p.name patient_name,p.record_no patient_no FROM visit v JOIN patient p ON p.id=v.patient_id WHERE v.branch_id=? AND v.started_at IS NOT NULL AND (?<>'dentist' OR v.dentist_id=?) ORDER BY v.id DESC`).all(branch,credentials.role,ctx.session.staff_id)};});}
 query(c,input){return this.documents.query(c,input,{scopeGuard:this.scope(c,input,'uc23.upload')});}
 upload(c,input){return this.documents.upload(c,input,{scopeGuard:this.scope(c,input,'uc23.upload')});}
 verify(c,input){if(c.role!=='dentist')fail(403,'FORBIDDEN','仅牙医可确认归属');return this.documents.verify(c,input,{scopeGuard:this.scope(c,input,'uc23.confirm',input.versionId)});}
 download(c,input){return this.documents.download(c,id(input.versionId,'文件版本'),{scopeGuard:this.scope(c,input,'uc23.upload',input.versionId)});}
}
module.exports={ChainDocumentsTrial};
