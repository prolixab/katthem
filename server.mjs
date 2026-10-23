import http from 'node:http';
import { parseVolunteersCsv } from './csv-import.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const production=process.env.NODE_ENV==='production';
const host=process.env.HOST||'127.0.0.1';
const appOrigin=process.env.APP_URL?new URL(process.env.APP_URL).origin:null;
if(production&&(!appOrigin||!appOrigin.startsWith('https://')))throw new Error('Production requires APP_URL with an HTTPS origin.');
const cookieOptions=`HttpOnly; SameSite=Strict; Path=/${production?'; Secure':''}`;
const dataDir=process.env.DATA_DIR||path.join(root,'data');
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'katthem.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'volunteer',active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS slots(id INTEGER PRIMARY KEY,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,title TEXT NOT NULL,capacity INTEGER NOT NULL,note TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,UNIQUE(user_id,slot_id)); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);`);
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='green_manual'))db.exec('ALTER TABLE users ADD COLUMN green_manual INTEGER NOT NULL DEFAULT 0');
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
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administratör','admin@katthem.local',hash(admin),'admin');
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Alex Volontär','alex@katthem.local',hash(volunteer),'volunteer');
 writeFileSync(path.join(dataDir,'lokala-konton.txt'),`Startkonton\n\nAdministratör: admin@katthem.local\nLösenord: ${admin}\n\nVolontär: alex@katthem.local\nLösenord: ${volunteer}\n\nÄndra lösenorden i appen innan verklig användning.\n`,{mode:0o600});
 const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
 const insert=db.prepare('INSERT INTO slots(date,start,end,title,capacity,note,cancelled) VALUES(?,?,?,?,?,?,?)');
 for(let d=0;d<42;d++){const date=new Date(monday);date.setDate(date.getDate()+d);for(const [start,end,title] of [['08:00','12:00','Morgonpass'],['16:00','18:00','Eftermiddagspass'],['18:00','20:00','Kvällspass']]){const rule=sundayRules(localDate(date),start,end,title,title==='Morgonpass'?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');insert.run(localDate(date),start,end,rule.title,0,rule.note,rule.cancelled);}}
}
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const sessions=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>? AND active=1');
function completedCounts(userId){
 const counts=new Map(),now=Date.now();
 const rows=userId===undefined?db.prepare('SELECT b.user_id,s.date,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0').all():db.prepare('SELECT b.user_id,s.date,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0 AND b.user_id=?').all(userId);
 for(const b of rows)if(new Date(b.date+'T'+b.end+':00').getTime()<=now)counts.set(b.user_id,(counts.get(b.user_id)||0)+1);
 return counts;
}
function publicUser(u,counts){const completed=counts.get(u.id)||0;return {id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,completed_shifts:completed,green_manual:Boolean(u.green_manual),green:u.role==='volunteer'&&(Boolean(u.green_manual)||completed>15)}}
function snapshot(user){
 const counts=completedCounts(user.role==='admin'?undefined:user.id);
 return {user:publicUser(user,counts),slots:db.prepare('SELECT s.*,2 minimum_staff,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id) booked,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id AND user_id=?) mine FROM slots s ORDER BY date,start').all(user.id),bookings:user.role==='admin'?db.prepare('SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id').all():db.prepare('SELECT * FROM bookings WHERE user_id=?').all(user.id),users:user.role==='admin'?db.prepare('SELECT id,name,email,role,active,green_manual FROM users ORDER BY name').all().map(u=>publicUser(u,counts)):[]};
}
async function body(req,maxLength=20000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>maxLength)fail('För stor begäran.',413);chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{fail('Ogiltiga uppgifter.')}}
function importEntries(p){
 if(typeof p.green!=='boolean')fail('Välj om importen ska grönmarkeras.');
 let entries;try{entries=parseVolunteersCsv(p.csv)}catch(e){fail(e.message)}
 const seen=new Set();
 for(const entry of entries){if(seen.has(entry.email)||db.prepare('SELECT id FROM users WHERE email=?').get(entry.email))fail('E-postadressen finns redan: '+entry.email);seen.add(entry.email);entry.green=p.green||entry.green}
 return entries;
}
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 try{
 const url=new URL(req.url,'http://localhost');
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
 if(!user)fail('Logga in för att fortsätta.',401);
 if(url.pathname==='/api/state'&&req.method==='GET')return send(snapshot(user));
 if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);res.setHeader('Set-Cookie',`session=; ${cookieOptions}; Max-Age=0`);return send({ok:true})}
 if(url.pathname==='/api/password'&&req.method==='POST'){const p=await body(req);if(typeof p.current!=='string'||!verify(p.current,user.password))fail('Nuvarande lösenord stämmer inte.');if(typeof p.password!=='string'||p.password.length<10||p.password.length>200)fail('Använd 10–200 tecken.');db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(p.password),user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,token);return send({ok:true})}
 if(url.pathname==='/api/bookings'&&req.method==='POST'){
 const p=await body(req),uid=user.role==='admin'&&p.userId?Number(p.userId):user.id;
 db.exec('BEGIN IMMEDIATE');try{
 const slot=db.prepare('SELECT * FROM slots WHERE id=?').get(Number(p.slotId));if(!slot)fail('Passet finns inte.',404);
 if(slot.cancelled)fail('Passet är inställt på grund av öppet hus.',409);
 if(new Date(slot.date+'T'+slot.start+':00')<=new Date())fail('Passet har redan börjat.');
 if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(uid))fail('Volontären är inte aktiv.');
 if(db.prepare('SELECT id FROM bookings WHERE user_id=? AND slot_id=?').get(uid,slot.id))fail('Passet är redan bokat.',409);
 if(db.prepare('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.cancelled=0 AND b.user_id=? AND s.date=? AND s.start<? AND s.end>?').get(uid,slot.date,slot.end,slot.start))fail('Du har redan ett överlappande pass.',409);
 db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(uid,slot.id);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}return send(snapshot(user));}
 if(url.pathname.startsWith('/api/bookings/')&&req.method==='DELETE'){
 const b=db.prepare('SELECT b.*,s.date,s.start FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?').get(Number(url.pathname.split('/').pop()));if(!b)fail('Bokningen finns inte.',404);
 if(user.role!=='admin'){if(b.user_id!==user.id)fail('Du saknar behörighet.',403);if(new Date(b.date+'T'+b.start+':00')-Date.now()<86400000)fail('Mindre än 24 timmar kvar. Kontakta administratören.');}
 db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);return send(snapshot(user));}
 if(user.role!=='admin')fail('Du saknar administratörsbehörighet.',403);
 if(url.pathname==='/api/export'&&req.method==='GET'){
 const rows=db.prepare('SELECT s.date,s.start,s.end,s.title,u.name,u.email FROM slots s LEFT JOIN bookings b ON b.slot_id=s.id LEFT JOIN users u ON u.id=b.user_id ORDER BY s.date,s.start').all();
 const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="katthem-schema.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+[['Datum','Start','Slut','Pass','Namn','E-post'],...rows.map(Object.values)].map(r=>r.map(cell).join(';')).join('\r\n'));}
 if(url.pathname==='/api/users'&&req.method==='POST'){const p=await body(req);if(!p.name?.trim()||!/^\S+@\S+\.\S+$/.test(p.email||'')||typeof p.password!=='string'||p.password.length<10||p.password.length>200)fail('Ange namn, giltig e-post och lösenord med 10–200 tecken.');if(db.prepare('SELECT id FROM users WHERE email=?').get(p.email.trim().toLowerCase()))fail('E-postadressen finns redan.');db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(p.name.trim(),p.email.trim().toLowerCase(),hash(p.password));return send(snapshot(user));}

 if(['/api/users/import-preview','/api/users/import'].includes(url.pathname)&&req.method==='POST'){
  const p=await body(req,1000000),entries=importEntries(p);
  if(url.pathname.endsWith('import-preview'))return send({users:entries.map(({name,email,green})=>({name,email,green}))});
  const prepared=entries.map(e=>({...e,passwordHash:hash(e.password)}));
  db.exec('BEGIN IMMEDIATE');try{const insert=db.prepare('INSERT INTO users(name,email,password,green_manual) VALUES(?,?,?,?)');for(const e of prepared)insert.run(e.name,e.email,e.passwordHash,e.green?1:0);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return send(snapshot(user));
 }
 if(url.pathname.startsWith('/api/users/')&&req.method==='PATCH'){
  const id=Number(url.pathname.split('/').pop()),p=await body(req),target=db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(!target)fail('Kontot finns inte.',404);
  const hasActive=Object.hasOwn(p,'active'),hasGreen=Object.hasOwn(p,'green');
  if(!hasActive&&!hasGreen)fail('Ange en ändring.');
  if(hasActive&&(id===user.id||![true,false,0,1].includes(p.active)))fail('Ogiltig aktivering eller försök att ändra eget konto.');
  if(hasGreen&&(target.role!=='volunteer'||typeof p.green!=='boolean'))fail('Grönmarkering gäller endast volontärer.');
  db.prepare('UPDATE users SET active=?,green_manual=? WHERE id=?').run(hasActive?Number(p.active):target.active,hasGreen?Number(p.green):target.green_manual,id);return send(snapshot(user));
 }
 if(url.pathname==='/api/slots'&&req.method==='POST'){const p=await body(req);if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end||'')||p.start>=p.end||!p.title?.trim()||!Number.isFinite(new Date(p.date+'T'+p.start).getTime()))fail('Kontrollera datum och tider.');const rule=sundayRules(p.date,p.start,p.end,p.title.trim(),String(p.note||''));if(rule.cancelled)fail('Passet 16–18 är inställt första söndagen i månaden på grund av öppet hus.');db.prepare('INSERT INTO slots(date,start,end,title,capacity,note,cancelled) VALUES(?,?,?,?,?,?,?)').run(p.date,p.start,p.end,rule.title,0,rule.note,0);return send(snapshot(user));}
 if(url.pathname.startsWith('/api/slots/')&&req.method==='DELETE'){db.prepare('DELETE FROM slots WHERE id=?').run(Number(url.pathname.split('/').pop()));return send(snapshot(user));}
 fail('Sidan finns inte.',404);
 }
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found')}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(readFileSync(path.join(root,'public',file)));
 }catch(e){if(!e.status)console.error(e);send({error:e.status?e.message:'Ett oväntat fel inträffade.'},e.status||500)}
});
server.listen(Number(process.env.PORT||3080),host,()=>console.log(`Katthemmet: http://${host}:${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
 server.close(()=>{db.close();process.exit(0)});
 setTimeout(()=>process.exit(1),10000).unref();
});
