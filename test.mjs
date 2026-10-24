import {test} from 'node:test';
import {isAdmin,isSuperAdmin,canManageAccount,isGreen} from './roles.mjs';
import {upgradeDefaultShifts} from './schedule-upgrade.mjs';
import {createEmailSettings} from './email-settings.mjs';
import {monthAgo,isInactive} from './activity.mjs';
import {createReminders} from './reminders.mjs';
import vm from 'node:vm';
import {parseVolunteersCsv} from './csv-import.mjs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'katthem-test-'));
let child,base;
async function start(env={}){child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',...env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/[^\s:]+:\d+/);if(m)resolve(m[0].replace('0.0.0.0','127.0.0.1'))});child.on('error',reject);child.on('exit',code=>reject(Error('Server exit '+code)))});}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(r=>{child.once('exit',r);child.kill()})}
async function call(route,method='GET',data,cookie){return fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})}
test('Lokal bokning: inloggning, behörighet, samtidighet och beständighet',async()=>{
 try{
 await start();assert.equal((await call('state')).status,401);
 const passwords=[...readFileSync(path.join(dir,'lokala-konton.txt'),'utf8').matchAll(/Lösenord: (.+)/g)].map(m=>m[1]);
 assert.equal((await call('login','POST',{email:'admin@katthem.local',password:'fel'})).status,401);
 const a=await call('login','POST',{email:'admin@katthem.local',password:passwords[0]});assert.equal(a.status,200);const ac=a.headers.get('set-cookie').split(';')[0];
 const v=await call('login','POST',{email:'alex@katthem.local',password:passwords[1]});const vc=v.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('users','POST',{name:'Test',email:'test@example.se',password:'password12345'},vc)).status,403);
 assert.equal((await call('export','GET',null,vc)).status,403);
 const day=new Date();day.setDate(day.getDate()+10);const date=day.toISOString().slice(0,10);
 let r=await call('slots','POST',{date,start:'12:00',end:'13:00',title:'Testpass',capacity:1},ac);assert.equal(r.status,200);const slot=(await r.json()).slots.find(s=>s.title==='Testpass');
 r=await call('users','POST',{name:'Testvolontär',email:'test@example.se',password:'password12345'},ac);assert.equal(r.status,200);const uid=(await r.json()).users.find(u=>u.email==='test@example.se').id;
 assert.equal((await call('users','POST',{name:'Ny admin',email:'newadmin@example.se',password:'Password12345',role:'admin'},ac)).status,200);
 const newAdmin=await call('login','POST',{email:'newadmin@example.se',password:'Password12345'});assert.equal(newAdmin.status,200);const newAdminCookie=newAdmin.headers.get('set-cookie').split(';')[0];assert.equal((await newAdmin.json()).user.role,'admin');
 assert.equal((await call('users/'+uid,'PATCH',{role:'admin'},vc)).status,403);
 let roleChange=await call('users/'+uid,'PATCH',{role:'admin'},ac);assert.equal((await roleChange.json()).users.find(u=>u.id===uid).role,'admin');
 assert.equal((await call('users/'+uid,'PATCH',{role:'volunteer'},newAdminCookie)).status,403);
 roleChange=await call('users/'+uid,'PATCH',{role:'volunteer'},ac);assert.equal((await roleChange.json()).users.find(u=>u.id===uid).role,'volunteer');
 assert.equal((await call('users','POST',{name:'Otillåten admin',email:'forbidden-admin@example.se',password:'Password12345',role:'admin'},newAdminCookie)).status,403);
 assert.equal((await call('users','POST',{name:'Otillåten superadmin',email:'forbidden-super@example.se',password:'Password12345',role:'superadmin'},newAdminCookie)).status,403);
 assert.equal((await call('users/'+uid,'PATCH',{role:'superadmin'},newAdminCookie)).status,403);
 assert.equal((await call('users/'+uid,'PATCH',{green:true},newAdminCookie)).status,200);assert.equal((await call('users/'+uid,'PATCH',{green:false},newAdminCookie)).status,200);
 const superState=await(await call('state','GET',null,ac)).json();assert.equal(superState.user.role,'superadmin');
 assert.equal((await call('users/'+superState.user.id,'PATCH',{active:0},newAdminCookie)).status,403);
 assert.equal((await call('users/'+superState.user.id+'/password','POST',{password:'Blocked12345'},newAdminCookie)).status,403);
 assert.equal((await call('email-settings','GET',null,newAdminCookie)).status,403);
 assert.equal((await call('email-settings','PUT',{},newAdminCookie)).status,403);
 assert.equal((await call('email-settings/test','POST',{to:'test@example.se'},newAdminCookie)).status,403);
 assert.equal((await call('export','GET',null,newAdminCookie)).status,200);
 assert.equal((await call('users','POST',{name:'Adminens volontär',email:'admin-volunteer@example.se',password:'Password12345'},newAdminCookie)).status,200);
 const adminState=await(await call('state','GET',null,ac)).json();assert.equal((await call('users/'+adminState.user.id,'PATCH',{role:'volunteer'},ac)).status,400);
 assert.equal((await call('reminders/send','POST',{},vc)).status,403);assert.equal((await call('reminders/send','POST',{},ac)).status,503);
 assert.equal((await call('email-settings','GET',null,vc)).status,403);
 assert.equal((await call('email-settings','PUT',{gmail_address:'test@gmail.com',app_password:'abcdefghijklmnop',app_url:'https://katthem.example.se',enabled:false},vc)).status,403);
 assert.equal((await call('email-settings/test','POST',{to:'test@example.se'},vc)).status,403);
 const mailConfig=await call('email-settings','PUT',{gmail_address:'test@gmail.com',app_password:'abcd efgh ijkl mnop',app_url:'https://katthem.example.se',enabled:false},ac);assert.equal(mailConfig.status,200);const safeConfig=await mailConfig.json();assert.equal(safeConfig.password_saved,true);assert.ok(!JSON.stringify(safeConfig).includes('abcdefghijklmnop'));assert.ok(!('app_password' in safeConfig));assert.ok(!('secret' in safeConfig));
 const savedConfig=await(await call('email-settings','GET',null,ac)).json();assert.equal(savedConfig.gmail_address,'test@gmail.com');assert.equal(savedConfig.enabled,false);
 assert.equal((await call('email-settings/test','POST',{to:'invalid'},ac)).status,400);
 assert.equal((await call('email-settings','PUT',{gmail_address:'changed@gmail.com',app_password:'',app_url:'https://katthem.example.se',enabled:false},ac)).status,400);
 const resetCreate=await call('users','POST',{name:'Lösenordstest',email:'reset@example.se',password:'Original12345'},ac);assert.equal(resetCreate.status,200);const resetId=(await resetCreate.json()).users.find(u=>u.email==='reset@example.se').id;
 const loginReset=async password=>call('login','POST',{email:'reset@example.se',password});
 const resetLogin1=await loginReset('Original12345'),resetLogin2=await loginReset('Original12345');const resetCookie1=resetLogin1.headers.get('set-cookie').split(';')[0],resetCookie2=resetLogin2.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('users/'+resetId+'/password','POST',{password:'Changed12345'})).status,401);
 assert.equal((await call('users/'+resetId+'/password','POST',{password:'Changed12345'},vc)).status,403);
 assert.equal((await call('users/'+resetId+'/password','POST',{password:'short'},ac)).status,400);
 assert.equal((await call('state','GET',null,resetCookie1)).status,200);
 assert.equal((await call('users/999999/password','POST',{password:'Changed12345'},ac)).status,404);
 assert.equal((await call('users/'+adminState.user.id+'/password','POST',{password:'Changed12345'},ac)).status,400);
 const resetDone=await call('users/'+resetId+'/password','POST',{password:'Changed12345'},ac);assert.equal(resetDone.status,200);const resetState=await resetDone.json();assert.equal(resetState.users.find(u=>u.id===resetId).active,1);assert.ok(!JSON.stringify(resetState).includes('Changed12345'));
 assert.equal((await call('state','GET',null,resetCookie1)).status,401);assert.equal((await call('state','GET',null,resetCookie2)).status,401);
 assert.equal((await loginReset('Original12345')).status,401);assert.equal((await loginReset('Changed12345')).status,200);
 assert.equal((await call('state','GET',null,ac)).status,200);
 const ordinaryVolunteer=(await(await call('state','GET',null,ac)).json()).users.find(u=>u.email==='admin-volunteer@example.se');
 assert.equal((await call('users/'+ordinaryVolunteer.id+'/password','POST',{password:'NewVolunteer12345'},newAdminCookie)).status,200);
 assert.equal((await call('users/'+ordinaryVolunteer.id,'PATCH',{active:0},newAdminCookie)).status,200);
 const volunteerId=(await(await call('state','GET',null,vc)).json()).user.id;
 assert.equal((await call('users/'+volunteerId,'PATCH',{green:true},vc)).status,403);
 let marking=await call('users/'+volunteerId,'PATCH',{green:true},ac);assert.equal(marking.status,200);
 let marked=(await marking.json()).users.find(u=>u.id===volunteerId);assert.equal(marked.green,true);assert.equal(marked.active,1);assert.equal(marked.completed_shifts,0);
 let ownStats=(await(await call('state','GET',null,vc)).json());assert.equal(ownStats.user.green,true);assert.equal(ownStats.user.completed_shifts,0);assert.deepEqual(ownStats.users,[]);
 marking=await call('users/'+volunteerId,'PATCH',{green:false},ac);marked=(await marking.json()).users.find(u=>u.id===volunteerId);assert.equal(marked.green,false);assert.equal(marked.active,1);
 assert.equal((await call('users/'+volunteerId,'PATCH',{green:'true'},ac)).status,400);
 const importCsv='namn;e-post;lösenord;grön\n"Åsa; Kattvän";asa@example.se;Password12345;nej\nÖrjan;orjan@example.se;Password67890;ja';
 assert.equal((await call('users/import','POST',{csv:importCsv,green:true},vc)).status,403);
 const preview=await call('users/import-preview','POST',{csv:importCsv,green:true},ac);assert.equal(preview.status,200);
 const previewData=await preview.json();assert.deepEqual(previewData.users.map(u=>u.green),[true,true]);assert.ok(!JSON.stringify(previewData).includes('Password'));
 assert.equal((await(await call('state','GET',null,ac)).json()).users.some(u=>u.email==='asa@example.se'),false);
 const imported=await call('users/import','POST',{csv:importCsv,green:false},ac);assert.equal(imported.status,200);
 const importedUsers=(await imported.json()).users;assert.equal(importedUsers.find(u=>u.email==='asa@example.se').green,false);assert.equal(importedUsers.find(u=>u.email==='orjan@example.se').green,true);
 assert.equal(importedUsers.find(u=>u.email==='asa@example.se').name,'Åsa; Kattvän');
 const allGreen=await call('users/import','POST',{csv:'namn,e-post,lösenord\nGrupp,grupp@example.se,Password12345',green:true},ac);assert.equal(allGreen.status,200);assert.equal((await allGreen.json()).users.find(u=>u.email==='grupp@example.se').green_manual,true);
 const importedLogin=await call('login','POST',{email:'orjan@example.se',password:'Password67890'});assert.equal(importedLogin.status,200);assert.equal((await importedLogin.json()).user.green,true);
 for(const csv of [importCsv,'namn;e-post;lösenord\nNy;new@example.se;Password12345\nFel;fel@example.se;kort','namn;e-post;lösenord\nNy;new@example.se;Password12345\nDublett;NEW@example.se;Password12345']){
  assert.equal((await call('users/import','POST',{csv,green:false},ac)).status,400);
  assert.equal((await(await call('state','GET',null,ac)).json()).users.some(u=>u.email==='new@example.se'),false);
 }
 // Completed shift totals: the 15/16 boundary, cancelled shifts and future shifts.
 const fixtureDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));
 try{
 const insertSlot=fixtureDb.prepare('INSERT INTO slots(date,start,end,title,capacity,note,cancelled) VALUES(?,?,?,?,0,?,?)');
 const insertBooking=fixtureDb.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)');
 const addHistory=(date,cancelled=0)=>{const row=insertSlot.run(date,'08:00','12:00','Historiktest','',cancelled);insertBooking.run(uid,row.lastInsertRowid)};
 for(let i=1;i<=15;i++)addHistory('2000-01-'+String(i).padStart(2,'0'));
 addHistory('2000-01-20',1);addHistory('2099-01-20');
 let stats=await(await call('state','GET',null,ac)).json();assert.equal(stats.users.find(u=>u.id===uid).completed_shifts,15);assert.equal(stats.users.find(u=>u.id===uid).green,false);assert.equal(stats.users.find(u=>u.id===uid).inactive_month,true);
 assert.equal(stats.users.find(u=>u.id===stats.user.id).completed_shifts,0);
 addHistory('2000-01-16');
 stats=await(await call('state','GET',null,ac)).json();assert.equal(stats.users.find(u=>u.id===uid).completed_shifts,16);assert.equal(stats.users.find(u=>u.id===uid).green,true);
 const automatic=await call('users/'+uid,'PATCH',{green:false},ac);assert.equal((await automatic.json()).users.find(u=>u.id===uid).green,true);
 const historyLogin=await call('login','POST',{email:'test@example.se',password:'password12345'});assert.equal(historyLogin.status,200);const historyUser=(await historyLogin.json()).user;assert.equal(historyUser.completed_shifts,16);assert.equal(historyUser.green,true);
 }finally{fixtureDb.close()}
 const results=await Promise.all([call('bookings','POST',{slotId:slot.id},vc),call('bookings','POST',{slotId:slot.id,userId:uid},ac)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,200]);
 let s=await(await call('state','GET',null,ac)).json();assert.equal(s.slots.find(x=>x.id===slot.id).booked,2);const booking=s.bookings.find(b=>b.slot_id===slot.id);
 assert.equal((await call('bookings','POST',{slotId:slot.id,userId:booking.user_id},ac)).status,409);
 assert.equal((await call('bookings','POST',{slotId:slot.id},ac)).status,200);
 s=await(await call('state','GET',null,ac)).json();assert.equal(s.slots.find(x=>x.id===slot.id).booked,3);
 assert.equal((await call('bookings/'+s.bookings.find(b=>b.slot_id===slot.id&&b.user_id===s.user.id).id,'DELETE',null,ac)).status,200);
 // Seven is advisory: seventh succeeds, eighth requires explicit confirmation on the server.
 const crowd=await call('slots','POST',{date:'2099-03-10',start:'12:00',end:'13:00',title:'Sjutest'},ac);assert.equal(crowd.status,200);const crowdId=(await crowd.json()).slots.find(s=>s.title==='Sjutest').id;
 const seedDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));const crowdUsers=[];
 try{const userPassword=seedDb.prepare('SELECT password FROM users WHERE id=?').get(uid).password;for(let i=0;i<7;i++){const row=seedDb.prepare('INSERT INTO users(name,email,password,created_at) VALUES(?,?,?,?)').run('Bemanning '+i,'crowd'+i+'@example.se',userPassword,Date.now());crowdUsers.push(Number(row.lastInsertRowid))}}finally{seedDb.close()}
 for(const userId of crowdUsers)assert.equal((await call('bookings','POST',{slotId:crowdId,userId},ac)).status,200);
 const warning=await call('bookings','POST',{slotId:crowdId},vc);assert.equal(warning.status,409);assert.equal((await warning.json()).code,'RECOMMENDED_LIMIT');
 assert.equal((await call('bookings','POST',{slotId:crowdId,confirmOverLimit:false},vc)).status,409);
 assert.equal((await call('bookings','POST',{slotId:crowdId,confirmOverLimit:true},vc)).status,200);
 assert.equal((await call('bookings','POST',{slotId:crowdId,userId:uid},ac)).status,409);
 assert.equal((await call('bookings','POST',{slotId:crowdId,userId:uid,confirmOverLimit:true},ac)).status,200);
 const existingOpenHouse=(await(await call('state','GET',null,ac)).json()).slots.filter(s=>s.kind==='open_house');assert.ok(existingOpenHouse.length>0);for(const event of existingOpenHouse){assert.equal(event.start,'11:00');assert.equal(event.end,'15:00');assert.equal(new Date(event.date+'T12:00').getDay(),0);assert.ok(Number(event.date.slice(-2))<=7)}
 assert.equal((await call('slots','POST',{date:'2099-02-01',start:'11:00',end:'15:00',title:'Öppet hus',kind:'open_house'},ac)).status,400);
 const openId=existingOpenHouse.find(s=>new Date(s.date+'T'+s.start)>new Date()).id;
 assert.equal((await call('bookings','POST',{slotId:openId},vc)).status,200);assert.equal((await call('bookings','POST',{slotId:openId,userId:uid},ac)).status,200);
 assert.equal((await call('slots/'+openId,'DELETE',null,ac)).status,400);assert.equal((await call('slots/'+openId,'PATCH',{date:'2099-02-01',start:'10:00',end:'12:00',title:'Flyttat'},ac)).status,400);
 // Events can be rescheduled atomically, retaining attendees and checking their other bookings.
 const eventPayload={date:'2099-04-10',start:'13:00',end:'14:00',title:'Veterinärbesök',kind:'event',note:'Vaccination'};
 assert.equal((await call('slots','POST',eventPayload,vc)).status,403);
 const eventResponse=await call('slots','POST',eventPayload,ac);assert.equal(eventResponse.status,200);const eventId=(await eventResponse.json()).slots.find(s=>s.title==='Veterinärbesök').id;
 assert.equal((await call('bookings','POST',{slotId:eventId},vc)).status,200);assert.equal((await call('bookings','POST',{slotId:eventId,userId:uid},ac)).status,200);
 const beforeEvent=await(await call('state','GET',null,ac)).json(),eventBookings=beforeEvent.bookings.filter(b=>b.slot_id===eventId).map(b=>b.id);
 const otherResponse=await call('slots','POST',{...eventPayload,date:'2099-04-11',title:'Annat besök'},ac);const otherId=(await otherResponse.json()).slots.find(s=>s.title==='Annat besök').id;assert.equal((await call('bookings','POST',{slotId:otherId},vc)).status,200);
 assert.equal((await call('slots/'+eventId,'PATCH',{...eventPayload,date:'2099-04-11'},ac)).status,409);
 let eventState=await(await call('state','GET',null,ac)).json();assert.equal(eventState.slots.find(s=>s.id===eventId).date,'2099-04-10');
 assert.equal((await call('slots/'+eventId,'PATCH',{...eventPayload,date:'2099-04-12'},vc)).status,403);
 const deliveryDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));deliveryDb.prepare('INSERT INTO reminder_delivery(booking_id,delivery_key,sent_at) VALUES(?,?,?)').run(eventBookings[0],'event-test-key',Date.now());deliveryDb.close();
 const moved=await call('slots/'+eventId,'PATCH',{...eventPayload,date:'2099-04-12'},ac);assert.equal(moved.status,200);eventState=await moved.json();assert.deepEqual(eventState.bookings.filter(b=>b.slot_id===eventId).map(b=>b.id),eventBookings);
 const checkDelivery=new DatabaseSync(path.join(dir,'katthem.sqlite'));assert.equal(checkDelivery.prepare('SELECT COUNT(*) n FROM reminder_delivery WHERE booking_id=?').get(eventBookings[0]).n,0);checkDelivery.close();
 const cancelledEvent=await call('slots/'+eventId,'PATCH',{cancelled:true},ac);assert.equal(cancelledEvent.status,200);eventState=await cancelledEvent.json();assert.equal(eventState.slots.find(s=>s.id===eventId).cancelled,1);assert.deepEqual(eventState.bookings.filter(b=>b.slot_id===eventId).map(b=>b.id),eventBookings);
 assert.equal((await call('bookings','POST',{slotId:eventId},ac)).status,409);
 const restored=await call('slots/'+eventId,'PATCH',{...eventPayload,date:'2099-04-12'},ac);assert.equal(restored.status,200);assert.equal((await restored.json()).slots.find(s=>s.id===eventId).cancelled,0);
 assert.equal((await call('slots/'+eventId,'PATCH',{...eventPayload,date:'2099-02-30'},ac)).status,400);assert.equal((await call('slots/'+eventId,'DELETE',null,ac)).status,400);
 const firstSunday='2099-02-01',laterSunday='2099-02-08';
 // February 1, 2099 is a Sunday: open house blocks afternoon bookings.
 assert.equal(new Date(firstSunday+'T12:00').getDay(),0);
 assert.equal((await call('slots','POST',{date:firstSunday,start:'16:00',end:'18:00',title:'Eftermiddagspass'},ac)).status,400);
 for(const date of [firstSunday,laterSunday]){
  const response=await call('slots','POST',{date,start:'18:00',end:'20:00',title:'Kvällspass'},ac);assert.equal(response.status,200);
  const social=(await response.json()).slots.find(x=>x.date===date&&x.start==='18:00');assert.equal(social.title,'Socialiseringsgruppen');assert.match(social.note,/socialiseringsträning/);assert.equal(social.minimum_staff,2);
 }
 const seeded=(await(await call('state','GET',null,ac)).json()).slots.filter(x=>x.date!==firstSunday&&x.date!==laterSunday&&x.title!=='Testpass');
 for(const item of seeded){if(new Date(item.date+'T12:00').getDay()===0){if(item.start==='18:00')assert.equal(item.title,'Socialiseringsgruppen');if(Number(item.date.slice(-2))<=7&&item.start==='16:00'){assert.equal(item.cancelled,1);assert.equal((await call('bookings','POST',{slotId:item.id},vc)).status,409)}}}
 const csv=await call('export','GET',null,ac);assert.match(await csv.text(),/Testpass/);
 await stop();
 const legacy=new DatabaseSync(path.join(dir,'katthem.sqlite'));const originalHash=legacy.prepare('SELECT password FROM users WHERE email=?').get('admin@katthem.local').password;const danielId=Number(legacy.prepare("INSERT INTO users(name,email,password,role,created_at) VALUES(?,?,?,'admin',?)").run('Daniel','daniel@staahlis.se',originalHash,Date.now()).lastInsertRowid);legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-daniel-session',danielId,Date.now()+86400000);legacy.prepare('DELETE FROM migrations WHERE name=?').run('superadmin-daniel-20261024');legacy.exec("ALTER TABLE slots DROP COLUMN cancelled; UPDATE slots SET capacity=2; UPDATE slots SET title='Kvällspass' WHERE start='18:00';" );legacy.close();
 await start();s=await(await call('state','GET',null,ac)).json();assert.equal(s.users.find(u=>u.email==='daniel@staahlis.se').role,'superadmin');assert.equal((await call('state','GET',null,'session=old-daniel-session')).status,401);const danielLogin=await call('login','POST',{email:'daniel@staahlis.se',password:passwords[0]});assert.equal(danielLogin.status,200);assert.equal((await danielLogin.json()).user.role,'superadmin');assert.equal(s.slots.find(x=>x.id===slot.id).booked,2);assert.equal(s.slots.find(x=>x.id===slot.id).capacity,0);assert.equal(s.users.find(u=>u.email==='grupp@example.se').green_manual,true);assert.ok(readFileSync(path.join(dir,'schema-v1-backup.sqlite')).length>0);
 for(const item of s.bookings.filter(b=>b.slot_id===slot.id))assert.equal((await call('bookings/'+item.id,'DELETE',null,ac)).status,200);
 r=await call('bookings','POST',{slotId:slot.id},vc);assert.equal(r.status,200);
 r=await call('slots','POST',{date,start:'12:30',end:'13:30',title:'Överlapp',capacity:2},ac);const overlap=(await r.json()).slots.find(x=>x.title==='Överlapp');assert.equal((await call('bookings','POST',{slotId:overlap.id},vc)).status,409);
 const own=(await(await call('state','GET',null,vc)).json()).bookings.find(b=>b.slot_id===slot.id);assert.equal((await call('bookings/'+own.id,'DELETE',null,vc)).status,200);
 const vstate=await(await call('state','GET',null,vc)).json();assert.deepEqual(vstate.users,[]);
 assert.equal((await call('users/'+vstate.user.id,'PATCH',{active:0},ac)).status,200);assert.equal((await call('state','GET',null,vc)).status,401);
 const blocked=await fetch(base+'/api/slots',{method:'POST',headers:{cookie:ac,origin:'http://other.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
 await stop();await start({NODE_ENV:'production',HOST:'0.0.0.0',APP_URL:'https://katthem.example.se'});
 const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
 assert.equal((await fetch(base+'/data/lokala-konton.txt')).status,404);
 const loginData=JSON.stringify({email:'admin@katthem.local',password:passwords[0]});
 const productionLogin=await fetch(base+'/api/login',{method:'POST',headers:{origin:'https://katthem.example.se','Content-Type':'application/json'},body:loginData});
 assert.equal(productionLogin.status,200);assert.match(productionLogin.headers.get('set-cookie'),/; Secure/);
 const pc=productionLogin.headers.get('set-cookie').split(';')[0];
 for(const origin of ['https://other.invalid','http://katthem.example.se']){
  assert.equal((await fetch(base+'/api/logout',{method:'POST',headers:{origin,cookie:pc}})).status,403);
 }
 const logout=await fetch(base+'/api/logout',{method:'POST',headers:{origin:'https://katthem.example.se',cookie:pc}});
 assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/; Secure/);
 assert.equal((await call('state','GET',null,pc)).status,401);
 }finally{await stop();rmSync(dir,{recursive:true,force:true})}
});

