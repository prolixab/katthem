import {createReminders} from './reminders.mjs';
import {createBookingSettings} from './booking-settings.mjs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSchedule} from './schedule.mjs';
import {createNotifications} from './notifications.mjs';
import {createPasswordReset,welcomeIntroduction} from './password-reset.mjs';
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

import {createMembers} from './members.mjs';
test('Medlemskoppling: migrera, behåll profiluppgifter, synka kontakt och skydda samtidighet',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE);INSERT INTO users VALUES(1,'Anna','anna@example.se'),(2,'Bo','bo@example.se')");try{
 const members=createMembers(db),profile={name:'Annas profil',email:'ANNA@example.se',phone:'070123',address:'Testvägen',member_number:'A1',member_since:'2020-01-01',status:'supporting',board_role:'treasurer',board_title:'',responsibilities:'Inköp',note:'Behåll',birth_date:'1990-02-28'};
 const id=members.save(null,profile);members.syncAccounts();assert.equal(members.list().length,2);let anna=members.list().find(m=>m.id===id);assert.equal(anna.user_id,1);assert.equal(anna.phone,'070123');assert.equal(anna.status,'supporting');assert.equal(anna.board_role,'treasurer');assert.equal(anna.birth_date,'1990-02-28');const revision=anna.revision;
 members.syncAccounts();assert.equal(members.list().length,2);assert.equal(members.list().find(m=>m.id===id).revision,revision);
 members.save(id,{...anna,name:'Anna Ny',email:'ny@example.se',revision});assert.equal(db.prepare('SELECT name,email FROM users WHERE id=1').get().email,'ny@example.se');
 assert.throws(()=>members.save(id,{...anna,name:'Ska inte sparas',revision}),e=>e.status===409);assert.equal(db.prepare('SELECT name FROM users WHERE id=1').get().name,'Anna Ny');
 anna=members.list().find(m=>m.id===id);for(const birth_date of ['2026-02-30','2099-01-01','1990-99-99'])assert.throws(()=>members.save(id,{...anna,birth_date}),e=>e.status===400);
 assert.throws(()=>members.save(id,{...anna,user_id:null}),e=>e.status===400);
 }finally{db.close()}
});
test('Medlemskoppling: flera befintliga profiler med samma e-post kräver manuellt val',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE);INSERT INTO users VALUES(1,'Anna','anna@example.se')");try{const members=createMembers(db);db.exec("INSERT INTO member_profiles(name,email,updated_at) VALUES('En','anna@example.se',0),('Två','ANNA@example.se',0)");members.syncAccounts();assert.equal(members.list().length,2);assert.ok(members.list().every(m=>m.user_id===null));const chosen=members.list()[0];members.save(chosen.id,{...chosen,user_id:1});members.syncAccounts();assert.equal(members.list().filter(m=>m.user_id===1).length,1)}finally{db.close()}
});

test('Volontärmodul: medlemsuppgifter och hemadress raderas vid uppgradering men profilkopplingar bevaras',()=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE);INSERT INTO users VALUES(1,'Anna','anna@example.se');CREATE TABLE member_profiles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',member_number TEXT NOT NULL DEFAULT '',member_since TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',board_role TEXT NOT NULL DEFAULT 'none',board_title TEXT NOT NULL DEFAULT '',responsibilities TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,user_id INTEGER);CREATE UNIQUE INDEX member_number_unique ON member_profiles(member_number) WHERE member_number<>'';INSERT INTO member_profiles(id,name,email,phone,address,member_number,member_since,status,board_role,responsibilities,note,updated_at,user_id) VALUES(7,'Anna','anna@example.se','070123','PRIVATE_ADDRESS','MEMBER_SECRET','2020-01-01','active','secretary','Inköp','Volontärsinfo',0,1);ALTER TABLE member_profiles ADD COLUMN is_member INTEGER NOT NULL DEFAULT 0;UPDATE member_profiles SET is_member=1");try{let profiles=createMembers(db);const removed=['address','member_number','member_since','is_member'];for(const field of removed)assert.ok(!db.prepare('PRAGMA table_info(member_profiles)').all().some(c=>c.name===field));let p=profiles.list()[0];assert.equal(p.id,7);assert.equal(p.user_id,1);assert.equal(p.board_role,'secretary');assert.equal(p.phone,'070123');assert.equal(p.note,'Volontärsinfo');profiles.save(p.id,{...p,address:'NO_STORE',member_number:'NO_STORE',member_since:'2020-01-01',is_member:true});p=profiles.list()[0];for(const field of removed)assert.ok(!(field in p));profiles=createMembers(db);assert.equal(profiles.list().length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1)}finally{db.close()}});

import {createNews} from './news.mjs';
test('Nyheter: publicering, sluttid, personlig döljning, uppdateringar och samtidighet',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2)');try{const news=createNews(db),now=Date.UTC(2030,0,1),data={title:'Nyhet',body:'Information',expires_at:now+3600000,published:true},id=news.save(null,data,now);assert.equal(news.visible(1,now).length,1);news.dismiss(1,id,0,now);assert.equal(news.visible(1,now).length,0);assert.equal(news.visible(2,now).length,1);assert.equal(news.board(now).length,1);assert.equal(createNews(db).visible(1,now).length,0);news.save(id,{...data,title:'Uppdaterad nyhet',revision:0},now+1000);assert.equal(news.visible(1,now+1000).length,1);assert.throws(()=>news.dismiss(1,id,0,now+1000),e=>e.status===409);assert.throws(()=>news.save(id,{...data,revision:0},now+1000),e=>e.status===409);assert.equal(news.visible(2,now+3600000).length,0);news.save(id,{...data,published:false,revision:1},now+3600000);assert.equal(news.visible(2,now+1000).length,0);assert.equal(news.all().length,1);assert.throws(()=>news.save(null,{...data,expires_at:now},now),e=>e.status===400);assert.throws(()=>news.save(null,{...data,title:' '},now),e=>e.status===400);assert.throws(()=>news.save(null,{...data,expires_at:null},now),e=>e.status===400);const draft=news.save(null,{...data,expires_at:null,published:false},now);assert.ok(!news.board(now).some(n=>n.id===draft));assert.equal(news.board(now+3600000).length,0)}finally{db.close()}});

test('Volontärprofil: katthem och djurvårdsutbildning sparas, bevaras och valideras',()=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE);INSERT INTO users VALUES(1,'Anna','anna@example.se')");try{const profiles=createMembers(db);profiles.syncAccounts();let p=profiles.list()[0];assert.equal(p.shelter,'');assert.equal(p.animal_care_trained,false);profiles.save(p.id,{...p,shelter:'Huskvarna',animal_care_trained:true});p=profiles.list()[0];assert.equal(p.shelter,'Huskvarna');assert.equal(p.animal_care_trained,true);const legacy={...p};delete legacy.shelter;delete legacy.animal_care_trained;profiles.save(p.id,legacy);p=profiles.list()[0];assert.equal(p.shelter,'Huskvarna');assert.equal(p.animal_care_trained,true);assert.throws(()=>profiles.save(p.id,{...p,shelter:'X'.repeat(151)}),e=>e.status===400);assert.throws(()=>profiles.save(p.id,{...p,animal_care_trained:'ja'}),e=>e.status===400);profiles.save(p.id,{...p,animal_care_trained:false});assert.equal(profiles.list()[0].animal_care_trained,false)}finally{db.close()}});

