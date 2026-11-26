import {createMembers} from './members.mjs';
import {previewShelterImport,executeShelterImport} from './shelter-import.mjs';
import {createPortalEvents} from './portal-events.mjs';
import {canonicalShelterName} from './shelter.mjs';
import {createScheduleDisplay,displaySchedule,displayNames,createPresenceTickets,createPresenceGrants} from './display.mjs';
import {readFileSync,createReadStream,statSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {calendarEvents} from './calendar.mjs';
import {createBackups} from './backups.mjs';
import {createAudit} from './audit.mjs';
import {requiresPasswordChange} from './password-policy.mjs';
import {contrast,createBranding,readBranding,updateBranding,validateBranding} from './branding.mjs';
import {updatePresenceSettings} from './presence.mjs';
import {createEmailSettings,emailSettingsStore} from './email-settings.mjs';
import {updateShelterSettings} from './shared-settings.mjs';
import {createPortalEngagement} from './portal-engagement.mjs';
import {createPortalNews} from './portal-news.mjs';
import {createVolunteerTransfers} from './volunteer-transfer.mjs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,createHmac} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const primary='huskvarna';
export async function createPortal({dataDir,host='127.0.0.1',port=3080,env=process.env}={}){
 mkdirSync(dataDir,{recursive:true});
 const registry=new DatabaseSync(path.join(dataDir,'shelters.sqlite'));
 registry.exec(`PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS shelters(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS grants(source TEXT NOT NULL,user_id INTEGER NOT NULL,target TEXT NOT NULL REFERENCES shelters(id),role TEXT NOT NULL CHECK(role IN ('admin','volunteer')),PRIMARY KEY(source,user_id,target));
 CREATE TABLE IF NOT EXISTS portal_sessions(token TEXT PRIMARY KEY,source TEXT NOT NULL,user_id INTEGER NOT NULL,source_token TEXT NOT NULL,selected TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS shadows(source TEXT NOT NULL,user_id INTEGER NOT NULL,target TEXT NOT NULL,local_id INTEGER NOT NULL,PRIMARY KEY(source,user_id,target),UNIQUE(target,local_id));`);
 registry.prepare('INSERT OR IGNORE INTO shelters VALUES(?,?)').run(primary,'Huskvarna');
 for(const row of registry.prepare('SELECT id,name FROM shelters').all()){const name=canonicalShelterName(row.name);if(name!==row.name)registry.prepare('UPDATE shelters SET name=? WHERE id=?').run(name,row.id)}
 if(!registry.prepare("SELECT sql FROM sqlite_master WHERE name='grants'").get().sql.includes("'coordinator'")){
  registry.exec("BEGIN IMMEDIATE;CREATE TABLE grants_v2(source TEXT NOT NULL,user_id INTEGER NOT NULL,target TEXT NOT NULL REFERENCES shelters(id),role TEXT NOT NULL CHECK(role IN ('admin','coordinator','volunteer')),PRIMARY KEY(source,user_id,target));INSERT INTO grants_v2 SELECT * FROM grants;DROP TABLE grants;ALTER TABLE grants_v2 RENAME TO grants;COMMIT;");
 }
 registry.exec('CREATE TABLE IF NOT EXISTS shadow_profile_sync(source TEXT NOT NULL,user_id INTEGER NOT NULL,target TEXT NOT NULL,values_json TEXT NOT NULL,PRIMARY KEY(source,user_id,target))');
 const audit=createAudit(registry),backups=createBackups({dataDir,backupDir:env.BACKUP_DIR||path.join(dataDir,'backups')});
 const backupsEnabled=(env.BACKUP_ENABLED??(env.NODE_ENV==='test'?'0':'1'))!=='0';
 let backupBusy=false,activeRequests=0,backupTask=null;
 async function runBackup(){
  if(backupBusy)fail('En säkerhetskopiering pågår redan.',409);backupBusy=true;
  const task=(async()=>{const deadline=Date.now()+30000;while(activeRequests){if(closing||Date.now()>deadline)throw Error('Pågående arbete kunde inte avslutas före säkerhetskopieringen.');await new Promise(r=>setTimeout(r,20))}if(closing)throw Error('Portalen stängs.');return backups.create()})();backupTask=task;
  try{return await task}catch(error){backups.failed();throw error}finally{backupBusy=false;backupTask=null}
 }
 async function maybeBackup(){if(backupsEnabled&&!closing&&!backupBusy&&backups.due())try{await runBackup()}catch{console.error('Säkerhetskopieringen kunde inte slutföras; status visas för superadmin.')}}
 const rates=new Map();
 const workers=new Map(),starts=new Map(),secret=randomBytes(32).toString('hex');let closing=false;
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 const houses=()=>registry.prepare('SELECT * FROM shelters ORDER BY name,id').all();
 const house=id=>registry.prepare('SELECT * FROM shelters WHERE id=?').get(id);
 const folder=id=>id===primary?dataDir:path.join(dataDir,'shelters',id);
 async function worker(id){
  if(workers.has(id))return workers.get(id);if(starts.has(id))return starts.get(id);
  if(!house(id))fail('Katthemmet finns inte.',404);
  const promise=(async()=>{
   const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:folder(id),PORTAL_PUBLIC_URL:env.APP_URL||'http://'+host+':'+port,PORTAL_SHELTER_ID:id,PORTAL_SHELTER_NAME:house(id).name,PORTAL_REGISTRY_PATH:path.join(dataDir,'shelters.sqlite'),GATEWAY_SECRET:secret,EMPTY_SHELTER:id===primary?'':'1',BOOTSTRAP_SUPERADMIN_EMAIL:id===primary?(env.BOOTSTRAP_SUPERADMIN_EMAIL||''):'',RESEND_API_KEY:id===primary?(env.RESEND_API_KEY||''):'',EMAIL_FROM:id===primary?(env.EMAIL_FROM||''):''},windowsHide:true,stdio:['ignore','pipe','pipe']});
   let address;try{address=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Katthemmet kunde inte starta.')),45000);child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0])}});child.on('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Katthemmets server stoppades.'))})})}catch(e){child.kill();throw e}
   const db=new DatabaseSync(path.join(folder(id),'katthem.sqlite'));db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
   const result={child,db,address};workers.set(id,result);child.on('exit',()=>{workers.delete(id);db.close();if(!closing)console.error('Katthemmet behöver startas om:',id)});return result;
  })();starts.set(id,promise);try{return await promise}finally{starts.delete(id)}
 }
 await worker(primary);
 // Start every configured shelter so reminders and CSV jobs run independently.
 for(const h of houses())await worker(h.id);
 const portalNews=createPortalNews(registry,{shelter:house});
 const eventAccount=(source,id)=>{const w=workers.get(source);if(!w||registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(source,id)||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(source,id))return null;return w.db.prepare('SELECT u.id,u.name,u.active,u.role,e.status,m.birth_date FROM users u LEFT JOIN engagements e ON e.user_id=u.id LEFT JOIN member_profiles m ON m.user_id=u.id WHERE u.id=?').get(id)};
 const sharedEvents=createPortalEvents(registry,{houses,account:eventAccount,access:(p,h)=>access(p,h),admin:(p,h)=>['admin','superadmin'].includes(access(p,h)),overlaps:(person,event)=>{
  for(const [home,w] of workers){const id=home===person.source?person.user_id:registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(person.source,person.user_id,home)?.local_id;if(id&&w.db.prepare('SELECT 1 FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0 AND s.date=? AND s.start<? AND s.end>?').get(id,event.date,event.end,event.start))return true;}return false;
 }});
 function eventOptions(p){const homes=houses().filter(h=>p.global||['admin','superadmin'].includes(access(p,h.id))),people=[];for(const h of homes)for(const u of workers.get(h.id).db.prepare('SELECT id FROM users WHERE active=1 ORDER BY name').all()){const account=eventAccount(h.id,u.id);if(account?.status==='active')people.push({source:h.id,user_id:u.id,name:account.name,home_name:h.name});}return {homes,people};}
 const transfers=createVolunteerTransfers(registry,{shelter:house,dbPath:id=>path.join(folder(id),'katthem.sqlite')});
 const lifecycle=createPortalEngagement(registry,{workers,houses});
 async function principal(token){
  const session=registry.prepare('SELECT * FROM portal_sessions WHERE token=? AND expires>?').get(token||'',Date.now());if(!session)return null;
  const w=await worker(session.source);const user=w.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1 AND u.id=?').get(session.source_token,Date.now(),session.user_id);
  if(!user||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(session.source,user?.id??-1)||registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(session.source,user?.id??-1))return null;
  return {...session,user,global:session.source===primary&&user.role==='superadmin'};
 }
 function access(p,target){const localId=target===p.source?p.user_id:registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,target)?.local_id;if(localId&&workers.get(target)?.db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(localId))return null;if(p.global)return 'superadmin';if(p.source===target)return p.user.role;return registry.prepare('SELECT role FROM grants WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,target)?.role||null}
 function settingsHomes(p){return houses().filter(home=>access(p,home.id)==='superadmin')}
 function settingsRevisions(p){
  return settingsHomes(p).map(({id,name})=>{
   const db=workers.get(id)?.db;
   if(!db)return {id,name};
   return {id,name,branding:readBranding(db).revision,presence:db.prepare('SELECT revision FROM presence_settings WHERE id=1').get().revision,email:emailSettingsStore(db).revision()};
  });
 }
 function volunteerCount(home){const w=workers.get(home);if(!w)return 0;return w.db.prepare("SELECT u.id FROM users u LEFT JOIN engagements e ON e.user_id=u.id WHERE u.active=1 AND (e.status IS NULL OR e.status='active')").all().filter(u=>!registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(home,u.id)).filter(u=>{const link=registry.prepare('SELECT * FROM shadows WHERE target=? AND local_id=?').get(home,u.id);return !link||Boolean(registry.prepare('SELECT 1 FROM grants WHERE source=? AND user_id=? AND target=?').get(link.source,link.user_id,home)&&workers.get(link.source)?.db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(link.user_id))}).length;}
 function metadata(p,selected){const own_shelters=houses().filter(h=>access(p,h.id)).map(h=>{const role=access(p,h.id),member=h.id===p.source||Boolean(registry.prepare('SELECT 1 FROM grants WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,h.id)),localId=h.id===p.source?p.user_id:registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,h.id)?.local_id;const row=member&&localId?workers.get(h.id)?.db.prepare('SELECT u.active,e.status FROM users u LEFT JOIN engagements e ON e.user_id=u.id WHERE u.id=?').get(localId):null;return {id:h.id,name:h.name,role,member,status:member?(row?.status||(row?row.active?'active':'inactive':null)):null}});return {own_shelters,selected,global_superadmin:p.global,...(p.global?{settings_homes:settingsRevisions(p)}:{}),can_transfer:houses().filter(h=>['admin','superadmin'].includes(access(p,h.id))).length>=2,shelters:houses().filter(h=>access(p,h.id)).map(h=>({id:h.id,name:h.name,volunteer_count:volunteerCount(h.id)}))}}
 async function ensureShadow(p,target,role){
  const w=await worker(target);let shadow=registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,target);
  if(!shadow){const email=w.db.prepare('SELECT 1 FROM users WHERE email=?').get(p.user.email)?'portal-'+randomBytes(16).toString('hex')+'@access.invalid':p.user.email;const salt=randomBytes(16).toString('hex'),password=salt+':'+scryptSync(randomBytes(32).toString('hex'),salt,64).toString('hex');const id=Number(w.db.prepare('INSERT INTO users(name,email,password,role,active,created_at) VALUES(?,?,?,?,1,?)').run(p.user.name,email,password,role,Date.now()).lastInsertRowid);registry.prepare('INSERT INTO shadows VALUES(?,?,?,?)').run(p.source,p.user_id,target,id);registry.prepare('DELETE FROM shadow_profile_sync WHERE source=? AND user_id=? AND target=?').run(p.source,p.user_id,target);shadow={local_id:id}}
  if(w.db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(shadow.local_id))return shadow.local_id;
  const currentEmail=w.db.prepare('SELECT email FROM users WHERE id=?').get(shadow.local_id).email;const sharedEmail=w.db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(p.user.email,shadow.local_id)?currentEmail:p.user.email;
  w.db.prepare('UPDATE users SET name=?,email=?,role=?,active=1,must_change_password=0,last_login_at=? WHERE id=?').run(p.user.name,sharedEmail,role,p.user.last_login_at??null,shadow.local_id);
  const account=w.db.prepare('SELECT name,email FROM users WHERE id=?').get(shadow.local_id);
  if(!w.db.prepare('SELECT id FROM member_profiles WHERE user_id=?').get(shadow.local_id))w.db.prepare('INSERT INTO member_profiles(name,email,user_id,shelter,updated_at) VALUES(?,?,?,?,?)').run(account.name,account.email,shadow.local_id,house(target).name,Date.now());
  let profile;try{profile=(await sharedProfile(p.source,p.user_id)).profile}catch(error){if(error.status!==404)throw error};
  if(profile){const current=w.db.prepare('SELECT * FROM member_profiles WHERE user_id=?').get(shadow.local_id),fields=sharedProfileFields.filter(k=>!['name','email'].includes(k)&&current[k]!==profile[k]);if(fields.length)w.db.prepare('UPDATE member_profiles SET '+fields.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=?').run(...fields.map(k=>profile[k]),Date.now(),current.id);}
  return shadow.local_id;
 }
 const sharedProfileFields=['name','email','phone','messenger_url','birth_date','animal_care_trained','volunteer_bag','board_role','board_title','responsibilities','contact_focus'];
 async function sharedProfile(home,id){
  const local=await worker(home),link=registry.prepare('SELECT * FROM shadows WHERE target=? AND local_id=?').get(home,id),source=link?.source||home,userId=link?.user_id||id,accountW=await worker(source),user=accountW.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if(!user||!user.active||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(source,userId))fail('Volontären är inte tillgänglig.',404);
  let w=accountW,profile=w.db.prepare('SELECT * FROM member_profiles WHERE user_id=?').get(userId);
  if(!profile||w.db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(userId)){
   profile=null;
   for(const grant of registry.prepare('SELECT * FROM grants WHERE source=? AND user_id=? ORDER BY target').all(source,userId)){const shadow=registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(source,userId,grant.target);if(!shadow)continue;const candidate=await worker(grant.target),row=candidate.db.prepare("SELECT m.* FROM member_profiles m JOIN users u ON u.id=m.user_id JOIN engagements e ON e.user_id=u.id WHERE u.id=? AND u.active=1 AND e.status<>'purged'").get(shadow.local_id);if(row){w=candidate;profile=row;break}}
  }
  if(!profile)fail('Volontären är inte tillgänglig.',404);
  return {source,userId,w,user,profile,accountW,identityEditable:w===accountW,linked:Boolean(link||registry.prepare('SELECT 1 FROM grants WHERE source=? AND user_id=?').get(source,userId)),localUser:local.db.prepare('SELECT * FROM users WHERE id=?').get(id)};
 }
 function profileValues(profile){return Object.fromEntries([...sharedProfileFields,'revision'].map(k=>[k,['animal_care_trained','volunteer_bag'].includes(k)?Boolean(profile[k]):profile[k]]))}
 // Internal collision addresses belong to local accounts, never to contact presentation.
 async function displayContactEmails(data,target,p){
  if(p&&data.user&&Array.isArray(data.slots)){const shared=sharedEvents.list(p,target),range=data.schedule_range;data.shared_events=shared;data.slots=[...data.slots,...shared.filter(e=>!range||e.mine||e.date>=range.start&&e.date<=range.end)];if(data.upcoming_events)data.upcoming_events=[...data.upcoming_events,...shared];data.event_options=eventOptions(p);}
  const local=await worker(target),emails=new Map();
  for(const link of registry.prepare('SELECT * FROM shadows WHERE target=?').all(target)){
   const alias=local.db.prepare('SELECT email FROM users WHERE id=?').get(link.local_id)?.email;
   if(!/^portal-[a-f0-9]{32}@access\.invalid$/.test(alias||''))continue;
   const source=await worker(link.source),email=source.db.prepare('SELECT email FROM users WHERE id=?').get(link.user_id)?.email;
   if(email)emails.set(alias,email);
  }
  function visit(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='email'&&emails.has(item))value[key]=emails.get(item);else if(item&&typeof item==='object')visit(item)}}
  visit(data);
  if(data.my_profile&&p){const own=await sharedProfile(p.source,p.user_id);data.my_profile={...data.my_profile,...Object.fromEntries(['phone','messenger_url','birth_date','revision'].map(k=>[k,own.profile[k]])),name:own.user.name,email:own.user.email};if(data.portal)data.portal.profile_identity_editable=own.identityEditable;}
  if(data.members)for(const m of data.members){if(!m.user_id)continue;try{const shared=await sharedProfile(target,m.user_id);if(shared.linked)m.shared_profile=true;}catch{}}
  return data;
 }
 async function syncGrantedProfiles(target){for(const g of registry.prepare('SELECT * FROM grants WHERE target=?').all(target)){const source=await worker(g.source),user=source.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(g.user_id);if(user&&!registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(g.source,g.user_id))await ensureShadow({source:g.source,user_id:g.user_id,user},target,g.source===primary&&user.role==='superadmin'?'superadmin':g.role)}}
 async function localSession(p,target){if(target===p.source)return p.source_token;const role=access(p,target);if(!role)fail('Du saknar åtkomst till katthemmet.',403);const id=await ensureShadow(p,target,role),w=await worker(target);const token=randomBytes(32).toString('hex');w.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());w.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,id,Math.min(p.expires,Date.now()+3600000));return token}
 async function reconcile(){for(const link of registry.prepare('SELECT * FROM shadows').all()){const source=await worker(link.source),target=await worker(link.target),user=source.db.prepare('SELECT * FROM users WHERE id=?').get(link.user_id);const role=user?.active?access({source:link.source,user_id:link.user_id,user,global:link.source===primary&&user.role==='superadmin'},link.target):null;target.db.prepare('UPDATE users SET active=?,role=? WHERE id=?').run(role?1:0,role||'volunteer',link.local_id);if(!role)target.db.prepare('DELETE FROM sessions WHERE user_id=?').run(link.local_id)}}
 function displayPassKey(home,key,day,id){return createHmac('sha256',secret).update(JSON.stringify(['pass',home,key,day,id])).digest('hex')}
 function displayChoices(db,home,key){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const rows=db.prepare("SELECT b.id,b.slot_id,b.user_id,u.name,s.title,s.start,s.end FROM bookings b JOIN users u ON u.id=b.user_id JOIN engagements e ON e.user_id=u.id JOIN slots s ON s.id=b.slot_id WHERE s.date=? AND s.cancelled=0 AND u.active=1 AND e.status='active' ORDER BY u.name COLLATE NOCASE,s.start,b.id").all(today),end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);const labels=displayNames(db.prepare('SELECT DISTINCT u.id user_id,u.name FROM users u JOIN bookings b ON b.user_id=u.id JOIN slots s ON s.id=b.slot_id WHERE s.date BETWEEN ? AND ? AND s.cancelled=0').all(today,end.toISOString().slice(0,10)));
  return rows.filter(row=>!labels.get(row.user_id).ambiguous).map(row=>({booking_id:row.id,pass_key:displayPassKey(home,key,today,row.slot_id),choice:createHmac('sha256',secret).update(JSON.stringify([home,key,today,row.id])).digest('hex'),label:labels.get(row.user_id).label,title:row.title,start:row.start,end:row.end}));
 }
 const displays=createScheduleDisplay(registry),displayQrCache=new Map();
 const tickets=createPresenceTickets({secret,validBinding:displays.validBinding}),presenceGrants=createPresenceGrants({tickets,validBinding:displays.validBinding});
 const deviceCookieName=home=>(env.NODE_ENV==='production'?'__Host-':'')+'display_device_'+home;
 const deviceToken=(req,home)=>(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(deviceCookieName(home)+'='))?.slice(deviceCookieName(home).length+1);
 const deviceConfig=(req,home,key)=>displays.authorizeDevice(home,key,deviceToken(req,home));
 async function grantStatus(p,home){const w=await worker(home),config=w.db.prepare('SELECT enabled,revision FROM presence_settings WHERE id=1').get();return presenceGrants.expires(p.token,home,config)}
 function limitRate(key,max){let value=rates.get(key);if(!value||value.until<Date.now()){value={count:0,until:Date.now()+60000};rates.set(key,value)}if(++value.count>max)fail('För många försök. Vänta en minut.',429)}

 const publicList=()=>({shelters:houses(),default_shelter:primary});
 async function bytes(req){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>600000)fail('För stor begäran.',413);chunks.push(b)}return Buffer.concat(chunks)}
 function json(bytes){try{return JSON.parse(bytes.toString()||'{}')}catch{fail('Ogiltiga uppgifter.')}}
 const server=http.createServer(async(req,res)=>{
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  let tracked=false;
  try{
   const url=new URL(req.url,'http://localhost'),write=!['GET','HEAD'].includes(req.method);
   const backupRoute=url.pathname.startsWith('/api/portal/manage/backups');
   if(backupBusy&&!backupRoute&&url.pathname!=='/healthz')fail('Säkerhetskopiering pågår. Försök igen om en liten stund.',503);
   if(!backupRoute&&url.pathname!=='/healthz'){activeRequests++;tracked=true}
   const origin=env.APP_URL?new URL(env.APP_URL).origin:'http://'+req.headers.host;
   if(write&&req.headers.origin&&req.headers.origin!==origin)fail('Begäran blockerades.',403);
   if(write&&['/api/login','/api/password-reset/request','/api/password-reset/confirm'].includes(url.pathname)){const family=url.pathname==='/api/login'?'login':'reset',key=family+':'+req.socket.remoteAddress;let rate=rates.get(key);if(!rate||rate.until<Date.now()){rate={count:0,until:Date.now()+60000};rates.set(key,rate)}if(++rate.count>(family==='login'?15:10))fail('För många försök. Vänta en minut.',429)}
   const displayFiles={'/visning':'display.html','/display.js':'display.js','/display.css':'display.css'};
   if(Object.hasOwn(displayFiles,url.pathname)){
    if(req.method!=='GET')fail('Endast läsning är tillåten.',405);const file=displayFiles[url.pathname];
    res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});return res.end(readFileSync(path.join(root,'public',file)));
   }
   if(url.pathname==='/api/display/enroll'){
    if(req.method!=='POST')fail('Metoden stöds inte.',405);const home=url.searchParams.get('shelter'),key=req.headers['x-display-key'];if(!house(home))fail('Katthemmet finns inte.',404);limitRate('device-enroll:'+req.socket.remoteAddress,20);const fields=json(await bytes(req));if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length)fail('Registreringen tar inga extra uppgifter.');const {token,...result}=displays.enroll(home,key,deviceToken(req,home));if(token)res.setHeader('Set-Cookie',deviceCookieName(home)+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000'+(env.NODE_ENV==='production'?'; Secure':''));return send(result);
   }
   if(url.pathname==='/api/_screen/booked')fail('Funktionen finns inte.',404);
   if(url.pathname==='/api/display/confirm'){
    if(req.method!=='POST')fail('Metoden stöds inte.',405);
    const home=url.searchParams.get('shelter'),key=req.headers['x-display-key'],config=deviceConfig(req,home,key);
    if(!config.allow_checkin)fail('Bekräftelse från skärmen är inte aktiverad.',403);
    const w=await worker(home);if(!w.db.prepare('SELECT enabled FROM presence_settings WHERE id=1').get()?.enabled)fail('Närvarobekräftelsen är avstängd.',403);
    let rate=rates.get('display:'+home);if(!rate||rate.until<Date.now()){rate={count:0,until:Date.now()+60000};rates.set('display:'+home,rate)}if(++rate.count>120)fail('Många bekräftelser just nu. Försök igen om en minut.',429);const fields=json(await bytes(req));if(!fields||Object.keys(fields).some(k=>k!=='choice')||typeof fields.choice!=='string'||! /^[a-f0-9]{64}$/.test(fields.choice))fail('Välj ditt namn och pass i dagens lista.');
    if(!deviceConfig(req,home,key).allow_checkin)fail('Bekräftelse från skärmen är inte aktiverad.',403);const chosen=displayChoices(w.db,home,key).find(row=>row.choice===fields.choice);if(!chosen)fail('Listan har ändrats. Öppna dagens lista igen.',409);
    const result=await fetch(w.address+'/api/_screen/booked',{method:'POST',headers:{'x-portal-secret':secret,'content-type':'application/json'},body:JSON.stringify({booking_id:chosen.booking_id})}),response=await result.json();return send(response,result.status);
   }
   if(url.pathname==='/api/display'){
    if(req.method!=='GET')fail('Endast läsning är tillåten.',405);const home=url.searchParams.get('shelter'),config=displays.authorizeRead(home,req.headers['x-display-key'],deviceToken(req,home));if(!house(home))fail('Visningslänken är ogiltig eller återkallad.',404);
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');const w=await worker(home),data=displaySchedule(w.db,{name:house(home).name,...config,...(config.allow_checkin?{slotKey:(id,day)=>displayPassKey(home,req.headers['x-display-key'],day,id)}:{})});for(const event of sharedEvents.list({source:home,user_id:-1,user:{role:'volunteer'},global:false},home)){const day=data.days.find(d=>d.date===event.date);if(day)day.slots.push({title:event.title,start:event.start,end:event.end,cancelled:!!event.cancelled,booked:event.cancelled?0:event.booked,minimum_staff:event.minimum_staff,shared_event:true,...(config.show_names?{names:event.cancelled?[]:event.names}:{})});}for(const day of data.days)day.slots.sort((a,b)=>a.start.localeCompare(b.start));data.presence=null;data.security_enabled=config.security_enabled;data.device_registered=Boolean(config.device_hash);
    const branding=readBranding(w.db);
    if(url.searchParams.get('profile')!==String(branding.revision)){
     const {primary,background,text,accent,logo,revision}=branding;
     data.branding={primary,background,text,accent,logo,revision,on_primary:contrast(primary,'#ffffff')>=4.5?'#ffffff':'#000000'};
    }
    const module=w.db.prepare('SELECT enabled,revision FROM presence_settings WHERE id=1').get();
    if(module?.enabled&&config.device_hash){const ticket=tickets.issue(home,config.device_hash,config.device_revision,module.revision),link=new URL('/',origin);link.searchParams.set('shelter',home);link.hash='narvaro/'+ticket.token;const cacheKey=home+':'+ticket.token;for(const [id,value] of displayQrCache)if(value.expires_at<=Date.now())displayQrCache.delete(id);let cached=displayQrCache.get(cacheKey);if(!cached){const {default:QR}=await import('qrcode');cached={png:await QR.toDataURL(link.href,{width:384,margin:4,errorCorrectionLevel:'M'}),expires_at:ticket.expires_at};displayQrCache.set(cacheKey,cached)}data.presence={link:link.href,png:cached.png,expires_at:ticket.expires_at,remaining_ms:Math.max(0,ticket.expires_at-Date.now())};if(config.allow_checkin)data.checkin={day:data.today,options:displayChoices(w.db,home,req.headers['x-display-key']).map(({booking_id,...option})=>option)};}
    data.schedule_revision=createHmac('sha256',secret).update(JSON.stringify([home,data.today,data.show_names,data.days])).digest('hex');
    if(url.searchParams.get('schedule_revision')===data.schedule_revision)delete data.days;
    return send(data);
   }
   const incomingToken=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('portal_session='))?.slice(15);
   let p=await principal(incomingToken),target=p?.selected||primary,token='';if(p&&!access(p,target)){target=houses().find(h=>access(p,h.id))?.id||target;registry.prepare('UPDATE portal_sessions SET selected=? WHERE token=?').run(target,incomingToken);}let payload=write?await bytes(req):null;
   const requested=req.headers['x-katthem']||url.searchParams.get('shelter');
   if(requested)target=String(requested);
   const cookie=(value,max=86400)=>'portal_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+max+(env.NODE_ENV==='production'?'; Secure':'');
   if(p&&requiresPasswordChange(p.user)&&url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/state'&&req.method==='GET')return send({password_change_required:true,user:{id:p.user.id,name:p.user.name,email:p.user.email,role:p.user.role,must_change_password:true},branding:createBranding((await worker(p.source)).db).get()});
    if(!['/api/password','/api/logout'].includes(url.pathname))return send({error:'Byt lösenord innan du fortsätter.',code:'PASSWORD_CHANGE_REQUIRED'},403);
   }
   // Shared event bookings belong to the canonical identity, not to a local shadow account.
   if(p&&write){const fields=payload?json(payload):{},statusChange=['paused','inactive','ended'].includes(fields.status),disabled=fields.active===false||fields.active===0,match=url.pathname.match(/^\/api\/(?:engagements|users)\/(\d+)$/),self=['/api/engagement','/api/portal/engagement'].includes(url.pathname);
    let person=null;if(self&&statusChange)person={source:p.source,user_id:p.user_id};else if(match&&(statusChange||disabled)&&access(p,target)&&['admin','superadmin'].includes(access(p,target))){const id=Number(match[1]),link=registry.prepare('SELECT source,user_id FROM shadows WHERE target=? AND local_id=?').get(target,id);person=link||{source:target,user_id:id};}
    if(person){const pending=registry.prepare('SELECT e.* FROM shared_event_bookings b JOIN shared_events e ON e.id=b.event_id WHERE b.source=? AND b.user_id=? AND e.cancelled=0').all(person.source,person.user_id).filter(e=>new Date(e.date+'T'+e.end)>Date.now()&&(fields.scope==='all'||JSON.parse(e.targets).includes(target)));if(pending.length)return send({error:'Personen är bokad på gemensamma event. Avboka dessa via eventansvarig innan statusen ändras; vanliga pass hanteras av avbokningsbekräftelsen.',code:'SHARED_EVENT_BOOKINGS'},409);}
    if(url.pathname.startsWith('/api/portal/')&&url.pathname.includes('/transfers')&&fields.source&&fields.user_id){const pending=registry.prepare('SELECT e.date,e.end FROM shared_event_bookings b JOIN shared_events e ON e.id=b.event_id WHERE b.source=? AND b.user_id=? AND e.cancelled=0').all(fields.source,fields.user_id).some(e=>new Date(e.date+'T'+e.end)>Date.now());if(pending)return send({error:'Avboka personens kommande gemensamma event före flytt av kontot.',code:'SHARED_EVENT_BOOKINGS'},409);}
   }
   if(url.pathname.startsWith('/api/_event/'))fail('Funktionen finns inte.',404);
   if(url.pathname.startsWith('/api/portal/events')){
    if(!p)fail('Logga in för att fortsätta.',401);
    const match=url.pathname.match(/^\/api\/portal\/events(?:\/(\d+)(?:\/(bookings|cancel|people))?)?$/);if(!match)fail('Funktionen finns inte.',404);const id=Number(match[1]),action=match[2],fields=payload?json(payload):{};
    if(!id&&req.method==='GET')return send({events:sharedEvents.list(p),options:eventOptions(p)});
    if(!id&&req.method==='POST')return send({id:sharedEvents.save(p,null,fields)});
    if(action==='people'&&req.method==='GET'){const event=sharedEvents.detail(p,id);if(!event.can_manage)fail('Du saknar eventansvar.',403);const people=[];for(const h of houses().filter(h=>event.targets.includes(h.id)))for(const row of workers.get(h.id).db.prepare('SELECT id FROM users WHERE active=1 ORDER BY name').all()){const u=eventAccount(h.id,row.id);if(u?.status==='active')people.push({source:h.id,user_id:row.id,name:u.name,home_name:h.name});}return send({people});}
    if(id&&!action&&req.method==='GET')return send(sharedEvents.detail(p,id));
    if(id&&!action&&req.method==='PUT')return send({id:sharedEvents.save(p,id,fields)});
    if(action==='cancel'&&req.method==='POST'){sharedEvents.cancel(p,id,fields.revision);return send({ok:true});}
    if(action==='bookings'&&req.method==='POST'){
     const event=sharedEvents.detail(p,id),person=fields.person||{source:p.source,user_id:p.user_id},other=person.source!==p.source||person.user_id!==p.user_id;
     if(!person||typeof person.source!=='string'||!Number.isInteger(person.user_id))fail('Välj en giltig deltagare.');if(other&&!event.can_manage)fail('Du får bara boka dig själv.',403);if(!eventAccount(person.source,person.user_id))fail('Volontären finns inte.',404);
     const w=await worker(person.source),local=await fetch(w.address+'/api/_event/eligibility',{method:'POST',headers:{'x-portal-secret':secret,'content-type':'application/json','x-event-actor':secret},body:JSON.stringify({user_id:person.user_id,admin:other&&event.can_manage})});
     const eligibility=await local.json();if(!local.ok)return send(eligibility,local.status);
     sharedEvents.book(p,id,{...fields,person,intro_budget:eligibility.intro_budget,intro_started_at:eligibility.intro_started_at});return send({ok:true});
    }
    if(action==='bookings'&&req.method==='DELETE'){sharedEvents.cancelBooking(p,id,fields.person||p);return send({ok:true});}
    fail('Metoden stöds inte.',405);
   }
   if(url.pathname==='/api/portal/display/security'){
    if(!p?.global)fail('Endast superadmin kan ändra säkerheten för det publika schemat.',403);if(req.method!=='PUT')fail('Metoden stöds inte.',405);const result=displays.security(target,json(payload));audit.record({home:target,actor:p,action:result.security_enabled?'display.security.enabled':'display.security.disabled',details:{}});return send(result);
   }
   if(url.pathname==='/api/portal/display/device'){
    if(!p?.global)fail('Endast superadmin kan godkänna eller återkalla en visningsdator.',403);if(!['POST','DELETE'].includes(req.method))fail('Metoden stöds inte.',405);limitRate('device-approve:'+p.source+':'+p.user_id,20);const result=displays.bind(target,json(payload),req.method==='DELETE');audit.record({home:target,actor:p,action:req.method==='POST'?'display.device.approved':'display.device.revoked',details:{}});return send(result);
   }
   if(url.pathname==='/api/presence/access'){
    if(!p)fail('Logga in för att fortsätta.',401);if(!access(p,target))fail('Du saknar åtkomst till katthemmet.',403);if(req.method!=='POST')fail('Metoden stöds inte.',405);limitRate('presence-access:'+p.token,30);const fields=json(payload);if(!fields||Object.keys(fields).some(k=>k!=='token'))fail('Skanna QR-koden på skärmen.',403);const w=await worker(target),module=w.db.prepare('SELECT enabled,revision FROM presence_settings WHERE id=1').get();if(!module?.enabled)fail('Närvaromodulen är avstängd.',404);const expires_at=presenceGrants.grant(p.token,target,fields.token,module);return send({expires_at});
   }
   if(url.pathname==='/api/portal/display'){
    if(!p||!['admin','superadmin'].includes(access(p,target)))fail('Endast admin i detta katthem kan hantera visningslänken.',403);
    if(req.method==='GET')return send(displays.status(target));
    if(!['POST','DELETE'].includes(req.method))fail('Metoden stöds inte.',405);
    const result=displays.configure(target,json(payload),req.method==='POST');audit.record({home:target,actor:p,action:req.method==='POST'?'display.created':'display.revoked',details:{show_names:result.show_names,allow_checkin:result.allow_checkin}});
    const {key,...status}=result;if(!key)return send(status);const link=new URL('/visning',origin);link.searchParams.set('shelter',target);link.hash=key;return send({...status,link:link.href});
   }
   if(url.pathname==='/api/branding'&&req.method==='GET'){target=requested||p?.selected||primary;if(!house(target))fail('Katthemmet finns inte.',404);return send(createBranding((await worker(target)).db).get())}
   if(url.pathname==='/api/portal'&&req.method==='GET')return send(publicList());
   if(['/api/portal/import-preview','/api/portal/import'].includes(url.pathname)&&req.method==='POST'){
    if(!p)fail('Logga in för att fortsätta.',401);if(!house(target)||!['admin','superadmin'].includes(access(p,target)))fail('Du behöver adminbehörighet i det valda katthemmet.',403);
    const fields=json(payload),context={homes:houses(),selected:target,global:p.global};
    const request=async(home,action,data)=>{if(!['admin','superadmin'].includes(access(p,home)))fail('Du saknar adminbehörighet i katthemmet.',403);const w=await worker(home),session=await localSession(p,home);const response=await fetch(w.address+'/api/users/'+action,{method:'POST',headers:{'x-portal-secret':secret,'x-portal-origin':origin,'content-type':'application/json',cookie:'session='+session},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)fail(result.error||'Importen kunde inte slutföras.',response.status);return result};
    if(url.pathname.endsWith('import-preview'))return send((await previewShelterImport(fields,context,request)).preview);
    const result=await executeShelterImport(fields,context,request);for(const home of result.results)if(home.imported)audit.record({home:home.shelter_id,actor:p,action:'volunteers.imported',details:{imported:home.imported}});return send(result);
   }
   if(/^\/api\/portal\/coordinators\/\d+$/.test(url.pathname)&&req.method==='PATCH'){
    if(!p)fail('Logga in för att fortsätta.',401);
    if(!house(target)||!['admin','superadmin'].includes(access(p,target)))fail('Du behöver adminbehörighet i detta katthem.',403);
    const fields=json(payload),id=Number(url.pathname.split('/').pop());
    if(!fields||typeof fields.enabled!=='boolean'||Object.keys(fields).some(key=>key!=='enabled'))fail('Välj om personen ska vara samordnare.');
    const w=await worker(target),u=w.db.prepare('SELECT id,role,active FROM users WHERE id=?').get(id);
    if(!u)fail('Volontären finns inte.',404);
    if(!u.active||!['volunteer','coordinator'].includes(u.role)||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,id)||w.db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(id))fail('Välj en aktiv volontär eller samordnare. Administratörers roller ändras av superadmin.',403);
    const role=fields.enabled?'coordinator':'volunteer',link=registry.prepare('SELECT * FROM shadows WHERE target=? AND local_id=?').get(target,id);
    if(link){
     const grant=registry.prepare('SELECT role FROM grants WHERE source=? AND user_id=? AND target=?').get(link.source,link.user_id,target),source=await worker(link.source),owner=source.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(link.user_id);
     if(!grant||!['volunteer','coordinator'].includes(grant.role)||!owner||link.source===primary&&owner.role==='superadmin'||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(link.source,link.user_id))fail('Personens tilldelade åtkomst kan inte ändras här.',403);
     if(!registry.prepare("UPDATE grants SET role=? WHERE source=? AND user_id=? AND target=? AND role=?").run(role,link.source,link.user_id,target,grant.role).changes)fail('Åtkomsten har ändrats. Öppna profilen igen.',409);
     await ensureShadow({source:link.source,user_id:link.user_id,user:owner},target,role);
    }else if(!w.db.prepare("UPDATE users SET role=? WHERE id=? AND active=1 AND role=?").run(role,id,u.role).changes)fail('Rollen har ändrats. Öppna profilen igen.',409);
    audit.record({home:target,actor:p,action:'coordinator.updated',subject_id:id,details:{role}});
    return send({ok:true});
   }
   if(['/api/portal/my-bookings','/api/portal/my-bookings/calendar'].includes(url.pathname)&&req.method==='GET'){
    if(!p)fail('Logga in för att fortsätta.',401);
    const bookings=[];
    for(const h of houses()){
     if(!access(p,h.id))continue;
     const id=h.id===p.source?p.user_id:registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,h.id)?.local_id;
     if(!id)continue;
     const w=await worker(h.id),location=w.db.prepare('SELECT location FROM volunteer_info WHERE id=1').get()?.location||'';
     for(const slot of w.db.prepare('SELECT s.*,b.id booking_id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? ORDER BY s.date,s.start').all(id)){
      if(new Date(slot.date+'T'+slot.end)<=new Date())continue;
      bookings.push({...slot,shelter_id:h.id,shelter_name:h.name,location});
     }
    }
    for(const event of sharedEvents.list(p).filter(e=>e.mine&&new Date(e.date+'T'+e.end)>Date.now()))bookings.push({...event,shelter_id:target,shelter_name:event.home_names.join(' + '),location:''});
    bookings.sort((a,b)=>(a.date+a.start+a.shelter_id).localeCompare(b.date+b.start+b.shelter_id));
    if(url.pathname.endsWith('/calendar')){
     const ics=calendarEvents(bookings.filter(b=>!b.cancelled),slot=>({appUrl:origin,location:slot.location,shelterId:slot.shelter_id}));
     res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="mina-bokningar.ics"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(ics);
    }
    return send({bookings});
   }
   if(url.pathname==='/api/login'&&req.method==='POST'){

    const fields=json(payload);target=fields.portal_shelter||primary;if(!house(target))fail('Välj ett katthem.');payload=Buffer.from(JSON.stringify({email:fields.email,password:fields.password}));
   }else if(/^\/api\/portal\/profiles\/\d+$/.test(url.pathname)||url.pathname==='/api/profile'&&req.method==='PATCH'){
    if(!p)fail('Logga in för att fortsätta.',401);if(!access(p,target))fail('Du saknar åtkomst till katthemmet.',403);
    const self=url.pathname==='/api/profile';if(!self&&!['admin','superadmin'].includes(access(p,target)))fail('Du saknar administratörsbehörighet.',403);
    const id=self?p.user_id:Number(url.pathname.split('/').pop()),shared=await sharedProfile(self?p.source:target,id);
    if(!self&&(!shared.localUser?.active||(await worker(target)).db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(id)))fail('Volontären är inte tillgänglig.',404);
    if(req.method==='GET'&&!self)return send({profile:{...profileValues(shared.profile),name:shared.user.name,email:shared.user.email},identity_editable:shared.identityEditable&&(access(p,target)==='superadmin'||!['admin','superadmin'].includes(shared.user.role)&&!['admin','superadmin'].includes(shared.localUser?.role))});
    if(req.method!=='PATCH')fail('Metoden stöds inte.',405);const fields=json(payload),allowed=self?['name','email','phone','messenger_url','birth_date']:sharedProfileFields;
    if(!fields||Object.keys(fields).some(k=>k!=='revision'&&!allowed.includes(k))||!Number.isInteger(fields.revision))fail('Kontrollera profiluppgifterna och öppna profilen igen.');
    if(!self&&access(p,target)!=='superadmin'&&(['admin','superadmin'].includes(shared.user.role)||['admin','superadmin'].includes(shared.localUser?.role))&&['name','email'].some(k=>fields[k]!==undefined&&fields[k]!==shared.user[k]))fail('Endast superadmin får ändra administratörers namn och inloggningsadress.',403);
    if(self&&!['admin','superadmin'].includes(shared.user.role)&&shared.profile.birth_date&&fields.birth_date!==undefined&&fields.birth_date!==shared.profile.birth_date)fail('Födelsedatum är redan registrerat. Kontakta admin om det behöver rättas.',403);
    if(!shared.identityEditable)for(const k of ['name','email'])if(fields[k]===shared.user[k])delete fields[k];
    if(!shared.identityEditable&&['name','email'].some(k=>fields[k]!==undefined&&fields[k]!==shared.profile[k]))fail('Kontakta superadmin för ändring av namn eller inloggningsadress efter gallring av ordinarie profil.',403);
    createMembers(shared.w.db).save(shared.profile.id,{...shared.profile,...profileValues(shared.profile),...fields});
    audit.record({home:target,actor:p,action:'profile.shared_updated',subject_id:id,details:{fields:Object.keys(fields).filter(k=>k!=='revision')}});
    if(self)p.user=shared.accountW.db.prepare('SELECT * FROM users WHERE id=?').get(shared.userId);
    await syncGrantedProfiles(target);const selected=await worker(target),session=await localSession(p,target),response=await fetch(selected.address+'/api/state',{headers:{cookie:'session='+session,'x-portal-secret':secret,'x-portal-origin':origin}});if(!response.ok)fail('Profilen är sparad men sidan kunde inte uppdateras. Ladda om sidan.',502);const data=await response.json();data.portal=metadata(p,target);data.shelter={name:house(target).name,configured:true,id:target};if(data.users)for(const u of data.users){u.portal_managed=Boolean(registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(target,u.id));u.transfer_retired=Boolean(registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,u.id));}data.news=[...portalNews.visible(target,p),...(data.news||[])];data.bulletin_board=[...portalNews.board(target),...(data.bulletin_board||[])];if(p.global)data.portal_news_admin=portalNews.all();return send(await displayContactEmails(data,target,p));
   }else if(url.pathname==='/api/portal/engagement'&&req.method==='PATCH'){
    if(!p||!access(p,target))fail('Logga in och välj ett katthem.',403);const localId=target===p.source?p.user_id:registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,target)?.local_id;if(!localId)fail('Öppna katthemmet först.');return send(lifecycle.update(target,localId,json(payload),{self:true}));
   }else if(url.pathname==='/api/portal/select'&&req.method==='POST'){
    if(!p)fail('Logga in för att fortsätta.',401);target=json(payload).shelter;if(!house(target)||!access(p,target))fail('Du saknar åtkomst till katthemmet.',403);
    registry.prepare('UPDATE portal_sessions SET selected=? WHERE token=?').run(target,incomingToken);return send({ok:true});
   }else if(/^\/api\/portal\/news\/\d+\/dismiss$/.test(url.pathname)&&req.method==='POST'){
    if(!p)fail('Logga in för att fortsätta.',401);if(!house(target)||!access(p,target))fail('Du saknar åtkomst till katthemmet.',403);const fields=json(payload);portalNews.dismiss(target,p,Number(url.pathname.split('/')[4]),fields.revision);return send({ok:true});
   }else if(url.pathname.startsWith('/api/portal/transfers')){
    if(!p)fail('Logga in för att fortsätta.',401);const allowed=houses().filter(h=>['admin','superadmin'].includes(access(p,h.id)));if(allowed.length<2)fail('Du behöver adminbehörighet i båda katthemmen.',403);
    if(url.pathname==='/api/portal/transfers'&&req.method==='GET'){const users=[];for(const h of allowed){const w=await worker(h.id);for(const u of w.db.prepare("SELECT id,name,email,role,active FROM users WHERE active=1 AND role='volunteer' ORDER BY name").all())if(!registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(h.id,u.id)&&!registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(h.id,u.id))users.push({...u,source:h.id})}return send({shelters:allowed,users})}
    if(['/api/portal/transfers/preview','/api/portal/transfers'].includes(url.pathname)&&req.method==='POST'){const fields=json(payload),ids=allowed.map(h=>h.id);if(!ids.includes(fields.source)||!ids.includes(fields.target))fail('Du behöver adminbehörighet i båda katthemmen.',403);const extra=registry.prepare('SELECT target FROM shadows WHERE source=? AND user_id=? AND target<>?').all(fields.source,fields.user_id,fields.target);if(extra.some(e=>!ids.includes(e.target)))fail('Personen har kopplingar till andra katthem. Be superadmin hjälpa till med flytten.',403);await worker(fields.source);await worker(fields.target);const safe={...fields,volunteers_only:true,allowed_homes:ids};if(url.pathname.endsWith('/preview'))return send(transfers.preview(safe));const result=transfers.move(safe);await reconcile();return send(result)}
    fail('Funktionen finns inte.',404);
   }else if(url.pathname==='/api/portal/audit'&&req.method==='GET'){
    if(!p)fail('Logga in för att fortsätta.',401);if(!house(target)||!['admin','superadmin'].includes(access(p,target)))fail('Du saknar administratörsbehörighet.',403);
    return send({entries:audit.list(target).map(entry=>({...entry,actor_name:workers.get(entry.actor_home)?.db.prepare('SELECT name FROM users WHERE id=?').get(entry.actor_id)?.name||'Tidigare administratör'}))});
   }else if(url.pathname.startsWith('/api/portal/manage')){
    if(!p)fail('Logga in för att fortsätta.',401);if(!p.global)fail('Endast superadmin kan hantera katthem och åtkomst.',403);
    const sharedSetting=url.pathname.match(/^[/]api[/]portal[/]manage[/]shared-settings[/](branding|presence|email)$/)?.[1];
    if(sharedSetting){
     if(req.method!=='PUT')fail('Metoden stöds inte.',405);
     const homes=settingsHomes(p);
     if(homes.length<2)fail('Gemensam sparning kräver åtkomst till minst två katthem.',403);
     const {values,revisions}=json(payload)||{};
     if(!revisions||Object.keys(revisions).length!==homes.length||!homes.every(home=>Object.hasOwn(revisions,home.id)&&Number.isSafeInteger(revisions[home.id])))fail('Listan över katthem har ändrats. Uppdatera sidan och försök igen.',409);
     if(sharedSetting==='branding')validateBranding(values);
     if(sharedSetting==='presence'&&typeof values?.enabled!=='boolean')fail('Välj om modulen ska vara aktiverad.');
     await Promise.all(homes.map(home=>worker(home.id)));
     updateShelterSettings(registry,homes.map(({id})=>({id,path:path.join(folder(id),'katthem.sqlite'),revision:revisions[id]})),({id,schema,revision})=>{
      if(sharedSetting==='branding')updateBranding(registry,schema,values,revision);
      if(sharedSetting==='presence')updatePresenceSettings(registry,schema,values.enabled,revision);
      if(sharedSetting==='email'){
       const store=emailSettingsStore(registry,schema);
       if(store.revision()!==revision)fail('E-postinställningarna har ändrats. Öppna dialogen igen.',409);
       createEmailSettings({store,dataDir:folder(id),production:env.NODE_ENV==='production'}).save({...values,revision});
      }
      audit.record({home:id,actor:p,action:sharedSetting==='presence'?(values.enabled?'module.presence.enabled':'module.presence.disabled'):sharedSetting+'.shared_saved'});
     });
     return send({ok:true});
    }
    const backupDownload=url.pathname.match(/^\/api\/portal\/manage\/backups\/(backup-\d{13}-[a-f0-9]{12})\/download$/);
    if(backupDownload&&req.method==='GET'){
     let archive;try{archive=await backups.download(backupDownload[1])}catch(error){fail(error.status?error.message:'Säkerhetskopian kunde inte kontrolleras och förberedas för nedladdning.',error.status||503)}
     try{res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+archive.filename+'"','Content-Length':String(statSync(archive.path).size),'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});await pipeline(createReadStream(archive.path),res);audit.record({home:target,actor:p,action:'backup.downloaded'})}finally{archive.cleanup()}return;
    }
    if(url.pathname==='/api/portal/manage/backups'&&req.method==='GET')return send({...backups.status(),automatic_enabled:backupsEnabled});
    if(url.pathname==='/api/portal/manage/backups'&&req.method==='POST'){const copy=await runBackup();audit.record({home:target,actor:p,action:'backup.created'});return send(copy)}
    if(url.pathname==='/api/portal/manage/backups/verify'&&req.method==='POST'){const fields=json(payload);let result;try{result=backups.verify(fields.id)}catch(error){fail(error.status?error.message:'Säkerhetskopian klarade inte återläsningskontrollen.',error.status||503)}audit.record({home:target,actor:p,action:'backup.verified'});return send(result)}
    if(url.pathname==='/api/portal/manage/news'&&req.method==='POST')return send({id:portalNews.save(null,json(payload))});
    if(/^\/api\/portal\/manage\/news\/\d+$/.test(url.pathname)&&['PUT','DELETE'].includes(req.method)){const fields=json(payload),id=Number(url.pathname.split('/').pop());if(req.method==='DELETE')portalNews.remove(id,fields.revision);else portalNews.save(id,fields);return send({ok:true})}
    if(url.pathname==='/api/portal/manage'&&req.method==='GET'){
     const users=[];for(const h of houses()){const w=await worker(h.id);for(const u of w.db.prepare('SELECT id,name,email,role,active FROM users ORDER BY name').all()){if(!registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(h.id,u.id))users.push({...u,source:h.id})}}
     return send({shelters:houses(),users,grants:registry.prepare('SELECT * FROM grants ORDER BY source,user_id,target').all()});
    }
    if(/^\/api\/portal\/manage\/shelters\/[a-z0-9-]+$/.test(url.pathname)&&req.method==='PATCH'){
     const id=url.pathname.split('/').pop(),current=house(id);if(!current)fail('Katthemmet finns inte.',404);
     const fields=json(payload);if(typeof fields.name!=='string'||!fields.name.trim()||fields.name.length>100||/[\x00-\x1f\x7f]/.test(fields.name)||typeof fields.previous_name!=='string')fail('Ange ett namn med 1–100 tecken och öppna formuläret igen vid behov.');
     const name=canonicalShelterName(fields.name);if(houses().some(h=>h.id!==id&&h.name.toLocaleLowerCase('sv-SE')===name.toLocaleLowerCase('sv-SE')))fail('Ett annat katthem har redan det namnet.');
     const changed=registry.prepare('UPDATE shelters SET name=? WHERE id=? AND name=?').run(name,id,fields.previous_name);if(!changed.changes)fail('Namnet har ändrats av någon annan. Stäng och öppna katthemslistan innan du sparar igen.',409);
     audit.record({home:id,actor:p,action:'shelter.renamed',details:{name}});return send({id,name});
    }
    if(url.pathname==='/api/portal/manage/shelters'&&req.method==='POST'){
     const fields=json(payload);if(typeof fields.name!=='string'||!fields.name.trim()||fields.name.length>100||typeof fields.address!=='string'||fields.address.length>4000)fail('Ange katthemmets namn och adress.');if(houses().length>=50)fail('Högst 50 katthem kan läggas till.');
     const name=canonicalShelterName(fields.name);if(houses().some(h=>h.name.toLocaleLowerCase('sv-SE')===name.toLocaleLowerCase('sv-SE')))fail('Ett annat katthem har redan det namnet.');const id=randomBytes(12).toString('hex');registry.prepare('INSERT INTO shelters VALUES(?,?)').run(id,name);try{const w=await worker(id);w.db.prepare('UPDATE volunteer_info SET location=? WHERE id=1').run(fields.address.trim())}catch(e){registry.prepare('DELETE FROM shelters WHERE id=?').run(id);throw e}return send({id},201);
    }
    if(['/api/portal/manage/transfers/preview','/api/portal/manage/transfers'].includes(url.pathname)&&req.method==='POST'){const fields=json(payload);if(!house(fields.source)||!house(fields.target))fail('Välj katthem.');await worker(fields.source);await worker(fields.target);if(url.pathname.endsWith('/preview'))return send(transfers.preview(fields));const result=transfers.move(fields);await reconcile();return send(result)}
    if(url.pathname==='/api/portal/manage/grants'&&req.method==='POST'){
     const fields=json(payload);if(!house(fields.source)||!house(fields.target)||!Number.isInteger(fields.user_id)||!['admin','coordinator','volunteer'].includes(fields.role)||typeof fields.enabled!=='boolean'||fields.source===fields.target)fail('Välj person, annat katthem och behörighet.');
     const source=await worker(fields.source),u=source.db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(fields.user_id);if(!u||registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(fields.source,fields.user_id))fail('Välj ett aktivt ordinarie konto.');
     if(fields.enabled){const old=registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(fields.source,fields.user_id,fields.target);if(old){const targetWorker=await worker(fields.target);if(targetWorker.db.prepare("SELECT 1 FROM engagements WHERE user_id=? AND status='purged'").get(old.local_id)){registry.prepare('DELETE FROM shadows WHERE source=? AND user_id=? AND target=?').run(fields.source,fields.user_id,fields.target);registry.prepare('DELETE FROM shadow_profile_sync WHERE source=? AND user_id=? AND target=?').run(fields.source,fields.user_id,fields.target);}}registry.prepare('INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(source,user_id,target) DO UPDATE SET role=excluded.role').run(fields.source,fields.user_id,fields.target,fields.role);await syncGrantedProfiles(fields.target)}
     else{registry.prepare('DELETE FROM grants WHERE source=? AND user_id=? AND target=?').run(fields.source,fields.user_id,fields.target);const shadow=registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(fields.source,fields.user_id,fields.target);if(shadow){const w=await worker(fields.target);w.db.prepare('DELETE FROM sessions WHERE user_id=?').run(shadow.local_id);w.db.prepare('UPDATE users SET active=0 WHERE id=?').run(shadow.local_id)}}return send({ok:true});
    }
    fail('Funktionen finns inte.',404);
   }else if(/^\/calendar\/[a-f0-9]{64}\.ics$/.test(url.pathname)){
    const calendarToken=url.pathname.slice(10,-4);let found=null;for(const h of houses()){const w=await worker(h.id);if(w.db.prepare('SELECT u.id FROM calendar_subscriptions c JOIN users u ON u.id=c.user_id WHERE c.token=? AND u.active=1').get(calendarToken)){const owner=w.db.prepare('SELECT user_id FROM calendar_subscriptions WHERE token=?').get(calendarToken);const link=registry.prepare('SELECT * FROM shadows WHERE target=? AND local_id=?').get(h.id,owner.user_id);if(link){const source=await worker(link.source),user=source.db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(link.user_id);if(!user||!access({source:link.source,user_id:link.user_id,user,global:link.source===primary&&user.role==='superadmin'},h.id))continue}found=h.id;break}}if(!found)fail('Kalenderlänken är ogiltig eller återkallad.',404);target=found;
   }else if(url.pathname.startsWith('/api/')){
    const publicReset=['/api/password-reset/request','/api/password-reset/confirm'].includes(url.pathname);
    if(publicReset){target=requested||primary;if(!house(target))fail('Katthemmet finns inte.',404)}else{
     if(!p)fail('Logga in för att fortsätta.',401);
     if(url.pathname==='/api/logout'&&req.method==='POST'){const w=await worker(p.source);w.db.prepare('DELETE FROM sessions WHERE token=?').run(p.source_token);registry.prepare('DELETE FROM portal_sessions WHERE token=?').run(incomingToken);res.setHeader('Set-Cookie',cookie('',0));return send({ok:true})}
     if((!house(target)||!access(p,target))&&url.pathname!=='/api/password')fail('Du saknar åtkomst till katthemmet.',403);
     if(write&&(/^\/api\/users(?:\/|$)/.test(url.pathname)||/^\/api\/volunteers(?:\/|$)/.test(url.pathname))){const fields=json(payload),tw=await worker(target),id=Number(url.pathname.split('/')[3])||-1;const localId=url.pathname.startsWith('/api/volunteers/')?tw.db.prepare('SELECT user_id FROM member_profiles WHERE id=?').get(id)?.user_id:id;const managed=registry.prepare('SELECT * FROM shadows WHERE target=? AND local_id=?').get(target,localId??-1);const existing=localId?tw.db.prepare('SELECT * FROM users WHERE id=?').get(localId):null;const requestedRole=fields.account?.role||fields.role;if(registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,localId??-1))fail('Kontot har flyttats till ett annat katthem och kan inte återaktiveras här.',403);
      if(url.pathname.startsWith('/api/volunteers/')&&req.method==='PUT'&&localId){const shared=await sharedProfile(target,localId);if(shared.linked&&sharedProfileFields.some(k=>Object.hasOwn(fields,k)&&String(fields[k])!==String(({...profileValues(shared.profile),name:shared.user.name,email:shared.user.email})[k])))fail('Uppgiften delas mellan katthemmen. Öppna Gemensamma profiluppgifter och spara där.',409);}
      if(managed){if(/^portal-[a-f0-9]{32}@access\.invalid$/.test(existing.email)&&Object.hasOwn(fields,'email')){const source=await worker(managed.source),canonical=source.db.prepare('SELECT email FROM users WHERE id=?').get(managed.user_id)?.email;if(fields.email!==canonical&&fields.email!==existing.email)fail('Ändra inloggningsadressen i personens ordinarie katthem.',403);fields.email=existing.email;payload=Buffer.from(JSON.stringify(fields));}const a=fields.account||fields;if((requestedRole&&requestedRole!==existing.role)||(a.active!==undefined&&a.active!==Boolean(existing.active))||a.password)fail('Ändra tilldelad åtkomst under Hantera katthem och åtkomst.',403)}
      if(target!==primary&&requestedRole==='superadmin'&&(!managed||existing.role!=='superadmin'))fail('Systemets superadmin skapas i det ursprungliga katthemmet.',403)
     }
     if(url.pathname==='/api/profile'&&req.method==='PATCH'&&target!==p.source){const fields=json(payload);if(Object.hasOwn(fields,'name')&&fields.name!==p.user.name||Object.hasOwn(fields,'email')&&fields.email!==p.user.email)fail('Namn och inloggningsadress ändras i ditt ordinarie katthem.',403);delete fields.name;delete fields.email;payload=Buffer.from(JSON.stringify(fields));}
     if(url.pathname==='/api/password'&&req.method==='POST')target=p.source;
     token=await localSession(p,target);
     // A selected shelter cannot grant system-wide superadmin rights to another tenant.
     if(!p.global&&url.pathname.startsWith('/api/email-settings'))fail('Endast superadmin kan hantera e-post.',403);
     if(target!==p.source&&/^\/api\/users\/\d+/.test(url.pathname)&&Number(url.pathname.split('/')[3])===registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,p.user_id,target)?.local_id)fail('Hantera ditt ordinarie konto i ditt hemmakatthem.');
    }
   }else target=primary;
   if(p&&access(p,target))await syncGrantedProfiles(target);
   let presenceProof=false;if(url.pathname==='/api/presence/confirmations'&&req.method==='POST'){if(!p||!await grantStatus(p,target))return send({error:'Skanna den aktuella QR-koden på katthemmets skärm innan du bekräftar närvaro.',code:'QR_REQUIRED'},403);presenceProof=true}
   const w=await worker(target),headers={'x-portal-secret':secret,'x-portal-origin':origin};if(presenceProof)headers['x-presence-proof']=secret;if(req.headers.origin)headers.origin=req.headers.origin;if(!url.pathname.startsWith('/api/')&&req.headers['if-none-match'])headers['if-none-match']=req.headers['if-none-match'];if(payload)headers['content-type']='application/json';if(token)headers.cookie='session='+token;
   const result=await fetch(w.address+url.pathname+url.search,{method:req.method,headers,body:payload||undefined,redirect:'manual'});
   if(result.ok&&write&&p&&['admin','superadmin','coordinator'].includes(access(p,target))){const event=audit.fromRequest(url.pathname,req.method,payload?json(payload):{});if(event)audit.record({home:target,actor:p,...event})}
   if(result.ok&&write&&/^\/api\/(users|volunteers|members|profile)(\/|$)/.test(url.pathname))await reconcile();
   const contentType=result.headers.get('content-type')||'',buffer=Buffer.from(await result.arrayBuffer());
   if(url.pathname==='/api/login'&&result.ok){
    const localToken=result.headers.get('set-cookie')?.match(/session=([a-f0-9]+)/)?.[1],data=JSON.parse(buffer);if(!localToken||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,data.user.id)||registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(target,data.user.id))fail('Logga in med ditt ordinarie konto.',401);
    const newToken=randomBytes(32).toString('hex');registry.prepare('INSERT INTO portal_sessions VALUES(?,?,?,?,?,?)').run(newToken,target,data.user.id,localToken,target,Date.now()+86400000);p=await principal(newToken);if(data.password_change_required){res.setHeader('Set-Cookie',cookie(newToken));return send(data)}if(!access(p,target)){const next=houses().find(h=>access(p,h.id));if(!next)fail('Engagemanget har avslutats och personuppgifterna har gallrats.',401);registry.prepare('UPDATE portal_sessions SET selected=? WHERE token=?').run(next.id,newToken);res.setHeader('Set-Cookie',cookie(newToken));return send({redirect_home:true})}res.setHeader('Set-Cookie',cookie(newToken));if(data.users)for(const u of data.users){u.portal_managed=Boolean(registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(target,u.id));u.transfer_retired=Boolean(registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,u.id))};data.news=[...portalNews.visible(target,p),...(data.news||[])];data.bulletin_board=[...portalNews.board(target),...(data.bulletin_board||[])];if(p.global)data.portal_news_admin=portalNews.all();data.portal=metadata(p,target);data.portal.profile_identity_editable=target===p.source;return send(await displayContactEmails(data,target,p));
   }
   if(contentType.includes('application/json')&&result.ok&&p){const data=JSON.parse(buffer);if(url.pathname==='/api/calendar/subscription'&&data.url)data.url=new URL(new URL(data.url).pathname,origin).href;if(data.enabled!==undefined&&url.pathname.startsWith('/api/presence'))data.access_expires_at=await grantStatus(p,target);if(data.modules?.presence)data.modules.presence.access_expires_at=await grantStatus(p,target);if(data.user){if(data.users)for(const u of data.users){u.portal_managed=Boolean(registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(target,u.id));u.transfer_retired=Boolean(registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(target,u.id))};data.news=[...portalNews.visible(target,p),...(data.news||[])];data.bulletin_board=[...portalNews.board(target),...(data.bulletin_board||[])];if(p.global)data.portal_news_admin=portalNews.all();data.portal=metadata(p,target);data.portal.profile_identity_editable=target===p.source;data.shelter={name:house(target).name,configured:true,id:target};data.shelter_admin=data.user.role==='superadmin'||data.user.role==='admin'?data.shelter_admin:undefined}return send(await displayContactEmails(data,target,p),result.status)}
   for(const [key,value] of result.headers){if(!['set-cookie','connection','content-length','transfer-encoding','content-encoding'].includes(key))res.setHeader(key,value)}res.writeHead(result.status);res.end(buffer);
  }catch(e){if(res.headersSent){res.destroy();return}if(!e.status)console.error('Portal operation failed:',e.message);send({error:e.status?e.message:'Katthemmet kunde inte nås. Försök igen.',...(e.code?{code:e.code}:{})},e.status||503)}finally{if(tracked)activeRequests--}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
 const startupBackup=setTimeout(()=>{void maybeBackup()},1000);startupBackup.unref();
 const lifecycleTimer=setInterval(()=>{if(!backupBusy){try{lifecycle.purge();audit.prune()}catch{console.error('Underhåll kunde inte slutföras; nytt försök görs automatiskt.')}void maybeBackup()}},60000);lifecycleTimer.unref();
 const close=async()=>{clearTimeout(startupBackup);clearInterval(lifecycleTimer);closing=true;if(backupTask)await backupTask.catch(()=>{});await new Promise(r=>server.close(r));await Promise.all([...workers.values()].map(w=>new Promise(r=>{if(w.child.exitCode!==null)return r();w.child.once('exit',r);w.child.kill()})));registry.close()};
 return {server,close,maintenance:()=>lifecycle.purge()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const network=process.platform==='win32'&&root.startsWith('\\\\');const dataDir=process.env.DATA_DIR||(network&&process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Katthem','data'):path.join(root,'data'));
 const portal=await createPortal({dataDir,host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||3080)});console.log('Katthemmet: http://'+(process.env.HOST||'127.0.0.1')+':'+portal.server.address().port);
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>portal.close().then(()=>process.exit(0)));
}
