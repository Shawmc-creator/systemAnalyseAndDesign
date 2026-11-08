'use strict';
// Isolated current-time demonstration; a separate snapshot never alters 3011 data.
const path=require('node:path');const {createChainDemo}=require('../src/v2/chain-demo-server');
const port=3019,snapshotPath=path.join(__dirname,'../data/chain-live-demo/chain-demo.snapshot.sqlite');
const demo=createChainDemo({snapshotPath,runtimeClock:()=>new Date()});
demo.server.on('error',e=>{demo.db.close();console.error('实时演示启动失败：'+e.message);process.exitCode=1;});
demo.server.listen(port,'127.0.0.1',()=>console.log('实时连锁演示：http://127.0.0.1:'+port+'；仅限虚构数据。'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>demo.server.close(()=>{demo.db.close();process.exit(0);}));
