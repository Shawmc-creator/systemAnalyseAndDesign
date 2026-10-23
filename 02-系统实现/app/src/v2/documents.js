'use strict';
const {fail,text,id,instant,dateOnly,day,insert,fact,recordNo,row,revision}=require('./common');
const {decodeFile}=require('./document-store');
class Documents{
  constructor(db,unit,clinical,store){Object.assign(this,{db,unit,clinical,store});}
  context(ctx,input,operation='read'){
    const visit=ctx.authority.role==='dentist'?this.clinical.scope(ctx,id(Number(input.visitId)),operation):row(this.db,'visit',Number(input.visitId));
    if(visit.patient_id!==Number(input.patientId))fail(409,'PATIENT_MISMATCH','患者与所选就诊不一致');
    ctx.authority.visitId=visit.id;ctx.authority.patientId=visit.patient_id;return visit;
  }
  own(ctx,documentId,operation='read'){
    const doc=row(this.db,'clinical_document',documentId);
    if(!doc.visit_id)fail(409,'DOCUMENT_CONTEXT','该历史附件缺少就诊关联，请先核对来源');
    this.context(ctx,{visitId:doc.visit_id,patientId:doc.patient_id},operation);return doc;
  }
  worklist(credentials,filters={}){
    return this.unit.query(credentials,'uc23.upload',ctx=>{
      const date=dateOnly(filters.date||day(this.unit.auth.now()));
      return {items:this.db.prepare(`SELECT v.id,v.patient_id,v.record_no,v.status,v.arrived_at,p.name patient_name,p.record_no patient_no,s.name dentist_name
        FROM visit v JOIN patient p ON p.id=v.patient_id JOIN staff s ON s.id=v.dentist_id WHERE substr(v.arrived_at,1,10) IN (?,?) ORDER BY v.arrived_at DESC`).all(date,new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10)).filter(v=>day(v.arrived_at)===date).filter(v=>{
          if(ctx.authority.role!=='dentist')return true;
          try{this.clinical.scope(ctx,v.id);return true;}catch(e){if(e.code==='CLINICAL_SCOPE')return false;throw e;}
        })};
    });
  }
  query(credentials,input){
    return this.unit.query(credentials,'uc23.upload',ctx=>{
      const visit=this.context(ctx,input),patient=row(this.db,'patient',visit.patient_id);
      const documents=this.db.prepare('SELECT * FROM clinical_document WHERE visit_id=? ORDER BY id DESC').all(visit.id).map(doc=>{
        const {storage_key,...unused}=doc; // No physical storage paths are exposed by this API.
        return {...unused,versions:this.db.prepare(`SELECT d.*,s.name uploaded_by_name,c.name confirmed_by_name FROM document_version d JOIN staff s ON s.id=d.uploaded_by LEFT JOIN staff c ON c.id=d.confirmed_by WHERE clinical_document_id=? ORDER BY version_no DESC`).all(doc.id).map(v=>{
          const {storage_key,...info}=v;return {...info,corrections:this.unit.workflowHistory.list('document_version',v.id).map(h=>({id:h.id,event_no:h.event_no,event_type:h.event_type,event_reason:h.event_reason,actor_name:h.actor_name,occurred_at:h.occurred_at,original_confirmed_by:h.original_confirmed_by,original_confirmed_at:h.original_confirmed_at,original_confirmation_note:h.original_confirmation_note})),available:this.store.available(v)};
        })};
      });
      const plans=this.db.prepare(`SELECT v.id,v.version_no,p.goal FROM plan_version v JOIN treatment_plan p ON p.id=v.treatment_plan_id WHERE v.source_visit_id=? AND p.patient_id=? ORDER BY v.id DESC`).all(visit.id,patient.id);
      return {visit:{id:visit.id,record_no:visit.record_no,status:visit.status},patient:{id:patient.id,name:patient.name,record_no:patient.record_no},documents,plans};
    });
  }
  mutate(credentials,input,permission,handler){
    const writes=[];
    try{const result=this.unit.command(credentials,permission,input,(ctx,now)=>handler(ctx,now,writes));writes.forEach(w=>w.commit());return result;}
    catch(error){for(const w of writes.reverse())w.rollback();throw error;}
  }
  upload(credentials,input){
    return this.mutate(credentials,input,'uc23.upload',(ctx,now,writes)=>{
      const visit=this.context(ctx,input,'documents'),file=decodeFile(input),reason=text(input.reason,'上传或补充依据',2000);
      const capturedAt=input.capturedAt?instant(input.capturedAt,'实际拍摄或形成时间'):null;
      if(capturedAt&&capturedAt>now)fail(422,'FUTURE_FACT','文件实际形成时间不能在未来');
      let doc;
      if(input.documentId){
        doc=this.own(ctx,id(input.documentId),'documents');revision(doc,input.expectedRevision);
        if(doc.visit_id!==visit.id||doc.patient_id!==visit.patient_id)fail(409,'DOCUMENT_CONTEXT','补充文件须属于当前就诊和患者');
      }else{
        if(!['影像','同意文书','诊疗附件'].includes(input.documentType))fail(422,'DOCUMENT_TYPE','请选择影像、同意文书或诊疗附件');
        const planId=input.planVersionId==null?null:id(input.planVersionId);
        if(planId){const version=row(this.db,'plan_version',planId),plan=row(this.db,'treatment_plan',version.treatment_plan_id);if(plan.patient_id!==visit.patient_id||version.source_visit_id!==visit.id)fail(409,'DOCUMENT_CONTEXT','方案版本须属于当前患者及所选就诊');}
        const key=insert(this.db,'clinical_document',fact(now,{patient_id:visit.patient_id,visit_id:visit.id,plan_version_id:planId,document_type:input.documentType,source:text(input.source,'文件来源'),ownership_note:text(input.ownershipNote,'归属核对依据',2000),created_by:ctx.session.staff_id,record_no:recordNo('DOC')}));
        doc=row(this.db,'clinical_document',key);
      }
      const previous=this.db.prepare('SELECT * FROM document_version WHERE clinical_document_id=? ORDER BY version_no DESC LIMIT 1').get(doc.id);
      const storageKey=this.store.key();writes.push(this.store.stage(storageKey,file.bytes));
      const key=insert(this.db,'document_version',fact(now,{clinical_document_id:doc.id,original_name:file.name,size_bytes:file.bytes.length,sha256:file.sha256,captured_at:capturedAt,confirmed_at:null,change_reason:reason,version_no:previous?previous.version_no+1:1,storage_key:storageKey,media_type:file.mime,verification_note:null,uploaded_by:ctx.session.staff_id,confirmed_by:null,previous_version_id:previous?.id||null,status:'原件待确认'}));
      this.db.prepare('UPDATE clinical_document SET revision=revision+1,updated_at=? WHERE id=?').run(now,doc.id);
      ctx.authority.documentId=doc.id;
      return {kind:'document_version',key,revision:1,reason,changes:[{field:'sha256',after:file.sha256},{field:'clinical_document_id',after:doc.id}],relatedChanges:[{kind:'clinical_document',key:doc.id,beforeRevision:doc.revision,revision:doc.revision+1,reason}]};
    });
  }
  verify(credentials,input){
    return this.mutate(credentials,input,'uc23.confirm',(ctx,now,writes)=>{
      const version=row(this.db,'document_version',id(input.versionId)),doc=this.own(ctx,version.clinical_document_id,'documents');revision(version,input.expectedRevision);
      const note=text(input.verificationNote,'核对结论',2000);let status;
      if(input.action==='confirm'||input.action==='return'){
        if(version.status!=='原件待确认')fail(409,'DOCUMENT_STATE','仅待确认版本可确认或退回');
        if(input.action==='confirm'){
          if(input.confirmed!==true)fail(422,'DOCUMENT_CONFIRM','请明确确认已经核对原件内容及患者归属');
          if(!this.store.available(version))fail(409,'FILE_UNAVAILABLE','原文件缺失或内容校验不符，不能确认');
          status='原件已确认';
        }else status='退回核对';
      }else if(input.action==='missing'){
        if(version.status!=='原件已确认'||this.store.available(version))fail(409,'DOCUMENT_STATE','仅实际缺失或损坏的已确认文件可标记不可读');status='缺失或不可读';
      }else if(input.action==='restore'){
        if(version.status!=='缺失或不可读')fail(409,'DOCUMENT_STATE','仅缺失或不可读版本可恢复原件');
        const file=decodeFile(input);
        if(file.sha256!==version.sha256||file.bytes.length!==version.size_bytes||file.mime!==version.media_type)fail(409,'RESTORE_HASH','恢复文件必须与原版本内容、大小和类型完全一致');
        writes.push(this.store.stage(version.storage_key,file.bytes,true));status='原件已确认';
      }else fail(422,'INVALID_ACTION','无效的文书核对动作');
      this.db.prepare('UPDATE document_version SET status=?,verification_note=?,confirmed_at=?,confirmed_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(status,note,input.action==='confirm'?now:version.confirmed_at,input.action==='confirm'?ctx.session.staff_id:version.confirmed_by,now,version.id);
      ctx.authority.documentId=doc.id;
      return {kind:'document_version',key:version.id,beforeRevision:version.revision,revision:version.revision+1,reason:note,changes:[{field:'status',before:version.status,after:status}]};
    });
  }
  correct(credentials,input){
    return this.mutate(credentials,input,'uc23.confirm',(ctx,now,writes)=>{
      const version=row(this.db,'document_version',id(input.versionId)),old=this.own(ctx,version.clinical_document_id,'documents');revision(version,input.expectedRevision);
      // Preserve the original index and all existing consent references. A correction is a new index.
      if(!['原件待确认','退回核对','原件已确认'].includes(version.status))fail(409,'DOCUMENT_STATE','请先恢复可核实的原件，再处理归属更正');
      if(this.db.prepare('SELECT id FROM document_correction WHERE document_version_id=?').get(version.id))fail(409,'DOCUMENT_ALREADY_CORRECTED','原版本已有更正记录，请从当前索引继续核对');
      if(version.status==='原件已确认'&&input.confirmed!==true)fail(422,'DOCUMENT_CONFIRM','已确认原件更正须由牙医重新核对并明确确认正确归属');
      if(this.db.prepare("SELECT id FROM document_version WHERE clinical_document_id=? AND id<>? AND (status IN ('原件已确认','缺失或不可读') OR version_no>?)").get(old.id,version.id,version.version_no))fail(409,'DOCUMENT_STATE','原索引已有其他确认版本或更新版本，请先核对完整版本链');
      const visit=this.context(ctx,input,'documents'),reason=text(input.reason,'归属更正依据',2000);
      if(visit.id===old.visit_id)fail(422,'DOCUMENT_CONTEXT','请选择核实后的正确就诊');
      if(!this.store.available(version))fail(409,'FILE_UNAVAILABLE','原件缺失，无法进行归属核对');
      const key=insert(this.db,'clinical_document',fact(now,{patient_id:visit.patient_id,visit_id:visit.id,plan_version_id:null,document_type:old.document_type,source:old.source,ownership_note:reason,created_by:ctx.session.staff_id,record_no:recordNo('DOC')}));
      const storageKey=this.store.key();writes.push(this.store.stage(storageKey,this.store.read(version.storage_key)));
      const newVersion=insert(this.db,'document_version',fact(now,{clinical_document_id:key,original_name:version.original_name,size_bytes:version.size_bytes,sha256:version.sha256,captured_at:version.captured_at,confirmed_at:null,change_reason:reason,version_no:1,storage_key:storageKey,media_type:version.media_type,verification_note:null,uploaded_by:ctx.session.staff_id,confirmed_by:null,previous_version_id:null,status:'原件待确认'}));
      if(version.status==='原件已确认')this.db.prepare("UPDATE document_version SET status='原件已确认',confirmed_by=?,confirmed_at=?,verification_note=? WHERE id=?").run(ctx.session.staff_id,now,reason,newVersion);
      this.db.prepare("UPDATE document_version SET status='退回核对',verification_note=?,updated_at=?,revision=revision+1 WHERE id=?").run(reason,now,version.id);
      this.unit.workflowHistory.append('document_version',version.id,'归属更正',reason,ctx,input,now,{corrected_document_version_id:newVersion,original_confirmed_by:version.confirmed_by,original_confirmed_at:version.confirmed_at,original_confirmation_note:version.verification_note});
      return {kind:'document_version',key:newVersion,revision:1,reason,changes:[{field:'corrected_from_version_id',after:version.id},{field:'clinical_document_id',after:key}],relatedChanges:[{kind:'document_version',key:version.id,beforeRevision:version.revision,revision:version.revision+1,reason,changes:[{field:'corrected_to_version_id',after:newVersion}]}]};
    });
  }
  download(credentials,versionId){
    return this.unit.query(credentials,'uc23.upload',ctx=>{
      const v=row(this.db,'document_version',Number(versionId));this.own(ctx,v.clinical_document_id);
      if(!this.store.available(v))fail(409,'FILE_UNAVAILABLE','原件缺失或内容校验不符，请牙医核对后恢复');
      ctx.authority.documentVersionId=v.id;return {name:v.original_name,mediaType:v.media_type,bytes:this.store.read(v.storage_key)};
    });
  }
  requireEvidence(versionId){
    const v=row(this.db,'document_version',versionId);
    if(!this.store.available(v))fail(409,'FILE_UNAVAILABLE','所选文书原件缺失或损坏，不能作为本次决定的依据');
  }
}
module.exports={Documents};
