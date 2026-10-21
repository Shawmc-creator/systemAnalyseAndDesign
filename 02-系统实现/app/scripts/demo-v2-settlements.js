'use strict';
const {setup,command}=require('../tests/helpers/v2-settlements');
const a=setup({after:()=>{}});
try{
 a.ready();a.submit();a.settle({outcome:'unknown'});console.log('阶段一：医保正式结果未知，患者现金实收为0。');console.log(a.settlements.query(a.c,{from:'2026-10-19'}).totals);
 const settlement=a.settle(),order=a.order();a.settlements.verifyOrder(a.c,command(a.orderResult(order.id,{outcome:'unknown'})));console.log('阶段二：医保正式承担400元，患者原支付200元待核实，不记成功。');
 a.settlements.verifyOrder(a.c,command(a.orderResult(order.id)));a.insurance.receipt(a.c,command({settlementId:settlement.id,expectedRevision:1,flowType:'拨付',amountCents:10000,occurredAt:a.auth.now(),reference:'DEMO-BANK-FIRST',evidence:'隔离演示医保分批到账100元'}));
 const q=a.settlements.query(a.c,{from:'2026-10-19',channel:'微信'}),p=q.preview;a.settlements.reconcile(a.c,command({date:p.date,channel:p.channel,cutoffAt:p.cutoffAt,sourceDigest:p.digest,actualCents:20000,evidence:'隔离演示渠道日结单与患者实付200元一致'}));console.log('阶段三：费用600元，患者实收200元，医保实收100元、待回款300元。');console.log(a.settlements.query(a.c,{from:'2026-10-19'}).totals);
 console.log('全部为隔离内存演示，未访问真实渠道，未改动本地数据库。');
}finally{a.db.close();}
