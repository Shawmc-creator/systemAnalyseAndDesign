'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/v2-treatment');
const source=fs.readFileSync(path.join(__dirname,'../public/v2/clinical.js'),'utf8');
const context={esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),localDateTimeSeconds:x=>x,table:(_h,rows)=>rows.join(''),empty:x=>x};
vm.runInNewContext(source+'\nglobalThis.visitHealth=clinicalVisitHealth;globalThis.healthDisplay=clinicalHealthDisplay;',context);
const version=(id,content)=>({id,version_no:id,items:[{category:'过敏',certainty:'未知',content,source:'患者报告'}]});
test('signed historical record displays its frozen review and later health version separately',()=>{
 const d={record:{status:'已签署',signed_health_review_id:10},reviews:[{id:10,health_version_id:1,conclusion:'旧就诊复核',reviewed_at:'旧时间'},{id:11,health_version_id:2,conclusion:'后续复核',reviewed_at:'新时间'}],healthVersions:[version(2,'新资料'),version(1,'旧资料')]};
 const result=context.visitHealth(d),html=context.healthDisplay(d);
 assert.equal(result.review.id,10);assert.equal(result.version.id,1);assert.equal(result.latest.id,2);
 assert.match(html,/签署所据健康复核：旧就诊复核/);assert.match(html,/本次复核所据健康资料 · 第1版/);assert.match(html,/患者最新健康资料 · 第2版/);assert.match(html,/此版本不代表已在本次就诊复核/);
 assert.ok(html.indexOf('旧资料')<html.indexOf('新资料'));assert.doesNotMatch(html,/签署所据健康复核：后续复核/);
});
test('unreviewed or missing frozen sources are never presented as the visit review',()=>{
 const d={record:{status:'草稿'},reviews:[],healthVersions:[version(2,'现有资料')]};let html=context.healthDisplay(d);
 assert.match(html,/本次健康复核尚未完成/);assert.match(html,/患者最新健康资料/);assert.doesNotMatch(html,/本次复核所据健康资料/);
 d.record={status:'已签署',signed_health_review_id:99};d.reviews=[{id:1,health_version_id:2,conclusion:'其他复核'}];html=context.healthDisplay(d);
 assert.match(html,/签署所据健康复核无法找到/);assert.doesNotMatch(html,/签署所据健康复核：其他复核/);
});
test('read-only queries preserve records and front desk cannot read the clinical body',t=>{
 const a=setup(t);const before=a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(a.v.id);
 const data=a.clinical.detail(a.d,a.context);assert.equal(data.patient.id,1);assert.deepEqual(a.db.prepare('SELECT * FROM clinical_record WHERE visit_id=?').get(a.v.id),before);
 assert.throws(()=>a.clinical.detail(a.f,a.context),e=>e.code==='FORBIDDEN');
 assert.throws(()=>a.clinical.detail(a.d,{...a.context,patientId:2}),e=>e.code==='PATIENT_MISMATCH');
});
test('patient workspace labels the current health version separately from the signed review',async()=>{
 const clinical={record:{status:'已签署',signed_health_review_id:1,chief_complaint:'主诉',diagnosis:'诊断'},reviews:[{id:1,health_version_id:1,conclusion:'旧复核'}],healthVersions:[version(2,'较新资料'),version(1,'旧资料')]};
 let html='';const workspaceSource=fs.readFileSync(path.join(__dirname,'../public/v2/workspace.js'),'utf8');
 const ui={...context,state:{role:'dentist'},renderVersion:1,URLSearchParams,api:async()=>clinical,$:()=>({set innerHTML(v){html=v;}}),localDateTime:x=>x,time:x=>x};
 vm.runInNewContext(source+'\n'+workspaceSource+'\nglobalThis.showSummary=workspaceSummary;',ui);
 await ui.showSummary({selectedVisit:{id:1,status:'诊疗结束',dentist_name:'牙医',arrived_at:'日期'},patient:{id:1},appointments:[],now:'日期',tabs:[]},1);
 assert.match(html,/签署所据健康复核：旧复核/);assert.match(html,/患者最新过敏及用药资料/);assert.match(html,/较新资料/);assert.match(html,/最新资料不代表已在本次就诊复核/);
});
