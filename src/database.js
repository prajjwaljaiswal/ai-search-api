import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {Pool} from 'pg';

export const tables=['stores','products','embeddings','accounts','sessions','store_access','request_limits','index_leases'];
export const schema=`
CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL,search_hash TEXT UNIQUE NOT NULL,write_hash TEXT UNIQUE NOT NULL,origins TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(store_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(store_id,id),FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS embeddings(store_id TEXT NOT NULL,product_id TEXT NOT NULL,model TEXT NOT NULL,content_hash TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(store_id,product_id,model),FOREIGN KEY(store_id,product_id) REFERENCES products(store_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires BIGINT NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS store_access(store_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,search_key TEXT NOT NULL,FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS request_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS index_leases(id TEXT PRIMARY KEY,token TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires);
CREATE INDEX IF NOT EXISTS store_access_account_idx ON store_access(account_id);
CREATE INDEX IF NOT EXISTS request_limits_expiry_idx ON request_limits(expires);
`;
export function postgresSQL(sql){let n=0;return sql.replace(new RegExp('\\b('+tables.join('|')+')\\b','g'),'codehence.$1').replace(/\?/g,()=>'$'+(++n));}
export function poolConfig(connectionString){
 let u;try{u=new URL(connectionString)}catch{throw Error('DATABASE_URL is not a valid PostgreSQL URI')};if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('DATABASE_URL must be a PostgreSQL URI');
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])u.searchParams.delete(key);
 return {connectionString:u.toString(),max:3,idleTimeoutMillis:20000,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:true,...(process.env.SUPABASE_DB_CA?{ca:process.env.SUPABASE_DB_CA.replace(/\\n/g,'\n')}:{})}};
}
export function createPostgresDatabase({connectionString,pool:injectedPool}={}){
 const pool=injectedPool||new Pool(poolConfig(connectionString));const context=new AsyncLocalStorage();let backgroundFailure=false;
 if(pool.on)pool.on('error',()=>{backgroundFailure=true});
 async function query(sql,args=[]){const result=await(context.getStore()||pool).query(postgresSQL(sql),args);return result;}
 const db={kind:'postgres',prepare(sql){return {async get(...args){return (await query(sql,args)).rows[0]},async all(...args){return (await query(sql,args)).rows},async run(...args){return {changes:(await query(sql,args)).rowCount}}}},
  async transaction(fn){if(context.getStore())return fn();const client=await pool.connect();try{await client.query('BEGIN');const result=await context.run(client,fn);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}},
  async check(){if(backgroundFailure)backgroundFailure=false;await pool.query('SELECT id FROM codehence.schema_migrations WHERE id=1').then(r=>{if(!r.rows.length)throw Error('Run npm run db:migrate first')})},
  async migrate(){const sql=readFileSync(new URL('../supabase/migrations/001_codehence.sql',import.meta.url),'utf8');const client=await pool.connect();try{await client.query('BEGIN');await client.query(sql);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}},
  close:()=>pool.end()};return addSharedState(db);
}
export async function createSQLiteDatabase(path){
 const {DatabaseSync}=await import('node:sqlite');if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});const native=new DatabaseSync(path);native.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'+schema);
 const context=new AsyncLocalStorage();let queue=Promise.resolve();
 async function locked(fn){if(context.getStore())return fn();const previous=queue;let unlock;queue=new Promise(r=>unlock=r);await previous;try{return await context.run(true,fn)}finally{unlock()}}
 const db={kind:'sqlite',prepare(sql){return {get:(...args)=>locked(()=>native.prepare(sql).get(...args)),all:(...args)=>locked(()=>native.prepare(sql).all(...args)),run:(...args)=>locked(()=>native.prepare(sql).run(...args))}},transaction:fn=>locked(async()=>{native.exec('BEGIN');try{const value=await fn();native.exec('COMMIT');return value}catch(e){native.exec('ROLLBACK');throw e}}),check:async()=>{},close:()=>locked(()=>native.close())};return addSharedState(db);
}
function addSharedState(db){
 db.consumeLimit=async(id,max,windowMs)=>{const now=Date.now();const r=await db.prepare('INSERT INTO request_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN request_limits.expires<=? THEN 1 ELSE request_limits.count+1 END,expires=CASE WHEN request_limits.expires<=? THEN ? ELSE request_limits.expires END RETURNING count,expires').get(id,now+windowMs,now,now,now+windowMs);return {allowed:r.count<=max,retryAfter:Math.max(1,Math.ceil((Number(r.expires)-now)/1000))}};
 db.acquireLease=async(id,token,ttl=120000)=>{const now=Date.now();const r=await db.prepare('INSERT INTO index_leases(id,token,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE index_leases.expires<=? RETURNING token').get(id,token,now+ttl,now);return r?.token===token};
 db.releaseLease=(id,token)=>db.prepare('DELETE FROM index_leases WHERE id=? AND token=?').run(id,token);
 db.leaseActive=async id=>!!await db.prepare('SELECT 1 FROM index_leases WHERE id=? AND expires>?').get(id,Date.now());
 return db;
}
