import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createEngagement,addMonths} from './engagement.mjs';
import {createPortalEngagement} from './portal-engagement.mjs';
function fixture(file=':memory:'){
 const db=new DatabaseSync(file);db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT DEFAULT 'volunteer',active INTEGER DEFAULT 1,green_manual INTEGER DEFAULT 0,created_at INTEGER DEFAULT 0,carried_shifts INTEGER DEFAULT 0);INSERT INTO users(id,name,email,password) VALUES(1,'Testperson','test@example.se','test-hash');CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,end TEXT,title TEXT,cancelled INTEGER DEFAULT 0);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id REFERENCES users(id),slot_id REFERENCES slots(id));CREATE TABLE checklist_progress(user_id INTEGER,item_id TEXT);CREATE TABLE member_profiles(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,email TEXT,status TEXT,revision INTEGER DEFAULT 0,updated_at INTEGER);INSERT INTO member_profiles(user_id,name,email,status) VALUES(1,'Testperson','test@example.se','active');CREATE TABLE calendar_subscriptions(user_id INTEGER,token TEXT);CREATE TABLE sessions(user_id INTEGER,token TEXT);`);return db;
}
test('Engagemang: kalendermånader, uppföljning, undantag och ny introduktion vid återkomst',()=>{
 const db=fixture();let time=Date.UTC(2030,0,31,12);const e=createEngagement(db,{now:()=>time});e.setChecklistIds(['water']);
 try{assert.equal(addMonths(time,1),Date.UTC(2030,1,28,12));assert.equal(e.get(1).can_self_book,true);
 assert.throws(()=>e.setStatus(1,{status:'paused',revision:0}),/uppföljningsdatum/);
 e.setStatus(1,{status:'paused',revision:0,review_date:'2030-02-05'},{self:true});time=Date.UTC(2030,1,6);assert.equal(e.get(1).review_due,true);assert.equal(e.due().length,0);assert.throws(()=>e.assertBook(1,{admin:true}),/pausat/);
 let row=e.setStatus(1,{status:'ended',revision:e.get(1).revision},{self:true});assert.equal(row.purge_after,Date.UTC(2030,4,6));time=row.warning_at;assert.equal(e.get(1).purge_warning,true);assert.equal(e.due().length,0);
 e.hold(1,{reason:'Pågående dokumenterat annat uppdrag',until:'2030-06-01'});time=row.purge_after;assert.equal(e.due().length,0);time=Date.UTC(2030,5,2);assert.equal(e.due().length,1);
 e.setStatus(1,{status:'active',revision:e.get(1).revision});assert.equal(e.get(1).intro_ready,false);assert.equal(e.due().length,0);
 }finally{db.close()}
});
test('Introduktion: befintliga behåller behörighet, nya kräver checklista, rutiner och godkännande',()=>{
 const db=fixture(),e=createEngagement(db);e.setChecklistIds(['water']);try{
 assert.equal(e.get(1).can_self_book,true);db.prepare("INSERT INTO users(id,name,email,password) VALUES(2,'Ny','new@example.se','hash')").run();assert.equal(e.get(2).can_self_book,true);assert.equal(e.get(2).intro_remaining,3);
 e.publish({title:'Rutiner',body:'Läs whiteboard och kontrollera vatten.',version:0});assert.equal(e.get(1).can_self_book,false);assert.throws(()=>e.accept(1,0),/ändrats/);e.accept(1,1);assert.equal(e.get(1).can_self_book,true);
 e.assertBook(2,{admin:true});assert.throws(()=>e.approve(2,{practical_completed:true,independent_approved:true}),/Checklistan/);db.prepare('INSERT INTO checklist_progress VALUES(?,?)').run(2,'water');e.accept(2,1);e.approve(2,{practical_completed:true,independent_approved:true});e.assertBook(2);db.prepare('DELETE FROM checklist_progress WHERE user_id=2').run();assert.throws(()=>e.assertBook(2),/introduktionschecklistan/);
 e.publish({title:'Ny version',body:'Nya rutiner',version:1});assert.equal(e.get(1).can_self_book,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM routine_versions').get().n,2);
 }finally{db.close()}
});
test('Gallring: tar bort personuppgifter och kopplingar men bevarar anonyma bemanningstal',()=>{
 const db=fixture();let time=Date.UTC(2030,0,1),e=createEngagement(db,{now:()=>time});try{
 db.exec("INSERT INTO slots VALUES(1,'2029-12-01','08:00','12:00','Pass',0);INSERT INTO bookings VALUES(1,1,1);INSERT INTO checklist_progress VALUES(1,'water');INSERT INTO sessions VALUES(1,'secret');INSERT INTO calendar_subscriptions VALUES(1,'private-token')");
 e.setStatus(1,{status:'ended',revision:0});time=Date.UTC(2030,3,1);assert.equal(e.due().length,1);db.exec('BEGIN');e.erase([1]);db.exec('COMMIT');
 for(const t of ['member_profiles','bookings','checklist_progress','sessions','calendar_subscriptions'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+t).get().n,0);
 assert.equal(db.prepare('SELECT count FROM anonymous_staffing').get().count,1);assert.equal(e.get(1).status,'purged');const u=db.prepare('SELECT * FROM users').get();assert.equal(u.active,0);assert.notEqual(u.email,'test@example.se');assert.notEqual(u.password,'test-hash');assert.throws(()=>e.setStatus(1,{status:'active',revision:e.get(1).revision}),/inte längre/);
 e.erase([1]);assert.equal(db.prepare('SELECT count FROM anonymous_staffing').get().count,1);
 }finally{db.close()}
});
test('Flera katthem: atomisk paus, inga e-postsammanslagningar och konto bevarat tills sista engagemanget gallras',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'katthem-lifecycle-')),registry=new DatabaseSync(path.join(dir,'registry.sqlite')),a=fixture(path.join(dir,'a.sqlite')),b=fixture(path.join(dir,'b.sqlite')),c=fixture(path.join(dir,'c.sqlite'));let time=Date.UTC(2030,0,1);
 try{registry.exec(`CREATE TABLE shadows(source TEXT,user_id INTEGER,target TEXT,local_id INTEGER);INSERT INTO shadows VALUES('a',1,'b',1);CREATE TABLE volunteer_lineage(home TEXT,user_id INTEGER,person TEXT);CREATE TABLE retired_accounts(home TEXT,user_id INTEGER);CREATE TABLE shadow_profile_sync(source TEXT,user_id INTEGER,target TEXT,values_json TEXT);CREATE TABLE portal_sessions(source TEXT,user_id INTEGER);CREATE TABLE grants(source TEXT,user_id INTEGER,target TEXT);CREATE TABLE portal_news_dismissals(source TEXT,user_id INTEGER);CREATE TABLE volunteer_transfers(source TEXT,source_id INTEGER,target TEXT,target_id INTEGER);INSERT INTO grants VALUES('a',1,'b');`);
 const ea=createEngagement(a,{now:()=>time}),eb=createEngagement(b,{now:()=>time});createEngagement(c,{now:()=>time});const p=createPortalEngagement(registry,{workers:new Map([['a',{db:a}],['b',{db:b}],['c',{db:c}]]),houses:()=>[{id:'a'},{id:'b'},{id:'c'}],now:()=>time});assert.equal(p.cluster('a',1).length,2);
 b.exec("INSERT INTO slots VALUES(1,'2030-01-03','08:00','12:00','B-pass',0);INSERT INTO bookings VALUES(1,1,1)");assert.throws(()=>p.update('a',1,{scope:'all',status:'ended',revision:0},{self:true}),/samtliga/);assert.equal(ea.get(1).status,'active');b.exec('DELETE FROM bookings');
 p.update('a',1,{scope:'all',status:'paused',revision:0,review_date:'2030-02-01'},{self:true});assert.equal(ea.get(1).status,'paused');assert.equal(eb.get(1).status,'paused');assert.equal(c.prepare('SELECT status FROM engagements').get().status,'active');
 p.update('a',1,{scope:'one',status:'ended',revision:ea.get(1).revision},{self:true});time=Date.UTC(2030,3,2);p.purge();assert.equal(ea.get(1).status,'purged');assert.equal(a.prepare('SELECT email FROM users').get().email,'test@example.se');assert.equal(b.prepare('SELECT email FROM users').get().email,'test@example.se');assert.equal(a.prepare('SELECT COUNT(*) n FROM member_profiles').get().n,0);
 p.update('b',1,{status:'ended',revision:eb.get(1).revision},{self:true});time=Date.UTC(2030,6,3);p.purge();assert.equal(a.prepare('SELECT active FROM users').get().active,0);assert.equal(b.prepare('SELECT active FROM users').get().active,0);assert.notEqual(a.prepare('SELECT email FROM users').get().email,'test@example.se');assert.equal(registry.prepare('SELECT COUNT(*) n FROM shadows').get().n,0);assert.equal(c.prepare('SELECT email FROM users').get().email,'test@example.se');
 }finally{a.close();b.close();c.close();registry.close();rmSync(dir,{recursive:true,force:true})}
});

test('Introduktionskvot: tre pass, full checklista, återgång och avbokade eller inställda pass',()=>{
 const db=fixture();let time=new Date('2030-01-01T12:00').getTime();const e=createEngagement(db,{now:()=>time});e.setChecklistIds(['water','food']);
 try{
  db.exec("INSERT INTO users(id,name,email,password) VALUES(2,'Ny','new@example.se','hash');INSERT INTO slots VALUES(1,'2030-01-02','08:00','12:00','Ett',0),(2,'2030-01-03','08:00','12:00','Två',0),(3,'2030-01-04','08:00','12:00','Tre',0),(4,'2020-01-01','08:00','12:00','Gammalt',0);INSERT INTO bookings VALUES(4,2,4)");
  assert.equal(e.get(2).intro_remaining,3);e.publish({title:'Rutiner',body:'Läs rutinerna',version:0});assert.throws(()=>e.assertBook(2),err=>err.code==='INTRODUCTION_REQUIRED');e.accept(2,1);
  for(let id=1;id<=3;id++){e.assertBook(2);db.prepare('INSERT INTO bookings VALUES(?,?,?)').run(id,2,id)}
  assert.equal(e.get(2).intro_remaining,0);assert.throws(()=>e.assertBook(2),err=>err.code==='INTRODUCTION_LIMIT');e.assertBook(2,{admin:true});
  time=new Date('2030-01-03T18:00').getTime();assert.equal(e.get(2).intro_bookings,3); // completed shifts still use the quota
  db.exec('UPDATE slots SET cancelled=1 WHERE id=1');assert.equal(e.get(2).intro_remaining,1);db.exec('DELETE FROM bookings WHERE id=2');assert.equal(e.get(2).intro_remaining,2);
  assert.equal(e.get(2).awaiting_approval,false);db.exec("INSERT INTO checklist_progress VALUES(2,'water')");assert.equal(e.get(2).awaiting_approval,false);db.exec("INSERT INTO checklist_progress VALUES(2,'food')");assert.equal(e.get(2).awaiting_approval,true);
  assert.throws(()=>e.approve(2,{practical_completed:false,independent_approved:true}),/praktisk/);e.approve(2,{practical_completed:true,independent_approved:true});assert.equal(e.get(2).awaiting_approval,false);e.assertBook(2,{count:100});
  time=new Date('2030-02-01T12:00').getTime();e.resetIntroduction(2);assert.equal(e.get(2).intro_bookings,0);assert.equal(e.get(2).checklist_complete,false);
 }finally{db.close()}
});

test('Introduktionsmigrering: tidigare historik räknas inte som nya introduktionspass',()=>{
 const db=fixture(),time=new Date('2030-01-01T12:00').getTime();try{
  createEngagement(db,{now:()=>time});db.prepare('UPDATE engagements SET needs_intro=1,practical_completed=0,independent_approved=0,changed_at=? WHERE user_id=1').run(time);
  db.exec("ALTER TABLE engagements DROP COLUMN intro_started_at;INSERT INTO slots VALUES(1,'2020-01-01','08:00','12:00','Historik',0),(2,'2030-01-02','08:00','12:00','Intro',0);INSERT INTO bookings VALUES(1,1,1),(2,1,2)");
  const migrated=createEngagement(db,{now:()=>time});assert.equal(migrated.get(1).intro_started_at,time);assert.equal(migrated.get(1).intro_bookings,1);assert.equal(migrated.get(1).intro_remaining,2);
 }finally{db.close()}
});
