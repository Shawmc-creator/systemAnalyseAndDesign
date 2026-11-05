'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/chain-demo/chain-demo.js'),'utf8'),start=source.indexOf('function applyPatientFilter()'),end=source.indexOf('\n',start);if(start<0||end<0)throw Error('缺少患者筛选函数');
test('同名患者选择项包含出生日期和档案号，未填写时明确标记',()=>{const begin=source.indexOf('function patientLabel('),finish=source.indexOf('\n',begin);assert.ok(begin>=0&&finish>begin);const c={};vm.runInNewContext(source.slice(begin,finish)+'\nthis.label=patientLabel',c);assert.match(c.label({name:'陈某',birth_date:'1990-05-06',record_no:'P-1'}),/陈某（出生 1990-05-06；P-1）/);assert.match(c.label({name:'陈某',birth_date:null,record_no:'P-2'}),/出生日期未记录；P-2/);});
test('按姓名或档案号筛选三个患者选择框，空结果清除旧选择',()=>{
 const mk=()=>{const options=[{value:'1',textContent:'陈某（P-001）'},{value:'2',textContent:'林某（P-002）'}],select={options,value:'1',changes:0,onchange(){this.changes++;}};Object.defineProperty(select,'selectedOptions',{get(){return this.options.filter(x=>x.value===this.value);}});return select;};
 const edit=mk(),appointment=mk(),walkin=mk(),filter={value:'林某'},nodes={'#patient-filter':filter,'#patient-edit-form':{elements:{patient:edit}},'#appointment-form':{elements:{patient:appointment}},'#walkin-form':{elements:{patient:walkin}}};
 const c={$:s=>nodes[s]};vm.runInNewContext(source.slice(start,end)+'\nthis.run=applyPatientFilter;',c);c.run();for(const s of [edit,appointment,walkin]){assert.equal(s.value,'2');assert.equal(s.options[0].hidden,true);assert.equal(s.options[1].hidden,false);}
 filter.value='不存在';c.run();for(const s of [edit,appointment,walkin])assert.equal(s.value,'');
 filter.value='p-001';c.run();for(const s of [edit,appointment,walkin])assert.equal(s.value,'1');
});
