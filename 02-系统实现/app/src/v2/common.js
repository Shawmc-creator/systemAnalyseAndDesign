'use strict';
const crypto = require('node:crypto');
class BusinessError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}
function fail(status, code, message, details) { throw new BusinessError(status, code, message, details); }
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const utc = value => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(422, 'INVALID_INPUT', `${label}不能为空且不能超过${max}字`);
  return value.trim();
}
function id(value, label = '编号') {
  if (!Number.isSafeInteger(value) || value <= 0) fail(422, 'INVALID_INPUT', `${label}必须是有效的整数编号`);
  return value;
}
function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(422, 'INVALID_INPUT', `${label}需包含日期、秒和时区`);
  const result = utc(value);
  // Date.parse normalizes impossible dates; round-trip the date part separately.
  const date = value.slice(0, 10);
  if (utc(date + 'T00:00:00Z').slice(0, 10) !== date) fail(422, 'INVALID_INPUT', `${label}日期无效`);
  return result;
}
function dateOnly(value, label = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || utc(value).slice(0, 10) !== value) fail(422, 'INVALID_INPUT', `${label}无效`);
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function insert(db, table, values) {
  const columns = Object.keys(values);
  if (![table, ...columns].every(k => /^[a-z_][a-z_0-9]*$/.test(k))) throw new Error('Invalid internal SQL identifier');
  return Number(db.prepare(`INSERT INTO "${table}" (${columns.map(k => '"' + k + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
}
const fact = (now, values) => ({ ...values, created_at: now, updated_at: now, revision: 1 });
const recordNo = prefix => `${prefix}-${crypto.randomUUID()}`;
function row(db, table, value) {
  const item = db.prepare(`SELECT * FROM "${table}" WHERE id=?`).get(id(value));
  if (!item) fail(404, 'NOT_FOUND', '记录不存在');
  return item;
}
function revision(item, expected) {
  id(expected, '原版本');
  if (item.revision !== expected) fail(409, 'VERSION_CONFLICT', '记录已经变化，请刷新后重新核对', { currentRevision: item.revision });
}
module.exports = { BusinessError, fail, hash, utc, day, text, id, instant, dateOnly, canonical, insert, fact, recordNo, row, revision };
