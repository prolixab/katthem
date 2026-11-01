import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {createPortal} from './portal.mjs';
const password='PortalTest12345',hash='test-salt:'+scryptSync(password,'test-salt',64).toString('hex');
test('Flera katthem: serverbehörighet, dataseparation, tilldelning, kalender och återkallande', {timeout:180000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'katthem-portal-'));let portal;
 const initial=new DatabaseSync(path.join(dir,'katthem.sqlite'));initial.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'volunteer',active INTEGER NOT NULL DEFAULT 1)");for(const [id,name,email,role] of [[1,'Superadmin','boss@example.se','superadmin'],[2,'Styrelse A','board@example.se','admin'],[3,'Volontär A','vol@example.se','volunteer']])initial.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(id,name,email,hash,role);initial.close();
 try{
  portal=await createPortal({dataDir:dir,port:0,env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});const base='http://127.0.0.1:'+portal.server.address().port;
  const call=(route,method='GET',body,cookie,shelter)=>fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(shelter?{'X-Katthem':shelter}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const login=async(email,home='huskvarna')=>{const r=await call('login','POST',{email,password,portal_shelter:home});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()}};
  assert.equal((await call('state')).status,401);const sa=await login('boss@example.se'),board=await login('board@example.se'),vol=await login('vol@example.se');
  assert.equal(sa.data.portal.global_superadmin,true);assert.equal(board.data.portal.shelters.length,1);
  assert.equal((await call('portal/manage/shelters','POST',{name:'Otillåtet',address:'Fel'},board.cookie)).status,403);
  const created=await call('portal/manage/shelters','POST',{name:'Katthem B',address:'B-gatan 10'},sa.cookie);assert.equal(created.status,201);const b=(await created.json()).id;
  assert.equal((await call('state','GET',null,board.cookie,b)).status,403);assert.equal((await call('state','GET',null,vol.cookie,b)).status,403);
  let bs=await(await call('state','GET',null,sa.cookie,b)).json();assert.equal(bs.portal.selected,b);assert.equal(bs.volunteer_info.location,'B-gatan 10');assert.equal(bs.door_code.code,'');assert.ok(!bs.users.some(u=>u.email==='vol@example.se'));assert.ok(!bs.users.some(u=>u.email==='admin@katthem.local'));
  assert.equal((await call('door-code','PUT',{code:'B-CODE',revision:bs.door_code.revision},sa.cookie,b)).status,200);
  assert.equal((await call('news','POST',{title:'B-hemlig nyhet',body:'B-information',published:true,expires_at:Date.now()+86400000},sa.cookie,b)).status,200);
  const form={name:'Person B',email:'person-b@example.se',phone:'',address:'',member_number:'',member_since:'',status:'active',board_role:'none',board_title:'',responsibilities:'',note:'B-privat',birth_date:'',shelter:'Huskvarna',messenger_url:'',is_member:false,animal_care_trained:false,account:{role:'volunteer',password,active:true,green:false}};
  assert.equal((await call('volunteers','POST',form,sa.cookie,b)).status,200);
  const ownA=await(await call('state','GET',null,sa.cookie,'huskvarna')).json();assert.notEqual(ownA.door_code.code,'B-CODE');assert.ok(!JSON.stringify(ownA).includes('B-privat'));assert.ok(!JSON.stringify(ownA).includes('B-hemlig nyhet'));
  assert.equal((await call('volunteers','POST',{...form,name:'Lokal styrelse',email:'board@example.se',note:'',account:{...form.account,role:'admin'}},sa.cookie,b)).status,200);
  const grant={source:'huskvarna',user_id:2,target:b,role:'admin',enabled:true};assert.equal((await call('portal/manage/grants','POST',grant,sa.cookie)).status,200);
  bs=await(await call('state','GET',null,board.cookie,b)).json();assert.equal(bs.user.role,'admin');assert.equal(bs.door_code.code,'B-CODE');assert.ok(bs.news.some(n=>n.title==='B-hemlig nyhet'));assert.ok(bs.members.some(m=>m.note==='B-privat'));assert.equal(bs.portal.global_superadmin,false);
  assert.equal((await call('portal/manage','GET',null,board.cookie,b)).status,403);assert.equal((await call('portal/select','POST',{shelter:b},vol.cookie)).status,403);assert.equal((await call('portal/select','POST',{shelter:b},board.cookie)).status,200);
  assert.equal((await(await call('state','GET',null,board.cookie)).json()).portal.selected,b);
  const date=new Date(Date.now()+86400000*3).toISOString().slice(0,10);assert.equal((await call('slots','POST',{date,start:'13:00',end:'14:00',title:'B-veterinär',kind:'event'},sa.cookie,b)).status,200);
  bs=await(await call('state','GET',null,board.cookie,b)).json();const slot=bs.slots.find(s=>s.title==='B-veterinär');assert.equal((await call('bookings','POST',{slotId:slot.id},board.cookie,b)).status,200);
  const subscription=await(await call('calendar/subscription','POST',{},board.cookie,b)).json(),feed=await fetch(subscription.url);assert.equal(feed.status,200);const ics=await feed.text();assert.match(ics,/B-gatan 10/);assert.match(ics,/B-veterinär/);assert.ok(ics.includes('UID:katthem-slot-'+b+'-'));
  const csv=await(await call('export','GET',null,board.cookie,b)).text();assert.ok(csv.includes('B-veterinär'));
  // Same e-mail on another home's independent account never inherits the source account's grants.
  const sameEmail=await login('board@example.se',b);assert.equal(sameEmail.data.portal.global_superadmin,false);assert.equal((await call('state','GET',null,sameEmail.cookie,'huskvarna')).status,403);assert.equal((await call('portal/manage','GET',null,sameEmail.cookie,b)).status,403);
  assert.equal((await call('portal/manage/grants','POST',{...grant,enabled:false},sa.cookie)).status,200);assert.equal((await call('state','GET',null,board.cookie,b)).status,403);assert.equal((await fetch(subscription.url)).status,404);assert.equal((await call('state','GET',null,board.cookie,'huskvarna')).status,200);
  assert.equal((await call('state','GET',null,sa.cookie,b)).status,200);assert.equal((await call('state','GET',null,vol.cookie,'huskvarna')).status,200);
  assert.equal((await call('volunteers','POST',{...form,email:'forbidden-sa@example.se',account:{...form.account,role:'superadmin'}},sa.cookie,b)).status,403);
  assert.equal((await call('portal/manage/grants','POST',grant,sa.cookie)).status,200);assert.equal((await call('state','GET',null,board.cookie,b)).status,200);assert.equal((await fetch(subscription.url)).status,200);
  assert.equal((await call('users/2','PATCH',{active:false},sa.cookie,'huskvarna')).status,200);assert.equal((await call('state','GET',null,board.cookie,b)).status,401);assert.equal((await fetch(subscription.url)).status,404);
  const denied=await fetch(base+'/api/door-code',{method:'PUT',headers:{cookie:sa.cookie,origin:'https://evil.example','content-type':'application/json','X-Katthem':b},body:JSON.stringify({code:'ATTACK',revision:1})});assert.equal(denied.status,403);
  assert.equal((await call('portal/select','POST',{shelter:b},sa.cookie)).status,200);assert.equal((await(await call('state','GET',null,sa.cookie)).json()).portal.selected,b);
  const registry=new DatabaseSync(path.join(dir,'shelters.sqlite'));assert.equal(registry.prepare('SELECT COUNT(*) n FROM shelters').get().n,2);registry.close();
 }finally{if(portal)await portal.close();rmSync(dir,{recursive:true,force:true})}
});
