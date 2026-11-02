import {test} from 'node:test';import assert from 'node:assert/strict';import {createApp} from '../src/server.js';
const secret='test-admin-secret-at-least-24-characters';
test('catalog lifecycle, key scopes, tenant isolation, CORS and query filters',async t=>{
 const app=await createApp({dbPath:':memory:',adminKey:secret});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.close()});const base='http://127.0.0.1:'+app.server.address().port;
 async function call(path,key,body,method='POST',origin){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),headers:r.headers}}
 assert.equal((await call('/v1/stores','wrong',{name:'A'})).status,401);
 const a=(await call('/v1/stores',secret,{name:'A',allowedOrigins:['https://shop.example']})).data,b=(await call('/v1/stores',secret,{name:'B'})).data;const path='/v1/stores/'+a.id;
 const rows=[{id:'1',title:'Black Running Shoes',price:89,category:'Shoes',attributes:{color:'black'},inStock:true},{id:'2',title:'Green Running Shoes',price:129,category:'Shoes',attributes:{color:'green'},inStock:false},{id:'3',title:'Premium Black Shoes',price:199,category:'Shoes',attributes:{color:'black'}}];
 assert.equal((await call(path+'/products',a.searchKey,{products:rows},'PUT')).status,401);
 assert.equal((await call(path+'/products',a.writeKey,{products:rows},'PUT')).status,200);
 assert.equal((await call(path+'/search',b.searchKey,{query:''})).status,401);
 const found=await call(path+'/search',a.searchKey,{query:'black running shoes under $100'},'POST','https://shop.example');assert.equal(found.data.total,1);assert.equal(found.data.products[0].id,'1');assert.equal(found.headers.get('access-control-allow-origin'),'https://shop.example');
 assert.equal((await call(path+'/search',a.searchKey,{query:''},'POST','https://evil.example')).status,403);
 assert.equal((await call(path+'/search',a.searchKey,{query:'shoes',filters:{inStock:true,color:'green'}})).data.total,0);
 assert.equal((await call(path+'/search',a.searchKey,{query:'shoes between $100 and $150'})).data.total,1);
 assert.equal((await call(path+'/search',a.searchKey,{query:'shoes',pageSize:1,page:2})).data.products.length,1);
 assert.equal((await call(path+'/products',a.writeKey,{products:[{...rows[0],price:50},{id:'bad',title:'bad',price:-1}]},'PUT')).status,400);
 assert.equal((await call(path+'/search',a.searchKey,{query:'',filters:{priceMax:60}})).data.total,0,'invalid batch must be atomic');
 assert.equal((await call(path+'/products',a.writeKey,{products:[{...rows[0],price:59}]},'PUT')).status,200);
 assert.equal((await call(path+'/search',a.searchKey,{query:'shoes under $60'})).data.total,1);
 assert.equal((await call(path+'/products/1',a.writeKey,undefined,'DELETE')).data.deleted,1);
 assert.equal((await call(path+'/search',a.searchKey,{query:'shoes under $60'})).data.total,0);
 assert.equal((await call(path+'/search',a.searchKey,{query:'x',filters:{priceMax:'bad'}})).status,400);
 assert.equal((await call('/v1/stores/'+b.id+'/search',b.searchKey,{query:''})).data.total,0);
});
test('search request limits return 429',async t=>{const app=await createApp({dbPath:':memory:',adminKey:secret,rateLimit:1});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.close()});const base='http://127.0.0.1:'+app.server.address().port;const r=await fetch(base+'/v1/stores',{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({name:'Limited'})});const s=await r.json();const options={method:'POST',headers:{Authorization:'Bearer '+s.searchKey},body:JSON.stringify({query:''})};assert.equal((await fetch(base+'/v1/stores/'+s.id+'/search',options)).status,200);assert.equal((await fetch(base+'/v1/stores/'+s.id+'/search',options)).status,429)});
