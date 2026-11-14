import {randomBytes,createHash} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const digest=key=>createHash('sha256').update(key).digest('hex');
export function createScheduleDisplay(registry){
 registry.exec('CREATE TABLE IF NOT EXISTS schedule_displays(home TEXT PRIMARY KEY REFERENCES shelters(id),key_hash TEXT,show_names INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0)');
 if(!registry.prepare('PRAGMA table_info(schedule_displays)').all().some(c=>c.name==='allow_checkin'))registry.exec('ALTER TABLE schedule_displays ADD COLUMN allow_checkin INTEGER NOT NULL DEFAULT 0');
 function status(home){const row=registry.prepare('SELECT * FROM schedule_displays WHERE home=?').get(home);return {enabled:Boolean(row?.key_hash),show_names:Boolean(row?.show_names),allow_checkin:Boolean(row?.allow_checkin),revision:row?.revision||0}}
 function configure(home,p,enabled){
  if(enabled&&p?.allow_checkin===true&&!p.show_names)fail('Aktivera visning av förnamn för att använda dagens namnlista.');
  if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['revision',...(enabled?['show_names','allow_checkin']:[])].includes(k))||!Number.isInteger(p.revision)||p.revision<0||enabled&&(typeof p.show_names!=='boolean'||p.allow_checkin!==undefined&&typeof p.allow_checkin!=='boolean'||p.allow_checkin&&!p.show_names))fail('Hämta aktuell status och kontrollera inställningarna.');
  const key=enabled?randomBytes(32).toString('hex'):null;
  registry.exec('BEGIN IMMEDIATE');try{registry.prepare('INSERT OR IGNORE INTO schedule_displays(home) VALUES(?)').run(home);const result=registry.prepare('UPDATE schedule_displays SET key_hash=?,show_names=?,allow_checkin=?,revision=revision+1 WHERE home=? AND revision=?').run(key?digest(key):null,Number(Boolean(p.show_names)),Number(enabled&&Boolean(p.allow_checkin)),home,p.revision);if(!result.changes)fail('Visningslänken har ändrats. Hämta status igen.',409);registry.exec('COMMIT')}catch(error){registry.exec('ROLLBACK');throw error}
  return {...status(home),...(key?{key}:{})};
 }
 function authorize(home,key){if(typeof key!=='string'||! /^[a-f0-9]{64}$/.test(key))fail('Visningslänken är ogiltig eller återkallad.',404);const row=registry.prepare('SELECT show_names,allow_checkin FROM schedule_displays WHERE home=? AND key_hash=?').get(home,digest(key));if(!row)fail('Visningslänken är ogiltig eller återkallad.',404);return {show_names:Boolean(row.show_names),allow_checkin:Boolean(row.allow_checkin)}}
 return {status,configure,authorize};
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
