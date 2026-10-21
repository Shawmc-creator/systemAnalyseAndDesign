'use strict';
const { fail, text, id, instant, dateOnly, day, utc, insert, fact, recordNo, row, revision } = require('./common');
const PATIENT_FIELDS = ['name', 'birth_date', 'phone', 'phone_owner', 'address', 'contact_preference', 'contact_unavailable_reason'];
const { equipmentIds,assertReady,reserveEquipment,releaseReservations }=require('./resource-rules');
class Reception {
  constructor(db, unit) { this.db = db; this.unit = unit; }
  personFields(fields, now) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(k => !PATIENT_FIELDS.includes(k))) fail(422, 'INVALID_FIELDS', '仅允许维护患者身份和联系资料');
    const values = {};
    for (const [key, value] of Object.entries(fields)) values[key] = value === null || value === '' ? null : text(value, key, key === 'name' ? 80 : 500);
    if (Object.hasOwn(values, 'name') && !values.name) fail(422, 'INVALID_INPUT', '患者姓名不能为空');
    if (values.birth_date) { dateOnly(values.birth_date, '出生日期'); if (values.birth_date > day(now)) fail(422, 'INVALID_INPUT', '出生日期不能晚于今天'); }
    return values;
  }
  patient(credentials, input) {
    return this.unit.command(credentials, 'uc08.maintain', input, (ctx, now) => {
      const fields = this.personFields(input.fields, now), old = input.patientId ? row(this.db, 'patient', input.patientId) : null;
      if (old) revision(old, input.expectedRevision);
      const merged = { ...old, ...fields };
      text(merged.name, '患者姓名', 80);
      if (merged.phone) text(merged.phone_owner, '联系电话归属');
      else text(merged.contact_unavailable_reason, '无法联系原因');
      const reason = text(input.reason, old ? '资料变更原因' : '建档依据');
      let patientId, changes = [];
      if (!old) {
        patientId = insert(this.db, 'patient', fact(now, { ...Object.fromEntries(PATIENT_FIELDS.map(k => [k, merged[k] || null])), created_by: ctx.session.staff_id, record_no: recordNo('P') }));
        changes = Object.entries(fields).map(([field, after]) => ({ field, before: null, after }));
      } else {
        patientId = old.id;
        changes = Object.entries(fields).filter(([key, value]) => value !== old[key]).map(([field, after]) => ({ field, before: old[field], after }));
        if (changes.length) {
          this.db.prepare(`UPDATE patient SET ${changes.map(c => '"' + c.field + '"=?').join(',')},updated_at=?,revision=revision+1 WHERE id=? AND revision=?`).run(...changes.map(c => c.after), now, old.id, old.revision);
          for (const c of changes) insert(this.db, 'patient_change', fact(now, { patient_id: old.id, old_value: c.before, new_value: c.after, reason, occurred_at: now, field_name: c.field, operator_id: ctx.session.staff_id }));
        }
      }
      if (input.proxy) {
        const p = input.proxy, from = instant(p.validFrom, '代理生效时间'), until = p.validUntil ? instant(p.validUntil, '代理截止时间') : null;
        if (until && until <= from) fail(422, 'INVALID_INPUT', '代理截止时间必须晚于生效时间');
        insert(this.db, 'patient_proxy', fact(now, { patient_id: patientId, proxy_name: text(p.name, '代理人'), relationship: text(p.relationship, '关系'),
          scope: text(p.scope, '具体代办范围'), valid_from: from, valid_until: until, verification_basis: text(p.basis, '代理核实依据'), verified_by: ctx.session.staff_id }));
      }
      return { kind: 'patient', key: patientId, revision: row(this.db, 'patient', patientId).revision, beforeRevision: old?.revision, reason, changes };
    });
  }
  dentistAvailable(dentistId, start, end) {
    const qualified = this.db.prepare(`SELECT s.id FROM staff s JOIN staff_role_qualification q ON q.staff_id=s.id
      JOIN access_role r ON r.id=q.role_id WHERE s.id=? AND r.code='dentist' AND s.employed_from<=?
      AND (s.employed_until IS NULL OR s.employed_until>=?) AND q.valid_from<=?
      AND (q.valid_until IS NULL OR q.valid_until>=?) AND (q.revoked_at IS NULL OR q.revoked_at>=?)`).get(dentistId, day(start), day(end), start, end, end);
    if (!qualified) fail(409, 'DENTIST_UNAVAILABLE', '牙医在该时段不具备有效在岗资格');
  }
  checkSchedule(scheduleId, expected, start, end, checkResources = true) {
    const s = row(this.db, 'dated_schedule', scheduleId); revision(s, expected);
    if (s.status !== '已确认' || start < s.starts_at || end > s.ends_at || start >= end) fail(409, 'SCHEDULE_CHANGED', '时段不在当前已确认排班内');
    this.dentistAvailable(s.dentist_id, start, end);
    const chair = row(this.db, 'dental_chair', s.dental_chair_id);
    if (chair.available_from > start || (chair.available_until && chair.available_until < end)) fail(409, 'CHAIR_UNAVAILABLE', '诊椅在该时段不可用');
    if(checkResources)assertReady(this.db,s.dental_chair_id,[],end);
    return s;
  }
  schedule(credentials, input) {
    return this.unit.command(credentials, 'uc15.schedule', input, (ctx, now) => {
      const action = input.action;
      if (!['publish', 'change', 'close'].includes(action)) fail(422, 'INVALID_ACTION', '排班操作无效');
      const old = action === 'publish' ? null : row(this.db, 'dated_schedule', input.scheduleId);
      if (old) { revision(old, input.expectedRevision); if (old.status !== '已确认') fail(409, 'INVALID_STATE', '该安排不能再次调整'); }
      const start = action === 'close' ? old.starts_at : instant(input.startsAt, '排班开始');
      const end = action === 'close' ? old.ends_at : instant(input.endsAt, '排班结束');
      const dentist = action === 'close' ? old.dentist_id : id(input.dentistId, '牙医');
      const chairId = action === 'close' ? old.dental_chair_id : id(input.chairId, '诊椅');
      const businessDate = action === 'close' ? old.business_date : dateOnly(input.businessDate);
      if (end <= start || day(start) !== businessDate || day(end) !== businessDate) fail(422, 'INVALID_INPUT', '排班起止应在同一营业日期内');
      if (action !== 'close') {
        if (end <= now) fail(422, 'PAST_SCHEDULE', '不能发布已经结束的排班');
        this.dentistAvailable(dentist, start, end);
        const chair = row(this.db, 'dental_chair', chairId);
        if (chair.available_from > start || (chair.available_until && chair.available_until < end)) fail(409, 'CHAIR_UNAVAILABLE', '诊椅在排班时段不可用');
      }
      const reason = text(input.reason, '排班依据');
      const values = { dentist_id: dentist, dental_chair_id: chairId, business_date: businessDate, starts_at: start, ends_at: end,
        confirmed_at: now, confirmed_by: ctx.session.staff_id, status: action === 'close' ? '已停诊' : '已确认', closure_reason: action === 'close' ? reason : null };
      let key;
      if (!old) key = insert(this.db, 'dated_schedule', fact(now, { ...values, created_by: ctx.session.staff_id }));
      else {
        const occupied = this.db.prepare(`SELECT o.id,a.record_no,o.visit_id FROM resource_occupancy o LEFT JOIN appointment a ON a.id=o.appointment_id WHERE o.dated_schedule_id=? AND o.released_at IS NULL`).all(old.id);
        if (occupied.length) fail(409, 'ACTIVE_OCCUPANCY', '请先逐项改约、取消或完成在诊占用，再提交排班变更', { affected: occupied });
        this.db.prepare(`UPDATE dated_schedule SET dentist_id=?,dental_chair_id=?,business_date=?,starts_at=?,ends_at=?,confirmed_at=?,confirmed_by=?,status=?,closure_reason=?,updated_at=?,revision=revision+1 WHERE id=?`).run(...Object.values(values), now, old.id);
        insert(this.db, 'schedule_change', fact(now, { dated_schedule_id: old.id, old_business_date: old.business_date, old_starts_at: old.starts_at, old_ends_at: old.ends_at,
          new_business_date: businessDate, new_starts_at: start, new_ends_at: end, reason, occurred_at: now, change_kind: action === 'close' ? '停诊' : '调整', affected_handling: '已核对无有效预约及在诊占用',
          operator_id: ctx.session.staff_id, old_dentist_id: old.dentist_id, new_dentist_id: dentist, old_chair_id: old.dental_chair_id, new_chair_id: chairId }));
        key = old.id;
      }
      return { kind: 'dated_schedule', key, revision: old ? old.revision + 1 : 1, beforeRevision: old?.revision, reason };
    });
  }
  occupy(schedule, input, ctx, now, appointmentId, visitId = null) {
    return insert(this.db, 'resource_occupancy', fact(now, { dated_schedule_id: schedule.id, appointment_id: appointmentId, visit_id: visitId,
      starts_at: input.start, ends_at: input.end, released_at: null, arrangement_revision: schedule.revision,
      release_reason: null, created_by: ctx.session.staff_id, released_by: null }));
  }
  release(occupancy, ctx, now, reason) {
    this.db.prepare('UPDATE resource_occupancy SET released_at=?,released_by=?,release_reason=?,updated_at=?,revision=revision+1 WHERE id=? AND released_at IS NULL').run(now, ctx.session.staff_id, reason, now, occupancy.id);
  }
  restoreFollowups(appointmentId, now) {
    // Only restore requirements whose latest linked contact points at this appointment.
    const affected = this.db.prepare(`SELECT * FROM followup_requirement WHERE status='待到诊或评估'
      AND id IN (SELECT c.followup_requirement_id FROM contact_history c WHERE c.appointment_id=?
      AND NOT EXISTS (SELECT 1 FROM contact_history n WHERE n.followup_requirement_id=c.followup_requirement_id AND (n.contacted_at>c.contacted_at OR (n.contacted_at=c.contacted_at AND n.id>c.id))))`).all(appointmentId);
    for (const f of affected) this.db.prepare("UPDATE followup_requirement SET status='待联系',next_contact_date=?,updated_at=?,revision=revision+1 WHERE id=?").run(day(now), now, f.id);
    return affected.map(f => ({ kind: 'followup_requirement', key: f.id, beforeRevision: f.revision, revision: f.revision + 1,
      code: 'FOLLOWUP_CONTACT_RESTORED', reason: '复诊预约取消或未到，恢复原责任人的待联系事项，保留联系和预约历史',
      changes: [{ field: 'status', before: f.status, after: '待联系' }, { field: 'next_contact_date', before: f.next_contact_date, after: day(now) }] }));
  }
  appointment(credentials, input) {
    return this.unit.command(credentials, 'uc01.maintain', input, (ctx, now) => {
      const action = input.action;
      if (!['create', 'reschedule', 'cancel', 'noShow', 'notify'].includes(action)) fail(422, 'INVALID_ACTION', '预约操作无效');
      if (action === 'create') {
        row(this.db, 'patient', input.patientId);
        const start = instant(input.startsAt, '预约开始'), end = instant(input.endsAt, '预约结束');
        if (start <= now) fail(422, 'PAST_APPOINTMENT', '预约开始必须晚于当前时间');
        const schedule = this.checkSchedule(input.scheduleId, input.scheduleRevision, start, end);
        const key = insert(this.db, 'appointment', fact(now, { patient_id: input.patientId, planned_start: start, planned_end: end,
          reason: text(input.reason, '就诊目的'), due_at: end, arrangement_revision: 1, status_reason: null, notified_at: null,
          created_by: ctx.session.staff_id, notified_by: null, status: '已预约', record_no: recordNo('A') }));
        this.occupy(schedule, { start, end }, ctx, now, key);
        reserveEquipment(this.db,schedule.dental_chair_id,equipmentIds(input.equipmentIds),start,end,now,key);
        return { kind: 'appointment', key, revision: 1 };
      }
      const old = row(this.db, 'appointment', input.appointmentId); revision(old, input.expectedRevision);
      if (old.status !== '已预约') fail(409, 'INVALID_STATE', '只有尚未到诊的有效预约可以办理此操作');
      const occupancy = this.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(old.id);
      if (!occupancy) fail(409, 'OCCUPANCY_MISSING', '原预约占用缺失，需要负责人核对');
      const reason = text(input.reason, '办理依据');
      let start = null, end = null, schedule = null, arrangementRevision = old.arrangement_revision, relatedChanges = [];
      if (action === 'reschedule') {
        start = instant(input.startsAt, '新预约开始'); end = instant(input.endsAt, '新预约结束');
        if (start <= now) fail(422, 'PAST_APPOINTMENT', '新预约开始必须晚于当前时间');
        schedule = this.checkSchedule(input.scheduleId, input.scheduleRevision, start, end);
        const selected=input.equipmentIds===undefined?this.db.prepare("SELECT equipment_id FROM equipment_occupancy WHERE appointment_id=? AND status='已预留'").all(old.id).map(e=>e.equipment_id):equipmentIds(input.equipmentIds);
        releaseReservations(this.db,old.id,now,'改约释放原设备预留：'+reason);
        this.release(occupancy, ctx, now, reason);
        this.occupy(schedule, { start, end }, ctx, now, old.id);
        reserveEquipment(this.db,schedule.dental_chair_id,selected,start,end,now,old.id);
        arrangementRevision++;
        this.db.prepare('UPDATE appointment SET planned_start=?,planned_end=?,due_at=?,arrangement_revision=?,notified_at=NULL,notified_by=NULL,updated_at=?,revision=revision+1 WHERE id=?').run(start, end, end, arrangementRevision, now, old.id);
      } else if (action === 'notify') {
        this.db.prepare('UPDATE appointment SET notified_at=?,notified_by=?,updated_at=?,revision=revision+1 WHERE id=?').run(now, ctx.session.staff_id, now, old.id);
      } else {
        if (action === 'noShow' && now <= old.due_at) fail(409, 'NOT_DUE', '尚未超过预约截止时间，不能登记未到');
        this.release(occupancy, ctx, now, reason);
        releaseReservations(this.db,old.id,now,'预约取消或未到：'+reason);
        this.db.prepare('UPDATE appointment SET status=?,status_reason=?,updated_at=?,revision=revision+1 WHERE id=?').run(action === 'cancel' ? '已取消' : '未到', reason, now, old.id);
        relatedChanges = this.restoreFollowups(old.id, now);
      }
      // A no-show is a state fact, not a cancellation or an invented change_kind.
      // Its grounds remain in appointment.status_reason and the field-level audit.
      if (action !== 'noShow') insert(this.db, 'appointment_change', fact(now, { appointment_id: old.id, old_start: old.planned_start, old_end: old.planned_end, old_revision: old.arrangement_revision,
        new_start: start, new_end: end, new_revision: arrangementRevision, reason, occurred_at: now,
        change_kind: { reschedule: '改约', cancel: '取消', noShow: '未到', notify: '通知' }[action], operator_id: ctx.session.staff_id,
        old_schedule_id: occupancy.dated_schedule_id, new_schedule_id: schedule?.id || (action === 'notify' ? occupancy.dated_schedule_id : null) }));
      return { kind: 'appointment', key: old.id, revision: old.revision + 1, beforeRevision: old.revision, reason,
        relatedChanges,
        changes: action === 'noShow' ? [{ field: 'status', before: old.status, after: '未到' }, { field: 'status_reason', before: old.status_reason, after: reason }] : [] };
    });
  }
  arrive(credentials, input) {
    return this.unit.command(credentials, 'uc03.register', input, (ctx, now) => {
      const patient = row(this.db, 'patient', input.patientId), appointment = input.appointmentId ? row(this.db, 'appointment', input.appointmentId) : null;
      const arrived = instant(input.arrivedAt, '实际到诊时间');
      if (day(arrived) !== day(now) || arrived > now) fail(422, 'ARRIVAL_DATE', '仅能登记当日已经实际发生的到诊');
      let schedule, occupancy;
      if (appointment) {
        if (appointment.patient_id !== patient.id) fail(409, 'PATIENT_MISMATCH', '患者与预约不一致');
        const existing = this.db.prepare('SELECT id FROM visit WHERE appointment_id=?').get(appointment.id);
        if (existing) fail(409, 'ALREADY_ARRIVED', '该预约已经登记到诊', { visitId: existing.id });
        revision(appointment, input.expectedRevision);
        if (appointment.status !== '已预约' || day(appointment.planned_start) !== day(now)) fail(409, 'INVALID_STATE', '只能登记当日有效预约到诊');
        occupancy = this.db.prepare('SELECT * FROM resource_occupancy WHERE appointment_id=? AND released_at IS NULL').get(appointment.id);
        if (!occupancy) fail(409, 'OCCUPANCY_MISSING', '预约占用缺失');
        revision(occupancy, input.occupancyRevision);
        // Real arrival is recorded even if a resource fault has just occurred.
        schedule = this.checkSchedule(occupancy.dated_schedule_id, input.scheduleRevision, occupancy.starts_at, occupancy.ends_at, false);
      } else {
        const start = instant(input.startsAt, '现场接诊开始'), end = instant(input.endsAt, '现场接诊结束');
        if (day(start) !== day(now) || end <= arrived || start < arrived) fail(422, 'INVALID_INPUT', '现场接诊时段需在当日到诊后');
        schedule = this.checkSchedule(input.scheduleId, input.scheduleRevision, start, end);
      }
      if (input.dentistId !== schedule.dentist_id) fail(409, 'DENTIST_MISMATCH', '接诊牙医与当前安排不一致');
      const key = insert(this.db, 'visit', fact(now, { patient_id: patient.id, appointment_id: appointment?.id || null,
        dentist_id: schedule.dentist_id, arrived_at: arrived, started_at: null, ended_at: null,
        arrival_source: appointment ? '预约' : '现场', registered_by: ctx.session.staff_id, status: '候诊', record_no: recordNo('V') }));
      if (appointment) {
        this.db.prepare('UPDATE resource_occupancy SET visit_id=?,updated_at=?,revision=revision+1 WHERE id=?').run(key, now, occupancy.id);
        this.db.prepare("UPDATE equipment_occupancy SET visit_id=?,updated_at=?,revision=revision+1 WHERE appointment_id=? AND status='已预留'").run(key,now,appointment.id);
        this.db.prepare("UPDATE appointment SET status='已到诊',updated_at=?,revision=revision+1 WHERE id=?").run(now, appointment.id);
      } else {
        const start=instant(input.startsAt,'现场开始'),end=instant(input.endsAt,'现场结束');
        this.occupy(schedule,{start,end},ctx,now,null,key);
        reserveEquipment(this.db,schedule.dental_chair_id,equipmentIds(input.equipmentIds),start,end,now,null,key);
      }
      insert(this.db, 'clinical_record', fact(now, { visit_id: key, status: '草稿', record_no: recordNo('C') }));
      return { kind: 'visit', key, revision: 1 };
    });
  }
  recoordinate(credentials,input) {
    return this.unit.command(credentials,'uc03.register',input,(ctx,now)=>{
      const visit=row(this.db,'visit',input.visitId);revision(visit,input.expectedVisitRevision);
      if(visit.patient_id!==id(input.patientId,'患者'))fail(409,'PATIENT_MISMATCH','请重新核对本次就诊的患者身份');
      if(visit.status!=='候诊'||visit.started_at)fail(409,'VISIT_ALREADY_STARTED','只能重新安排尚未实际开始接诊的候诊记录');
      if(day(visit.arrived_at)!==day(now))fail(409,'WAITING_DATE','请核对当日候诊记录，跨日应重新受理到诊');
      if(input.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请先核对患者和新的接诊安排');
      const oldRows=this.db.prepare('SELECT * FROM resource_occupancy WHERE visit_id=? AND released_at IS NULL').all(visit.id);
      if(oldRows.length!==1)fail(409,'OCCUPANCY_MISSING','候诊占用缺失或不唯一，请由负责人核对');
      const old=oldRows[0];revision(old,input.expectedOccupancyRevision);
      const start=instant(input.startsAt,'新的接诊开始'),end=instant(input.endsAt,'新的接诊结束');
      if(day(start)!==day(now)||day(end)!==day(now)||start<visit.arrived_at||end<=now)fail(422,'WAITING_INTERVAL','新的候诊安排须为当日到诊后的有效时段，且尚未结束');
      const schedule=this.checkSchedule(input.scheduleId,input.scheduleRevision,start,end),reason=text(input.reason,'重新安排依据');
      const equipment=this.db.prepare("SELECT * FROM equipment_occupancy WHERE visit_id=? AND status<>'已释放'").all(visit.id);
      if(equipment.some(e=>e.status==='使用中'))fail(409,'EQUIPMENT_IN_USE','必要设备已实际使用，不能按候诊安排释放');
      const selected=input.equipmentIds===undefined?equipment.map(e=>e.equipment_id):equipmentIds(input.equipmentIds);
      this.release(old,ctx,now,'候诊重新安排：'+reason);
      this.db.prepare("UPDATE equipment_occupancy SET status='已释放',release_reason=?,updated_at=?,revision=revision+1 WHERE visit_id=? AND status='已预留'").run('候诊重新安排：'+reason,now,visit.id);
      const occupancyId=this.occupy(schedule,{start,end},ctx,now,visit.appointment_id,visit.id);
      reserveEquipment(this.db,schedule.dental_chair_id,selected,start,end,now,visit.appointment_id,visit.id);
      this.db.prepare('UPDATE visit SET dentist_id=?,updated_at=?,revision=revision+1 WHERE id=?').run(schedule.dentist_id,now,visit.id);
      const relatedChanges=[];
      if(visit.appointment_id){
        const a=row(this.db,'appointment',visit.appointment_id);
        if(a.status!=='已到诊')fail(409,'INVALID_STATE','本次就诊与原预约的到诊状态不一致');
        this.db.prepare('UPDATE appointment SET planned_start=?,planned_end=?,due_at=?,arrangement_revision=arrangement_revision+1,notified_at=NULL,notified_by=NULL,updated_at=?,revision=revision+1 WHERE id=?').run(start,end,end,now,a.id);
        insert(this.db,'appointment_change',fact(now,{appointment_id:a.id,old_start:a.planned_start,old_end:a.planned_end,old_revision:a.arrangement_revision,new_start:start,new_end:end,new_revision:a.arrangement_revision+1,reason:'到诊后候诊重新安排：'+reason,occurred_at:now,change_kind:'改约',operator_id:ctx.session.staff_id,old_schedule_id:old.dated_schedule_id,new_schedule_id:schedule.id}));
        relatedChanges.push({kind:'appointment',key:a.id,beforeRevision:a.revision,revision:a.revision+1,reason:'保留已到诊状态，更新候诊安排并保留原安排历史'});
      }
      Object.assign(ctx.authority,{visitId:visit.id,patientId:visit.patient_id,oldOccupancyId:old.id,newOccupancyId:occupancyId,equipmentIds:selected});
      return {kind:'visit',key:visit.id,beforeRevision:visit.revision,revision:visit.revision+1,reason,relatedChanges,
        changes:[{field:'dentist_id',before:visit.dentist_id,after:schedule.dentist_id},{field:'dated_schedule_id',before:old.dated_schedule_id,after:schedule.id},{field:'planned_start',before:old.starts_at,after:start},{field:'planned_end',before:old.ends_at,after:end}]};
    });
  }
  waiting(credentials){
    return this.unit.query(credentials,'uc03.register',()=>{
      const date=day(this.unit.auth.now()),start=utc(date+'T00:00:00+08:00');
      const items=this.db.prepare(`SELECT v.*,p.name patient_name,p.record_no patient_no,d.name dentist_name,
        o.id occupancy_id,o.revision occupancy_revision,o.starts_at,o.ends_at,s.id schedule_id,s.revision schedule_revision,c.name chair_name
        FROM visit v JOIN patient p ON p.id=v.patient_id JOIN staff d ON d.id=v.dentist_id
        LEFT JOIN resource_occupancy o ON o.visit_id=v.id AND o.released_at IS NULL
        LEFT JOIN dated_schedule s ON s.id=o.dated_schedule_id LEFT JOIN dental_chair c ON c.id=s.dental_chair_id
        WHERE v.arrived_at>=? AND v.arrived_at<? ORDER BY v.arrived_at,v.id`).all(start,utc(Date.parse(start)+86400000));
      return {items:items.map(v=>({...v,equipmentIds:this.db.prepare("SELECT equipment_id FROM equipment_occupancy WHERE visit_id=? AND status<>'已释放'").all(v.id).map(e=>e.equipment_id)}))};
    });
  }
  list(credentials, filters = {}) {
    return this.unit.query(credentials, 'uc02.query', () => {
      const from = dateOnly(filters.from || day(this.unit.auth.now())), to = dateOnly(filters.to || from);
      if (to < from || Date.parse(to) - Date.parse(from) > 31 * 86400_000) fail(422, 'INVALID_INPUT', '查询日期范围最多31天');
      const cursor = filters.cursor === undefined ? 0 : Number(filters.cursor);
      if (!Number.isSafeInteger(cursor) || cursor < 0) fail(422, 'INVALID_INPUT', '分页游标无效');
      const patientId = filters.patientId === undefined ? null : id(Number(filters.patientId), '患者');
      const rows = this.db.prepare(`SELECT a.*,p.name patient_name,p.record_no patient_no,o.id occupancy_id,o.revision occupancy_revision,
        s.id schedule_id,s.revision schedule_revision,s.status schedule_status,s.dentist_id,s.dental_chair_id,d.name dentist_name,c.name chair_name,v.id visit_id
        FROM appointment a JOIN patient p ON p.id=a.patient_id LEFT JOIN resource_occupancy o ON o.appointment_id=a.id AND o.released_at IS NULL
        LEFT JOIN dated_schedule s ON s.id=o.dated_schedule_id LEFT JOIN staff d ON d.id=s.dentist_id LEFT JOIN dental_chair c ON c.id=s.dental_chair_id
        LEFT JOIN visit v ON v.appointment_id=a.id WHERE a.planned_start>=? AND a.planned_start<? AND a.id>?
        AND (? IS NULL OR a.patient_id=?) ORDER BY a.id LIMIT 101`).all(utc(from + 'T00:00:00+08:00'), utc(Date.parse(to + 'T00:00:00+08:00') + 86400_000), cursor, patientId, patientId);
      const history = rows.slice(0, 100).map(a => ({ ...a,equipmentIds:this.db.prepare("SELECT equipment_id FROM equipment_occupancy WHERE appointment_id=? AND status<>'已释放'").all(a.id).map(e=>e.equipment_id), history: this.db.prepare('SELECT * FROM appointment_change WHERE appointment_id=? ORDER BY id').all(a.id) }));
      return { items: history, nextCursor: rows.length > 100 ? history.at(-1).id : null };
    });
  }
}
module.exports = { Reception };
