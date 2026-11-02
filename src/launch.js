import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from './server.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path=process.env.NODE_ENV==='production'?resolve(dirname(process.env.CODEHENCE_DB_PATH||'/data/codehence.sqlite'),'local-admin-key.txt'):resolve(root,'data/local-admin-key.txt');
if(process.env.NODE_ENV==='production'&&(!process.env.CODEHENCE_PUBLIC_ORIGIN?.startsWith('https://')||!process.env.CODEHENCE_ADMIN_KEY))throw Error('Production requires HTTPS CODEHENCE_PUBLIC_ORIGIN and CODEHENCE_ADMIN_KEY');
if(!process.env.CODEHENCE_ADMIN_KEY){mkdirSync(dirname(path),{recursive:true});if(!existsSync(path))writeFileSync(path,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});process.env.CODEHENCE_ADMIN_KEY=readFileSync(path,'utf8').trim();console.log('Local admin key: data/local-admin-key.txt (keep private)');}
const app=await createApp();app.server.listen(Number(process.env.PORT??4300),process.env.HOST||'127.0.0.1',()=>console.log('Codehence: http://127.0.0.1:'+(process.env.PORT??4300)+' · Database: '+app.database));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(async()=>{await app.close();process.exit(0)}));
