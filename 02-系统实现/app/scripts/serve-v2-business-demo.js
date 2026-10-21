'use strict';
const {setup}=require('../tests/helpers/v2-settlements');
const a=setup({after:()=>{}});a.identity=a.verifyIdentity();a.mapping=a.map();a.register();
const port=Number(process.env.CLINIC_DEMO_PORT||3002);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('演示端口无效');
a.server.listen(port,'127.0.0.1',()=>{console.log('隔离演示：http://127.0.0.1:'+port);console.log('演示日期2026-10-19；cashier / manager / frontdesk，密码Clinic123!');console.log('已准备600元原费用、演示身份与编码；从“医保办理”核对预结算开始。建议演示分摊：基金350元、个账50元、患者200元。');console.log('身份截止2026-10-20 09:35；预结算有效截止填写2026-10-19 11:35；时间采用固定演示时钟。');console.log('仅内存演示，关闭后重置；未接真实支付医保，不改本地业务库。');});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>a.server.close(()=>{a.db.close();process.exit(0);}));
