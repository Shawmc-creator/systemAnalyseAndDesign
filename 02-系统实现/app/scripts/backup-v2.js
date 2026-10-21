'use strict';
const path=require('node:path');
const {createBundle}=require('./lib/v2-backup');
const root=path.resolve(__dirname,'..'),source=process.env.CLINIC_V2_DB||path.join(root,'data/clinic-v2.db');
createBundle({source,outputDir:path.join(root,'data/backups')}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
