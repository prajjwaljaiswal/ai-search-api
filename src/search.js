const aliases={sneakers:'shoe',shoes:'shoe',runners:'shoe',bags:'backpack',bag:'backpack',headphones:'headphone',earphones:'headphone',rainy:'waterproof',commute:'backpack'};
const stop=new Set(['a','an','the','for','with','me','show','find','i','want','some','something','under','below','less','than','over','above','between','and','to','up','in','dollars']);
const token=s=>s.toLowerCase().match(/[a-z0-9]+/g)||[];
export function parseQuery(query){
 const filters={};let text=query.toLowerCase();
 const max=text.match(/(?:under|below|less than|up to)\s*\$?\s*(\d+(?:\.\d+)?)/);if(max)filters.priceMax=Number(max[1]);
 const min=text.match(/(?:over|above|more than)\s*\$?\s*(\d+(?:\.\d+)?)/);if(min)filters.priceMin=Number(min[1]);
 const range=text.match(/between\s*\$?(\d+(?:\.\d+)?)\s*(?:and|to)\s*\$?(\d+(?:\.\d+)?)/);if(range){filters.priceMin=Number(range[1]);filters.priceMax=Number(range[2]);}
 const color=text.match(/\b(black|white|green|blue|red|pink|brown|grey|gray|cream)\b/);if(color)filters.color=color[1]==='gray'?'grey':color[1];
 if(/\bin stock\b/.test(text))filters.inStock=true;
 text=text.replace(/(?:under|below|less than|up to|over|above|more than)\s*\$?\s*\d+(?:\.\d+)?/g,' ').replace(/between\s*\$?\d+(?:\.\d+)?\s*(?:and|to)\s*\$?\d+(?:\.\d+)?/g,' ').replace(/\bin stock\b/g,' ');
 const terms=token(text).filter(w=>!stop.has(w)&&w!==color?.[1]).map(w=>aliases[w]||w);
 return {filters,terms};
}
export function searchProducts(products,query,explicit={},page=1,pageSize=12){
 const parsed=parseQuery(query);const filters={...parsed.filters,...explicit};
 const ranked=products.filter(p=>(filters.priceMin===undefined||p.price>=filters.priceMin)&&(filters.priceMax===undefined||p.price<=filters.priceMax)&&(!filters.color||p.attributes.color?.toLowerCase()===filters.color.toLowerCase())&&(!filters.category||p.category.toLowerCase()===filters.category.toLowerCase())&&(filters.inStock===undefined||p.inStock===filters.inStock)).map(p=>{
  const title=token(p.title).map(w=>aliases[w]||w);const body=token([p.description,p.category,p.brand,...Object.values(p.attributes)].join(' ')).map(w=>aliases[w]||w);
  const matched=parsed.terms.filter(t=>title.some(w=>w===t||w.startsWith(t))||body.some(w=>w===t||w.startsWith(t)));
  const score=matched.reduce((n,t)=>n+(title.includes(t)?4:1),0)+(p.id.toLowerCase()===query.toLowerCase()?100:0);
  return {p,score,matched:matched.length};
 }).filter(x=>!parsed.terms.length||x.matched>0||x.score>=100).sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id));
 const categories={};for(const {p} of ranked)categories[p.category]=(categories[p.category]||0)+1;
 return {products:ranked.slice((page-1)*pageSize,page*pageSize).map(x=>x.p),total:ranked.length,page,pageSize,interpretedFilters:filters,facets:{categories},engine:'lexical-rules-v1',semanticSearch:false};
}
