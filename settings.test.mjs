import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createBranding,contrast} from './branding.mjs';import {initPasswordPolicy,requiresPasswordChange,setPasswordChange,temporaryPassword} from './password-policy.mjs';import {createMembers} from './members.mjs';
test('Lösenordsbyte: befintliga hashvärden bevaras, lokalundantag, beständig engångsmigrering och nya konton',()=>{const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,password TEXT);INSERT INTO users VALUES(1,'vol@example.se','original-hash'),(2,'admin@KATTHEM.LOCAL','local-hash')");initPasswordPolicy(db);const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);assert.equal(user(1).password,'original-hash');assert.equal(requiresPasswordChange(user(1)),true);assert.equal(requiresPasswordChange(user(2)),false);setPasswordChange(db,1,false);initPasswordPolicy(db);assert.equal(requiresPasswordChange(user(1)),false);db.exec("INSERT INTO users(id,email,password) VALUES(3,'ny@example.se','new-hash')");assert.equal(requiresPasswordChange(user(3)),true);setPasswordChange(db,1,true);assert.equal(requiresPasswordChange(user(1)),true)}finally{db.close()}});
test('Tillfälliga lösenord: unika, slumpade och utan gemensamt standardlösenord',()=>{const values=Array.from({length:100},temporaryPassword);assert.equal(new Set(values).size,100);assert.ok(values.every(p=>p.length>=20&&p!=='Katthemm1!'))});
test('Grafisk profil: separata katthem, beständighet, samtidighet, kontrast och säkra logotyper',()=>{const a=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');try{const one=createBranding(a),two=createBranding(b),original=one.get();const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xKsAAAAASUVORK5CYII=';one.save({...original,primary:'#234567',logo});assert.equal(createBranding(a).get().logo,logo);assert.equal(two.get().primary,original.primary);assert.throws(()=>one.save(original),e=>e.status===409);assert.throws(()=>one.save({...one.get(),logo:'data:image/svg+xml;base64,PHN2Zz4='}),/PNG/);assert.throws(()=>one.save({...one.get(),logo:'https://evil.test/logo.png'}),/PNG/);assert.throws(()=>one.save({...one.get(),logo:'data:image/png;base64,ZXZpbA=='}),/filformat/);assert.throws(()=>one.save({...one.get(),text:'#ffffff',background:'#ffffff'}),/kontrast/);assert.throws(()=>one.save({...one.get(),primary:'red;url(evil)'}),/färger/);one.save({...one.get(),logo:''});assert.equal(one.get().logo,'');assert.ok(contrast('#000000','#ffffff')>20)}finally{a.close();b.close()}});
test('Volontärspåse: standardvärde, sparning, avmarkering och validering',()=>{const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT)');const m=createMembers(db),p={name:'Volontär',email:'test@example.se',phone:'',status:'active',board_role:'none',board_title:'',responsibilities:'',note:'',birth_date:'',shelter:'',messenger_url:'',animal_care_trained:false};const id=m.save(null,p);assert.equal(m.list()[0].volunteer_bag,false);m.save(id,{...m.list()[0],volunteer_bag:true});assert.equal(m.list()[0].volunteer_bag,true);assert.equal(createMembers(db).list()[0].volunteer_bag,true);assert.throws(()=>m.save(id,{...m.list()[0],volunteer_bag:'ja'}),/volontärspåsen/);m.save(id,{...m.list()[0],volunteer_bag:false});assert.equal(m.list()[0].volunteer_bag,false)}finally{db.close()}});
import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('Lösenordsbytesvyn visas före schema och administration utan andra personuppgifter',()=>{const elements=new Map(),el=()=>({innerHTML:'',style:{},querySelectorAll:()=>[],querySelector:()=>({}),showModal(){this.open=true},close(){this.open=false}}),document={addEventListener(){},querySelector(s){if(!elements.has(s))elements.set(s,el());return elements.get(s)}};const context=vm.createContext({document,Date,setTimeout,setInterval:()=>0,URL,URLSearchParams,window:{location:{hash:'',search:''},addEventListener(){}},fetch:()=>new Promise(()=>{})});vm.runInContext(readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),context);vm.runInContext("state={password_change_required:true,user:{id:1,name:'Volontär <Test>',email:'test@example.se',role:'superadmin'}};render()",context);const html=elements.get('#app').innerHTML;assert.match(html,/Välj ett eget lösenord/);assert.match(html,/Volontär &lt;Test&gt;/);assert.match(html,/autocomplete="current-password"/);assert.match(html,/name="confirm"/);assert.doesNotMatch(html,/Veckoschema|Hantera katthem|Dörrkod|member-card/)});

