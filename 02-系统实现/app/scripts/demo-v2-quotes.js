'use strict';
const assert=require('node:assert/strict'),{setup,command}=require('../tests/helpers/v2-treatment'),{prepareQuoteDemo}=require('./lib/v2-quote-demo');
const a=setup({after(){}});
try{
 let q=prepareQuoteDemo(a),v=q.versions[0];assert.equal(v.status,'已出具');assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);
 console.log('1. 牙医编制两项后续治疗，收费人员核价出具：400元与200元，实际应收仍为0。');
 a.quotes.decide(a.c,command({versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,decision:'接受',itemIds:[v.items[0].id],decidedAt:a.auth.now(),confirmationBasis:'虚构患者先接受46牙两次治疗费用，45牙暂未决定'}));
 q=a.quotes.query(a.c).quotes[0];v=q.versions[0];assert.equal(v.status,'部分接受');assert.equal(v.items[1].latestDecision,null);console.log('2. 患者仅接受46牙项目，本版为部分接受，45牙保持未决定。');
 a.payments.receive(a.c,command({action:'receive',patientId:1,expectedFundsRevision:null,quoteId:q.id,receivedCents:10000,changeCents:0,channel:'现金',verification:'confirmed',receivedAt:a.auth.now(),transactionEvidence:'隔离虚构现金预付100元',keepAsPrepayment:true,allocations:[]}));assert.equal(a.billing.fundsSummary(1).availableCents,10000);assert.equal(a.db.prepare('SELECT count(*) n FROM bill').get().n,0);console.log('3. 单独登记实际预付款100元，保留原款；报价不生成账单，不自动确认另一项。');
 a.quotes.prepare(a.d,command({action:'revise',versionId:v.id,expectedRevision:v.revision,expectedQuoteRevision:q.revision,reason:'虚构患者调整后续范围'}));q=a.quotes.query(a.c).quotes[0];assert.equal(q.versions[0].status,'部分接受');assert.equal(q.versions[1].status,'草稿');console.log('4. 建立新草稿后，旧版逐项决定和原款保留，新版尚待核价。');
 console.log('全部为内存虚构演示；未打开业务数据库，未使用真实收款渠道。');
}finally{a.db.close();}
