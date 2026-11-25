import {eventStaffing,assertEventCapacity} from './event-staffing.mjs';
import {displayNames} from './display.mjs';
export function createPortalEvents(db,{houses,account,admin,access,overlaps,now=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS shared_events(id INTEGER PRIMARY KEY,title TEXT NOT NULL,note TEXT NOT NULL,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,required INTEGER NOT NULL,capacity INTEGER NOT NULL DEFAULT 0,targets TEXT NOT NULL,organizers TEXT NOT NULL,goals TEXT NOT NULL DEFAULT '{}',cancelled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS shared_event_bookings(event_id INTEGER NOT NULL REFERENCES shared_events(id),source TEXT NOT NULL,user_id INTEGER NOT NULL,home TEXT NOT NULL,PRIMARY KEY(event_id,source,user_id));`);
 const fail=(message,status=400,code)=>{throw Object.assign(Error(message),{status,code})};
 const read=id=>{const e=db.prepare('SELECT * FROM shared_events WHERE id=?').get(id);if(!e)fail('Händelsen finns inte.',404);return {...e,targets:JSON.parse(e.targets),organizers:JSON.parse(e.organizers),goals:JSON.parse(e.goals)}};
 const same=(a,b)=>a.source===b.source&&Number(a.user_id)===Number(b.user_id);
 const active=(source,id)=>{const u=account(source,id);return u?.active&&(!u.status||u.status==='active')?u:null};
 const manages=(p,e)=>p.global||e.targets.every(h=>admin(p,h))||e.organizers.some(o=>same(o,p)&&active(o.source,o.user_id));
 const sees=(p,e)=>p.global||e.targets.some(h=>access(p,h))||manages(p,e);
 const bookingRows=e=>db.prepare('SELECT * FROM shared_event_bookings WHERE event_id=?').all(e.id);
 const dateValid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 function validate(p){
  if(!p||typeof p!=='object'||Array.isArray(p))fail('Kontrollera eventets uppgifter.');
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>100||typeof p.note!=='string'||p.note.length>1000||!dateValid(p.date)||typeof p.start!=='string'||typeof p.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||p.start>=p.end||new Date(p.date+'T'+p.start)<=now())fail('Kontrollera namn, beskrivning och framtida datum och tider.');
  const {required,capacity}=eventStaffing(p),validHomes=houses().map(h=>h.id);
  if(!Array.isArray(p.targets)||!p.targets.length||new Set(p.targets).size!==p.targets.length||p.targets.some(h=>!validHomes.includes(h)))fail('Välj deltagande katthem.');
  if(!Array.isArray(p.organizers)||p.organizers.length>20||p.organizers.some(o=>!o||typeof o!=='object'||!p.targets.includes(o.source)||!Number.isInteger(o.user_id)||!active(o.source,o.user_id)))fail('Välj aktiva eventansvariga från deltagande katthem.');
  if(new Set(p.organizers.map(o=>o.source+':'+o.user_id)).size!==p.organizers.length)fail('Samma eventansvarig är vald flera gånger.');
  const goals=p.goals||{};if(typeof goals!=='object'||Array.isArray(goals)||Object.entries(goals).some(([h,n])=>!p.targets.includes(h)||!Number.isInteger(n)||n<0||n>500)||Object.values(goals).reduce((a,b)=>a+b,0)>required)fail('Fördelningen per hem får sammanlagt inte överstiga bemanningsbehovet.');
  return {...p,title:p.title.trim(),note:p.note.trim(),required,capacity,goals};
 }
 function save(p,id,input){
  db.exec('BEGIN IMMEDIATE');try{
   const old=id?read(id):null;
   if(old&&!manages(p,old))fail('Du får bara hantera tilldelade event.',403);
   if(old&&new Date(old.date+'T'+old.end)<=now())fail('Ett avslutat event kan inte ändras.');
   const e=validate(input);
   if(!p.global&&(!old||JSON.stringify(old.targets)!==JSON.stringify(e.targets)||JSON.stringify(old.organizers)!==JSON.stringify(e.organizers))&&!e.targets.every(h=>admin(p,h)))fail('Admin i samtliga deltagande hem eller SA behöver välja hem och eventansvariga.',403);
   if(old){
    if(old.revision!==input.revision)fail('Händelsen har ändrats. Öppna den igen.',409);
    const bookings=bookingRows(old);if(e.capacity&&bookings.length>e.capacity)fail('Taket får inte vara lägre än antalet bokade.');
    if(bookings.some(b=>!e.targets.includes(b.home)))fail('Avboka deltagare från hemmet innan det tas bort.');
    if(bookings.some(b=>hasOverlap(e,b,old.id))&&input.confirmOverlap!==true)fail('Den nya tiden överlappar deltagarnas andra bokningar. Bekräfta för att spara.',409,'OVERLAPPING_BOOKING');
    assertAdults(e,bookings);
    db.prepare('UPDATE shared_events SET title=?,note=?,date=?,start=?,end=?,required=?,capacity=?,targets=?,organizers=?,goals=?,cancelled=0,revision=revision+1 WHERE id=?').run(e.title,e.note,e.date,e.start,e.end,e.required,e.capacity,JSON.stringify(e.targets),JSON.stringify(e.organizers),JSON.stringify(e.goals),id);
   }else id=Number(db.prepare('INSERT INTO shared_events(title,note,date,start,end,required,capacity,targets,organizers,goals) VALUES(?,?,?,?,?,?,?,?,?,?)').run(e.title,e.note,e.date,e.start,e.end,e.required,e.capacity,JSON.stringify(e.targets),JSON.stringify(e.organizers),JSON.stringify(e.goals)).lastInsertRowid);
   db.exec('COMMIT');return id;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function age(person,date){const birth=account(person.source,person.user_id)?.birth_date;if(!birth)return null;let n=Number(date.slice(0,4))-Number(birth.slice(0,4));if(date.slice(5)<birth.slice(5))n--;return n}
 function assertAdults(e,rows){if(rows.some(b=>age(b,e.date)!==null&&age(b,e.date)<18)&&!rows.some(b=>age(b,e.date)>=18))fail('En minderårig behöver en myndig deltagare på eventet.',409,'ADULT_REQUIRED')}
 function hasOverlap(e,person,exclude){return overlaps(person,e)||db.prepare('SELECT e.* FROM shared_event_bookings b JOIN shared_events e ON e.id=b.event_id WHERE b.source=? AND b.user_id=? AND e.cancelled=0 AND e.id<>? AND e.date=? AND e.start<? AND e.end>?').get(person.source,person.user_id,exclude||0,e.date,e.end,e.start)}
 function book(p,id,fields={}){
  db.exec('BEGIN IMMEDIATE');try{
   const e=read(id);if(!sees(p,e))fail('Du saknar åtkomst till händelsen.',403);
   const person=fields.person||{source:p.source,user_id:p.user_id};if(typeof person.source!=='string'||!Number.isInteger(person.user_id))fail('Välj en giltig deltagare.');if(!same(p,person)&&!manages(p,e))fail('Du får bara boka dig själv.',403);
   const u=active(person.source,person.user_id);if(!u)fail('Kontot är pausat, inaktivt eller avslutat.',409);
   const home=fields.home||person.source;if(!e.targets.includes(home)||!(home===person.source||access({...p,...person,user:u,global:false},home)))fail('Välj ett deltagande katthem som personen tillhör.',403);
   if(e.cancelled||new Date(e.date+'T'+e.start)<=now())fail('Eventet är inställt eller har börjat.',409);
   if(fields.intro_budget!==null&&fields.intro_budget!==undefined){const count=db.prepare('SELECT e.date,e.start FROM shared_event_bookings b JOIN shared_events e ON e.id=b.event_id WHERE b.source=? AND b.user_id=? AND e.cancelled=0').all(person.source,person.user_id).filter(e=>new Date(e.date+'T'+e.start+':00').getTime()>=(fields.intro_started_at||0)).length;if(count>=fields.intro_budget)fail('Dina tre introduktionsbokningar är använda. Kontakta admin.',409,'INTRODUCTION_LIMIT');}
   const rows=bookingRows(e);if(rows.some(b=>same(b,person)))fail('Du är redan bokad på eventet.',409);
   assertEventCapacity({kind:'event',capacity:e.capacity},rows.length);assertAdults(e,[...rows,person]);
   if(hasOverlap(e,person,id)&&fields.confirmOverlap!==true)fail('Eventet överlappar en annan bokning. Vill du boka ändå?',409,'OVERLAPPING_BOOKING');
   db.prepare('INSERT INTO shared_event_bookings VALUES(?,?,?,?)').run(id,person.source,person.user_id,home);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function cancelBooking(p,id,person=p){
  if(!person||typeof person.source!=='string'||!Number.isInteger(person.user_id))fail('Välj en giltig deltagare.');
  db.exec('BEGIN IMMEDIATE');try{const e=read(id),manage=manages(p,e);if(!sees(p,e)||!same(p,person)&&!manage)fail('Du saknar behörighet.',403);
   if(new Date(e.date+'T'+e.end)<=now()||!manage&&new Date(e.date+'T'+e.start)-now()<86400000)fail('Kontakta eventansvarig för sen avbokning.',409);
   const rows=bookingRows(e),remaining=rows.filter(b=>!same(b,person));if(remaining.length===rows.length)fail('Bokningen finns inte.',404);if(!e.cancelled)assertAdults(e,remaining);
   db.prepare('DELETE FROM shared_event_bookings WHERE event_id=? AND source=? AND user_id=?').run(id,person.source,person.user_id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function cancel(p,id,revision){const e=read(id);if(!manages(p,e))fail('Du saknar behörighet.',403);if(new Date(e.date+'T'+e.end)<=now())fail('Eventet är avslutat.');if(!Number.isInteger(revision)||!db.prepare('UPDATE shared_events SET cancelled=1,revision=revision+1 WHERE id=? AND revision=?').run(id,revision).changes)fail('Öppna eventet igen.',409)}
 function view(p,e){
  const manage=manages(p,e),rows=bookingRows(e),labels=displayNames(rows.map(b=>({user_id:b.source+':'+b.user_id,name:account(b.source,b.user_id)?.name||'Tidigare volontär'})));
  const people=rows.map(b=>({...(manage?{source:b.source,user_id:b.user_id}:{}),home:b.home,home_name:houses().find(h=>h.id===b.home)?.name||b.home,name:manage?account(b.source,b.user_id)?.name||'Tidigare volontär':labels.get(b.source+':'+b.user_id).label,mine:same(p,b)}));
  return {...e,id:'shared-'+e.id,event_id:e.id,shared_event:true,kind:'event',minimum_staff:e.required,booked:rows.length,mine:rows.some(b=>same(p,b))?1:0,names:people.map(b=>b.name),participants:people,can_manage:!!manage,can_assign:!!p.global||e.targets.every(h=>admin(p,h)),organizer_names:e.organizers.map(o=>active(o.source,o.user_id)?.name).filter(Boolean),home_names:e.targets.map(h=>houses().find(x=>x.id===h)?.name||h),green_booked:0};
 }
 function list(p,home){return db.prepare('SELECT id FROM shared_events ORDER BY date,start,id').all().map(r=>read(r.id)).filter(e=>sees(p,e)&&(!home||e.targets.includes(home))).map(e=>view(p,e))}
 function detail(p,id){const e=read(id);if(!sees(p,e))fail('Du saknar åtkomst.',403);return view(p,e)}
 return {list,detail,save,book,cancelBooking,cancel,manages,read};
}
