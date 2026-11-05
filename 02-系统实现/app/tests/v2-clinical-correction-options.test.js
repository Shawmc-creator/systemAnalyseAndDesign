'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/v2/clinical.js'),'utf8'),context={};
vm.runInNewContext(source+'\nglobalThis.servicesForExecution=clinicalExecutionServices;',context);
test('a correction retains its inactive original service while new execution offers active services only',()=>{
 const catalog={services:[{id:1,name:'原项目',is_active:0},{id:2,name:'其他项目',is_active:1}]};
 let options=context.servicesForExecution(catalog,{service_id:1});assert.equal(options[0].id,1);assert.match(options[0].name,/已停用.*原记录更正/);assert.equal(options[1].id,2);assert.equal(catalog.services[0].name,'原项目');
 options=context.servicesForExecution(catalog,null);assert.equal(options.length,1);assert.equal(options[0].id,2);
 options=context.servicesForExecution({services:[catalog.services[0]]},{service_id:1});assert.equal(options.length,1);assert.equal(options[0].id,1);
 assert.throws(()=>context.servicesForExecution(catalog,{service_id:99}),/原执行项目无法核对/);
});
