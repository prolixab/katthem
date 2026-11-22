import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {scheduleData,scheduleRange} from './schedule-data.mjs';

test('Schemaintervall: riktiga datum, skottår och högst 31 dagar',()=>{
 assert.deepEqual(scheduleRange(new URLSearchParams('start=2028-02-29&end=2028-03-01')),{start:'2028-02-29',end:'2028-03-01'});
 for(const query of ['','start=2027-02-29&end=2027-03-01','start=2030-01-02&end=2030-01-01','start=2030-01-01&end=2030-02-01','start=x&end=y'])assert.throws(()=>scheduleRange(new URLSearchParams(query)),e=>e.status===400);
});
test('Schemafråga: datumavgränsning, egna pass och rollskyddade deltagare',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER,slot_id INTEGER);CREATE TABLE volunteer_meeting_origins(slot_id INTEGER);INSERT INTO users VALUES(1,'Anna','anna@example.se'),(2,'Bo','bo@example.se');INSERT INTO slots VALUES(10,'2030-01-01','08:00'),(11,'2030-01-08','08:00'),(12,'2030-01-09','08:00');INSERT INTO bookings VALUES(1,1,10),(2,2,10),(3,1,11),(4,2,12)");
  const range={start:'2030-01-01',end:'2030-01-07'},green=new Set([2]),volunteer=scheduleData(db,{id:1,role:'volunteer'},green,range);
  assert.deepEqual(volunteer.slots.map(s=>s.id),[10,11]);assert.equal(volunteer.slots[0].green_booked,1);assert.equal(volunteer.slots[0].booked,2);assert.deepEqual(volunteer.slots[0].names,['Anna','Bo']);assert.ok(volunteer.bookings.every(b=>b.user_id===1&&!('email' in b)));
  const admin=scheduleData(db,{id:1,role:'admin'},green,range);assert.deepEqual(admin.bookings.map(b=>b.id),[1,2,3]);assert.equal(admin.bookings[1].name,'Bo');assert.equal(scheduleData(db,{id:1,role:'admin'},green).slots.length,3);
 }finally{db.close()}
});
const appSource=readFileSync(new URL('./public/app.js',import.meta.url),'utf8'),scheduleSource=readFileSync(new URL('./public/schedule-view.js',import.meta.url),'utf8');
function harness(){
 const calls=[],focus=[],scroll=[],node={id:'refresh-schedule',tagName:'BUTTON'},controls={'#refresh-schedule':{focus:options=>focus.push(options)}},fresh={schedule_range:{start:'2030-01-01',end:'2030-01-07'},slots:[],bookings:[],user:{id:1}};
 let complete;
 const context=vm.createContext({state:{user:{id:1},portal:{selected:'a'},slots:[],bookings:[]},view:'schedule',offset:0,filter:'all',mutationVersion:0,checklistSaving:new Set(),modal:{open:false},document:{activeElement:node,visibilityState:'visible'},app:{contains:()=>true,querySelector:s=>controls[s]},CSS:{escape:s=>s},$:s=>controls[s],window:{scrollY:120,scrollTo:(...args)=>scroll.push(args)},week:()=>['2030-01-01','2030-01-07'],api:async url=>{calls.push(url);return await new Promise(resolve=>{complete=()=>resolve(fresh)})},render:()=>calls.push('render'),toast:()=>{}});
 vm.runInContext(scheduleSource+'\n'+appSource.slice(appSource.indexOf('let refreshing=false;'),appSource.indexOf('setInterval(()=>{void refreshSchedule()')),context);
 return {context,calls,focus,scroll,complete:()=>complete(),fresh};
}
test('Bakgrundsuppdatering: bevarar fokus och rullning efter nytt schemasvar',async()=>{
 const h=harness(),pending=vm.runInContext('refreshSchedule()',h.context);h.complete();await pending;
 assert.match(h.calls[0],/^schedule\?start=/);assert.equal(h.calls[1],'render');assert.equal(h.focus.length,1);assert.deepEqual(h.scroll,[[0,120]]);
});
test('Bakgrundsuppdatering: väntar vid inmatning och hoppar över andra sidor',async()=>{
 for(const change of [c=>c.document.activeElement={tagName:'INPUT'},c=>c.document.activeElement={tagName:'SELECT'},c=>c.modal.open=true,c=>c.view='account',c=>c.document.visibilityState='hidden']){
  const h=harness();change(h.context);await vm.runInContext('refreshSchedule()',h.context);assert.equal(h.calls.length,0);
 }
});
test('Bakgrundsuppdatering: kastar svar efter byte av vecka, hem, vy eller påbörjad redigering',async()=>{
 for(const change of [c=>c.offset++,c=>c.state.portal.selected='b',c=>c.view='info',c=>vm.runInContext("calendarMode='list'",c),c=>c.document.activeElement={tagName:'TEXTAREA'},c=>c.modal.open=true,c=>c.mutationVersion++]){
  const h=harness(),before=h.context.state,pending=vm.runInContext('refreshSchedule()',h.context);change(h.context);h.complete();await pending;assert.equal(h.context.state,before);assert.equal(h.calls.length,1);assert.equal(h.focus.length,0);
 }
});
test('Schemasammanslagning: tar bort borttagna och flyttade pass utan dubbletter',()=>{
 const h=harness();h.context.previous={slots:[{id:1,date:'2030-01-01',start:'08:00'},{id:2,date:'2030-01-08',start:'08:00'},{id:3,date:'2030-01-09',start:'08:00',mine:1},{id:4,date:'2030-01-10',start:'08:00'}],bookings:[{id:1,slot_id:1},{id:2,slot_id:2},{id:3,slot_id:3},{id:4,slot_id:4}]};h.context.fresh={schedule_range:{start:'2030-01-01',end:'2030-01-07'},slots:[{id:2,date:'2030-01-02',start:'08:00'}],bookings:[{id:2,slot_id:2}]};
 const result=vm.runInContext('mergeSchedule(previous,fresh)',h.context);assert.deepEqual(Array.from(result.slots,s=>s.id),[2,4]);assert.deepEqual(Array.from(result.bookings,b=>b.id),[4,2]);
});
test('Introduktion och dagvy: nästa steg, färdiga steg och datum utanför veckan',()=>{
 const h=harness();h.context.isAdmin=u=>u.role==='admin';h.context.esc=s=>String(s);h.context.engagementLabel=s=>s;h.context.dateStr=()=> '2030-01-02';h.context.state.user={id:1,role:'volunteer',engagement:{status:'active',needs_intro:true,checklist_complete:false,practical_completed:false,routine_current:false,independent_approved:false,can_self_book:false}};
 assert.match(vm.runInContext('introductionProgress()',h.context),/data-intro-target="introduction-checklist"/);
 h.context.state.user.engagement.checklist_complete=true;h.context.state.user.engagement.practical_completed=true;assert.match(vm.runInContext('introductionProgress()',h.context),/data-intro-target="current-routines"/);
 h.context.state.user.engagement.routine_current=true;h.context.state.user.engagement.independent_approved=true;h.context.state.user.engagement.can_self_book=true;h.context.state.user.engagement.intro_ready=true;assert.equal(vm.runInContext('introductionProgress()',h.context),'');
 assert.equal(vm.runInContext("selectedScheduleDay(['2030-01-01','2030-01-02'])",h.context),'2030-01-02');assert.equal(vm.runInContext("selectedScheduleDay(['2030-02-01','2030-02-02'])",h.context),'2030-02-01');
});

