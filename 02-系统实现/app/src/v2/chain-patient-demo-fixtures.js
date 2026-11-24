'use strict';

const {nextChainPatientNumber}=require('./chain-patient-number');

const examples={
 followup:{name:'林晓宁（演示）',phone:'13800007777',oldName:'虚构示例复诊患者'},
 booking:{name:'周子安（演示）',phone:'13800007778',oldName:'虚构示例预约患者'},
 waiting:{name:'许亦晨（演示）',phone:'13800007779',oldName:'虚构示例候诊患者'},
 billing:{name:'沈佳禾（演示）',phone:'13800007780',oldName:'虚构示例待收费患者'}
};
const longNumber=/^P-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const family=['顾','唐','程','苏','宋','陆','叶','夏','方','谢'];
const given=['知遥','明溪','语宁','一帆','清和','星然','以安','晴川'];

function miniProgramPatientName(number){
 const index=Number(number.slice(2))-1;
 return family[index%family.length]+given[Math.floor(index/family.length)%given.length]+'（演示）';
}

function upgradeDemoPatients(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare('SELECT id,record_no,name,phone FROM patient ORDER BY id').all();
  const miniTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mini_program_demo_patient'").get();
  const miniPatientIds=new Set(miniTable?db.prepare('SELECT patient_id FROM mini_program_demo_patient').all().map(row=>row.patient_id):[]);
  const update=db.prepare('UPDATE patient SET record_no=?,name=? WHERE id=?');
  let changed=false;
  for(const patient of rows){
   const number=longNumber.test(patient.record_no)?nextChainPatientNumber(db):patient.record_no;
   const example=Object.values(examples).find(item=>item.oldName===patient.name&&item.phone===patient.phone);
   let name=example?.name||patient.name;
   if(miniPatientIds.has(patient.id)&&/^小程序虚构患者 [0-9a-f]{6}$/.test(name)&&/^P-\d{4,}$/.test(number)){
    name=miniProgramPatientName(number);
   }
   if(name===patient.name&&number===patient.record_no)continue;
   update.run(number,name,patient.id);
   changed=true;
  }
  db.exec('COMMIT');
  return changed;
 }catch(error){db.exec('ROLLBACK');throw error;}
}

module.exports={examples,miniProgramPatientName,upgradeDemoPatients};
