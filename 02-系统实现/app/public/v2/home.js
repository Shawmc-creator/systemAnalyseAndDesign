'use strict';
const homeView={section:null,page:1,origin:null};
function resetHome(){homeView.section=null;homeView.page=1;homeView.origin=null;const box=$('#home-origin');if(box)box.hidden=true;}
function clearHomeOrigin(){
 const t=homeView.origin?.target;homeView.origin=null;
 if(t?.page==='inventory'){const tab=inventoryView.tab;resetInventory();inventoryView.tab=tab;}
 if(t?.followupId){followupView.page=1;followupView.status='';followupView.overdue=false;}
 if(t?.quoteId)quoteView.selected=null;
}
function homeScopeFor(page){
 const t=homeView.origin?.target;if(!t)return null;
 if(state.page===page&&t.page===page)return t;
 if(state.page==='workspace'&&t.page==='workspace'&&workspaceView.patientId===t.patientId&&workspaceView.tab===page)return t;
 return null;
}
function renderHomeOrigin(){
 let box=$('#home-origin');if(!box){box=document.createElement('section');box.id='home-origin';box.className='home-origin';$('#filters').before(box);}
 const o=homeView.origin,t=o?.target,matches=t&&(state.page===t.page)&&(t.page!=='workspace'||workspaceView.patientId===t.patientId);
 box.hidden=!matches||state.page==='home';if(box.hidden)return;
 box.innerHTML=`<div><strong>原业务：${esc(o.label)}</strong><span>${esc(o.source.recordNo)} · 原核对状态 ${esc(o.status)}${o.patient?' · '+esc(o.patient.name)+' / '+esc(o.patient.recordNo):''}</span><small>以本页原单当前状态和可办范围为准。</small></div><div class="actions"><button id="home-return">返回岗位首页</button><button id="home-clear-focus">显示全部原业务</button></div>`;
 $('#home-return').onclick=()=>{clearHomeOrigin();state.page='home';clinicalAction(render);};$('#home-clear-focus').onclick=()=>{clearHomeOrigin();clinicalAction(render);};
}
function revealHomeSource(){
 const key=homeView.origin?.key;if(!key)return;
 const el=Array.from(document.querySelectorAll('[data-home-record]')).find(el=>el.dataset.homeRecord===key);
 if(el){el.classList.add('home-source-focus');for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;el.scrollIntoView({block:'center',behavior:'smooth'});}
}
async function openHomeTask(section,key){
 try{
  const result=await api('/home/target?'+new URLSearchParams({section,key})),o=result.item,t=o.target;clearHomeOrigin();homeView.origin=o;
  if(t.page==='workspace')await openWorkspace(t.patientId,t.visitId,t.tab,t);
  else{
   state.page=t.page;
   if(t.page==='appointments'){resetCalendar();state.date=t.date;calendarView.selected=t.entryKey;}
   if(t.page==='finance'){resetFinance();financeView.patientId=t.patientId;}
   if(t.page==='followups'){resetFollowups();}
   if(t.page==='inventory'){resetInventory();inventoryView.tab=t.tab;inventoryView.material=t.materialId?String(t.materialId):'';}
   if(t.page==='resources')state.date=t.date;
   if(t.page==='insurance'){resetInsurance();insuranceView.patientId=t.patientId;}
   if(t.page==='documents'){resetDocuments();documentView.selected={patientId:t.patientId,visitId:t.visitId};}
   if(t.page==='pharmacy'){resetPharmacy();pharmacyView.selected=t.prescriptionId;}
   if(t.page==='settlements'){resetSettlements();}
   await render();
  }
  revealHomeSource();
 }catch(e){if(e.code==='HOME_TASK_CHANGED'){state.page='home';clearHomeOrigin();await render();}throw e;}
}
function homeTaskTable(s){return table(['患者 / 原业务','当前状态与待核对事项','相关日期','办理'],s.items.map(t=>`<tr><td>${t.patient?esc(t.patient.name)+'<small>'+esc(t.patient.recordNo)+'</small>':''}<small>${esc(t.source.recordNo)}</small></td><td>${esc(t.status)}<small>${esc(t.label)}</small>${t.note?'<small>'+esc(t.note)+'</small>':''}</td><td>${esc(t.dueAt?t.dueAt.length===10?t.dueAt:localDateTimeSeconds(t.dueAt):'未另指定')}</td><td><button data-home-section="${esc(s.id)}" data-home-key="${esc(t.key)}">核对原单</button></td></tr>`));}
async function renderHome(version){
 const params=new URLSearchParams();if(homeView.section){params.set('section',homeView.section);params.set('page',homeView.page);params.set('pageSize',20);}
 const d=await api('/home/query?'+params);if(version!==renderVersion)return;
 $('#filters').innerHTML='';$('#page-actions').innerHTML='<button id="home-refresh">刷新待办</button>';
 const roleName=state.user.roles.find(r=>r.code===state.role)?.name||state.role;
 let html=`<section class="home-welcome"><div><p>${esc(d.date)} · ${esc(roleName)}</p><h2>${esc(state.user.name)}的岗位首页</h2><p>从待核对事项进入原业务，按真实结果继续办理。</p></div><span class="home-current-role">当前身份：${esc(roleName)}</span></section>`;
 if(homeView.section)html+='<button id="home-overview">返回待办总览</button>';
 else{
  const active=d.sections.filter(s=>s.total),shown=active.length?active:d.sections.slice(0,4),others=d.sections.filter(s=>!shown.includes(s));
  const cards=items=>'<div class="home-metrics">'+items.map(s=>`<button data-home-more="${s.id}" class="home-metric"><span>${esc(s.label)}</span><strong>${s.total}</strong><small>${s.total?'查看原业务事项':'当前无此类待办'}</small></button>`).join('')+'</div>';
  html+=cards(shown)+(others.length?'<details class="home-other-sections"><summary>其他'+others.length+'类业务当前无待办</summary>'+cards(others)+'</details>':'')+'<p class="muted">按原业务事项计数，同一患者的不同事项分别列出。</p>';
 }
 for(const s of d.sections.filter(s=>homeView.section||s.total)){
  html+=`<section class="clinical-plan home-task-section"><div class="home-section-heading"><h2>${esc(s.label)} <small>${s.total}项</small></h2>${!homeView.section&&s.total>s.items.length?'<button data-home-more="'+s.id+'">查看全部</button>':''}</div>${s.note?'<p class="muted">'+esc(s.note)+'</p>':''}${s.items.length?homeTaskTable(s):empty('当前没有此类待核对事项。')}`;
  if(homeView.section){homeView.page=s.page;html+=`<div class="home-pagination"><span>第${s.page}页 / 共${Math.max(1,Math.ceil(s.total/s.pageSize))}页</span>${s.page>1?'<button id="home-prev">上一页</button>':''}${s.page*s.pageSize<s.total?'<button id="home-next">下一页</button>':''}</div>`;}html+='</section>';
 }
 if(!homeView.section&&!d.sections.some(s=>s.total))html+=empty('当前汇总范围内没有待办。可从下方业务入口继续查询和办理。');
 if(!homeView.section){
  const groups=Array.from(document.querySelectorAll('.nav-group:not([hidden])')).map(g=>({label:g.querySelector('h2').textContent,buttons:Array.from(g.querySelectorAll('[data-page]')).filter(b=>!b.hidden)}));
  html+='<section class="home-shortcuts"><h2>业务入口</h2><div class="home-shortcut-groups">'+groups.map(g=>'<section><h3>'+esc(g.label)+'</h3>'+g.buttons.map(b=>`<button data-home-page="${b.dataset.page}">${esc(b.textContent)}</button>`).join('')+'</section>').join('')+'</div></section>';
  const notes=d.sections.filter(s=>s.note&&s.total===0);if(notes.length)html+='<details class="home-notes"><summary>办理条件与核对提示</summary>'+notes.map(s=>'<p><strong>'+esc(s.label)+'</strong>：'+esc(s.note)+'</p>').join('')+'</details>';
 }
 $('#content').innerHTML=html;$('#home-refresh').onclick=()=>clinicalAction(render);if($('#home-overview'))$('#home-overview').onclick=()=>{homeView.section=null;homeView.page=1;clinicalAction(render);};
 document.querySelectorAll('[data-home-more]').forEach(b=>b.onclick=()=>{homeView.section=b.dataset.homeMore;homeView.page=1;clinicalAction(render);});
 document.querySelectorAll('[data-home-key]').forEach(b=>b.onclick=()=>clinicalAction(()=>openHomeTask(b.dataset.homeSection,b.dataset.homeKey)));
 document.querySelectorAll('[data-home-page]').forEach(b=>b.onclick=()=>{clearHomeOrigin();state.page=b.dataset.homePage;clinicalAction(render);});
 if($('#home-prev'))$('#home-prev').onclick=()=>{homeView.page--;clinicalAction(render);};if($('#home-next'))$('#home-next').onclick=()=>{homeView.page++;clinicalAction(render);};
}
