'use strict';
const form=document.querySelector('#booking'), notice=document.querySelector('#notice');
const login=document.querySelector('#login'), field=form.elements, list=document.querySelector('#bookings');
const days=document.querySelector('#days'), times=document.querySelector('#times'), submit=document.querySelector('#book-submit');
const previous=document.querySelector('#previous'), next=document.querySelector('#next');
let csrf='',data,slots=[],month='',date='',time='',busy=false;

function show(message,error=false){
  notice.textContent=message;
  notice.className=error?'error':'';
  notice.hidden=!message;
}
async function api(path,payload){
  const options={credentials:'same-origin',headers:{Accept:'application/json'}};
  if(payload){
    options.method='POST';
    Object.assign(options.headers,{'Content-Type':'application/json','X-Patient-CSRF':csrf});
    options.body=JSON.stringify(payload);
  }
  const response=await fetch('/api/patient-demo/'+path,options);
  if(response.status===401)throw Error('网站访问验证已失效。请刷新页面，用试用访问账号验证后，再登录患者账号。');
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('暂时无法连接患者服务，请刷新页面后重试。');
  const result=await response.json();
  if(!response.ok){
    if(result.code==='DEMO_SESSION')showLogin();
    throw Error(result.message||'操作未完成');
  }
  return result;
}
function china(value){return new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16);}
function option(select,value,label){select.add(new Option(label,value));}
function choice(label,active,disabled,handler){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=label;
  button.className='choice';
  button.setAttribute('aria-pressed',String(active));
  button.disabled=disabled;
  button.onclick=handler;
  return button;
}
function renderCalendar(){
  const available=[...new Set(slots.map(slot=>slot.date))].sort();
  const months=[...new Set([china(data.now).slice(0,7),...available.map(day=>day.slice(0,7))])].sort();
  if(!months.includes(month)) month=(available[0]||china(data.now)).slice(0,7);
  const index=months.indexOf(month), calendar=bookingDays(month,available);
  previous.disabled=index===0;
  next.disabled=index===months.length-1;
  function changeMonth(delta){
    month=months[index+delta];
    date=time='';
    renderCalendar();
  }
  previous.onclick=()=>changeMonth(-1);
  next.onclick=()=>changeMonth(1);
  document.querySelector('#month').textContent=calendar.title;
  days.replaceChildren();
  for(const item of calendar.days){
    if(!item.day){ days.append(document.createElement('span')); continue; }
    const button=choice(item.day,item.date===date,!item.available,()=>{
      date=item.date;
      time='';
      renderCalendar();
      days.querySelector('[aria-pressed="true"]')?.focus();
    });
    button.setAttribute('aria-label',item.date+(item.available?' 可预约':' 无号'));
    days.append(button);
  }
  document.querySelector('#date-hint').textContent=available.length?'可选日期有剩余号源。':'该门店暂时没有可约日期，请选择其他门店。';
  renderTimes();
}
function renderTimes(){
  const choices=[...new Set(slots.filter(s=>s.date===date).map(s=>s.time))].sort();
  times.replaceChildren();
  if(!choices.length){times.textContent=date?'当天暂无可约时间。':'请先在日历上选择日期。';}
  for(const value of choices){
    const button=choice(value,value===time,false,()=>{
      time=value;
      renderTimes();
      times.querySelector('[aria-pressed="true"]')?.focus();
    });
    times.append(button);
  }
  renderDoctors();
}
function renderDoctors(){
  const doctors=slots.filter(s=>s.date===date&&s.time===time);
  field.doctor.replaceChildren();
  option(field.doctor,'',time?'请选择医生':'请先选择时间');
  for(const slot of doctors) option(field.doctor,slot.schedule.id,slot.schedule.dentist_name);
  field.doctor.disabled=!doctors.length;
  updateSubmit();
}
function updateSubmit(){submit.disabled=busy||!field.doctor.value||!field.reason.value;}
function selectBranch(){
  slots=data.schedules.filter(s=>String(s.branch_id)===field.branch.value).flatMap(schedule=>schedule.slots.map(slot=>{
    const [date,time]=china(slot.startsAt).split('T');
    return {...slot,date,time,schedule};
  }));
  date=time=month='';
  renderCalendar();
}
function renderBookings(){
  list.replaceChildren();
  if(!data.bookings.length){list.textContent='暂无预约记录。';return;}
  for(const item of data.bookings){
    const entry=document.createElement('article'), status=document.createElement('span');
    const title=document.createElement('strong'), detail=document.createElement('small');
    entry.className='booking-item';
    status.className='status';
    status.textContent=item.status;
    title.textContent=item.patient_name+' · '+item.branch_name;
    detail.textContent=[item.record_no,china(item.planned_start).replace('T',' '),item.dentist_name].filter(Boolean).join(' · ');
    entry.append(status,title,detail);
    if(item.status==='已预约'){
      const button=document.createElement('button');
      button.className='secondary';
      button.textContent='取消预约';
      button.onclick=async()=>{
        if(!confirm('确定取消这条预约？'))return;
        button.disabled=true;
        try{
          await api('appointment',{action:'cancel',branchId:item.branch_id,appointmentId:item.id,expectedRevision:item.revision,requestKey:crypto.randomUUID()});
          await refresh();
          show('预约已取消。');
        }catch(error){show(error.message,true);}
        finally{button.disabled=false;}
      };
      entry.append(button);
    }
    list.append(entry);
  }
}
function showLogin(){
  csrf='';
  data=null;
  document.querySelector('#workspace').hidden=true;
  document.querySelector('#login-panel').hidden=false;
}
async function refresh(){
  data=await api('options');
  csrf=data.csrf;
  document.querySelector('#patient-name').textContent=data.patientName;
  const branch=field.branch.value, reason=field.reason.value;
  field.branch.replaceChildren();
  field.reason.replaceChildren();
  for(const item of data.branches) option(field.branch,item.id,item.name);
  option(field.reason,'','请选择就诊目的');
  for(const item of data.reasons) option(field.reason,item,item);
  if(data.branches.some(item=>String(item.id)===branch))field.branch.value=branch;
  if(data.reasons.includes(reason))field.reason.value=reason;
  selectBranch();
  renderBookings();
  document.querySelector('#login-panel').hidden=true;
  document.querySelector('#workspace').hidden=false;
}
login.onsubmit=async event=>{
  event.preventDefault();
  for(const button of login.querySelectorAll('button'))button.disabled=true;
  try{
    await api('session',{username:login.elements.username.value.trim(),password:login.elements.password.value});
    login.elements.password.value='';
    await refresh();
    show('');
  }catch(error){show(error.message,true);}
  finally{for(const button of login.querySelectorAll('button'))button.disabled=false;}
};
document.querySelector('#demo-login').onclick=()=>{
  login.elements.username.value='patient';
  login.elements.password.value='Patient123';
  login.requestSubmit();
};
document.querySelector('#logout').onclick=async()=>{
  try{await api('logout',{});showLogin();show('已退出患者账号。');}
  catch(error){show(error.message,true);}
};
field.branch.onchange=selectBranch;
field.doctor.onchange=field.reason.onchange=updateSubmit;
form.onsubmit=async event=>{
  event.preventDefault();
  const slot=slots.find(s=>s.date===date&&s.time===time&&String(s.schedule.id)===field.doctor.value);
  if(!slot||busy)return;
  busy=true;
  updateSubmit();
  try{
    const result=await api('appointment',{action:'create',branchId:Number(field.branch.value),scheduleId:slot.schedule.id,scheduleRevision:slot.schedule.revision,startsAt:slot.startsAt,endsAt:slot.endsAt,reason:field.reason.value,requestKey:crypto.randomUUID()});
    await refresh();
    show('预约成功'+(result.recordNo?'。预约编号 '+result.recordNo:'。'));
  }catch(error){
    await refresh().catch(()=>{});
    show(error.message,true);
  }finally{busy=false;updateSubmit();}
};
document.querySelector('#refresh').onclick=()=>refresh().catch(error=>show(error.message,true));
api('session').then(({signedIn})=>signedIn?refresh():null).catch(error=>show(error.message,true));
