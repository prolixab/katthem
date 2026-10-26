import {createRecurringBookings} from './recurring.mjs';
import {checklistGroups} from './checklist.mjs';
import {createSchedule} from './schedule.mjs';
import {createNotifications} from './notifications.mjs';
import {createPasswordReset} from './password-reset.mjs';
import {calendarEvent,calendarEvents} from './calendar.mjs';
import http from 'node:http';
import {createMembers} from './members.mjs';
import { isAdmin,isSuperAdmin,canManageAccount,isGreen } from './roles.mjs';
import { upgradeDefaultShifts } from './schedule-upgrade.mjs';
import { createEmailSettings } from './email-settings.mjs';
import { isInactive } from './activity.mjs';
import { createReminders } from './reminders.mjs';
import { parseVolunteersCsv } from './csv-import.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const production=process.env.NODE_ENV==='production';
const host=process.env.HOST||'127.0.0.1';
const appOrigin=process.env.APP_URL?new URL(process.env.APP_URL).origin:null;
if(production&&(!appOrigin||!appOrigin.startsWith('https://')))throw new Error('Production requires APP_URL with an HTTPS origin.');
const cookieOptions=`HttpOnly; SameSite=Strict; Path=/${production?'; Secure':''}`;
// Keep SQLite on a local disk when the Windows checkout is on a network share.
const networkCheckout=process.platform==='win32'&&root.startsWith('\\');
const defaultDataDir=networkCheckout&&process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Katthem','data'):path.join(root,'data');
const dataDir=process.env.DATA_DIR||defaultDataDir;
if(!process.env.DATA_DIR&&dataDir!==path.join(root,'data')&&!existsSync(path.join(dataDir,'katthem.sqlite'))&&existsSync(path.join(root,'data','katthem.sqlite')))throw new Error('Stoppa appen och kopiera den befintliga data-mappen till '+dataDir+' innan du startar igen.');
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'katthem.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'volunteer',active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS slots(id INTEGER PRIMARY KEY,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,title TEXT NOT NULL,capacity INTEGER NOT NULL,note TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,UNIQUE(user_id,slot_id)); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);`);
const members=createMembers(db);
const recurring=createRecurringBookings(db);
db.exec('CREATE TABLE IF NOT EXISTS calendar_subscriptions(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token TEXT NOT NULL UNIQUE)');
db.exec("CREATE TABLE IF NOT EXISTS door_access(id INTEGER PRIMARY KEY CHECK(id=1),code TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER);INSERT OR IGNORE INTO door_access(id) VALUES(1);");
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='green_manual'))db.exec('ALTER TABLE users ADD COLUMN green_manual INTEGER NOT NULL DEFAULT 0');
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='created_at')){
 db.exec('ALTER TABLE users ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');db.prepare('UPDATE users SET created_at=?').run(Date.now());
}
if(!db.prepare('PRAGMA table_info(slots)').all().some(c=>c.name==='kind'))db.exec("ALTER TABLE slots ADD COLUMN kind TEXT NOT NULL DEFAULT 'regular'");
if(!db.prepare('PRAGMA table_info(slots)').all().some(c=>c.name==='extra_info'))db.exec("ALTER TABLE slots ADD COLUMN extra_info TEXT NOT NULL DEFAULT ''");
// capacity=0 means unlimited; every active shift needs at least two volunteers.
function sundayRules(date,start,end,title,note=''){
 const day=new Date(date+'T12:00:00');
 const sunday=day.getDay()===0;
 if(sunday&&day.getDate()<=7&&start<'18:00'&&end>'16:00')return {title:'Inställt – öppet hus',note:'Öppet hus första söndagen i månaden. Passet 16–18 är inställt.',cancelled:1};
 if(sunday&&start==='18:00'&&end==='20:00')return {title:'Socialiseringsgruppen',note:'Ordinarie uppgifter och en stunds socialiseringsträning med katterna. Anmäl dig gärna till passet.',cancelled:0};
 return {title,note,cancelled:0};
}
if(!db.prepare('PRAGMA table_info(slots)').all().some(c=>c.name==='cancelled')){
 if(db.prepare('SELECT COUNT(*) n FROM slots').get().n&&!existsSync(path.join(dataDir,'schema-v1-backup.sqlite')))db.prepare('VACUUM INTO ?').run(path.join(dataDir,'schema-v1-backup.sqlite'));
 db.exec('BEGIN IMMEDIATE');
 try{
 db.exec('ALTER TABLE slots ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0; UPDATE slots SET capacity=0;');
 const update=db.prepare('UPDATE slots SET title=?,note=?,cancelled=? WHERE id=?');
 for(const slot of db.prepare('SELECT * FROM slots').all()){
  const rule=sundayRules(slot.date,slot.start,slot.end,slot.title,slot.note);
  update.run(rule.title,rule.note,rule.cancelled,slot.id);
 }
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
function hash(p){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')}
function verify(p,h){const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex'))}
function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){
 const admin=randomBytes(9).toString('base64url'), volunteer=randomBytes(9).toString('base64url');
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administratör','admin@katthem.local',hash(admin),'superadmin');
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Alex Volontär','alex@katthem.local',hash(volunteer),'volunteer');
 writeFileSync(path.join(dataDir,'lokala-konton.txt'),`Startkonton\n\nAdministratör: admin@katthem.local\nLösenord: ${admin}\n\nVolontär: alex@katthem.local\nLösenord: ${volunteer}\n\nÄndra lösenorden i appen innan verklig användning.\n`,{mode:0o600});
 const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
 const insert=db.prepare('INSERT INTO slots(date,start,end,title,capacity,note,cancelled) VALUES(?,?,?,?,?,?,?)');
 for(let d=0;d<42;d++){const date=new Date(monday);date.setDate(date.getDate()+d);for(const [start,end,title] of [['08:00','12:00','Morgonpass'],['16:00','18:00','Eftermiddagspass'],['18:00','20:00','Kvällspass']]){const rule=sundayRules(localDate(date),start,end,title,title==='Morgonpass'?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');insert.run(localDate(date),start,end,rule.title,0,rule.note,rule.cancelled);}}
}
db.prepare('UPDATE users SET created_at=? WHERE created_at=0').run(Date.now());
// Explicit bootstrap for existing installations; never choose a person's account automatically.
if(process.env.BOOTSTRAP_SUPERADMIN_EMAIL&&!db.prepare("SELECT id FROM users WHERE role='superadmin' AND active=1").get()){
 const selected=db.prepare('SELECT id FROM users WHERE email=? AND active=1').get(process.env.BOOTSTRAP_SUPERADMIN_EMAIL.trim().toLowerCase());
 if(!selected)throw Error('BOOTSTRAP_SUPERADMIN_EMAIL måste matcha ett befintligt aktivt konto.');
 db.prepare("UPDATE users SET role='superadmin' WHERE id=?").run(selected.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(selected.id);
}

// Add open house once for each first Sunday already present in the schedule.
db.exec('CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)');
if(!db.prepare('SELECT name FROM migrations WHERE name=?').get('default-shifts-08-12-16-18-18-20-v1')&&db.prepare("SELECT id FROM slots WHERE (start='08:00' AND end='10:00') OR (start='17:00' AND end='19:00') LIMIT 1").get()&&!existsSync(path.join(dataDir,'before-shift-times-upgrade.sqlite')))db.prepare('VACUUM INTO ?').run(path.join(dataDir,'before-shift-times-upgrade.sqlite'));
upgradeDefaultShifts(db,sundayRules);
if(!db.prepare('SELECT name FROM migrations WHERE name=?').get('open-house-11-15')){
 db.exec('BEGIN IMMEDIATE');try{
 const add=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind) SELECT ?,'11:00','15:00','Öppet hus',0,'Hjälp till under öppet hus. Volontärer kan anmäla sig själva.',0,'open_house' WHERE NOT EXISTS(SELECT 1 FROM slots WHERE date=? AND kind='open_house')");
 for(const {date} of db.prepare('SELECT DISTINCT date FROM slots').all()){const d=new Date(date+'T12:00');if(d.getDay()===0&&d.getDate()<=7)add.run(date,date)}
 db.prepare('INSERT INTO migrations VALUES(?)').run('open-house-11-15');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
db.exec('CREATE TABLE IF NOT EXISTS volunteer_meeting_origins(date TEXT PRIMARY KEY,slot_id INTEGER NOT NULL REFERENCES slots(id))');
function ensureOpenHouse(){
 const now=new Date(),insert=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind) SELECT ?,'11:00','15:00','Öppet hus',0,'Hjälp till under öppet hus. Volontärer kan anmäla sig själva.',0,'open_house' WHERE NOT EXISTS(SELECT 1 FROM slots WHERE date=? AND kind='open_house')");
 for(let month=0;month<12;month++){const d=new Date(now.getFullYear(),now.getMonth()+month,1,12);d.setDate(1+(7-d.getDay())%7);const date=localDate(d);insert.run(date,date)}
 // Keep the original occurrence so moved or cancelled meetings are not recreated.
 db.exec('BEGIN IMMEDIATE');try{
 for(const {date} of db.prepare("SELECT DISTINCT date FROM slots WHERE kind='open_house' AND date>=?").all(localDate(now))){
  if(db.prepare('SELECT 1 FROM volunteer_meeting_origins WHERE date=?').get(date))continue;
  const existing=db.prepare("SELECT id FROM slots WHERE date=? AND start='15:00' AND end='16:00' AND title='Volontärsträff' AND kind='event' ORDER BY id LIMIT 1").get(date);
  const id=existing?.id||Number(db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind,extra_info) VALUES(?,'15:00','16:00','Volontärsträff',0,'Gemensam volontärsträff efter öppet hus. Träffen pågår i en timme.',0,'event','')").run(date).lastInsertRowid);
  db.prepare('INSERT INTO volunteer_meeting_origins(date,slot_id) VALUES(?,?)').run(date,id);
 }
 db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e}
}
ensureOpenHouse();
// One-time assignment explicitly requested by the account owner.
if(!db.prepare('SELECT name FROM migrations WHERE name=?').get('superadmin-daniel-20261024')){
 db.exec('BEGIN IMMEDIATE');try{
 const selected=db.prepare('SELECT id FROM users WHERE email=? AND active=1').get('daniel@staahlis.se');
 if(selected){db.prepare("UPDATE users SET role='superadmin' WHERE id=?").run(selected.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(selected.id)}
 db.prepare('INSERT INTO migrations VALUES(?)').run('superadmin-daniel-20261024');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
const emailSettings=createEmailSettings({dataDir,defaultUrl:appOrigin||'http://127.0.0.1:'+String(process.env.PORT||3080),production,fallback:{apiKey:process.env.RESEND_API_KEY,from:process.env.EMAIL_FROM,appUrl:appOrigin}});
const reminders=createReminders(db,{mailProvider:emailSettings});
const schedule=createSchedule(db,sundayRules);schedule.ensure();
const notifications=createNotifications(db,emailSettings);
const passwordReset=createPasswordReset(db,emailSettings,hash);
db.exec("CREATE TABLE IF NOT EXISTS volunteer_info(id INTEGER PRIMARY KEY CHECK(id=1),location TEXT NOT NULL DEFAULT '',access TEXT NOT NULL DEFAULT '',introduction TEXT NOT NULL DEFAULT '',routines TEXT NOT NULL DEFAULT ''); INSERT OR IGNORE INTO volunteer_info(id) VALUES(1)");
// Apply the confirmed address once; future admin edits remain intact.
if(!db.prepare('SELECT name FROM migrations WHERE name=?').get('shelter-address-thulevagen-2-v1')){
 db.exec('BEGIN');try{db.prepare('UPDATE volunteer_info SET location=? WHERE id=1').run('Thulevägen 2, 561 32 Huskvarna');db.prepare('INSERT INTO migrations VALUES(?)').run('shelter-address-thulevagen-2-v1');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
}
const checklistIds=new Set(checklistGroups.flatMap(group=>group.items.map(item=>item.id)));
db.exec('CREATE TABLE IF NOT EXISTS checklist_progress(user_id INTEGER NOT NULL REFERENCES users(id),item_id TEXT NOT NULL,PRIMARY KEY(user_id,item_id))');
const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,code})};
const sessions=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>? AND active=1');
function completedCounts(userId){
 const counts=new Map(),now=Date.now();counts.last=new Map();
 const rows=userId===undefined?db.prepare('SELECT b.user_id,s.date,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0').all():db.prepare('SELECT b.user_id,s.date,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0 AND b.user_id=?').all(userId);
 for(const b of rows){const ended=new Date(b.date+'T'+b.end+':00').getTime();if(ended<=now){counts.set(b.user_id,(counts.get(b.user_id)||0)+1);counts.last.set(b.user_id,Math.max(counts.last.get(b.user_id)||0,ended))}}
 return counts;
}
function publicUser(u,counts){const completed=counts.get(u.id)||0;return {id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,completed_shifts:completed,last_completed_at:counts.last.get(u.id)||null,inactive_month:isInactive(u,counts.last.get(u.id)),green_manual:Boolean(u.green_manual),green:isGreen(u,completed)}}
function snapshot(user){
 ensureOpenHouse();schedule.ensure();
 const counts=completedCounts();
 const greenIds=new Set(db.prepare('SELECT id,role,green_manual FROM users').all().filter(u=>isGreen(u,counts.get(u.id)||0)).map(u=>u.id));
 const greenCounts=new Map();for(const b of db.prepare('SELECT user_id,slot_id FROM bookings').all())if(greenIds.has(b.user_id))greenCounts.set(b.slot_id,(greenCounts.get(b.slot_id)||0)+1);
 return {members_enabled:isAdmin(user),members:isAdmin(user)?members.list():undefined,door_code:db.prepare('SELECT code,revision,updated_at FROM door_access WHERE id=1').get(),checklist:{groups:checklistGroups,checked_items:db.prepare('SELECT item_id FROM checklist_progress WHERE user_id=? ORDER BY item_id').all(user.id).map(row=>row.item_id)},volunteer_info:db.prepare('SELECT location FROM volunteer_info WHERE id=1').get(),change_notifications:isAdmin(user)?notifications.status():undefined,email_reminders:isAdmin(user)?reminders.status():undefined,user:publicUser(user,counts),slots:db.prepare('SELECT s.*,EXISTS(SELECT 1 FROM volunteer_meeting_origins v WHERE v.slot_id=s.id) volunteer_meeting,2 minimum_staff,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id) booked,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id AND user_id=?) mine FROM slots s ORDER BY date,start').all(user.id).map(s=>({...s,green_booked:greenCounts.get(s.id)||0})),bookings:isAdmin(user)?db.prepare('SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id').all():db.prepare('SELECT * FROM bookings WHERE user_id=?').all(user.id),users:isAdmin(user)?db.prepare('SELECT id,name,email,role,active,green_manual,created_at FROM users ORDER BY name').all().map(u=>publicUser(u,counts)):[]};
}
async function body(req,maxLength=20000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>maxLength)fail('För stor begäran.',413);chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{fail('Ogiltiga uppgifter.')}}
function importEntries(p){
 if(typeof p.green!=='boolean')fail('Välj om importen ska grönmarkeras.');
 let entries;try{entries=parseVolunteersCsv(p.csv)}catch(e){fail(e.message)}
 const seen=new Set();
 for(const entry of entries){if(seen.has(entry.email)||db.prepare('SELECT id FROM users WHERE email=?').get(entry.email))fail('E-postadressen finns redan: '+entry.email);seen.add(entry.email);entry.green=p.green||entry.green}
 return entries;
}
function validateExtraInfo(value){if(typeof value!=='string'||value.length>1000)fail('Extra information får innehålla högst 1000 tecken.');}
function validateSlot(p){
 if(p.extra_info!==undefined)validateExtraInfo(p.extra_info);
 if(typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||typeof p.start!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||typeof p.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||p.start>=p.end||typeof p.title!=='string'||!p.title.trim()||p.title.length>100||localDate(new Date(p.date+'T12:00'))!==p.date||typeof(p.note??'')!=='string'||(p.note||'').length>1000)fail('Kontrollera datum, tider, namn och information.');
}
function extraSlotPlan(p){
 validateSlot(p);if(![1,2,4].includes(p.interval)||typeof p.until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.until))fail('Välj intervall och slutdatum.');
 if(new Date(p.date+'T'+p.start+':00')<=new Date())fail('Välj en framtida starttid.');
 const start=new Date(p.date+'T12:00:00Z'),end=new Date(p.until+'T12:00:00Z');
 if(!Number.isFinite(end.getTime())||end.toISOString().slice(0,10)!==p.until||end<start||end-start>364*86400000)fail('Välj ett giltigt slutdatum högst ett år efter startdatum.');
 const rows=[];for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+p.interval*7)){
 const date=d.toISOString().slice(0,10),rule=sundayRules(date,p.start,p.end,p.title.trim(),p.note||'');
 const exists=db.prepare("SELECT id FROM slots WHERE date=? AND start=? AND end=? AND kind='regular' LIMIT 1").get(date,p.start,p.end);
 rows.push({date,start:p.start,end:p.end,title:rule.title,note:rule.note,extra_info:(p.extra_info||'').trim(),status:rule.cancelled?'cancelled':exists?'exists':'new'});
 }
 return {rows,key:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
const attempts=new Map(),resetAttempts=new Map();
function resetRateLimit(req){
 const key=req.socket.remoteAddress,now=Date.now();
 for(const [ip,value] of resetAttempts)if(value.until<=now)resetAttempts.delete(ip);
 let value=resetAttempts.get(key);if(!value){value={count:0,until:now+60000};resetAttempts.set(key,value)}
 if(++value.count>10)fail('För många försök. Vänta en minut.',429);
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 const url=new URL(req.url,'http://localhost');
 if(/^\/calendar\/[a-f0-9]{64}\.ics$/.test(url.pathname)&&req.method==='GET'){
  const owner=db.prepare('SELECT u.id FROM calendar_subscriptions c JOIN users u ON u.id=c.user_id WHERE c.token=? AND u.active=1').get(url.pathname.slice(10,-4));
  if(!owner)fail('Kalenderlänken är ogiltig eller återkallad.',404);
  schedule.ensure();ensureOpenHouse();
  const slots=db.prepare('SELECT s.* FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0 ORDER BY s.date,s.start,s.id').all(owner.id);
  res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'});
  return res.end(calendarEvents(slots,{appUrl:emailSettings.appUrl(),location:db.prepare('SELECT location FROM volunteer_info WHERE id=1').get().location}));
 }
 if(url.pathname==='/healthz'&&req.method==='GET'){db.prepare('SELECT 1').get();return send({ok:true})}
 if(url.pathname.startsWith('/api/')){
 if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==(appOrigin||`http://${req.headers.host}`))fail('Begäran blockerades.',403);
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
 let user=token?sessions.get(token,Date.now()):null;
 if(url.pathname==='/api/login'&&req.method==='POST'){
 const key=req.socket.remoteAddress;let a=attempts.get(key);if(!a||a.until<Date.now()){a={count:0,until:Date.now()+60000};attempts.set(key,a)}if(++a.count>15)fail('För många försök. Vänta en minut.',429);
 const p=await body(req);user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(p.email).trim().toLowerCase());
 if(!user||typeof p.password!=='string'||!verify(p.password,user.password))fail('Fel e-post eller lösenord.',401);
 const t=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,user.id,Date.now()+86400000);
 res.setHeader('Set-Cookie',`session=${t}; ${cookieOptions}; Max-Age=86400`);return send(snapshot(user));}
 if(url.pathname==='/api/password-reset/request'&&req.method==='POST'){resetRateLimit(req);const p=await body(req);return send(await passwordReset.request(p?.email))}
 if(url.pathname==='/api/password-reset/confirm'&&req.method==='POST'){resetRateLimit(req);const p=await body(req);return send(passwordReset.reset(p?.token,p?.password))}
 if(!user)fail('Logga in för att fortsätta.',401);
 if(url.pathname==='/api/calendar/subscription'){
  if(req.method==='DELETE'){db.prepare('DELETE FROM calendar_subscriptions WHERE user_id=?').run(user.id);return send({revoked:true})}
  if(req.method==='POST'){
   let subscription=db.prepare('SELECT token FROM calendar_subscriptions WHERE user_id=?').get(user.id);
   if(!subscription){subscription={token:randomBytes(32).toString('hex')};db.prepare('INSERT INTO calendar_subscriptions(user_id,token) VALUES(?,?)').run(user.id,subscription.token)}
   const origin=appOrigin||`http://${req.headers.host}`;
   return send({url:new URL('/calendar/'+subscription.token+'.ics',origin).href});
  }
 }
 if(url.pathname==='/api/state'&&req.method==='GET')return send(snapshot(user));
 if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie',`session=; ${cookieOptions}; Max-Age=0`);return send({ok:true})}
 if(url.pathname==='/api/password'&&req.method==='POST'){const p=await body(req);if(typeof p.current!=='string'||!verify(p.current,user.password))fail('Nuvarande lösenord stämmer inte.');if(typeof p.password!=='string'||p.password.length<10||p.password.length>200)fail('Använd 10–200 tecken.');db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(p.password),user.id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,token);return send({ok:true})}
 if(url.pathname==='/api/bookings/recurring'&&req.method==='POST'){
 const p=await body(req),uid=isAdmin(user)&&p.userId?Number(p.userId):user.id;
 schedule.ensure();ensureOpenHouse();
 if(p.preview===true)return send(recurring.preview(uid,p));
 recurring.book(uid,p);return send(snapshot(user));
 }
 if(url.pathname==='/api/bookings'&&req.method==='POST'){

 const p=await body(req),uid=isAdmin(user)&&p.userId?Number(p.userId):user.id;
 db.exec('BEGIN IMMEDIATE');try{
 const slot=db.prepare('SELECT * FROM slots WHERE id=?').get(Number(p.slotId));if(!slot)fail('Passet finns inte.',404);
 if(slot.cancelled)fail(slot.kind==='event'?'Händelsen är inställd.':'Passet är inställt.',409);
 if(new Date(slot.date+'T'+slot.start+':00')<=new Date())fail('Passet har redan börjat.');
 if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(uid))fail('Volontären är inte aktiv.');
 if(db.prepare('SELECT id FROM bookings WHERE user_id=? AND slot_id=?').get(uid,slot.id))fail('Passet är redan bokat.',409);
 if(db.prepare('SELECT COUNT(*) n FROM bookings WHERE slot_id=?').get(slot.id).n>=7&&p.confirmOverLimit!==true)fail('Det är redan minst 7 anmälda. Vill du boka ändå?',409,'RECOMMENDED_LIMIT');
 const overlaps=db.prepare('SELECT s.title,s.start,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0 AND b.user_id=? AND s.date=? AND s.start<? AND s.end>?').all(uid,slot.date,slot.end,slot.start);
 if(overlaps.length&&p.confirmOverlap!==true)fail('Bokningen överlappar '+overlaps.map(s=>s.title+' '+s.start+'–'+s.end).join(', ')+' den '+slot.date+'. Vill du boka ändå?',409,'OVERLAPPING_BOOKING');
 db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(uid,slot.id);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}return send(snapshot(user));}
 if(url.pathname.startsWith('/api/bookings/')&&req.method==='DELETE'){
 const b=db.prepare('SELECT b.*,s.date,s.start FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?').get(Number(url.pathname.split('/').pop()));if(!b)fail('Bokningen finns inte.',404);
 if(!isAdmin(user)){if(b.user_id!==user.id)fail('Du saknar behörighet.',403);if(new Date(b.date+'T'+b.start+':00')-Date.now()<86400000)fail('Mindre än 24 timmar kvar. Kontakta katthemmets bemanningsgrupp i Messenger.');}
 db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);return send(snapshot(user));}
 if(url.pathname==='/api/calendar/week'&&req.method==='GET'){
  const start=url.searchParams.get('start')||'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start))fail('Välj en giltig vecka.');
  const monday=new Date(start+'T12:00:00Z');
  if(!Number.isFinite(monday.getTime())||monday.toISOString().slice(0,10)!==start||monday.getUTCDay()!==1)fail('Välj en giltig vecka.');
  const end=new Date(monday);end.setUTCDate(end.getUTCDate()+6);
  const slots=db.prepare('SELECT s.* FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0 AND s.date>=? AND s.date<=? ORDER BY s.date,s.start,s.id').all(user.id,start,end.toISOString().slice(0,10));
  if(!slots.length)fail('Du har inga bokade pass denna vecka.',404);
  res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="katthem-vecka-'+start+'.ics"','Cache-Control':'no-store'});
  return res.end(calendarEvents(slots,{appUrl:emailSettings.appUrl(),location:db.prepare('SELECT location FROM volunteer_info WHERE id=1').get().location}));
 }
 if(/^\/api\/bookings\/\d+\/calendar$/.test(url.pathname)&&req.method==='GET'){
  const booking=db.prepare('SELECT b.user_id,s.* FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?').get(Number(url.pathname.split('/')[3]));
  if(!booking)fail('Bokningen finns inte.',404);if(booking.user_id!==user.id&&!isAdmin(user))fail('Du saknar behörighet.',403);if(booking.cancelled)fail('Passet är inställt.',409);
  res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="katthem-pass.ics"','Cache-Control':'no-store'});return res.end(calendarEvent(booking,{appUrl:emailSettings.appUrl(),location:db.prepare('SELECT location FROM volunteer_info WHERE id=1').get().location}));
 }
 if(url.pathname==='/api/checklist'&&req.method==='PATCH'){
  const p=await body(req);
  if(!p||Object.keys(p).some(key=>!['item_id','checked'].includes(key))||!checklistIds.has(p.item_id)||typeof p.checked!=='boolean')fail('Välj en giltig punkt och om den ska vara ikryssad.');
  if(p.checked)db.prepare('INSERT OR IGNORE INTO checklist_progress(user_id,item_id) VALUES(?,?)').run(user.id,p.item_id);
  else db.prepare('DELETE FROM checklist_progress WHERE user_id=? AND item_id=?').run(user.id,p.item_id);
  return send({item_id:p.item_id,checked:p.checked});
 }
 if(!isAdmin(user))fail('Du saknar administratörsbehörighet.',403);
 if(url.pathname==='/api/door-code'&&req.method==='PUT'){
  const p=await body(req);if(!p||typeof p.code!=='string'||p.code.length>80||/[\r\n\0]/.test(p.code)||!Number.isInteger(p.revision))fail('Ange en dörrkod med högst 80 tecken och ladda om vid behov.');
  const result=db.prepare('UPDATE door_access SET code=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').run(p.code.trim(),Date.now(),p.revision);
  if(!result.changes)fail('Dörrkoden har ändrats av någon annan. Ladda om sidan innan du sparar.',409);return send(snapshot(user));
 }
 if((url.pathname==='/api/members'&&req.method==='POST')||(/^\/api\/members\/\d+$/.test(url.pathname)&&req.method==='PUT')){const p=await body(req);members.save(req.method==='POST'?null:Number(url.pathname.split('/').pop()),p);return send(snapshot(user))}

 if(url.pathname==='/api/volunteer-info'&&req.method==='PUT'){
  const p=await body(req),fields=['location'];
  if(fields.some(k=>typeof p?.[k]!=='string'||p[k].length>4000))fail('Varje informationsfält får innehålla högst 4000 tecken.');
  db.prepare('UPDATE volunteer_info SET location=? WHERE id=1').run(...fields.map(k=>p[k].trim()));return send(snapshot(user));
 }
 if(url.pathname.startsWith('/api/email-settings')&&!isSuperAdmin(user))fail('Endast superadmin får hantera e-postinställningar.',403);
 if(url.pathname==='/api/email-settings'&&req.method==='GET')return send(emailSettings.settings());
 if(url.pathname==='/api/email-settings'&&req.method==='PUT'){const p=await body(req);return send(emailSettings.save(p))}
 if(url.pathname==='/api/email-settings/test'&&req.method==='POST'){const p=await body(req);return send(await emailSettings.test(p.to))}
 if(url.pathname==='/api/reminders/send'&&req.method==='POST'){if(!reminders.status().configured)fail('E-post är inte konfigurerad. Öppna E-postinställningar i Administration.',503);const result=await reminders.run();return send({...snapshot(user),reminder_result:result})}
 if(url.pathname==='/api/export'&&req.method==='GET'){
 const rows=db.prepare("SELECT s.date,s.start,s.end,s.title,CASE WHEN s.cancelled=1 THEN 'Inställt' ELSE 'Aktivt' END status,u.name,u.email FROM slots s LEFT JOIN bookings b ON b.slot_id=s.id LEFT JOIN users u ON u.id=b.user_id ORDER BY s.date,s.start").all();
 const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="katthem-schema.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+[['Datum','Start','Slut','Pass','Status','Namn','E-post'],...rows.map(Object.values)].map(r=>r.map(cell).join(';')).join('\r\n'));}
 if(/^\/api\/users\/\d+\/password$/.test(url.pathname)&&req.method==='POST'){
  const id=Number(url.pathname.split('/')[3]),p=await body(req);
  if(id===user.id)fail('Byt ditt eget lösenord under Mitt konto.');
  const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(id);if(!target)fail('Kontot finns inte.',404);if(!canManageAccount(user,target))fail('Endast superadmin får byta administratörers lösenord.',403);
  if(typeof p.password!=='string'||p.password.length<10||p.password.length>200)fail('Använd 10–200 tecken.');
  const passwordHash=hash(p.password);
  db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash,id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return send(snapshot(user));
 }
 if(url.pathname==='/api/users'&&req.method==='POST'){const p=await body(req);if(!p.name?.trim()||!/^\S+@\S+\.\S+$/.test(p.email||'')||typeof p.password!=='string'||p.password.length<10||p.password.length>200)fail('Ange namn, giltig e-post och lösenord med 10–200 tecken.');if(db.prepare('SELECT id FROM users WHERE email=?').get(p.email.trim().toLowerCase()))fail('E-postadressen finns redan.');if(p.role!==undefined&&!['superadmin','admin','volunteer'].includes(p.role))fail('Ogiltig roll.');if((p.role||'volunteer')!=='volunteer'&&!isSuperAdmin(user))fail('Endast superadmin får skapa administratörskonton.',403);db.prepare('INSERT INTO users(name,email,password,role,created_at) VALUES(?,?,?,?,?)').run(p.name.trim(),p.email.trim().toLowerCase(),hash(p.password),p.role||'volunteer',Date.now());return send(snapshot(user));}

 if(['/api/users/import-preview','/api/users/import'].includes(url.pathname)&&req.method==='POST'){
  const p=await body(req,1000000),entries=importEntries(p);
  if(url.pathname.endsWith('import-preview'))return send({users:entries.map(({name,email,green})=>({name,email,green}))});
  const prepared=entries.map(e=>({...e,passwordHash:hash(e.password)}));
  db.exec('BEGIN IMMEDIATE');try{const insert=db.prepare('INSERT INTO users(name,email,password,green_manual,created_at) VALUES(?,?,?,?,?)');for(const e of prepared)insert.run(e.name,e.email,e.passwordHash,e.green?1:0,Date.now());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return send(snapshot(user));
 }
 if(url.pathname.startsWith('/api/users/')&&req.method==='PATCH'){
  const id=Number(url.pathname.split('/').pop()),p=await body(req),target=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(!target)fail('Kontot finns inte.',404);
  if(!canManageAccount(user,target))fail('Endast superadmin får hantera administratörskonton.',403);
  const hasActive=Object.hasOwn(p,'active'),hasGreen=Object.hasOwn(p,'green'),hasRole=Object.hasOwn(p,'role');
  if(!hasActive&&!hasGreen&&!hasRole)fail('Ange en ändring.');
  if(hasActive&&(id===user.id||![true,false,0,1].includes(p.active)))fail('Ogiltig aktivering eller försök att ändra eget konto.');
  if(hasGreen&&(target.role!=='volunteer'||typeof p.green!=='boolean'))fail('Grönmarkering gäller endast volontärer.');
  if(hasRole&&!isSuperAdmin(user))fail('Endast superadmin får ändra behörigheter.',403);if(hasRole&&(!['superadmin','admin','volunteer'].includes(p.role)||id===user.id))fail('Ogiltig roll eller försök att ändra egen roll.');db.prepare('UPDATE users SET active=?,green_manual=?,role=? WHERE id=?').run(hasActive?Number(p.active):target.active,hasGreen?Number(p.green):target.green_manual,hasRole?p.role:target.role,id);return send(snapshot(user));
 }

 if(url.pathname==='/api/slots/series'&&req.method==='POST'){
 const p=await body(req);schedule.ensure();ensureOpenHouse();
 if(p.preview===true)return send(extraSlotPlan(p));
 db.exec('BEGIN IMMEDIATE');try{const plan=extraSlotPlan(p);if(p.key!==plan.key)fail('Schemat har ändrats. Förhandsgranska serien igen.',409);const pending=plan.rows.filter(r=>r.status==='new');if(!pending.length)fail('Inga nya pass att skapa.');
 const insert=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind,extra_info) VALUES(?,?,?,?,0,?,0,'regular',?)");for(const row of pending)insert.run(row.date,row.start,row.end,row.title,row.note,row.extra_info);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e}return send(snapshot(user));
 }
 if(url.pathname==='/api/slots'&&req.method==='POST'){

  const p=await body(req);validateSlot(p);const kind=p.kind||'regular';if(!['regular','event'].includes(kind))fail('Öppet hus skapas automatiskt första söndagen i månaden.');
  if(kind==='event'&&new Date(p.date+'T'+p.start)<=new Date())fail('Välj en framtida tid för händelsen.');
  const rule=kind==='event'?{title:p.title.trim(),note:String(p.note||''),cancelled:0}:sundayRules(p.date,p.start,p.end,p.title.trim(),String(p.note||''));if(rule.cancelled)fail('Passet 16–18 är inställt första söndagen i månaden på grund av öppet hus.');
  db.prepare('INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind,extra_info) VALUES(?,?,?,?,?,?,?,?,?)').run(p.date,p.start,p.end,rule.title,0,rule.note,0,kind,(p.extra_info||'').trim());return send(snapshot(user));
 }
 if(/^\/api\/slots\/\d+$/.test(url.pathname)&&['PATCH','DELETE'].includes(req.method)){
  const id=Number(url.pathname.split('/').pop()),p=req.method==='DELETE'?{cancelled:true}:await body(req);
  db.exec('BEGIN IMMEDIATE');try{
   const slot=db.prepare('SELECT * FROM slots WHERE id=?').get(id);if(!slot)fail('Passet finns inte.',404);
   if(new Date(slot.date+'T'+slot.end)<=new Date())fail('Ett avslutat pass kan inte ändras.');
   const extraOnly=req.method==='PATCH'&&Object.keys(p).length===1&&Object.hasOwn(p,'extra_info');
   if(slot.kind==='open_house'&&!extraOnly)fail('Öppet hus ligger fast första söndagen i månaden.');
   if(extraOnly){validateExtraInfo(p.extra_info);db.prepare('UPDATE slots SET extra_info=? WHERE id=?').run(p.extra_info.trim(),id)}
   else if(p.cancelled===true){db.prepare('UPDATE slots SET cancelled=1 WHERE id=?').run(id)}else{
    validateSlot(p);if(new Date(p.date+'T'+p.start)<=new Date())fail('Välj en framtida tid.');
    const rule=slot.kind==='regular'?sundayRules(p.date,p.start,p.end,p.title.trim(),p.note||''):{title:p.title.trim(),note:p.note||'',cancelled:0};
    if(rule.cancelled)fail('Passet 16–18 är inställt första söndagen i månaden på grund av öppet hus.');
    const conflicts=db.prepare('SELECT DISTINCT u.name,s.title,s.start,s.end FROM bookings current JOIN users u ON u.id=current.user_id JOIN bookings other ON other.user_id=current.user_id JOIN slots s ON s.id=other.slot_id WHERE current.slot_id=? AND other.slot_id<>? AND s.cancelled=0 AND s.date=? AND s.start<? AND s.end>?').all(id,id,p.date,p.end,p.start);
    if(conflicts.length&&p.confirmOverlap!==true)fail('Den nya tiden överlappar andra bokningar:\n'+conflicts.map(c=>c.name+': '+c.title+' '+c.start+'–'+c.end).join('\n')+'\nVill du spara ändringen ändå?',409,'OVERLAPPING_BOOKING');
    db.prepare('UPDATE slots SET date=?,start=?,end=?,title=?,note=?,extra_info=?,cancelled=0 WHERE id=?').run(p.date,p.start,p.end,p.title.trim(),p.note||'',(p.extra_info??slot.extra_info).trim(),id);
    if(slot.cancelled||p.date!==slot.date||p.start!==slot.start||p.end!==slot.end)db.prepare('DELETE FROM reminder_delivery WHERE booking_id IN (SELECT id FROM bookings WHERE slot_id=?)').run(id);
   }
   notifications.queue(slot,db.prepare('SELECT * FROM slots WHERE id=?').get(id));
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  notifications.run().catch(()=>console.error('Ändringsutskick misslyckades.'));
  return send(snapshot(user));
 }
 fail('Sidan finns inte.',404);
 }
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found')}
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(readFileSync(path.join(root,'public',file)));
 }catch(e){if(!e.status)console.error(e);send({error:e.status?e.message:'Ett oväntat fel inträffade.',code:e.status?e.code:undefined},e.status||500)}
});
async function maintenance(){schedule.ensure();ensureOpenHouse();await Promise.all([reminders.run(),notifications.run()])}
const reminderTimer=setInterval(()=>maintenance().catch(()=>console.error('Bakgrundskörning misslyckades.')),60000);reminderTimer.unref();
maintenance().catch(()=>console.error('Bakgrundskörning misslyckades.'));
server.listen(Number(process.env.PORT||3080),host,()=>console.log(`Katthemmet: http://${host}:${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 clearInterval(reminderTimer);server.close(async()=>{await Promise.all([reminders.drain(),notifications.drain()]);db.close();process.exit(0)});
 setTimeout(()=>process.exit(1),10000).unref();
});
