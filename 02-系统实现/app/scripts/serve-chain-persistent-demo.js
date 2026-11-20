'use strict';
const path=require('node:path');const {createChainDemo}=require('../src/v2/chain-demo-server');
const {configFromEnv}=require('../src/v2/mini-program-demo-login');
const port=Number(process.env.CHAIN_DEMO_PORT||3011);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('演示端口无效');
const snapshotPath=path.join(__dirname,'../data/chain-demo/chain-demo.snapshot.sqlite');
const demo=createChainDemo({snapshotPath,fixedClock:'2026-10-19T03:00:00Z',
 publicOrigin:process.env.CHAIN_DEMO_PUBLIC_ORIGIN||null,wechatDemoConfig:configFromEnv(process.env)});
demo.server.on('error',error=>{demo.db.close();console.error('演示服务启动失败：'+error.message);process.exitCode=1;});
demo.server.listen(port,'127.0.0.1',()=>console.log(`可重启连锁演示：http://127.0.0.1:${port}；虚构数据保存在 ${snapshotPath}，不连接正式数据库。`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>demo.server.close(()=>{demo.db.close();process.exit(0);}));
