import {createHash} from 'node:crypto';
import {searchProducts,parseQuery} from './search.js';
export const productText=p=>[p.title,p.description,p.category,p.brand,...Object.entries(p.attributes).map(([k,v])=>k+': '+v)].join('\n').slice(0,6000);
export const contentHash=p=>createHash('sha256').update(productText(p)).digest('hex');
export function createEmbeddingProvider({apiKey=process.env.OPENAI_API_KEY,model=process.env.CODEHENCE_EMBEDDING_MODEL||'text-embedding-3-small',fetchImpl=fetch}={}){
 if(!apiKey)return null;
 return {model,async embed(input){
  const r=await fetchImpl('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,input,encoding_format:'float'}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Embedding service unavailable');const b=await r.json();
  if(!Array.isArray(b.data)||b.data.length!==input.length)throw Error('Invalid embedding response');
  const sorted=[...b.data].sort((a,b)=>a.index-b.index);const dimension=sorted[0]?.embedding?.length;
  if(!dimension||sorted.some((x,i)=>x.index!==i||!Array.isArray(x.embedding)||x.embedding.length!==dimension||x.embedding.some(v=>!Number.isFinite(v))||!x.embedding.some(v=>v!==0)))throw Error('Invalid embedding vectors');
  return sorted.map(x=>x.embedding);
 }};
}
export function cosine(a,b){if(a.length!==b.length)return -1;let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]**2;nb+=b[i]**2;}return na&&nb?dot/Math.sqrt(na*nb):-1;}
export function hybridSearch(products,query,filters,page,pageSize,vectors,queryVector){
 const lexical=searchProducts(products,query,filters,1,Math.max(1,products.length));
 const effective={...parseQuery(query).filters,...filters};
 const eligible=searchProducts(products,'',effective,1,Math.max(1,products.length)).products;
 const semantic=eligible.filter(p=>vectors.has(p.id)).map(p=>({p,score:cosine(queryVector,vectors.get(p.id))})).filter(x=>x.score>=.3).sort((a,b)=>b.score-a.score).slice(0,100);
 const scores=new Map(),items=new Map();for(const list of [lexical.products.slice(0,100),semantic.map(x=>x.p)])list.forEach((p,i)=>{scores.set(p.id,(scores.get(p.id)||0)+1/(60+i+1));items.set(p.id,p)});
 const rows=[...items.values()].sort((a,b)=>(b.id.toLowerCase()===query.toLowerCase()?1:0)-(a.id.toLowerCase()===query.toLowerCase()?1:0)||(scores.get(b.id)-scores.get(a.id))||a.id.localeCompare(b.id));
 const categories={};for(const p of rows)categories[p.category]=(categories[p.category]||0)+1;
 return {products:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,interpretedFilters:effective,facets:{categories},engine:'hybrid-rrf-v1',semanticSearch:true,candidateLimit:100};
}
