import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {createPostgresDatabase} from '../src/database.js';
import {importSQLite} from '../src/import-sqlite.js';
if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL first');
const path=resolve(process.env.CODEHENCE_SQLITE_IMPORT_PATH||'data/codehence.sqlite');
const source=new DatabaseSync(path,{readOnly:true});const target=createPostgresDatabase({connectionString:process.env.DATABASE_URL});
try{
 const counts=await importSQLite(source,target);console.log('Imported: '+JSON.stringify(counts));console.log('Local source unchanged. Sign in again; sessions are not migrated.');
}catch(e){try{source.exec('ROLLBACK')}catch{}console.error('Import failed and target transaction rolled back. '+(e.message?.startsWith('Target must')?e.message:'Check source, target schema and permissions. Code: '+(e.code||'unknown')));process.exitCode=1}finally{source.close();await target.close()}
