'use strict';
const { fail,text,instant,dateOnly,day,utc,id,row,revision,insert,fact }=require('./common');
const { PHYSICAL_END }=require('./resource-rules');
class Resources {
  constructor(db,unit,clinical) { this.db=db;this.unit=unit;this.clinical=clinical; }
  equipment(credentials,input) {
    return this.unit.command(credentials,'resources.equipment',input,(ctx,now)=>{
      const old=input.equipmentId?row(this.db,'clinical_equipment',input.equipmentId):null;
      if (old) revision(old,input.expectedRevision);
      const chairId=input.chairId==null||input.chairId===''?null:id(input.chairId,'诊椅');
      if (chairId) row(this.db,'dental_chair',chairId);
      const status=input.status||'可用';
      if (!['可用','停用'].includes(status)) fail(422,'INVALID_STATUS','设备状态无效');
      const reason=text(input.reason,'登记或变更依据');
      if (old && old.dental_chair_id!==chairId && this.db.prepare("SELECT id FROM equipment_occupancy WHERE equipment_id=? AND status<>'已释放'").get(old.id)) fail(409,'EQUIPMENT_RESERVED','设备仍有有效预留或使用，不能直接改变固定诊椅');
      const values={name:text(input.name,'设备名称',80),equipment_type:text(input.equipmentType,'设备类别',80),dental_chair_id:chairId,status,status_reason:reason};
      const key=old?old.id:insert(this.db,'clinical_equipment',fact(now,values));
      if(old)this.db.prepare('UPDATE clinical_equipment SET name=?,equipment_type=?,dental_chair_id=?,status=?,status_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(...Object.values(values),now,key);
      return {kind:'clinical_equipment',key,revision:old?old.revision+1:1,beforeRevision:old?.revision,reason};
    });
  }
  block(credentials,input) {
    return this.unit.command(credentials,'resources.manage',input,(ctx,now)=>{
      if(input.action==='block') {
        const chairId=input.chairId==null?null:id(input.chairId,'诊椅'), equipmentId=input.equipmentId==null?null:id(input.equipmentId,'设备');
        if((chairId!==null)===(equipmentId!==null))fail(422,'RESOURCE_TARGET','每次停用选择诊椅或设备之一');
        row(this.db,chairId?'dental_chair':'clinical_equipment',chairId||equipmentId);
        const start=instant(input.startsAt||now,'停用开始'),end=input.endsAt?instant(input.endsAt,'预计结束'):null;
        if(end && end<=start)fail(422,'INVALID_INTERVAL','预计结束须晚于开始时间');
        const reason=text(input.reason,'清洁、准备、故障或维护依据');
        const key=insert(this.db,'resource_block',fact(now,{dental_chair_id:chairId,equipment_id:equipmentId,starts_at:start,ends_at:end,reason,released_at:null,status:'生效中',operator_id:ctx.session.staff_id}));
        return {kind:'resource_block',key,revision:1,reason};
      }
      if(input.action!=='restore')fail(422,'INVALID_ACTION','资源操作无效');
      const block=row(this.db,'resource_block',input.blockId);revision(block,input.expectedRevision);
      if(block.status!=='生效中')fail(409,'RESOURCE_ALREADY_RESTORED','该停用已经解除');
      if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','请核实清洁准备或维护条件已经满足');
      const reason=text(input.verificationNote,'实际恢复核验依据');
      if(now<block.starts_at)fail(409,'BLOCK_NOT_STARTED','尚未开始的停用不能以已完成核验解除，请核对维护安排');
      const busy=block.dental_chair_id?this.db.prepare(`SELECT o.id FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id
        JOIN visit v ON v.id=o.visit_id WHERE s.dental_chair_id=? AND o.released_at IS NULL AND v.started_at IS NOT NULL`).get(block.dental_chair_id):
        this.db.prepare("SELECT id FROM equipment_occupancy WHERE equipment_id=? AND status='使用中'").get(block.equipment_id);
      if(busy)fail(409,'RESOURCE_STILL_IN_USE','实际使用尚未结束，不能确认资源恢复');
      this.db.prepare("UPDATE resource_block SET status='已解除',released_at=?,operator_id=?,updated_at=?,revision=revision+1 WHERE id=?").run(now,ctx.session.staff_id,now,block.id);
      return {kind:'resource_block',key:block.id,revision:block.revision+1,beforeRevision:block.revision,reason};
    });
  }
  finish(credentials,input) {
    return this.unit.command(credentials,'resources.finish',input,(ctx,now)=>{
      const visit=this.clinical.scope(ctx,input.visitId,'physicalEnd');
      revision(visit,input.expectedVisitRevision);
      if(!visit.started_at)fail(409,'VISIT_NOT_STARTED','未实际开始接诊，不能记录实际操作结束');
      if(input.confirmed!==true)fail(422,'CONFIRMATION_REQUIRED','请确认患者已经结束实际操作并交接诊椅清洁');
      const end=instant(input.endedAt,'实际操作结束');
      if(end<visit.started_at||end>now)fail(422,'INVALID_END_TIME','实际结束应已发生，且不早于开始接诊');
      const last=this.db.prepare('SELECT max(completed_at) at FROM treatment_execution WHERE visit_id=?').get(visit.id).at;
      if(last && end<last)fail(409,'TREATMENT_AFTER_END','结束时间早于已记录的实际治疗，请重新核对');
      const o=this.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').get(visit.id);
      if(!o)fail(409,'OPERATION_ALREADY_FINISHED','实际操作已经交接结束，请查原办理结果');
      revision(o,input.expectedOccupancyRevision);
      const schedule=row(this.db,'dated_schedule',o.dated_schedule_id),reason=text(input.reason,'实际结束及交接依据');
      this.db.prepare('UPDATE resource_occupancy SET released_at=?,released_by=?,release_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(end,ctx.session.staff_id,PHYSICAL_END,now,o.id);
      this.db.prepare("UPDATE equipment_occupancy SET status='已释放',actual_ended_at=?,release_reason=?,updated_at=?,revision=revision+1 WHERE visit_id=? AND status='使用中'").run(end,reason,now,visit.id);
      const key=insert(this.db,'resource_block',fact(now,{dental_chair_id:schedule.dental_chair_id,equipment_id:null,starts_at:end,ends_at:null,
        reason:'诊后清洁与准备待核验：'+visit.record_no,released_at:null,status:'生效中',operator_id:ctx.session.staff_id}));
      ctx.authority.visitId=visit.id;ctx.authority.occupancyId=o.id;
      return {kind:'resource_block',key,revision:1,reason,relatedChanges:[{kind:'resource_occupancy',key:o.id,beforeRevision:o.revision,revision:o.revision+1,reason:PHYSICAL_END}]};
    });
  }
  query(credentials,input={}) {
    return this.unit.query(credentials,'resources.query',ctx=>{
      const now=this.unit.auth.now(),date=dateOnly(input.date||day(now)),end=utc(Date.parse(date+'T00:00:00+08:00')+86400000),start=utc(date+'T00:00:00+08:00');
      const blocks=this.db.prepare(`SELECT * FROM resource_block WHERE (status='生效中' AND starts_at<?) OR (released_at>=? AND starts_at<?) ORDER BY id DESC`).all(end,start,end);
      const occupancies=this.db.prepare(`SELECT o.id,o.revision,o.visit_id,o.appointment_id,o.starts_at,o.ends_at,o.released_at,o.release_reason,
        s.dental_chair_id,s.dentist_id,v.status visit_status,v.started_at,v.revision visit_revision,v.record_no visit_no
        FROM resource_occupancy o JOIN dated_schedule s ON s.id=o.dated_schedule_id LEFT JOIN visit v ON v.id=o.visit_id
        WHERE (o.starts_at<? AND o.ends_at>?) OR (o.released_at IS NULL AND v.started_at IS NOT NULL) ORDER BY o.starts_at,o.id`).all(end,start);
      const equipmentOccupancies=this.db.prepare(`SELECT * FROM equipment_occupancy WHERE (starts_at<? AND ends_at>?) OR status='使用中' ORDER BY id`).all(end,start);
      const chairs=this.db.prepare('SELECT id,name,revision FROM dental_chair ORDER BY id').all();
      for(const c of chairs){c.busy=occupancies.some(o=>o.dental_chair_id===c.id&&o.started_at&&!o.released_at);c.blocked=blocks.some(b=>b.dental_chair_id===c.id&&b.status==='生效中'&&b.starts_at<=now);}
      return {businessDate:date,now,chairs,equipment:this.db.prepare('SELECT * FROM clinical_equipment ORDER BY id').all(),blocks,
        occupancies:occupancies.map(o=>({...o,canFinish:ctx.authority.role==='dentist'&&o.dentist_id===ctx.session.staff_id&&!!o.started_at&&!o.released_at})),equipmentOccupancies};
    });
  }
}
module.exports={Resources};
