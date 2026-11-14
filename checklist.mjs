import {randomUUID} from 'node:crypto';
export const checklistGroups=[
 {title:'Hitta och känna sig trygg',items:[
  {id:'tour',text:'Jag har fått en rundvisning.'},
  {id:'ask-help',text:'Jag vet vem jag kan fråga om hjälp.'},
  {id:'written-routines',text:'Jag vet var de skriftliga rutinerna finns.'},
  {id:'safety',text:'Jag har fått information om säkerhet och vad jag gör vid en akut situation.'}
 ]},
 {title:'Lära känna arbetet',items:[
  {id:'accompanied-shift',text:'Jag har gått ett pass tillsammans med en erfaren volontär.'},
  {id:'daily-care',text:'Jag har fått se hur matning, vatten och rengöring går till.'},
  {id:'sanitation',text:'Jag har fått en genomgång av sanering enligt katthemmets rutiner och vet var instruktionerna finns.'},
  {id:'own-tasks',text:'Jag vet vilka uppgifter jag får göra själv och när jag ska fråga.'},
  {id:'handover',text:'Jag vet var whiteboardtavlan finns och att överlämning till nästa pass sker på plats med hjälp av tavlan.'}
 ]},
 {title:'Bemöta katterna',items:[
  {id:'approach-cats',text:'Jag har fått vägledning i hur vi närmar oss katterna.'},
  {id:'individual-needs',text:'Jag vet att katterna kan ha olika behov och begränsningar.'},
  {id:'report-concerns',text:'Jag vet vem jag kontaktar om en katt verkar sjuk eller beter sig annorlunda.'}
 ]},
 {title:'Använda volontärportalen',items:[
  {id:'profile-updated',text:'Jag har öppnat Mitt konto och kontrollerat och uppdaterat mina profil- och kontaktuppgifter.'},
  {id:'booking',text:'Jag kan boka och avboka ett pass.'},
  {id:'staffing-colors',text:'Jag förstår bemanningsmarkeringarna och den röda färgen.'},
  {id:'late-cancellation',text:'Jag vet hur jag meddelar sena förhinder.'}
 ]},
 {title:'Avstämning',items:[
  {id:'questions',text:'Jag har fått möjlighet att ställa frågor efter mina första pass.'},
  {id:'follow-up',text:'Vi har pratat om vad jag känner mig trygg med och vad jag vill öva mer på.'}
 ]}
];

export function createChecklist(db){
 db.exec("CREATE TABLE IF NOT EXISTS checklist_template(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,groups_json TEXT NOT NULL,applies_to TEXT NOT NULL DEFAULT 'new');CREATE TABLE IF NOT EXISTS checklist_versions(revision INTEGER PRIMARY KEY,item_ids_json TEXT NOT NULL)");
 db.prepare('INSERT OR IGNORE INTO checklist_template VALUES(1,0,?,?)').run(JSON.stringify(checklistGroups),'new');
 db.prepare('INSERT OR IGNORE INTO checklist_versions VALUES(0,?)').run(JSON.stringify(checklistGroups.flatMap(group=>group.items.map(item=>item.id))));
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 function get(){const row=db.prepare('SELECT * FROM checklist_template WHERE id=1').get();return {revision:row.revision,groups:JSON.parse(row.groups_json),applies_to:row.applies_to}}
 const currentRevision=()=>get().revision;
 function idsFor(uid){const row=db.prepare('SELECT checklist_revision FROM engagements WHERE user_id=?').get(uid),revision=row?.checklist_revision??currentRevision();const version=db.prepare('SELECT item_ids_json FROM checklist_versions WHERE revision=?').get(revision);return version?JSON.parse(version.item_ids_json):get().groups.flatMap(group=>group.items.map(item=>item.id))}
 function forUser(uid){const template=get(),ids=new Set(idsFor(uid));return {revision:template.revision,groups:template.groups.map(group=>({...group,items:group.items.filter(item=>ids.has(item.id))})).filter(group=>group.items.length)}}
 function save(p){
  if(!p||Object.keys(p).some(key=>!['revision','groups','applies_to'].includes(key))||!Number.isInteger(p.revision)||!['all','new'].includes(p.applies_to)||!Array.isArray(p.groups)||p.groups.length<1||p.groups.length>20)fail('Kontrollera checklistan och välj vilka nya punkter gäller för.');
  db.exec('BEGIN IMMEDIATE');try{const current=get();if(p.revision!==current.revision)fail('Checklistan har ändrats av någon annan. Öppna redigeraren igen.',409);
   const existing=new Set(current.groups.flatMap(group=>group.items.map(item=>item.id))),seen=new Set();let count=0;
   const groups=p.groups.map(group=>{if(!group||Object.keys(group).some(key=>!['title','items'].includes(key))||typeof group.title!=='string'||!group.title.trim()||group.title.length>100||!Array.isArray(group.items)||!group.items.length)fail('Varje avsnitt behöver en rubrik och minst en punkt.');return {title:group.title.trim(),items:group.items.map(item=>{if(!item||Object.keys(item).some(key=>!['id','text'].includes(key))||typeof item.text!=='string'||!item.text.trim()||item.text.length>600||++count>200)fail('Punkter behöver text med högst 600 tecken. Checklistan får ha högst 200 punkter.');const id=item.id==null?'custom-'+randomUUID():item.id;if(typeof id!=='string'||item.id!=null&&!existing.has(id)||seen.has(id))fail('En punkt är okänd eller dubblerad. Öppna redigeraren igen.');seen.add(id);return {id,text:item.text.trim()}})}});
   if([...existing].some(id=>!seen.has(id)))fail('Befintliga punkter kan ändras men inte tas bort, så att sparade kryss bevaras.');
   const revision=current.revision+1;db.prepare('INSERT INTO checklist_versions VALUES(?,?)').run(revision,JSON.stringify([...seen]));db.prepare('UPDATE checklist_template SET revision=?,groups_json=?,applies_to=? WHERE id=1').run(revision,JSON.stringify(groups),p.applies_to);
   db.prepare("UPDATE engagements SET checklist_revision=? WHERE status<>'purged' AND (?='all' OR independent_approved=0 OR practical_completed=0)").run(revision,p.applies_to);
   db.exec('COMMIT');return get();
  }catch(error){db.exec('ROLLBACK');throw error}
 }
 return {get,currentRevision,idsFor,forUser,save};
}
