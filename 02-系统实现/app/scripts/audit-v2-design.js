'use strict';
// Inspect an isolated fresh schema against the document; never open the live database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {openDatabase,VERSION}=require('../src/v2/database');
const root=path.resolve(__dirname,'..'),delivery=path.resolve(root,'../..'),modelPath=path.join(delivery,'01-需求文档/设计交付/核心业务数据模型.json');
const bytes=fs.readFileSync(modelPath),model=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),db=openDatabase(':memory:');
try{
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name),results=[];
 for(const table of model.tables){
  if(!names.includes(table.table)){results.push({table:table.table,name:table.name,history:table.physical_role==='history',exists:false,missingFields:table.fields.map(f=>f.name)});continue;}
  const actual=db.prepare('PRAGMA table_info("'+table.table+'")').all(),fks=db.prepare('PRAGMA foreign_key_list("'+table.table+'")').all(),byName=new Map(actual.map(f=>[f.name,f]));
  const unique=db.prepare('PRAGMA index_list("'+table.table+'")').all().filter(i=>i.unique&&!i.partial).map(i=>db.prepare('PRAGMA index_info("'+i.name+'")').all()).filter(columns=>columns.length===1).map(columns=>columns[0].name);
  const changedFields=table.fields.filter(f=>byName.has(f.name)).flatMap(f=>{const a=byName.get(f.name),changes=[];
   if(a.type!==f.type)changes.push('type');if(f.nullable!==!(a.notnull||a.pk))changes.push('nullable');
   if(Object.hasOwn(f,'unique')&&f.unique!==unique.includes(f.name))changes.push('unique');
   if(f.foreign_key&&!fks.some(k=>k.from===f.name&&k.table===f.foreign_key&&k.to==='id'))changes.push('foreign_key');
   return changes.length?[{name:f.name,differences:changes}]:[];});
  const primary=actual.filter(f=>f.pk).sort((a,b)=>a.pk-b.pk).map(f=>f.name),expected=table.fields.filter(f=>f.primary_key).map(f=>f.name);
  results.push({table:table.table,name:table.name,exists:true,missingFields:table.fields.filter(f=>!byName.has(f.name)).map(f=>f.name),changedFields,primaryKeyMatches:JSON.stringify(primary)===JSON.stringify(expected)});
 }
 const report={date:'2026-10-23',mode:'ISOLATED_SCHEMA_INVENTORY',runtimeVersion:VERSION,liveDataTouched:false,requirementsChanged:false,modelSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  documentTables:model.tables.length,runtimeTables:names.length,matchingTableNames:results.filter(t=>t.exists).length,missingTables:results.filter(t=>!t.exists).map(t=>t.table),
  missingFieldsInExistingTables:results.filter(t=>t.exists).reduce((n,t)=>n+t.missingFields.length,0),changedFieldDefinitions:results.filter(t=>t.exists).reduce((n,t)=>n+t.changedFields.length,0),
  primaryKeyDifferences:results.filter(t=>t.exists&&!t.primaryKeyMatches).map(t=>t.table),results,
  limits:['仅比较表名、列名、类型、可空、指定单列唯一、外键及主键；不验证业务语义、条件唯一或全部约束','运行库保留历史及技术表，总表数不能代表需求覆盖','规约、历史写入及设计分层仍须分别实施和验收']};
 report.schemaInventoryAligned=report.missingTables.length===0&&report.missingFieldsInExistingTables===0&&report.changedFieldDefinitions===0&&report.primaryKeyDifferences.length===0;
 if(process.argv.includes('--save')){const folder=path.join(delivery,'04-测试与验收/测试结果/20261023-v2-workflow-closeout');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'设计结构差异清单.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));if(process.argv.includes('--check')&&!report.schemaInventoryAligned)process.exitCode=2;
}finally{db.close();}