test('Messenger: frivillig profillänk, validering, bevarande och borttagning',()=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE);INSERT INTO users VALUES(1,'Anna','anna@example.se')");try{const profiles=createMembers(db);profiles.syncAccounts();let p=profiles.list()[0];assert.equal(p.messenger_url,'');for(const messenger_url of ['https://m.me/anna','https://www.messenger.com/t/anna','https://www.facebook.com/messages/t/123']){profiles.save(p.id,{...p,messenger_url});p=profiles.list()[0];assert.equal(p.messenger_url,messenger_url)}for(const messenger_url of ['javascript:alert(1)','http://m.me/anna','https://m.me.evil.example/anna','https://evil.example/anna','https://user:pass@m.me/anna','https://www.facebook.com/anna','https://m.me/'])assert.throws(()=>profiles.save(p.id,{...p,messenger_url}),e=>e.status===400);const legacy={...p};delete legacy.messenger_url;profiles.save(p.id,legacy);p=profiles.list()[0];assert.ok(p.messenger_url);profiles.save(p.id,{...p,messenger_url:''});assert.equal(profiles.list()[0].messenger_url,'')}finally{db.close()}});

import {createCsvExports,exportAttachments,nextExportAt} from './csv-exports.mjs';
test('CSV-utskick: intervall, månadsgränser, omstart, samtidighet och avstängning',async()=>{const db=new DatabaseSync(':memory:');let time=Date.UTC(2030,0,31,12),enabled=false,interval='daily',sent=[];const provider={settings:()=>({gmail_address:'katthem@gmail.com',csv_enabled:enabled,csv_interval:interval}),status:()=>({configured:true}),send:async message=>{sent.push(message);await Promise.resolve()}};const options={now:()=>time,attachments:()=>[{filename:'schema.csv',content:'test',contentType:'text/csv'}]};try{const service=createCsvExports(db,provider,options);await service.run();assert.equal(sent.length,0);enabled=true;service.configure();assert.equal(service.status().next_at,time+86400000);await service.run();assert.equal(sent.length,0);time+=86400000;await Promise.all([service.run(),service.run()]);assert.equal(sent.length,1);assert.equal(sent[0].to,'katthem@gmail.com');assert.ok(sent[0].attachments);const restart=createCsvExports(db,provider,options);await restart.run();assert.equal(sent.length,1);interval='weekly';service.configure();assert.equal(service.status().next_at,time+7*86400000);enabled=false;service.configure();assert.equal(service.status().next_at,null);time+=10*86400000;await service.run();assert.equal(sent.length,1);await service.run({force:true});assert.equal(sent.length,2);assert.equal(service.status().next_at,null);assert.equal(nextExportAt(Date.UTC(2030,0,31,12),'monthly'),Date.UTC(2030,1,28,12));assert.equal(nextExportAt(Date.UTC(2032,0,31,12),'monthly'),Date.UTC(2032,1,29,12));assert.equal(nextExportAt(Date.UTC(2030,11,31,12),'monthly'),Date.UTC(2031,0,31,12))}finally{db.close()}});
test('CSV-utskick: fel, en timmes väntan och samma meddelande-id vid återförsök',async()=>{const db=new DatabaseSync(':memory:');let time=Date.UTC(2030,0,1),fail=true,keys=[];const provider={settings:()=>({gmail_address:'katthem@gmail.com',csv_enabled:true,csv_interval:'daily'}),status:()=>({configured:true}),send:async message=>{keys.push(message.key);if(fail)throw Error('SMTP failure')}};try{const service=createCsvExports(db,provider,{now:()=>time,attachments:()=>[]});time+=86400000;assert.equal((await service.run()).failed,true);assert.ok(service.status().last_error);time+=3599999;await service.run();assert.equal(keys.length,1);time++;fail=false;await service.run();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(service.status().last_error,null);await service.run();assert.equal(keys.length,2)}finally{db.close()}});
test('CSV-bilagor: uppgifter för återskapande utan hemligheter och med formelskydd',()=>{const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT,active INTEGER,green_manual INTEGER,created_at INTEGER,password TEXT);INSERT INTO users VALUES(1,' =FORMEL','anna@example.se','volunteer',1,0,0,'PASSWORD_SECRET');CREATE TABLE slots(id INTEGER,date TEXT,start TEXT,end TEXT,title TEXT,capacity INTEGER,note TEXT,cancelled INTEGER,kind TEXT,extra_info TEXT);INSERT INTO slots VALUES(9,'2030-01-01','08:00','12:00','Morgonpass',0,'Info',0,'regular','');CREATE TABLE bookings(id INTEGER,user_id INTEGER,slot_id INTEGER);INSERT INTO bookings VALUES(7,1,9);CREATE TABLE volunteer_info(id INTEGER,location TEXT,access TEXT);INSERT INTO volunteer_info VALUES(1,'Thulevägen 2','DOOR_SECRET');CREATE TABLE schedule_origins(date TEXT,start TEXT,slot_id INTEGER);CREATE TABLE volunteer_meeting_origins(date TEXT,slot_id INTEGER);CREATE TABLE checklist_progress(user_id INTEGER,item_id TEXT);CREATE TABLE calendar_subscriptions(user_id INTEGER,token TEXT);INSERT INTO calendar_subscriptions VALUES(1,'CALENDAR_SECRET')");try{const profiles=createMembers(db);profiles.syncAccounts();const p=profiles.list()[0];profiles.save(p.id,{...p,birth_date:'1990-01-01',address:'Hemadress',note:'Profilinfo',messenger_url:'https://m.me/anna'});const files=exportAttachments(db);assert.equal(files.length,8);assert.ok(files.every(f=>f.content.startsWith('\uFEFF')));const all=files.map(f=>f.content).join('');assert.ok(!all.includes('Hemadress'));assert.ok(!all.includes('member_number'));assert.ok(!all.includes('member_since'));assert.ok(!all.includes('is_member'));assert.ok(all.includes('1990-01-01'));assert.ok(all.includes('Profilinfo'));assert.ok(!all.includes('PASSWORD_SECRET'));assert.ok(!all.includes('DOOR_SECRET'));assert.ok(!all.includes('CALENDAR_SECRET'));assert.ok(all.includes(String.fromCharCode(39)+'=FORMEL'));assert.ok(files.find(f=>f.filename==='bokningar.csv').content.includes(['7','1','9'].map(v=>JSON.stringify(v)).join(';')));assert.ok(files.find(f=>f.filename==='praktisk-info.csv').content.includes('Thulevägen 2'));db.exec('BEGIN');db.exec('ROLLBACK')}finally{db.close()}});

test('Nyheter: äldre publicering utan sluttid blir utkast utan att innehållet försvinner',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');try{createNews(db);db.prepare('INSERT INTO news(title,body,expires_at,published,revision,updated_at) VALUES(?,?,NULL,1,0,?)').run('Gammal nyhet','Bevara texten',Date.now());const news=createNews(db),item=news.all()[0];assert.equal(item.published,0);assert.equal(item.body,'Bevara texten');assert.equal(news.board().length,0);assert.throws(()=>news.save(item.id,{...item,published:true,expires_at:null}),e=>e.status===400);news.save(item.id,{...item,published:true,expires_at:Date.now()+86400000});assert.equal(news.board().length,1)}finally{db.close()}});

import {createVolunteers} from './volunteers.mjs';
function volunteerFixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER,green_manual INTEGER,created_at INTEGER);CREATE TABLE sessions(token TEXT,user_id INTEGER,expires INTEGER);CREATE TABLE password_resets(token_hash TEXT,user_id INTEGER,expires INTEGER);CREATE TABLE bookings(id INTEGER,user_id INTEGER,slot_id INTEGER)');const members=createMembers(db);return {db,members,service:createVolunteers(db,members,p=>'hash:'+p),actor:{id:99,role:'superadmin'},data:{name:'Anna',email:'anna@example.se',phone:'070123',address:'Adress',member_number:'',member_since:'',status:'active',board_role:'none',board_title:'',responsibilities:'Inköp',note:'Behåll',birth_date:'1990-01-01',shelter:'Huskvarna',messenger_url:'',is_member:true,animal_care_trained:true,account:{role:'volunteer',password:'Password12345',active:true,green:false}}}}
test('Gemensam volontär: en sparning skapar person och inloggning och bevarar bokningar/lösenord',()=>{const {db,members,service,actor,data}=volunteerFixture();try{const id=service.save(null,data,actor),p=members.list()[0],u=db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);assert.equal(p.id,id);assert.equal(p.phone,'070123');assert.equal(u.password,'hash:Password12345');db.prepare('INSERT INTO bookings VALUES(1,?,5)').run(u.id);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test-session',u.id,999);db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run('test-reset',u.id,999);service.save(id,{...p,name:'Anna Ny',phone:'070999',account:{role:'volunteer',password:'',active:true,green:true}},actor);let updated=members.list()[0];assert.equal(updated.user_id,u.id);assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get(u.id).password,u.password);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);service.save(id,{...updated,account:{role:'volunteer',password:'NyttPassword123',active:false,green:true}},actor);assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get(u.id).password,'hash:NyttPassword123');assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0);assert.equal(members.list().length,1)}finally{db.close()}});
test('Gemensam volontär: fel och samtidighetskonflikt lämnar inga halva ändringar',()=>{const {db,members,service,actor,data}=volunteerFixture();try{assert.throws(()=>service.save(null,{...data,birth_date:'2026-02-30'},actor),e=>e.status===400);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);assert.equal(members.list().length,0);const id=service.save(null,data,actor),p=members.list()[0];service.save(id,{...p,phone:'070555',account:{password:''}},actor);assert.throws(()=>service.save(id,{...p,name:'Ska inte sparas',account:{password:'NyttPassword123'}},actor),e=>e.status===409);assert.equal(db.prepare('SELECT name FROM users').get().name,'Anna');assert.equal(db.prepare('SELECT password FROM users').get().password,'hash:Password12345');assert.throws(()=>service.save(null,data,actor),e=>e.status===400);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1)}finally{db.close()}});
test('Gemensam volontär: skydda adminbehörighet och hantera äldre person utan inloggning',()=>{const {db,members,service,actor,data}=volunteerFixture();try{assert.throws(()=>service.save(null,data,{id:8,role:'volunteer'}),e=>e.status===403);assert.throws(()=>service.save(null,{...data,account:{...data.account,role:'superadmin'}},{id:8,role:'admin'}),e=>e.status===403);const id=service.save(null,{...data,account:{...data.account,role:'superadmin'}},actor),p=members.list()[0];assert.throws(()=>service.save(id,{...p,name:'Otillåtet',account:{password:''}},{id:8,role:'admin'}),e=>e.status===403);service.save(id,{...p,phone:'070777',account:{password:''}},{id:8,role:'admin'});const current=members.list()[0];assert.equal(current.phone,'070777');assert.throws(()=>service.save(id,{...current,account:{role:'volunteer',password:''}},{id:p.user_id,role:'superadmin'}),e=>e.status===403);const legacy=members.save(null,{...data,name:'Bo',email:'',member_number:'LEGACY'});let old=members.list().find(m=>m.id===legacy);service.save(legacy,{...old,phone:'070888',account:{password:''}},actor);assert.equal(members.list().find(m=>m.id===legacy).user_id,null);old=members.list().find(m=>m.id===legacy);service.save(legacy,{...old,email:'bo@example.se',account:{password:'BoPassword123',role:'volunteer',active:true,green:false}},actor);const ready=members.list().find(m=>m.id===legacy);assert.ok(ready.user_id);assert.ok(!('member_number' in ready));assert.equal(members.list().length,2)}finally{db.close()}});

test('Nyheter: radering tar bort utgångna nyheter och döljmarkeringar men skyddar ändrad version',()=>{const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');try{const news=createNews(db),now=100000,id=news.save(null,{title:'Nyhet',body:'Text',published:true,expires_at:now+1000},now);news.dismiss(1,id,0,now);news.save(id,{title:'Ändrad',body:'Text',published:true,expires_at:now+1000,revision:0},now);assert.throws(()=>news.remove(id,0),e=>e.status===409);assert.equal(news.all().length,1);news.remove(id,1);assert.equal(news.all().length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM news_dismissals').get().n,0);assert.throws(()=>news.remove(id,1),e=>e.status===404)}finally{db.close()}});

