import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSchedule} from './schedule.mjs';
import {createNotifications} from './notifications.mjs';
import {createPasswordReset} from './password-reset.mjs';
import {calendarEvent,calendarEvents} from './calendar.mjs';

function database(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,active INTEGER,password TEXT);
 CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,title TEXT,capacity INTEGER,note TEXT,cancelled INTEGER,kind TEXT);
 CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),slot_id INTEGER REFERENCES slots(id));
 CREATE TABLE sessions(token TEXT,user_id INTEGER,expires INTEGER);
 INSERT INTO users VALUES(1,'Anna','anna@example.se',1,'old'),(2,'Inaktiv','inactive@example.se',0,'old');`);return db}
const rule=(date,start,end,title,note)=>new Date(date+'T12:00').getDay()===0&&Number(date.slice(-2))<=7&&start==='16:00'?{title:'Inställt – öppet hus',note:'Öppet hus',cancelled:1}:{title,note,cancelled:0};

test('Rullande 42 dagar: påfyllning, söndagsregel, omstart och bevarade ändringar',()=>{
 const db=database();try{
  let schedule=createSchedule(db,rule);schedule.ensure(new Date(2030,2,25,12));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM slots').get().n,126);
  assert.equal(db.prepare("SELECT cancelled FROM slots WHERE date='2030-04-07' AND start='16:00'").get().cancelled,1);
  const slot=db.prepare("SELECT id FROM slots WHERE date='2030-03-26' AND start='08:00'").get();
  db.prepare("UPDATE slots SET date='2030-08-01',start='08:00' WHERE id=?").run(slot.id);
  db.exec("UPDATE slots SET cancelled=1 WHERE date='2030-03-27' AND start='16:00'");
  schedule=createSchedule(db,rule);schedule.ensure(new Date(2030,2,25,12));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM slots').get().n,126);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2030-03-26' AND start='08:00'").get().n,0);
  schedule.ensure(new Date(2030,2,26,12));assert.equal(db.prepare('SELECT COUNT(*) n FROM slots').get().n,129);
  assert.equal(db.prepare("SELECT cancelled FROM slots WHERE date='2030-03-27' AND start='16:00'").get().cancelled,1);
  schedule.ensure(new Date(2030,6,1,12));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2030-08-01' AND start='08:00'").get().n,2,'Flyttat extrapass ersätter inte ordinarie pass på destinationen');
 }finally{db.close()}
});

test('Ändringsmejl: beständig kö, avstängd e-post, återförsök och oförändrade pass',async()=>{
 const db=database(),messages=[];let enabled=false,fail=true;
 const provider={appUrl:()=> 'https://katthem.example.se',status:()=>({configured:enabled}),send:async message=>{messages.push(message);if(fail)throw Error('testfel')}};
 try{
  db.exec("INSERT INTO slots VALUES(1,'2030-05-10','08:00','12:00','Morgonpass',0,'Mat',0,'regular');INSERT INTO bookings VALUES(1,1,1),(2,2,1)");
  const before=db.prepare('SELECT * FROM slots').get(),after={...before,date:'2030-05-11'};
  let service=createNotifications(db,provider);service.queue(before,before);assert.equal(service.status().pending,0);
  service.queue(before,after);assert.equal(service.status().pending,1);await service.run();assert.equal(messages.length,0);
  enabled=true;await service.run();assert.equal(service.status().failed,1);
  fail=false;service=createNotifications(db,provider);await Promise.all([service.run(),service.run()]);assert.equal(service.status().pending,0);assert.equal(messages.length,2);assert.equal(messages[0].key,messages[1].key);assert.match(messages[1].text,/Tidigare tid: 2030-05-10/);
  service.queue(after,{...after,cancelled:1});await service.run();assert.match(messages.at(-1).subject,/Inställt/);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,2);
 }finally{db.close()}
});

test('Lösenordsåterställning: generiska svar, engångstoken, utgång och sessionsspärr',async()=>{
 const db=database(),messages=[];let time=1000000,enabled=true;
 const provider={appUrl:()=> 'https://katthem.example.se',status:()=>({configured:enabled}),send:async message=>messages.push(message)};
 try{
  const service=createPasswordReset(db,provider,p=>'hashed:'+p,{now:()=>time});
  const result=await service.request('anna@example.se');assert.deepEqual(await service.request('unknown@example.se'),result);assert.deepEqual(await service.request('inactive@example.se'),result);assert.equal(messages.length,1);
  const token=messages[0].text.match(/#reset=(\w+)/)[1];assert.ok(!JSON.stringify(db.prepare('SELECT * FROM password_resets').all()).includes(token));
  db.exec("INSERT INTO sessions VALUES('session',1,999999999)");service.reset(token,'NewPassword123');assert.equal(db.prepare('SELECT password FROM users WHERE id=1').get().password,'hashed:NewPassword123');assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.throws(()=>service.reset(token,'Another12345'),/ogiltig/);
  await service.request('anna@example.se');const expired=messages.at(-1).text.match(/#reset=(\w+)/)[1];time+=1800001;assert.throws(()=>service.reset(expired,'Another12345'),/gått ut/);
  enabled=false;assert.deepEqual(await service.request('anna@example.se'),result);assert.equal(messages.length,2);
  enabled=true;for(let i=0;i<5;i++)await service.request('anna@example.se');assert.equal(messages.length,5);
 }finally{db.close()}
});

test('Kalender: svensk tidszon, stabil identitet, escaping och UTF-8-radbrytning',()=>{
 const slot={id:42,date:'2030-10-27',start:'08:00',end:'12:00',title:'Katter, mat; städning',note:'Å'.repeat(100)+'\nRad två'};
 const ics=calendarEvent(slot,{appUrl:'https://katthem.example.se',location:'Kattgatan 1, Jönköping\nEntré A',now:new Date('2030-01-01T12:00:00Z')});
 assert.match(ics,/DTSTART;TZID=Europe\/Stockholm:20301027T080000/);assert.match(ics,/UID:katthem-slot-42@katthem.example.se/);assert.match(ics,/SUMMARY:Katthemmet - Katter\\, mat\\; städning/);assert.match(ics,/TZOFFSETTO:\+0100/);
 assert.match(ics.replace(/\r\n /g,''),/LOCATION:Kattgatan 1\\, Jönköping\\nEntré A/);
 assert.ok(ics.replace(/\r\n /g,'').includes('Dagens städning: Storstäda köket och se över karantänen.'));assert.ok(ics.replace(/\r\n /g,'').includes('Töm återvinningen.'));
 assert.match(ics,/BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT12H/);assert.ok(ics.replace(/\r\n /g,'').includes('Om 12 timmar är det dags för ditt pass'));
 for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.match(ics.replace(/\r\n /g,''),/Å{100}\\nRad två/);
});


import {readFileSync} from 'node:fs';
test('Docker: alla servermoduler som kopieras inkluderas i byggkontexten',()=>{
 const docker=readFileSync(new URL('./Dockerfile',import.meta.url),'utf8'),ignore=readFileSync(new URL('./.dockerignore',import.meta.url),'utf8').split(/\r?\n/);
 const copied=docker.split(/\r?\n/).filter(line=>line.startsWith('COPY ')).flatMap(line=>line.split(/\s+/)).filter(token=>token.endsWith('.mjs'));assert.ok(copied.length>0);for(const file of copied)assert.ok(ignore.includes('!'+file),'Saknas i .dockerignore: '+file);
});

test('Veckokalender: flera pass i en kalender med gemensam tidszon och stabila id',()=>{
 const slots=[{id:1,date:'2030-10-28',start:'08:00',end:'12:00',title:'Morgonpass'},{id:2,date:'2030-10-30',start:'16:00',end:'18:00',title:'Eftermiddagspass'}];
 const ics=calendarEvents(slots,{appUrl:'https://katthem.example.se',location:'Kattgatan 1'});
 for(const [token,count] of [['BEGIN:VCALENDAR',1],['END:VCALENDAR',1],['BEGIN:VTIMEZONE',1],['BEGIN:VEVENT',2],['END:VEVENT',2],['LOCATION:Kattgatan 1',2]])assert.equal(ics.split(token).length-1,count);
 assert.match(ics,/UID:katthem-slot-1@/);assert.match(ics,/UID:katthem-slot-2@/);assert.ok(!calendarEvents([],{appUrl:'https://katthem.example.se'}).includes('BEGIN:VEVENT'));
});

import {createRecurringBookings} from './recurring.mjs';
function recurringFixture(){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,active INTEGER);CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,kind TEXT,cancelled INTEGER);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER,slot_id INTEGER,UNIQUE(user_id,slot_id));INSERT INTO users VALUES(1,1);INSERT INTO users VALUES(2,0);INSERT INTO slots VALUES(1,'2099-04-06','08:00','12:00','regular',0),(2,'2099-04-13','08:00','12:00','regular',0),(3,'2099-04-20','08:00','12:00','regular',1),(4,'2099-04-13','10:00','11:00','event',0);");return {db,service:createRecurringBookings(db),p:{slotId:1,interval:1,until:'2099-04-27'}}}
test('Återkommande: rätt veckor, inställda/saknade pass och befintliga bokningar',()=>{const {db,service,p}=recurringFixture();try{db.exec('INSERT INTO bookings(user_id,slot_id) VALUES(1,1)');const plan=service.preview(1,p);assert.deepEqual(plan.rows.map(r=>r.status),['already','new','cancelled','missing']);assert.equal(service.book(1,{...p,key:plan.key}),1);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,2);assert.deepEqual(service.preview(1,{...p,interval:2}).rows.map(r=>r.date),['2099-04-06','2099-04-20']);assert.throws(()=>service.preview(2,p));assert.throws(()=>service.preview(1,{...p,until:'2099-02-30'}));assert.throws(()=>service.preview(1,{...p,interval:3}));assert.throws(()=>service.preview(1,{...p,until:'2100-01-01'}))}finally{db.close()}});
test('Återkommande: hela serien kräver bekräftelse av tak/överlappning och skydd mot ändrad plan',()=>{const {db,service,p}=recurringFixture();try{for(let i=3;i<10;i++)db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,2)').run(i);db.exec('INSERT INTO bookings(user_id,slot_id) VALUES(1,4)');const plan=service.preview(1,p);assert.ok(plan.rows[1].over_limit);assert.ok(plan.rows[1].overlap);assert.throws(()=>service.book(1,{...p,key:plan.key}),e=>e.code==='RECOMMENDED_LIMIT');assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings WHERE slot_id=1').get().n,0);assert.throws(()=>service.book(1,{...p,key:plan.key,confirmOverLimit:true}),e=>e.code==='OVERLAPPING_BOOKING');db.exec('UPDATE slots SET cancelled=1 WHERE id=2');assert.throws(()=>service.book(1,{...p,key:plan.key,confirmOverLimit:true,confirmOverlap:true}),e=>e.code==='STALE_RECURRING');db.exec('UPDATE slots SET cancelled=0 WHERE id=2');const fresh=service.preview(1,p);assert.equal(service.book(1,{...p,key:fresh.key,confirmOverLimit:true,confirmOverlap:true}),2)}finally{db.close()}});
