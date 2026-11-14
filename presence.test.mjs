import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPresence,presenceModule} from './presence.mjs';
import {createAudit} from './audit.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,active INTEGER);
 CREATE TABLE engagements(user_id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,title TEXT,cancelled INTEGER);
 CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),slot_id INTEGER REFERENCES slots(id));
 INSERT INTO users VALUES(1,'Anna',1),(2,'Bo',1),(3,'Cia',0);
 INSERT INTO engagements VALUES(1,'active'),(2,'active'),(3,'inactive');
 INSERT INTO slots VALUES(1,'2030-01-01','08:00','Morgon',0),(2,'2030-01-02','08:00','Imorgon',0),(3,'2030-01-01','12:00','Inställt',1);
 INSERT INTO bookings VALUES(1,1,1),(2,2,1),(3,1,2),(4,1,3);`);
 let clock=new Date('2030-01-01T12:00:00Z');const module=createPresence(db,{now:()=>clock,canConfirm:uid=>Boolean(db.prepare("SELECT 1 FROM users u JOIN engagements e ON e.user_id=u.id WHERE u.id=? AND u.active=1 AND e.status='active'").get(uid))});
 return {db,module,next:()=>clock=new Date('2030-01-01T23:00:00Z'),enable:()=>module.configure({enabled:true,revision:module.settings().revision})};
}
test('Närvaromodul: avstängd från början, behörighet och samtidiga inställningar',async()=>{const f=fixture();try{
 assert.equal(presenceModule.defaultEnabled,false);assert.deepEqual(f.module.snapshot(1),{enabled:false});
 await assert.rejects(f.module.route({pathname:'/api/presence',method:'GET',uid:1}),e=>e.code==='MODULE_DISABLED');
 await assert.rejects(f.module.route({pathname:'/api/presence/settings',method:'PUT',uid:1,payload:{enabled:true,revision:0}}),e=>e.status===403);
 f.enable();assert.throws(()=>f.module.configure({enabled:false,revision:0}),e=>e.status===409);assert.equal(f.module.settings().enabled,true);
 const other=fixture();try{assert.equal(other.module.settings().enabled,false)}finally{other.db.close()}
 }finally{f.db.close()}});
test('Närvaromodul: positiva egna dagsbekräftelser, dubbeltryck och ångra',()=>{const f=fixture();try{f.enable();
 const before=f.db.prepare('SELECT * FROM bookings').all();
 f.module.confirm(1,{kind:'booked',booking_id:1});f.module.confirm(1,{kind:'booked',booking_id:1});f.module.confirm(1,{kind:'spontaneous'});
 const state=f.module.snapshot(1);assert.equal(state.mine.length,2);assert.deepEqual(state.people,[{name:'Anna',labels:['Morgon','Hjälper till utanför bokat pass']}]);assert.deepEqual(f.db.prepare('SELECT * FROM bookings').all(),before);
 const columns=f.db.prepare('PRAGMA table_info(presence_confirmations)').all().map(c=>c.name);assert.deepEqual(columns,['id','user_id','day','kind','booking_id']);
 for(const payload of [{kind:'booked',booking_id:2},{kind:'booked',booking_id:3},{kind:'booked',booking_id:4},{kind:'spontaneous',day:'2030-01-02'},{kind:'spontaneous',booking_id:1},{kind:'absent'}])assert.throws(()=>f.module.confirm(1,payload),e=>e.status===400);
 assert.throws(()=>f.module.confirm(3,{kind:'spontaneous'}),e=>e.status===403);
 assert.throws(()=>f.module.retract(2,state.mine[0].id),e=>e.status===404);f.module.retract(1,state.mine[0].id);assert.equal(f.module.snapshot(1).mine.length,1);
 f.module.configure({enabled:false,revision:1});assert.equal(f.db.prepare('SELECT count(*) n FROM presence_confirmations').get().n,0);
 }finally{f.db.close()}});
test('Närvaromodul: dygnsbyte i Sverige, avbokning och inaktivering rensar',()=>{const f=fixture();try{f.enable();f.module.confirm(1,{kind:'booked',booking_id:1});f.db.prepare('DELETE FROM bookings WHERE id=1').run();assert.equal(f.module.snapshot(1).mine.length,0);
 f.module.confirm(1,{kind:'spontaneous'});f.db.exec("UPDATE engagements SET status='paused' WHERE user_id=1");assert.equal(f.db.prepare('SELECT count(*) n FROM presence_confirmations').get().n,0);f.db.exec("UPDATE engagements SET status='active' WHERE user_id=1");
 f.module.confirm(1,{kind:'spontaneous'});f.db.exec('UPDATE users SET active=0 WHERE id=1');assert.equal(f.db.prepare('SELECT count(*) n FROM presence_confirmations').get().n,0);
 f.module.confirm(2,{kind:'spontaneous'});f.next();assert.equal(f.module.snapshot(2).day,'2030-01-02');assert.deepEqual(f.module.snapshot(2).people,[]);assert.equal(f.db.prepare('SELECT count(*) n FROM presence_confirmations').get().n,0);
 }finally{f.db.close()}});
test('Närvaromodul: QR är en vanlig katthemslänk och bekräftelser loggas inte',async()=>{const f=fixture();try{f.enable();
 await assert.rejects(f.module.route({pathname:'/api/presence/qr',method:'GET',uid:1}),e=>e.status===403);
 const qr=await f.module.route({pathname:'/api/presence/qr',method:'GET',uid:1,admin:true,baseUrl:'https://example.se',home:'hem-b'});assert.equal(qr.link,'https://example.se/?shelter=hem-b#narvaro');assert.match(qr.png,/^data:image\/png;base64,/);
 const audit=createAudit(f.db);assert.equal(audit.fromRequest('/api/presence/confirmations','POST',{kind:'spontaneous'}),null);assert.equal(audit.fromRequest('/api/presence/confirmations/1','DELETE'),null);assert.equal(audit.fromRequest('/api/presence/settings','PUT',{enabled:true}).action,'module.presence.enabled');
 }finally{f.db.close()}});
test('Närvaromodul: klienten döljer avstängd modul och förklarar frivillighet',()=>{
 const state={user:{role:'volunteer'},portal:{global_superadmin:false},modules:{presence:{enabled:false}}},context=vm.createContext({state,esc:s=>String(s),fmt:s=>s,isAdmin:u=>u.role==='admin'});vm.runInContext(readFileSync(new URL('./public/presence.js',import.meta.url),'utf8'),context);
 assert.equal(vm.runInContext('presencePrompt()',context),'');assert.equal(vm.runInContext('presenceSettingsPanel()',context),'');state.portal.global_superadmin=true;assert.match(vm.runInContext('presenceSettingsPanel()',context),/Aktivera närvarobekräftelse/);
 state.modules.presence={enabled:true,day:'2030-01-01',can_confirm:true,mine:[],bookings:[],people:[]};const html=vm.runInContext('presencePage()',context);assert.match(html,/Ingen ankomsttid/);assert.match(html,/saknad bekräftelse används inte som frånvaro/);assert.match(html,/utanför ett bokat pass/);
});
test('Profilens senaste datum: en enda dag, ingen tidsstämpel, ångra och rensning',()=>{const f=fixture();try{f.enable();f.module.confirm(1,{kind:'spontaneous'});assert.equal(f.module.last(1),'2030-01-01');f.next();assert.equal(f.module.snapshot(1).mine.length,0);assert.equal(f.module.last(1),'2030-01-01');f.module.confirm(1,{kind:'spontaneous'});assert.equal(f.module.last(1),'2030-01-02');assert.equal(f.db.prepare('SELECT count(*) n FROM presence_last WHERE user_id=1').get().n,1);assert.deepEqual(f.db.prepare('PRAGMA table_info(presence_last)').all().map(c=>c.name),['user_id','day']);const row=f.module.snapshot(1).mine[0];f.module.retract(1,row.id);assert.equal(f.module.last(1),null);f.module.confirm(1,{kind:'spontaneous'});f.db.exec("UPDATE engagements SET status='purged' WHERE user_id=1");assert.equal(f.module.last(1),null);f.module.confirm(2,{kind:'spontaneous'});f.module.configure({enabled:false,revision:1});assert.equal(f.module.last(2),null);assert.equal(f.db.prepare('SELECT count(*) n FROM presence_last').get().n,0)}finally{f.db.close()}});
