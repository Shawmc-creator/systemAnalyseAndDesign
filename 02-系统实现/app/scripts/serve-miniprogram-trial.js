'use strict';

const {createChainDemo}=require('../src/v2/chain-demo-server');
const trial=createChainDemo({miniProgramTrial:true,fixedClock:'2026-10-19T03:00:00Z',patientClock:()=>new Date()});
trial.server.on('error',error=>{
  trial.db.close();
  console.error('小程序联调服务启动失败：'+error.message);
  process.exitCode=1;
});
trial.server.listen(3027,'127.0.0.1',()=>{
  console.log('小程序与前台联调：http://127.0.0.1:3027/（虚构内存数据）');
});
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>trial.server.close(()=>{trial.db.close();process.exit(0);}));
}
