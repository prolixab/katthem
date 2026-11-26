import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {planShelterImport,previewShelterImport,executeShelterImport} from './shelter-import.mjs';
import {createPortal} from './portal.mjs';
const homes=[{id:'huskvarna',name:'Huskvarna'},{id:'varnamo',name:'Värnamo'}],context={homes,selected:'huskvarna',global:true};
test('Katthemsimport: exakt matchning, alias, manuella val och behörigheter',()=>{
 const p={csv:'namn;e-post;katthem\nAnna;anna@test.local;Jönköping\nErik;erik@test.local;Värnamo\nOklart;oklart@test.local;\nOkänd;okand@test.local;Saknas',green:false};
 const selected=planShelterImport(p,{...context,global:false});assert.equal(selected.groups[0].rows[0].name,'Anna');assert.equal(selected.skipped[0].reason,'other_shelter');assert.equal(selected.unresolved.length,2);
 assert.throws(()=>planShelterImport({...p,mode:'distributed'},{...context,global:false}),{status:403});assert.throws(()=>planShelterImport({...p,mapping:{'':'varnamo'}},{...context,global:false}),{status:403});
 const resolved=planShelterImport({...p,mode:'distributed',mapping:{'':'huskvarna',Saknas:'skip'}},context);assert.equal(resolved.groups.length,2);assert.equal(resolved.unresolved.length,0);assert.equal(resolved.skipped[0].reason,'user_skip');
 const legacy=planShelterImport({csv:'namn;e-post\nAnna;anna@test.local',green:false},context);assert.equal(legacy.unresolved[0].value,'');
});
test('Katthemsimport: förhandsvisning döljer lösenord och delresultat kan följas upp',async()=>{
 const p={csv:'namn;e-post;katthem;lösenord\nAnna;anna@test.local;Huskvarna;TmpPassword12345\nErik;erik@test.local;Värnamo;TmpPassword12345',green:false,mode:'distributed'};
 const request=async(home,action)=>{if(action==='import-preview')return {users:[],skipped:[]};if(home==='varnamo')throw Error('Tillfälligt fel');return {import_result:{imported:1,skipped:[]}}};
 const preview=(await previewShelterImport(p,context,request)).preview;assert.equal(preview.users.length,2);assert.ok(!JSON.stringify(preview).includes('TmpPassword'));assert.ok(preview.users.every(u=>!('password' in u)));
 const result=await executeShelterImport(p,context,request);assert.equal(result.imported,1);assert.equal(result.errors.length,1);assert.equal(result.errors[0].shelter_name,'Värnamo');
 await assert.rejects(()=>executeShelterImport({csv:'namn;e-post\nA;a@test.local',green:false},context,request),{status:409});
});
test('Katthemsimport: admin är lokal, SA kan fördela och återförsök ändrar inga konton',{timeout:120000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'katthem-shelter-import-')),password='ImportTest12345',hash='salt:'+scryptSync(password,'salt',64).toString('hex'),seed=new DatabaseSync(path.join(dir,'katthem.sqlite'));
 seed.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,active INTEGER DEFAULT 1)");for(const [id,role] of [[1,'superadmin'],[2,'admin'],[3,'volunteer'],[4,'coordinator']])seed.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(id,'Person '+id,'person'+id+'@test.local',hash,role);seed.close();let portal;
 try{portal=await createPortal({dataDir:dir,port:0,env:{...process.env,NODE_ENV:'test',APP_URL:'',RESEND_API_KEY:'',EMAIL_FROM:'',BOOTSTRAP_SUPERADMIN_EMAIL:''}});const base='http://127.0.0.1:'+portal.server.address().port;
 const call=(route,method='GET',body,cookie,home)=>fetch(base+'/api/'+route,{method,headers:{...(cookie?{cookie}:{}),...(home?{'X-Katthem':home}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const login=async id=>{const r=await call('login','POST',{email:'person'+id+'@test.local',password});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 const sa=await login(1),admin=await login(2),vol=await login(3),coord=await login(4),home=(await(await call('portal/manage/shelters','POST',{name:'Värnamo',address:'B-gatan'},sa)).json()).id;
 const p={csv:'namn;e-post;katthem;grön\nAnna;anna@import.local;Huskvarna;ja\nErik;erik@import.local;Värnamo;nej\nSara;sara@import.local;Jönköping;nej\nOkänd;okand@import.local;Småland;nej\nSaknad;saknad@import.local;;nej\nAnna igen;anna@import.local;Huskvarna;nej',green:false};
 assert.equal((await call('portal/import-preview','POST',p)).status,401);for(const cookie of [vol,coord])assert.equal((await call('portal/import-preview','POST',p,cookie)).status,403);
 assert.equal((await call('portal/import-preview','POST',{...p,mode:'distributed'},admin)).status,403);
 let r=await call('portal/import-preview','POST',p,admin);assert.equal(r.status,200);let preview=await r.json();assert.equal(preview.users.length,2);assert.equal(preview.unresolved.length,2);assert.ok(preview.skipped.some(e=>e.reason==='other_shelter'));assert.ok(preview.users.every(e=>e.shelter_name==='Huskvarna'));
 assert.equal((await call('portal/import','POST',p,admin)).status,409);assert.ok(!(await(await call('state','GET',null,admin)).json()).users.some(u=>u.email==='anna@import.local'));
 assert.equal((await call('users/import','POST',p,admin)).status,400);
 assert.equal((await call('portal/import-preview','POST',{...p,mapping:{'':home}},admin)).status,403);
 const resolved={...p,mapping:{'':'huskvarna',Småland:'skip'}};r=await call('portal/import','POST',resolved,admin);assert.equal(r.status,200);let result=await r.json();assert.equal(result.imported,3);assert.equal(result.skipped.length,3);assert.equal(result.errors.length,0);
 const after=(await(await call('state','GET',null,admin)).json()).users;assert.equal(after.find(u=>u.email==='anna@import.local').green,false);assert.equal(after.find(u=>u.email==='anna@import.local').green_manual,true);assert.ok(!after.some(u=>u.email==='erik@import.local'));
 const distributed={...resolved,mode:'distributed'};r=await call('portal/import-preview','POST',distributed,sa);preview=await r.json();assert.equal(preview.users.length,1);assert.equal(preview.users[0].shelter_id,home);
 r=await call('portal/import','POST',distributed,sa);result=await r.json();assert.equal(result.imported,1);assert.equal(result.errors.length,0);const other=(await(await call('state','GET',null,sa,home)).json()).users;assert.ok(other.some(u=>u.email==='erik@import.local'));assert.ok(!other.some(u=>u.email==='anna@import.local'));
 r=await call('portal/import','POST',distributed,sa,'huskvarna');assert.equal((await r.json()).imported,0);
 const changed={...distributed,csv:distributed.csv.replace('Anna;','Bytt namn;')};await call('portal/import','POST',changed,sa,'huskvarna');assert.equal((await(await call('state','GET',null,admin,'huskvarna')).json()).users.find(u=>u.email==='anna@import.local').name,'Anna');
 }finally{await portal?.close();rmSync(dir,{recursive:true,force:true})}
});
