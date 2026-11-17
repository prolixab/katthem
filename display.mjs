import {randomBytes,createHash,createHmac} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const digest=key=>createHash('sha256').update(key).digest('hex');
export function createScheduleDisplay(registry,{now=()=>Date.now()}={}){
 registry.exec('CREATE TABLE IF NOT EXISTS schedule_displays(home TEXT PRIMARY KEY REFERENCES shelters(id),key_hash TEXT,show_names INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0)');
 if(!registry.prepare('PRAGMA table_info(schedule_displays)').all().some(c=>c.name==='allow_checkin'))registry.exec('ALTER TABLE schedule_displays ADD COLUMN allow_checkin INTEGER NOT NULL DEFAULT 0');
 registry.exec("CREATE TABLE IF NOT EXISTS display_devices(home TEXT NOT NULL,token_hash TEXT NOT NULL,link_hash TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,pair_hash TEXT,pair_expires INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL,PRIMARY KEY(home,token_hash));");
 if(!registry.prepare('PRAGMA table_info(schedule_displays)').all().some(c=>c.name==='device_revision'))registry.exec('ALTER TABLE schedule_displays ADD COLUMN device_revision INTEGER NOT NULL DEFAULT 0');
 if(!registry.prepare('PRAGMA table_info(schedule_displays)').all().some(c=>c.name==='security_enabled'))registry.exec('ALTER TABLE schedule_displays ADD COLUMN security_enabled INTEGER NOT NULL DEFAULT 0');
 function status(home){const row=registry.prepare('SELECT * FROM schedule_displays WHERE home=?').get(home);return {security_enabled:Boolean(row?.security_enabled),enabled:Boolean(row?.key_hash),show_names:Boolean(row?.show_names),allow_checkin:Boolean(row?.allow_checkin),revision:row?.revision||0,device_revision:row?.device_revision||0,device_registered:Boolean(registry.prepare('SELECT 1 FROM display_devices WHERE home=? AND approved=1 AND expires>?').get(home,now()))}}
 function configure(home,p,enabled){
  if(enabled&&p?.allow_checkin===true&&!p.show_names)fail('Aktivera visning av förnamn för att använda dagens namnlista.');
  if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['revision',...(enabled?['show_names','allow_checkin']:[])].includes(k))||!Number.isInteger(p.revision)||p.revision<0||enabled&&(typeof p.show_names!=='boolean'||p.allow_checkin!==undefined&&typeof p.allow_checkin!=='boolean'||p.allow_checkin&&!p.show_names))fail('Hämta aktuell status och kontrollera inställningarna.');
  const key=enabled?randomBytes(32).toString('hex'):null;
  registry.exec('BEGIN IMMEDIATE');try{registry.prepare('INSERT OR IGNORE INTO schedule_displays(home) VALUES(?)').run(home);const result=registry.prepare('UPDATE schedule_displays SET key_hash=?,show_names=?,allow_checkin=?,revision=revision+1 WHERE home=? AND revision=?').run(key?digest(key):null,Number(Boolean(p.show_names)),Number(enabled&&Boolean(p.allow_checkin)),home,p.revision);if(!result.changes)fail('Visningslänken har ändrats. Hämta status igen.',409);registry.prepare('DELETE FROM display_devices WHERE home=?').run(home);registry.exec('COMMIT')}catch(error){registry.exec('ROLLBACK');throw error}
  return {...status(home),...(key?{key}:{})};
 }
 function authorize(home,key){if(typeof key!=='string'||! /^[a-f0-9]{64}$/.test(key))fail('Visningslänken är ogiltig eller återkallad.',404);const row=registry.prepare('SELECT show_names,allow_checkin,revision,device_revision,security_enabled FROM schedule_displays WHERE home=? AND key_hash=?').get(home,digest(key));if(!row)fail('Visningslänken är ogiltig eller återkallad.',404);return {security_enabled:Boolean(row.security_enabled),show_names:Boolean(row.show_names),allow_checkin:Boolean(row.allow_checkin),revision:row.revision,device_revision:row.device_revision}}
 function enroll(home,key,token){
  authorize(home,key);registry.prepare('DELETE FROM display_devices WHERE expires<=? OR (approved=0 AND pair_expires<=?)').run(now(),now());
  const existing=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?registry.prepare('SELECT * FROM display_devices WHERE home=? AND token_hash=? AND link_hash=?').get(home,digest(token),digest(key)):null;
  if(existing?.approved)return {approved:true};
  if(!existing&&registry.prepare('SELECT count(*) n FROM display_devices WHERE home=? AND approved=0').get(home).n>=10)fail('Flera registreringar väntar. Försök igen om tio minuter.',429);
  const deviceToken=existing?token:randomBytes(32).toString('hex'),code=randomBytes(5).toString('hex').toUpperCase(),expires=now()+600000;
  registry.prepare('INSERT INTO display_devices(home,token_hash,link_hash,pair_hash,pair_expires,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(home,token_hash) DO UPDATE SET pair_hash=excluded.pair_hash,pair_expires=excluded.pair_expires,expires=excluded.expires').run(home,digest(deviceToken),digest(key),digest(code),expires,now()+365*86400000);
  return {approved:false,pairing_code:code,pairing_expires:expires,token:deviceToken};
 }
 function authorizeDevice(home,key,token){
  const config=authorize(home,key),row=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?registry.prepare('SELECT * FROM display_devices WHERE home=? AND token_hash=? AND link_hash=? AND approved=1 AND expires>?').get(home,digest(token),digest(key),now()):null;
  if(!row)throw Object.assign(Error('Den här webbläsaren behöver godkännas av superadmin.'),{status:403,code:'DEVICE_REQUIRED'});
  return {...config,device_hash:row.token_hash};
 }
 function bind(home,p,remove=false){
  if(!p||Object.keys(p).some(k=>!['revision','device_revision',...(remove?[]:['pairing_code'])].includes(k))||!Number.isInteger(p.revision)||!Number.isInteger(p.device_revision)||!remove&&(typeof p.pairing_code!=='string'||! /^[A-F0-9]{10}$/.test(p.pairing_code.replace(/[ -]/g,'').toUpperCase())))fail('Ange koden som visas på skärmen och hämta aktuell status.');
  registry.exec('BEGIN IMMEDIATE');try{
   const row=registry.prepare('SELECT * FROM schedule_displays WHERE home=?').get(home);if(!row?.key_hash||row.revision!==p.revision||row.device_revision!==p.device_revision)fail('Inställningen har ändrats. Öppna den igen.',409);
   if(remove)registry.prepare('DELETE FROM display_devices WHERE home=?').run(home);
   else{const device=registry.prepare('SELECT * FROM display_devices WHERE home=? AND link_hash=? AND pair_hash=? AND pair_expires>? AND approved=0').get(home,row.key_hash,digest(p.pairing_code.replace(/[ -]/g,'').toUpperCase()),now());if(!device)fail('Koden är ogiltig eller har gått ut. Hämta en ny kod på visningsdatorn.',409);registry.prepare('DELETE FROM display_devices WHERE home=? AND token_hash<>?').run(home,device.token_hash);registry.prepare('UPDATE display_devices SET approved=1,pair_hash=NULL,pair_expires=0 WHERE home=? AND token_hash=?').run(home,device.token_hash)}
   registry.prepare('UPDATE schedule_displays SET device_revision=device_revision+1 WHERE home=?').run(home);registry.exec('COMMIT');return status(home);
  }catch(error){registry.exec('ROLLBACK');throw error}
 }
 function authorizeRead(home,key,token){const config=authorize(home,key);if(config.security_enabled)return authorizeDevice(home,key,token);try{return authorizeDevice(home,key,token)}catch(error){if(error.code!=='DEVICE_REQUIRED')throw error;return {...config,device_hash:null}}}
 function security(home,p){
  if(!p||Object.keys(p).some(k=>!['enabled','revision','device_revision'].includes(k))||typeof p.enabled!=='boolean'||!Number.isInteger(p.revision)||!Number.isInteger(p.device_revision))fail('Välj säkerhetsinställning och hämta aktuell status.');
  const result=registry.prepare('UPDATE schedule_displays SET security_enabled=?,device_revision=device_revision+1 WHERE home=? AND revision=? AND device_revision=?').run(Number(p.enabled),home,p.revision,p.device_revision);if(!result.changes)fail('Inställningen har ändrats. Öppna den igen.',409);return status(home);
 }
 function validBinding(home,deviceHash,revision){const row=registry.prepare('SELECT device_revision,key_hash FROM schedule_displays WHERE home=?').get(home);return Boolean(row?.key_hash&&row.device_revision===revision&&registry.prepare('SELECT 1 FROM display_devices WHERE home=? AND token_hash=? AND approved=1 AND link_hash=? AND expires>?').get(home,deviceHash,row.key_hash,now()))}
 return {status,configure,authorize,enroll,authorizeDevice,authorizeRead,security,bind,validBinding};

}
export function displayWeek(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),start=new Date(Date.UTC(year,0,1));return {year,number:Math.ceil(((d-start)/86400000+1)/7)}}
export function displaySchedule(db,{name,show_names=false,now=new Date(),slotKey=null}={}){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),date=new Date(today+'T12:00:00Z');
 const days=Array.from({length:7},(_,i)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+i);const day=d.toISOString().slice(0,10);return {date:day,week:displayWeek(day),slots:[]}}),byDay=new Map(days.map(d=>[d.date,d]));
 const labels=show_names?displayNames(db.prepare('SELECT DISTINCT u.id user_id,u.name FROM users u JOIN bookings b ON b.user_id=u.id JOIN slots s ON s.id=b.slot_id WHERE s.date BETWEEN ? AND ? AND s.cancelled=0').all(days[0].date,days[6].date)):new Map();
 const rows=db.prepare('SELECT id,date,start,end,title,cancelled FROM slots WHERE date BETWEEN ? AND ? ORDER BY date,start,id').all(days[0].date,days[6].date);
 for(const slot of rows){const people=db.prepare('SELECT u.id user_id,u.name FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.slot_id=? ORDER BY u.name COLLATE NOCASE,b.id').all(slot.id);byDay.get(slot.date).slots.push({... (slotKey?{key:slotKey(slot.id,slot.date)}:{}),title:slot.title,start:slot.start,end:slot.end,cancelled:Boolean(slot.cancelled),booked:slot.cancelled?0:people.length,...(show_names?{names:slot.cancelled?[]:people.map(p=>labels.get(p.user_id)?.label||'Volontär')}:{})})}
 return {shelter_name:name,today,show_names,days};
}
// Only enough surname letters to distinguish booked people are exposed.
export function displayNames(people){
 const unique=new Map(people.map(p=>[p.user_id,p.name.trim().normalize('NFC')])),parts=new Map([...unique].map(([id,name])=>{const [first,...rest]=name.split(/\s+/);return [id,{first:first||'Volontär',last:rest.join(' ')}]})),result=new Map(),fold=s=>s.toLocaleLowerCase('sv-SE');
 for(const [id,p] of parts){const peers=[...parts].filter(([other,q])=>other!==id&&fold(q.first)===fold(p.first));if(!peers.length){result.set(id,{label:p.first,ambiguous:false});continue}const chars=Array.from(p.last),max=Math.max(chars.length,...peers.map(([,q])=>Array.from(q.last).length));let n=1;for(;n<=max;n++){const prefix=fold(chars.slice(0,n).join(''));if(peers.every(([,q])=>fold(Array.from(q.last).slice(0,n).join(''))!==prefix))break}const ambiguous=n>max,suffix=chars.slice(0,n).join('');result.set(id,{label:p.first+(suffix?' '+suffix+(n<chars.length?'.':''):''),ambiguous})}
 return result;
}