import {upgradeSundayShifts} from './schedule.mjs';
test('Söndag: dela framtida 16–20 i två pass, bevara full bokning och historik utan dubbletter',()=>{const db=database();try{
 db.exec("CREATE TABLE schedule_origins(date TEXT,start TEXT,slot_id INTEGER REFERENCES slots(id),PRIMARY KEY(date,start));INSERT INTO slots VALUES(11,'2030-04-07','16:00','20:00','Socialiseringsgruppen',0,'Socialisering',0,'regular'),(12,'2030-03-31','16:00','20:00','Socialiseringsgruppen',0,'Historik',0,'regular'),(13,'2030-04-14','16:00','20:00','Socialiseringsgruppen',0,'Inställt',1,'regular'),(14,'2030-04-21','16:00','20:00','Specialpass',0,'Anpassat',0,'regular');INSERT INTO schedule_origins VALUES('2030-04-07','16:00',11),('2030-04-07','18:00',11),('2030-03-31','16:00',12),('2030-04-14','16:00',13),('2030-04-14','18:00',13),('2030-04-21','16:00',14);INSERT INTO bookings VALUES(1,1,11),(2,2,11)");
 upgradeSundayShifts(db,new Date('2030-04-01T12:00'));const two=db.prepare("SELECT * FROM slots WHERE date='2030-04-07' ORDER BY start").all();assert.equal(two.length,2);assert.equal(two[0].id,11);assert.deepEqual(two.map(s=>[s.start,s.end]),[['16:00','18:00'],['18:00','20:00']]);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings WHERE slot_id=?').get(two[1].id).n,2);assert.equal(db.prepare('SELECT slot_id FROM bookings WHERE id=1').get().slot_id,11);assert.equal(db.prepare('SELECT end FROM slots WHERE id=12').get().end,'20:00');assert.equal(db.prepare('SELECT end FROM slots WHERE id=14').get().end,'20:00');assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2030-04-14' AND cancelled=1").get().n,2);
 upgradeSundayShifts(db,new Date('2030-04-01T12:00'));assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2030-04-07'").get().n,2);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 const rules=(date,start,end,title,note)=>new Date(date+'T12:00').getDay()===0&&['16:00','18:00'].includes(start)?{title:'Socialiseringsgruppen',note:'Socialisering',cancelled:0}:{title,note,cancelled:0};createSchedule(db,rules).ensure(new Date('2030-04-01T12:00'));assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2030-04-28'").get().n,3);
 }finally{db.close()}});

