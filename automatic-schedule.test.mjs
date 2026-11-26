import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {createPortal} from './portal.mjs';
import {createAutomaticScheduleSettings} from './schedule.mjs';

test('Automatiska pass: rollback, historik, anpassade pass och återaktivering',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec("CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,title TEXT,note TEXT,kind TEXT,cancelled INTEGER DEFAULT 0);CREATE TABLE schedule_origins(date TEXT,start TEXT,slot_id INTEGER);CREATE TABLE volunteer_meeting_origins(date TEXT,slot_id INTEGER);CREATE TABLE bookings(user_id INTEGER,slot_id INTEGER)");
 for(const [id,date,start,title,kind] of [[1,'2030-01-06','16:00','Socialiseringsgruppen','regular'],[2,'2030-01-06','18:00','Socialiseringsgruppen','regular'],[3,'2029-12-30','16:00','Socialiseringsgruppen','regular'],[4,'2030-01-06','16:00','Eget pass','regular'],[5,'2030-01-06','15:00','Volontärsträff','event'],[6,'2030-01-06','15:00','Egen träff','event']]){db.prepare('INSERT INTO slots VALUES(?,?,?,?,?,?,?,0)').run(id,date,start,'20:00',title,'Text',kind);if(kind==='regular')db.prepare('INSERT INTO schedule_origins VALUES(?,?,?)').run(date,start,id);}
 db.exec("INSERT INTO volunteer_meeting_origins VALUES('2030-01-06',5);INSERT INTO bookings VALUES(1,1),(1,5)");const options=createAutomaticScheduleSettings(db),now=new Date('2030-01-01T12:00');
 assert.throws(()=>options.save({social:false,meeting:false,revision:0},{now,queue:()=>{throw Error('queue fail')}}),/queue fail/);assert.equal(options.get().social,true);assert.equal(db.prepare('SELECT title FROM slots WHERE id=1').get().title,'Socialiseringsgruppen');
 const changes=[];options.save({social:false,meeting:false,revision:0},{now,queue:(a,b)=>changes.push([a,b])});assert.equal(changes.length,3);assert.equal(db.prepare('SELECT title FROM slots WHERE id=1').get().title,'Eftermiddagspass');assert.equal(db.prepare('SELECT title FROM slots WHERE id=2').get().title,'Kvällspass');assert.equal(db.prepare('SELECT title FROM slots WHERE id=3').get().title,'Socialiseringsgruppen');assert.equal(db.prepare('SELECT title FROM slots WHERE id=4').get().title,'Eget pass');assert.equal(db.prepare('SELECT cancelled FROM slots WHERE id=5').get().cancelled,1);assert.equal(db.prepare('SELECT cancelled FROM slots WHERE id=6').get().cancelled,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings').get().n,2);
 assert.throws(()=>options.save({social:true,meeting:true,revision:0},{now}),e=>e.status===409);assert.throws(()=>options.save({social:'false',meeting:false,revision:1}),e=>e.status===400);options.save({social:true,meeting:true,revision:1},{now});assert.equal(db.prepare('SELECT title FROM slots WHERE id=1').get().title,'Socialiseringsgruppen');assert.equal(db.prepare('SELECT cancelled FROM slots WHERE id=5').get().cancelled,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM suppressed_meetings').get().n,0);
 }finally{db.close()}
});

test('Automatiska pass: admin/SA, tenantisolering, nygenerering och bevarade bokningar',{timeout:60000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'automatic-schedule-')),password='Automatic12345',hash='salt:'+scryptSync(password,'salt',64).toString('hex'),seed=new DatabaseSync(path.join(dir,'katthem.sqlite'));
 seed.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER DEFAULT 1)');for(const [id,role] of [[1,'superadmin'],[2,'volunteer'],[3,'coordinator'],[4,'admin']])seed.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(id,'Person '+id,'person'+id+'@test.local',hash,role);seed.close();let portal;
 try{portal=await createPortal({dataDir:dir,port:0,env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});const base='http://127.0.0.1:'+portal.server.address().port;
 const call=(route,method='GET',body,cookie,home)=>fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(home?{'X-Katthem':home}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const login=async id=>{const r=await call('login','POST',{email:'person'+id+'@test.local',password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};const sa=await login(1),vol=await login(2),coord=await login(3),admin=await login(4);
 const home=(await(await call('portal/manage/shelters','POST',{name:'Annat hem',address:'Testgatan'},sa)).json()).id;
 for(const cookie of [undefined,vol,coord])assert.equal((await call('automatic-schedule','PUT',{social:false,meeting:false,revision:0},cookie)).status,cookie?403:401);
 assert.equal((await call('automatic-schedule','PUT',{social:false,meeting:false,revision:0},admin,home)).status,403);
 const before=await(await call('state','GET',null,sa)).json(),meeting=before.slots.find(s=>s.volunteer_meeting&&!s.cancelled&&new Date(s.date+'T'+s.start)>new Date());assert.ok(meeting);assert.equal((await call('bookings','POST',{slotId:meeting.id,userId:1,confirmOverlap:true},sa)).status,200);
 const saved=await call('automatic-schedule','PUT',{social:false,meeting:false,revision:0},admin);assert.equal(saved.status,200);const after=await saved.json();assert.equal(after.automatic_schedule.meeting,false);assert.ok(after.slots.find(s=>s.id===meeting.id&&s.cancelled&&s.booked===1));assert.ok(after.bookings.some(b=>b.slot_id===meeting.id));assert.ok(!after.slots.some(s=>s.volunteer_meeting&&!s.cancelled));assert.ok(!after.slots.some(s=>s.title==='Socialiseringsgruppen'&&new Date(s.date+'T'+s.start)>new Date()));
 const other=await(await call('state','GET',null,sa,home)).json();assert.equal(other.automatic_schedule.meeting,true);assert.equal(other.automatic_schedule.social,true);
 const regenerated=new DatabaseSync(path.join(dir,'katthem.sqlite'));regenerated.exec("DELETE FROM schedule_origins WHERE slot_id IN (SELECT id FROM slots WHERE kind='regular' AND date>date('now','localtime'));DELETE FROM slots WHERE kind='regular' AND date>date('now','localtime')");regenerated.close();const refreshed=await(await call('state','GET',null,sa)).json();assert.ok(refreshed.slots.some(s=>s.kind==='regular'&&new Date(s.date+'T12:00').getDay()===0&&s.start==='16:00'&&s.title==='Eftermiddagspass'));assert.ok(!refreshed.slots.some(s=>s.volunteer_meeting&&!s.cancelled));const visible=await(await call('state','GET',null,vol)).json();assert.ok(!visible.slots.some(s=>s.volunteer_meeting));
 assert.equal((await call('automatic-schedule','PUT',{social:true,meeting:true,revision:0},sa)).status,409);assert.equal((await call('automatic-schedule','PUT',{social:true,meeting:true,revision:1},sa)).status,200);
 }finally{await portal?.close();rmSync(dir,{recursive:true,force:true})}
});
