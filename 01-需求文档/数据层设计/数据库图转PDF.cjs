// Local SVG -> vector PDF. Requires Playwright and an installed Chromium browser.
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

(async () => {
  const [manifestFile, browserPath] = process.argv.slice(2);
  if (!manifestFile || !browserPath) throw new Error('Usage: node 数据库图转PDF.cjs jobs.json browser.exe');
  const jobs = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const browser = await chromium.launch({executablePath: browserPath, headless: true});
  try {
    const page = await browser.newPage();
    await page.route('**/*', r => r.abort());
    for (const job of jobs) {
      const svg = fs.readFileSync(job.svg, 'utf8').replace(/<\?xml[^>]*>/g, '');
      const width = Number(svg.match(/<svg[^>]*\bwidth="([\d.]+)(?:px)?"/)[1]);
      const height = Number(svg.match(/<svg[^>]*\bheight="([\d.]+)(?:px)?"/)[1]);
      await page.setContent(`<html><head><meta charset="UTF-8"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;background:white}svg{display:block;overflow:visible}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${svg}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({path:job.pdf, width:`${width}px`, height:`${height}px`, preferCSSPageSize:true, printBackground:true, margin:{top:0,right:0,bottom:0,left:0}});
      console.log(path.basename(job.pdf));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