import {resolveShelter,canonicalShelterName} from './shelter.mjs';
test('Katthem: Huskvarna och Jönköping delar adress/kod, okänd ort får ingen annans uppgifter',()=>{const door={code:'TEST',revision:3};for(const city of ['Huskvarna','  huskvarna  ','Jönköping','Jonkoping','Katthemmet i Jönköping','HUSKVARNA','']){const found=resolveShelter(city,'Thulevägen 2, 561 32 Huskvarna',door);assert.equal(found.configured,true);assert.equal(found.location,'Thulevägen 2, 561 32 Huskvarna');assert.equal(found.door,door)}for(const city of ['Stockholm','EjHuskvarna','Jönköpingsvägen']){const found=resolveShelter(city,'Thulevägen 2',door);assert.equal(found.configured,false);assert.equal(found.location,'');assert.equal(found.door.code,'')}});

import {createPortalNews} from './portal-news.mjs';
test('Gemensamma nyheter: målgrupper, nya katthem, personlig döljning och samtidighet',()=>{const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');let time=10000;const houses=new Set(['a','b']);try{const news=createPortalNews(db,{shelter:id=>houses.has(id),now:()=>time}),p={source:'a',user_id:1},fields={title:'Uppdatering',body:'Text',expires_at:20000,published:true,all_shelters:false,targets:['a']};assert.throws(()=>news.save(null,{...fields,targets:[]}),e=>e.status===400);assert.throws(()=>news.save(null,{...fields,expires_at:null}),e=>e.status===400);assert.throws(()=>news.save(null,{...fields,targets:['unknown']}),e=>e.status===400);const id=news.save(null,fields);assert.equal(news.board('a').length,1);assert.equal(news.board('b').length,0);assert.throws(()=>news.dismiss('b',p,id,0),e=>e.status===404);news.dismiss('a',p,id,0);assert.equal(news.visible('a',p).length,0);assert.equal(news.board('a').length,1);news.save(id,{...fields,all_shelters:true,targets:[],revision:0});houses.add('c');assert.equal(news.board('c').length,1);assert.equal(news.visible('a',p).length,1);assert.throws(()=>news.save(id,{...fields,revision:0}),e=>e.status===409);assert.throws(()=>news.remove(id,0),e=>e.status===409);news.dismiss('a',p,id,1);time=20001;assert.equal(news.board('a').length,0);news.remove(id,1);assert.equal(news.all().length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM portal_news_dismissals').get().n,0)}finally{db.close()}});

 test('Återställningslänk: katthem från länken går före ett tidigare val och bevaras efter rensning',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');
 const open=source.split('\n').find(line=>line.startsWith('function openResetLink()'));
 const calls=[],app={innerHTML:'previous form'},context={URLSearchParams,window:{location:{hash:'#reset=abc',search:'?shelter=hem-b',pathname:'/'}},portalLoginShelter:()=> 'hem-a',mutationVersion:0,history:{replaceState:(_a,_b,url)=>calls.push(url)},state:{},view:'mine',app,login:()=>assert.equal(app.innerHTML,''),modal:{open:false},resetPassword:(token,shelter)=>calls.push([token,shelter])};
 assert.equal(runInNewContext(open+';openResetLink()',context),true);
 assert.deepEqual(calls,['/?shelter=hem-b',['abc','hem-b']]);assert.equal(context.portalHomeHint,'hem-b');assert.equal(context.state,null);
});

test('Lösenordsåterställning: sparandet använder länkens katthem även när väljaren ändras',async()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),reset=source.split('\n').find(line=>line.startsWith('function resetPassword('));
 const form={},calls=[],button={disabled:false};let selected='hem-b';
 const context={portalLoginShelter:()=>selected,show:()=>{},$:()=>form,FormData:class extends Map{constructor(){super([['password','NewPassword123'],['confirm','NewPassword123']])}},modal:{close:()=>{},querySelector:()=>({})},api:async(...args)=>calls.push(args),login:()=>{},toast:()=>{}};
 runInNewContext(reset+';resetPassword("token-b")',context);selected='hem-a';
 await form.onsubmit({preventDefault(){},target:{querySelector:()=>button}});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'password-reset/confirm');assert.equal(calls[0][2].token,'token-b');assert.equal(calls[0][3],'hem-b');
});

test('Bokningsrekommendation: fem som standard, validering, sparning, samtidighet och separata katthem',()=>{
 const a=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');try{
  const settings=createBookingSettings(a),other=createBookingSettings(b);assert.equal(settings.get().recommended_limit,5);
  for(const value of [1,101,2.5,'6',null])assert.throws(()=>settings.save({recommended_limit:value,revision:0}),e=>e.status===400);
  assert.equal(settings.save({recommended_limit:8,revision:0}).recommended_limit,8);assert.equal(createBookingSettings(a).get().recommended_limit,8);assert.equal(other.get().recommended_limit,5);
  assert.throws(()=>settings.save({recommended_limit:6,revision:0}),e=>e.status===409);assert.equal(settings.get().recommended_limit,8);
  assert.equal(settings.save({recommended_limit:2,revision:1}).recommended_limit,2);assert.equal(settings.save({recommended_limit:100,revision:2}).recommended_limit,100);
 }finally{a.close();b.close()}
});
test('Återkommande: aktuell rekommendation och ändrad gräns kräver ny förhandsgranskning',()=>{
 const {db,p}=recurringFixture();let limit=5;const service=createRecurringBookings(db,{recommendedLimit:()=>limit});try{
  for(let i=3;i<8;i++)db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,1)').run(i);
  const plan=service.preview(1,p);assert.equal(plan.recommended_limit,5);assert.equal(plan.rows[0].over_limit,true);
  limit=6;const fresh=service.preview(1,p);assert.equal(fresh.rows[0].over_limit,false);assert.notEqual(fresh.key,plan.key);assert.throws(()=>service.book(1,{...p,key:plan.key,confirmOverLimit:true}),e=>e.code==='STALE_RECURRING');
  assert.equal(service.book(1,{...p,key:fresh.key}),2);
 }finally{db.close()}
});

test('Uppdelning av socialiseringspass ändrar inte ett redan påbörjat pass',()=>{const db=database();try{db.exec("CREATE TABLE schedule_origins(date TEXT,start TEXT,slot_id INTEGER REFERENCES slots(id),PRIMARY KEY(date,start));INSERT INTO slots VALUES(1,'2030-04-07','16:00','20:00','Socialiseringsgruppen',0,'Påbörjat',0,'regular');INSERT INTO schedule_origins VALUES('2030-04-07','16:00',1),('2030-04-07','18:00',1);INSERT INTO bookings VALUES(1,1,1)");upgradeSundayShifts(db,new Date('2030-04-07T17:00'));assert.equal(db.prepare('SELECT end FROM slots WHERE id=1').get().end,'20:00');assert.equal(db.prepare('SELECT count(*) n FROM slots').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,1)}finally{db.close()}});


