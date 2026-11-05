'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { VERSION } = require('./database');

// Experimental schema bootstrap for isolated in-memory tests only. It neither
// assigns legacy records nor upgrades an application database.
function installTrialSchema(db, { testFailAfterDdl = false, includeBusinessFields = false } = {}) {
  const databases = db.prepare('PRAGMA database_list').all();
  if (!databases.some(d => d.name === 'main' && d.file === '') ||
      databases.some(d => !['main', 'temp'].includes(d.name) || d.file !== ''))
    throw new Error('连锁结构试验仅允许独立内存数据库');
  if (db.isTransaction || db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1)
    throw new Error('试验要求启用外键且没有活动事务');
  const tables = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
  if (db.prepare('PRAGMA application_id').get().application_id !== 0x51484432 ||
      db.prepare('PRAGMA user_version').get().user_version !== VERSION || tables !== 112)
    throw new Error('试验仅支持当前单店基线');
  const source = fs.readFileSync(path.resolve(__dirname, '../../../../01-需求文档/设计交付/连锁基础表候选结构.sql'));
  if (crypto.createHash('sha256').update(source).digest('hex') !== 'e69de6066e9892d0aa24822f8f6b17f24d315bc27e243345aafd83e9c6f98e47')
    throw new Error('连锁候选结构摘要不匹配');
  const ddl = source.toString('utf8').replace(/^PRAGMA foreign_keys = ON;\s*$/m, '');
  let fields=[];
  if(includeBusinessFields){
    const mappingBytes=fs.readFileSync(path.resolve(__dirname,'../../../../01-需求文档/设计交付/连锁业务表归属候选映射.json'));
    if(crypto.createHash('sha256').update(mappingBytes).digest('hex')!=='273a52b812c7ad4698fc70282054918be0c5a3d85d672955d2bbe694af092db6')
      throw new Error('连锁候选表归属清单摘要不匹配');
    const mapping=JSON.parse(mappingBytes.toString('utf8'));
    for(const item of mapping.rows){
      if(item.mode==='新增门店外键') fields.push([item.table,item.field]);
      if(item.mode==='来源与负责门店') for(const column of item.fields) fields.push([item.table,column]);
      if(item.table==='patient' && item.provenance_candidate) fields.push([item.table,item.provenance_candidate.field]);
    }
    if(fields.length!==29||new Set(fields.map(([t,c])=>t+'.'+c)).size!==fields.length||fields.some(([t,c])=>!/^\w+$/.test(t)||!/^\w+$/.test(c)))
      throw new Error('连锁候选字段清单不完整或无效');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE visit ADD COLUMN branch_id INTEGER REFERENCES clinic_branch(id)');
    db.exec('ALTER TABLE health_version ADD COLUMN source_visit_id INTEGER REFERENCES visit(id)');
    db.exec('CREATE UNIQUE INDEX candidate_visit_patient_branch ON visit(id,patient_id,branch_id)');
    db.exec(ddl);
    for(const [table,column] of fields){
      if(table==='visit'&&column==='branch_id')continue;
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" INTEGER REFERENCES clinic_branch(id)`);
    }
    if (testFailAfterDdl) throw new Error('模拟试验失败');
    if (db.prepare('PRAGMA foreign_key_check').all().length || db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('连锁试验外键或完整性检查失败');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
module.exports = { installTrialSchema };
