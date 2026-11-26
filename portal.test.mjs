import {createRecurringBookings} from './recurring.mjs';
import {createPasswordReset} from './password-reset.mjs';
import {checklistGroups} from './checklist.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {createPortal} from './portal.mjs';
const password='PortalTest12345',hash='test-salt:'+scryptSync(password,'test-salt',64).toString('hex');
test('Flera katthem: serverbehörighet, dataseparation, tilldelning, kalender och återkallande', {timeout:180000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'katthem-portal-'));let portal;
 const initial=new DatabaseSync(path.join(dir,'katthem.sqlite'));initial.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'volunteer',active INTEGER NOT NULL DEFAULT 1)");for(const [id,name,email,role] of [[1,'Superadmin','boss@example.se','superadmin'],[2,'Styrelse A','board@example.se','admin'],[3,'Volontär A','vol@example.se','volunteer']])initial.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(id,name,email,hash,role);initial.close();
 try{
  portal=await createPortal({dataDir:dir,port:0,env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});const base='http://127.0.0.1:'+portal.server.address().port;
  const call=(route,method='GET',body,cookie,shelter)=>fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(shelter?{'X-Katthem':shelter}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const credentials=new Map();const login=async(email,home='huskvarna')=>{const key=home+':'+email,current=credentials.get(key)||password;const r=await call('login','POST',{email,password:current,portal_shelter:home});assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('set-cookie').split(';')[0];let data=await r.json();if(data.password_change_required){assert.equal(data.slots,undefined);assert.equal((await call('portal/manage','GET',null,cookie)).status,403);assert.equal((await call('password','POST',{current,password:current},cookie)).status,400);const next=current+'-egen';assert.equal((await call('password','POST',{current,password:next},cookie)).status,200);credentials.set(key,next);data=await(await call('state','GET',null,cookie)).json()}return {cookie,data}};
  assert.equal((await call('state')).status,401);const sa=await login('boss@example.se'),board=await login('board@example.se'),vol=await login('vol@example.se');
  assert.equal((await call('activity-followup','GET',null,vol.cookie)).status,403);
  assert.equal((await(await call('activity-followup','GET',null,board.cookie)).json()).enabled,0);
  assert.deepEqual(await(await call('activity-followup/me','GET',null,vol.cookie)).json(),{followup:null});
  // Own contact fields are editable; private administration fields are rejected server-side.
  assert.equal((await call('profile','PATCH',{phone:'0700000000',messenger_url:'https://m.me/vol-test',revision:vol.data.my_profile.revision},vol.cookie)).status,200);
  let profileState=await(await call('state','GET',null,vol.cookie)).json();assert.equal(profileState.my_profile.phone,'0700000000');
  // A volunteer may supply a missing birth date once; subsequent corrections stay admin-only.
  const ownBirth=await call('profile','PATCH',{birth_date:'1995-05-20',revision:profileState.my_profile.revision},vol.cookie);assert.equal(ownBirth.status,200);profileState=await ownBirth.json();assert.equal(profileState.my_profile.birth_date,'1995-05-20');
  assert.equal((await call('profile','PATCH',{birth_date:'1996-05-20',revision:profileState.my_profile.revision},vol.cookie)).status,403);
  assert.equal((await call('profile','PATCH',{birth_date:'',revision:profileState.my_profile.revision},vol.cookie)).status,403);
  assert.equal((await call('profile','PATCH',{birth_date:'1995-05-20',phone:'0700000000',revision:profileState.my_profile.revision},vol.cookie)).status,200);
  let adminBirthProfile=(await(await call('state','GET',null,sa.cookie)).json()).members.find(m=>m.user_id===3);
  const correctedBirth=await call('members/'+adminBirthProfile.id,'PUT',{...adminBirthProfile,birth_date:'1996-05-20'},board.cookie);assert.equal(correctedBirth.status,200);adminBirthProfile=(await correctedBirth.json()).members.find(m=>m.user_id===3);assert.equal(adminBirthProfile.birth_date,'1996-05-20');
  assert.equal((await call('members/'+adminBirthProfile.id,'PUT',{...adminBirthProfile,birth_date:''},sa.cookie)).status,200);profileState=await(await call('state','GET',null,vol.cookie)).json();
  assert.equal((await call('profile','PATCH',{role:'admin',revision:profileState.my_profile.revision},vol.cookie)).status,400);
  assert.equal((await call('profile','PATCH',{animal_care_trained:true,revision:profileState.my_profile.revision},vol.cookie)).status,400);assert.equal((await call('profile','PATCH',{volunteer_bag:true,revision:profileState.my_profile.revision},vol.cookie)).status,400);
  assert.equal((await call('profile','PATCH',{phone:'stale',revision:vol.data.my_profile.revision},vol.cookie)).status,409);
  assert.equal((await call('engagements/3','PATCH',{status:'inactive',revision:0},vol.cookie)).status,403);
  assert.equal((await call('portal/engagement','PATCH',{status:'paused',scope:'one',review_date:'2099-01-01',revision:profileState.user.engagement.revision},vol.cookie)).status,200);
  profileState=await(await call('state','GET',null,vol.cookie)).json();assert.equal(profileState.user.engagement.status,'paused');
  assert.equal((await call('bookings','POST',{slotId:profileState.slots.find(s=>new Date(s.date+'T'+s.start)>Date.now()).id},vol.cookie)).status,409);
  assert.equal((await call('portal/engagement','PATCH',{status:'active',scope:'one',revision:profileState.user.engagement.revision},vol.cookie)).status,200);
  assert.equal(sa.data.portal.global_superadmin,true);assert.equal(board.data.portal.shelters.length,1);assert.deepEqual(vol.data.portal.own_shelters.map(h=>h.id),['huskvarna']);assert.equal(vol.data.portal.own_shelters[0].status,'active');
  assert.equal((await call('portal/manage/shelters','POST',{name:'Otillåtet',address:'Fel'},board.cookie)).status,403);
  const created=await call('portal/manage/shelters','POST',{name:'Katthem B',address:'B-gatan 10'},sa.cookie);assert.equal(created.status,201);const b=(await created.json()).id;
  // Display keys grant only a minimized, scoped, read-only schedule, never a portal session.
  assert.equal((await call('portal/display','GET',null,vol.cookie)).status,403);
  assert.equal((await call('portal/display','POST',{revision:0,show_names:false},board.cookie,b)).status,403);
  const displayMade=await call('portal/display','POST',{revision:0,show_names:false},board.cookie);assert.equal(displayMade.status,200);const displayData=await displayMade.json(),displayLink=new URL(displayData.link),displayKey=displayLink.hash.slice(1);
  assert.equal(displayLink.pathname,'/visning');assert.equal(displayLink.searchParams.get('shelter'),'huskvarna');assert.ok(!displayLink.search.includes(displayKey));
  let displayCookie='';
  async function approveDevice(key,home='huskvarna'){const request=await fetch(base+'/api/display/enroll?shelter='+home,{method:'POST',headers:{'X-Display-Key':key,'content-type':'application/json',cookie:displayCookie},body:'{}'});assert.equal(request.status,200);const cookie=request.headers.get('set-cookie');if(cookie){assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);displayCookie=cookie.split(';')[0]}const device=await request.json();assert.equal(device.token,undefined);if(!device.approved){const config=await(await call('portal/display','GET',null,sa.cookie,home)).json();const payload={revision:config.revision,device_revision:config.device_revision,pairing_code:device.pairing_code};assert.equal((await call('portal/display/device','POST',payload,board.cookie,home)).status,403);assert.equal((await call('portal/display/device','POST',payload,sa.cookie,home)).status,200)}return device}
  const displayGet=(home='huskvarna',method='GET',key=displayKey)=>fetch(base+'/api/display?shelter='+home,{method,headers:{'X-Display-Key':key,cookie:displayCookie}});
  const publicBefore=await displayGet();assert.equal(publicBefore.status,200);assert.equal((await publicBefore.json()).device_registered,false);
  for(const asset of ['/app.js','/style.css']){
   const file=await fetch(base+asset);
   assert.equal(file.status,200);
   assert.match(file.headers.get('etag'),/^"[a-f0-9]{64}"$/);
   assert.equal(file.headers.get('cache-control'),'public, no-cache');
   const cached=await fetch(base+asset,{headers:{'If-None-Match':'W/'+file.headers.get('etag')}});
   assert.equal(cached.status,304);assert.equal(await cached.text(),'');
   await file.arrayBuffer();
  }
  const mark=await call('users/3?response=compact','PATCH',{green:true},board.cookie);
  assert.equal(mark.status,200);
  assert.deepEqual(await mark.json(),{id:3,green_manual:true,green:false,slots:[]});
  assert.equal((await call('users/3?response=compact','PATCH',{green:false},vol.cookie)).status,403);
  assert.deepEqual(await(await call('users/3?response=compact','PATCH',{green:false},board.cookie)).json(),{id:3,green_manual:false,green:false,slots:[]});
  const securityFields={enabled:true,revision:1,device_revision:0};assert.equal((await call('portal/display/security','PUT',securityFields,board.cookie)).status,403);assert.equal((await call('portal/display/security','PUT',securityFields,vol.cookie)).status,403);assert.equal((await call('portal/display/security','PUT',securityFields,sa.cookie)).status,200);
  assert.equal((await displayGet()).status,403);await approveDevice(displayKey);assert.equal((await fetch(base+'/api/display?shelter=huskvarna',{headers:{'X-Display-Key':displayKey}})).status,403);
  const visible=await displayGet();assert.equal(visible.status,200);assert.equal(visible.headers.get('cache-control'),'no-store');assert.equal(visible.headers.get('set-cookie'),null);const viewOnly=await visible.json();assert.equal(viewOnly.days.length,7);assert.equal(viewOnly.show_names,false);assert.equal(viewOnly.presence,null);for(const field of ['user','users','bookings','door_code','members','contacts','news'])assert.equal(viewOnly[field],undefined);assert.equal(viewOnly.branding.primary,'#244e43');
  assert.match(viewOnly.schedule_revision,/^[a-f0-9]{64}$/);
  const unchangedUrl=base+'/api/display?shelter=huskvarna&schedule_revision='+viewOnly.schedule_revision;
  const unchangedDisplay=await(await fetch(unchangedUrl,{headers:{'X-Display-Key':displayKey,cookie:displayCookie}})).json();
  assert.equal(unchangedDisplay.days,undefined);
  assert.equal(unchangedDisplay.schedule_revision,viewOnly.schedule_revision);
  assert.equal(unchangedDisplay.device_registered,true);
  assert.equal((await fetch(unchangedUrl,{headers:{'X-Display-Key':displayKey}})).status,403);
  assert.equal((await fetch(base+'/api/display/confirm?shelter=huskvarna',{method:'POST',headers:{'content-type':'application/json','X-Display-Key':displayKey},body:JSON.stringify({choice:'a'.repeat(64)})})).status,403);
  assert.equal((await displayGet(b)).status,404);assert.equal((await displayGet('huskvarna','POST')).status,405);assert.equal((await displayGet('huskvarna','GET','bad')).status,404);
  for(const route of ['state','portal/manage','export','profile'])assert.equal((await fetch(base+'/api/'+route,{headers:{'X-Display-Key':displayKey}})).status,401);
  assert.equal((await fetch(base+'/api/bookings',{method:'POST',headers:{'X-Display-Key':displayKey,'content-type':'application/json'},body:JSON.stringify({slotId:sa.data.slots[0].id})})).status,401);
  assert.equal((await fetch(base+'/visning')).status,200);assert.equal((await fetch(base+'/visning',{method:'POST'})).status,405);assert.match((await fetch(base+'/visning')).headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await call('portal/display','POST',{revision:0,show_names:true},board.cookie)).status,409);
  const rotated=await(await call('portal/display','POST',{revision:1,show_names:true},board.cookie)).json();assert.equal((await displayGet()).status,404);await approveDevice(new URL(rotated.link).hash.slice(1));assert.equal((await displayGet('huskvarna','GET',new URL(rotated.link).hash.slice(1))).status,200);
  assert.equal((await call('portal/display','DELETE',{revision:2},board.cookie)).status,200);assert.equal((await displayGet('huskvarna','GET',new URL(rotated.link).hash.slice(1))).status,404);
  // Optional presence module: global authorization and separate activation per shelter.
  assert.equal(vol.data.modules.presence.enabled,false);
  assert.equal((await call('presence','GET',null,vol.cookie)).status,404);
  assert.equal((await call('presence/settings','PUT',{enabled:true,revision:0},board.cookie)).status,403);
  assert.equal((await call('presence/settings','PUT',{enabled:true,revision:0},vol.cookie)).status,403);
  assert.equal((await call('presence/settings','PUT',{enabled:true,revision:0},sa.cookie,b)).status,200);
  assert.equal((await (await call('state','GET',null,sa.cookie,b)).json()).modules.presence.enabled,true);
  assert.equal((await (await call('state','GET',null,sa.cookie,'huskvarna')).json()).modules.presence.enabled,false);
  assert.equal((await call('presence','GET',null,vol.cookie,b)).status,403);
  assert.equal((await call('presence/settings','PUT',{enabled:true,revision:0},sa.cookie,'huskvarna')).status,200);
  const qrDisplay=await(await call('portal/display','POST',{revision:3,show_names:true,allow_checkin:true},sa.cookie)).json(),qrKey=new URL(qrDisplay.link).hash.slice(1);
  await approveDevice(qrKey);
  let qrScreen=await(await displayGet('huskvarna','GET',qrKey)).json();assert.match(new URL(qrScreen.presence.link).hash,/^#narvaro\//);assert.equal(new URL(qrScreen.presence.link).searchParams.get('shelter'),'huskvarna');assert.match(qrScreen.presence.png,/^data:image\/png;base64,/);assert.ok(!JSON.stringify(qrScreen.presence).includes(qrKey));assert.deepEqual(Object.keys(qrScreen.presence).sort(),['expires_at','link','png','remaining_ms']);
  assert.equal((await fetch(base+'/api/presence/confirmations',{method:'POST',headers:{'X-Display-Key':qrKey,'content-type':'application/json'},body:JSON.stringify({kind:'spontaneous'})})).status,401);
  for(const actor of [sa,board,vol]){const denied=await fetch(base+'/api/presence/confirmations',{method:'POST',headers:{cookie:actor.cookie,'content-type':'application/json','x-presence-proof':'fake'},body:JSON.stringify({kind:'spontaneous'})});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'QR_REQUIRED')}
  const lockedConfig=await(await call('portal/display','GET',null,sa.cookie)).json();const opened=await call('portal/display/security','PUT',{enabled:false,revision:lockedConfig.revision,device_revision:lockedConfig.device_revision},sa.cookie);assert.equal(opened.status,200);const openedConfig=await opened.json();const publicRead=await fetch(base+'/api/display?shelter=huskvarna',{headers:{'X-Display-Key':qrKey}});assert.equal(publicRead.status,200);const publicOnly=await publicRead.json();assert.equal(publicOnly.presence,null);assert.equal(publicOnly.checkin,undefined);assert.equal(publicOnly.security_enabled,false);assert.equal((await fetch(base+'/api/display/confirm?shelter=huskvarna',{method:'POST',headers:{'X-Display-Key':qrKey,'content-type':'application/json'},body:JSON.stringify({choice:'a'.repeat(64)})})).status,403);assert.equal((await call('portal/display/security','PUT',{enabled:true,revision:openedConfig.revision,device_revision:openedConfig.device_revision},sa.cookie)).status,200);qrScreen=await(await displayGet('huskvarna','GET',qrKey)).json();
  assert.ok(qrScreen.checkin);assert.equal(qrScreen.checkin.day,qrScreen.today);
  const currentSlot=sa.data.slots.find(slot=>slot.date===qrScreen.today&&!slot.cancelled);
  assert.ok(currentSlot);{const screenSeed=new DatabaseSync(path.join(dir,'katthem.sqlite'));screenSeed.prepare('INSERT OR IGNORE INTO bookings(user_id,slot_id) VALUES(?,?)').run(vol.data.user.id,currentSlot.id);screenSeed.close();
   const screen=await(await displayGet('huskvarna','GET',qrKey)).json();const pick=screen.checkin.options.find(option=>option.label==='Volontär');assert.ok(pick);assert.equal(pick.booking_id,undefined);assert.equal(pick.user_id,undefined);
   const check=(choice,home='huskvarna',key=qrKey,extra={})=>fetch(base+'/api/display/confirm?shelter='+home,{method:'POST',headers:{'content-type':'application/json','X-Display-Key':key,cookie:displayCookie},body:JSON.stringify({choice,...extra})});
   assert.equal((await check(pick.choice,b)).status,404);assert.equal((await check(pick.choice,'huskvarna',qrKey,{user_id:1})).status,400);assert.equal((await check('a'.repeat(64))).status,409);
   assert.equal((await fetch(base+'/api/display/confirm?shelter=huskvarna',{method:'POST',headers:{'X-Display-Key':qrKey,'content-type':'application/json'},body:JSON.stringify({choice:pick.choice})})).status,403);
   const before=await(await call('state','GET',null,vol.cookie)).json();assert.equal((await check(pick.choice)).status,200);assert.equal((await check(pick.choice)).status,200);
   const after=await(await call('state','GET',null,vol.cookie)).json();assert.equal(after.modules.presence.mine.filter(row=>row.kind==='booked').length,1);assert.deepEqual(after.bookings,before.bookings);assert.deepEqual(after.user,{...before.user,last_presence_day:screen.today});
   const own=after.bookings.find(row=>row.slot_id===currentSlot.id);assert.equal((await call('bookings/'+own.id,'DELETE',null,sa.cookie)).status,200);assert.equal((await check(pick.choice)).status,409);
  }
  assert.equal((await fetch(base+'/api/_screen/booked',{method:'POST',headers:{cookie:sa.cookie,'content-type':'application/json'},body:JSON.stringify({booking_id:1})})).status,404);
  assert.equal((await call('presence/confirmations','POST',{kind:'spontaneous'},vol.cookie)).status,403);
  const scan=await call('presence/access','POST',{token:new URL(qrScreen.presence.link).hash.slice(9)},vol.cookie);assert.equal(scan.status,200,await scan.clone().text());
  assert.equal((await call('presence/access','POST',{token:'forged'},vol.cookie)).status,403);assert.equal((await call('presence/access','POST',{token:new URL(qrScreen.presence.link).hash.slice(9)},board.cookie)).status,200);
  const unchanged=await(await call('state','GET',null,vol.cookie)).json();
  const confirmation=await call('presence/confirmations','POST',{kind:'spontaneous'},vol.cookie);assert.equal(confirmation.status,200);assert.equal((await confirmation.json()).mine.length,1);
  const afterPresence=await(await call('state','GET',null,vol.cookie)).json();assert.deepEqual(afterPresence.user,unchanged.user);assert.deepEqual(afterPresence.bookings,unchanged.bookings);
  assert.equal((await call('presence/qr','GET',null,vol.cookie)).status,403);
  assert.equal((await call('presence/qr','GET',null,board.cookie)).status,403);
  assert.equal((await call('portal/display','DELETE',{revision:4},sa.cookie)).status,200);assert.equal((await call('presence/confirmations','POST',{kind:'spontaneous'},vol.cookie)).status,403);
  assert.equal((await call('presence/settings','PUT',{enabled:false,revision:1},sa.cookie)).status,200);
  assert.equal((await call('presence/settings','PUT',{enabled:false,revision:1},sa.cookie,b)).status,200);
  const weekStart=sa.data.slots[0].date,rangeQuery='schedule?start='+weekStart+'&end='+weekStart;
  assert.equal((await call(rangeQuery)).status,401);assert.equal((await call('schedule','GET',null,sa.cookie)).status,400);
  const scheduleResponse=await call(rangeQuery,'GET',null,vol.cookie),weekData=await scheduleResponse.json();assert.equal(scheduleResponse.status,200);assert.ok(weekData.slots.every(s=>s.date===weekStart||s.mine));assert.equal(weekData.members,undefined);assert.ok(weekData.bookings.every(b=>b.user_id===vol.data.user.id));
  assert.equal((await call(rangeQuery,'GET',null,vol.cookie,b)).status,403);
  assert.equal((await call('state','GET',null,board.cookie,b)).status,403);assert.equal((await call('state','GET',null,vol.cookie,b)).status,403);
  const aSettings=(await(await call('state','GET',null,board.cookie,'huskvarna')).json()).booking_settings;assert.equal(aSettings.recommended_limit,5);
  assert.equal((await call('booking-settings','PUT',{recommended_limit:6,revision:aSettings.revision},vol.cookie,'huskvarna')).status,403);
  assert.equal((await call('booking-settings','PUT',{recommended_limit:6,revision:aSettings.revision},board.cookie,'huskvarna')).status,200);
  assert.equal((await call('booking-settings','PUT',{recommended_limit:7,revision:aSettings.revision},board.cookie,'huskvarna')).status,409);
  assert.equal((await(await call('state','GET',null,sa.cookie,b)).json()).booking_settings.recommended_limit,5);
  assert.equal((await call('booking-settings','PUT',{recommended_limit:5,revision:aSettings.revision+1},board.cookie,'huskvarna')).status,200);
  let bs=await(await call('state','GET',null,sa.cookie,b)).json();assert.equal(bs.portal.selected,b);assert.equal(bs.volunteer_info.location,'B-gatan 10');assert.equal(bs.door_code.code,'');assert.ok(!bs.users.some(u=>u.email==='vol@example.se'));assert.ok(!bs.users.some(u=>u.email==='admin@katthem.local'));
  const brandB={...bs.branding,primary:'#334455'};assert.equal((await call('branding','PUT',brandB,vol.cookie,'huskvarna')).status,403);assert.equal((await call('branding','PUT',brandB,sa.cookie,b)).status,200);assert.equal((await(await call('branding','GET',null,undefined,b)).json()).primary,'#334455');assert.equal((await(await call('state','GET',null,sa.cookie,'huskvarna')).json()).branding.primary,sa.data.branding.primary);
  assert.equal((await call('door-code','PUT',{code:'B-CODE',revision:bs.door_code.revision},sa.cookie,b)).status,200);
  assert.equal((await call('news','POST',{title:'B-hemlig nyhet',body:'B-information',published:true,expires_at:Date.now()+86400000},sa.cookie,b)).status,200);
  const form={name:'Person B',email:'person-b@example.se',phone:'',address:'',member_number:'',member_since:'',status:'active',board_role:'none',board_title:'',responsibilities:'',note:'B-privat',birth_date:'',shelter:'Huskvarna',messenger_url:'',is_member:false,animal_care_trained:false,account:{role:'volunteer',password,active:true,green:false}};
  assert.equal((await call('volunteers','POST',form,sa.cookie,b)).status,200);
  // A link opened without a session must reset the account in its original shelter only.
  const resetDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite')),resetMessages=[];
  try{
   const resetService=createPasswordReset(resetDb,{appUrl:()=>base,status:()=>({configured:true}),send:async message=>resetMessages.push(message)},p=>'test-salt:'+scryptSync(p,'test-salt',64).toString('hex'),{shelterId:b});
   await resetService.request('person-b@example.se');
   const resetUrl=new URL(resetMessages[0].text.match(/http[^\s]+/)[0]);
   assert.equal(resetUrl.searchParams.get('shelter'),b);
   const resetToken=new URLSearchParams(resetUrl.hash.slice(1)).get('reset'),nextPassword=password+'-reset';
   assert.equal((await call('password-reset/confirm','POST',{token:resetToken,password:nextPassword})).status,400);
   assert.equal((await call('password-reset/confirm'+resetUrl.search,'POST',{token:resetToken,password:nextPassword})).status,200);
   assert.equal((await call('password-reset/confirm'+resetUrl.search,'POST',{token:resetToken,password:nextPassword})).status,400);
   credentials.set(b+':person-b@example.se',nextPassword);
   const verified=await login('person-b@example.se',b);assert.equal(verified.data.user.email,'person-b@example.se');
  }finally{resetDb.close()}
  let bagState=await(await call('state','GET',null,sa.cookie,b)).json(),bagProfile=bagState.members.find(m=>m.email==='person-b@example.se');assert.equal(bagProfile.volunteer_bag,false);const bagUpdate=await call('volunteers/'+bagProfile.id,'PUT',{...bagProfile,volunteer_bag:true,account:{role:'volunteer',active:true,green:false,password:''}},sa.cookie,b);assert.equal(bagUpdate.status,200,await bagUpdate.clone().text());assert.equal((await bagUpdate.json()).members.find(m=>m.id===bagProfile.id).volunteer_bag,true);
  const ownA=await(await call('state','GET',null,sa.cookie,'huskvarna')).json();assert.notEqual(ownA.door_code.code,'B-CODE');assert.ok(!JSON.stringify(ownA).includes('B-privat'));assert.ok(!JSON.stringify(ownA).includes('B-hemlig nyhet'));
  assert.equal((await call('volunteers','POST',{...form,name:'Lokal styrelse',email:'board@example.se',note:'',account:{...form.account,role:'admin'}},sa.cookie,b)).status,200);
  const boardProfileDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));boardProfileDb.prepare("UPDATE member_profiles SET board_role='secretary',phone='0701234567',messenger_url='https://m.me/board-test',birth_date='1990-01-01',note='A-PRIVATE-NOTE' WHERE user_id=2").run();boardProfileDb.close();
  // Board contact numbers can be edited without changing protected administrative account fields.
  const phoneState=await(await call('state','GET',null,board.cookie,'huskvarna')).json(),phoneProfile=phoneState.members.find(m=>m.user_id===2);
  assert.equal((await call('members/'+phoneProfile.id+'/phone','PATCH',{phone:'0701234567',revision:phoneProfile.revision},vol.cookie,'huskvarna')).status,403);
  assert.equal((await call('members/'+phoneProfile.id+'/phone','PATCH',{phone:'0701234567',revision:phoneProfile.revision},board.cookie,'huskvarna')).status,200);
  assert.equal((await call('members/'+phoneProfile.id+'/phone','PATCH',{phone:'stale',revision:phoneProfile.revision},sa.cookie,'huskvarna')).status,409);
  const visiblePhone=await(await call('state','GET',null,vol.cookie,'huskvarna')).json();assert.equal(visiblePhone.contacts.find(p=>p.id===phoneProfile.id).phone,'0701234567');assert.equal(visiblePhone.leadership.find(p=>p.id===phoneProfile.id).phone,'0701234567');assert.equal(visiblePhone.members,undefined);
  const rangeForStaffing='staffing?start=2026-01-01&end=2026-01-07';
  assert.equal((await call(rangeForStaffing,'GET',null,vol.cookie,'huskvarna')).status,403);
  assert.equal((await call(rangeForStaffing,'GET',null,board.cookie,b)).status,403);
  const grant={source:'huskvarna',user_id:2,target:b,role:'admin',enabled:true};assert.equal((await call('portal/manage/grants','POST',grant,sa.cookie)).status,200);
  const boardHome=(await(await call('state','GET',null,board.cookie)).json()).portal;
  assert.equal(boardHome.selected,'huskvarna');
  const listingDate=board.data.slots.find(slot=>!slot.cancelled).date;
  for(const home of ['huskvarna',b]){
   const summary=await call('staffing?start='+listingDate+'&end='+listingDate,'GET',null,board.cookie,home);
   assert.equal(summary.status,200);
   const staffingData=await summary.json();
   assert.ok(staffingData.slots.length);
   assert.ok(staffingData.slots.every(slot=>slot.date===listingDate&&Array.isArray(slot.people)));
   for(const slot of staffingData.slots)for(const person of slot.people)assert.deepEqual(Object.keys(person).sort(),['green','name']);
  }
  assert.equal((await(await call('state','GET',null,board.cookie)).json()).portal.selected,'huskvarna');

  const beforeBoardVisit=await(await call('state','GET',null,sa.cookie,b)).json(),sharedBoard=beforeBoardVisit.leadership.find(u=>u.name==='Styrelse A');assert.ok(sharedBoard,'Styrelsen ska synas innan personen själv öppnar målhemmet');assert.equal(sharedBoard.board_role,'secretary');assert.equal(sharedBoard.phone,'0701234567');assert.equal(sharedBoard.messenger_url,'https://m.me/board-test');const sharedPrivate=beforeBoardVisit.members.find(m=>m.id===sharedBoard.id)||beforeBoardVisit.members.find(m=>m.name==='Styrelse A');assert.ok(sharedPrivate);assert.notEqual(sharedPrivate.note,'A-PRIVATE-NOTE');assert.notEqual(sharedPrivate.birth_date,'1990-01-01');

  // A same-email local account requires an internal alias, but UI/contact email uses source identity.
  const aliasDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));
  const shadowAccount=beforeBoardVisit.users.find(u=>u.name==='Styrelse A'),internalEmail=aliasDb.prepare('SELECT email FROM users WHERE id=?').get(shadowAccount.id).email;
  assert.match(internalEmail,/^portal-[a-f0-9]{32}@access\.invalid$/);assert.equal(shadowAccount.email,'board@example.se');assert.equal(sharedPrivate.email,'board@example.se');
  assert.equal(beforeBoardVisit.members.find(m=>m.name==='Lokal styrelse').email,'board@example.se');
  const shadowEdit={...sharedPrivate,responsibilities:'Lokal kontakt',account:{role:shadowAccount.role,active:shadowAccount.active===1,green:false,password:''}};
  const savedShadow=await call('volunteers/'+sharedPrivate.id,'PUT',shadowEdit,sa.cookie,b);assert.equal(savedShadow.status,200,await savedShadow.clone().text());assert.equal((await savedShadow.json()).members.find(m=>m.id===sharedPrivate.id).email,'board@example.se');
  assert.equal(aliasDb.prepare('SELECT email FROM users WHERE id=?').get(shadowAccount.id).email,internalEmail);
  const badIdentity=await call('volunteers/'+sharedPrivate.id,'PUT',{...shadowEdit,email:'other@example.se'},sa.cookie,b);assert.equal(badIdentity.status,403);
  assert.equal(aliasDb.prepare("SELECT count(*) n FROM users WHERE email='board@example.se'").get().n,1);aliasDb.close();
  const targetBoardDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));targetBoardDb.prepare("UPDATE member_profiles SET board_role='chair' WHERE id=?").run(sharedBoard.id);targetBoardDb.close();const changedBoardDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));changedBoardDb.prepare("UPDATE member_profiles SET board_role='treasurer',phone='0709999999' WHERE user_id=2").run();changedBoardDb.close();const refreshedBoard=(await(await call('state','GET',null,sa.cookie,b)).json()).leadership.find(p=>p.id===sharedBoard.id);assert.equal(refreshedBoard.board_role,'chair','Lokalt ändrat styrelseuppdrag ska bevaras');assert.equal(refreshedBoard.phone,'0709999999','Delat telefonnummer ska uppdateras');
  bs=await(await call('state','GET',null,board.cookie,b)).json();assert.equal(bs.user.role,'admin');assert.equal(bs.user.email,'board@example.se');assert.equal(bs.my_profile.email,'board@example.se');assert.deepEqual(new Set(bs.portal.own_shelters.map(h=>h.id)),new Set(['huskvarna',b]));assert.ok(bs.portal.own_shelters.every(h=>h.member&&h.role==='admin'&&h.status==='active'));assert.equal(bs.portal.profile_identity_editable,false);assert.equal(bs.door_code.code,'B-CODE');assert.ok(bs.news.some(n=>n.title==='B-hemlig nyhet'));assert.ok(bs.members.some(m=>m.note==='B-privat'));assert.equal(bs.portal.global_superadmin,false);
  assert.equal((await call('portal/manage','GET',null,board.cookie,b)).status,403);assert.equal((await call('portal/select','POST',{shelter:b},vol.cookie)).status,403);assert.equal((await call('portal/select','POST',{shelter:b},board.cookie)).status,200);
  assert.equal((await(await call('state','GET',null,board.cookie)).json()).portal.selected,b);
  const date=new Date(Date.now()+86400000*3).toISOString().slice(0,10);assert.equal((await call('slots','POST',{date,start:'13:00',end:'14:00',title:'B-veterinär',kind:'event'},sa.cookie,b)).status,200);
  bs=await(await call('state','GET',null,board.cookie,b)).json();const slot=bs.slots.find(s=>s.title==='B-veterinär');assert.equal((await call('bookings','POST',{slotId:slot.id},board.cookie,b)).status,200);
  assert.equal((await call('portal/my-bookings')).status,401);
  const ownAcross=await(await call('portal/my-bookings','GET',null,board.cookie)).json();assert.ok(ownAcross.bookings.some(s=>s.shelter_id===b&&s.title==='B-veterinär'));assert.ok(ownAcross.bookings.every(s=>s.booking_id&&s.shelter_name));
  const ownFile=await call('portal/my-bookings/calendar','GET',null,board.cookie);assert.equal(ownFile.status,200);const ownIcs=await ownFile.text();assert.ok(ownIcs.includes('LOCATION:B-gatan 10'));assert.ok(ownIcs.includes('katthem-slot-'+b+'-'));
  const withoutGrant=await(await call('portal/my-bookings','GET',null,vol.cookie)).json();assert.ok(withoutGrant.bookings.every(s=>s.shelter_id==='huskvarna'));

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

  // New volunteers can self-book three introductions; the server handles series and concurrent requests atomically.
  const introVolunteer=await login('person-b@example.se',b),introUid=introVolunteer.data.user.id;
  const introSlots=[...new Map(introVolunteer.data.slots.filter(s=>s.kind==='regular'&&!s.cancelled&&new Date(s.date+'T'+s.start)>Date.now()+86400000*3).map(s=>[s.date,s])).values()].slice(0,10);
  const anchorSlot=introSlots.find(s=>new Date(s.date+'T12:00').getDay()!==0),untilDate=new Date(anchorSlot.date+'T12:00');untilDate.setDate(untilDate.getDate()+21);
  const until=untilDate.getFullYear()+'-'+String(untilDate.getMonth()+1).padStart(2,'0')+'-'+String(untilDate.getDate()).padStart(2,'0');
  const tooMany={slotId:anchorSlot.id,interval:1,until,preview:true};assert.equal((await call('bookings/recurring','POST',tooMany,introVolunteer.cookie,b)).status,409);
  const rawIntroDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));let oversizedPlan;
  try{oversizedPlan=createRecurringBookings(rawIntroDb).preview(introUid,tooMany)}finally{rawIntroDb.close()}
  assert.equal((await call('bookings/recurring','POST',{...tooMany,preview:false,key:oversizedPlan.key,confirmOverLimit:true},introVolunteer.cookie,b)).status,409);
  const beforeIntro=await(await call('state','GET',null,introVolunteer.cookie,b)).json();assert.equal(beforeIntro.bookings.length,0);
  for(const slot of introSlots.slice(0,2))assert.equal((await call('bookings','POST',{slotId:slot.id},introVolunteer.cookie,b)).status,200);
  const races=await Promise.all(introSlots.slice(2,4).map(slot=>call('bookings','POST',{slotId:slot.id},introVolunteer.cookie,b)));assert.deepEqual(races.map(r=>r.status).sort(),[200,409],JSON.stringify(await Promise.all(races.map(r=>r.clone().json()))));
  let introState=await(await call('state','GET',null,introVolunteer.cookie,b)).json();assert.equal(introState.user.engagement.intro_remaining,0);assert.equal(introState.bookings.length,3);
  const introDenied=await call('bookings','POST',{slotId:introSlots[4].id,confirmOverLimit:true},introVolunteer.cookie,b);assert.equal(introDenied.status,409);assert.equal((await introDenied.json()).code,'INTRODUCTION_LIMIT');
  assert.equal((await call('bookings/'+introState.bookings[0].id,'DELETE',null,introVolunteer.cookie,b)).status,200);assert.equal((await call('bookings','POST',{slotId:introSlots[4].id},introVolunteer.cookie,b)).status,200);
  assert.equal((await call('bookings','POST',{slotId:introSlots[5].id,userId:introUid},sa.cookie,b)).status,200);
  for(const item of checklistGroups.flatMap(g=>g.items))assert.equal((await call('checklist','PATCH',{item_id:item.id,checked:true},introVolunteer.cookie,b)).status,200);
  for(const cookie of [sa.cookie,sameEmail.cookie]){const notificationState=await(await call('state','GET',null,cookie,b)).json();assert.ok(notificationState.introduction_pending.some(u=>u.id===introUid))}
  assert.equal((await(await call('state','GET',null,introVolunteer.cookie,b)).json()).introduction_pending,undefined);
  assert.ok(!(await(await call('state','GET',null,sa.cookie,'huskvarna')).json()).introduction_pending.some(u=>u.name==='Person B'));
  assert.equal((await call('engagements/'+introUid+'/introduction','PATCH',{practical_completed:true,independent_approved:true},introVolunteer.cookie,b)).status,403);
  assert.equal((await call('engagements/'+introUid+'/introduction','PATCH',{practical_completed:true,independent_approved:true},sameEmail.cookie,b)).status,200);
  const introProfileState=await(await call('state','GET',null,sa.cookie,b)).json(),profileIntro=introProfileState.users.find(u=>u.id===introUid).engagement;
  assert.equal((await call('engagements/'+introUid+'/introduction-status','PATCH',{completed:false,revision:profileIntro.revision},sameEmail.cookie,b)).status,403);
  assert.equal((await call('engagements/'+introUid+'/introduction-status','PATCH',{completed:false,revision:profileIntro.revision},introVolunteer.cookie,b)).status,403);
  const unapproved=await call('engagements/'+introUid+'/introduction-status','PATCH',{completed:false,revision:profileIntro.revision},sa.cookie,b);assert.equal(unapproved.status,200);const fullIntroResponse=await unapproved.text();const reviewed=JSON.parse(fullIntroResponse).users.find(u=>u.id===introUid).engagement;assert.equal(reviewed.can_self_book,false);assert.equal(reviewed.intro_ready,false);assert.equal(reviewed.intro_review_required,1);
  const halted=await call('bookings','POST',{slotId:introSlots[5].id},introVolunteer.cookie,b);assert.equal(halted.status,409);assert.equal((await halted.json()).code,'INTRODUCTION_REVIEW');
  assert.equal((await call('engagements/'+introUid+'/introduction-status','PATCH',{completed:true,revision:profileIntro.revision},sa.cookie,b)).status,409);
  const approved=await call('engagements/'+introUid+'/introduction-status?response=compact','PATCH',{completed:true,revision:reviewed.revision},sa.cookie,b);assert.equal(approved.status,200);
  const compactIntroResponse=await approved.text(),compact=JSON.parse(compactIntroResponse),restored=compact.engagement;
  assert.deepEqual(Object.keys(compact).sort(),['engagement','id','introduction_pending']);
  assert.equal(compact.id,introUid);assert.equal(compact.introduction_pending,null);
  assert.ok(Buffer.byteLength(compactIntroResponse)<Buffer.byteLength(fullIntroResponse));
  t.diagnostic('Introduction response bytes (full / compact): '+Buffer.byteLength(fullIntroResponse)+' / '+Buffer.byteLength(compactIntroResponse));assert.equal(restored.intro_ready,true);assert.equal(restored.intro_review_required,0);
  const afterIntroProfile=await(await call('state','GET',null,sa.cookie,b)).json();assert.deepEqual(afterIntroProfile.bookings,introProfileState.bookings);assert.equal(afterIntroProfile.users.find(u=>u.id===introUid).checklist_complete,true);

  for(const cookie of [sa.cookie,sameEmail.cookie])assert.ok(!(await(await call('state','GET',null,cookie,b)).json()).introduction_pending.some(u=>u.id===introUid));
  assert.equal((await call('bookings','POST',{slotId:introSlots[6].id},introVolunteer.cookie,b)).status,200);
  // Transfer keeps the password and total shifts, requires cancellation, and resets the destination checklist.
  const sourceDb=new DatabaseSync(path.join(dir,'katthem.sqlite'));const past=Number(sourceDb.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind,extra_info) VALUES('2000-01-01','08:00','12:00','Tidigare pass',0,'',0,'regular','')").run().lastInsertRowid);sourceDb.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(3,past);for(const item of checklistGroups.flatMap(g=>g.items))sourceDb.prepare('INSERT OR IGNORE INTO checklist_progress VALUES(?,?)').run(3,item.id);sourceDb.prepare('UPDATE users SET green_manual=1 WHERE id=3').run();sourceDb.close();
  const c=(await(await call('portal/manage/shelters','POST',{name:'Katthem C',address:'C-gatan 2'},sa.cookie)).json()).id;
  assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:3,target:c,role:'volunteer',enabled:true},sa.cookie)).status,200);const cs=await(await call('state','GET',null,vol.cookie,c)).json(),cSlot=cs.slots.find(s=>!s.cancelled&&new Date(s.date+'T'+s.start)>Date.now()+86400000*2&&s.kind==='regular');assert.equal((await call('bookings','POST',{slotId:cSlot.id},vol.cookie,c)).status,200);assert.equal((await call('bookings','POST',{slotId:cSlot.id,userId:cs.user.id},sa.cookie,c)).status,409);const cDb=new DatabaseSync(path.join(dir,'shelters',c,'katthem.sqlite')),cPast=Number(cDb.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind,extra_info) VALUES('2000-01-02','08:00','12:00','Tidigare C-pass',0,'',0,'regular','')").run().lastInsertRowid);cDb.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(cs.user.id,cPast);cDb.close();
  const activeA=await(await call('state','GET',null,vol.cookie,'huskvarna')).json(),futureSlot=activeA.slots.find(s=>!s.cancelled&&new Date(s.date+'T'+s.start)>Date.now()+86400000*2&&s.kind==='regular');assert.ok(futureSlot);assert.equal((await call('bookings','POST',{slotId:futureSlot.id},vol.cookie,'huskvarna')).status,200);
  const moveFields={source:'huskvarna',user_id:3,target:b};assert.equal((await call('portal/manage/transfers/preview','POST',moveFields,board.cookie)).status,401);assert.equal((await call('portal/manage/transfers/preview','POST',moveFields,sameEmail.cookie,b)).status,403);
  let preview=await(await call('portal/manage/transfers/preview','POST',moveFields,sa.cookie)).json();assert.equal(preview.can_move,false);assert.equal(preview.future.length,2);assert.equal((await call('portal/manage/transfers','POST',{...moveFields,key:preview.key},sa.cookie)).status,409);
  const bookedA=await(await call('state','GET',null,vol.cookie,'huskvarna')).json(),futureBooking=bookedA.bookings.find(v=>v.slot_id===futureSlot.id);assert.equal((await call('bookings/'+futureBooking.id,'DELETE',null,vol.cookie,'huskvarna')).status,200);
  preview=await(await call('portal/manage/transfers/preview','POST',moveFields,sa.cookie)).json();assert.equal(preview.can_move,false);const cBooked=await(await call('state','GET',null,vol.cookie,c)).json(),cBooking=cBooked.bookings.find(v=>v.slot_id===cSlot.id);assert.equal((await call('bookings/'+cBooking.id,'DELETE',null,vol.cookie,c)).status,200);preview=await(await call('portal/manage/transfers/preview','POST',moveFields,sa.cookie)).json();assert.equal(preview.can_move,true);const rollbackDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));rollbackDb.exec("CREATE TRIGGER test_transfer_failure BEFORE INSERT ON member_profiles BEGIN SELECT RAISE(ABORT,'test rollback'); END");assert.equal((await call('portal/manage/transfers','POST',{...moveFields,key:preview.key},sa.cookie)).status,503);assert.equal((await(await call('state','GET',null,vol.cookie,'huskvarna')).json()).user.active,1);assert.equal(rollbackDb.prepare("SELECT COUNT(*) n FROM users WHERE email='vol@example.se'").get().n,0);rollbackDb.exec('DROP TRIGGER test_transfer_failure');rollbackDb.close();
  const moved=await call('portal/manage/transfers','POST',{...moveFields,key:preview.key},sa.cookie);assert.equal(moved.status,200,await moved.clone().text());assert.equal((await moved.json()).completed_shifts,2);
  assert.equal((await call('state','GET',null,vol.cookie,'huskvarna')).status,401);assert.equal((await call('users/3','PATCH',{active:true},sa.cookie,'huskvarna')).status,403);credentials.set(b+':vol@example.se',credentials.get('huskvarna:vol@example.se'));const relocated=await login('vol@example.se',b);assert.equal(relocated.data.user.completed_shifts,2);assert.equal(relocated.data.user.green,false);assert.equal(relocated.data.user.green_manual,true);assert.equal(relocated.data.checklist.checked_items.length,0);assert.equal(relocated.data.bookings.length,0);assert.equal((await call('state','GET',null,relocated.cookie,'huskvarna')).status,403);
  for(const item of checklistGroups.flatMap(g=>g.items))assert.equal((await call('checklist','PATCH',{item_id:item.id,checked:true},relocated.cookie,b)).status,200);assert.equal((await(await call('state','GET',null,relocated.cookie,b)).json()).user.green,true);
  const returnFields={source:b,user_id:relocated.data.user.id,target:'huskvarna'},backPreview=await(await call('portal/manage/transfers/preview','POST',returnFields,sa.cookie)).json();const back=await call('portal/manage/transfers','POST',{...returnFields,key:backPreview.key},sa.cookie);assert.equal(back.status,200,await back.clone().text());assert.equal((await back.json()).completed_shifts,2);const returned=await login('vol@example.se');assert.equal(returned.data.user.completed_shifts,2);assert.equal(returned.data.user.green,false);assert.equal(returned.data.checklist.checked_items.length,0);
  // Shared news target only the selected shelters, with immutable board visibility and role checks.
  const newsFields={title:'Systemuppdatering',body:'Gemensam information',expires_at:Date.now()+86400000,published:true,all_shelters:false,targets:[b]};assert.equal((await call('portal/manage/news','POST',newsFields,returned.cookie)).status,403);assert.equal((await call('portal/manage/news','POST',{...newsFields,expires_at:null},sa.cookie)).status,400);
  const posted=await call('portal/manage/news','POST',newsFields,sa.cookie);assert.equal(posted.status,200);const sharedId=(await posted.json()).id;let allNews=await(await call('state','GET',null,sa.cookie,b)).json();assert.ok(allNews.news.some(n=>n.id==='p'+sharedId));assert.ok(!(await(await call('state','GET',null,returned.cookie,'huskvarna')).json()).news.some(n=>n.id==='p'+sharedId));assert.equal((await call('portal/news/'+sharedId+'/dismiss','POST',{revision:0},returned.cookie,'huskvarna')).status,404);
  assert.equal((await call('portal/manage/news/'+sharedId,'PUT',{...newsFields,all_shelters:true,targets:[],revision:0},sa.cookie)).status,200);assert.equal((await call('portal/news/'+sharedId+'/dismiss','POST',{revision:1},returned.cookie,'huskvarna')).status,200);let boardNews=await(await call('state','GET',null,returned.cookie,'huskvarna')).json();assert.ok(!boardNews.news.some(n=>n.id==='p'+sharedId));assert.ok(boardNews.bulletin_board.some(n=>n.id==='p'+sharedId));assert.equal((await call('portal/manage/news/'+sharedId,'DELETE',{revision:1},returned.cookie)).status,403);assert.equal((await call('portal/manage/news/'+sharedId,'DELETE',{revision:1},sa.cookie)).status,200);

  // Admin transfers require admin rights in both homes; volunteer access and spoofed scope do not suffice.
  assert.equal((await call('users/2','PATCH',{active:true},sa.cookie,'huskvarna')).status,200);assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:2,target:b,role:'admin',enabled:false},sa.cookie)).status,200);const mover=await login('board@example.se');assert.equal((await call('portal/transfers','GET',null,mover.cookie)).status,403);
  const moverGrant={source:'huskvarna',user_id:2,target:b,role:'volunteer',enabled:true};assert.equal((await call('portal/manage/grants','POST',moverGrant,sa.cookie)).status,200);assert.equal((await call('portal/transfers','GET',null,mover.cookie)).status,403);assert.equal((await call('portal/manage/grants','POST',{...moverGrant,role:'admin'},sa.cookie)).status,200);
  const scoped=await(await call('portal/transfers','GET',null,mover.cookie)).json();assert.equal(scoped.shelters.length,2);assert.ok(!scoped.shelters.some(h=>h.id===c));assert.ok(scoped.users.every(u=>u.role==='volunteer'));
  const fresh=await call('volunteers','POST',{...form,name:'Flyttbar volontär',email:'movable@example.se',note:''},sa.cookie,'huskvarna');assert.equal(fresh.status,200);const freshId=(await fresh.json()).users.find(u=>u.email==='movable@example.se').id,adminMove={source:'huskvarna',user_id:freshId,target:b};
  assert.equal((await call('portal/transfers/preview','POST',{...adminMove,target:c,allowed_homes:['huskvarna',b,c]},mover.cookie)).status,403);assert.equal((await call('portal/transfers/preview','POST',{...adminMove,user_id:2,volunteers_only:false},mover.cookie)).status,403);
  const adminPreview=await call('portal/transfers/preview','POST',adminMove,mover.cookie);assert.equal(adminPreview.status,200);const adminPlan=await adminPreview.json();assert.equal((await call('portal/manage/grants','POST',moverGrant,sa.cookie)).status,200);assert.equal((await call('portal/transfers','POST',{...adminMove,key:adminPlan.key},mover.cookie)).status,403);assert.equal((await call('portal/manage/grants','POST',{...moverGrant,role:'admin'},sa.cookie)).status,200);
  const movedByAdmin=await call('portal/transfers','POST',{...adminMove,key:adminPlan.key},mover.cookie);assert.equal(movedByAdmin.status,200,await movedByAdmin.clone().text());const newHomeLogin=await login('movable@example.se',b);assert.equal(newHomeLogin.data.user.role,'volunteer');assert.equal(newHomeLogin.data.checklist.checked_items.length,0);assert.equal((await call('portal/manage','GET',null,mover.cookie)).status,403);
  // A purged source-home profile must not be recreated, and its shared login survives another active home.
  const lifeCreated=await call('volunteers','POST',{...form,name:'Lifecycle Test',email:'lifecycle@example.se',note:''},sa.cookie,'huskvarna');assert.equal(lifeCreated.status,200);const lifeId=(await lifeCreated.json()).users.find(u=>u.email==='lifecycle@example.se').id;
  assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:lifeId,target:b,role:'volunteer',enabled:true},sa.cookie)).status,200);
  const life=await login('lifecycle@example.se');let ls=await(await call('state','GET',null,life.cookie,b)).json();const lifeB=ls.user.id;
  assert.equal((await call('portal/engagement','PATCH',{status:'ended',scope:'one',revision:life.data.user.engagement.revision},life.cookie,'huskvarna')).status,200);
  const lifeAData=new DatabaseSync(path.join(dir,'katthem.sqlite'));lifeAData.prepare('UPDATE engagements SET purge_after=1 WHERE user_id=?').run(lifeId);await portal.maintenance();
  assert.equal(lifeAData.prepare('SELECT COUNT(*) n FROM member_profiles WHERE user_id=?').get(lifeId).n,0);assert.equal(lifeAData.prepare('SELECT active FROM users WHERE id=?').get(lifeId).active,1);
  const lifeAgain=await login('lifecycle@example.se');assert.equal(lifeAgain.data.redirect_home,true);ls=await(await call('state','GET',null,lifeAgain.cookie)).json();assert.equal(ls.portal.selected,b);assert.equal(ls.user.id,lifeB);assert.deepEqual(ls.portal.own_shelters.map(h=>h.id),[b]);assert.equal((await call('state','GET',null,lifeAgain.cookie,'huskvarna')).status,403);
  const adminRoster=await(await call('state','GET',null,sa.cookie,'huskvarna')).json();assert.ok(!adminRoster.users.some(u=>u.id===lifeId));assert.equal(lifeAData.prepare('SELECT COUNT(*) n FROM member_profiles WHERE user_id=?').get(lifeId).n,0);
  assert.equal((await call('portal/engagement','PATCH',{status:'ended',scope:'one',revision:ls.user.engagement.revision},lifeAgain.cookie,b)).status,200);const lifeBData=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));lifeBData.prepare('UPDATE engagements SET purge_after=1 WHERE user_id=?').run(lifeB);await portal.maintenance();assert.equal(lifeAData.prepare('SELECT active FROM users WHERE id=?').get(lifeId).active,0);assert.equal((await call('login','POST',{email:'lifecycle@example.se',password,portal_shelter:'huskvarna'})).status,401);lifeAData.close();lifeBData.close();
  // Renaming is restricted, survives restart, and never moves accounts or bookings.
  const beforeRename=await(await call('state','GET',null,sa.cookie,b)).json(),oldName=beforeRename.shelter.name,renameRoute='portal/manage/shelters/'+b;
  assert.equal((await call(renameRoute,'PATCH',{name:'Nytt',previous_name:oldName})).status,401);
  assert.equal((await call(renameRoute,'PATCH',{name:'Nytt',previous_name:oldName},sameEmail.cookie)).status,403);
  assert.equal((await call(renameRoute,'PATCH',{name:'Nytt',previous_name:oldName},newHomeLogin.cookie)).status,403);
  for(const name of ['', '   ', 'x'.repeat(101), 'Fel\nnamn'])assert.equal((await call(renameRoute,'PATCH',{name,previous_name:oldName},sa.cookie)).status,400);
  assert.equal((await call(renameRoute,'PATCH',{name:'Huskvarna / Jönköping',previous_name:oldName},sa.cookie)).status,400);
  assert.equal((await call('portal/manage/shelters/missing','PATCH',{name:'Nytt',previous_name:'Saknas'},sa.cookie)).status,404);
  assert.equal((await call(renameRoute,'PATCH',{name:'Nytt',previous_name:'Inaktuellt'},sa.cookie)).status,409);
  const newName='Ådala katthem & jourhem';assert.equal((await call(renameRoute,'PATCH',{name:' '+newName+' ',previous_name:oldName},sa.cookie)).status,200);
  const afterRename=await(await call('state','GET',null,sa.cookie,b)).json();assert.equal(afterRename.shelter.name,newName);assert.equal(afterRename.shelter_admin.name,newName);assert.equal(afterRename.portal.selected,b);assert.ok(afterRename.members.every(m=>m.shelter===newName));
  assert.deepEqual(afterRename.bookings,beforeRename.bookings);assert.deepEqual(afterRename.users,beforeRename.users);assert.deepEqual(afterRename.volunteer_info,beforeRename.volunteer_info);assert.deepEqual(afterRename.door_code,beforeRename.door_code);
  assert.equal((await(await call('portal')).json()).shelters.find(h=>h.id===b).name,newName);
  assert.equal((await call(renameRoute,'PATCH',{name:'Förlorad ändring',previous_name:oldName},sa.cookie)).status,409);
  const savedProfile=await call('volunteers','POST',{...form,name:'Efter namnbyte',email:'after-rename@example.se'},sa.cookie,b);assert.equal(savedProfile.status,200);
  const renamedDb=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));assert.equal(renamedDb.prepare('SELECT shelter FROM member_profiles WHERE email=?').get('after-rename@example.se').shelter,newName);renamedDb.close();
  const sharedState=async()=>(await(await call('state','GET',null,sa.cookie,'huskvarna')).json()).portal.settings_homes;
  const sharedRevisions=async setting=>Object.fromEntries((await sharedState()).map(home=>[home.id,home[setting]]));
  const shared=(setting,values,revisions,cookie=sa.cookie)=>call('portal/manage/shared-settings/'+setting,'PUT',{values,revisions},cookie);
  const branding=await(await call('branding','GET',null,sa.cookie,'huskvarna')).json();
  const brandingValues={...branding,primary:'#012a5e'};
  const brandingRevisions=await sharedRevisions('branding');
  assert.equal((await shared('branding',brandingValues,brandingRevisions,board.cookie)).status,403);
  assert.equal((await shared('branding',brandingValues,{...brandingRevisions,[b]:999})).status,409);
  assert.deepEqual(await sharedRevisions('branding'),brandingRevisions);
  assert.equal((await shared('branding',brandingValues,brandingRevisions)).status,200);
  for(const home of ['huskvarna',b])assert.equal((await(await call('branding','GET',null,sa.cookie,home)).json()).primary,'#012a5e');

  assert.equal((await shared('presence',{enabled:true},await sharedRevisions('presence'))).status,200);
  for(const home of ['huskvarna',b])assert.equal((await(await call('state','GET',null,sa.cookie,home)).json()).modules.presence.enabled,true);
  assert.equal((await shared('presence',{enabled:false},await sharedRevisions('presence'))).status,200);
  for(const home of ['huskvarna',b])assert.equal((await(await call('state','GET',null,sa.cookie,home)).json()).modules.presence.enabled,false);

  const mail={gmail_address:'shared@gmail.com',app_password:'abcdefghijklmnop',app_url:base,enabled:true,csv_enabled:true,csv_interval:'monthly'};
  const mailRevisions=await sharedRevisions('email');
  assert.equal((await shared('email',mail,{...mailRevisions,[b]:999})).status,409);
  assert.deepEqual(await sharedRevisions('email'),mailRevisions);
  const mailSave=await shared('email',mail,mailRevisions);
  assert.equal(mailSave.status,200,await mailSave.text());
  for(const home of ['huskvarna',b]){
   const config=await(await call('email-settings','GET',null,sa.cookie,home)).json();
   assert.equal(config.gmail_address,mail.gmail_address);
   assert.equal(config.csv_interval,'monthly');
   assert.equal(config.csv_export_status.enabled,true);
   assert.equal(config.password_saved,true);
   assert.equal(config.app_password,undefined);
  }
  await portal.close();portal=null;portal=await createPortal({dataDir:dir,port:Number(new URL(base).port),env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});
  assert.equal((await(await call('portal')).json()).shelters.find(h=>h.id===b).name,newName);assert.equal((await(await call('state','GET',null,sa.cookie,b)).json()).shelter_admin.name,newName);
  // Operational tools are scoped and privileged; failed writes never enter the audit history.
  assert.equal((await call('portal/audit')).status,401);assert.equal((await call('portal/audit','GET',null,newHomeLogin.cookie,b)).status,403);
  const history=(await(await call('portal/audit','GET',null,sameEmail.cookie,b)).json()).entries;assert.ok(history.some(e=>e.action==='introduction.approved'));assert.ok(history.some(e=>e.action==='shelter.renamed'));assert.ok(history.every(e=>e.home===b&&e.actor_name));
  assert.equal((await call('booking-settings','PUT',{recommended_limit:0,revision:0},sameEmail.cookie,b)).status,400);assert.equal((await(await call('portal/audit','GET',null,sameEmail.cookie,b)).json()).entries.length,history.length);
  assert.equal((await call('portal/manage/backups','GET',null,sameEmail.cookie)).status,403);assert.equal((await call('portal/manage/backups','POST',{},newHomeLogin.cookie)).status,403);
  const copyResponse=await call('portal/manage/backups','POST',{},sa.cookie);assert.equal(copyResponse.status,200,await copyResponse.clone().text());const copy=await copyResponse.json();assert.ok(copy.verified_at);
  const backupStatus=await(await call('portal/manage/backups','GET',null,sa.cookie)).json();assert.equal(backupStatus.copies.length,1);assert.ok(backupStatus.last_success);assert.equal(backupStatus.automatic_enabled,false);
  assert.equal((await call('portal/manage/backups/verify','POST',{id:copy.id},sa.cookie)).status,200);assert.equal((await call('portal/manage/backups/verify','POST',{id:'../invalid'},sa.cookie)).status,404);
  const downloadRoute='portal/manage/backups/'+copy.id+'/download';assert.equal((await call(downloadRoute)).status,401);assert.equal((await call(downloadRoute,'GET',null,sameEmail.cookie)).status,403);assert.equal((await call(downloadRoute,'GET',null,newHomeLogin.cookie)).status,403);
  assert.equal((await call('portal/manage/backups/backup-0000000000000-000000000000/download','GET',null,sa.cookie)).status,404);
  const download=await call(downloadRoute,'GET',null,sa.cookie);assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/application\/zip/);assert.match(download.headers.get('content-disposition'),/attachment; filename="katthem-backup-/);assert.equal(download.headers.get('cache-control'),'no-store');const zipBytes=Buffer.from(await download.arrayBuffer());assert.equal(zipBytes.readUInt32LE(0),0x04034b50);
  // The audit is recorded after the response stream finishes on the server.
  let downloadLogged=false;for(let attempt=0;attempt<30;attempt++){downloadLogged=(await(await call('portal/audit','GET',null,sa.cookie)).json()).entries.some(e=>e.action==='backup.downloaded');if(downloadLogged)break;await new Promise(resolve=>setTimeout(resolve,50))}assert.ok(downloadLogged);

  // The age rule follows the source account without copying its private birth date to the shadow.
  const agePersonResponse=await call('users','POST',{name:'Ung med åtkomst',email:'young-cross@example.se',password},sa.cookie,'huskvarna');assert.equal(agePersonResponse.status,200);const agePerson=(await agePersonResponse.json()).users.find(u=>u.email==='young-cross@example.se');
  const ageSource=new DatabaseSync(path.join(dir,'katthem.sqlite'));try{ageSource.prepare('UPDATE member_profiles SET birth_date=? WHERE user_id=?').run(String(new Date().getFullYear()-16)+'-01-01',agePerson.id)}finally{ageSource.close()}
  assert.equal((await call('portal/manage/grants','POST',{source:'huskvarna',user_id:agePerson.id,target:b,role:'volunteer',enabled:true},sa.cookie)).status,200);
  const ageRegistry=new DatabaseSync(path.join(dir,'shelters.sqlite'));const ageShadow=ageRegistry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get('huskvarna',agePerson.id,b);ageRegistry.close();assert.ok(ageShadow);
  const crossState=await(await call('state','GET',null,sa.cookie,b)).json(),crossSlot=crossState.slots.find(s=>!s.cancelled&&new Date(s.date+'T'+s.start)>new Date()&&!s.booked);assert.ok(crossSlot);assert.equal(crossState.members.find(m=>m.user_id===ageShadow.local_id).birth_date,'');
  const crossBlocked=await call('bookings','POST',{slotId:crossSlot.id,userId:ageShadow.local_id},sa.cookie,b);assert.equal(crossBlocked.status,409);assert.equal((await crossBlocked.json()).code,'ADULT_REQUIRED');
  const ageTarget=new DatabaseSync(path.join(dir,'shelters',b,'katthem.sqlite'));try{ageTarget.prepare("UPDATE member_profiles SET birth_date='1980-01-01' WHERE user_id=?").run(ageShadow.local_id)}finally{ageTarget.close()}
  assert.equal((await call('bookings','POST',{slotId:crossSlot.id,userId:ageShadow.local_id},sa.cookie,b)).status,409);
  const registry=new DatabaseSync(path.join(dir,'shelters.sqlite'));assert.equal(registry.prepare('SELECT COUNT(*) n FROM shelters').get().n,3);registry.close();
 }finally{if(portal)await portal.close();rmSync(dir,{recursive:true,force:true})}
});
