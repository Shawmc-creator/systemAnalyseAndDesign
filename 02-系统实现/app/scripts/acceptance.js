// Reproducible acceptance evidence for the current source and live localhost app.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../../04-测试与验收/测试结果');
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const cases = [
  ['业务自动验收（独立内存数据库）', ['--test', 'tests/*.test.js']],
  ['六账号与运行接口', ['scripts/smoke-http.js']],
  ['既有虚构病例闭环及原收据重试', ['scripts/run-demo-workflow.js']],
  ['演示数据初始化（已有标记时保留原数据）', ['scripts/seed-demo.js']]
];
const results = cases.map(([name, args]) => {
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return { name, command: ['node', ...args].join(' '), exitCode: run.status, output: (run.stdout || '') + (run.stderr || ''), error: run.error?.message || null };
});
const inputs = [];
for (const dir of ['src', 'public', 'tests', 'scripts']) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter(x => /\.(js|html|css)$/.test(x)).sort()) {
    const relative = `${dir}/${file}`;
    inputs.push({ path: relative, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex') });
  }
}
for(const file of ['牙科诊所管理系统-需求文档.tex','牙科诊所管理系统-需求文档.pdf'])inputs.push({path:`../../01-需求文档/${file}`,sha256:createHash('sha256').update(fs.readFileSync(path.resolve(root,'../../01-需求文档',file))).digest('hex')});
const report = { requirements: '2026-10-07 UC-01..UC-20', startedAt, finishedAt: new Date().toISOString(), node: process.version,
  platform: process.platform, baseUrl: process.env.CLINIC_URL || 'http://127.0.0.1:3000', passed: results.every(r => r.exitCode === 0), results, inputs };
fs.writeFileSync(path.join(output, '新版验收-20261007.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(output, '新版验收-20261007.txt'), `${report.requirements}\n${startedAt}\nNode ${process.version}\n\n` + results.map(r => `${r.name}\n${r.command}\nexitCode=${r.exitCode}\n${r.output}`).join('\n'));
for (const result of results) console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${result.name}`);
console.log(`验收证据：${output}`);
if (!report.passed) process.exitCode = 1;
