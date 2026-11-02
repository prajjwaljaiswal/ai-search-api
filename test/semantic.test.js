import {test} from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';import {createEmbeddingProvider} from '../src/semantic.js';
import '../public/catalog.js';
test('CSV parser handles quoted commas, multiline values, BOM and rejects malformed rows',()=>{
 const parse=globalThis.CodehenceCatalog.parseCSV;const r=parse('\uFEFFid,title,price,inStock,attributes.color\r\n1,"Bag, everyday\nwaterproof",79,true,black\r\n');assert.equal(r.products[0].title,'Bag, everyday\nwaterproof');assert.equal(r.products[0].attributes.color,'black');assert.equal(r.products[0].inStock,true);
 for(const csv of ['id,title,price\n1,bag,','id,title,price\n1,bag,no','id,title,price\n1,"bag,79','id,title,price\n1,bag,79,extra','id,id,title,price\n1,1,a,3'])assert.throws(()=>parse(csv));
});
test('embedding HTTP adapter orders vectors and rejects corrupt provider data',async()=>{
 let seen;const p=createEmbeddingProvider({apiKey:'test-only',fetchImpl:async(url,init)=>{seen=JSON.parse(init.body);return {ok:true,json:async()=>({data:[{index:1,embedding:[0,1]},{index:0,embedding:[1,0]}]})}}});assert.deepEqual(await p.embed(['one','two']),[[1,0],[0,1]]);assert.equal(seen.encoding_format,'float');
 const bad=createEmbeddingProvider({apiKey:'test-only',fetchImpl:async()=>({ok:true,json:async()=>({data:[{index:0,embedding:[0,0]}]})})});await assert.rejects(bad.embed(['one']));
});
test('semantic lifecycle: hard filters, store isolation, stale vectors, updates and fallback',async t=>{
 let broken=false,calls=0;const provider={model:'test-model',async embed(texts){calls++;if(broken)throw Error('offline');return texts.map(text=>/backpack|rain|commut/i.test(text)?[1,0]:[0,1])}};
 const app=await createApp({dbPath:':memory:',adminKey:'test-secret-24-characters-minimum',embeddingProvider:provider});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.close()});const base='http://127.0.0.1:'+app.server.address().port;
 const call=async(path,key,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+key},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const a=(await call('/v1/stores','test-secret-24-characters-minimum',{name:'A'})).data;const b=(await call('/v1/stores','test-secret-24-characters-minimum',{name:'B'})).data;const path='/v1/stores/'+a.id;
 const bag={id:'bag',title:'Metro Backpack',description:'For commuting',price:79,attributes:{color:'black'}};await call(path+'/products',a.writeKey,{products:[bag,{id:'expensive',title:'Premium Backpack',price:299,attributes:{color:'black'}}]},'PUT');
 assert.equal((await call(path+'/semantic/index',a.searchKey,{})).status,401);
 assert.equal((await call(path+'/semantic/index',a.writeKey,{})).data.indexed,2);
 const previous=calls;assert.equal((await call(path+'/semantic/index',a.writeKey,{})).data.indexed,0);assert.equal(calls,previous,'unchanged products must not be re-embedded');
 const result=(await call(path+'/search',a.searchKey,{query:'rainy journey under $100'})).data;assert.equal(result.semanticSearch,true);assert.deepEqual(result.products.map(p=>p.id),['bag']);
 assert.equal((await call('/v1/stores/'+b.id+'/search',b.searchKey,{query:'rainy journey'})).data.total,0);
 await call(path+'/products',a.writeKey,{products:[{...bag,price:85}]},'PUT');assert.equal((await call(path+'/semantic/status',a.writeKey,undefined,'GET')).data.indexed,2,'price update keeps vector');
 await call(path+'/products',a.writeKey,{products:[{...bag,title:'Renamed Backpack'}]},'PUT');assert.equal((await call(path+'/semantic/status',a.writeKey,undefined,'GET')).data.pending,1);
 await call(path+'/semantic/index',a.writeKey,{});broken=true;const fallback=(await call(path+'/search',a.searchKey,{query:'backpack under $100'})).data;assert.equal(fallback.semanticSearch,false);assert.equal(fallback.fallbackReason,'embedding_service_unavailable');assert.equal(fallback.total,1);
});