test('Navigation: Veckoschema fokuserar passen, loggan återställer startsidan',()=>{
 const source=appSource.slice(appSource.indexOf('function navigateSchedule('),appSource.indexOf('function render(){')),calls=[],heading={focus:o=>calls.push(['focus',o]),scrollIntoView:o=>calls.push(['scroll',o])};
 const context=vm.createContext({view:'admin',offset:3,filter:'mine',scheduleDay:'2030-01-01',mobileWeek:true,adminSectionsOpen:new Set(['booking-settings']),render:()=>calls.push(['render']),$:selector=>{calls.push(['heading',selector]);return heading},window:{scrollTo:o=>calls.push(['top',o])}});
 vm.runInContext(source+';navigateSchedule()',context);assert.equal(context.view,'schedule');assert.equal(context.offset,3);assert.equal(context.filter,'mine');assert.equal(context.adminSectionsOpen.size,0);assert.ok(calls.some(c=>c[0]==='heading'&&c[1]==='#schedule-heading'));assert.ok(calls.some(c=>c[0]==='scroll'));assert.ok(!calls.some(c=>c[0]==='top'));
 calls.length=0;vm.runInContext('navigateSchedule(true)',context);assert.equal(context.view,'home');assert.equal(context.calendarMode,'week');assert.equal(context.offset,0);assert.equal(context.filter,'all');assert.equal(context.scheduleDay,'');assert.equal(context.mobileWeek,false);assert.ok(calls.some(c=>c[0]==='heading'&&c[1]==='#home-heading'));assert.ok(calls.some(c=>c[0]==='top'&&c[1].top===0));
});