test('CSV: BOM, citattecken, radbrytningar och validering',()=>{
 const parsed=parseVolunteersCsv('\uFEFFnamn,e-post,lösenord,grön\r\n"Anna, \"\"Katt\"\"\nVän",anna@example.se,Password12345,ja\r\n');
 assert.equal(parsed[0].name,'Anna, "Katt"\nVän');assert.equal(parsed[0].green,true);
 for(const csv of ['namn;e-post;lösenord\n"Oavslutad;a@example.se;Password12345','namn;e-post;lösenord;grön\nNamn;a@example.se;Password12345;kanske','namn;e-post;lösenord\nNamn;a@example.se','namn;e-post;lösenord'])assert.throws(()=>parseVolunteersCsv(csv));
 assert.throws(()=>parseVolunteersCsv('namn;e-post;lösenord\n'+Array.from({length:501},(_,i)=>'Namn;a'+i+'@example.se;Password12345').join('\n')),/500/);
});

test('En kalendermånads frånvaro: gräns, nya konton och månadsslut',()=>{
 const now=new Date(2030,2,31,12),cutoff=new Date(2030,1,28,12).getTime();assert.equal(monthAgo(now),cutoff);
 const user={role:'volunteer',active:1,created_at:cutoff-1};assert.equal(isInactive(user,cutoff,now),true);assert.equal(isInactive(user,cutoff+1,now),false);assert.equal(isInactive({...user,created_at:now.getTime()},undefined,now),false);assert.equal(isInactive(user,undefined,now),true);assert.equal(isInactive({...user,active:0},cutoff-1,now),false);assert.equal(isInactive({...user,role:'admin'},cutoff-1,now),false);
});
test('E-postpåminnelser: filtrering, försök igen och skydd mot dubbla utskick',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,active INTEGER);CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,title TEXT,cancelled INTEGER);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),slot_id INTEGER REFERENCES slots(id));INSERT INTO users VALUES(1,'Anna','anna@example.se',1),(2,'Inaktiv','inactive@example.se',0);");
 const now=new Date(2030,4,11,12).getTime(),requests=[];
 const add=(id,date,start,cancelled=0,userId=1)=>{db.prepare('INSERT INTO slots VALUES(?,?,?,?,?,?)').run(id,date,start,'19:00','Testpass',cancelled);db.prepare('INSERT INTO bookings VALUES(?,?,?)').run(id,userId,id)};
 add(1,'2030-05-11','13:00');add(2,'2030-05-11','14:00');add(3,'2030-05-11','15:00',1);add(4,'2030-05-11','11:00');add(5,'2030-05-12','13:00');add(6,'2030-05-11','16:00',0,2);
 let fail=true;const config={apiKey:'test-key',from:'katthem@example.se',appUrl:'https://katthem.example.se',now:()=>now,fetchImpl:async(url,options)=>{requests.push({url,...options});if(fail){fail=false;return {ok:false,status:429}}return {ok:true}}};
 try{
  const reminders=createReminders(db,config);assert.deepEqual(await reminders.run(),{sent:1,failed:1});assert.match(reminders.status().last_error,/429/);
  assert.deepEqual(await reminders.run(),{sent:1,failed:0});assert.equal(requests.length,3);assert.equal(requests[0].headers['Idempotency-Key'],requests[2].headers['Idempotency-Key']);assert.equal(requests[0].headers.Authorization,'Bearer test-key');assert.deepEqual(JSON.parse(requests[0].body).to,['anna@example.se']);assert.match(JSON.parse(requests[0].body).text,/13:00/);
  const restarted=createReminders(db,config);assert.deepEqual(await restarted.run(),{sent:0,failed:0});assert.equal(restarted.status().sent_count,2);
  const disabled=createReminders(db,{});assert.equal(disabled.status().configured,false);assert.deepEqual(await disabled.run(),{sent:0,failed:0});
 }finally{db.close()}
});

