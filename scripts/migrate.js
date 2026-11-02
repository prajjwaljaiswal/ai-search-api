import {createPostgresDatabase} from '../src/database.js';
if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL in .env first');
const db=createPostgresDatabase({connectionString:process.env.DATABASE_URL});
try{await db.migrate();await db.check();console.log('Supabase PostgreSQL schema is ready.')}catch(e){console.error('Database migration failed. Check the connection, TLS certificate and database permissions. Error code: '+(e.code||'unknown'));process.exitCode=1}finally{await db.close()}