export function createPresenceTickets({secret,now=()=>Date.now(),validBinding}={}){
 const issued=new Map();
 function prune(){for(const [token,payload] of issued)if((payload.minute+1)*60000<=now())issued.delete(token)}
 function issue(home,device_hash,device_revision,module_revision){prune();const payload={home,device_hash,device_revision,module_revision,minute:Math.floor(now()/60000)},token=createHmac('sha256',secret).update(JSON.stringify(payload)).digest('base64url');issued.set(token,payload);return {token,expires_at:(payload.minute+1)*60000}}
 function verify(token,home,module_revision){
  prune();const p=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?issued.get(token):null;
  if(!p||p.home!==home||p.module_revision!==module_revision||p.minute!==Math.floor(now()/60000)||!validBinding(home,p.device_hash,p.device_revision))fail('QR-koden har gått ut eller återkallats. Skanna den aktuella koden på skärmen.',403);
  return {...p};
 }
 return {issue,verify};
}

export function createPresenceGrants({tickets,validBinding,now=()=>Date.now()}={}){
 const grants=new Map(),key=(session,home)=>digest(session+':'+home);
 function grant(session,home,token,module){
  if(!module?.enabled)fail('Närvaromodulen är avstängd.',404);
  const ticket=tickets.verify(token,home,module.revision);for(const [id,value] of grants)if(value.expires_at<=now())grants.delete(id);
  if(grants.size>=5000)fail('För många samtidiga bekräftelser. Försök igen senare.',429);
  const value={device_hash:ticket.device_hash,device_revision:ticket.device_revision,module_revision:module.revision,expires_at:now()+300000};grants.set(key(session,home),value);return value.expires_at;
 }
 function expires(session,home,module){const value=grants.get(key(session,home));return value&&value.expires_at>now()&&module?.enabled&&value.module_revision===module.revision&&validBinding(home,value.device_hash,value.device_revision)?value.expires_at:0}
 return {grant,expires};
}
