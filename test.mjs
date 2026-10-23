import {test} from 'node:test';
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
 const results=await Promise.all([call('bookings','POST',{slotId:slot.id},vc),call('bookings','POST',{slotId:slot.id,userId:uid},ac)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 let s=await(await call('state','GET',null,ac)).json();assert.equal(s.slots.find(x=>x.id===slot.id).booked,1);const booking=s.bookings.find(b=>b.slot_id===slot.id);
 assert.equal((await call('bookings','POST',{slotId:slot.id,userId:booking.user_id},ac)).status,409);
 const csv=await call('export','GET',null,ac);assert.match(await csv.text(),/Testpass/);
 await stop();await start();s=await(await call('state','GET',null,ac)).json();assert.equal(s.slots.find(x=>x.id===slot.id).booked,1);
 assert.equal((await call('bookings/'+booking.id,'DELETE',null,ac)).status,200);
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
