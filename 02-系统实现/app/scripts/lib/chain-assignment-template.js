'use strict';
// Generate a blank mapping from a verified backup. Never infer branch ownership.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {verifyBundle}=require('./v2-backup');
const mappingPath=path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function createAssignmentTemplate(bundle,output){
 if(!path.isAbsolute(output)||!output.toLowerCase().endsWith('.json'))throw Error('映射模板需要 JSON 格式的绝对输出路径');
 const folder=path.resolve(bundle),target=path.resolve(output),parent=path.dirname(target);
 if(target===folder||target.startsWith(folder+path.sep)||!fs.existsSync(parent)||fs.lstatSync(parent).isSymbolicLink()||fs.existsSync(target))throw Error('输出目录无效、位于备份包内或文件已存在');
 verifyBundle(folder);
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),entry=manifest.files.find(x=>x.path==='clinic-v2.db'),file=path.join(folder,'clinic-v2.db');
 const bytes=fs.readFileSync(file);if(!entry||bytes.length!==entry.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('备份数据库在核验期间发生变化');
 const mapping=JSON.parse(fs.readFileSync(mappingPath,'utf8')),db=new DatabaseSync(file,{readOnly:true}),tables={};let records=0;
 try{db.exec('PRAGMA query_only=ON; BEGIN');for(const row of mapping.rows){
  if(!['新增门店外键','来源与负责门店'].includes(row.mode))continue;
  const fields=row.mode==='新增门店外键'?[row.field]:row.fields;
  if(typeof row.table!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.table)||Object.hasOwn(tables,row.table)||!Array.isArray(fields)||!fields.length||fields.some(x=>typeof x!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))||new Set(fields).size!==fields.length)throw Error('候选映射表或字段无效');
  const values={};for(const record of db.prepare(`SELECT id FROM ${quote(row.table)} ORDER BY id`).all()){
   if(!Number.isSafeInteger(record.id)||record.id<1)throw Error('候选记录编号无效：'+row.table);
   values[record.id]=Object.fromEntries(fields.map(field=>[field,null]));records++;
  }tables[row.table]=values;
 }db.exec('COMMIT');}finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
 const assignment={sourceSha256:entry.sha256,chainName:'',branchIds:[],branches:[],staffRoles:[],tables};
 fs.writeFileSync(target,JSON.stringify(assignment,null,2)+'\n',{flag:'wx',mode:0o600});
 return {path:target,tables:Object.keys(tables).length,records,sourceSha256:entry.sha256,notice:'所有门店归属均为空，必须人工核实填写；此文件不启用数据库。'};
}
module.exports={createAssignmentTemplate};
