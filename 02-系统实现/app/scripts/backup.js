const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = process.env.CLINIC_DB || path.join(root, 'data', 'clinic.db');
  if (!fs.existsSync(source)) throw new Error(`数据库不存在：${source}`);
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `clinic-${stamp}.db`);
  const db = new DatabaseSync(source, { readOnly: true });
  await backup(db, target);
  db.close();
  console.log(`Backup created: ${target}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