test('Startsidenotiser: väntande checklistor visas för admin och försvinner efter godkännande',()=>{
 const source=appSource.split('\n').find(line=>line.startsWith('function introductionPendingPanel()'));
 const context=vm.createContext({state:{user:{role:'admin'},introduction_pending:[{id:2,name:'Ny volontär',routine_current:true}]},isAdmin:u=>['admin','superadmin'].includes(u.role),esc:s=>String(s)});
 const markup=vm.runInContext(source+';introductionPendingPanel()',context);assert.ok(markup.includes('Väntar på godkännande (1)'));assert.match(markup,/Ny volontär/);assert.match(markup,/data-review-introduction="2"/);
 context.state.user.role='volunteer';assert.equal(vm.runInContext('introductionPendingPanel()',context),'');context.state.user.role='admin';context.state.introduction_pending=[];assert.equal(vm.runInContext('introductionPendingPanel()',context),'');
});

test('Ny layout: nästa egna aktiva pass, filtrerad lista och begränsade deltagarnamn',()=>{
 const days=Array.from({length:7},(_,i)=>'2099-01-'+String(i+1).padStart(2,'0')),slots=[{id:1,date:days[0],start:'08:00',end:'12:00',title:'Inställt',mine:1,cancelled:1},{id:2,date:days[2],start:'16:00',end:'18:00',title:'Nästa <pass>',mine:1,booked:1,minimum_staff:2,green_booked:1,names:['Anna Al.','Anna And.','Bo <test>']},{id:3,date:days[1],start:'08:00',end:'12:00',title:'Ledigt',mine:0,booked:0,minimum_staff:2,green_booked:0}];
 const context=vm.createContext({state:{user:{name:'Anna <test>',role:'volunteer'},slots,bookings:[{slot_id:2,name:'Privat deltagarnamn'}]},isAdmin:u=>u.role==='admin',esc:s=>String(s??'').replace(/</g,'&lt;').replace(/>/g,'&gt;'),past:()=>false,needsStaffing:s=>!s.cancelled&&s.booked<2,staffed:s=>s.booked>=2,staffing:s=>s.booked+' anmälda',experienceLabel:s=>s.green_booked?'✓ Grönmarkerad volontär bokad':'Saknar grönmarkerad volontär',fmt:s=>s,dateStr:()=>days[0],week:()=>days,weekNumber:()=>1,filter:'all',recommendedLimit:()=>5,bookingHelpPanel:()=>'',routineReminder:()=>'',weekCalendarLink:()=>'',newsBanner:()=>'',doorCodePanel:()=>'',introductionPendingPanel:()=>'',upcomingReminders:()=>''});
 vm.runInContext(scheduleSource,context);
 const home=vm.runInContext('homePage()',context);assert.match(home,/data-slot="2">Hantera pass/);assert.doesNotMatch(home,/Inställt|Privat deltagarnamn/);assert.match(home,/Nästa &lt;pass&gt;/);
 let calendar=vm.runInContext("calendarMode='list';schedulePage()",context);assert.equal((calendar.match(/data-day-date=/g)||[]).length,7);assert.match(calendar,/calendar-list/);assert.match(calendar,/data-slot="2"[^>]*>Hantera pass/);assert.match(calendar,/data-slot="3"[^>]*>Boka pass/);assert.doesNotMatch(calendar,/Privat deltagarnamn|data-self-book/);assert.match(calendar,/Anna Al., Anna And., Bo &lt;test&gt;/);assert.doesNotMatch(calendar,/<test>/);assert.match(calendar,/slot [^"]*booked[^"]*understaffed/);assert.match(calendar,/✓ Grönmarkerad volontär bokad/);
 calendar=vm.runInContext("filter='mine';schedulePage()",context);assert.doesNotMatch(calendar,/data-slot="3"/);assert.match(calendar,/data-slot="2"/);
 context.state.user.role='admin';assert.match(vm.runInContext('schedulePage()',context),/Privat deltagarnamn/);
});


