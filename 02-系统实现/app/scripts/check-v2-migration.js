'use strict';
// Read-only inventory, not a migration executor. Never manufactures missing historical facts.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { DESIGN_DIR } = require('../src/v2/database');
const legacyFile = path.resolve(process.argv[2] || path.join(__dirname, '../data/clinic.db'));
if (!fs.existsSync(legacyFile)) throw new Error('旧数据库不存在，请传入已有文件；不会新建旧库');
const design = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, '../设计交付/旧新数据迁移映射.json'), 'utf8'));
const db = new DatabaseSync(legacyFile, { readOnly: true });
try {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x => x.name);
  const mapping = design.mapping.map(m => {
    if (!names.includes(m.source)) return { source: m.source, status: 'MISSING_SOURCE' };
    const columns = db.prepare(`PRAGMA table_info("${m.source}")`).all().map(f => f.name);
    return { source: m.source, targets: m.targets, rows: db.prepare(`SELECT count(*) n FROM "${m.source}"`).get().n,
      missingColumns: m.source_columns.filter(c => !columns.includes(c)), addedColumns: columns.filter(c => !m.source_columns.includes(c)), policy: m.policy };
  });
  console.log(JSON.stringify({ mode: 'READ_ONLY_PREFLIGHT', migrationExecuted: false, sourceTables: names.length, mappedSources: mapping.length,
    unknownSources: names.filter(n => !design.mapping.some(m => m.source === n)), integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    foreignKeyErrors: db.prepare('PRAGMA foreign_key_check').all().length, mapping }, null, 2));
} finally { db.close(); }