test('Styrelse: sparning ger admin, bevarar SA och kräver SA för befordran',()=>{const {db,members,service,actor,data}=volunteerFixture();try{
 const board={...data,board_role:'member'};
 assert.throws(()=>service.save(null,board,{id:98,role:'admin'}),e=>e.status===403);
 assert.equal(members.list().length,0);
 const id=service.save(null,board,actor);let m=members.list().find(m=>m.id===id);
 assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(m.user_id).role,'admin');
 service.save(id,{...m,board_role:'none',account:{role:'admin'}},actor);
 assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(m.user_id).role,'admin');
 m=members.list().find(m=>m.id===id);service.save(id,{...m,board_role:'chair',account:{role:'superadmin'}},actor);
 assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(m.user_id).role,'superadmin');
 }finally{db.close()}});


test('Kontaktansvar: migration, validering, bevarande och oberoende av behörighet',()=>{const {db,members,service,actor,data}=volunteerFixture();try{
 const id=service.save(null,{...data,contact_focus:'jonkoping'},actor);let m=members.list().find(m=>m.id===id);
 assert.equal(m.contact_focus,'jonkoping');assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(m.user_id).role,'volunteer');
 const {contact_focus,...legacy}=m;members.save(id,legacy);m=members.list().find(m=>m.id===id);assert.equal(m.contact_focus,'jonkoping');
 assert.throws(()=>members.save(id,{...m,contact_focus:'wrong'}),e=>e.status===400);
 for(const focus of ['varnamo','both','']){members.save(id,{...m,contact_focus:focus});m=members.list().find(m=>m.id===id);assert.equal(m.contact_focus,focus)}
 }finally{db.close()}});

test('Kontaktkort: valt katthem prioriteras och profiltext skyddas',()=>{const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),defs=source.split('\n').filter(l=>l.startsWith('const contactFocusLabel=')||l.startsWith('function contactPriority(')||l.startsWith('function sortedContacts(')||l.startsWith('function contactCard(')).join('\n');
 const context={state:{shelter:{id:'huskvarna'}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),editPhoneButton:()=>'',messengerContact:()=> 'Kontakta via Messenger'};
 const result=runInNewContext(defs+`;const people=[{name:'A',board_role:'member',contact_focus:'varnamo'},{name:'Z',board_role:'member',contact_focus:'jonkoping'},{name:'B',board_role:'member',contact_focus:'both'}];({names:sortedContacts(people).map(p=>p.name).join(','),html:contactCard({...people[1],name:'<img>',phone:'070 12',responsibilities:'<script>'},'Ledamot')})`,context);
 assert.equal(result.names,'B,Z,A');context.state.shelter={id:'71f7048a289c2b2eadb6238c',name:'Värnamo'};assert.equal(runInNewContext("contactPriority({contact_focus:'varnamo'})",context),0);assert.ok(result.html.includes('Huskvarna'));assert.ok(result.html.includes('tel:07012'));assert.ok(!result.html.includes('<script>'));assert.ok(!result.html.includes('<img>'));
});


test('Huskvarna: äldre namn normaliseras utan att andra hem eller ansvar ändras',()=>{for(const name of ['Jönköping','Jonkoping','Huskvarna / Jönköping','Jönköping / Huskvarna'])assert.equal(canonicalShelterName(name),'Huskvarna');assert.equal(canonicalShelterName('Värnamo'),'Värnamo');const {db,members,service,actor,data}=volunteerFixture();try{const id=service.save(null,{...data,shelter:'Jönköping / Huskvarna',contact_focus:'jonkoping'},actor);assert.equal(members.list().find(m=>m.id===id).shelter,'Huskvarna');db.prepare('UPDATE member_profiles SET shelter=? WHERE id=?').run('Jönköping',id);const updated=createMembers(db).list().find(m=>m.id===id);assert.equal(updated.shelter,'Huskvarna');assert.equal(updated.contact_focus,'jonkoping')}finally{db.close()}});

test('Välkomstmejl: endast köade nya konton, personlig engångslänk, rätt katthem och eget lösenord',async()=>{const db=database(),messages=[];let time=1000000,enabled=true;const provider={status:()=>({configured:enabled}),appUrl:()=> 'https://portal.example.se',send:async m=>messages.push(m)};try{
 const service=createPasswordReset(db,provider,p=>'hash:'+p,{now:()=>time,shelterId:'hem-b'});
 await service.runWelcome();assert.equal(messages.length,0);assert.equal(service.welcomeStatus(1),null);
 db.exec('BEGIN');service.enqueueWelcome(1);db.exec('ROLLBACK');await service.runWelcome();assert.equal(messages.length,0);
 service.enqueueWelcome(1);service.enqueueWelcome(1);await Promise.all([service.runWelcome(),service.runWelcome()]);assert.equal(messages.length,1);assert.equal(service.welcomeStatus(1).state,'sent');
 const message=messages[0],url=new URL(message.text.match(/https:\/\/\S+/)[0]),token=url.hash.slice(7);assert.equal(message.to,'anna@example.se');assert.match(message.subject,/Välkommen till Tassportalen/);assert.equal(url.searchParams.get('shelter'),'hem-b');assert.match(message.text,/24 timmar/);assert.doesNotMatch(message.text,/old/);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM password_resets').all()).includes(token));assert.ok(!JSON.stringify(service.welcomeStatus(1)).includes(token));
 assert.throws(()=>service.retryWelcome(1),e=>e.status===429);time+=23*3600000;service.reset(token,'NewPassword12345');assert.equal(service.welcomeStatus(1).state,'completed');assert.throws(()=>service.reset(token,'AnotherPassword12345'));assert.throws(()=>service.retryWelcome(1),e=>e.status===400);
 }finally{db.close()}});

test('Välkomstmejl: avstängd e-post, omstart, fel, nytt försök, inaktiva och lokala konton',async()=>{const db=database(),messages=[];let time=1000000,enabled=false,fail=true;const provider={status:()=>({configured:enabled}),appUrl:()=> 'https://portal.example.se',send:async m=>{if(fail)throw Error('mail unavailable');messages.push(m)}};try{
 let service=createPasswordReset(db,provider,p=>p,{now:()=>time});service.enqueueWelcome(1);service.enqueueWelcome(2);await service.runWelcome();assert.equal(messages.length,0);assert.equal(service.welcomeStatus(1).email_enabled,false);
 enabled=true;await service.runWelcome();assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0);assert.equal(db.prepare('SELECT attempts FROM welcome_emails WHERE user_id=1').get().attempts,1);
 service=createPasswordReset(db,provider,p=>p,{now:()=>time});fail=false;await service.runWelcome();assert.equal(messages.length,0);time+=300000;await service.runWelcome();assert.equal(messages.length,1);assert.equal(service.welcomeStatus(2).state,'pending');
 db.exec("INSERT INTO users VALUES(3,'Test','test@katthem.local',1,'old'),(4,'Intern','portal-abc@access.invalid',1,'old')");service.enqueueWelcome(3);service.enqueueWelcome(4);assert.equal(service.welcomeStatus(3),null);assert.equal(service.welcomeStatus(4),null);
 time+=86400001;const expired=messages[0].text.match(/#reset=(\w+)/)[1];assert.throws(()=>service.reset(expired,'NewPassword12345'),/gått ut/);service.retryWelcome(1);await service.runWelcome();assert.equal(messages.length,2);
 }finally{db.close()}});

