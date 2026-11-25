import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {createPortal} from './portal.mjs';
import {isAdmin,canManageBookings,isGreen} from './roles.mjs';
test('Samordnare: bokningsbehörighet ger ingen adminroll eller automatisk grönmarkering',()=>{const u={role:'coordinator'};assert.equal(canManageBookings(u),true);assert.equal(isAdmin(u),false);assert.equal(isGreen(u,0,false),false);assert.equal(isGreen(u,10,true),true);assert.equal(isGreen(u,9,true),false)});
test('Samordnare: begränsad bemanning, skyddade adminfunktioner och separat åtkomst i två hem',{timeout:60000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'coordinator-')),password='Coordinator12345',hash='salt:'+scryptSync(password,'salt',64).toString('hex'),seed=new DatabaseSync(path.join(dir,'katthem.sqlite'));
 seed.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER DEFAULT 1)");for(const [id,role] of [[1,'superadmin'],[2,'volunteer'],[3,'volunteer'],[4,'admin']])seed.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(id,'Person '+id,'person'+id+'@test.local',hash,role);seed.close();let portal;
 try{portal=await createPortal({dataDir:dir,port:0,env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});const base='http://127.0.0.1:'+portal.server.address().port;
 const call=(route,method='GET',body,cookie,home)=>fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(home?{'X-Katthem':home}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const login=async id=>{const r=await call('login','POST',{email:'person'+id+'@test.local',password});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0],data=await r.json();if(data.password_change_required)assert.equal((await call('password','POST',{current:password,password:password+'Own'},cookie)).status,200);return cookie};
 const sa=await login(1),coord=await login(2),admin=await login(4);
 assert.equal((await call('users/2','PATCH',{role:'coordinator'},admin)).status,403);assert.equal((await call('users/2','PATCH',{role:'coordinator'},sa)).status,200);
 const state=await(await call('state','GET',null,coord)).json();assert.equal(state.user.role,'coordinator');assert.equal(state.user.green,false);assert.equal(state.members,undefined);assert.equal(state.engagement_admin,undefined);assert.equal(state.shelter_admin,undefined);assert.ok(state.users.every(u=>!('email' in u)&&!('engagement' in u)&&!('birth_date' in u)));
 const day=new Date();day.setDate(day.getDate()+10);const date=day.toLocaleDateString('sv-SE'),payload={date,start:'13:00',end:'14:00',title:'Samordningstest',kind:'regular'};
 const created=await call('slots','POST',payload,sa);assert.equal(created.status,200);const slot=(await created.json()).slots.find(s=>s.title===payload.title);
 assert.equal((await call('bookings','POST',{slotId:slot.id,userId:3},coord)).status,200);const booked=await(await call('state','GET',null,coord)).json(),booking=booked.bookings.find(b=>b.slot_id===slot.id&&b.user_id===3);assert.ok(booking);assert.equal(booking.name,'Person 3');assert.equal(booking.email,undefined);
 assert.equal((await call('staffing?start='+date+'&end='+date,'GET',null,coord)).status,200);
 const repeat=await call('bookings/recurring','POST',{slotId:slot.id,userId:3,interval:1,until:date,preview:true},coord);assert.equal(repeat.status,200);assert.equal((await repeat.json()).rows[0].status,'already');
 assert.equal((await call('bookings/'+booking.id,'DELETE',null,coord)).status,200);
 const ages=new DatabaseSync(path.join(dir,'katthem.sqlite'));ages.prepare("UPDATE member_profiles SET birth_date='2015-01-01' WHERE user_id=3").run();ages.prepare("UPDATE member_profiles SET birth_date='1990-01-01' WHERE user_id=4").run();ages.close();
 const young=await call('bookings','POST',{slotId:slot.id,userId:3},coord);assert.equal(young.status,409);assert.equal((await young.json()).code,'ADULT_REQUIRED');
 assert.equal((await call('bookings','POST',{slotId:slot.id,userId:4},coord)).status,200);const withYoung=await call('bookings','POST',{slotId:slot.id,userId:3},coord);assert.equal(withYoung.status,200);const ageBookings=(await withYoung.json()).bookings.filter(b=>b.slot_id===slot.id);assert.equal((await call('bookings/'+ageBookings.find(b=>b.user_id===4).id,'DELETE',null,coord)).status,409);assert.equal((await call('bookings/'+ageBookings.find(b=>b.user_id===3).id,'DELETE',null,coord)).status,200);assert.equal((await call('bookings/'+ageBookings.find(b=>b.user_id===4).id,'DELETE',null,coord)).status,200);

 for(const [route,method,body] of [['slots','POST',payload],['slots/'+slot.id,'PATCH',payload],['users/3','PATCH',{active:false}],['users/2','PATCH',{role:'superadmin'}],['engagements/3/introduction-status','PATCH',{completed:true,revision:0}],['shift-routines','PUT',{}],['checklist/template','GET'],['email-settings','GET'],['export','GET'],['portal/manage','GET']])assert.equal((await call(route,method,body,coord)).status,403,route);
 const localEventResponse=await call('slots','POST',{...payload,kind:'event',title:'Lokalt event'},sa);const localEvent=(await localEventResponse.json()).slots.find(s=>s.title==='Lokalt event');assert.equal((await call('bookings','POST',{slotId:localEvent.id,userId:3},coord)).status,403);
 const home=(await(await call('portal/manage/shelters','POST',{name:'Hem B',address:'B-gatan'},sa)).json()).id;
 assert.equal((await call('state','GET',null,coord,home)).status,403);assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:2,target:home,role:'coordinator',enabled:true},sa)).status,200);
 const second=await(await call('state','GET',null,coord,home)).json();assert.equal(second.user.role,'coordinator');assert.equal((await call('staffing?start='+date+'&end='+date,'GET',null,coord,home)).status,200);assert.equal((await call('users','POST',{name:'Fel',email:'fel@test.local',password},coord,home)).status,403);
 assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:2,target:home,role:'coordinator',enabled:false},sa)).status,200);assert.equal((await call('state','GET',null,coord,home)).status,403);
 assert.equal((await call('users/2','PATCH',{role:'volunteer'},sa)).status,200);assert.equal((await call('staffing?start='+date+'&end='+date,'GET',null,coord,'huskvarna')).status,403);
 }finally{await portal?.close();rmSync(dir,{recursive:true,force:true})}
});
