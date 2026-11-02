(function(root){
 function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;}else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}}else if(c==='"'){if(field||closed)throw Error('Invalid CSV quote');quoted=true;}else{if(closed)throw Error('Unexpected character after CSV quote');field+=c;}}
  if(quoted)throw Error('Unclosed CSV quote');if(field||row.length){row.push(field);if(row.some(v=>v.trim()))rows.push(row)}
  if(rows.length<2)throw Error('CSV needs a header and product rows');const headers=rows.shift().map(x=>x.trim());if(new Set(headers).size!==headers.length)throw Error('Duplicate CSV headers');
  for(const required of ['id','title','price'])if(!headers.includes(required))throw Error('Missing CSV column: '+required);
  return {products:rows.map((cells,index)=>{if(cells.length!==headers.length)throw Error('CSV row '+(index+2)+': column count mismatch');const p={attributes:{}};headers.forEach((h,i)=>{const value=cells[i];if(h==='price'){if(!value.trim()||!Number.isFinite(Number(value))||Number(value)<0)throw Error('CSV row '+(index+2)+': invalid price');p.price=Number(value)}else if(h==='inStock'){if(value&&!['true','false'].includes(value.toLowerCase()))throw Error('CSV row '+(index+2)+': inStock must be true/false');if(value)p.inStock=value.toLowerCase()==='true'}else if(h.startsWith('attributes.')){if(value)p.attributes[h.slice(11)]=value}else if(['id','title','description','category','brand','currency','url','imageUrl'].includes(h)){if(value)p[h]=value}else if(h)throw Error('Unknown column: '+h)});return p})};
 }
 root.CodehenceCatalog={parseCSV};
})(typeof window==='undefined'?globalThis:window);