test('Volontärskapande: välkomstkö ingår i transaktionen och redigering skapar inget nytt utskick',()=>{const {db,members,data,actor}=volunteerFixture();try{const mail=createPasswordReset(db,{status:()=>({configured:false})},p=>p);const service=createVolunteers(db,members,p=>p,{onCreated:id=>mail.enqueueWelcome(id)});const id=service.save(null,data,actor),profile=members.list().find(m=>m.id===id);assert.equal(mail.welcomeStatus(profile.user_id).state,'pending');service.save(id,{...profile,account:{role:'volunteer',password:''}},actor);assert.equal(db.prepare('SELECT COUNT(*) n FROM welcome_emails').get().n,1);
 const broken=createVolunteers(db,members,p=>p,{onCreated:id=>{mail.enqueueWelcome(id);throw Error('rollback')}});assert.throws(()=>broken.save(null,{...data,email:'other@example.se'},actor),/rollback/);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM welcome_emails').get().n,1);
 }finally{db.close()}});


test('Välkomstmejl: begränsad batch och stopp efter sex fel',async()=>{const db=database();let time=1000000,sent=0,fail=false;const provider={status:()=>({configured:true}),appUrl:()=> 'https://portal.example.se',send:async()=>{if(fail)throw Error('offline');sent++}};try{const service=createPasswordReset(db,provider,p=>p,{now:()=>time});for(let id=3;id<=14;id++){db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,'Person '+id,'person'+id+'@example.se',1,'old');service.enqueueWelcome(id)}await service.runWelcome();assert.equal(sent,10);await service.runWelcome();assert.equal(sent,12);service.enqueueWelcome(1);fail=true;for(let i=0;i<6;i++){await service.runWelcome();time+=300000}assert.equal(service.welcomeStatus(1).state,'failed');const attempts=db.prepare('SELECT attempts FROM welcome_emails WHERE user_id=1').get().attempts;await service.runWelcome();assert.equal(db.prepare('SELECT attempts FROM welcome_emails WHERE user_id=1').get().attempts,attempts);service.retryWelcome(1);fail=false;await service.runWelcome();assert.equal(service.welcomeStatus(1).state,'sent')}finally{db.close()}});


test('Välkomstintroduktion: tillfällig erfarenhetstext försvinner exakt vid svenskt årsskifte',()=>{const cutoff=Date.parse('2027-01-01T00:00:00+01:00');for(const time of [cutoff-1,cutoff,cutoff+1,Date.parse('2027-06-01T00:00:00Z')]){const text=welcomeIntroduction(time);assert.match(text,/Ditt nästa steg/);assert.match(text,/introduktionsstegen som visas på startsidan/);assert.match(text,/Kryssa i varje punkt när du har genomfört den/);assert.match(text,/praktiska introduktionen/);if(time<cutoff){assert.match(text,/Även du som redan är erfaren/);assert.match(text,/admin bekräfta den erfarenheten/)}else{assert.doesNotMatch(text,/Även du som redan är erfaren|portalen är ny|admin bekräfta den erfarenheten/)}}});

