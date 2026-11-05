const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/ROG STRIX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=fs.existsSync(path.join(__dirname,'图源'))?path.join(__dirname,'图源'):__dirname,jobs=JSON.parse(fs.readFileSync(path.join(__dirname,'图表任务.json'),'utf8'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const page=await browser.newPage();for(const stem of jobs){
  const svg=fs.readFileSync(path.join(root,stem+'.svg'),'utf8');
  if(/Syntax Error|Assumed diagram type|You should use/i.test(svg))throw Error(stem+' PlantUML error');
  const w=+svg.match(/<svg[^>]*\bwidth="([\d.]+)(?:px)?"/)[1],h=+svg.match(/<svg[^>]*\bheight="([\d.]+)(?:px)?"/)[1];
  await page.setContent(`<html><head><meta charset="utf-8"><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0;padding:0;width:${w}px;height:${h}px}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.evaluate(()=>document.fonts.ready);
  await page.pdf({path:path.join(root,stem+'.pdf'),width:w+'px',height:h+'px',margin:{top:0,right:0,bottom:0,left:0},preferCSSPageSize:true,printBackground:true});
 }process.stdout.write('Converted '+jobs.length+' vector diagrams\n');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
