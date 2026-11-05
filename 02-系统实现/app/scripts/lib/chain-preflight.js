'use strict';

// Read-only completeness check for a proposed legacy branch assignment.
// This does not perform or authorize a migration.
const { DatabaseSync } = require('node:sqlite');

function quote(identifier) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

function checkLegacyAssignments(db, candidate, assignment) {
  if (!candidate || !Array.isArray(candidate.rows) || !assignment ||
      !Array.isArray(assignment.branchIds) || !assignment.tables ||
      typeof assignment.tables !== 'object' || Array.isArray(assignment.tables)) {
    throw new Error('候选表清单或门店映射格式无效');
  }
  const branchIds = new Set(assignment.branchIds);
  if (!branchIds.size || branchIds.size !== assignment.branchIds.length ||
      [...branchIds].some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('门店编号必须是互不重复的正整数');
  }
  const fields = new Map();
  for (const row of candidate.rows) {
    if (row.mode !== '新增门店外键' && row.mode !== '来源与负责门店') continue;
    if (typeof row.table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.table) || fields.has(row.table)) throw new Error('候选表名重复或无效');
    const columns = row.mode === '新增门店外键' ? [row.field] : row.fields;
    if (!Array.isArray(columns) || !columns.length || columns.some(c => typeof c !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) || new Set(columns).size !== columns.length) throw new Error('候选字段格式无效或重复');
    fields.set(row.table, columns);
  }
  if (!fields.size) throw new Error('候选清单不含门店归属表');
  // Registration origin is optional when unverified; its absence must not
  // be treated as proof of origin or grant access to clinical records.
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const unknown = Object.keys(assignment.tables).filter(name => !fields.has(name));
  if (unknown.length) throw new Error('映射包含非候选门店归属表');
  const results = [];
  for (const [table, columns] of fields) {
    if (!tables.has(table)) throw new Error('数据库缺少候选表：' + table);
    if (!Array.isArray(columns) || !columns.length || columns.some(x => typeof x !== 'string')) throw new Error('候选字段格式无效');
    const actual = db.prepare(`SELECT id FROM ${quote(table)}`).all().map(r => String(r.id));
    const rows = assignment.tables[table] ?? {};
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error('表映射格式无效：' + table);
    const actualIds = new Set(actual);
    let missing = 0, invalid = 0, unexpected = 0;
    for (const id of actual) {
      if (!Object.hasOwn(rows, id)) { missing++; continue; }
      const value = rows[id];
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(k => !columns.includes(k)) ||
          columns.some(k => !Object.hasOwn(value, k) || !branchIds.has(value[k]))) invalid++;
    }
    for (const id of Object.keys(rows)) if (!actualIds.has(id)) unexpected++;
    results.push({ table, requiredFields: columns, records: actual.length, missing, invalid, unexpected });
  }
  return { assignmentComplete: results.every(r => r.missing === 0 && r.invalid === 0 && r.unexpected === 0), tables: results };
}

function checkFile(filename, candidate, assignment) {
  // Explicit readOnly prevents accidental creation or modification of the DB.
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('数据库完整性或外键检查失败');
    }
    const result = checkLegacyAssignments(db, candidate, assignment);
    db.exec('COMMIT');
    return result;
  } finally { db.close(); }
}

module.exports = { checkLegacyAssignments, checkFile };