test('Välkomstmejl: kötid avgör inte årsskiftestexten och tidigare lösenordslänk behåller giltighet',async()=>{const db=database(),messages=[];let time=Date.parse('2026-12-31T23:59:59.999+01:00');const provider={status:()=>({configured:true}),appUrl:()=> 'https://portal.example.se',send:async m=>messages.push(m)};try{const service=createPasswordReset(db,provider,p=>'hashed:'+p,{now:()=>time});service.enqueueWelcome(1);await service.runWelcome();assert.match(messages[0].text,/Även du som redan är erfaren/);const firstToken=messages[0].text.match(/#reset=(\w+)/)[1];db.prepare('UPDATE users SET active=1 WHERE id=2').run();service.enqueueWelcome(2);time++;await service.runWelcome();assert.equal(messages.length,2);assert.doesNotMatch(messages[1].text,/Även du som redan är erfaren|portalen är ny/);assert.match(messages[1].text,/Ditt nästa steg/);assert.match(messages[1].text,/24 timmar/);service.reset(firstToken,'NewPassword12345');assert.equal(service.welcomeStatus(1).state,'completed');time+=60000;service.retryWelcome(2);await service.runWelcome();assert.equal(messages.length,3);assert.doesNotMatch(messages[2].text,/Även du som redan är erfaren/);assert.match(messages[2].text,/Ditt nästa steg/)}finally{db.close()}});

 test('Volontärlistans bokstavsgrupper använder svensk ordning och bevarar indata',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');
 const defs=source.slice(source.indexOf("const memberAlphabet="),source.indexOf('function memberSections('));
 const result=runInNewContext(defs+`;const people=[{id:1,name:'Örjan'},{id:2,name:'Äsa'},{id:3,name:'Åke'},{id:4,name:'Zara'},{id:5,name:'Émile'},{id:6,name:'Anna'},{id:7,name:'Anders'},{id:8,name:'123'}];const before=JSON.stringify(people);({groups:memberGroups(people).map(([letter,items])=>[letter,items.map(p=>p.name)]),unchanged:before===JSON.stringify(people),decomposed:memberLetter('A\\u030ake')})`);
 assert.deepEqual(JSON.parse(JSON.stringify(result.groups)),[['A',['Anders','Anna']],['E',['Émile']],['Z',['Zara']],['Å',['Åke']],['Ä',['Äsa']],['Ö',['Örjan']],['#',['123']]]);assert.equal(result.unchanged,true);assert.equal(result.decomposed,'Å');
 });

test('Bokstavssektioner följer sökning och återställs när sökningen rensas',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');const start=source.indexOf('function filterMembers('),defs=source.slice(start,source.indexOf('\nfunction ',start+1));
 const cards=[{dataset:{profileId:'1',search:'anna'}},{dataset:{profileId:'2',search:'bo'}}],labels=[{},{}];
 const groups=cards.map((card,i)=>({dataset:{memberGroup:i?'B':'A'},querySelectorAll:()=>[card],querySelector:()=>labels[i]}));
 const buttons=['A','B'].map(letter=>({dataset:{memberLetter:letter},setAttribute(){}})),empty={};
 const context={volunteerSearch:'',volunteerFilter:'all',state:{members:[{id:1},{id:2}],users:[]},app:{querySelectorAll:s=>s==='[data-member-card]'?cards:s==='[data-member-group]'?groups:buttons},$:()=>empty};
 runInNewContext(defs+";filterMembers('anna')",context);assert.deepEqual(groups.map(g=>g.hidden),[false,true]);assert.deepEqual(buttons.map(b=>b.disabled),[false,true]);assert.equal(labels[0].textContent,'1 volontär');assert.equal(empty.hidden,true);
 runInNewContext("filterMembers('saknas')",context);assert.equal(empty.hidden,false);assert.ok(groups.every(g=>g.hidden));
 runInNewContext("filterMembers('')",context);assert.ok(groups.every(g=>!g.hidden));assert.ok(buttons.every(b=>!b.disabled));assert.equal(empty.hidden,true);
});


test('Volontärmejl visar portaladressen separat utan token och följer ett domänbyte',async()=>{
 const db=database(),messages=[];let appUrl='https://katthem.teed.se/?shelter=hem-a';const now=new Date(2030,4,11,12).getTime();
 const provider={appUrl:()=>appUrl,status:()=>({configured:true}),send:async m=>messages.push(m)};
 try{
 db.exec("INSERT INTO slots VALUES(1,'2030-05-11','13:00','17:00','Morgonpass',2,'Mat',0,'regular');INSERT INTO bookings VALUES(1,1,1)");
 const reset=createPasswordReset(db,provider,p=>p,{now:()=>now,shelterId:'hem-a'});await reset.request('anna@example.se');reset.enqueueWelcome(1);await reset.runWelcome();
 const before=db.prepare('SELECT * FROM slots WHERE id=1').get(),changes=createNotifications(db,provider);changes.queue(before,{...before,note:'Ny uppgift'});await changes.run();
 await createReminders(db,{mailProvider:provider,now:()=>now}).run();
 db.exec('DELETE FROM reminder_delivery');await createReminders(db,{apiKey:'test',from:'test@example.se',appUrl,now:()=>now,fetchImpl:async(_,options)=>{messages.push(JSON.parse(options.body));return {ok:true}}}).run();
 assert.equal(messages.length,5);for(const message of messages){const footer=message.text.split('Hitta tillbaka till Tassportalen\n')[1];assert.equal(footer,'Portalens adress: https://katthem.teed.se\nSpara gärna adressen som ett bokmärke i din webbläsare.');assert.doesNotMatch(footer,/[?#]|reset=/)}
 for(const message of messages.slice(0,2)){const link=new URL(message.text.match(/https:\/\/\S+/)[0]);assert.equal(link.searchParams.get('shelter'),'hem-a');assert.match(link.hash,/^#reset=[a-f0-9]{64}$/)}
 appUrl='https://ny-portal.example.se/?shelter=hem-a';await reset.request('anna@example.se');assert.match(messages.at(-1).text,/Portalens adress: https:\/\/ny-portal\.example\.se\n/);
 }finally{db.close()}
});


test('Checklistans läsvy visar framsteg, återstående punkter och skyddar text utan redigeringsfält',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),defs=source.split('\n').filter(l=>l.startsWith('function checklistReviewContent(')||l.startsWith('function checklistReviewSummary(')).join('\n');
 const context={esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 const result=runInNewContext(defs+`;({summary:checklistReviewSummary({id:7,checklist_progress:{completed:1,total:2}}),content:checklistReviewContent({checked_items:['a','old'],groups:[{title:'<Avsnitt>',items:[{id:'a',text:'Läst rutiner'},{id:'b',text:'<Nästa punkt>'}]}]})})`,context);
 assert.match(result.summary,/1 av 2 punkter klara/);assert.match(result.summary,/Visa introduktionschecklista/);assert.match(result.content,/1 av 2 punkter klara/);assert.match(result.content,/1 återstår/);assert.match(result.content,/✓ Klar/);assert.match(result.content,/○ Återstår/);assert.match(result.content,/&lt;Nästa punkt&gt;/);assert.doesNotMatch(result.content,/<input|data-checklist-item|<Nästa punkt>/);
});


test('CSV-mejl skiljer katthem med samma mottagare och följer aktuellt namn vid både schemalagt och manuellt utskick',async()=>{
 const databases=[],messages=[];let time=Date.UTC(2030,0,1,12);const names=['Huskvarna','Värnamo'];
 const provider={settings:()=>({gmail_address:'backup@example.se',csv_enabled:true,csv_interval:'daily'}),status:()=>({configured:true}),send:async m=>messages.push(m)};
 try{
 const services=names.map((_,index)=>{const db=new DatabaseSync(':memory:');databases.push(db);return createCsvExports(db,provider,{now:()=>time,shelterName:()=>names[index],attachments:()=>[{filename:'schema.csv',content:'hem-'+index,contentType:'text/csv'}]})});
 time+=86400000;await Promise.all(services.map(s=>s.run()));assert.equal(messages.length,2);
 for(const name of names){const message=messages.find(m=>m.subject.startsWith(name+' – CSV-export '));assert.ok(message);assert.equal(message.to,'backup@example.se');assert.ok(message.text.startsWith('CSV-export från katthem: '+name+'\n\n'));assert.match(message.text,/ersätter inte fullständig databasbackup/)}
 assert.notEqual(messages[0].key,messages[1].key);assert.notEqual(messages[0].attachments[0].content,messages[1].attachments[0].content);
 const nextAt=services[0].status().next_at;names[0]='Huskvarna katthem';assert.equal(services[0].status().next_at,nextAt);await services[0].run({force:true});assert.match(messages.at(-1).subject,/^Huskvarna katthem – CSV-export /);assert.ok(messages.at(-1).text.startsWith('CSV-export från katthem: Huskvarna katthem\n\n'));
 time+=86400000;await services[0].run();assert.match(messages.at(-1).subject,/^Huskvarna katthem – CSV-export /);
 }finally{databases.forEach(db=>db.close())}
});


test('Egna checklistan är tillgänglig även för gröna, godkända, admin och SA utan att punkter kryssas automatiskt',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),fn=source.split('\n').find(l=>l.startsWith('function volunteerChecklist('));
 for(const role of ['volunteer','admin','superadmin'])for(const ready of [false,true]){
 const html=runInNewContext(fn+';volunteerChecklist()',{state:{user:{role,green:true,engagement:{intro_ready:ready}},checklist:{checked_items:['done','removed'],groups:[{title:'Introduktion',items:[{id:'done',text:'Klar punkt'},{id:'todo',text:'Återstår'}]}]}},isAdmin:u=>['admin','superadmin'].includes(u.role),esc:s=>s});
 assert.match(html,/1 av 2 punkter klara/);assert.match(html,/data-checklist-item="done" checked/);assert.match(html,/data-checklist-item="todo" >/);assert.doesNotMatch(html,/data-checklist-item="removed"/);if(role!=='volunteer')assert.match(html,/gröna genom sin roll/);
 }
 const account=source.split('\n').find(l=>l.startsWith('function accountPage('));assert.match(account,/data-booking-help-target="introduction-checklist">Öppna min introduktionschecklista/);
});


test('CSV-förhandsgranskning visar överhoppade raders orsak och skyddar inmatad text',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),fn=source.split('\n').find(l=>l.startsWith('function importSkippedRows(')),context={esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 const html=runInNewContext(fn+`;importSkippedRows([{row:2,name:'<Namn>',email:'known@example.se',reason:'existing'},{row:4,name:'Dubblett',email:'new@example.se',reason:'duplicate'}])`,context);
 assert.match(html,/Överhoppade rader \(2\)/);assert.match(html,/Rad 2/);assert.match(html,/Kontot finns redan/);assert.match(html,/Adressen upprepas i filen/);assert.match(html,/&lt;Namn&gt;/);assert.doesNotMatch(html,/<Namn>/);assert.equal(runInNewContext(fn+';importSkippedRows([])',context),'');
});


test('.local-konton får inga välkomst-, återställnings-, påminnelse- eller ändringsmejl',async()=>{
 const db=database(),sent=[];const now=new Date(2030,4,11,12).getTime(),provider={appUrl:()=> 'https://portal.example.se',status:()=>({configured:true}),send:async m=>sent.push(m)};
 try{
 db.exec("INSERT INTO users VALUES(3,'Tillfällig','temp@katthem.local',1,'hash');INSERT INTO slots VALUES(1,'2030-05-11','13:00','17:00','Testpass',2,'Mat',0,'regular');INSERT INTO bookings VALUES(1,3,1),(2,1,1)");
 const reset=createPasswordReset(db,provider,p=>p,{now:()=>now});reset.enqueueWelcome(3);await reset.runWelcome();assert.equal(reset.welcomeStatus(3),null);await reset.request('Temp@Katthem.LOCAL');assert.equal(sent.length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0);
 const reminder=createReminders(db,{mailProvider:provider,now:()=>now});assert.equal((await reminder.run()).sent,1);assert.deepEqual(sent.map(m=>m.to),['anna@example.se']);assert.equal(db.prepare('SELECT COUNT(*) n FROM reminder_delivery WHERE booking_id=1').get().n,0);
 const changes=createNotifications(db,provider),before=db.prepare('SELECT * FROM slots').get();changes.queue(before,{...before,note:'Ny text'});db.prepare('INSERT INTO change_notifications(id,user_id,subject,text) VALUES(?,?,?,?)').run('old-local',3,'Äldre kö','Text');assert.equal(changes.status().pending,1);await changes.run();assert.equal(sent.length,2);assert.ok(sent.every(m=>m.to==='anna@example.se'));assert.equal(changes.status().pending,0);assert.equal(db.prepare("SELECT attempts FROM change_notifications WHERE id='old-local'").get().attempts,0);
 }finally{db.close()}
});

test('Checklistans omritning behåller synlig punkt, fokus, öppna avsnitt och pågående kryss',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),start=source.indexOf('function renderChecklistPreservingPosition('),fn=source.slice(start,source.indexOf('\nfunction updateChecklistCount',start));
 const scrolls=[],focus=[],make=(id,top,checked=false)=>({dataset:{checklistItem:id},checked,disabled:false,getBoundingClientRect:()=>({top,bottom:top+20}),focus:o=>focus.push([id,o.preventScroll])});
 let controls=[make('a',120),make('b',200,true)];const sections=[{dataset:{adminSection:'info-introduction'},open:true},{dataset:{adminSection:'manual'},open:false}],open=new Set(['manual']);
 const win={scrollY:700,scrollX:0,innerHeight:700,scrollTo:o=>scrolls.push(o)},context={app:{querySelectorAll:s=>s==='[data-checklist-item]'?controls:sections},window:win,document:{activeElement:controls[0]},checklistSaving:new Set(['b']),adminSectionsOpen:open,render:()=>{win.scrollY=0;controls=[make('a',820),make('b',900,false)]}};
 runInNewContext(fn+';renderChecklistPreservingPosition()',context);
 assert.equal(scrolls[0].top,700);assert.equal(scrolls[0].behavior,'instant');assert.deepEqual(focus,[['a',true]]);assert.equal(controls[1].checked,true);assert.equal(controls[1].disabled,true);assert.ok(open.has('info-introduction'));assert.ok(!open.has('manual'));
});

test('Checklistans sparning skiljer sparfel från uppdateringsfel och ignorerar svar efter byte av katthem',async()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function saveChecklistItem('),fn=source.slice(start,source.indexOf('\nfunction ',start+1));
 for(const mode of ['saved-refresh-fails','save-fails','changed-home']){
  const input={dataset:{checklistItem:'a'},checked:true,disabled:false},status={},count={},saving=new Set();let home='one',renders=0;
  const context={state:{user:{id:1},checklist:{checked_items:[],groups:[{items:[{id:'a'}]}]}},view:'info',portalRequestShelter:()=>home,checklistSaving:saving,document:{activeElement:null,body:{}},app:{querySelectorAll:()=>[input]},$:s=>s==='#checklist-status'?status:count,updateChecklistCount:()=>{},renderChecklistPreservingPosition:()=>renders++,toast:()=>{},api:async route=>{if(route==='checklist'){if(mode==='save-fails')throw Error('Sparfel');if(mode==='changed-home')home='two';return {}}throw Error('Uppdateringsfel')}};
  await runInNewContext(fn+';saveChecklistItem(input)',{...context,input});
  assert.equal(renders,0);assert.equal(saving.size,0);assert.equal(input.disabled,false);
  if(mode==='saved-refresh-fails'){assert.equal(input.checked,true);assert.ok(context.state.checklist.checked_items.includes('a'));assert.match(status.textContent,/Krysset är sparat/)}
  if(mode==='save-fails'){assert.equal(input.checked,false);assert.match(status.textContent,/Kunde inte spara/)}
  if(mode==='changed-home')assert.deepEqual(context.state.checklist.checked_items,[]);
 }
});


test('Profilens pausåtgärd visas för SA även på admin och styrelse men inte för vanlig admin',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),fn=source.split('\n').find(l=>l.startsWith('function profileEngagementPanel('));
 const target={id:2,role:'admin',engagement:{status:'paused',review_at:123}},context={state:{user:{id:1,role:'superadmin'}},isAdmin:u=>['admin','superadmin'].includes(u.role),canManageAccount:(a,t)=>a.role==='superadmin'||a.role==='admin'&&t.role==='volunteer',esc:s=>s,engagementLabel:s=>s==='paused'?'Pausad':s,engagementDate:()=> '1 december',target};
 let html=runInNewContext(fn+';profileEngagementPanel(target)',context);assert.match(html,/data-profile-engagement="2"/);assert.match(html,/Ändra status \/ pausa/);assert.match(html,/Pausad/);assert.match(html,/styrelseuppdrag/);
 context.state.user.role='admin';html=runInNewContext(fn+';profileEngagementPanel(target)',context);assert.doesNotMatch(html,/data-profile-engagement/);assert.match(html,/Endast superadmin/);
 target.role='volunteer';assert.match(runInNewContext(fn+';profileEngagementPanel(target)',context),/data-profile-engagement/);target.transfer_retired=true;assert.doesNotMatch(runInNewContext(fn+';profileEngagementPanel(target)',context),/data-profile-engagement/);
});


