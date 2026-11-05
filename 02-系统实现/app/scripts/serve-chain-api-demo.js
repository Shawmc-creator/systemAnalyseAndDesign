'use strict';
const {createChainDemo}=require('../src/v2/chain-demo-server');
const port=Number(process.env.CHAIN_DEMO_PORT||3010);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('演示端口无效');
const demo=createChainDemo();
demo.server.listen(port,'127.0.0.1',()=>console.log(`连锁隔离演示 API：http://127.0.0.1:${port}；仅虚构内存数据，进程退出后清除。`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>demo.server.close(()=>{demo.db.close();process.exit(0);}));
