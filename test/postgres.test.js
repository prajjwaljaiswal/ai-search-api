import {test} from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {createPostgresDatabase,poolConfig} from '../src/database.js';import {createApp} from '../src/server.js';
import {DatabaseSync} from 'node:sqlite';import {schema} from '../src/database.js';import {importSQLite} from '../src/import-sqlite.js';
async function testDatabase(){const pg=new PGlite();let tail=Promise.resolve();async function reserve(){let release;const previous=tail;tail=new Promise(r=>release=r);await previous;return release}const query=async(text,args)=>{const r=args?.length?await pg.query(text,args):await pg.exec(text);const result=Array.isArray(r)?r.at(-1):r;return {rows:result?.rows||[],rowCount:result?.affectedRows||0}};const pool={async query(...args){const unlock=await reserve();try{return await query(...args)}finally{unlock()}},async connect(){const release=await reserve();return {query,release}},end:()=>pg.close()};const db=createPostgresDatabase({pool});await db.migrate();return db;}
test('Supabase/PostgreSQL adapter: schema, sessions, tenants, transactions, limits and indexing',async t=>{
 const db=await testDatabase();await db.migrate();let broken=false;const provider={model:'pg-test',async embed(texts){if(broken)throw Error('offline');return texts.map(()=>[1,0])}};
 const app=await createApp({database:db,adminKey:'postgres-test-admin-long-secret',embeddingProvider:provider,rateLimit:200});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.close()});const base='http://127.0.0.1:'+app.server.address().port;
 async function call(path,{cookie,key,body,method=body===undefined?'GET':'POST',origin=base}={}){const r=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(key?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const a=await call('/account/register',{body:{email:'pg-a@example.com',password:'postgres-password-123'}}),b=await call('/account/register',{body:{email:'pg-b@example.com',password:'postgres-password-456'}});assert.equal(a.status,201);assert.equal((await call('/account/login',{body:{email:'pg-a@example.com',password:'postgres-password-123'}})).status,200);
 const s=(await call('/v1/stores',{cookie:a.cookie,body:{name:'PG Store',allowedOrigins:['https://shop.example']}})).data;assert.ok(s.id);
 const listing=await call('/account/stores',{cookie:a.cookie});assert.equal(listing.data.stores[0].searchKey,s.searchKey,'camelCase alias survives PostgreSQL folding');
 const path='/v1/stores/'+s.id;
 assert.equal((await call(path+'/products',{cookie:b.cookie})).status,401);
 const product={id:'bag',title:'Waterproof Backpack',price:79,attributes:{color:'black'}};
 assert.equal((await call(path+'/products',{cookie:a.cookie,method:'PUT',body:{products:[product]}})).status,200);
 assert.equal((await call(path+'/products',{key:s.searchKey,method:'PUT',body:{products:[product]}})).status,401);
 assert.equal((await call(path+'/search',{key:s.searchKey,origin:'https://shop.example',body:{query:'black backpack under $100'}})).data.total,1);
 assert.equal((await call(path+'/search',{key:s.searchKey,origin:'https://evil.example',body:{query:''}})).status,403);
 assert.equal((await call(path+'/settings',{cookie:a.cookie,method:'PATCH',body:{name:'Updated PG',allowedOrigins:['https://new.example']}})).status,200);
 assert.equal((await call(path+'/semantic/index',{cookie:a.cookie,body:{}})).data.indexed,1);
 assert.equal((await call(path+'/search',{cookie:a.cookie,body:{query:'rainy journey under $100'}})).data.semanticSearch,true);
 broken=true;assert.equal((await call(path+'/search',{cookie:a.cookie,body:{query:'backpack'}})).data.fallbackReason,'embedding_service_unavailable');
 await assert.rejects(db.transaction(async()=>{await db.prepare('UPDATE stores SET name=? WHERE id=?').run('Must rollback',s.id);throw Error('fail')}));assert.equal((await db.prepare('SELECT name FROM stores WHERE id=?').get(s.id)).name,'Updated PG');
 const limits=await Promise.all(Array.from({length:6},()=>db.consumeLimit('concurrent-limit',3,60000)));assert.equal(limits.filter(x=>x.allowed).length,3);
 assert.equal(await db.acquireLease('exclusive','one'),true);assert.equal(await db.acquireLease('exclusive','two'),false);await db.releaseLease('exclusive','wrong-token');assert.equal(await db.leaseActive('exclusive'),true);await db.releaseLease('exclusive','one');assert.equal(await db.leaseActive('exclusive'),false);
 assert.equal((await call(path+'/products/bag',{cookie:a.cookie,method:'DELETE'})).data.deleted,1);assert.equal((await call(path+'/semantic/status',{cookie:a.cookie})).data.indexed,0);
 await call('/account/logout',{cookie:a.cookie,body:{}});assert.equal((await call('/account/me',{cookie:a.cookie})).status,401);
});
test('PostgreSQL TLS verifies server certificates and strips conflicting URI overrides',()=>{const c=poolConfig('postgresql://user:secret@db.example:6543/postgres?sslmode=disable');assert.equal(c.ssl.rejectUnauthorized,true);assert.ok(!c.connectionString.includes('sslmode'));assert.equal(c.max,3);assert.throws(()=>poolConfig('https://example.com'))});
test('SQLite cutover preserves credentials and catalog; rejects populated targets and rolls back partial imports',async t=>{
 const db=await testDatabase();const source=new DatabaseSync(':memory:');source.exec(schema);t.after(async()=>{source.close();await db.close()});
 source.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?)').run('legacy','Legacy Store','USD','hashed-search','hashed-write','[]');
 source.prepare('INSERT INTO accounts VALUES(?,?,?)').run('merchant','merchant@example.com','existing-scrypt-hash');
 source.prepare('INSERT INTO store_access VALUES(?,?,?)').run('legacy','merchant','public-search-key');
 source.prepare('INSERT INTO products VALUES(?,?,?)').run('legacy','sku-1',JSON.stringify({id:'sku-1',title:'Bag',price:79}));
 source.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session','merchant',Date.now()+100000);
 const counts=await importSQLite(source,db);assert.equal(counts.products,1);assert.equal((await db.prepare('SELECT password FROM accounts WHERE id=?').get('merchant')).password,'existing-scrypt-hash');assert.equal((await db.prepare('SELECT write_hash FROM stores WHERE id=?').get('legacy')).write_hash,'hashed-write');assert.equal((await db.prepare('SELECT count(*) AS count FROM sessions').get()).count,0);assert.equal(source.prepare('SELECT count(*) AS count FROM products').get().count,1);
 await assert.rejects(importSQLite(source,db),/Target must be empty/);
 await db.prepare('DELETE FROM stores').run();await db.prepare('DELETE FROM accounts').run();
 source.exec('PRAGMA foreign_keys=OFF');source.prepare('INSERT INTO products VALUES(?,?,?)').run('missing-parent','invalid','{}');
 await assert.rejects(importSQLite(source,db));assert.equal((await db.prepare('SELECT count(*) AS count FROM stores').get()).count,0,'failed import must roll back already inserted stores');
});
