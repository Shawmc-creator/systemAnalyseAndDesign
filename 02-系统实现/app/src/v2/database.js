'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./common');
const DESIGN_DIR = path.resolve(__dirname, '../../../../01-需求文档/数据层设计');
const SCHEMA_HASH = '6a36c7f73a91de2418851da9f662bd5fe0b00e1c5655073d65c71149efce383d';
const { VERSION:RESOURCE_VERSION, upgradeResources } = require('./resource-schema');
const { VERSION:PRESCRIPTION_VERSION,upgradePrescriptions }=require('./prescription-schema');
const {VERSION:PHARMACY_VERSION,upgradePharmacy}=require('./pharmacy-schema');
const {VERSION:SETTLEMENT_VERSION,upgradeSettlements}=require('./settlement-schema');
const {VERSION:CLINICAL_VERSION,upgradeClinical}=require('./clinical-schema');
const {VERSION:FINANCIAL_VERSION,upgradeFinancialHistory}=require('./financial-history-schema');
const {VERSION,upgradeWorkflowHistory}=require('./workflow-history-schema');
const APPLICATION = 0x51484432;
function openDatabase(filename = ':memory:') {
  // Never pass an existing legacy database through an initialization/migration path.
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (!tables.length) {
      const sql = fs.readFileSync(path.join(DESIGN_DIR, 'SQLite-建表设计.sql'));
      if (hash(sql) !== SCHEMA_HASH) throw new Error('目标SQL摘要不匹配，请核对已定稿的数据库设计');
      db.exec(sql.toString('utf8'));
      db.exec(`PRAGMA application_id=${APPLICATION}`);
    } else if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION ||
      ![[20261018,85],[RESOURCE_VERSION,88],[PRESCRIPTION_VERSION,90],[PHARMACY_VERSION,91],[SETTLEMENT_VERSION,100],[CLINICAL_VERSION,100],[FINANCIAL_VERSION,102],[VERSION,108]].some(([v,n]) => db.prepare('PRAGMA user_version').get().user_version===v && tables.length===n)) {
      throw new Error('此文件不是已识别的新版数据库，拒绝打开或自动迁移；请指定独立的新版文件');
    }
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=3000;');
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode=WAL');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库外键检查失败');
    const initialVersion=db.prepare('PRAGMA user_version').get().user_version;
    if(initialVersion===20261018)upgradeResources(db, filename);
    if(initialVersion<=PRESCRIPTION_VERSION)upgradePrescriptions(db,filename,initialVersion===RESOURCE_VERSION);
    if(initialVersion<=PHARMACY_VERSION)upgradePharmacy(db,filename,initialVersion===PRESCRIPTION_VERSION);
    if(initialVersion<=SETTLEMENT_VERSION)upgradeSettlements(db,filename,initialVersion===PHARMACY_VERSION);
    if(initialVersion<=CLINICAL_VERSION)upgradeClinical(db,filename,initialVersion===SETTLEMENT_VERSION);
    if(initialVersion<=FINANCIAL_VERSION)upgradeFinancialHistory(db,filename,initialVersion===CLINICAL_VERSION);
    upgradeWorkflowHistory(db,filename,initialVersion===FINANCIAL_VERSION);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('资源升级后外键检查失败');
    return db;
  } catch (error) { db.close(); throw error; }
}
module.exports = { openDatabase, DESIGN_DIR, SCHEMA_HASH, VERSION };
