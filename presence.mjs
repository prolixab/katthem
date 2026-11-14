export const presenceModule=Object.freeze({id:'presence',version:2,title:'Närvarobekräftelse',defaultEnabled:false,transientTables:Object.freeze(['presence_confirmations','presence_last'])});
export function createPresence(db,{now=()=>new Date(),canConfirm=uid=>Boolean(db.prepare('SELECT active FROM users WHERE id=?').get(uid)?.active)}={}){
 const fail=(message,status=400,code)=>{throw Object.assign(Error(message),{status,code})};
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
 db.exec(`CREATE TABLE IF NOT EXISTS presence_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO presence_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS presence_confirmations(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('booked','spontaneous')),booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,CHECK((kind='booked' AND booking_id IS NOT NULL) OR (kind='spontaneous' AND booking_id IS NULL)));
 CREATE UNIQUE INDEX IF NOT EXISTS presence_booked_once ON presence_confirmations(user_id,day,booking_id) WHERE booking_id IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS presence_spontaneous_once ON presence_confirmations(user_id,day) WHERE booking_id IS NULL;
 CREATE TRIGGER IF NOT EXISTS presence_inactive_user AFTER UPDATE OF active ON users WHEN NEW.active=0 BEGIN DELETE FROM presence_confirmations WHERE user_id=NEW.id;END;`);
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='engagements'").get())db.exec("CREATE TRIGGER IF NOT EXISTS presence_inactive_engagement AFTER UPDATE OF status ON engagements WHEN NEW.status<>'active' BEGIN DELETE FROM presence_confirmations WHERE user_id=NEW.user_id;END;");
 db.exec('CREATE TABLE IF NOT EXISTS presence_last(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL);INSERT OR IGNORE INTO presence_last(user_id,day) SELECT user_id,MAX(day) FROM presence_confirmations GROUP BY user_id');
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='engagements'").get())db.exec("CREATE TRIGGER IF NOT EXISTS presence_last_purged AFTER UPDATE OF status ON engagements WHEN NEW.status='purged' BEGIN DELETE FROM presence_last WHERE user_id=NEW.user_id;END;");
 const settings=()=>{const s=db.prepare('SELECT enabled,revision FROM presence_settings WHERE id=1').get();return {...s,enabled:Boolean(s.enabled)}};
 const requireEnabled=()=>{if(!settings().enabled)fail('Närvarobekräftelse är inte aktiverad för detta katthem.',404,'MODULE_DISABLED')};
 function purge(){const day=today();db.prepare("DELETE FROM presence_confirmations WHERE day<>? OR (booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=presence_confirmations.booking_id AND s.date=presence_confirmations.day AND s.cancelled=0))").run(day)}
 function configure(p){
  if(!p||Object.keys(p).some(k=>!['enabled','revision'].includes(k))||typeof p.enabled!=='boolean'||!Number.isInteger(p.revision))fail('Välj aktivering och öppna inställningen igen.');
  db.exec('BEGIN IMMEDIATE');try{const result=db.prepare('UPDATE presence_settings SET enabled=?,revision=revision+1 WHERE id=1 AND revision=?').run(Number(p.enabled),p.revision);if(!result.changes)fail('Modulens inställning har ändrats. Uppdatera sidan och försök igen.',409);if(!p.enabled)db.exec('DELETE FROM presence_confirmations;DELETE FROM presence_last');db.exec('COMMIT');return settings()}catch(error){db.exec('ROLLBACK');throw error}
 }
 function snapshot(uid,{manage=false}={}){
  const config=settings();if(!config.enabled)return {enabled:false,...(manage?{settings:config}:{})};purge();const day=today();
  const bookings=db.prepare('SELECT b.id,s.title FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.date=? AND s.cancelled=0 ORDER BY s.start,s.id').all(uid,day);
  const mine=db.prepare('SELECT p.id,p.kind,p.booking_id,s.title FROM presence_confirmations p LEFT JOIN bookings b ON b.id=p.booking_id LEFT JOIN slots s ON s.id=b.slot_id WHERE p.user_id=? AND p.day=? ORDER BY p.id').all(uid,day);
  const rows=db.prepare('SELECT p.user_id,u.name,p.kind,s.title FROM presence_confirmations p JOIN users u ON u.id=p.user_id LEFT JOIN bookings b ON b.id=p.booking_id LEFT JOIN slots s ON s.id=b.slot_id WHERE p.day=? AND u.active=1 ORDER BY u.name,p.id').all(day),people=new Map();
  for(const row of rows){if(!canConfirm(row.user_id))continue;if(!people.has(row.user_id))people.set(row.user_id,{name:row.name,labels:[]});people.get(row.user_id).labels.push(row.kind==='booked'?row.title:'Hjälper till utanför bokat pass')}
  return {enabled:true,day,can_confirm:canConfirm(uid),bookings,mine,people:[...people.values()],...(manage?{settings:config}:{})};
 }
 function confirm(uid,p){
  if(!p||Object.keys(p).some(k=>!['kind','booking_id'].includes(k))||!['booked','spontaneous'].includes(p.kind)||p.kind==='booked'&&(!Number.isInteger(p.booking_id)||p.booking_id<1)||p.kind==='spontaneous'&&p.booking_id!==undefined)fail('Välj ett eget bokat pass idag eller en spontan insats.');
  db.exec('BEGIN IMMEDIATE');try{requireEnabled();if(!canConfirm(uid))fail('Du behöver ett aktivt engagemang för att bekräfta att du hjälper till.',403);purge();const day=today();
   if(p.kind==='booked'&&!db.prepare('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND b.user_id=? AND s.date=? AND s.cancelled=0').get(p.booking_id,uid,day))fail('Välj ett av dina egna aktiva pass idag.');
   db.prepare('INSERT OR IGNORE INTO presence_confirmations(user_id,day,kind,booking_id) VALUES(?,?,?,?)').run(uid,day,p.kind,p.kind==='booked'?p.booking_id:null);db.prepare('INSERT INTO presence_last(user_id,day) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET day=excluded.day').run(uid,day);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
 }
 function retract(uid,id){db.exec('BEGIN IMMEDIATE');try{requireEnabled();purge();const day=today(),result=db.prepare('DELETE FROM presence_confirmations WHERE id=? AND user_id=? AND day=?').run(id,uid,day);if(!result.changes)fail('Din bekräftelse finns inte längre.',404);if(!db.prepare('SELECT 1 FROM presence_confirmations WHERE user_id=? AND day=?').get(uid,day))db.prepare('DELETE FROM presence_last WHERE user_id=? AND day=?').run(uid,day);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}
 function last(uid){return settings().enabled?db.prepare('SELECT day FROM presence_last WHERE user_id=?').get(uid)?.day||null:null}
 async function route({pathname,method,uid,manage=false,admin=false,payload,baseUrl,home='huskvarna'}){
  if(pathname==='/api/presence/settings'&&method==='PUT'){if(!manage)fail('Endast superadmin kan koppla på modulen.',403);configure(payload);return snapshot(uid,{manage})}
  requireEnabled();
  if(pathname==='/api/presence'&&method==='GET')return snapshot(uid,{manage});
  if(pathname==='/api/presence/confirmations'&&method==='POST'){confirm(uid,payload);return snapshot(uid,{manage})}
  const remove=pathname.match(/^\/api\/presence\/confirmations\/(\d+)$/);if(remove&&method==='DELETE'){retract(uid,Number(remove[1]));return snapshot(uid,{manage})}
  if(pathname==='/api/presence/qr'&&method==='GET'){if(!admin)fail('Endast administratörer kan hämta QR-skylten.',403);const link=new URL('/',baseUrl);link.searchParams.set('shelter',home);link.hash='narvaro';const {default:QR}=await import('qrcode');return {link:link.href,png:await QR.toDataURL(link.href,{width:512,margin:4,errorCorrectionLevel:'M'})}}
  fail('Funktionen finns inte.',404);
 }
 return {settings,configure,snapshot,confirm,retract,last,purge,route};
}
