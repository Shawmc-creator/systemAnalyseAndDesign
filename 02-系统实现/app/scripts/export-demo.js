const fs = require('node:fs');
const path = require('node:path');

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const outDir = path.resolve(__dirname, '..', '..', '..', '03-数据', '示例导出');
const day = date => new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);

(async () => {
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'frontdesk', password: 'Clinic123!' })
  });
  if (!login.ok) throw new Error(`登录失败：${login.status}`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const cashierLogin=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'cashier',password:'Clinic123!'})});
  if(!cashierLogin.ok)throw new Error('收费人员登录失败');const cashierCookie=cashierLogin.headers.get('set-cookie').split(';')[0];
  const to = day(new Date()); const fromDate = new Date(); fromDate.setDate(fromDate.getDate()-30); const from = day(fromDate);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const type of ['patients','appointments','billing','followups']) {
    const response = await fetch(`${base}/api/exports?type=${type}&from=${from}&to=${to}`, { headers: { Cookie: type==='billing'?cashierCookie:cookie } });
    if (!response.ok) throw new Error(`${type}导出失败：${response.status} ${await response.text()}`);
    const target = path.join(outDir, `demo-${type}.csv`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    files.push(target);
  }
  console.log(JSON.stringify({ result: '四类演示CSV已生成', from, to, files }, null, 2));
})().catch(error => { console.error(error); process.exitCode=1; });
