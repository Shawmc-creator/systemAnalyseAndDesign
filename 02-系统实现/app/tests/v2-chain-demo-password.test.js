'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createChainDemo}=require('../src/v2/chain-demo-server');
const {encodePassword,checkPassword}=require('../src/v2/auth');

test('演示快照只更新旧默认口令并保留自设口令',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'chain-password-'));
 const snapshotPath=path.join(folder,'chain-demo.snapshot.sqlite');
 let demo;
 async function close(){
   if(demo.server.listening)await new Promise(resolve=>demo.server.close(resolve));
   demo.db.close();
 }
 t.after(async()=>{
   if(demo?.server.listening)await close();
   fs.rmSync(folder,{recursive:true,force:true});
 });
 demo=createChainDemo({snapshotPath});
 await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));
 const write=demo.db.prepare('UPDATE user_account SET password_hash=? WHERE login_name=?');
 write.run(encodePassword('Clinic123!'),'frontdesk');
 write.run(encodePassword('CustomOnly123!'),'dentist');
 fs.writeFileSync(snapshotPath,demo.db.serialize());
 const patients=demo.db.prepare('SELECT count(*) n FROM patient').get().n;
 await close();
 demo=createChainDemo({snapshotPath});
 await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));
 const read=demo.db.prepare('SELECT password_hash FROM user_account WHERE login_name=?');
 assert.ok(checkPassword('Clinic123',read.get('frontdesk').password_hash));
 assert.ok(!checkPassword('Clinic123!',read.get('frontdesk').password_hash));
 assert.ok(checkPassword('CustomOnly123!',read.get('dentist').password_hash));
 assert.equal(demo.db.prepare('SELECT count(*) n FROM patient').get().n,patients);
 await close();
 demo=null;
});