test('Gränssnitt: roller, öppet hus, påminnelser och bekräftelse av åttonde bokning',async()=>{
 const elements=new Map(),requests=[];
 const element=()=>({innerHTML:'',style:{},querySelectorAll:()=>[],querySelector:()=>({}),showModal(){this.open=true},close(){this.open=false}});
 const document={querySelector(s){if(s==='#password-form')return null;if(!elements.has(s))elements.set(s,element());return elements.get(s)}};
 const future=new Date(Date.now()+7200000),date=[future.getFullYear(),String(future.getMonth()+1).padStart(2,'0'),String(future.getDate()).padStart(2,'0')].join('-'),start=String(future.getHours()).padStart(2,'0')+':'+String(future.getMinutes()).padStart(2,'0');
 const fixture={user:{id:1,name:'Admin',email:'admin@example.se',role:'superadmin',completed_shifts:0},users:[{id:2,name:'Volontär',email:'volunteer@example.se',role:'volunteer',active:1,completed_shifts:0,inactive_month:true}],slots:[{id:5,date,start,end:'23:59',title:'Öppet hus',kind:'open_house',mine:1,booked:7,minimum_staff:2,cancelled:0}],bookings:[],email_reminders:{configured:false}};
 const context=vm.createContext({document,Date,setTimeout,FormData:class{},fixture,fetch:async(url,options)=>{if(url==='/api/state')return new Promise(()=>{});requests.push(JSON.parse(options.body));return requests.length===1?{ok:false,status:409,json:async()=>({error:'Redan 7',code:'RECOMMENDED_LIMIT'})}:{ok:true,json:async()=>fixture}}});
 vm.runInContext(readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),context);
 vm.runInContext("state=fixture;view='admin';render()",context);assert.match(elements.get('#app').innerHTML,/Volontärer att följa upp/);assert.match(elements.get('#app').innerHTML,/Gör till admin/);assert.match(elements.get('#app').innerHTML,/dina pass inom nästa dygn/);
 vm.runInContext('newUser()',context);assert.match(elements.get('#modal').innerHTML,/option value="admin"/);
 assert.doesNotMatch(elements.get('#app').innerHTML,/Skapa öppet hus/);assert.match(elements.get('#app').innerHTML,/Skapa händelse/);assert.match(elements.get('#app').innerHTML,/Skapa admin/);
 vm.runInContext("eventForm()",context);assert.match(elements.get('#modal').innerHTML,/Veterinärbesök/);assert.match(elements.get('#modal').innerHTML,/value="event"/);
 vm.runInContext("newUser('admin')",context);assert.match(elements.get('#modal').innerHTML,/value="admin" selected/);
 vm.runInContext('resetUserPassword(2)',context);assert.match(elements.get('#modal').innerHTML,/Byt lösenord för Volontär/);assert.match(elements.get('#modal').innerHTML,/name="confirm"/);assert.match(elements.get('#modal').innerHTML,/Alla inloggningar/);
 await vm.runInContext('bookSlot(5)',context);assert.match(elements.get('#modal').innerHTML,/Är du säker/);assert.equal(requests[0].confirmOverLimit,false);
 await elements.get('#confirm-over-limit').onclick();assert.equal(requests[1].confirmOverLimit,true);assert.equal(elements.get('#modal').open,false);
 fixture.user.role='admin';vm.runInContext("view='admin';render()",context);assert.match(elements.get('#app').innerHTML,/Skapa händelse/);assert.match(elements.get('#app').innerHTML,/Byt lösenord/);assert.doesNotMatch(elements.get('#app').innerHTML,/data-role-user=/);assert.doesNotMatch(elements.get('#app').innerHTML,/data-action="new-admin"/);assert.doesNotMatch(elements.get('#app').innerHTML,/id="email-settings"/);
 vm.runInContext('newUser()',context);assert.doesNotMatch(elements.get('#modal').innerHTML,/option value="admin"/);
});

