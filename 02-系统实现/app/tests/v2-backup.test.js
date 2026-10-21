'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),test=require('node:test'),assert=require('node:assert/strict');
const {setup,command}=require('./helpers/v2-treatment');
const {createBundle,verifyBundle}=require('../scripts/lib/v2-backup');
const {createApplication}=require('../src/v2/server');
const {DatabaseSync}=require('node:sqlite');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function fixture(){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-backup-test-')),source=path.join(folder,'clinic-v2.db'),a=setup({after:()=>{}},{filename:source}),v=a.documents.upload(a.d,command({...a.context,documentType:'影像',source:'隔离演示设备导出',ownershipNote:'核对演示患者与就诊',reason:'归档演示原件',originalName:'备份演示.png',contentBase64:PNG.toString('base64')}));return {a,v,folder,source,outputDir:path.join(folder,'backups'),close(){a.db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-backup-test-'));fs.rmSync(folder,{recursive:true,force:true});}};}
test('当前备份包含SQLite一致性快照、文书原件和机构配置，副本可独立打开并下载原件',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.folder,'insurance-config.json'),JSON.stringify({enabled:false}));const before=f.a.db.prepare('SELECT count(*) n FROM operation_audit').get().n,result=await createBundle(f),verified=verifyBundle(result.directory);assert.equal(verified.tables,100);assert.equal(verified.clinicalFiles,1);assert.equal(f.a.db.prepare('SELECT count(*) n FROM operation_audit').get().n,before);
  const restoredFolder=path.join(f.folder,'restored');fs.cpSync(result.directory,restoredFolder,{recursive:true});const restored=createApplication({filename:path.join(restoredFolder,'clinic-v2.db')});try{const session=restored.auth.login({username:'dentist',password:'Clinic123!'}),download=restored.documents.download({token:session.token,role:'dentist'},f.v.id);assert.deepEqual(download.bytes,PNG);}finally{restored.db.close();}assert.equal(verifyBundle(result.directory).passed,true);
 }finally{f.close();}
});
test('原件缺失或损坏时不报告备份成功，不改源业务记录，失败包不可作为完成包验证',async()=>{
 const f=fixture();try{const row=f.a.db.prepare('SELECT * FROM document_version WHERE id=?').get(f.v.id),file=path.join(f.folder,'clinical-files',row.storage_key);fs.writeFileSync(file,'damaged');await assert.rejects(createBundle(f),/源影像文书/);const folder=path.join(f.outputDir,fs.readdirSync(f.outputDir).find(n=>n.startsWith('clinic-v2-bundle-')));assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')).status,'failed');assert.throws(()=>verifyBundle(folder),/不是已完成/);assert.equal(f.a.db.prepare('SELECT sha256 FROM document_version WHERE id=?').get(f.v.id).sha256,row.sha256);}finally{f.close();}
});
test('备份原件篡改或清单路径越界可被发现；数据库没有引用的文件不混入备份',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.folder,'clinical-files','unreferenced.txt'),'not a clinical version');const result=await createBundle(f),manifestFile=path.join(result.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),blob=manifest.files.find(x=>x.path.startsWith('clinical-files/'));assert.equal(manifest.files.some(x=>x.path.includes('unreferenced')),false);fs.writeFileSync(path.join(result.directory,...blob.path.split('/')),'tampered');assert.throws(()=>verifyBundle(result.directory),/摘要不匹配/);blob.path='../outside';fs.writeFileSync(manifestFile,JSON.stringify(manifest));assert.throws(()=>verifyBundle(result.directory),/索引无效/);}finally{f.close();}
});
test('备份命令拒绝旧版或未知数据库，不运行迁移，也不改变源文件',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clinic-backup-test-'));try{const source=path.join(folder,'legacy.db'),db=new DatabaseSync(source);db.exec('CREATE TABLE legacy(id INTEGER)');db.close();const before=fs.readFileSync(source);await assert.rejects(createBundle({source,outputDir:path.join(folder,'backups')}),/仅支持当前新版/);assert.deepEqual(fs.readFileSync(source),before);}finally{assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'clinic-backup-test-'));fs.rmSync(folder,{recursive:true,force:true});}
});
