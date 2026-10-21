'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fail,hash,text}=require('./common');
const MAX_FILE_BYTES=10*1024*1024;
function decodeFile(input){
  const name=text(input.originalName,'原文件名',180);
  if(/[\\/\x00-\x1f\x7f]/.test(name))fail(422,'FILE_NAME','文件名不能包含路径或控制字符');
  const encoded=input.contentBase64;
  if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_FILE_BYTES/3)*4||!encoded.length||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail(422,'FILE_CONTENT','请选择不超过10MB的有效文件');
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.length>MAX_FILE_BYTES||bytes.toString('base64')!==encoded)fail(422,'FILE_CONTENT','文件内容或大小无效');
  let mime,extensions;
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0){mime='image/png';extensions=['.png'];}
  else if(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217){mime='image/jpeg';extensions=['.jpg','.jpeg'];}
  else if(bytes.subarray(0,5).toString()==='%PDF-'&&/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))){mime='application/pdf';extensions=['.pdf'];}
  else fail(422,'FILE_FORMAT','支持PNG、JPEG和PDF；文件内容必须与格式相符');
  if(!extensions.includes(path.extname(name).toLowerCase())||(input.mediaType&&input.mediaType!==mime))fail(422,'FILE_FORMAT','文件扩展名、声明类型与实际内容不一致');
  return {bytes,name,mime,sha256:hash(bytes)};
}
// Storage keys are generated internally; neither the original filename nor client input forms a disk path.
class DocumentStore{
  constructor(directory=null){this.directory=directory?path.resolve(directory):null;this.memory=new Map();if(this.directory)fs.mkdirSync(this.directory,{recursive:true});}
  key(){return crypto.randomUUID()+'.blob';}
  location(key){if(!/^[a-f0-9-]{36}\.blob$/.test(key))fail(409,'FILE_UNAVAILABLE','文件存储索引无效，请核对原件');return this.directory?path.join(this.directory,key):key;}
  read(key){const target=this.location(key);return this.directory?fs.readFileSync(target):Buffer.from(this.memory.get(key)||[]);}
  available(version){try{const bytes=this.read(version.storage_key);return bytes.length===version.size_bytes&&hash(bytes)===version.sha256;}catch{return false;}}
  // A file mutation participates in the caller's DB outcome. On rollback only this write is undone.
  stage(key,bytes,repair=false){
    const target=this.location(key);let previous=null,backup=null;
    if(this.directory){
      if(fs.existsSync(target)){
        if(!repair)throw new Error('Document storage key collision');
        backup=target+'.'+crypto.randomUUID()+'.damaged';fs.renameSync(target,backup);
      }
      try{fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600,flush:true});}catch(error){if(error.code!=='EEXIST'&&fs.existsSync(target))fs.unlinkSync(target);if(backup)fs.renameSync(backup,target);throw error;}
    }else{
      if(this.memory.has(key)){if(!repair)throw new Error('Document storage key collision');previous=this.memory.get(key);}
      this.memory.set(key,Buffer.from(bytes));
    }
    return {
      commit:()=>{if(backup){try{fs.unlinkSync(backup);}catch{/* Preserve a damaged copy if cleanup is unavailable. */}}},
      rollback:()=>{if(this.directory){if(fs.existsSync(target))fs.unlinkSync(target);if(backup)fs.renameSync(backup,target);}else if(previous)this.memory.set(key,previous);else this.memory.delete(key);}
    };
  }
}
module.exports={DocumentStore,decodeFile,MAX_FILE_BYTES};
