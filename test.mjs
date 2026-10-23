import {test} from 'node:test';
import {parseVolunteersCsv} from './csv-import.mjs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'katthem-test-'));
let child,base;
async function start(env={}){child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',APP_URL:'',...env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/[^\s:]+:\d+/);if(m)resolve(m[0].replace('0.0.0.0','127.0.0.1'))});child.on('error',reject);child.on('exit',code=>reject(Error('Server exit '+code)))});}
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
 let stats=await(await call('state','GET',null,ac)).json();assert.equal(stats.users.find(u=>u.id===uid).completed_shifts,15);assert.equal(stats.users.find(u=>u.id===uid).green,false);
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
 const legacy=new DatabaseSync(path.join(dir,'katthem.sqlite'));legacy.exec("ALTER TABLE slots DROP COLUMN cancelled; UPDATE slots SET capacity=2; UPDATE slots SET title='Kvällspass' WHERE start='18:00';" );legacy.close();
 await start();s=await(await call('state','GET',null,ac)).json();assert.equal(s.slots.find(x=>x.id===slot.id).booked,2);assert.equal(s.slots.find(x=>x.id===slot.id).capacity,0);assert.equal(s.users.find(u=>u.email==='grupp@example.se').green_manual,true);assert.ok(readFileSync(path.join(dir,'schema-v1-backup.sqlite')).length>0);
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
