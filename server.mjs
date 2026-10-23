import http from 'node:http';
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
function hash(p){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')}
function verify(p,h){const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex'))}
function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){
 const admin=randomBytes(9).toString('base64url'), volunteer=randomBytes(9).toString('base64url');
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administratör','admin@katthem.local',hash(admin),'admin');
 db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Alex Volontär','alex@katthem.local',hash(volunteer),'volunteer');
 writeFileSync(path.join(dataDir,'lokala-konton.txt'),`Startkonton\n\nAdministratör: admin@katthem.local\nLösenord: ${admin}\n\nVolontär: alex@katthem.local\nLösenord: ${volunteer}\n\nÄndra lösenorden i appen innan verklig användning.\n`,{mode:0o600});
 const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
 const insert=db.prepare('INSERT INTO slots(date,start,end,title,capacity,note) VALUES(?,?,?,?,?,?)');
 for(let d=0;d<42;d++){const date=new Date(monday);date.setDate(date.getDate()+d);for(const [start,end,title] of [['08:00','10:00','Morgonpass'],['17:00','19:00','Kvällspass']])insert.run(localDate(date),start,end,title,2,title==='Morgonpass'?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');}
}
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const sessions=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires>? AND active=1');
function snapshot(user){return {user:publicUser(user),slots:db.prepare(`SELECT s.*,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id) booked,(SELECT COUNT(*) FROM bookings b WHERE b.slot_id=s.id AND user_id=?) mine FROM slots s ORDER BY date,start`).all(user.id),bookings:user.role==='admin'?db.prepare('SELECT b.*,u.name,u.email FROM bookings b JOIN users u ON u.id=b.user_id').all():db.prepare('SELECT * FROM bookings WHERE user_id=?').all(user.id),users:user.role==='admin'?db.prepare('SELECT id,name,email,role,active FROM users ORDER BY name').all():[]}}
async function body(req){let b='';for await(const c of req){b+=c;if(b.length>20000)fail('För stor begäran.',413)}try{return JSON.parse(b||'{}')}catch{fail('Ogiltiga uppgifter.')}}
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
 if(new Date(slot.date+'T'+slot.start+':00')<=new Date())fail('Passet har redan börjat.');
 if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(uid))fail('Volontären är inte aktiv.');
 if(db.prepare('SELECT id FROM bookings WHERE user_id=? AND slot_id=?').get(uid,slot.id))fail('Passet är redan bokat.',409);
 if(db.prepare('SELECT COUNT(*) n FROM bookings WHERE slot_id=?').get(slot.id).n>=slot.capacity)fail('Passet är fullbokat.',409);
 if(db.prepare('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.date=? AND s.start<? AND s.end>?').get(uid,slot.date,slot.end,slot.start))fail('Du har redan ett överlappande pass.',409);
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
 if(url.pathname.startsWith('/api/users/')&&req.method==='PATCH'){const id=Number(url.pathname.split('/').pop()),p=await body(req);if(id===user.id)fail('Du kan inte inaktivera ditt eget konto.');if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))fail('Kontot finns inte.',404);db.prepare('UPDATE users SET active=? WHERE id=?').run(p.active?1:0,id);return send(snapshot(user));}
 if(url.pathname==='/api/slots'&&req.method==='POST'){const p=await body(req);if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end||'')||p.start>=p.end||!p.title?.trim()||!Number.isInteger(Number(p.capacity))||p.capacity<1||p.capacity>50||!Number.isFinite(new Date(p.date+'T'+p.start).getTime()))fail('Kontrollera datum, tider och antal platser (1–50).');db.prepare('INSERT INTO slots(date,start,end,title,capacity,note) VALUES(?,?,?,?,?,?)').run(p.date,p.start,p.end,p.title.trim(),Number(p.capacity),String(p.note||''));return send(snapshot(user));}
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
