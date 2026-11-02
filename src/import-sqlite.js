export async function importSQLite(source,target){
 const order=['stores','accounts','products','store_access','embeddings'];
 await target.check();source.exec('BEGIN');const counts={};
 try{await target.transaction(async()=>{
  await target.prepare('LOCK TABLE '+order.join(',')+' IN SHARE ROW EXCLUSIVE MODE').run();
  for(const table of order){const row=await target.prepare('SELECT count(*) AS count FROM '+table).get();if(Number(row.count)!==0)throw Error('Target must be empty; import will not overwrite existing data');}
  for(const table of order){counts[table]=0;const exists=source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);if(!exists)continue;for(const row of source.prepare('SELECT * FROM '+table).all()){const columns=Object.keys(row);await target.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));counts[table]++}}
 });source.exec('COMMIT');return counts;}catch(e){source.exec('ROLLBACK');throw e}
}
