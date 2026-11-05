'use strict';
const fs = require('node:fs');
const { checkFile } = require('./lib/chain-preflight');

// All three inputs are explicit; no default production database or output.
const [dbPath, candidatePath, assignmentPath] = process.argv.slice(2);
if (!dbPath || !candidatePath || !assignmentPath || process.argv.length !== 5) {
  console.error('用法：node scripts/check-chain-assignments.js <隔离数据库副本> <候选表映射.json> <人工核实的门店映射.json>');
  process.exitCode = 1;
} else {
  try {
    const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const result = checkFile(dbPath, readJson(candidatePath), readJson(assignmentPath));
    console.log(JSON.stringify({ ...result, notice: '仅核对候选直接归属的映射完整性；不证明归属真实，也不代表可执行迁移。' }, null, 2));
    if (!result.assignmentComplete) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
