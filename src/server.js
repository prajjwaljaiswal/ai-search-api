import http from 'node:http';
import {createPostgresDatabase,createSQLiteDatabase} from './database.js';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {searchProducts} from './search.js';
import {createAuth} from './auth.js';
import {createEmbeddingProvider,productText,contentHash,hybridSearch} from './semantic.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=v=>createHash('sha256').update(v).digest('hex');
const key=prefix=>prefix+randomBytes(24).toString('hex');
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export async function createApp({database,databaseUrl=process.env.DATABASE_URL,dbPath=process.env.CODEHENCE_DB_PATH||resolve(root,'data/codehence.sqlite'),adminKey=process.env.CODEHENCE_ADMIN_KEY,rateLimit=120,embeddingProvider=createEmbeddingProvider()}={}){
 if(!adminKey||adminKey.length<24)throw new Error('Set CODEHENCE_ADMIN_KEY to a random secret of at least 24 characters.');
 const db=database||(databaseUrl&&dbPath!==':memory:'?createPostgresDatabase({connectionString:databaseUrl}):await createSQLiteDatabase(dbPath));
 try{await db.check()}catch(e){await db.close();throw new Error('Database unavailable or schema missing. Run npm run db:migrate and check DATABASE_URL. Code: '+(e.code||'unknown'))}
 const auth=createAuth(db,{production:process.env.NODE_ENV==='production',publicOrigin:process.env.CODEHENCE_PUBLIC_ORIGIN});

 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const equal=(a,b)=>{const x=Buffer.from(hash(a)),y=Buffer.from(hash(b));return timingSafeEqual(x,y);};
 async function body(req){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>2_000_000)throw new ApiError(413,'Request exceeds 2 MB');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString())}catch{throw new ApiError(400,'Invalid JSON body');}}
 function product(p,currency){
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id.trim()||p.id.length>150||typeof p.title!=='string'||!p.title.trim()||p.title.length>500)throw new ApiError(400,'Each product needs an id and title (max 150/500 characters)');
  if(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<0)throw new ApiError(400,'Product price must be a non-negative number');
  if(p.currency&&p.currency!==currency)throw new ApiError(400,'Product currency must match store currency');
  if(p.inStock!==undefined&&typeof p.inStock!=='boolean')throw new ApiError(400,'inStock must be boolean');
  const attributes=p.attributes??{};if(typeof attributes!=='object'||Array.isArray(attributes)||attributes===null||Object.keys(attributes).length>50||Object.values(attributes).some(v=>typeof v!=='string'||v.length>500))throw new ApiError(400,'Attributes must contain up to 50 string values');
  for(const field of ['description','category','brand','imageUrl','url'])if(p[field]!==undefined&&(typeof p[field]!=='string'||p[field].length>10000))throw new ApiError(400,'Invalid '+field);
  for(const field of ['imageUrl','url'])if(p[field]){try{if(!['http:','https:'].includes(new URL(p[field]).protocol))throw Error()}catch{throw new ApiError(400,field+' must be an HTTP(S) URL')}}
  return {id:p.id,title:p.title,price:p.price,currency,inStock:p.inStock??true,description:p.description??'',category:p.category??'Other',brand:p.brand??'',attributes,imageUrl:p.imageUrl??'',url:p.url??''};
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const url=new URL(req.url,'http://localhost');const path=url.pathname;
   if(req.method==='GET'&&path==='/health'){await db.check();return json(res,200,{status:'ok',version:'0.1.0',database:db.kind});}
   if(req.method==='GET'&&path==='/public-config')return json(res,200,{integrationOrigin:process.env.CODEHENCE_PUBLIC_ORIGIN||'https://api.codehence.com'});
   const files={'/':['index.html','text/html'],'/docs':['docs.html','text/html'],'/docs/':['docs.html','text/html'],'/docs.html':['docs.html','text/html'],'/widget.js':['widget.js','text/javascript'],'/dashboard.js':['dashboard.js','text/javascript'],'/style.css':['style.css','text/css'],'/catalog.js':['catalog.js','text/javascript'],'/catalog-template.csv':['catalog-template.csv','text/csv']};
   if(req.method==='GET'&&files[path]){res.writeHead(200,{'Content-Type':files[path][1]+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'"});return res.end(readFileSync(resolve(root,'public',files[path][0])));}
   if(await auth.handle(req,res,path,body,json))return;
   const account=await auth.user(req);
   const token=req.headers.authorization?.replace(/^Bearer /i,'')||'';
   if(req.method==='POST'&&path==='/v1/stores'){
    if(account)auth.csrf(req);else if(!equal(token,adminKey))throw new ApiError(401,'Invalid admin credential');const b=await body(req);
    if(typeof b.name!=='string'||!b.name.trim()||b.name.length>120)throw new ApiError(400,'Store name is required (max 120 characters)');
    const currency=b.currency??'USD';if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw new ApiError(400,'Use a three-letter uppercase currency code');
    let origins=b.allowedOrigins??[];if(!Array.isArray(origins)||origins.length>20)throw new ApiError(400,'allowedOrigins must be an array, max 20');
    origins=origins.map(o=>{try{const u=new URL(o);if(!['http:','https:'].includes(u.protocol)||u.origin!==o)throw Error();return o}catch{throw new ApiError(400,'Use exact HTTP(S) origins, without trailing slash')}});
    const id=key('store_'),searchKey=key('chs_'),writeKey=key('chw_');await db.transaction(async()=>{await db.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?)').run(id,b.name,currency,hash(searchKey),hash(writeKey),JSON.stringify(origins));if(account)await auth.link(account,id,searchKey);});
    return json(res,201,{id,name:b.name,currency,searchKey,writeKey,allowedOrigins:origins});
   }
   const match=path.match(/^\/v1\/stores\/([^/]+)(?:\/(.*))?$/);if(!match)throw new ApiError(404,'Route not found');
   const store=(await db.prepare('SELECT * FROM stores WHERE id=?').get(match[1]));if(!store)throw new ApiError(401,'Invalid store or credential');
   const owner=await auth.owns(account,store.id);if(owner)auth.csrf(req);
   const isSearch=match[2]==='search';const origin=req.headers.origin;const origins=JSON.parse(store.origins);
   if(origin&&isSearch&&!owner){if(!origins.includes(origin))throw new ApiError(403,'Origin is not allowed');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}}
   const write=owner||hash(token)===store.write_hash;
   if(!write&&(!token||!isSearch||hash(token)!==store.search_hash))throw new ApiError(401,'Invalid credential or insufficient permission');
   const limit=await db.consumeLimit('store:'+store.id+':'+(isSearch?'search':'write'),rateLimit,60000);if(!limit.allowed){res.setHeader('Retry-After',String(limit.retryAfter));throw new ApiError(429,'Store request limit reached');}
   if(match[2]==='settings'&&req.method==='GET')return json(res,200,{id:store.id,name:store.name,currency:store.currency,allowedOrigins:origins});
   if(match[2]==='settings'&&req.method==='PATCH'){
    const b=await body(req);if(typeof b.name!=='string'||!b.name.trim()||b.name.length>120||!Array.isArray(b.allowedOrigins)||b.allowedOrigins.length>20)throw new ApiError(400,'Supply a store name and up to 20 allowed origins');
    const next=[...new Set(b.allowedOrigins.map(o=>{try{const u=new URL(o);if(typeof o!=='string'||!['http:','https:'].includes(u.protocol)||u.origin!==o)throw Error();return o}catch{throw new ApiError(400,'Use exact HTTP(S) origins without a path or trailing slash')}}))];
    (await db.prepare('UPDATE stores SET name=?,origins=? WHERE id=?').run(b.name.trim(),JSON.stringify(next),store.id));return json(res,200,{saved:true});
   }
   if(isSearch&&req.method==='POST'){
    const b=await body(req);if(typeof b.query!=='string'||b.query.length>500)throw new ApiError(400,'query must be a string up to 500 characters');
    const page=b.page??1,pageSize=b.pageSize??12;if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new ApiError(400,'Invalid pagination');
    const f=b.filters??{};if(typeof f!=='object'||f===null||Array.isArray(f))throw new ApiError(400,'filters must be an object');
    for(const k of Object.keys(f)){if(!['priceMin','priceMax','color','category','inStock'].includes(k))throw new ApiError(400,'Unsupported filter: '+k);if(['priceMin','priceMax'].includes(k)&&(typeof f[k]!=='number'||!Number.isFinite(f[k])||f[k]<0))throw new ApiError(400,'Invalid price filter');if(['color','category'].includes(k)&&(typeof f[k]!=='string'||f[k].length>200))throw new ApiError(400,'Invalid text filter');if(k==='inStock'&&typeof f[k]!=='boolean')throw new ApiError(400,'Invalid inStock filter');}
        const products=(await db.prepare('SELECT payload FROM products WHERE store_id=?').all(store.id)).map(x=>JSON.parse(x.payload));
    const result=searchProducts(products,b.query,f,page,pageSize);
    if(embeddingProvider&&b.query.trim()){
     const saved=(await db.prepare('SELECT product_id,content_hash,vector FROM embeddings WHERE store_id=? AND model=?').all(store.id,embeddingProvider.model));
     const byId=new Map(products.map(p=>[p.id,p]));const vectors=new Map(saved.filter(v=>byId.has(v.product_id)&&contentHash(byId.get(v.product_id))===v.content_hash).map(v=>[v.product_id,JSON.parse(v.vector)]));
     if(vectors.size){try{const [q]=await embeddingProvider.embed([b.query]);return json(res,200,{...hybridSearch(products,b.query,f,page,pageSize,vectors,q),indexedProducts:vectors.size})}catch{result.fallbackReason='embedding_service_unavailable'}}else result.fallbackReason='catalog_not_indexed';
    }
    return json(res,200,result);
   }
      if(match[2]==='semantic/status'&&req.method==='GET'){
    const rows=(await db.prepare('SELECT payload FROM products WHERE store_id=?').all(store.id)).map(x=>JSON.parse(x.payload));
    const saved=embeddingProvider?(await db.prepare('SELECT product_id,content_hash FROM embeddings WHERE store_id=? AND model=?').all(store.id,embeddingProvider.model)):[];
    const byId=new Map(rows.map(p=>[p.id,p]));const indexed=saved.filter(v=>byId.has(v.product_id)&&contentHash(byId.get(v.product_id))===v.content_hash).length;
    return json(res,200,{configured:!!embeddingProvider,model:embeddingProvider?.model??null,products:rows.length,indexed,pending:rows.length-indexed,indexing:await db.leaseActive(store.id)});
   }
   if(match[2]==='semantic/index'&&req.method==='POST'){
    if(!embeddingProvider)throw new ApiError(409,'Set OPENAI_API_KEY on the server and restart to enable semantic indexing');
    const lease=key('lease_');if(!await db.acquireLease(store.id,lease))throw new ApiError(409,'Indexing is already running for this store');let indexed=0;
    try{
     const rows=(await db.prepare('SELECT payload FROM products WHERE store_id=?').all(store.id)).map(x=>JSON.parse(x.payload));
     const saved=new Map((await db.prepare('SELECT product_id,content_hash FROM embeddings WHERE store_id=? AND model=?').all(store.id,embeddingProvider.model)).map(x=>[x.product_id,x.content_hash]));
     const pending=rows.filter(p=>saved.get(p.id)!==contentHash(p));
     const save=db.prepare('INSERT INTO embeddings VALUES(?,?,?,?,?) ON CONFLICT(store_id,product_id,model) DO UPDATE SET content_hash=excluded.content_hash,vector=excluded.vector');
     for(let i=0;i<Math.min(pending.length,100);i+=20){const batch=pending.slice(i,Math.min(i+20,100));const vectors=await embeddingProvider.embed(batch.map(productText));
      await db.transaction(async()=>{for(const [j,p] of batch.entries()){const current=(await db.prepare('SELECT payload FROM products WHERE store_id=? AND id=?').get(store.id,p.id));if(current&&contentHash(JSON.parse(current.payload))===contentHash(p)){await save.run(store.id,p.id,embeddingProvider.model,contentHash(p),JSON.stringify(vectors[j]));indexed++}}});
     }
     return json(res,200,{indexed,remaining:Math.max(0,pending.length-100),model:embeddingProvider.model});
    }catch(e){if(e.status)throw e;throw new ApiError(502,'Embedding service failed; retry indexing. Completed batches are preserved.')}finally{await db.releaseLease(store.id,lease)}
   }
   if(match[2]==='products'&&req.method==='PUT'){
    const b=await body(req);if(!Array.isArray(b.products)||b.products.length<1||b.products.length>1000)throw new ApiError(400,'Supply 1–1,000 products per batch');
    const rows=b.products.map(p=>product(p,store.currency));const upsert=db.prepare('INSERT INTO products VALUES(?,?,?) ON CONFLICT(store_id,id) DO UPDATE SET payload=excluded.payload');await db.transaction(async()=>{for(const p of rows)await upsert.run(store.id,p.id,JSON.stringify(p));});return json(res,200,{upserted:rows.length});
   }
   if(match[2]==='products'&&req.method==='GET')return json(res,200,{products:(await db.prepare('SELECT payload FROM products WHERE store_id=? LIMIT 1000').all(store.id)).map(x=>JSON.parse(x.payload))});
   if(match[2]?.startsWith('products/')&&req.method==='DELETE'){const id=decodeURIComponent(match[2].slice(9));const result=(await db.prepare('DELETE FROM products WHERE store_id=? AND id=?').run(store.id,id));return json(res,200,{deleted:Number(result.changes)});}
   throw new ApiError(404,'Route not found');
  }catch(e){if(!res.headersSent)json(res,e.status??500,{error:e.status?e.message:'Internal server error'});else res.end();}
 });
 return {server,database:db.kind,close:()=>db.close()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();const port=Number(process.env.PORT??4300);app.server.listen(port,'127.0.0.1',()=>console.log(`Codehence MVP: http://127.0.0.1:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(async()=>{await app.close();process.exit(0)}));
}