test('Gmail-inställningar: kryptering, beständighet, testmejl och säkra fel',async()=>{
 const dataDir=mkdtempSync(path.join(tmpdir(),'katthem-mail-test-')),password='abcdefghijklmnop',messages=[],options=[];
 const fakeTransport=opts=>{options.push(opts);return {sendMail:async message=>{messages.push(message)},close(){}}};
 const config={dataDir,defaultUrl:'https://katthem.example.se',production:true,createTransport:fakeTransport};
 try{
  const service=createEmailSettings(config);assert.equal(service.status().configured,false);
  assert.throws(()=>service.save({gmail_address:'test@gmail.com',app_password:'short',app_url:'https://katthem.example.se',enabled:true}),/16/);
  assert.throws(()=>service.save({gmail_address:'test@gmail.com',app_password:password,app_url:'http://katthem.example.se',enabled:true}),/HTTPS/);
  const saved=service.save({gmail_address:'test@gmail.com',app_password:'abcd efgh ijkl mnop',app_url:'https://katthem.example.se',enabled:false});assert.equal(saved.password_saved,true);assert.equal(service.status().configured,false);
  assert.ok(!readFileSync(path.join(dataDir,'email-settings.json'),'utf8').includes(password));assert.equal(readFileSync(path.join(dataDir,'email-secret.key')).length,32);
  await service.test('recipient@example.se');assert.equal(messages.length,1);assert.equal(options[0].host,'smtp.gmail.com');assert.equal(options[0].secure,true);assert.equal(options[0].port,465);assert.equal(options[0].auth.pass,password);assert.equal(messages[0].to,'recipient@example.se');
  const restarted=createEmailSettings(config);restarted.save({gmail_address:'test@gmail.com',app_password:'',app_url:'https://katthem.example.se',enabled:true});assert.equal(restarted.status().configured,true);
  await restarted.send({to:'recipient@example.se',subject:'Påminnelse',text:'Ditt pass börjar snart',key:'reminder-test'});assert.equal(messages.length,2);assert.ok(messages[1].messageId);
  assert.throws(()=>restarted.save({gmail_address:'other@gmail.com',app_password:'',app_url:'https://katthem.example.se',enabled:true}),/nytt applösenord/);
  await assert.rejects(()=>restarted.test('invalid'),/mottagaradress/);
  const broken=createEmailSettings({...config,createTransport:()=>({sendMail:async()=>{throw Object.assign(Error('secret '+password),{code:'EAUTH'})},close(){}})});
  await assert.rejects(()=>broken.test('recipient@example.se'),error=>error.status===502&&/nekade inloggningen/.test(error.message)&&!error.message.includes(password));
 }finally{rmSync(dataDir,{recursive:true,force:true})}
});

