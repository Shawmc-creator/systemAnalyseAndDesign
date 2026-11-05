'use strict';
// Restartable local demonstration only. It never opens the clinic's runtime DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');const {VERSION}=require('./database');
class ChainDemoSnapshot {
 constructor(filename){this.file=path.resolve(filename);if(path.basename(this.file)!=='chain-demo.snapshot.sqlite')throw new Error('演示快照文件名必须是 chain-demo.snapshot.sqlite');
  const parent=path.dirname(this.file);fs.mkdirSync(parent,{recursive:true});if(fs.lstatSync(parent).isSymbolicLink()||(fs.existsSync(this.file)&&fs.lstatSync(this.file).isSymbolicLink()))throw new Error('演示快照目录和文件不能为符号链接');
  this.lock=this.file+'.lock';try{this.fd=fs.openSync(this.lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('演示数据正被占用；如服务已意外退出，请核实后删除同目录的 .lock 文件');throw e;}}
 initialize(db){if(fs.existsSync(this.file)){const bytes=fs.readFileSync(this.file),check=new DatabaseSync(':memory:');try{check.deserialize(bytes);check.exec('PRAGMA foreign_keys=ON');
   if(check.prepare('PRAGMA application_id').get().application_id!==0x51484432||check.prepare('PRAGMA user_version').get().user_version!==VERSION||check.prepare("SELECT value FROM chain_demo_snapshot_meta WHERE name='format'").get()?.value!=='chain-demo-snapshot-1'||check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw new Error('演示快照版本或完整性不符');
  }finally{check.close();}db.deserialize(bytes);db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON');}
  else{db.exec("CREATE TABLE chain_demo_snapshot_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO chain_demo_snapshot_meta VALUES('format','chain-demo-snapshot-1')");this.save(db);}}
 save(db){const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,db.serialize(),{flag:'wx',mode:0o600});fs.renameSync(tmp,this.file);}catch(e){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}throw e;}}
 close(){if(this.fd!==undefined){fs.closeSync(this.fd);this.fd=undefined;try{fs.unlinkSync(this.lock);}catch(e){if(e.code!=='ENOENT')throw e;}}}
}
module.exports={ChainDemoSnapshot};