test('Veckans passerade pass visas och öppnas för läsning utan ny bokningsknapp',()=>{
 const source=scheduleSource.slice(scheduleSource.indexOf('function scheduleSlot('),scheduleSource.indexOf('function schedulePage(')),context=vm.createContext({past:()=>true,needsStaffing:()=>false,esc:s=>String(s??''),staffing:()=> '2 anmälda',state:{bookings:[]},s:{id:4,start:'08:00',end:'12:00',title:'Tidigare morgonpass',mine:0,cancelled:0}});
 const html=vm.runInContext(source+';scheduleSlot(s,false)',context);assert.match(html,/past-label">Passerat/);assert.match(html,/data-slot="4"[^>]*>Visa pass/);assert.doesNotMatch(html,/disabled|Boka pass|data-self-book/);
});


test('Volontärschema visar visningsnamn utan att lämna ut andras bokningar eller kontaktuppgifter',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE slots(id INTEGER PRIMARY KEY,date TEXT,start TEXT,cancelled INTEGER DEFAULT 0);CREATE TABLE bookings(id INTEGER PRIMARY KEY,user_id INTEGER,slot_id INTEGER);CREATE TABLE volunteer_meeting_origins(slot_id INTEGER);
 INSERT INTO users VALUES(1,'Anna Andersson','anna1@example.se'),(2,'Anna Alm','anna2@example.se'),(3,'Bo Borg','bo@example.se'),(4,'Anna Ankare','outside@example.se');
 INSERT INTO slots VALUES(10,'2030-01-01','08:00',0),(11,'2030-01-02','08:00',0),(12,'2030-01-03','08:00',1),(13,'2030-02-01','08:00',0);
 INSERT INTO bookings VALUES(1,1,10),(2,2,10),(3,3,11),(4,4,12),(5,4,13);`);
 const range={start:'2030-01-01',end:'2030-01-07'},get=()=>scheduleData(db,{id:1,role:'volunteer'},new Set(),range);
 let data=get();assert.deepEqual(data.slots[0].names,['Anna Al.','Anna An.']);assert.deepEqual(data.slots[1].names,['Bo']);assert.deepEqual(data.slots[2].names,[]);assert.deepEqual(data.bookings.map(b=>b.id),[1]);
 assert.doesNotMatch(JSON.stringify(data),/Andersson|Alm|Borg|Ankare|@example.se/);
 db.prepare('DELETE FROM bookings WHERE id=2').run();data=get();assert.deepEqual(data.slots[0].names,['Anna']);
 db.prepare('INSERT INTO bookings VALUES(6,3,10)').run();assert.deepEqual(get().slots[0].names,['Anna','Bo']);
 }finally{db.close()}
});
