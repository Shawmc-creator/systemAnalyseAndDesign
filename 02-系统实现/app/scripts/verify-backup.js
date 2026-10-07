const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync, backup } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const sourceFile = process.env.CLINIC_DB || path.join(root, 'data', 'clinic.db');
const backupDir = path.join(root, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `verified-clinic-${stamp}.db`);
const restoredFile = path.join(os.tmpdir(), `restored-clinic-${process.pid}-${Date.now()}.db`);

function counts(db) {
  return Object.fromEntries(['materials','material_movements','service_price_versions','treatment_confirmation_versions','cash_receipts','daily_reconciliations','followup_history','patients', 'patient_accounts', 'appointments', 'appointment_change_requests', 'encounters', 'clinical_attachments', 'invoices', 'payments', 'refunds', 'approval_requests', 'followups', 'notifications', 'service_price_history', 'clinic_hours', 'dentist_schedules', 'staff_leaves', 'audit_events']
    .map(table => [table, Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));
}

async function waitForServer(child, errors) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`恢复服务器启动超时\n${errors.text}`)), 8000);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`恢复服务器提前退出：${code}\n${errors.text}`));
    });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('Dental clinic system')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function login(base) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'frontdesk', password: 'Clinic123!' })
  });
  assert.equal(response.status, 200, '恢复后的系统应能登录');
  return response.headers.get('set-cookie').split(';')[0];
}

(async () => {
  assert.ok(fs.existsSync(sourceFile), `源数据库不存在：${sourceFile}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const sourceCounts = counts(source);
  await backup(source, backupFile);
  source.close();

  fs.copyFileSync(backupFile, restoredFile);
  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  const integrity = restored.prepare('PRAGMA integrity_check').all();
  const foreignKeys = restored.prepare('PRAGMA foreign_key_check').all();
  const restoredCounts = counts(restored);
  const workflowPatient = restored.prepare("SELECT patient_no,full_name FROM patients WHERE phone='13800001999'").get();
  const workflowInvoice = workflowPatient
    ? restored.prepare(`SELECT i.invoice_no,i.status,i.balance FROM invoices i
        JOIN patients p ON p.id=i.patient_id WHERE p.phone='13800001999' ORDER BY i.id DESC LIMIT 1`).get()
    : null;
  restored.close();

  assert.equal(integrity.length, 1, 'SQLite完整性检查只应返回一项结果');
  assert.equal(integrity[0].integrity_check, 'ok', 'SQLite完整性检查应通过');
  assert.equal(foreignKeys.length, 0, '恢复数据库不应包含外键错误');
  assert.deepEqual(restoredCounts, sourceCounts, '恢复前后的关键表行数应一致');
  assert.equal(workflowPatient?.patient_no, 'P000009', '完整闭环患者应存在于恢复数据中');
  assert.equal(workflowInvoice?.status, 'paid', '完整闭环账单应保持已支付');
  assert.equal(workflowInvoice?.balance, 0, '完整闭环账单余额应保持为0');

  const port = 33000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const errors = { text: '' };
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CLINIC_DB: restoredFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', chunk => { errors.text += chunk; });

  try {
    await waitForServer(child, errors);
    const cookie = await login(base);
    const headers = { Cookie: cookie };
    const patientsResponse = await fetch(`${base}/api/patients?q=13800001999`, { headers });
    const patients = await patientsResponse.json();
    const invoicesResponse = await fetch(`${base}/api/invoices`, { headers });
    const invoices = await invoicesResponse.json();
    assert.equal(patientsResponse.status, 200);
    assert.ok(patients.patients.some(item => item.patient_no === 'P000009'));
    assert.equal(invoicesResponse.status, 200);
    assert.ok(invoices.invoices.some(item => item.invoice_no === workflowInvoice.invoice_no && item.status === 'paid'));
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(restoredFile + suffix, { force: true });
  }

  console.log(JSON.stringify({
    result: '备份与恢复演练通过', backupFile, integrity: 'ok', foreignKeyErrors: 0,
    counts: restoredCounts, restoredPatient: workflowPatient, restoredInvoice: workflowInvoice,
    restoredServer: '登录、患者查询和账单查询通过'
  }, null, 2));
})().catch(error => {
  console.error(error);
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(restoredFile + suffix, { force: true });
  process.exitCode = 1;
});