test('Gmail-formulär: sparat lösenord visas inte och testknapp kräver sparade uppgifter',async()=>{
 const elements=new Map(),settings={gmail_address:'katthem@gmail.com',app_url:'https://katthem.example.se',enabled:false,password_saved:false};
 const makeElement=()=>({innerHTML:'',style:{},querySelectorAll:()=>[],querySelector:()=>({}),showModal(){this.open=true},close(){this.open=false}});
 const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,makeElement());return elements.get(selector)}};
 const context=vm.createContext({document,Date,setTimeout,FormData:class{},fetch:async url=>url==='/api/state'?new Promise(()=>{}):{ok:true,json:async()=>settings}});
 vm.runInContext(readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),context);vm.runInContext("state={user:{email:'admin@example.se'}}",context);
 await vm.runInContext('emailSettingsDialog()',context);assert.match(elements.get('#modal').innerHTML,/Gmail-applösenord/);assert.match(elements.get('#modal').innerHTML,/<button disabled>Skicka testmejl/);
 settings.password_saved=true;await vm.runInContext('emailSettingsDialog()',context);assert.match(elements.get('#modal').innerHTML,/Ett applösenord finns sparat/);assert.doesNotMatch(elements.get('#modal').innerHTML,/<button disabled>Skicka testmejl/);assert.doesNotMatch(elements.get('#modal').innerHTML,/name="app_password"[^>]*value=/);
});