test('Logotypvisning: vita/transparenta marginaler jämnas ut utan att klippa motivets kant',()=>{
 const app=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),source=app.slice(app.indexOf('function logoContentBounds('),app.indexOf('function normalizeBrandLogos('));
 const pixels=new Uint8ClampedArray(10*10*4).fill(255);for(let y=2;y<8;y++)for(let x=3;x<7;x++){const i=(y*10+x)*4;pixels.set([1,42,94,255],i)}
 const bounds=vm.runInNewContext(source+';logoContentBounds(pixels,10,10)',{pixels});assert.deepEqual(JSON.parse(JSON.stringify(bounds)),{x:2,y:1,width:6,height:8,canvasWidth:10,canvasHeight:10});
 const transparent=new Uint8ClampedArray(10*10*4);assert.equal(vm.runInNewContext(source+';logoContentBounds(pixels,10,10)',{pixels:transparent}),null);transparent.set([1,42,94,255],0);
 const edge=vm.runInNewContext(source+';logoContentBounds(pixels,10,10)',{pixels:transparent});assert.equal(edge.x,0);assert.equal(edge.y,0);assert.equal(edge.width,2);assert.equal(edge.height,2);
});


test('Menygrupper: rollstyrning och konto längst ned utan dubbla menyval',()=>{
 const app=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),source=app.slice(app.indexOf('function menuIcon('),app.indexOf('function administrationPage('));
 const context=vm.createContext({state:{user:{name:'Testvolontär',role:'volunteer'},members_enabled:true},view:'home',isAdmin:u=>['admin','superadmin'].includes(u.role),esc:s=>String(s),roleLabel:s=>s});vm.runInContext(source,context);
 for(const role of ['volunteer','admin','superadmin']){
  context.state.user.role=role;
  const groups=JSON.parse(JSON.stringify(vm.runInContext('navigationGroups()',context))),html=vm.runInContext('navigationMarkup()',context),keys=groups.flatMap(g=>g.items.map(item=>item[0]));
  assert.deepEqual(keys.slice(0,3),['home','schedule','mine']);assert.equal(new Set(keys).size,keys.length);assert.ok(!keys.includes('account'));
  assert.equal(groups.some(g=>g.id==='administration'),role!=='volunteer');
  assert.equal(groups.find(g=>g.id==='information').items.some(item=>item[0]==='members'),role==='volunteer');
  assert.ok(html.indexOf('data-view="account"')>html.indexOf('class="side-bottom"'));assert.equal((html.match(/data-view="account"/g)||[]).length,1);assert.match(html,/data-action="logout"/);assert.match(html,/aria-current="page"/);assert.match(html,/class="menu-icon"/);
 }
});

test('60-dagarsmejl: granskas före aktivering, skickas en gång per uppehåll och kan bekräftas',async()=>{
 const {createActivityFollowup}=await import('./activity.mjs');
 const db=new DatabaseSync(':memory:');
 const day=86400000;
 let time=100*day,canSend=true,failNext=true;
 const sent=[],completed=new Map();
 const mailProvider={status:()=>({configured:canSend}),appUrl:()=>'https://example.se/?shelter=a',
  send:async message=>{sent.push(message);if(failNext){failNext=false;throw Error('Tillfälligt fel')}}};
 try{
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT,active INTEGER,created_at INTEGER);
   CREATE TABLE engagements(user_id INTEGER PRIMARY KEY,status TEXT,changed_at INTEGER);
   INSERT INTO users VALUES(1,'Anna','anna@example.se','volunteer',1,${40*day}),(2,'Bo','bo@example.se','volunteer',1,${41*day}),
   (3,'Cia','cia@example.se','volunteer',1,0),(4,'Dan','dan@example.se','admin',1,0);
   INSERT INTO engagements VALUES(1,'active',0),(2,'active',0),(3,'paused',0),(4,'active',0)`);
  let followup=createActivityFollowup(db,{mailProvider,lastCompleted:()=>completed,shelterName:()=>'Huskvarna',now:()=>time});
  await followup.run();
  assert.equal(sent.length,0);
  const preview=followup.status();
  assert.deepEqual(preview.recipients.map(p=>p.id),[1]);
  canSend=false;
  assert.throws(()=>followup.save({...preview,enabled:true}),/Aktivera.*e-post/);
  canSend=true;
  assert.throws(()=>followup.save({...preview,signature:'changed',enabled:true}),{status:409});
  followup.save({...preview,enabled:true});
  await followup.run();
  await followup.run();
  assert.equal(sent.length,1);
  assert.equal(followup.own(1),null);
  time+=300000;
  followup=createActivityFollowup(db,{mailProvider,lastCompleted:()=>completed,shelterName:()=>'Huskvarna',now:()=>time});
  await followup.run();
  assert.equal(sent.length,2);
  assert.equal(sent[0].key,sent[1].key);
  assert.match(sent[1].text,/example\.se\/\?shelter=a#engagemang/);
  assert.throws(()=>followup.confirm(2,time),{status:409});
  assert.equal(followup.confirm(1,time).confirmed_at,time);
  assert.equal(followup.status().history[0].confirmed_at,time);
  await followup.run();
  assert.equal(sent.length,2);
  completed.set(1,time);
  time+=60*day;
  await followup.run();
  assert.notEqual(sent.findLast(m=>m.to==='anna@example.se').key,sent[1].key);
  assert.equal(followup.own(1).confirmed_at,null);
 }finally{db.close()}
});
