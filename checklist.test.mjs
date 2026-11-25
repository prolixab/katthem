import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checklistGroups,createChecklist} from './checklist.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE engagements(user_id INTEGER PRIMARY KEY,checklist_revision INTEGER DEFAULT 0,status TEXT DEFAULT 'active',independent_approved INTEGER DEFAULT 0,practical_completed INTEGER DEFAULT 0);CREATE TABLE checklist_progress(user_id INTEGER,item_id TEXT);INSERT INTO engagements(user_id,independent_approved,practical_completed) VALUES(1,1,1),(2,0,0)");return {db,checklist:createChecklist(db)}}
test('checklist edits preserve IDs and progress; new points can apply to everyone',()=>{const {db,checklist:c}=fixture();const original=c.get();assert.equal(original.applies_to,'new');original.applies_to='all';db.prepare('INSERT INTO checklist_progress VALUES(1,?)').run(original.groups[0].items[0].id);original.groups[0].items[0].text='Ändrad text';original.groups[0].items.push({text:'Ny fråga'});const result=c.save(original);assert.equal(result.revision,1);assert.equal(c.forUser(1).groups[0].items.length,5);assert.equal(db.prepare('SELECT count(*) n FROM checklist_progress').get().n,1);assert.equal(c.forUser(1).groups[0].items[0].text,'Ändrad text');assert.throws(()=>c.save(original),{status:409});assert.deepEqual(createChecklist(db).get(),result);db.close()});
test('new points may exclude previously approved volunteers while updating pending introductions',()=>{const {db,checklist:c}=fixture();const p=c.get();p.applies_to='new';p.groups[0].items.push({text:'Ny fråga'});c.save(p);assert.equal(c.idsFor(1).length,checklistGroups.flatMap(g=>g.items).length);assert.equal(c.idsFor(2).length,checklistGroups.flatMap(g=>g.items).length+1);assert.equal(c.idsFor(999).length,checklistGroups.flatMap(g=>g.items).length+1);assert.equal(c.forUser(1).groups[0].items.length,4);db.close()});
test('template validation prevents forged or duplicate IDs and empty templates and rolls back changes',()=>{const {db,checklist:c}=fixture();for(const change of [p=>p.groups[0].items[0].id='unknown',p=>p.groups[0].items.push(p.groups[0].items[0]),p=>p.groups[0].items[0].text='',p=>p.groups=[]]){const p=c.get();change(p);assert.throws(()=>c.save(p),{status:400});assert.equal(c.get().revision,0)}db.close()});
test('shelters maintain independent checklist templates',()=>{const a=fixture(),b=fixture();const p=a.checklist.get();p.groups[0].title='Lokala rutiner';a.checklist.save(p);assert.notEqual(a.checklist.get().groups[0].title,b.checklist.get().groups[0].title);a.db.close();b.db.close()});


test('removed points stop being requirements in old and new revisions while other progress survives',()=>{
 const {db,checklist:c}=fixture();try{
 const original=c.get(),removed=original.groups[0].items[0].id,kept=original.groups[0].items[1].id;
 db.prepare('INSERT INTO checklist_progress VALUES(1,?)').run(removed);db.prepare('INSERT INTO checklist_progress VALUES(1,?)').run(kept);
 let change=c.get();change.applies_to='new';change.groups[0].items.push({text:'Endast nya introduktioner'});c.save(change);const added=c.get().groups[0].items.at(-1).id;
 change=c.get();change.applies_to='new';change.groups[0].items=change.groups[0].items.filter(i=>i.id!==removed);c.save(change);
 assert.ok(!c.idsFor(1).includes(removed));assert.ok(!c.idsFor(2).includes(removed));assert.ok(!c.idsFor(1).includes(added));assert.ok(c.idsFor(2).includes(added));assert.ok(c.idsFor(1).includes(kept));assert.equal(db.prepare('SELECT COUNT(*) n FROM checklist_progress').get().n,2);assert.ok(!c.forUser(1).groups.flatMap(g=>g.items).some(i=>i.id===removed));
 const revision=c.get().revision;assert.throws(()=>c.save({...original,revision:0}),{status:409});assert.equal(c.get().revision,revision);
 const forged=c.get();forged.groups[0].items.push({id:removed,text:'Återanvänt ID'});assert.throws(()=>c.save(forged),{status:400});assert.equal(c.get().revision,revision);
 }finally{db.close()}
});

test('last point in every section and existing sections are protected',()=>{
 const {db,checklist:c}=fixture();try{
 let p=c.get();const finalGroup=p.groups.at(-1),firstId=finalGroup.items[0].id,secondId=finalGroup.items[1].id;assert.equal(finalGroup.items.length,2);finalGroup.items.pop();c.save(p);
 assert.equal(c.get().groups.length,checklistGroups.length);assert.deepEqual(c.get().groups.at(-1).items.map(i=>i.id),[firstId]);assert.ok(c.idsFor(1).includes(firstId));assert.ok(!c.idsFor(1).includes(secondId));
 const revision=c.get().revision;p=c.get();p.groups.at(-1).items=[];assert.throws(()=>c.save(p),{status:400});p=c.get();p.groups.pop();assert.throws(()=>c.save(p),{status:400});assert.equal(c.get().revision,revision);assert.equal(c.get().groups.at(-1).items[0].id,firstId);
 }finally{db.close()}
});
