import {createPostgresDatabase} from '../src/database.js';
if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL in .env first');
const db=createPostgresDatabase({connectionString:process.env.DATABASE_URL});
try{await db.check();const r=await db.prepare('SELECT count(*) AS count FROM stores').get();console.log('Supabase PostgreSQL connected. Stores: '+r.count)}catch(e){console.error('Database check failed. Verify the pooler URI, migration and TLS certificate. Error code: '+(e.code||'unknown'));process.exitCode=1}finally{await db.close()}