test('Manualsökning matchar rubrik och text, hanterar åäö, visar tomt resultat och återställer öppna avsnitt',()=>{
 const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),start=source.indexOf('function filterManual('),fn=source.slice(start,source.indexOf('\nfunction bindManualSearch',start));
 const chapters=[{textContent:'Paus och engagemang Styrelsens status',dataset:{},open:false},{textContent:'Lösenord Återställ via e-post',dataset:{},open:true}],status={},empty={},clear={},manual={querySelectorAll:()=>chapters,querySelector:s=>s==='#manual-search-status'?status:s==='#manual-search-empty'?empty:clear};
 const context={app:{querySelector:()=>manual},manualSearchQuery:''};runInNewContext(fn+`;filterManual('paus styrelse')`,context);assert.deepEqual(chapters.map(c=>c.hidden),[false,true]);assert.equal(chapters[0].open,true);assert.match(status.textContent,/1 av 2/);
 runInNewContext(`filterManual('LOSENORD')`,context);assert.deepEqual(chapters.map(c=>c.hidden),[true,false]);assert.equal(chapters[1].open,true);
 runInNewContext(`filterManual('saknas')`,context);assert.ok(chapters.every(c=>c.hidden));assert.equal(empty.hidden,false);
 runInNewContext(`filterManual('')`,context);assert.ok(chapters.every(c=>!c.hidden));assert.deepEqual(chapters.map(c=>c.open),[false,true]);assert.equal(clear.disabled,true);assert.equal(empty.hidden,true);
});