test('Uppgradera ursprungligt schema: behåll bokningar och anpassade pass, inga dubbletter',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("PRAGMA foreign_keys=ON;CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,title TEXT,capacity INTEGER,note TEXT,cancelled INTEGER,kind TEXT);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER,slot_id INTEGER REFERENCES slots(id));CREATE TABLE migrations(name TEXT PRIMARY KEY);");
 const insert=db.prepare('INSERT INTO slots VALUES(?,?,?,?,?,2,?,?,?)');
 insert.run(1,'2099-02-08','08:00','10:00','Morgonpass','Mat, rent vatten och en lugn start för katterna.',0,'regular');
 insert.run(2,'2099-02-08','17:00','19:00','Kvällspass','Mat, städning och en stunds sällskap.',0,'regular');
 insert.run(3,'2099-02-01','17:00','19:00','Inställt – öppet hus','Öppet hus första söndagen i månaden. Passet 16–18 är inställt.',1,'regular');
 insert.run(4,'2099-02-08','08:00','10:00','Morgonpass','Egen information',0,'regular');
 insert.run(5,'2099-02-08','17:00','19:00','Veterinärbesök','Mat, städning och en stunds sällskap.',0,'event');
 insert.run(6,'2099-02-08','16:00','18:00','Extra eftermiddag','Egen information',0,'regular');
 db.prepare('INSERT INTO bookings VALUES(1,42,2)').run();
 const rules=(date,start,end,title,note)=>start==='18:00'?{title:'Socialiseringsgruppen',note:'Socialiseringsträning',cancelled:0}:date==='2099-02-01'&&start==='16:00'?{title:'Inställt – öppet hus',note:'Öppet hus',cancelled:1}:{title,note,cancelled:0};
 try{
  assert.equal(upgradeDefaultShifts(db,rules),true);assert.equal(db.prepare('SELECT end FROM slots WHERE id=1').get().end,'12:00');assert.equal(db.prepare('SELECT start FROM slots WHERE id=2').get().start,'18:00');assert.equal(db.prepare('SELECT title FROM slots WHERE id=3').get().title,'Socialiseringsgruppen');assert.equal(db.prepare('SELECT cancelled FROM slots WHERE id=3').get().cancelled,0);
  assert.equal(db.prepare('SELECT slot_id FROM bookings WHERE id=1').get().slot_id,2);assert.equal(db.prepare('SELECT end FROM slots WHERE id=4').get().end,'10:00');assert.equal(db.prepare('SELECT start FROM slots WHERE id=5').get().start,'17:00');assert.equal(db.prepare("SELECT COUNT(*) n FROM slots WHERE date='2099-02-08' AND start='16:00'").get().n,1);assert.equal(db.prepare("SELECT cancelled FROM slots WHERE date='2099-02-01' AND start='16:00'").get().cancelled,1);
  const count=db.prepare('SELECT COUNT(*) n FROM slots').get().n;assert.equal(upgradeDefaultShifts(db,rules),false);assert.equal(db.prepare('SELECT COUNT(*) n FROM slots').get().n,count);
 }finally{db.close()}
});

test('Roller: admin och superadmin delar verksamhetsbehörighet men kontoskydd skiljer',()=>{
 const volunteer={role:'volunteer'},admin={role:'admin'},superadmin={role:'superadmin'};
 assert.equal(isAdmin(volunteer),false);assert.equal(isAdmin(admin),true);assert.equal(isAdmin(superadmin),true);assert.equal(isSuperAdmin(admin),false);assert.equal(isSuperAdmin(superadmin),true);
 assert.equal(canManageAccount(admin,volunteer),true);assert.equal(canManageAccount(admin,admin),false);assert.equal(canManageAccount(admin,superadmin),false);assert.equal(canManageAccount(superadmin,admin),true);assert.equal(canManageAccount(superadmin,superadmin),true);
});

test('Admins och superadmins är gröna även utan genomförda pass',()=>{assert.equal(isGreen({role:'admin'},0),true);assert.equal(isGreen({role:'superadmin'},0),true);assert.equal(isGreen({role:'volunteer'},15),false);assert.equal(isGreen({role:'volunteer'},16),true)});
