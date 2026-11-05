'use strict';
const fs=require('node:fs'),path=require('node:path');
try{
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('需要Node.js 24或以上版本');
 const root=path.resolve(__dirname,'..'),delivery=path.resolve(root,'../..');
 const {openDatabase,VERSION}=require('../src/v2/database');require('../src/v2/server');
 const {BUILD}=require('../src/v2/release');
 const html=fs.readFileSync(path.join(root,'public/v2/index.html'),'utf8');
 for(const match of html.matchAll(/(?:src|href)="\/(\w[\w.-]*)"/g))if(!fs.existsSync(path.join(root,'public/v2',match[1])))throw new Error('缺少网页资源：'+match[1]);
 for(const file of ['00-老师使用说明.md','01-需求文档/牙科诊所管理系统-需求文档.pdf','01-需求文档/牙科诊所管理系统-需求文档.tex','01-一键启动系统.cmd','05-体验支付医保演示.cmd','07-启动连锁演示.cmd','08-启动实时日期演示.cmd','04-测试与验收/第一版主业务操作指引.md'])if(!fs.existsSync(path.join(delivery,file)))throw new Error('缺少交付文件：'+file);
 for(const file of ['scripts/start-chain-demo.js','scripts/serve-chain-persistent-demo.js','scripts/serve-chain-live-demo.js','public/chain-demo/chain-demo.html','public/chain-demo/chain-demo.js','public/chain-demo/chain-demo.css','public/v2/styles.css'])if(!fs.existsSync(path.join(root,file)))throw new Error('缺少连锁演示文件：'+file);
 const {createChainDemo}=require('../src/v2/chain-demo-server');
 const chain=createChainDemo();
 try{
  const invalid=chain.db.prepare(`SELECT count(*) n FROM treatment_execution e JOIN visit v ON v.id=e.visit_id WHERE e.branch_id IS NULL OR e.branch_id<>v.branch_id`).get().n;
  if(invalid)throw new Error('连锁演示初始诊疗来源门店不一致');
  if(!chain.db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='tr_treatment_execution_immutable_fact_update'").get())throw new Error('连锁演示诊疗事实保护缺失');
 }finally{chain.db.close();}
 const model=JSON.parse(fs.readFileSync(path.join(delivery,'01-需求文档/设计交付/核心业务数据模型.json'),'utf8').replace(/^\uFEFF/,'')),db=openDatabase(':memory:');let tables;
 try{tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t=>t.name);for(const t of model.tables.filter(t=>t.physical_role!=='history'))if(!tables.includes(t.table))throw new Error('主业务模型缺少对应表：'+t.table);if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('初始化外键检查失败');}finally{db.close();}
 console.log('交付环境检查通过：Node '+process.versions.node+'；应用构建 '+BUILD+'；当前前后端、需求PDF和LaTeX、启动入口齐全。');
 console.log('隔离初始化版本 '+VERSION+'，运行物理表 '+tables.length+'，需求主业务表 '+model.tables.filter(t=>t.physical_role!=='history').length+' 均有表名对应。');
 const missing=model.tables.filter(t=>!tables.includes(t.table));if(missing.length)console.warn('尚未落实的设计历史表：'+missing.map(t=>t.table).join('、')+'。');
 console.log('本项仅为环境检查，不代表文档全部字段、历史和规则已实现。完整结构对齐检查：npm run check:design；差异盘点：npm run audit:design。');
 console.log('正常入口3001；支付医保演示3002；可重启连锁演示3011；实时日期演示3019。本检查未打开或修改运行数据库，未启动服务或访问真实支付医保。');
 console.log('连锁演示隔离初始化通过，初始诊疗来源及不可修改保护已核对。');
}catch(error){console.error('交付环境检查失败：'+error.message);process.exitCode=1;}
