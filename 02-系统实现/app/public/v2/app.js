'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const state = { user: null, csrf: '', role: '', page: 'appointments', date: '', patients: [], schedules: [], appointments: [], options: {}, status: null, cursor: null };
const pending = new Map();
let renderVersion = 0;
const localDateTime = iso => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).replace(' ', 'T');
const time = value => value ? localDateTime(value).slice(11) : '—';
const stamp = local => local.length === 16 ? local + ':00+08:00' : local.length===19?local+'+08:00':local;
const localDateTimeSeconds=iso=>localDateTime(iso)+':'+String(new Date(iso).getUTCSeconds()).padStart(2,'0');
function notice(message, error = false) { $('#notice').hidden = false; $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
async function api(path, { method = 'GET', body } = {}) {
  let response;
  try { response = await fetch('/api/v2' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Clinic-Role': state.role, 'X-CSRF-Token': state.csrf }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { const error = new Error('连接中断，请保留本次提交并核实结果后重试'); error.unknown = true; throw error; }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message); Object.assign(error, { status: response.status, code: result.code, details: result.details, unknown: response.status >= 500 });
    if (response.status === 401 && state.user) { state.user = null; $('#workspace').hidden = true; $('#login-view').hidden = false; $('#login-error').textContent = result.message; $('#editor').close(); }
    throw error;
  }
  return result;
}
function showReceipt(result) {
  $('#notice').hidden=true;
  const box = $('#receipt'); box.hidden = false;
  const kind = { patient: '患者档案', dated_schedule: '日期排班', appointment: '预约', visit: '就诊',clinical_equipment:'诊疗设备',resource_block:'资源准备或停用' }[result.kind] || '办理记录';
  box.textContent = `${result.replayed ? '已核实原提交，未重复办理。' : '办理成功。'} ${kind} #${result.id}。提交号：${result.requestKey}`;
}
async function command(path, values, scope) {
  const signature = JSON.stringify(values), old = pending.get(scope);
  if (old && old.signature !== signature) throw new Error('上一次提交结果待核实，请先恢复原内容并重试，或使用“核实上次提交”');
  const entry = old || { signature, body: { ...values, requestKey: crypto.randomUUID(), commandVersion: 1 } };
  pending.set(scope, entry);
  try { const result = await api(path, { method: 'POST', body: entry.body }); pending.delete(scope); showReceipt(result); return result; }
  catch (error) { if (!error.unknown) pending.delete(scope); $('#verify-last').hidden = !pending.size; throw error; }
}
function openEditor(title, html, submit) {
  $('#dialog-title').textContent = title; $('#dialog-fields').innerHTML = html; $('#form-error').textContent = ''; $('#verify-last').hidden = !pending.size;
  $('#edit-form').onsubmit = async event => {
    event.preventDefault(); const button = $('#edit-form button[type=submit]'); button.disabled = true; $('#form-error').textContent='';
    try { const form=new FormData(event.currentTarget),values=Object.fromEntries(form);
      if(event.currentTarget.querySelector('[name=equipmentIds]'))values.equipmentIds=form.getAll('equipmentIds').map(Number);
      await submit(values); $('#editor').close(); await render(); }
    catch (error) { $('#form-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('#editor').showModal();
}
const input = (name, title, value = '', type = 'text', required = true) => `<label>${esc(title)}<input name="${name}" type="${type}" value="${esc(value)}" ${type==='datetime-local'?'step="1"':''} ${required ? 'required' : ''}></label>`;
const options = (items, label, selected) => items.map(x => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const select = (name, title, content,required=true) => `<label>${esc(title)}<select name="${name}" ${required?'required':''}>${content}</select></label>`;
const equipmentFields=(items,selected=[])=>items.length?`<fieldset class="full"><legend>本次必要设备（按实际需要选择）</legend>${items.map(e=>`<label><input type="checkbox" name="equipmentIds" value="${e.id}" ${selected.includes(e.id)?'checked':''}>${esc(e.name)} · ${esc(e.status)}</label>`).join('')}</fieldset>`:'';
function patientEditor(patient) {
  openEditor(patient ? '修改患者资料' : '建立患者档案', `<div class="form-grid">${input('name', '姓名', patient?.name)}${input('birth_date', '出生日期（未知可留空）', patient?.birth_date, 'date', false)}${input('phone', '联系电话', patient?.phone, 'tel', false)}${input('phone_owner', '电话归属（如本人、母亲）', patient?.phone_owner, 'text', false)}${input('contact_unavailable_reason', '无联系电话时填写原因', patient?.contact_unavailable_reason, 'text', false)}${input('contact_preference', '联系偏好', patient?.contact_preference, 'text', false)}${input('address', '联系地址', patient?.address, 'text', false)}${input('reason', patient ? '变更原因' : '建档依据', patient ? '' : '患者提供身份及联系资料')}</div>`, async data => {
    const { reason, ...fields } = data;
    await command('/patients/maintain', { ...(patient ? { patientId: patient.id, expectedRevision: patient.revision } : {}), fields, reason }, 'patient');
  });
}
async function bookingEditor(appointment) {
  const [patients, opts] = await Promise.all([api('/patients/candidates'), api('/reception/options?date=' + state.date)]);
  const schedules = opts.schedules.filter(s => s.status === '已确认');
  if (!patients.items.length) return notice('请先建立患者档案，再选择接诊时段');
  if (!schedules.length) return notice('该日期没有已确认排班，请联系负责人安排');
  openEditor(appointment ? '调整预约安排' : '新增预约', `<div class="context">所选日期：${esc(state.date)}。时段使用诊所当地时间。</div><div class="form-grid"><div class="full">${input('patientSearch', '查找患者（姓名或电话）', '', 'text', false)}<button type="button" id="search-booking-patient">查找候选</button>${select('patientId', '核对患者身份', '<option value="">请选择核实后的患者</option>' + options(patients.items, p => `${p.name} / ${p.phone || p.contact_unavailable_reason} / ${p.record_no}`, appointment?.patient_id))}</div><div class="full">${select('scheduleId', '已确认接诊安排', options(schedules, s => `${s.dentist_name} / ${s.chair_name} / ${time(s.starts_at)}—${time(s.ends_at)}`, appointment?.schedule_id))}</div>${input('startsAt', '接诊开始', appointment ? localDateTime(appointment.planned_start) : state.date + 'T10:00', 'datetime-local')}${input('endsAt', '接诊结束', appointment ? localDateTime(appointment.planned_end) : state.date + 'T10:30', 'datetime-local')}<div class="full">${input('reason', appointment ? '改约原因' : '此次就诊目的', appointment ? '' : '口腔检查')}</div></div>`, async data => {
    if (appointment && Number(data.patientId) !== appointment.patient_id) throw new Error('改约不能更换患者，请重新核对所选身份');
    const schedule = schedules.find(s => s.id === Number(data.scheduleId));
    await command('/appointments/maintain', { action: appointment ? 'reschedule' : 'create', ...(appointment ? { appointmentId: appointment.id, expectedRevision: appointment.revision } : { patientId: Number(data.patientId) }),
      scheduleId: schedule.id, scheduleRevision: schedule.revision, startsAt: stamp(data.startsAt), endsAt: stamp(data.endsAt),equipmentIds:data.equipmentIds||[], reason: data.reason }, 'appointment');
  });
  $('#dialog-fields .form-grid').insertAdjacentHTML('beforeend',equipmentFields(opts.equipment||[],appointment?.equipmentIds||[]));
  $('#search-booking-patient').onclick = async () => {
    try { const data = await api('/patients/candidates?q=' + encodeURIComponent($('#editor [name=patientSearch]').value)); $('#editor [name=patientId]').innerHTML = '<option value="">请选择核实后的患者</option>' + options(data.items, p => `${p.name} / ${p.phone || p.contact_unavailable_reason} / ${p.record_no}`); }
    catch (e) { $('#form-error').textContent = e.message; }
  };
}
function changeStatus(appointment, action) {
  const title = { cancel: '取消预约', noShow: '核实未到', notify: '记录实际通知' }[action];
  openEditor(title, `<div class="context">${esc(appointment.patient_name)} · ${time(appointment.planned_start)}<br>原预约和办理经历将保留。</div>${input('reason', action === 'notify' ? '实际通知方式及结果' : '核实及办理依据')}`, async data => {
    await command('/appointments/maintain', { action, appointmentId: appointment.id, expectedRevision: appointment.revision, reason: data.reason }, 'appointment');
  });
}
async function waitingEditor(visit){
  const [opts,status]=await Promise.all([api('/reception/options?date='+state.status.businessDate),api('/status')]);
  const schedules=opts.schedules.filter(s=>s.status==='已确认');if(!schedules.length)throw new Error('当日没有可选择的已确认排班，请联系负责人');
  openEditor('重新安排候诊',`<p>${esc(visit.patient_name)} · ${esc(visit.patient_no)}<br>实际到诊 ${esc(localDateTimeSeconds(visit.arrived_at))}，保留此次就诊及原安排历史。</p>${select('scheduleId','重新核对牙医与诊椅',options(schedules,s=>`${s.dentist_name} / ${s.chair_name} / ${time(s.starts_at)}—${time(s.ends_at)}`,visit.schedule_id))}${input('startsAt','新的接诊开始',localDateTimeSeconds(status.now),'datetime-local')}${input('endsAt','新的接诊结束',localDateTimeSeconds(Date.parse(status.now)+1800000),'datetime-local')}${equipmentFields(opts.equipment||[],visit.equipmentIds)}${input('reason','重新安排原因')}${clinicalConfirm('已核对患者、接诊牙医、时段及必要资源，并向患者说明新的安排')}`,async value=>{
    const schedule=schedules.find(s=>s.id===Number(value.scheduleId));
    await command('/visits/recoordinate',{visitId:visit.id,patientId:visit.patient_id,expectedVisitRevision:visit.revision,expectedOccupancyRevision:visit.occupancy_revision,scheduleId:schedule.id,scheduleRevision:schedule.revision,startsAt:stamp(value.startsAt),endsAt:stamp(value.endsAt),equipmentIds:value.equipmentIds||[],reason:value.reason,confirmed:value.confirmed==='on'},'waiting');
  });
}
async function arrivalEditor(appointment) {
  const opts = await api('/reception/options?date=' + state.status.businessDate);
  let patients = [];
  if (!appointment) patients = (await api('/patients/candidates')).items;
  const schedules = opts.schedules.filter(s => s.status === '已确认');
  if (!appointment && (!patients.length || !schedules.length)) return notice('现场到诊需要当日已确认排班和患者档案');
  openEditor(appointment ? '登记预约到诊' : '登记现场到诊', `<div class="context">请确认患者已经实际到院，再登记当日到诊。</div><div class="form-grid">${appointment ? `<div class="full">${esc(appointment.patient_name)} · ${esc(appointment.dentist_name)} · ${time(appointment.planned_start)}</div>` : `<div class="full">${select('patientId', '患者身份', options(patients, p => `${p.name} / ${p.phone || '无电话'} / ${p.record_no}`))}</div><div class="full">${select('scheduleId', '当日接诊安排', options(schedules, s => `${s.dentist_name} / ${s.chair_name} / ${time(s.starts_at)}—${time(s.ends_at)}`))}</div>`}${input('arrivedAt', '实际到诊时间', localDateTime(new Date()), 'datetime-local')}${appointment ? '' : input('startsAt', '现场接诊开始', localDateTime(new Date()), 'datetime-local')}${appointment ? '' : input('endsAt', '现场接诊结束', localDateTime(Date.now() + 30 * 60_000), 'datetime-local')}</div>`, async data => {
    const schedule = appointment ? opts.schedules.find(s => s.id === appointment.schedule_id) : schedules.find(s => s.id === Number(data.scheduleId));
    if (!schedule) throw new Error('日期安排已经变化，请刷新列表');
    await command('/visits/register', { patientId: appointment?.patient_id || Number(data.patientId), dentistId: schedule.dentist_id,
      scheduleId: schedule.id, scheduleRevision: schedule.revision, arrivedAt: stamp(data.arrivedAt), ...(appointment ? { appointmentId: appointment.id, expectedRevision: appointment.revision, occupancyRevision: appointment.occupancy_revision } : { startsAt: stamp(data.startsAt), endsAt: stamp(data.endsAt),equipmentIds:data.equipmentIds||[] }) }, 'arrival');
  });
  if(!appointment)$('#dialog-fields .form-grid').insertAdjacentHTML('beforeend',equipmentFields(opts.equipment||[]));
}
function scheduleEditor(schedule, action = 'publish') {
  const o = state.options;
  openEditor(action === 'close' ? '确认停诊' : schedule ? '调整日期排班' : '发布日期排班', action === 'close' ? `<div class="context">先处理该安排的预约及在诊占用。已有业务记录保留。</div>${input('reason', '停诊原因')}` : `<div class="form-grid">${input('businessDate', '营业日期', schedule?.business_date || state.date, 'date')}${select('dentistId', '牙医', options(o.dentists, x => x.name, schedule?.dentist_id))}${select('chairId', '诊椅', options(o.chairs, x => x.name, schedule?.dental_chair_id))}${input('startsAt', '开始时间', schedule ? localDateTime(schedule.starts_at) : state.date + 'T09:00', 'datetime-local')}${input('endsAt', '结束时间', schedule ? localDateTime(schedule.ends_at) : state.date + 'T18:00', 'datetime-local')}${input('reason', schedule ? '调整原因' : '排班依据')}</div>`, async data => {
    await command('/schedules/schedule', { action: schedule ? action === 'close' ? 'close' : 'change' : 'publish', ...(schedule ? { scheduleId: schedule.id, expectedRevision: schedule.revision } : {}),
      ...(action === 'close' ? {} : { dentistId: Number(data.dentistId), chairId: Number(data.chairId), businessDate: data.businessDate, startsAt: stamp(data.startsAt), endsAt: stamp(data.endsAt) }), reason: data.reason }, 'schedule');
  });
}
function table(heads, rows) { return `<div class="table-wrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
function empty(message) { return `<div class="empty">${message}</div>`; }
function filterDate() { $('#filters').innerHTML = `${input('date', '接诊日期', state.date, 'date')}<button id="refresh">查询</button>${state.status.demo ? '<button id="tomorrow">查看明日示例</button>' : ''}`; $('#filters input').id = 'filter-date'; }
function equipmentEditor(item,data) {
  openEditor(item?'维护设备':'登记诊疗设备',`${input('name','设备名称',item?.name)}${input('equipmentType','设备类别',item?.equipment_type)}${select('chairId','固定诊椅（共享设备请选择无）','<option value="shared">无，按需要共享</option>'+options(data.chairs,c=>c.name,item?.dental_chair_id))}${select('status','设备状态',options([{id:'可用',name:'可用'},{id:'停用',name:'停用'}],x=>x.name,item?.status||'可用'))}${input('reason','登记或变更依据')}`,async value=>{
    await command('/resources/equipment',{...value,chairId:value.chairId==='shared'?null:Number(value.chairId),...(item?{equipmentId:item.id,expectedRevision:item.revision}:{})},'equipment');
  });
}
function blockEditor(data) {
  const targets=[...data.chairs.map(c=>({id:'c:'+c.id,name:'诊椅：'+c.name})),...data.equipment.map(e=>({id:'e:'+e.id,name:'设备：'+e.name}))];
  openEditor('记录准备、清洁或停用',`${select('target','需要限制使用的资源',options(targets,x=>x.name))}${input('startsAt','开始时间',localDateTime(new Date()),'datetime-local')}${input('endsAt','预计结束（不确定可留空）','','datetime-local',false)}${input('reason','准备、故障或维护情况')}`,async value=>{
    const [kind,target]=value.target.split(':');
    await command('/resources/blocks',{action:'block',[kind==='c'?'chairId':'equipmentId']:Number(target),startsAt:stamp(value.startsAt),endsAt:value.endsAt?stamp(value.endsAt):null,reason:value.reason},'resource-block');
  });
}
function restoreEditor(block) {
  openEditor('核验并恢复接诊条件',`<p>${esc(block.reason)}</p>${input('verificationNote','实际完成的清洁、准备或维护核验')}<label><input name="confirmed" type="checkbox" required>已核实实际使用结束且恢复条件满足</label>`,async value=>{
    await command('/resources/blocks',{action:'restore',blockId:block.id,expectedRevision:block.revision,confirmed:value.confirmed==='on',verificationNote:value.verificationNote},'restore');
  });
}
function finishEditor(o) {
  openEditor('确认本次实际操作结束',`<p>就诊 ${esc(o.visit_no)}。确认结束后交由助理清洁核验，诊椅仍不会立即恢复可用。</p>${input('endedAt','实际操作结束时间',localDateTimeSeconds(new Date()),'datetime-local')}${input('reason','操作结束及交接依据')}<label><input name="confirmed" type="checkbox" required>已结束实际操作并交接清洁准备</label>`,async value=>{
    await command('/resources/finish',{visitId:o.visit_id,expectedVisitRevision:o.visit_revision,expectedOccupancyRevision:o.revision,endedAt:stamp(value.endedAt),reason:value.reason,confirmed:value.confirmed==='on'},'physical-end');
  });
}
async function renderResources(version) {
  const data=await api('/resources/query?date='+state.date);if(version!==renderVersion)return;
  const manage=['assistant','manager'].includes(state.role),name=b=>b.dental_chair_id?data.chairs.find(c=>c.id===b.dental_chair_id)?.name:data.equipment.find(e=>e.id===b.equipment_id)?.name;
  const equipmentAvailability=e=>{
    const current=data.equipmentOccupancies.some(o=>o.equipment_id===e.id&&o.status==='使用中');
    const blocked=data.blocks.some(b=>b.equipment_id===e.id&&b.status==='生效中'&&b.starts_at<=data.now);
    const reservations=data.equipmentOccupancies.filter(o=>o.equipment_id===e.id&&o.status==='已预留');
    return `资料状态：${esc(e.status)}<small>${current?'实际使用中':blocked?'准备或停用待核验':'无正在使用记录'}</small>${reservations.length?`<details><summary>设备预留 ${reservations.length}</summary>${reservations.map(o=>`<p>${time(o.starts_at)}—${time(o.ends_at)}</p>`).join('')}</details>`:''}`;
  };
  $('#page-actions').innerHTML=(manage?'<button id="new-block">记录准备 / 停用</button>':'')+(state.role==='manager'?'<button id="new-equipment" class="primary">登记设备</button>':'');
  filterDate();
  $('#content').innerHTML='<h2 class="subheading">诊椅当前状态</h2>'+table(['诊椅','实际使用','准备及停用'],data.chairs.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.busy?'实际使用未结束':'无正在使用记录'}</td><td>${c.blocked?'准备或停用中':'无生效限制'}</td></tr>`))+
    '<h2 class="subheading">必要设备</h2>'+(data.equipment.length?table(['设备','类别 / 固定诊椅','可用情况与预留','办理'],data.equipment.map(e=>`<tr><td>${esc(e.name)}<small>${esc(e.status_reason)}</small></td><td>${esc(e.equipment_type)}<small>${esc(data.chairs.find(c=>c.id===e.dental_chair_id)?.name||'共享')}</small></td><td>${equipmentAvailability(e)}</td><td>${state.role==='manager'?`<button data-equipment="${e.id}">维护设备</button>`:'按本次需要预留'}</td></tr>`)):empty('尚未登记设备，由负责人核实后建立资料。'))+
    '<h2 class="subheading">准备与停用记录</h2>'+(data.blocks.length?table(['资源','情况与开始','预计结束','当前结果','办理'],data.blocks.map(b=>`<tr><td>${esc(name(b))}</td><td>${esc(b.reason)}<small>${esc(localDateTime(b.starts_at))}</small></td><td>${b.ends_at?esc(localDateTime(b.ends_at)):'待核实'}<small>以实际核验为准</small></td><td>${esc(b.status)}</td><td>${manage&&b.status==='生效中'?`<button data-restore="${b.id}">核验恢复</button>`:'保留记录'}</td></tr>`)):empty('本日期范围内没有准备或停用记录。'))+
    '<h2 class="subheading">接诊预留与实际操作</h2>'+(data.occupancies.length?table(['诊椅 / 就诊','计划时段','实际情况','办理'],data.occupancies.map(o=>`<tr><td>${esc(data.chairs.find(c=>c.id===o.dental_chair_id)?.name)}<small>${esc(o.visit_no||'预约 #'+o.appointment_id)}</small></td><td>${time(o.starts_at)}—${time(o.ends_at)}</td><td>${o.released_at?esc(o.release_reason):o.started_at?'实际使用中，等待结束交接':'接诊预留 / 候诊'}</td><td>${o.canFinish?`<button data-finish="${o.id}">确认操作结束</button>`:'按实际状态交接'}</td></tr>`)):empty('该日期暂无接诊安排。'));
  if(manage)$('#new-block').onclick=()=>blockEditor(data);
  if(state.role==='manager')$('#new-equipment').onclick=()=>equipmentEditor(null,data);
  document.querySelectorAll('[data-equipment]').forEach(b=>b.onclick=()=>equipmentEditor(data.equipment.find(e=>e.id===Number(b.dataset.equipment)),data));
  document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreEditor(data.blocks.find(e=>e.id===Number(b.dataset.restore))));
  document.querySelectorAll('[data-finish]').forEach(b=>b.onclick=()=>finishEditor(data.occupancies.find(e=>e.id===Number(b.dataset.finish))));
  $('#refresh').onclick=()=>{state.date=$('#filter-date').value;render().catch(e=>notice(e.message,true));};
  if($('#tomorrow'))$('#tomorrow').onclick=()=>{state.date=new Date(Date.parse(state.status.businessDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);render().catch(e=>notice(e.message,true));};
}
async function render() {
  const version = ++renderVersion, page = state.page, role = state.role;
  const pages={frontdesk:['appointments','patients','followups','resources','insurance'],manager:['schedules','catalog','finance','inventory','resources','pharmacy','insurance','settlements'],dentist:['clinical','documents','prescriptions','followups','resources'],assistant:['inventory','documents','resources'],cashier:['catalog','finance','insurance','settlements'],pharmacist:['pharmacy']};
  document.querySelectorAll('[data-page]').forEach(b => { b.classList.toggle('active', b.dataset.page === page); b.hidden = !(pages[role]||[]).includes(b.dataset.page); });
  $('#page-title').textContent = { appointments: '预约与到诊', patients: '患者资料', schedules: '日期排班',resources:'诊椅与设备',clinical:'牙医接诊',catalog:'收费价目',finance:'收费与退费',followups:'复诊与随访',inventory:'材料采购与库存',documents:'影像与诊疗文书',prescriptions:'处方与取药',pharmacy:'院内药学',insurance:'医保办理',settlements:'经营与收付核对' }[page];
  $('#page-hint').textContent = { appointments: '先核对身份，再办理接诊安排', patients: '同名患者分别建档，按患者号确认身份', schedules: '确认牙医、诊椅与指定日期的可用时段',resources:'核对实际使用、清洁准备和必要设备，按真实结果交接',clinical:'核对患者、健康资料及本次诊疗范围，记录真实办理结果',catalog:'收费人员维护项目和价目，负责人核对后确认适用',finance:'核对原账目、实际到账与付款用途；普通退费先审核，再核实实际结果',followups:'有来源、有联系责任，按实际联系与牙医评估跟进',inventory:'按实物批次和基本单位办理采购验收、领用及盘点',documents:'核对患者与就诊归属，保留原件和明确的文件版本',prescriptions:'依据本次诊断及健康复核，由牙医明确处方与用药指导',pharmacy:'按机构条件与药学资格，分别核实审方和实际发药',insurance:'按原身份、费用及官方结果核对分摊，实际回款分别办理',settlements:'分别核对总费用、患者实际收付及医保待回款，安排差异责任' }[page];
  if(page==='insurance')return renderInsurance(version);
  if(page==='settlements')return renderSettlements(version);
  if(page==='pharmacy')return renderPharmacy(version);
  if(page==='prescriptions')return renderPrescriptions(version);
  if(page==='documents')return renderDocuments(version);
  if(page==='resources')return renderResources(version);
  if(page==='clinical')return renderClinical(version);
  if(page==='catalog')return renderCatalog(version);
  if(page==='finance')return renderFinance(version);
  if(page==='followups')return renderFollowups(version);
  if(page==='inventory')return renderInventory(version);
  if (!['frontdesk', 'manager'].includes(role)) { $('#page-actions').innerHTML = ''; $('#filters').innerHTML = ''; $('#content').innerHTML = empty('当前批次开放前台与负责人接诊安排页面。该岗位的业务页面将在后续接入。'); return; }
  if (page === 'patients') {
    $('#page-actions').innerHTML = '<button id="new-patient" class="primary">建立患者档案</button>';
    const query = $('#patient-q')?.value || '';
    const data = await api('/patients/candidates?q=' + encodeURIComponent(query)); if (version !== renderVersion) return; state.patients = data.items;
    $('#filters').innerHTML = `<label>姓名、电话或完整患者号<input id="patient-q" value="${esc(query)}" placeholder="输入身份线索"></label><button id="refresh">查找候选</button>`;
    $('#content').innerHTML = data.items.length ? table(['患者', '电话及归属', '联系偏好', '操作'], data.items.map(p => `<tr><td>${esc(p.name)}<small>${esc(p.record_no)}</small></td><td>${esc(p.phone || p.contact_unavailable_reason)}<small>${esc(p.phone_owner)}</small></td><td>${esc(p.contact_preference || '未提供')}</td><td><button data-edit-patient="${p.id}">核对并修改</button></td></tr>`)) : empty('未找到患者，请核对身份线索，或建立新档案。');
    $('#new-patient').onclick = () => patientEditor();
  } else if (page === 'schedules') {
    $('#page-actions').innerHTML = '<button id="new-schedule" class="primary">发布排班</button>';
    const data = await api('/reception/options?date=' + state.date); if (version !== renderVersion) return; state.options = data; state.schedules = data.schedules;
    filterDate();
    $('#content').innerHTML = data.schedules.length ? table(['日期与时段', '牙医', '诊椅', '状态', '办理'], data.schedules.map(s => `<tr><td>${esc(s.business_date)}<small>${time(s.starts_at)}—${time(s.ends_at)}</small></td><td>${esc(s.dentist_name)}</td><td>${esc(s.chair_name)}</td><td><span class="status">${esc(s.status)}</span></td><td>${s.status === '已确认' ? `<button data-edit-schedule="${s.id}">调整</button><button data-close-schedule="${s.id}" class="danger">停诊</button>` : esc(s.closure_reason)}</td></tr>`)) : empty('该日期尚无排班。确认人员与诊椅后发布，前台即可受理预约。');
    $('#new-schedule').onclick = () => scheduleEditor();
  } else {
    $('#page-actions').innerHTML = '<button id="walk-in">现场到诊</button><button id="new-booking" class="primary">新增预约</button>';
    const [data, waiting] = await Promise.all([api(`/appointments/query?from=${state.date}&to=${state.date}${state.cursor ? '&cursor=' + state.cursor : ''}`), api('/visits/waiting')]); if (version !== renderVersion) return; state.appointments = data.items;
    filterDate();
    $('#content').innerHTML = data.items.length ? table(['接诊时段', '患者', '牙医 / 诊椅', '预约状态', '办理'], data.items.map(a => `<tr><td>${time(a.planned_start)}—${time(a.planned_end)}<small>${esc(a.reason)}</small></td><td>${esc(a.patient_name)}<small>${esc(a.patient_no)}</small></td><td>${esc(a.dentist_name || '历史安排')}<small>${esc(a.chair_name)}</small></td><td><span class="status">${esc(a.status)}</span>${a.history.length ? `<details><summary>办理记录 ${a.history.length}</summary><ul class="history">${a.history.map(h => `<li>${esc(h.change_kind)}：${esc(h.reason)}</li>`).join('')}</ul></details>` : ''}</td><td class="actions">${a.status === '已预约' ? `<button data-arrive="${a.id}">到诊</button><button data-reschedule="${a.id}">改约</button><button data-notify="${a.id}">通知</button><button data-cancel="${a.id}">取消</button><button data-noshow="${a.id}">核实未到</button>` : a.visit_id ? '就诊 #' + a.visit_id : '记录已保留'}</td></tr>`)) : empty('该日期暂无预约。可选择其他日期查询，或为患者新增预约。');
    if (data.nextCursor) $('#content').insertAdjacentHTML('beforeend', '<p><button id="next-page">下一页预约</button></p>');
    if (state.cursor) $('#content').insertAdjacentHTML('beforeend', '<p><button id="first-page">返回首屏</button></p>');
    $('#content').insertAdjacentHTML('beforeend', '<h2 class="subheading">今日到诊</h2>' + (waiting.items.length ? table(['患者', '实际到诊', '接诊安排', '就诊状态','办理'], waiting.items.map(v => `<tr><td>${esc(v.patient_name)}<small>${esc(v.patient_no)}</small><small>${esc(v.record_no)}</small></td><td>${time(v.arrived_at)}</td><td>${esc(v.dentist_name)} / ${esc(v.chair_name||'已结束资源使用')}<small>${v.starts_at?time(v.starts_at)+'—'+time(v.ends_at):'资源历史已保留'}</small></td><td>${esc(v.status)}</td><td>${v.status==='候诊'?`<button data-recoordinate="${v.id}">重新安排候诊</button>`:'按实际接诊状态办理'}</td></tr>`)) : empty('今日尚无到诊记录。患者到院后，请完成到诊登记。')));
    document.querySelectorAll('[data-recoordinate]').forEach(b=>b.onclick=()=>clinicalAction(()=>waitingEditor(waiting.items.find(v=>v.id===Number(b.dataset.recoordinate)))));
    $('#new-booking').onclick = () => bookingEditor().catch(e => notice(e.message, true));
    $('#walk-in').onclick = () => arrivalEditor().catch(e => notice(e.message, true));
    if ($('#next-page')) $('#next-page').onclick = () => { state.cursor = data.nextCursor; render().catch(e => notice(e.message, true)); };
    if ($('#first-page')) $('#first-page').onclick = () => { state.cursor = null; render().catch(e => notice(e.message, true)); };
  }
  $('#refresh').onclick = () => { state.cursor = null; if ($('#filter-date')) state.date = $('#filter-date').value; render().catch(e => notice(e.message, true)); };
  if ($('#tomorrow')) $('#tomorrow').onclick = () => { state.date = new Date(Date.parse(state.status.businessDate + 'T12:00:00Z') + 86400_000).toISOString().slice(0, 10); state.cursor = null; render().catch(e => notice(e.message, true)); };
}
async function enter(session) {
  state.user = session.user; state.csrf = session.csrf; state.role = session.user.roles.some(r => r.code === 'frontdesk') ? 'frontdesk' : session.user.roles.some(r => r.code === 'manager') ? 'manager' : session.user.roles[0].code;
  state.status = await api('/status'); state.date = state.status.businessDate; state.page = defaultPage(state.role);resetClinical();resetFinance();resetFollowups();resetInventory();if(typeof resetDocuments==='function')resetDocuments();if(typeof resetPrescriptions==='function')resetPrescriptions();if(typeof resetPharmacy==='function')resetPharmacy();if(typeof resetInsurance==='function')resetInsurance();if(typeof resetSettlements==='function')resetSettlements();
  $('#login-view').hidden = true; $('#workspace').hidden = false; $('#staff-name').textContent = state.user.name;
  $('#role').innerHTML = state.user.roles.map(r => `<option value="${r.code}">${esc(r.name)}</option>`).join(''); $('#role').value = state.role;
  $('#clinic-date').textContent = state.status.businessDate + ' · 诊所当地时间'; pending.clear(); $('#receipt').hidden = true; $('#notice').hidden = true;
  await render();
}
$('#login-form').onsubmit = async event => {
  event.preventDefault(); const b = $('#login-form button[type=submit]'); b.disabled = true;
  try { await enter(await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) })); $('#login-form').reset(); }
  catch (e) { $('#login-error').textContent = e.message; } finally { b.disabled = false; }
};
document.querySelectorAll('[data-login]').forEach(b => b.onclick = () => { $('#login-form [name=username]').value = b.dataset.login; $('#login-form [name=password]').value = 'Clinic123!'; $('#login-form').requestSubmit(); });
$('#logout').onclick = async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); location.reload(); } catch (e) { notice(e.message, true); } };
function defaultPage(role){return {manager:'schedules',dentist:'clinical',assistant:'resources',cashier:'catalog',frontdesk:'appointments',pharmacist:'pharmacy'}[role]||'appointments';}
$('#role').onchange = () => { state.role = $('#role').value; state.page = defaultPage(state.role); state.cursor = null; $('#receipt').hidden = true;$('#notice').hidden=true;$('#content').innerHTML='';resetClinical();resetFinance();resetFollowups();resetInventory();if(typeof resetDocuments==='function')resetDocuments();if(typeof resetPrescriptions==='function')resetPrescriptions();if(typeof resetPharmacy==='function')resetPharmacy();if(typeof resetInsurance==='function')resetInsurance();if(typeof resetSettlements==='function')resetSettlements(); pending.clear(); render().catch(e => notice(e.message, true)); };
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { state.page = b.dataset.page; state.cursor = null; render().catch(e => notice(e.message, true)); });
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#editor').close();
$('#verify-last').onclick = async () => {
  const entry = pending.entries().next().value; if (!entry) return;
  try { const receipt = await api('/submissions/' + encodeURIComponent(entry[1].body.requestKey)); pending.delete(entry[0]); showReceipt({ ...receipt, replayed: true }); $('#editor').close(); await render(); }
  catch (e) { $('#form-error').textContent = e.message + '。请勿改动原内容，稍后使用原提交号重试。'; }
};
$('#content').onclick = event => {
  const b = event.target.closest('button'); if (!b) return;
  const find = name => state.appointments.find(a => a.id === Number(b.dataset[name]));
  let action;
  if (b.dataset.editPatient) action = () => patientEditor(state.patients.find(p => p.id === Number(b.dataset.editPatient)));
  if (b.dataset.editSchedule) action = () => scheduleEditor(state.schedules.find(s => s.id === Number(b.dataset.editSchedule)));
  if (b.dataset.closeSchedule) action = () => scheduleEditor(state.schedules.find(s => s.id === Number(b.dataset.closeSchedule)), 'close');
  if (b.dataset.reschedule) action = () => bookingEditor(find('reschedule'));
  if (b.dataset.arrive) action = () => arrivalEditor(find('arrive'));
  for (const [key, kind] of [['cancel', 'cancel'], ['notify', 'notify'], ['noshow', 'noShow']]) if (b.dataset[key]) action = () => changeStatus(find(key), kind);
  if (action) Promise.resolve().then(action).catch(e => notice(e.message, true));
};
(async () => {
  try { state.status = await api('/status'); $('#demo-login').hidden = !state.status.demo; await enter(await api('/auth/me')); }
  catch (e) { if (e.status !== 401) $('#login-error').textContent = e.message; }
})();
