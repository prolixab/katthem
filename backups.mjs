import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const safePath=(root,name)=>{if(typeof name!=='string'||!name||name.includes('\\')||path.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Ogiltig sökväg i säkerhetskopian.');const p=path.resolve(root,name);if(!p.startsWith(path.resolve(root)+path.sep))throw Error('Ogiltig sökväg.');return p};
function copyChecked(source,destination){if(fs.lstatSync(source).isSymbolicLink())throw Error('Symboliska länkar stöds inte i säkerhetskopior.');fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.copyFileSync(source,destination);fs.chmodSync(destination,0o600)}
export function verifyBackup(folder){
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Ogiltig säkerhetskopia.');
 const restored=fs.mkdtempSync(path.join(tmpdir(),'katthem-restore-check-'));const databases=[];
 try{
  const names=new Set();for(const entry of manifest.files){if(names.has(entry.path))throw Error('Dubblerad fil i säkerhetskopian.');names.add(entry.path);const source=safePath(folder,entry.path);if(hash(source)!==entry.sha256)throw Error('Säkerhetskopians kontrollsumma stämmer inte.');const target=safePath(restored,entry.path);copyChecked(source,target);if(entry.path.endsWith('.json'))JSON.parse(fs.readFileSync(target,'utf8'));if(entry.path.endsWith('.sqlite')){
   const db=new DatabaseSync(target,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').all().some(r=>Object.values(r)[0]!=='ok'))throw Error('Databasen klarade inte integritetskontrollen.');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Databasen har ogiltiga kopplingar.');db.prepare('SELECT count(*) n FROM sqlite_master').get();databases.push(entry.path)}finally{db.close()}
  }}
  if(!names.has('katthem.sqlite')||!names.has('shelters.sqlite'))throw Error('Katthemmets databas eller katthemsregistret saknas.');
  const registry=new DatabaseSync(path.join(restored,'shelters.sqlite'),{readOnly:true});try{for(const h of registry.prepare('SELECT id FROM shelters').all()){if(!/^[a-z0-9-]+$/.test(h.id))throw Error('Ogiltigt katthem i säkerhetskopian.');const required=h.id==='huskvarna'?'katthem.sqlite':'shelters/'+h.id+'/katthem.sqlite';if(!names.has(required))throw Error('En katthemsdatabas saknas i säkerhetskopian.')}}finally{registry.close()}
  return {files:manifest.files.length,databases:databases.length,checked_at:Date.now()};
 }finally{fs.rmSync(restored,{recursive:true,force:true})}
}
export function restoreBackup(folder,destination){
 if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('Återställning kräver en tom destinationsmapp.');verifyBackup(folder);
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));fs.mkdirSync(destination,{recursive:true,mode:0o700});for(const e of manifest.files)copyChecked(safePath(folder,e.path),safePath(destination,e.path));return {files:manifest.files.length};
}
export function createBackups({dataDir,backupDir=path.join(dataDir,'backups'),now=()=>Date.now(),retain=7}={}){
 dataDir=path.resolve(dataDir);backupDir=path.resolve(backupDir);if(dataDir===backupDir||dataDir.startsWith(backupDir+path.sep))throw Error('Säkerhetskopior behöver en egen mapp.');
 fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const stateFile=path.join(backupDir,'status.json');let state={last_success:null,last_error:null};if(fs.existsSync(stateFile)){try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch{state.last_error='Statusfilen kunde inte läsas.'}}
 const save=()=>{const temporary=stateFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify(state),{mode:0o600});fs.renameSync(temporary,stateFile)};
 const entries=()=>fs.readdirSync(backupDir,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^backup-\d{13}-[a-f0-9]{12}$/.test(e.name)).map(e=>{try{const m=JSON.parse(fs.readFileSync(path.join(backupDir,e.name,'manifest.json'),'utf8'));return {id:e.name,created_at:m.created_at,verified_at:m.verified_at,files:m.files.length}}catch{return null}}).filter(Boolean).sort((a,b)=>b.created_at-a.created_at);
 const status=()=>({...state,interval_hours:24,retained_copies:retain,copies:entries()});
 function create(){
  const created_at=now(),id='backup-'+created_at+'-'+randomBytes(6).toString('hex'),temporary=path.join(backupDir,'.creating-'+id),destination=path.join(backupDir,id),files=[];
  fs.mkdirSync(temporary,{mode:0o700});
  try{
   const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const source=path.join(directory,entry.name);if(source===backupDir)continue;if(entry.isSymbolicLink())throw Error('Symboliska länkar stöds inte i datamappen.');if(entry.isDirectory()){walk(source);continue}if(!entry.isFile()||/-(wal|shm|journal)$/.test(entry.name))continue;const relative=path.relative(dataDir,source).split(path.sep).join('/'),target=safePath(temporary,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    if(entry.name.endsWith('.sqlite')){const db=new DatabaseSync(source,{readOnly:true});try{db.exec('PRAGMA busy_timeout=5000');db.prepare('VACUUM INTO ?').run(target)}finally{db.close()}fs.chmodSync(target,0o600)}else copyChecked(source,target);
    files.push({path:relative,sha256:hash(target)});
   }};walk(dataDir);
   const manifest={format:1,created_at,verified_at:null,files};fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify(manifest),{mode:0o600});verifyBackup(temporary);manifest.verified_at=now();fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify(manifest),{mode:0o600});fs.renameSync(temporary,destination);
   state={last_success:created_at,last_error:null};save();for(const old of entries().slice(retain))fs.rmSync(path.join(backupDir,old.id),{recursive:true,force:true});return {id,created_at,verified_at:manifest.verified_at,files:files.length};
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});state={...state,last_error:'Säkerhetskopiering eller återläsningskontroll misslyckades. Försök igen och kontrollera serverns lagring.'};save();throw error}
 }
 function verify(id){if(!entries().some(e=>e.id===id))throw Object.assign(Error('Säkerhetskopian finns inte.'),{status:404});try{const result=verifyBackup(path.join(backupDir,id)),file=path.join(backupDir,id,'manifest.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));m.verified_at=now();fs.writeFileSync(file,JSON.stringify(m),{mode:0o600});state.last_error=null;save();return result}catch(error){state.last_error='Säkerhetskopian klarade inte återläsningskontrollen.';save();throw error}}
 const failed=()=>{state.last_error='Säkerhetskopieringen kunde inte slutföras. Försök igen och kontrollera serverns lagring.';save()};
 return {create,verify,status,failed,due:()=>!state.last_success||now()-state.last_success>=86400000};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [command,source,destination]=process.argv.slice(2);if(command==='verify'&&source)console.log(JSON.stringify(verifyBackup(source)));else if(command==='restore'&&source&&destination)console.log(JSON.stringify(restoreBackup(source,destination)));else throw Error('Använd: node backups.mjs verify KOPIA eller restore KOPIA TOM_MAPP')}catch(error){console.error(error.message);process.exitCode=1}
}
