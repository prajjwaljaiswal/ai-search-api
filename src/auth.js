import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);const hash=s=>createHash('sha256').update(s).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
export function createAuth(db,{production=false,publicOrigin}={}){

 function cookie(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ch_session='))?.slice(11)||''}
 async function user(req){const token=cookie(req);if(!token)return null;return (await db.prepare('SELECT a.id,a.email FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>?').get(hash(token),Date.now()))??null}
 function csrf(req){if(!['GET','HEAD','OPTIONS'].includes(req.method)){const expected=publicOrigin||'http://'+req.headers.host;if(req.headers.origin!==expected)throw error(403,'Request origin is not allowed');}}
 async function owns(account,id){return !!account&&!!(await db.prepare('SELECT 1 FROM store_access WHERE store_id=? AND account_id=?').get(id,account.id))}
 async function link(account,id,searchKey){(await db.prepare('INSERT INTO store_access VALUES(?,?,?) ON CONFLICT(store_id) DO NOTHING').run(id,account.id,searchKey))}
 async function setSession(res,id){const token=randomBytes(32).toString('hex');(await db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now()));(await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,Date.now()+7*86400000));res.setHeader('Set-Cookie',`ch_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${production?'; Secure':''}`)}
 async function handle(req,res,path,body,json){
  if(!path.startsWith('/account/'))return false;
  csrf(req);let account=await user(req);
  if(['/account/register','/account/login'].includes(path)&&req.method==='POST'){
   const attempt=await db.consumeLimit('signin:'+hash(req.socket.remoteAddress||'unknown'),20,600000);if(!attempt.allowed)throw error(429,'Too many sign-in attempts; try again later');
   const b=await body(req);const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw error(400,'Use a valid email and a password of 12–128 characters');
   if(path.endsWith('/register')){
    const salt=randomBytes(16).toString('hex'),derived=await scrypt(b.password,salt,64);const id=randomBytes(24).toString('hex');
    try{(await db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(id,email,salt+':'+derived.toString('hex')))}catch{throw error(409,'Account could not be created; try signing in')}
    await setSession(res,id);json(res,201,{id,email});return true;
   }
   const row=(await db.prepare('SELECT * FROM accounts WHERE email=?').get(email));const [salt,value]=(row?.password||'00000000000000000000000000000000:'+ '0'.repeat(128)).split(':');const actual=await scrypt(b.password,salt,64);if(!row||!timingSafeEqual(actual,Buffer.from(value,'hex')))throw error(401,'Invalid email or password');await setSession(res,row.id);json(res,200,{id:row.id,email:row.email});return true;
  }
  if(!account)throw error(401,'Sign in to continue');
  if(path==='/account/me'&&req.method==='GET'){json(res,200,account);return true}
  if(path==='/account/logout'&&req.method==='POST'){(await db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookie(req))));res.setHeader('Set-Cookie',`ch_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);json(res,200,{signedOut:true});return true}
  if(path==='/account/stores'&&req.method==='GET'){json(res,200,{stores:(await db.prepare('SELECT s.id,s.name,s.currency,a.search_key AS "searchKey" FROM stores s JOIN store_access a ON a.store_id=s.id WHERE a.account_id=?').all(account.id))});return true}
  if(path==='/account/claim-store'&&req.method==='POST'){
   const b=await body(req);if(typeof b.storeId!=='string'||typeof b.writeKey!=='string'||typeof b.searchKey!=='string')throw error(400,'Store ID and both existing keys are required');const row=(await db.prepare('SELECT * FROM stores WHERE id=?').get(b.storeId));if(!row||row.write_hash!==hash(b.writeKey)||row.search_hash!==hash(b.searchKey))throw error(401,'Invalid store credentials');const owner=(await db.prepare('SELECT account_id FROM store_access WHERE store_id=?').get(row.id));if(owner&&owner.account_id!==account.id)throw error(409,'Store already belongs to an account');if(!owner)await link(account,row.id,b.searchKey);const linked=(await db.prepare('SELECT account_id FROM store_access WHERE store_id=?').get(row.id));if(linked?.account_id!==account.id)throw error(409,'Store already belongs to an account');json(res,200,{linked:true});return true;
  }
  throw error(404,'Account route not found');
 }
 return {user,csrf,owns,link,handle};
}
