import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
export function createVolunteerTransfers(registry,{shelter,dbPath,now=()=>Date.now()}){
 registry.exec(`CREATE TABLE IF NOT EXISTS volunteer_lineage(home TEXT NOT NULL,user_id INTEGER NOT NULL,person TEXT NOT NULL,PRIMARY KEY(home,user_id));CREATE TABLE IF NOT EXISTS retired_accounts(home TEXT NOT NULL,user_id INTEGER NOT NULL,PRIMARY KEY(home,user_id));CREATE TABLE IF NOT EXISTS volunteer_transfers(id INTEGER PRIMARY KEY,source TEXT NOT NULL,source_id INTEGER NOT NULL,target TEXT NOT NULL,target_id INTEGER NOT NULL,completed INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
 registry.exec('CREATE TABLE IF NOT EXISTS volunteer_credits(person TEXT PRIMARY KEY,completed INTEGER NOT NULL DEFAULT 0)');
 let extras=[];
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 function attached(p,action){
  if(!p||typeof p.source!=='string'||typeof p.target!=='string'||!shelter(p.source)||!shelter(p.target)||p.source===p.target||!Number.isSafeInteger(p.user_id))fail('Välj person och ett annat katthem.');
  registry.prepare('ATTACH DATABASE ? AS move_source').run(dbPath(p.source));
  try{registry.prepare('ATTACH DATABASE ? AS move_target').run(dbPath(p.target));try{const links=registry.prepare('SELECT target,local_id FROM shadows WHERE source=? AND user_id=? AND target<>?').all(p.source,p.user_id,p.target);if(p.allowed_homes&&links.some(e=>!p.allowed_homes.includes(e.target)))fail('Be superadmin hjälpa till med flytten.',403);if(links.length>8)fail('Återkalla extra tilldelningar före flytt så att högst åtta andra katthem återstår.');for(const [index,link] of links.entries()){const alias='move_extra'+index;registry.prepare('ATTACH DATABASE ? AS '+alias).run(dbPath(link.target));extras.push({...link,alias})}return action()}finally{for(const e of extras.reverse())registry.exec('DETACH DATABASE '+e.alias);extras=[];registry.exec('DETACH DATABASE move_target')}}finally{registry.exec('DETACH DATABASE move_source')}
 }
 function plan(p){
  const user=registry.prepare('SELECT * FROM move_source.users WHERE id=? AND active=1').get(p.user_id);
  if(!user||user.role==='superadmin'||registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(p.source,p.user_id)||registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(p.source,p.user_id))fail('Välj ett aktivt ordinarie volontär- eller adminkonto. Superadmin flyttas inte.');
  if(p.volunteers_only&&user.role!=='volunteer')fail('Endast superadmin kan flytta administratörskonton.',403);
  const profile=registry.prepare('SELECT * FROM move_source.member_profiles WHERE user_id=?').get(user.id);if(!profile)fail('Öppna volontärlistan och försök igen.');
  const person=registry.prepare('SELECT person FROM volunteer_lineage WHERE home=? AND user_id=?').get(p.source,user.id)?.person;
  const ownShadow=registry.prepare('SELECT local_id FROM shadows WHERE source=? AND user_id=? AND target=?').get(p.source,user.id,p.target);
  const prior=person?registry.prepare('SELECT user_id FROM volunteer_lineage WHERE person=? AND home=? AND user_id NOT IN (SELECT local_id FROM shadows WHERE target=?) ORDER BY user_id LIMIT 1').get(person,p.target,p.target):null;
  const candidateId=prior?.user_id??ownShadow?.local_id??null;
  const purged=candidateId&&registry.prepare("SELECT 1 FROM move_target.sqlite_master WHERE name='engagements'").get()&&registry.prepare("SELECT 1 FROM move_target.engagements WHERE user_id=? AND status='purged'").get(candidateId);
  const targetId=purged?null:candidateId;
  const target=targetId?registry.prepare('SELECT * FROM move_target.users WHERE id=?').get(targetId):null;
  if(target?.role==='superadmin')fail('Målkontot är superadmin och kan inte ersättas.');
  if(registry.prepare('SELECT id FROM move_target.users WHERE lower(email)=lower(?) AND id<>?').get(user.email,targetId??-1))fail('E-postadressen finns redan i målkatthemmet på ett annat konto. Kontona måste kontrolleras före flytt.',409);
  if(p.volunteers_only&&(user.role!=='volunteer'||target&&target.role!=='volunteer'))fail('Admin kan bara flytta volontärer utan administratörsbehörighet. Be superadmin hjälpa till.',403);
  const targetProfile=targetId?registry.prepare('SELECT * FROM move_target.member_profiles WHERE user_id=?').get(targetId):null;
  if(registry.prepare('SELECT id FROM move_target.member_profiles WHERE lower(email)=lower(?) AND id<>?').get(profile.email,targetProfile?.id??-1))fail('E-post används av en annan profil i målkatthemmet.',409);
  const time=now(),pending=[...registry.prepare('SELECT s.id,s.date,s.start,s.end,s.title FROM move_source.bookings b JOIN move_source.slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0').all(user.id).map(s=>({...s,home:p.source,home_name:shelter(p.source).name}))];
  for(const e of extras)pending.push(...registry.prepare('SELECT s.id,s.date,s.start,s.end,s.title FROM '+e.alias+'.bookings b JOIN '+e.alias+'.slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0').all(e.local_id).map(s=>({...s,home:e.target,home_name:shelter(e.target).name})));
  const future=pending.filter(s=>new Date(s.date+'T'+s.start)>time).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  const ongoing=pending.some(s=>new Date(s.date+'T'+s.start)<=time&&new Date(s.date+'T'+s.end)>time);
  const key=createHash('sha256').update(JSON.stringify({user,profile,target,targetProfile,future,ongoing})).digest('hex');
  return {user,profile,target,targetProfile,targetId,person,future,ongoing,key};
 }
 function preview(p){return attached(p,()=>{const x=plan(p);return {source:p.source,target:p.target,user_id:p.user_id,name:x.user.name,key:x.key,future:x.future,ongoing:x.ongoing,reuses_profile:Boolean(x.targetProfile),changes_role:x.user.role!=='volunteer'||x.target?.role&&x.target.role!=='volunteer',can_move:!x.future.length&&!x.ongoing}})}
 function move(p){return attached(p,()=>{
  if(['main','move_source','move_target'].some(schema=>registry.prepare('PRAGMA '+schema+'.journal_mode').get().journal_mode!=='delete'))fail('Flytt kräver standardläget för databasjournalerna. Kontakta systemansvarig.');
  registry.exec('BEGIN IMMEDIATE');try{
   const x=plan(p);if(p.key!==x.key)fail('Uppgifterna har ändrats. Förhandsgranska flytten igen.',409);if(x.future.length)fail('Volontären behöver först kontrollera och avboka kommande pass i det gamla katthemmet.',409);if(x.ongoing)fail('Vänta tills det pågående passet har avslutats.',409);
   const person=x.person||randomBytes(16).toString('hex');registry.prepare('INSERT OR IGNORE INTO volunteer_lineage VALUES(?,?,?)').run(p.source,x.user.id,person);
   for(const link of registry.prepare('SELECT target,local_id FROM shadows WHERE source=? AND user_id=?').all(p.source,x.user.id))registry.prepare('INSERT OR IGNORE INTO volunteer_lineage VALUES(?,?,?)').run(link.target,link.local_id,person);
   let targetId=x.targetId;
   if(!targetId)targetId=Number(registry.prepare("INSERT INTO move_target.users(name,email,password,role,active,green_manual,created_at,carried_shifts) VALUES(?,?,?,'volunteer',1,?,?,0)").run(x.user.name,x.user.email,x.user.password,x.user.green_manual,now()).lastInsertRowid);
   else registry.prepare("UPDATE move_target.users SET name=?,email=?,password=?,role='volunteer',active=1,green_manual=?,created_at=? WHERE id=?").run(x.user.name,x.user.email,x.user.password,x.user.green_manual,now(),targetId);
   registry.prepare('INSERT OR IGNORE INTO volunteer_lineage VALUES(?,?,?)').run(p.target,targetId,person);
   // Count distinct completed shifts across all known homes. No booking is copied between schedules.
   const locations=registry.prepare('SELECT home,user_id FROM volunteer_lineage WHERE person=?').all(person);let total=registry.prepare('SELECT completed FROM volunteer_credits WHERE person=?').get(person)?.completed||0;
   for(const home of new Set(locations.map(v=>v.home))){const alias=home===p.source?'move_source':home===p.target?'move_target':'move_history';const history=alias==='move_history'?new DatabaseSync(dbPath(home),{readOnly:true}):null;try{const ids=locations.filter(v=>v.home===home).map(v=>v.user_id);const rows=(history||registry).prepare('SELECT DISTINCT s.id,s.date,s.end FROM '+(history?'':alias+'.')+'bookings b JOIN '+(history?'':alias+'.')+'slots s ON s.id=b.slot_id WHERE s.cancelled=0 AND b.user_id IN ('+ids.map(()=>'?').join(',')+')').all(...ids);total+=rows.filter(s=>new Date(s.date+'T'+s.end)<=now()).length}finally{if(history)history.close()}}
   const targetActual=registry.prepare('SELECT s.date,s.end FROM move_target.bookings b JOIN move_target.slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0').all(targetId).filter(s=>new Date(s.date+'T'+s.end)<=now()).length;
   registry.prepare('UPDATE move_target.users SET carried_shifts=? WHERE id=?').run(Math.max(0,total-targetActual),targetId);
   const fields=Object.keys(x.profile).filter(k=>!['id','user_id','revision','updated_at'].includes(k));const values=fields.map(k=>k==='shelter'?shelter(p.target).name:k==='board_role'?'none':k==='board_title'||k==='responsibilities'?'':k==='status'?'active':x.profile[k]);
   if(x.targetProfile)registry.prepare('UPDATE move_target.member_profiles SET '+fields.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=?').run(...values,now(),x.targetProfile.id);
   else registry.prepare('INSERT INTO move_target.member_profiles('+fields.join(',')+',user_id,updated_at) VALUES('+[...values,targetId,now()].map(()=>'?').join(',')+')').run(...values,targetId,now());
   registry.prepare('DELETE FROM move_target.checklist_progress WHERE user_id=?').run(targetId);
   if(registry.prepare("SELECT 1 FROM move_target.sqlite_master WHERE name='engagements'").get()){registry.prepare("INSERT OR IGNORE INTO move_target.engagements(user_id,changed_at) VALUES(?,?)").run(targetId,now());registry.prepare("UPDATE move_target.engagements SET status='active',needs_intro=1,practical_completed=0,independent_approved=0,routine_version=0,routine_accepted_at=NULL,review_at=NULL,ended_at=NULL,purge_after=NULL,warning_at=NULL,hold_reason='',hold_until=NULL,revision=revision+1 WHERE user_id=?").run(targetId);}
   registry.prepare('DELETE FROM move_target.sessions WHERE user_id=?').run(targetId);registry.prepare('DELETE FROM move_target.password_resets WHERE user_id=?').run(targetId);registry.prepare('DELETE FROM move_target.calendar_subscriptions WHERE user_id=?').run(targetId);
   registry.prepare('UPDATE move_source.users SET active=0 WHERE id=?').run(x.user.id);registry.prepare("UPDATE move_source.member_profiles SET status='ended',revision=revision+1,updated_at=? WHERE user_id=?").run(now(),x.user.id);
   for(const table of ['sessions','password_resets','calendar_subscriptions'])registry.prepare('DELETE FROM move_source.'+table+' WHERE user_id=?').run(x.user.id);
   for(const e of extras){registry.prepare('UPDATE '+e.alias+'.users SET active=0 WHERE id=?').run(e.local_id);for(const table of ['sessions','password_resets','calendar_subscriptions'])registry.prepare('DELETE FROM '+e.alias+'.'+table+' WHERE user_id=?').run(e.local_id)}
   registry.prepare('DELETE FROM portal_sessions WHERE source=? AND user_id=?').run(p.source,x.user.id);registry.prepare('DELETE FROM grants WHERE source=? AND user_id=?').run(p.source,x.user.id);
   registry.prepare('DELETE FROM shadows WHERE source=? AND user_id=? AND target=? AND local_id=?').run(p.source,x.user.id,p.target,targetId);
   if(registry.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portal_news_dismissals'").get())registry.prepare('INSERT INTO portal_news_dismissals(source,user_id,news_id,revision) SELECT ?,?,news_id,revision FROM portal_news_dismissals WHERE source=? AND user_id=? ON CONFLICT(source,user_id,news_id) DO UPDATE SET revision=MAX(revision,excluded.revision)').run(p.target,targetId,p.source,x.user.id);
   registry.prepare('INSERT OR IGNORE INTO retired_accounts VALUES(?,?)').run(p.source,x.user.id);registry.prepare('DELETE FROM retired_accounts WHERE home=? AND user_id=?').run(p.target,targetId);
   registry.prepare('INSERT INTO volunteer_transfers(source,source_id,target,target_id,completed,created_at) VALUES(?,?,?,?,?,?)').run(p.source,x.user.id,p.target,targetId,total,now());
   registry.exec('COMMIT');return {ok:true,target:p.target,user_id:targetId,completed_shifts:total};
  }catch(e){registry.exec('ROLLBACK');throw e}
 })}
 return {preview,move};
}
